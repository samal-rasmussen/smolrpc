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

			const fresh = setup.client['/counter'].subscribe({ cache: false });
			expect(fresh).not.toBe(subscription);
		},
	);

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

		const stopped = createClient();
		stopped.clientMethods.close();
		expect(() => stopped.client['/counter'].subscribe()).toThrowError(
			errorCode('SMOLRPC_UNAVAILABLE'),
		);
		expect(stopped.factory.latest.sendAttempts).toHaveLength(0);

		const backoff = createClient();
		backoff.factory.latest.open();
		backoff.factory.latest.peerClose();
		expect(() => backoff.client['/counter'].subscribe()).toThrowError(
			errorCode('SMOLRPC_UNAVAILABLE'),
		);
		expect(backoff.factory.latest.sendAttempts).toHaveLength(0);
		expect(backoff.factory.sockets).toHaveLength(1);
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
			let restart = () => {};
			const setup = createClient([
				{
					onSend(_socket, data) {
						const frame = JSON.parse(data) as Frame;
						if (frame.type !== 'UnsubscribeRequest') return;
						order.push('unsubscribe-send-entered');
						restart();
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
