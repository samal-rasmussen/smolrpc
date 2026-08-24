import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClientTransportState, ClientWebSocketEvents } from '../index.js';
import { initClient, SmolRpcError } from '../index.js';
import { OPERATION_TIMEOUT_MS } from '../src/init-client-proxy.js';
import { RECONNECT_DELAYS_MS } from '../src/init-client-websocket.js';
import {
	type ControlledSocketPlan,
	ControlledWebSocket,
	ControlledWebSocketFactory,
} from './controlled-websocket.ts';
import type { Resources } from './resources.ts';

type Frame = {
	data?: unknown;
	id: number;
	resource: string;
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

beforeEach(() => {
	vi.useFakeTimers();
	vi.spyOn(Math, 'random').mockReturnValue(0.5);
});

afterEach(() => {
	vi.clearAllTimers();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe('recovery lifecycle methods', () => {
	it('restarts an open generation immediately without a stopped transition', () => {
		const setup = createClient();
		const oldSocket = setup.factory.latest;
		oldSocket.open();
		setup.states.length = 0;

		setup.clientMethods.restart();

		expect(setup.states).toEqual(['unavailable', 'connecting']);
		expect(setup.factory.sockets).toHaveLength(2);
		expect(oldSocket.closeCalls).toEqual([
			{ code: 1000, reason: 'restart was called' },
		]);
		expect(setup.events.reconnect).not.toHaveBeenCalled();
		setup.factory.latest.open();
		expect(setup.states).toEqual(['unavailable', 'connecting', 'open']);
	});

	it('keeps restart stopped until a later explicit open', () => {
		const setup = createClient();
		setup.factory.latest.open();
		setup.clientMethods.close();
		const attempts = setup.factory.attempts.length;
		setup.states.length = 0;

		setup.clientMethods.restart();
		setup.clientMethods.invalidate();
		vi.advanceTimersByTime(20_000);

		expect(setup.factory.attempts).toHaveLength(attempts);
		expect(setup.states).toEqual([]);
		setup.clientMethods.open();
		expect(setup.factory.attempts).toHaveLength(attempts + 1);
		expect(setup.states).toEqual(['connecting']);
	});

	it('invalidates into one preserved backoff timer and restart bypasses it', () => {
		const setup = createClient();
		const oldSocket = setup.factory.latest;
		oldSocket.open();
		setup.states.length = 0;

		setup.clientMethods.invalidate();
		setup.clientMethods.invalidate();
		setup.clientMethods.open();
		expect(setup.states).toEqual(['unavailable', 'backoff']);
		expect(setup.factory.sockets).toHaveLength(1);
		vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0] - 1);
		expect(setup.factory.sockets).toHaveLength(1);

		setup.clientMethods.restart();
		expect(setup.factory.sockets).toHaveLength(2);
		expect(setup.states).toEqual(['unavailable', 'backoff', 'connecting']);
		vi.advanceTimersByTime(20_000);
		expect(setup.factory.sockets).toHaveLength(2);
		expect(setup.events.reconnect).not.toHaveBeenCalled();
	});

	it('contains an immediate restart constructor failure and retries normally', () => {
		const failure = new Error('replacement constructor failed');
		const setup = createClient([{}, { constructorError: failure }, {}]);
		setup.factory.latest.open();
		setup.states.length = 0;

		expect(() => setup.clientMethods.restart()).not.toThrow();
		expect(setup.states).toEqual(['unavailable', 'connecting', 'backoff']);
		expect(setup.reportInternalError).toHaveBeenCalledOnce();
		expect(setup.events.reconnect).not.toHaveBeenCalled();

		vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0]);
		expect(setup.factory.attempts).toHaveLength(3);
		expect(setup.events.reconnect).toHaveBeenCalledOnce();
	});

	it('supersedes construction attempts during invalidate and sequential restart', () => {
		let invalidate = () => {};
		let restart = () => {};
		const setup = createClient();
		setup.factory.latest.open();
		invalidate = setup.clientMethods.invalidate;
		restart = setup.clientMethods.restart;

		setup.factory.enqueue({ onConstruct: () => invalidate() });
		setup.clientMethods.restart();
		const invalidatedAttempt = setup.factory.latest;
		expect(invalidatedAttempt.closeCalls).toHaveLength(1);
		expect(setup.states.at(-1)).toBe('backoff');

		setup.factory.enqueue({ onConstruct: () => restart() }).enqueue({});
		setup.clientMethods.restart();
		const supersededSocket = setup.factory.attempts.at(-2);
		const winningSocket = setup.factory.attempts.at(-1);
		expect(supersededSocket?.closeCalls).toHaveLength(1);
		expect(winningSocket?.closeCalls).toHaveLength(0);
		if (winningSocket == null) throw new Error('missing winning socket');
		winningSocket.open();
		expect(setup.states.at(-1)).toBe('open');
	});

	it('honors lifecycle reentry from unavailable without suppressing settlements', async () => {
		const setup = createClient();
		setup.factory.latest.open();
		const pending = setup.client['/counter'].get();
		setup.events.statechange.mockImplementation((state) => {
			setup.states.push(state);
			if (state === 'unavailable') setup.clientMethods.close();
		});
		setup.states.length = 0;

		setup.clientMethods.restart();

		await expect(pending).rejects.toMatchObject({
			code: 'SMOLRPC_UNAVAILABLE',
		});
		expect(setup.states).toEqual(['unavailable', 'stopped']);
		expect(setup.factory.sockets).toHaveLength(1);
	});

	it('publishes exact close and unexpected-close state sequences', () => {
		const deliberate = createClient();
		const retiredSocket = deliberate.factory.latest;
		retiredSocket.open();
		deliberate.states.length = 0;
		deliberate.clientMethods.close();
		expect(deliberate.states).toEqual(['unavailable', 'stopped']);
		const closeHooks = deliberate.events.close.mock.calls.length;
		retiredSocket.peerClose();
		expect(deliberate.states).toEqual(['unavailable', 'stopped']);
		expect(deliberate.events.close).toHaveBeenCalledTimes(closeHooks);

		const unexpected = createClient();
		unexpected.factory.latest.open();
		unexpected.states.length = 0;
		unexpected.factory.latest.peerClose();
		expect(unexpected.states).toEqual(['unavailable', 'backoff']);
		vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0]);
		expect(unexpected.states).toEqual([
			'unavailable',
			'backoff',
			'connecting',
		]);
		unexpected.factory.latest.open();
		expect(unexpected.states.at(-1)).toBe('open');
	});

	it('supersedes construction into stopped or backoff without unavailable', () => {
		const setup = createClient();
		setup.factory.latest.open();
		setup.clientMethods.close();

		setup.factory.enqueue({
			onConstruct: () => setup.clientMethods.close(),
		});
		setup.states.length = 0;
		setup.clientMethods.open();
		expect(setup.states).toEqual(['connecting', 'stopped']);
		expect(setup.factory.latest.closeCalls).toHaveLength(1);

		setup.factory.enqueue({
			onConstruct: () => setup.clientMethods.invalidate(),
		});
		setup.states.length = 0;
		setup.clientMethods.open();
		expect(setup.states).toEqual(['connecting', 'backoff']);
		expect(setup.factory.latest.closeCalls).toHaveLength(1);
	});

	it('rethrows an explicit-open constructor failure and stays stopped', () => {
		const setup = createClient();
		setup.factory.latest.open();
		setup.clientMethods.close();
		const failure = new Error('explicit open failed');
		setup.factory.enqueue({ constructorError: failure });
		setup.states.length = 0;

		expect(() => setup.clientMethods.open()).toThrow(failure);
		expect(setup.states).toEqual(['connecting', 'stopped']);
		vi.advanceTimersByTime(20_000);
		expect(setup.factory.attempts).toHaveLength(2);
	});

	it('revalidates recovery after raw and diagnostic callback reentry', () => {
		const closeSetup = createClient();
		closeSetup.factory.latest.open();
		closeSetup.events.close.mockImplementation(() =>
			closeSetup.clientMethods.restart(),
		);
		closeSetup.states.length = 0;
		closeSetup.factory.latest.peerClose();
		expect(closeSetup.states).toEqual([
			'unavailable',
			'backoff',
			'connecting',
		]);
		expect(closeSetup.factory.sockets).toHaveLength(2);

		const errorSetup = createClient();
		errorSetup.factory.latest.open();
		errorSetup.events.error.mockImplementation(() =>
			errorSetup.clientMethods.restart(),
		);
		errorSetup.states.length = 0;
		errorSetup.factory.latest.error();
		expect(errorSetup.states).toEqual(['unavailable', 'connecting']);
		expect(errorSetup.factory.sockets).toHaveLength(2);

		const diagnosticSetup = createClient([
			{},
			{ constructorError: new Error('restart failed') },
		]);
		diagnosticSetup.factory.latest.open();
		diagnosticSetup.reportInternalError.mockImplementation(() =>
			diagnosticSetup.clientMethods.close(),
		);
		diagnosticSetup.states.length = 0;
		diagnosticSetup.clientMethods.restart();
		expect(diagnosticSetup.states).toEqual([
			'unavailable',
			'connecting',
			'stopped',
		]);
		vi.advanceTimersByTime(20_000);
		expect(diagnosticSetup.factory.attempts).toHaveLength(2);
	});
});

