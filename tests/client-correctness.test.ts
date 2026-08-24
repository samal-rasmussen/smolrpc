import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
	ClientTransportState,
	ClientWebSocketEvents,
} from '../src/client.types.ts';
import { SmolRpcError } from '../src/client-errors.js';
import { initClient } from '../src/init-client.js';
import { OPERATION_TIMEOUT_MS } from '../src/init-client-proxy.js';
import {
	NORMAL_CLOSE_CODE,
	RECONNECT_DELAYS_MS,
} from '../src/init-client-websocket.js';
import {
	type ControlledSocketPlan,
	ControlledWebSocket,
	ControlledWebSocketFactory,
} from './controlled-websocket.ts';
import type { Resources } from './resources.ts';

type Frame = {
	data?: unknown;
	id: number;
	request?: unknown;
	resource: string;
	subscriptionId?: number;
	type: string;
};

function createClient(plans: ControlledSocketPlan[] = []) {
	const factory = new ControlledWebSocketFactory();
	for (const plan of plans) factory.enqueue(plan);
	const states: ClientTransportState[] = [];
	const events = {
		close: vi.fn(),
		error: vi.fn(),
		message: vi.fn(),
		open: vi.fn(),
		reconnect: vi.fn(),
		send: vi.fn(),
		statechange: vi.fn((state: ClientTransportState) => {
			states.push(state);
		}),
	} satisfies ClientWebSocketEvents;
	const reportInternalError = vi.fn();
	const result = initClient<Resources>({
		createWebSocket: factory.createWebSocket,
		reportInternalError,
		url: 'ws://smolrpc.test',
		webSocketEvents: events,
	});
	return { ...result, events, factory, reportInternalError, states };
}

function frames(socket: ControlledWebSocket) {
	return socket.sentFrames<Frame>();
}

function errorCode(code: string) {
	return expect.objectContaining({ code });
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.spyOn(Math, 'random').mockReturnValue(0.5);
});

