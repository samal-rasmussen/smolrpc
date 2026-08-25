import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SmolRpcError } from '../index.js';
import {
	circularValue,
	createClient,
	errorCode,
	type Frame,
	frames,
} from './client-test-helpers.ts';
import type { ControlledSocketPlan } from './controlled-websocket.ts';

beforeEach(() => {
	vi.useFakeTimers();
	vi.spyOn(Math, 'random').mockReturnValue(0.5);
});

afterEach(() => {
	vi.clearAllTimers();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe('client subscriptions and protocol dispatch', () => {
	it('retains subscriptions across events and replays explicit undefined', () => {
		const setup = createClient();
		const socket = setup.factory.latest;
		socket.open();
		const subscription = setup.client['/counter'].subscribe();
		const firstNext = vi.fn();
		subscription.subscribe({ next: firstNext });
		const request = frames(socket).at(-1);
		if (request == null) throw new Error('missing request');
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
		const replay = vi.fn();
		subscription.subscribe({ next: replay });
		expect(replay).toHaveBeenLastCalledWith(2);
		socket.message({
			data: undefined,
			id: request.id,
			resource: request.resource,
			type: 'SubscribeEvent',
		});
		const afterUndefined = vi.fn();
		subscription.subscribe({ next: afterUndefined });
		expect(afterUndefined).toHaveBeenCalledWith(undefined);
	});

	it('treats duplicate registrations of one observer as independent handles', () => {
		const setup = createClient();
		const socket = setup.factory.latest;
		socket.open();
		const subscription = setup.client['/counter'].subscribe();
		const observer = { next: vi.fn() };
		const first = subscription.subscribe(observer);
		const second = subscription.subscribe(observer);
		first.unsubscribe();
		expect(
			frames(socket).filter(({ type }) => type === 'UnsubscribeRequest'),
		).toHaveLength(0);
		second.unsubscribe();
		expect(
			frames(socket).filter(({ type }) => type === 'UnsubscribeRequest'),
		).toHaveLength(1);
	});

	it('revalidates ownership after cache-key serialization reentry', () => {
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
		).toThrowError(errorCode('SMOLRPC_UNAVAILABLE'));
		expect(setup.factory.latest.sendAttempts).toHaveLength(0);
	});

	it('does not strand observers when accept precedes retirement and send throw', () => {
		let close = () => {};
		const setup = createClient([
			{
				onSend(socket, data) {
					const frame = JSON.parse(data) as Frame;
					if (frame.type !== 'SubscribeRequest') return;
					socket.message({
						id: frame.id,
						resource: frame.resource,
						type: 'SubscribeAccept',
					});
					close();
				},
				sendError: new Error('send failed'),
			},
		]);
		close = setup.clientMethods.close;
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

	it('isolates a throwing terminal observer and reaches later observers once', () => {
		const setup = createClient();
		const socket = setup.factory.latest;
		socket.open();
		const subscription = setup.client['/counter'].subscribe();
		const firstError = vi.fn(() => {
			throw new Error('observer failed');
		});
		const secondError = vi.fn();
		subscription.subscribe({ error: firstError });
		subscription.subscribe({ error: secondError });

		setup.clientMethods.close();
		expect(firstError).toHaveBeenCalledOnce();
		expect(secondError).toHaveBeenCalledOnce();
		expect(firstError).toHaveBeenCalledWith(
			errorCode('SMOLRPC_UNAVAILABLE'),
		);
		expect(secondError).toHaveBeenCalledWith(
			errorCode('SMOLRPC_UNAVAILABLE'),
		);
		expect(setup.reportInternalError).toHaveBeenCalledOnce();
	});

	it('uses a recipient snapshot when an observer adds another observer', () => {
		const setup = createClient();
		const socket = setup.factory.latest;
		socket.open();
		const subscription = setup.client['/counter'].subscribe();
		const lateNext = vi.fn();
		let added = false;
		const firstNext = vi.fn(() => {
			if (added) return;
			added = true;
			subscription.subscribe({ next: lateNext });
		});
		const secondNext = vi.fn();
		subscription.subscribe({ next: firstNext });
		subscription.subscribe({ next: secondNext });
		const request = frames(socket).at(-1);
		if (request == null) throw new Error('missing subscription request');

		socket.message({
			data: 1,
			id: request.id,
			resource: request.resource,
			type: 'SubscribeEvent',
		});
		expect(firstNext).toHaveBeenCalledWith(1);
		expect(secondNext).toHaveBeenCalledWith(1);
		expect(lateNext).not.toHaveBeenCalled();
		socket.message({
			data: 2,
			id: request.id,
			resource: request.resource,
			type: 'SubscribeEvent',
		});
		expect(firstNext).toHaveBeenCalledTimes(2);
		expect(secondNext).toHaveBeenCalledTimes(2);
		expect(lateNext).toHaveBeenCalledOnce();
		expect(lateNext).toHaveBeenCalledWith(2);
	});

	it('supports own and other-handle unsubscribe during next delivery', () => {
		const ownSetup = createClient();
		const ownSocket = ownSetup.factory.latest;
		ownSocket.open();
		const ownSubscription = ownSetup.client['/counter'].subscribe();
		let ownHandle = { unsubscribe() {} };
		const ownNext = vi.fn(() => ownHandle.unsubscribe());
		const laterNext = vi.fn();
		ownHandle = ownSubscription.subscribe({ next: ownNext });
		ownSubscription.subscribe({ next: laterNext });
		const ownRequest = frames(ownSocket).at(-1);
		if (ownRequest == null) throw new Error('missing own request');
		ownSocket.message({
			data: 1,
			id: ownRequest.id,
			resource: ownRequest.resource,
			type: 'SubscribeEvent',
		});
		ownSocket.message({
			data: 2,
			id: ownRequest.id,
			resource: ownRequest.resource,
			type: 'SubscribeEvent',
		});
		expect(ownNext).toHaveBeenCalledOnce();
		expect(laterNext).toHaveBeenCalledTimes(2);

		const otherSetup = createClient();
		const otherSocket = otherSetup.factory.latest;
		otherSocket.open();
		const otherSubscription = otherSetup.client['/counter'].subscribe();
		let otherHandle = { unsubscribe() {} };
		const firstNext = vi.fn(() => otherHandle.unsubscribe());
		const removedNext = vi.fn();
		otherSubscription.subscribe({ next: firstNext });
		otherHandle = otherSubscription.subscribe({ next: removedNext });
		const otherRequest = frames(otherSocket).at(-1);
		if (otherRequest == null) throw new Error('missing other request');
		otherSocket.message({
			data: 3,
			id: otherRequest.id,
			resource: otherRequest.resource,
			type: 'SubscribeEvent',
		});
		expect(firstNext).toHaveBeenCalledOnce();
		expect(removedNext).not.toHaveBeenCalled();
	});

	it.each(['close', 'restart'] as const)(
		'stops stale snapshot delivery when the first observer calls %s',
		(action) => {
			const setup = createClient();
			const socket = setup.factory.latest;
			socket.open();
			const subscription = setup.client['/counter'].subscribe();
			const firstNext = vi.fn(() => setup.clientMethods[action]());
			const secondNext = vi.fn();
			const firstError = vi.fn();
			const secondError = vi.fn();
			subscription.subscribe({ error: firstError, next: firstNext });
			subscription.subscribe({ error: secondError, next: secondNext });
			const request = frames(socket).at(-1);
			if (request == null) throw new Error('missing request');
			socket.message({
				data: 4,
				id: request.id,
				resource: request.resource,
				type: 'SubscribeEvent',
			});

			expect(firstNext).toHaveBeenCalledOnce();
			expect(secondNext).not.toHaveBeenCalled();
			expect(firstError).toHaveBeenCalledOnce();
			expect(secondError).toHaveBeenCalledOnce();
			expect(firstError).toHaveBeenCalledWith(
				errorCode('SMOLRPC_UNAVAILABLE'),
			);
			expect(secondError).toHaveBeenCalledWith(
				errorCode('SMOLRPC_UNAVAILABLE'),
			);
		},
	);

	it('never binds an unobserved generation-A subscribable to B', () => {
		const setup = createClient();
		const oldSocket = setup.factory.latest;
		oldSocket.open();
		const oldSubscription = setup.client['/counter'].subscribe();
		setup.clientMethods.restart();
		const replacement = setup.factory.latest;
		replacement.open();
		const error = vi.fn();

		oldSubscription.subscribe({ error });
		expect(error).toHaveBeenCalledOnce();
		expect(error).toHaveBeenCalledWith(errorCode('SMOLRPC_UNAVAILABLE'));
		expect(oldSocket.sendAttempts).toHaveLength(0);
		expect(replacement.sendAttempts).toHaveLength(0);
	});

	it.each([
		{ failure: 'rejection', expected: 'SMOLRPC_SERVER_REJECTION' },
		{ failure: 'protocol', expected: 'SMOLRPC_PROTOCOL_ERROR' },
		{ failure: 'serialization', expected: 'SMOLRPC_SERIALIZATION' },
		{ failure: 'send', expected: 'SMOLRPC_SEND_FAILED' },
	] as const)(
		'cleans and terminalizes subscription $failure failure',
		({ failure, expected }) => {
			const plans: ControlledSocketPlan[] =
				failure === 'send'
					? [{ sendError: new Error('native send failed') }]
					: [];
			const setup = createClient(plans);
			const socket = setup.factory.latest;
			socket.open();
			const args =
				failure === 'serialization'
					? { cache: false, request: circularValue() }
					: undefined;
			const subscription = (setup.client['/counter'].subscribe as any)(
				args,
			);
			const firstError = vi.fn();
			subscription.subscribe({ error: firstError });
			if (failure === 'rejection' || failure === 'protocol') {
				const [request] = frames(socket);
				socket.message(
					failure === 'rejection'
						? {
								error: 'denied',
								request,
								type: 'RequestReject',
						  }
						: {
								id: request.id,
								resource: '/wrong',
								type: 'SubscribeAccept',
						  },
				);
			}

			expect(firstError).toHaveBeenCalledOnce();
			expect(firstError).toHaveBeenCalledWith(errorCode(expected));
			const attempts = socket.sendAttempts.length;
			const lateError = vi.fn();
			subscription.subscribe({ error: lateError });
			expect(lateError).toHaveBeenCalledOnce();
			expect(lateError).toHaveBeenCalledWith(errorCode(expected));
			expect(socket.sendAttempts).toHaveLength(attempts);

			const fresh =
				failure === 'serialization'
					? setup.client['/counter'].subscribe()
					: setup.client['/counter'].subscribe();
			expect(fresh).not.toBe(subscription);
			fresh.subscribe({ error: vi.fn() });
			expect(socket.sendAttempts).toHaveLength(attempts + 1);
		},
	);

	it('does not retain a cache entry when cache-key serialization throws', () => {
		const setup = createClient();
		const socket = setup.factory.latest;
		socket.open();
		let shouldThrow = true;
		const request = {
			toJSON() {
				if (shouldThrow) {
					shouldThrow = false;
					throw new Error('serialize once');
				}
				return 'serialized';
			},
		};
		expect(() =>
			(setup.client['/counter'].subscribe as any)({ request }),
		).toThrowError(errorCode('SMOLRPC_SERIALIZATION'));
		expect(socket.sendAttempts).toHaveLength(0);
		const fresh = (setup.client['/counter'].subscribe as any)({ request });
		fresh.subscribe({ next: vi.fn() });
		expect(socket.sendAttempts).toHaveLength(1);
	});

	it('dispatches unknown and addressed protocol failures safely', async () => {
		const setup = createClient();
		const socket = setup.factory.latest;
		socket.open();
		const diagnostics = setup.reportInternalError.mock.calls.length;
		socket.message({ id: 999, resource: '/counter', type: 'GetResponse' });
		socket.message({
			error: 'late',
			request: { id: 998, resource: '/counter', type: 'GetRequest' },
			type: 'RequestReject',
		});
		expect(setup.reportInternalError.mock.calls.length).toBe(
			diagnostics + 2,
		);

		const wrongType = setup.client['/counter'].get();
		const healthy = setup.client['/reject'].get();
		const [wrongTypeRequest, healthyRequest] = frames(socket);
		socket.message({
			id: wrongTypeRequest.id,
			resource: wrongTypeRequest.resource,
			type: 'SetSuccess',
		});
		await expect(wrongType).rejects.toEqual(
			errorCode('SMOLRPC_PROTOCOL_ERROR'),
		);
		socket.message({
			data: 'healthy',
			id: healthyRequest.id,
			resource: healthyRequest.resource,
			type: 'GetResponse',
		});
		await expect(healthy).resolves.toBe('healthy');

		for (const response of [
			(id: number) => ({ id }),
			(id: number) => ({
				data: 1,
				id,
				resource: '/counter/set',
				type: 'GetResponse',
			}),
		]) {
			const set = setup.client['/counter/set'].set({ request: 10 });
			const request = frames(socket).at(-1);
			if (request == null) throw new Error('missing SET request');
			socket.message(response(request.id));
			await expect(set).rejects.toEqual(
				errorCode('SMOLRPC_MUTATION_OUTCOME_UNKNOWN'),
			);
		}
	});

	it('times out unsubscribe acknowledgements exactly at five seconds', () => {
		const setup = createClient();
		const socket = setup.factory.latest;
		socket.open();
		const handle = setup.client['/counter']
			.subscribe()
			.subscribe({ next: vi.fn() });
		handle.unsubscribe();
		const diagnostics = setup.reportInternalError.mock.calls.length;

		vi.advanceTimersByTime(4_999);
		expect(setup.reportInternalError).toHaveBeenCalledTimes(diagnostics);
		expect(vi.getTimerCount()).toBe(1);
		vi.advanceTimersByTime(1);
		expect(setup.reportInternalError).toHaveBeenCalledTimes(
			diagnostics + 1,
		);
		expect(setup.reportInternalError).toHaveBeenLastCalledWith(
			expect.stringContaining('acknowledgement timed out'),
			expect.objectContaining({ operation: 'unsubscribe' }),
		);
		expect(vi.getTimerCount()).toBe(0);
		vi.advanceTimersByTime(5_000);
		expect(setup.reportInternalError).toHaveBeenCalledTimes(
			diagnostics + 1,
		);
	});

	it('isolates old handles and delayed acknowledgements from replacements', () => {
		const setup = createClient();
		const oldSocket = setup.factory.latest;
		oldSocket.open();
		const activeHandle = setup.client['/counter']
			.subscribe({ cache: false })
			.subscribe({ error: vi.fn() });
		const acknowledgementHandle = setup.client['/counter']
			.subscribe({ cache: false })
			.subscribe({ next: vi.fn() });
		acknowledgementHandle.unsubscribe();
		const oldUnsubscribe = frames(oldSocket).find(
			(frame) => frame.type === 'UnsubscribeRequest',
		);
		if (oldUnsubscribe == null) throw new Error('missing unsubscribe');

		setup.clientMethods.restart();
		const diagnosticsAfterRetirement =
			setup.reportInternalError.mock.calls.length;
		const replacement = setup.factory.latest;
		replacement.open();
		const next = vi.fn();
		setup.client['/counter'].subscribe().subscribe({ next });
		const [replacementRequest] = frames(replacement);

		activeHandle.unsubscribe();
		activeHandle.unsubscribe();
		oldSocket.message({
			id: oldUnsubscribe.id,
			resource: oldUnsubscribe.resource,
			type: 'UnsubscribeAccept',
		});
		expect(setup.reportInternalError).toHaveBeenCalledTimes(
			diagnosticsAfterRetirement,
		);
		replacement.message({
			data: 11,
			id: replacementRequest.id,
			resource: replacementRequest.resource,
			type: 'SubscribeEvent',
		});

		expect(frames(replacement)).toHaveLength(1);
		expect(next).toHaveBeenCalledWith(11);
	});

	it('rejects fresh construction while connecting, stopped, or in backoff', () => {
		const connecting = createClient();
		expect(() => connecting.client['/counter'].subscribe()).toThrowError(
			errorCode('SMOLRPC_UNAVAILABLE'),
		);
		expect(connecting.factory.latest.sendAttempts).toHaveLength(0);
		connecting.factory.latest.open();
		connecting.client['/counter'].subscribe().subscribe({ next: vi.fn() });
		expect(
			frames(connecting.factory.latest).filter(
				({ type }) => type === 'SubscribeRequest',
			),
		).toHaveLength(1);

		const stopped = createClient();
		stopped.clientMethods.close();
		expect(() => stopped.client['/counter'].subscribe()).toThrowError(
			errorCode('SMOLRPC_UNAVAILABLE'),
		);
		expect(stopped.factory.latest.sendAttempts).toHaveLength(0);
		stopped.clientMethods.open();
		stopped.factory.latest.open();
		stopped.client['/counter'].subscribe().subscribe({ next: vi.fn() });
		expect(
			frames(stopped.factory.latest).filter(
				({ type }) => type === 'SubscribeRequest',
			),
		).toHaveLength(1);

		const backoff = createClient();
		backoff.factory.latest.open();
		backoff.factory.latest.peerClose();
		expect(() => backoff.client['/counter'].subscribe()).toThrowError(
			errorCode('SMOLRPC_UNAVAILABLE'),
		);
		expect(backoff.factory.latest.sendAttempts).toHaveLength(0);
		expect(backoff.factory.sockets).toHaveLength(1);
		backoff.clientMethods.restart();
		backoff.factory.latest.open();
		backoff.client['/counter'].subscribe().subscribe({ next: vi.fn() });
		expect(
			frames(backoff.factory.latest).filter(
				({ type }) => type === 'SubscribeRequest',
			),
		).toHaveLength(1);
	});

	it.each([
		{ throws: false, expected: 'SMOLRPC_UNAVAILABLE' },
		{ throws: true, expected: 'SMOLRPC_SEND_FAILED' },
	] as const)(
		'defers subscribe retirement until native send unwinds (throws=$throws)',
		({ throws, expected }) => {
			const order: string[] = [];
			let close = () => {};
			const setup = createClient([
				{
					onSend() {
						order.push('send-entered');
						close();
						order.push('retirement-returned');
						if (throws) throw new Error('native send failed');
					},
				},
			]);
			close = setup.clientMethods.close;
			setup.factory.latest.open();
			const subscription = setup.client['/counter'].subscribe();
			const observerError = vi.fn((error: SmolRpcError) => {
				order.push(`error:${error.code}`);
			});
			subscription.subscribe({ error: observerError });

			expect(order).toEqual([
				'send-entered',
				'retirement-returned',
				`error:${expected}`,
			]);
			expect(observerError).toHaveBeenCalledOnce();
			setup.clientMethods.open();
			setup.factory.latest.open();
			const replacementAttempts =
				setup.factory.latest.sendAttempts.length;
			subscription.subscribe({ error: vi.fn() });
			expect(setup.factory.latest.sendAttempts).toHaveLength(
				replacementAttempts,
			);
		},
	);

	it.each([{ throws: false }, { throws: true }])(
		'detaches unsubscribe acknowledgement during native send (throws=$throws)',
		({ throws }) => {
			const order: string[] = [];
			const diagnosticCounts: number[] = [];
			let restart = () => {};
			const setup = createClient([
				{
					onSend(_socket, data) {
						const frame = JSON.parse(data) as Frame;
						if (frame.type !== 'UnsubscribeRequest') return;
						order.push('unsubscribe-send-entered');
						diagnosticCounts.push(
							setup.reportInternalError.mock.calls.length,
						);
						restart();
						diagnosticCounts.push(
							setup.reportInternalError.mock.calls.length,
						);
						order.push('retirement-returned');
						if (throws) throw new Error('native send failed');
					},
				},
			]);
			restart = setup.clientMethods.restart;
			const oldSocket = setup.factory.latest;
			oldSocket.open();
			const handle = setup.client['/counter']
				.subscribe()
				.subscribe({ next: vi.fn() });
			handle.unsubscribe();
			order.push('unsubscribe-returned');

			expect(order).toEqual([
				'unsubscribe-send-entered',
				'retirement-returned',
				'unsubscribe-returned',
			]);
			expect(diagnosticCounts).toEqual([0, 0]);
			expect(setup.reportInternalError).toHaveBeenCalledTimes(
				throws ? 1 : 0,
			);
			const replacement = setup.factory.latest;
			replacement.open();
			const next = vi.fn();
			setup.client['/counter'].subscribe().subscribe({ next });
			const [replacementRequest] = frames(replacement);
			const oldAck = JSON.parse(
				oldSocket.sendAttempts.at(-1) ?? '{}',
			) as Frame;
			oldSocket.message({
				id: oldAck.id,
				resource: oldAck.resource,
				type: 'UnsubscribeAccept',
			});
			replacement.message({
				data: 12,
				id: replacementRequest.id,
				resource: replacementRequest.resource,
				type: 'SubscribeEvent',
			});
			expect(next).toHaveBeenCalledWith(12);
		},
	);
});
