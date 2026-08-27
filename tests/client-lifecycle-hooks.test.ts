import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
	it.each([
		'statechange',
		'open',
		'message',
		'send',
		'error',
		'close',
		'reconnect',
	] as const)(
		'isolates a throwing %s hook and preserves continuation',
		async (hook) => {
			const consoleError = vi
				.spyOn(console, 'error')
				.mockImplementation(() => {});
			const setup = createClient([{}, {}]);
			const firstSocket = setup.factory.latest;
			setup.events[hook].mockImplementation(() => {
				throw new Error(`${hook} failed`);
			});

			if (hook === 'statechange') {
				setup.clientMethods.close();
				setup.clientMethods.open();
				setup.factory.latest.open();
			} else if (hook === 'open') {
				firstSocket.open();
			} else if (hook === 'message') {
				firstSocket.open();
				firstSocket.message('{');
			} else if (hook === 'send') {
				firstSocket.open();
				const pending = setup.client['/counter'].get();
				const request = frames(firstSocket).at(-1);
				if (request == null) {
					throw new Error('missing request');
				}
				firstSocket.message({
					data: 1,
					id: request.id,
					resource: request.resource,
					type: 'GetResponse',
				});
				await expect(pending).resolves.toBe(1);
			} else if (hook === 'error') {
				firstSocket.open();
				firstSocket.error();
			} else if (hook === 'close') {
				firstSocket.open();
				firstSocket.peerClose();
				setup.clientMethods.restart();
				setup.factory.latest.open();
			} else {
				firstSocket.open();
				firstSocket.peerClose();
				vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0]);
				setup.factory.latest.open();
			}

			expect(consoleError).toHaveBeenCalledWith(
				expect.stringContaining(`webSocketEvents.${hook} hook threw`),
				expect.objectContaining({ error: expect.any(Error) }),
			);
			if (setup.states.at(-1) !== 'open') {
				setup.factory.latest.open();
			}
			const socket = setup.factory.latest;
			const fresh = setup.client['/counter'].get();
			const request = frames(socket).at(-1);
			if (request == null) {
				throw new Error('missing fresh request');
			}
			socket.message({
				data: 2,
				id: request.id,
				resource: request.resource,
				type: 'GetResponse',
			});
			await expect(fresh).resolves.toBe(2);
		},
	);

	it('isolates a throwing internal diagnostic callback', async () => {
		const consoleError = vi
			.spyOn(console, 'error')
			.mockImplementation(() => {});
		const setup = createClient();
		const socket = setup.factory.latest;
		socket.open();
		setup.reportInternalError.mockImplementation(() => {
			throw new Error('diagnostic failed');
		});
		socket.message('{');
		expect(consoleError).toHaveBeenCalledWith(
			expect.stringContaining('reportInternalError hook threw'),
			expect.objectContaining({ error: expect.any(Error) }),
		);

		const result = setup.client['/counter'].get();
		const request = frames(socket).at(-1);
		if (request == null) {
			throw new Error('missing request');
		}
		socket.message({
			data: 3,
			id: request.id,
			resource: request.resource,
			type: 'GetResponse',
		});
		await expect(result).resolves.toBe(3);
	});

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
		if (winningAttempt == null) {
			throw new Error('missing winning attempt');
		}
		winningAttempt.open();
		expect(restartDuringConstruction.states).toEqual([
			'connecting',
			'open',
		]);
	});

	it('detaches before unavailable, then rejects SET and subscription', async () => {
		const consoleError = vi
			.spyOn(console, 'error')
			.mockImplementation(() => {});
		const setup = createClient();
		const socket = setup.factory.latest;
		socket.open();
		const order: string[] = [];
		const unavailableSendCounts: number[] = [];
		const subscription = setup.client['/counter'].subscribe();
		const handle = subscription.subscribe({
			error(error: SmolRpcError) {
				order.push(`subscription:${error.code}`);
			},
		});
		setup.events.statechange.mockImplementation((state) => {
			setup.states.push(state);
			order.push(`state:${state}`);
			if (state === 'unavailable') {
				unavailableSendCounts.push(socket.sendAttempts.length);
				handle.unsubscribe();
				unavailableSendCounts.push(socket.sendAttempts.length);
			}
		});
		const set = setup.client['/counter/set']
			.set({ request: 5 })
			.catch((error: SmolRpcError) => {
				order.push(`set:${error.code}`);
				throw error;
			});
		const sentBeforeRetirement = socket.sendAttempts.length;

		setup.clientMethods.close();
		await expect(set).rejects.toEqual(
			errorCode('SMOLRPC_MUTATION_OUTCOME_UNKNOWN'),
		);
		expect(unavailableSendCounts).toEqual([
			sentBeforeRetirement,
			sentBeforeRetirement,
		]);
		expect(
			frames(socket).filter(({ type }) => type === 'UnsubscribeRequest'),
		).toEqual([]);
		expect(order.indexOf('state:unavailable')).toBeLessThan(
			order.indexOf('subscription:SMOLRPC_UNAVAILABLE'),
		);
		expect(order.indexOf('state:unavailable')).toBeLessThan(
			order.indexOf('set:SMOLRPC_MUTATION_OUTCOME_UNKNOWN'),
		);
		expect(
			order.filter(
				(entry) => entry === 'subscription:SMOLRPC_UNAVAILABLE',
			),
		).toHaveLength(1);
		expect(
			order.filter(
				(entry) => entry === 'set:SMOLRPC_MUTATION_OUTCOME_UNKNOWN',
			),
		).toHaveLength(1);
		expect(consoleError).not.toHaveBeenCalled();
	});

	it.each([
		{ trigger: 'close', destination: 'stopped' },
		{ trigger: 'restart', destination: 'connecting' },
		{ trigger: 'invalidate', destination: 'backoff' },
		{ trigger: 'peerClose', destination: 'backoff' },
	] as const)(
		'publishes unavailable and $destination before settlements on $trigger',
		async ({ trigger, destination }) => {
			const setup = createClient();
			const socket = setup.factory.latest;
			socket.open();
			const order: string[] = [];
			const statesAtObserverError: string[][] = [];
			setup.events.statechange.mockImplementation((state) => {
				setup.states.push(state);
				order.push(`state:${state}`);
			});
			setup.events.close.mockImplementation(() => {
				order.push('close');
			});
			setup.client['/counter'].subscribe().subscribe({
				error(error: SmolRpcError) {
					order.push(`observer:${error.code}`);
					statesAtObserverError.push([...setup.states]);
				},
			});
			const set = setup.client['/counter/set']
				.set({ request: 1 })
				.catch((error: SmolRpcError) => {
					order.push(`set:${error.code}`);
					throw error;
				});
			setup.states.length = 0;

			if (trigger === 'peerClose') {
				socket.peerClose();
			} else {
				setup.clientMethods[trigger]();
			}
			await expect(set).rejects.toEqual(
				errorCode('SMOLRPC_MUTATION_OUTCOME_UNKNOWN'),
			);

			expect(order).toEqual([
				'state:unavailable',
				`state:${destination}`,
				...(trigger === 'peerClose' ? ['close'] : []),
				'observer:SMOLRPC_UNAVAILABLE',
				'set:SMOLRPC_MUTATION_OUTCOME_UNKNOWN',
			]);
			expect(statesAtObserverError).toEqual([
				['unavailable', destination],
			]);
		},
	);

	it.each([
		{
			at: 'unavailable',
			call: 'close',
			sockets: 1,
			states: ['unavailable', 'stopped'],
			trigger: 'restart',
		},
		{
			at: 'unavailable',
			call: 'restart',
			sockets: 2,
			states: ['unavailable', 'connecting'],
			trigger: 'restart',
		},
		{
			at: 'connecting',
			call: 'close',
			sockets: 1,
			states: ['unavailable', 'connecting', 'stopped'],
			trigger: 'restart',
		},
		{
			at: 'connecting',
			call: 'restart',
			sockets: 2,
			states: ['unavailable', 'connecting'],
			trigger: 'restart',
		},
		{
			at: 'open',
			call: 'close',
			sockets: 1,
			states: ['open', 'unavailable', 'stopped'],
			trigger: 'open',
		},
		{
			at: 'backoff',
			call: 'close',
			sockets: 1,
			states: ['unavailable', 'backoff', 'stopped'],
			trigger: 'peerClose',
		},
	] as const)(
		'honors $call reentry from statechange($at) during $trigger',
		async ({ at, call, sockets, states, trigger }) => {
			const setup = createClient();
			const socket = setup.factory.latest;
			if (trigger !== 'open') {
				socket.open();
			}
			const pending =
				trigger === 'open'
					? setup.client['/counter/set'].set({ request: 1 })
					: setup.client['/counter'].get();
			let reentered = false;
			setup.events.statechange.mockImplementation((state) => {
				setup.states.push(state);
				if (state !== at || reentered) {
					return;
				}
				reentered = true;
				setup.clientMethods[call]();
			});
			setup.states.length = 0;

			if (trigger === 'open') {
				socket.open();
			} else if (trigger === 'peerClose') {
				socket.peerClose();
			} else {
				setup.clientMethods.restart();
			}

			await expect(pending).rejects.toEqual(
				errorCode('SMOLRPC_UNAVAILABLE'),
			);
			expect(setup.states).toEqual(states);
			expect(setup.factory.attempts).toHaveLength(sockets);
			if (trigger === 'open') {
				expect(socket.sendAttempts).toHaveLength(0);
				expect(setup.events.open).not.toHaveBeenCalled();
			}
			expect(vi.getTimerCount()).toBe(0);
			vi.advanceTimersByTime(20_000);
			expect(setup.factory.attempts).toHaveLength(sockets);
			if (sockets === 2) {
				setup.factory.latest.open();
				expect(setup.states.at(-1)).toBe('open');
			}
		},
	);

	it.each(['close', 'restart', 'invalidate', 'unexpected'] as const)(
		'suppresses later native close after $route retirement',
		(route) => {
			const setup = createClient();
			const retiredSocket = setup.factory.latest;
			retiredSocket.open();
			if (route === 'unexpected') {
				retiredSocket.peerClose();
			} else {
				setup.clientMethods[route]();
			}
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
			if (winningAttempt == null) {
				throw new Error('missing winning attempt');
			}
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
});