afterEach(() => {
	vi.clearAllTimers();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe('generation-owned transport', () => {
	it('drops every callback from a caller-retired generation', async () => {
		const setup = createClient();
		const oldSocket = setup.factory.latest;
		oldSocket.open();
		setup.clientMethods.close();
		setup.clientMethods.open();
		const replacement = setup.factory.latest;
		replacement.open();

		const pending = setup.client['/counter'].get();
		const [request] = frames(replacement);
		const eventCounts = {
			close: setup.events.close.mock.calls.length,
			error: setup.events.error.mock.calls.length,
			message: setup.events.message.mock.calls.length,
			open: setup.events.open.mock.calls.length,
		};
		oldSocket.open();
		oldSocket.error();
		oldSocket.message({
			data: 1,
			id: request.id,
			resource: request.resource,
			type: 'GetResponse',
		});
		oldSocket.peerClose();

		expect(setup.events.open).toHaveBeenCalledTimes(eventCounts.open);
		expect(setup.events.message).toHaveBeenCalledTimes(eventCounts.message);
		expect(setup.events.error).toHaveBeenCalledTimes(eventCounts.error);
		expect(setup.events.close).toHaveBeenCalledTimes(eventCounts.close);
		expect(setup.factory.sockets).toHaveLength(2);

		replacement.message({
			data: 2,
			id: request.id,
			resource: request.resource,
			type: 'GetResponse',
		});
		await expect(pending).resolves.toBe(2);
	});

	it('cancels stale reconnect timers and ignores native errors', () => {
		const setup = createClient();
		const socket = setup.factory.latest;
		socket.open();
		const statesBeforeError = [...setup.states];
		socket.error();
		expect(setup.states).toEqual(statesBeforeError);
		expect(setup.factory.sockets).toHaveLength(1);

		socket.peerClose();
		setup.clientMethods.close();
		vi.advanceTimersByTime(20_000);
		expect(setup.factory.sockets).toHaveLength(1);
		expect(setup.events.reconnect).not.toHaveBeenCalled();
	});

	it('detaches old work before unavailable and settles before backoff work', async () => {
		const setup = createClient();
		const socket = setup.factory.latest;
		socket.open();
		const order: string[] = [];
		setup.events.statechange.mockImplementation((state) => {
			setup.states.push(state);
			order.push(state);
		});
		const result = setup.client['/counter'].get();
		const rejected = result.catch((error) => {
			order.push(`reject:${error.code}`);
			throw error;
		});

		socket.peerClose();
		await expect(rejected).rejects.toMatchObject({
			code: 'SMOLRPC_UNAVAILABLE',
		});
		expect(order.slice(0, 2)).toEqual(['unavailable', 'backoff']);
		expect(order.at(-1)).toBe('reject:SMOLRPC_UNAVAILABLE');
		expect(setup.events.close).toHaveBeenCalledOnce();
	});

	it('rethrows an initial constructor failure without scheduling reconnect', () => {
		const factory = new ControlledWebSocketFactory();
		const failure = new Error('constructor failed');
		factory.enqueue({ constructorError: failure });
		expect(() =>
			initClient<Resources>({
				createWebSocket: factory.createWebSocket,
				reportInternalError: vi.fn(),
				url: 'ws://smolrpc.test',
				webSocketEvents: {},
			}),
		).toThrow(failure);
		vi.advanceTimersByTime(20_000);
		expect(factory.attempts).toHaveLength(1);
	});

	it('contains reconnect constructor failures and schedules one next attempt', () => {
		const setup = createClient([
			{},
			{ constructorError: new Error('automatic failed') },
			{},
		]);
		setup.factory.latest.open();
		setup.factory.latest.peerClose();
		expect(() =>
			vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0]),
		).not.toThrow();
		expect(setup.factory.attempts).toHaveLength(2);
		expect(setup.states.at(-1)).toBe('backoff');
		expect(setup.events.reconnect).not.toHaveBeenCalled();
		vi.advanceTimersByTime(RECONNECT_DELAYS_MS[1]);
		expect(setup.factory.attempts).toHaveLength(3);
		expect(setup.events.reconnect).toHaveBeenCalledOnce();
	});

	it('uses identity-owned construction attempts during factory reentry', () => {
		const setup = createClient();
		setup.factory.latest.open();
		setup.clientMethods.close();
		setup.factory.enqueue({
			onConstruct: () => setup.clientMethods.close(),
		});

		setup.clientMethods.open();
		const discarded = setup.factory.latest;
		expect(discarded.closeCalls).toEqual([
			{
				code: NORMAL_CLOSE_CODE,
				reason: 'connection attempt was superseded',
			},
		]);
		expect(setup.states.at(-1)).toBe('stopped');
	});

	it('discards a provisional socket superseded during handler installation', () => {
		const setup = createClient();
		setup.factory.latest.open();
		setup.clientMethods.close();
		let reentered = false;
		setup.factory.enqueue({
			onHandlerInstalled: () => {
				if (!reentered) {
					reentered = true;
					setup.clientMethods.close();
				}
			},
		});

		setup.clientMethods.open();
		expect(setup.factory.latest.closeCalls).toHaveLength(1);
		expect(setup.states.at(-1)).toBe('stopped');
	});
});

