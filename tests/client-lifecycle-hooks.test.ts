import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
	ClientMethods,
	ClientTransportState,
	ClientWebSocketEvents,
	SmolRpcErrorCode,
	SmolRpcErrorMetadata,
} from '../index.js';
import { SmolRpcError } from '../index.js';
import { RECONNECT_DELAYS_MS } from '../src/init-client-websocket.js';
import { createClient, errorCode, frames } from './client-test-helpers.ts';

beforeEach(() => {
	vi.useFakeTimers();
	vi.spyOn(Math, 'random').mockReturnValue(0.5);
});

afterEach(() => {
	vi.clearAllTimers();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe('client lifecycle hooks and method matrix', () => {
	it('lifecycle changes in message and open hooks stop stale continuation', async () => {
		const messageSetup = createClient();
		const messageSocket = messageSetup.factory.latest;
		messageSocket.open();
		const pendingGet = messageSetup.client['/counter'].get();
		const [request] = frames(messageSocket);
		messageSetup.events.message.mockImplementationOnce(() =>
			messageSetup.clientMethods.restart(),
		);
		messageSocket.message({
			data: 9,
			id: request.id,
			resource: request.resource,
			type: 'GetResponse',
		});
		await expect(pendingGet).rejects.toEqual(
			errorCode('SMOLRPC_UNAVAILABLE'),
		);

		const openSetup = createClient();
		const owner = openSetup.factory.latest;
		const waitingSet = openSetup.client['/counter/set'].set({ request: 4 });
		openSetup.events.open.mockImplementationOnce(() =>
			openSetup.clientMethods.restart(),
		);
		owner.open();
		await expect(waitingSet).rejects.toEqual(
			errorCode('SMOLRPC_UNAVAILABLE'),
		);
		expect(owner.sendAttempts).toHaveLength(0);
	});

	it('publishes the full required logical transition sequences', () => {
		const initialization = createClient();
		expect(initialization.states).toEqual(['connecting']);
		initialization.factory.latest.open();
		expect(initialization.states).toEqual(['connecting', 'open']);
		initialization.states.length = 0;
		initialization.clientMethods.invalidate();
		expect(initialization.states).toEqual(['unavailable', 'backoff']);
		vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0]);
		expect(initialization.states).toEqual([
			'unavailable',
			'backoff',
			'connecting',
		]);
		initialization.factory.latest.open();
		expect(initialization.states.at(-1)).toBe('open');

		const restartDuringConstruction = createClient();
		restartDuringConstruction.factory.latest.open();
		restartDuringConstruction.clientMethods.close();
		let restart = () => {};
		restartDuringConstruction.factory
			.enqueue({
				onConstruct: () => restart(),
			})
			.enqueue({});
		restart = restartDuringConstruction.clientMethods.restart;
		restartDuringConstruction.states.length = 0;
		restartDuringConstruction.clientMethods.open();
		expect(restartDuringConstruction.states).toEqual(['connecting']);
		const winningAttempt =
			restartDuringConstruction.factory.attempts.at(-1);
		if (winningAttempt == null) throw new Error('missing winning attempt');
		winningAttempt.open();
		expect(restartDuringConstruction.states).toEqual([
			'connecting',
			'open',
		]);
	});

	it('detaches before unavailable, then rejects SET and subscription', async () => {
		const setup = createClient();
		const socket = setup.factory.latest;
		socket.open();
		const order: string[] = [];
		const subscription = setup.client['/counter'].subscribe();
		const handle = subscription.subscribe({
			error(error: SmolRpcError) {
				order.push(`subscription:${error.code}`);
			},
		});
		const sentBeforeRetirement = socket.sendAttempts.length;
		setup.events.statechange.mockImplementation((state) => {
			setup.states.push(state);
			order.push(`state:${state}`);
			if (state === 'unavailable') {
				handle.unsubscribe();
				expect(socket.sendAttempts).toHaveLength(sentBeforeRetirement);
			}
		});
		const set = setup.client['/counter/set']
			.set({ request: 5 })
			.catch((error: SmolRpcError) => {
				order.push(`set:${error.code}`);
				throw error;
			});

		setup.clientMethods.close();
		await expect(set).rejects.toEqual(
			errorCode('SMOLRPC_MUTATION_OUTCOME_UNKNOWN'),
		);
		expect(order.indexOf('state:unavailable')).toBeLessThan(
			order.indexOf('subscription:SMOLRPC_UNAVAILABLE'),
		);
		expect(order.indexOf('state:unavailable')).toBeLessThan(
			order.indexOf('set:SMOLRPC_MUTATION_OUTCOME_UNKNOWN'),
		);
	});

	it.each(['close', 'restart', 'invalidate', 'unexpected'] as const)(
		'suppresses later native close after $route retirement',
		(route) => {
			const setup = createClient();
			const retiredSocket = setup.factory.latest;
			retiredSocket.open();
			if (route === 'unexpected') retiredSocket.peerClose();
			else setup.clientMethods[route]();
			const states = [...setup.states];
			const closeHooks = setup.events.close.mock.calls.length;
			const attempts = setup.factory.attempts.length;

			retiredSocket.peerClose();
			expect(setup.states).toEqual(states);
			expect(setup.events.close).toHaveBeenCalledTimes(closeHooks);
			vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0] - 1);
			expect(setup.factory.attempts).toHaveLength(attempts);
		},
	);

	it('reconnect-hook lifecycle reentry creates no obsolete timer or attempt', () => {
		const setup = createClient([{}, {}]);
		setup.factory.latest.open();
		setup.events.reconnect.mockImplementation(() =>
			setup.clientMethods.close(),
		);
		setup.states.length = 0;
		setup.factory.latest.peerClose();
		vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0]);

		expect(setup.states).toEqual([
			'unavailable',
			'backoff',
			'connecting',
			'unavailable',
			'stopped',
		]);
		expect(setup.factory.attempts).toHaveLength(2);
		vi.advanceTimersByTime(20_000);
		expect(setup.factory.attempts).toHaveLength(2);
	});

	it.each(['close', 'open', 'restart'] as const)(
		'constructor diagnostic reentry via $action owns its continuation',
		(action) => {
			const setup = createClient([
				{},
				{ constructorError: new Error('replacement failed') },
				{},
			]);
			setup.factory.latest.open();
			setup.reportInternalError.mockImplementation(() =>
				setup.clientMethods[action](),
			);
			setup.clientMethods.restart();

			if (action === 'close') {
				expect(setup.states.at(-1)).toBe('stopped');
				vi.advanceTimersByTime(20_000);
				expect(setup.factory.attempts).toHaveLength(2);
			} else if (action === 'open') {
				expect(setup.states.at(-1)).toBe('backoff');
				vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0]);
				expect(setup.factory.attempts).toHaveLength(3);
			} else {
				expect(setup.states.at(-1)).toBe('connecting');
				expect(setup.factory.attempts).toHaveLength(3);
				vi.advanceTimersByTime(20_000);
				expect(setup.factory.attempts).toHaveLength(3);
			}
		},
	);

	it('limits reconnect to successful automatic-backoff publication', () => {
		const setup = createClient();
		setup.factory.latest.open();
		expect(setup.events.reconnect).not.toHaveBeenCalled();

		setup.clientMethods.restart();
		setup.factory.latest.open();
		expect(setup.events.reconnect).not.toHaveBeenCalled();

		setup.clientMethods.close();
		setup.clientMethods.open();
		setup.factory.latest.open();
		expect(setup.events.reconnect).not.toHaveBeenCalled();

		setup.factory.latest.peerClose();
		vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0]);
		expect(setup.events.reconnect).toHaveBeenCalledOnce();
	});

	it.each([{ throws: false }, { throws: true }])(
		'superseded automatic attempt never invokes reconnect (throws=$throws)',
		({ throws }) => {
			let restart = () => {};
			const setup = createClient([
				{},
				{
					constructorError: throws
						? new Error('stale failure')
						: undefined,
					onConstruct: () => restart(),
				},
				{},
			]);
			restart = setup.clientMethods.restart;
			setup.factory.latest.open();
			setup.factory.latest.peerClose();
			vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0]);

			expect(setup.factory.attempts).toHaveLength(3);
			expect(setup.events.reconnect).not.toHaveBeenCalled();
			expect(setup.reportInternalError).not.toHaveBeenCalled();
			const winningAttempt = setup.factory.attempts.at(-1);
			if (winningAttempt == null)
				throw new Error('missing winning attempt');
			expect(winningAttempt.closeCalls).toHaveLength(0);
		},
	);

	it('covers lifecycle matrix no-ops, repetition, and backoff commands', () => {
		const stopped = createClient();
		stopped.factory.latest.open();
		stopped.clientMethods.close();
		const stoppedAttempts = stopped.factory.attempts.length;
		stopped.states.length = 0;
		stopped.clientMethods.close();
		stopped.clientMethods.close();
		stopped.clientMethods.restart();
		stopped.clientMethods.invalidate();
		expect(stopped.states).toEqual([]);
		expect(stopped.factory.attempts).toHaveLength(stoppedAttempts);
		stopped.clientMethods.open();
		stopped.clientMethods.open();
		expect(stopped.factory.attempts).toHaveLength(stoppedAttempts + 1);

		const connecting = createClient();
		const firstConnecting = connecting.factory.latest;
		connecting.clientMethods.open();
		expect(connecting.factory.attempts).toHaveLength(1);
		connecting.clientMethods.restart();
		expect(firstConnecting.closeCalls).toHaveLength(1);
		expect(connecting.factory.attempts).toHaveLength(2);
		connecting.clientMethods.restart();
		expect(connecting.factory.attempts).toHaveLength(3);
		connecting.clientMethods.invalidate();
		connecting.clientMethods.invalidate();
		expect(connecting.states.at(-1)).toBe('backoff');
		vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0]);
		expect(connecting.factory.attempts).toHaveLength(4);

		const backoff = createClient();
		backoff.factory.latest.open();
		backoff.factory.latest.peerClose();
		const backoffAttempts = backoff.factory.attempts.length;
		backoff.clientMethods.open();
		backoff.clientMethods.invalidate();
		backoff.clientMethods.invalidate();
		vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0] - 1);
		expect(backoff.factory.attempts).toHaveLength(backoffAttempts);
		backoff.clientMethods.restart();
		expect(backoff.factory.attempts).toHaveLength(backoffAttempts + 1);
		vi.advanceTimersByTime(20_000);
		expect(backoff.factory.attempts).toHaveLength(backoffAttempts + 1);

		const closeBackoff = createClient();
		closeBackoff.factory.latest.open();
		closeBackoff.factory.latest.peerClose();
		closeBackoff.clientMethods.close();
		closeBackoff.clientMethods.close();
		vi.advanceTimersByTime(20_000);
		expect(closeBackoff.factory.attempts).toHaveLength(1);
	});

	it('exposes runtime and type-only package-root client API', () => {
		const code: SmolRpcErrorCode = 'SMOLRPC_UNAVAILABLE';
		const metadata: SmolRpcErrorMetadata = {
			generation: 1,
			operation: 'get',
			resource: '/counter',
		};
		const state: ClientTransportState = 'connecting';
		const statechange: NonNullable<ClientWebSocketEvents['statechange']> = (
			nextState,
		) => expect(nextState).toBe(state);
		statechange(state);
		expect(new SmolRpcError(code, 'unavailable', metadata)).toMatchObject({
			code,
			metadata,
		});

		const setup = createClient();
		const methods: ClientMethods = setup.clientMethods;
		expect(Object.keys(methods).sort()).toEqual([
			'close',
			'invalidate',
			'open',
			'restart',
		]);
	});
});