describe('application-owned lifecycle-root recovery', () => {
	it('recovers timeout through invalidate without replaying old work', async () => {
		const setup = createClient();
		const oldSocket = setup.factory.latest;
		oldSocket.open();
		const oldObserverError = vi.fn();
		setup.client['/counter']
			.subscribe()
			.subscribe({ error: oldObserverError, next: vi.fn() });
		const firstRoot = setup.client['/counter'].get();
		const secondRoot = setup.client['/counter'].get();
		const oldFrames = frames(oldSocket);
		setup.states.length = 0;

		const recover = async (root: Promise<number>) => {
			try {
				await root;
			} catch (error) {
				expect(error).toBeInstanceOf(SmolRpcError);
				expect(error).toMatchObject({ code: 'SMOLRPC_TIMEOUT' });
				setup.clientMethods.invalidate();
			}
		};
		const recoveries = [recover(firstRoot), recover(secondRoot)];
		vi.advanceTimersByTime(OPERATION_TIMEOUT_MS);
		await Promise.all(recoveries);

		expect(setup.states).toEqual(['unavailable', 'backoff']);
		expect(setup.factory.sockets).toHaveLength(1);
		expect(oldObserverError).toHaveBeenCalledOnce();
		vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0] - 1);
		expect(setup.factory.sockets).toHaveLength(1);
		vi.advanceTimersByTime(1);
		const replacement = setup.factory.latest;
		expect(setup.factory.sockets).toHaveLength(2);
		expect(setup.states).toEqual(['unavailable', 'backoff', 'connecting']);
		replacement.open();
		expect(setup.states).toEqual([
			'unavailable',
			'backoff',
			'connecting',
			'open',
		]);
		expect(replacement.sent).toHaveLength(0);

		const rebuiltRoot = setup.client['/counter'].get();
		const rebuiltNext = vi.fn();
		setup.client['/counter'].subscribe().subscribe({ next: rebuiltNext });
		const [rootRequest, subscriptionRequest] = frames(replacement);

		// Old generation callbacks are stale even when request IDs are reused.
		oldSocket.message({
			data: 999,
			id: oldFrames[0].id,
			resource: '/counter',
			type: 'SubscribeEvent',
		});
		oldSocket.message({
			data: 999,
			id: oldFrames[1].id,
			resource: '/counter',
			type: 'GetResponse',
		});
		expect(rebuiltNext).not.toHaveBeenCalled();

		replacement.message({
			data: 12,
			id: rootRequest.id,
			resource: rootRequest.resource,
			type: 'GetResponse',
		});
		replacement.message({
			id: subscriptionRequest.id,
			resource: subscriptionRequest.resource,
			type: 'SubscribeAccept',
		});
		replacement.message({
			data: 13,
			id: subscriptionRequest.id,
			resource: subscriptionRequest.resource,
			type: 'SubscribeEvent',
		});

		await expect(rebuiltRoot).resolves.toBe(12);
		expect(rebuiltNext).toHaveBeenCalledWith(13);
	});
});