describe('transactional GET and SET', () => {
	it('returns a rejected Promise when GET is unavailable', async () => {
		const setup = createClient();
		setup.clientMethods.close();

		const result = setup.client['/counter'].get();
		expect(result).toBeInstanceOf(Promise);
		await expect(result).rejects.toEqual(errorCode('SMOLRPC_UNAVAILABLE'));
	});

	it('cleans GET timeouts and native send failures with stable codes', async () => {
		const timeoutSetup = createClient();
		timeoutSetup.factory.latest.open();
		const timedOut = timeoutSetup.client['/counter'].get();
		vi.advanceTimersByTime(OPERATION_TIMEOUT_MS);
		await expect(timedOut).rejects.toEqual(errorCode('SMOLRPC_TIMEOUT'));

		const sendSetup = createClient([{ sendError: new Error('secret') }]);
		sendSetup.factory.latest.open();
		await expect(sendSetup.client['/counter'].get()).rejects.toEqual(
			errorCode('SMOLRPC_SEND_FAILED'),
		);
	});

	it('lets a valid synchronous GET response win over send unwind', async () => {
		const setup = createClient([
			{
				onSend(socket, data) {
					const request = JSON.parse(data) as Frame;
					socket.message({
						data: 44,
						id: request.id,
						resource: request.resource,
						type: 'GetResponse',
					});
				},
				sendError: new Error('after response'),
			},
		]);
		setup.factory.latest.open();
		await expect(setup.client['/counter'].get()).resolves.toBe(44);
	});

	it('binds a connecting SET waiter to only its captured generation', async () => {
		const setup = createClient();
		const owner = setup.factory.latest;
		const result = setup.client['/counter/set'].set({ request: 1 });
		const rejected = expect(result).rejects.toEqual(
			errorCode('SMOLRPC_UNAVAILABLE'),
		);
		setup.clientMethods.close();
		setup.clientMethods.open();
		const replacement = setup.factory.latest;
		replacement.open();

		await rejected;
		expect(owner.sent).toHaveLength(0);
		expect(replacement.sent).toHaveLength(0);
	});

	it('revalidates SET ownership after application code runs in serialization', async () => {
		const setup = createClient();
		setup.factory.latest.open();
		const request = {
			toJSON() {
				setup.clientMethods.close();
				return 1;
			},
		};
		const result = (setup.client['/counter/set'].set as any)({ request });
		await expect(result).rejects.toEqual(errorCode('SMOLRPC_UNAVAILABLE'));
		vi.advanceTimersByTime(OPERATION_TIMEOUT_MS);
		expect(setup.factory.latest.sent).toHaveLength(0);
	});

	it('reports unknown mutation outcome after accepted SET timeout', async () => {
		const setup = createClient();
		setup.factory.latest.open();
		const result = setup.client['/counter/set'].set({ request: 3 });
		vi.advanceTimersByTime(OPERATION_TIMEOUT_MS);
		await expect(result).rejects.toEqual(
			errorCode('SMOLRPC_MUTATION_OUTCOME_UNKNOWN'),
		);
	});

	it.each([
		{ throws: false, code: 'SMOLRPC_MUTATION_OUTCOME_UNKNOWN' },
		{ throws: true, code: 'SMOLRPC_SEND_FAILED' },
	])(
		'classifies synchronous SET retirement after native send (throws=$throws)',
		async ({ throws, code }) => {
			let closeClient = () => {};
			const setup = createClient([
				{
					onSend: () => closeClient(),
					...(throws ? { sendError: new Error('send failed') } : {}),
				},
			]);
			closeClient = setup.clientMethods.close;
			setup.factory.latest.open();
			await expect(
				setup.client['/counter/set'].set({ request: 5 }),
			).rejects.toEqual(errorCode(code));
		},
	);

	it('prevents native send when the public send hook closes the generation', async () => {
		const setup = createClient();
		const socket = setup.factory.latest;
		socket.open();
		setup.events.send.mockImplementation(() => setup.clientMethods.close());
		const result = setup.client['/counter'].get();

		await expect(result).rejects.toEqual(errorCode('SMOLRPC_UNAVAILABLE'));
		expect(socket.sendAttempts).toHaveLength(0);
	});
});

