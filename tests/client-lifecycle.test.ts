import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SmolRpcError } from '../index.js';
import { OPERATION_TIMEOUT_MS } from '../src/init-client-proxy.js';
import { RECONNECT_DELAYS_MS } from '../src/init-client-websocket.js';
import { createClient, frames } from './client-test-helpers.ts';

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
	it('drops all stale callbacks without disturbing fresh replacement work', async () => {
		const setup = createClient();
		const retired = setup.factory.latest;
		retired.open();
		setup.clientMethods.close();
		setup.clientMethods.open();
		const replacement = setup.factory.latest;
		replacement.open();
		const pending = setup.client['/counter'].get();
		const request = frames(replacement).at(-1);
		if (request == null) throw new Error('missing replacement request');
		const hooks = {
			close: setup.events.close.mock.calls.length,
			error: setup.events.error.mock.calls.length,
			message: setup.events.message.mock.calls.length,
			open: setup.events.open.mock.calls.length,
		};
		const states = [...setup.states];
		const attempts = setup.factory.attempts.length;
		const sendAttempts = replacement.sendAttempts.length;
		const timers = vi.getTimerCount();
		const diagnostics = setup.reportInternalError.mock.calls.length;

		retired.open();
		retired.message({
			data: 1,
			id: request.id,
			resource: request.resource,
			type: 'GetResponse',
		});
		retired.error();
		retired.peerClose();
		expect(setup.events.open).toHaveBeenCalledTimes(hooks.open);
		expect(setup.events.message).toHaveBeenCalledTimes(hooks.message);
		expect(setup.events.error).toHaveBeenCalledTimes(hooks.error);
		expect(setup.events.close).toHaveBeenCalledTimes(hooks.close);
		expect(setup.states).toEqual(states);
		expect(setup.factory.attempts).toHaveLength(attempts);
		expect(replacement.sendAttempts).toHaveLength(sendAttempts);
		expect(vi.getTimerCount()).toBe(timers);
		expect(setup.reportInternalError).toHaveBeenCalledTimes(diagnostics);

		replacement.message({
			data: 2,
			id: request.id,
			resource: request.resource,
			type: 'GetResponse',
		});
		await expect(pending).resolves.toBe(2);
	});

	it('advances and caps backoff, then resets it after open', () => {
		const failure = () => ({ constructorError: new Error('failed') });
		const setup = createClient([
			{},
			failure(),
			failure(),
			failure(),
			failure(),
			failure(),
			{},
			{},
		]);
		setup.factory.latest.open();
		setup.factory.latest.peerClose();

		const delays = [1_000, 2_000, 5_000, 10_000, 10_000, 10_000];
		for (const [index, delay] of delays.entries()) {
			vi.advanceTimersByTime(delay - 1);
			expect(setup.factory.attempts).toHaveLength(index + 1);
			vi.advanceTimersByTime(1);
			expect(setup.factory.attempts).toHaveLength(index + 2);
		}
		expect(setup.events.reconnect).toHaveBeenCalledOnce();

		setup.factory.latest.open();
		setup.factory.latest.peerClose();
		vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0] - 1);
		expect(setup.factory.attempts).toHaveLength(7);
		vi.advanceTimersByTime(1);
		expect(setup.factory.attempts).toHaveLength(8);
	});

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

	it.each(['explicit', 'automatic'] as const)(
		'contains a %s attempt whose socket rejects handler installation',
		(kind) => {
			const failure = new Error('handler installation failed');
			const plan = {
				onHandlerInstalled(_socket: unknown, handler: string) {
					if (handler === 'message') throw failure;
				},
			};
			const setup =
				kind === 'explicit' ? createClient() : createClient([{}, plan]);
			setup.factory.latest.open();
			if (kind === 'explicit') {
				setup.clientMethods.close();
				setup.factory.enqueue(plan);
				setup.states.length = 0;
				expect(() => setup.clientMethods.open()).toThrow(failure);
				expect(setup.states).toEqual(['connecting', 'stopped']);
				expect(setup.reportInternalError).not.toHaveBeenCalled();
			} else {
				setup.states.length = 0;
				setup.factory.latest.peerClose();
				vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0]);
				expect(setup.states).toEqual([
					'unavailable',
					'backoff',
					'connecting',
					'backoff',
				]);
				expect(setup.reportInternalError).toHaveBeenCalledOnce();
				expect(setup.reportInternalError).toHaveBeenCalledWith(
					expect.stringContaining('handler installation failed'),
					expect.anything(),
				);
				expect(setup.events.reconnect).not.toHaveBeenCalled();
			}
			const broken = setup.factory.latest;
			expect(setup.factory.attempts).toHaveLength(2);
			expect(broken.closeCalls).toHaveLength(1);

			// The partially installed open handler must be stale.
			const states = [...setup.states];
			broken.open();
			expect(setup.states).toEqual(states);
			expect(setup.events.open).toHaveBeenCalledOnce();

			if (kind === 'explicit') {
				vi.advanceTimersByTime(20_000);
				expect(setup.factory.attempts).toHaveLength(2);
				return;
			}
			vi.advanceTimersByTime(RECONNECT_DELAYS_MS[1]);
			expect(setup.factory.attempts).toHaveLength(3);
			setup.factory.latest.open();
			expect(setup.states.at(-1)).toBe('open');
			expect(setup.events.reconnect).toHaveBeenCalledOnce();
		},
	);

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