describe('generation-owned subscriptions and dispatch', () => {
	it('retains subscriptions across events and replays undefined', () => {
		const setup = createClient();
		const socket = setup.factory.latest;
		socket.open();
		const subscription = setup.client['/counter'].subscribe();
		const firstNext = vi.fn();
		subscription.subscribe({ next: firstNext });
		const [request] = frames(socket);
		socket.message({
			data: undefined,
			id: request.id,
			resource: request.resource,
			type: 'SubscribeEvent',
		});
		socket.message({
			data: 2,
			id: request.id,
			resource: request.resource,
			type: 'SubscribeEvent',
		});
		expect(firstNext).toHaveBeenCalledTimes(2);

		const replayUndefined = setup.client['/counter'].subscribe();
		const replay = vi.fn();
		// Replay the latest value, then prove an explicit undefined is also replayable.
		replayUndefined.subscribe({ next: replay });
		expect(replay).toHaveBeenLastCalledWith(2);
		socket.message({
			data: undefined,
			id: request.id,
			resource: request.resource,
			type: 'SubscribeEvent',
		});
		const afterUndefined = vi.fn();
		replayUndefined.subscribe({ next: afterUndefined });
		expect(afterUndefined).toHaveBeenCalledWith(undefined);
	});

	it('revalidates subscription construction after cache-key serialization', () => {
		const setup = createClient();
		setup.factory.latest.open();
		const request = {
			toJSON() {
				setup.clientMethods.close();
				return 1;
			},
		};
		expect(() =>
			(setup.client['/counter'].subscribe as any)({ request }),
		).toThrowError(
			expect.objectContaining({ code: 'SMOLRPC_UNAVAILABLE' }),
		);
		expect(setup.factory.latest.sent).toHaveLength(0);
	});

	it('does not strand observers when accept is followed by retirement and send throw', () => {
		let closeClient = () => {};
		const setup = createClient([
			{
				onSend(socket, data) {
					const frame = JSON.parse(data) as Frame;
					if (frame.type === 'SubscribeRequest') {
						socket.message({
							id: frame.id,
							resource: frame.resource,
							type: 'SubscribeAccept',
						});
						closeClient();
					}
				},
				sendError: new Error('send failed'),
			},
		]);
		closeClient = setup.clientMethods.close;
		setup.factory.latest.open();
		const observerError = vi.fn();
		setup.client['/counter']
			.subscribe()
			.subscribe({ error: observerError });
		expect(observerError).toHaveBeenCalledOnce();
		expect(observerError).toHaveBeenCalledWith(
			errorCode('SMOLRPC_SEND_FAILED'),
		);
	});

	it('isolates throwing observers and terminalizes on retirement', () => {
		const setup = createClient();
		const socket = setup.factory.latest;
		socket.open();
		const subscription = setup.client['/counter'].subscribe();
		const error = vi.fn();
		subscription.subscribe({
			next: () => {
				throw new Error('observer failed');
			},
			error,
		});
		const healthy = vi.fn();
		subscription.subscribe({ next: healthy, error });
		const [request] = frames(socket);
		socket.message({
			data: 8,
			id: request.id,
			resource: request.resource,
			type: 'SubscribeEvent',
		});
		expect(healthy).toHaveBeenCalledWith(8);
		expect(setup.reportInternalError).toHaveBeenCalled();

		setup.clientMethods.close();
		expect(error).toHaveBeenCalledTimes(2);
		expect(error.mock.calls[0][0]).toEqual(
			errorCode('SMOLRPC_UNAVAILABLE'),
		);
		const lateError = vi.fn();
		subscription.subscribe({ error: lateError });
		expect(lateError).toHaveBeenCalledWith(
			errorCode('SMOLRPC_UNAVAILABLE'),
		);
	});

	it('throws a typed unavailable error before constructing a subscription', () => {
		const setup = createClient();
		setup.clientMethods.close();
		expect(() => setup.client['/counter'].subscribe()).toThrowError(
			SmolRpcError,
		);
		try {
			setup.client['/counter'].subscribe();
		} catch (error) {
			expect(error).toEqual(errorCode('SMOLRPC_UNAVAILABLE'));
		}
	});

	it('treats duplicate subscriptions of one observer as independent handles', () => {
		const setup = createClient();
		const socket = setup.factory.latest;
		socket.open();
		const subscription = setup.client['/counter'].subscribe();
		const observer = { next: vi.fn() };
		const first = subscription.subscribe(observer);
		const second = subscription.subscribe(observer);
		first.unsubscribe();
		expect(
			frames(socket).filter(
				(frame) => frame.type === 'UnsubscribeRequest',
			),
		).toHaveLength(0);
		second.unsubscribe();
		expect(
			frames(socket).filter(
				(frame) => frame.type === 'UnsubscribeRequest',
			),
		).toHaveLength(1);
	});

	it('uses idempotent handles and bounds unsubscribe acknowledgements', () => {
		const setup = createClient();
		const socket = setup.factory.latest;
		socket.open();
		const subscription = setup.client['/counter'].subscribe();
		const handle = subscription.subscribe({ next: vi.fn() });
		handle.unsubscribe();
		handle.unsubscribe();
		expect(
			frames(socket).filter(
				(frame) => frame.type === 'UnsubscribeRequest',
			),
		).toHaveLength(1);

		const diagnosticsBefore = setup.reportInternalError.mock.calls.length;
		vi.advanceTimersByTime(OPERATION_TIMEOUT_MS);
		expect(setup.reportInternalError.mock.calls.length).toBe(
			diagnosticsBefore + 1,
		);
	});

	it('registers unsubscribe acknowledgement before native send', () => {
		const setup = createClient([
			{
				onSend(socket, data) {
					const frame = JSON.parse(data) as Frame;
					if (frame.type === 'UnsubscribeRequest') {
						socket.message({
							id: frame.id,
							resource: frame.resource,
							type: 'UnsubscribeAccept',
						});
					}
				},
			},
		]);
		const socket = setup.factory.latest;
		socket.open();
		const handle = setup.client['/counter']
			.subscribe()
			.subscribe({ next: vi.fn() });
		handle.unsubscribe();
		vi.advanceTimersByTime(OPERATION_TIMEOUT_MS);
		expect(setup.reportInternalError).not.toHaveBeenCalled();
	});

	it('silently discards a deferred acknowledgement error on retirement', () => {
		let closeClient = () => {};
		const setup = createClient([
			{
				onSend(socket, data) {
					const frame = JSON.parse(data) as Frame;
					if (frame.type === 'UnsubscribeRequest') {
						socket.message({
							id: frame.id,
							resource: '/wrong',
							type: 'UnsubscribeAccept',
						});
						closeClient();
					}
				},
			},
		]);
		closeClient = setup.clientMethods.close;
		setup.factory.latest.open();
		const handle = setup.client['/counter']
			.subscribe()
			.subscribe({ next: vi.fn() });
		handle.unsubscribe();
		expect(setup.reportInternalError).not.toHaveBeenCalled();
	});

	it('diagnoses unaddressable frames and fails only addressed operations', async () => {
		const setup = createClient();
		const socket = setup.factory.latest;
		socket.open();
		socket.message('{not json');
		socket.message({ type: 'Reject', error: 'global' });
		expect(setup.reportInternalError).toHaveBeenCalledTimes(2);

		const first = setup.client['/counter'].get();
		const second = setup.client['/reject'].get();
		const [firstRequest, secondRequest] = frames(socket);
		socket.message({ id: firstRequest.id });
		await expect(first).rejects.toEqual(
			errorCode('SMOLRPC_PROTOCOL_ERROR'),
		);
		socket.message({
			data: 'ok',
			id: secondRequest.id,
			resource: secondRequest.resource,
			type: 'GetResponse',
		});
		await expect(second).resolves.toBe('ok');
	});

	it('maps accepted SET protocol failures to unknown mutation outcome', async () => {
		const setup = createClient();
		const socket = setup.factory.latest;
		socket.open();
		const result = setup.client['/counter/set'].set({ request: 9 });
		const [request] = frames(socket);
		socket.message({
			id: request.id,
			resource: '/wrong',
			type: 'SetSuccess',
		});
		await expect(result).rejects.toEqual(
			errorCode('SMOLRPC_MUTATION_OUTCOME_UNKNOWN'),
		);
	});
});
