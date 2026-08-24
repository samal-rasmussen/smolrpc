import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SmolRpcErrorCode } from '../index.js';
import { SmolRpcError } from '../index.js';
import { OPERATION_TIMEOUT_MS } from '../src/init-client-proxy.js';
import { RECONNECT_DELAYS_MS } from '../src/init-client-websocket.js';
import {
	circularValue,
	createClient,
	errorCode,
	type Frame,
	frames,
} from './client-test-helpers.ts';

beforeEach(() => {
	vi.useFakeTimers();
	vi.spyOn(Math, 'random').mockReturnValue(0.5);
});

afterEach(() => {
	vi.clearAllTimers();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe('client generation and operations', () => {
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

	it('terminalizes and cleans every GET terminal path exactly once', async () => {
		async function expectOneSettlement<T>(
			promise: Promise<T>,
			settle: () => void,
			expectedCode?: SmolRpcErrorCode,
		) {
			let settlements = 0;
			const observed = promise.then(
				(value) => {
					settlements++;
					return value;
				},
				(error) => {
					settlements++;
					throw error;
				},
			);
			settle();
			if (expectedCode == null) await expect(observed).resolves.toBe(1);
			else
				await expect(observed).rejects.toEqual(errorCode(expectedCode));
			vi.advanceTimersByTime(OPERATION_TIMEOUT_MS);
			await Promise.resolve();
			expect(settlements).toBe(1);
		}

		const response = createClient();
		response.factory.latest.open();
		const responsePromise = response.client['/counter'].get();
		const [responseRequest] = frames(response.factory.latest);
		await expectOneSettlement(responsePromise, () => {
			response.factory.latest.message({
				data: 1,
				id: responseRequest.id,
				resource: responseRequest.resource,
				type: 'GetResponse',
			});
		});
		expect(vi.getTimerCount()).toBe(0);

		const rejection = createClient();
		rejection.factory.latest.open();
		const rejectionPromise = rejection.client['/reject'].get();
		const [rejectionRequest] = frames(rejection.factory.latest);
		await expectOneSettlement(
			rejectionPromise,
			() => {
				rejection.factory.latest.message({
					error: 'denied',
					request: rejectionRequest,
					type: 'RequestReject',
				});
			},
			'SMOLRPC_SERVER_REJECTION',
		);
		expect(vi.getTimerCount()).toBe(0);

		const timeout = createClient();
		timeout.factory.latest.open();
		await expectOneSettlement(
			timeout.client['/counter'].get(),
			() => vi.advanceTimersByTime(OPERATION_TIMEOUT_MS),
			'SMOLRPC_TIMEOUT',
		);
		expect(vi.getTimerCount()).toBe(0);

		const retirement = createClient();
		retirement.factory.latest.open();
		await expectOneSettlement(
			retirement.client['/counter'].get(),
			retirement.clientMethods.close,
			'SMOLRPC_UNAVAILABLE',
		);
		expect(vi.getTimerCount()).toBe(0);

		const serialization = createClient();
		serialization.factory.latest.open();
		await expectOneSettlement(
			(serialization.client['/counter'].get as any)({
				request: circularValue(),
			}),
			() => {},
			'SMOLRPC_SERIALIZATION',
		);
		expect(serialization.factory.latest.sendAttempts).toHaveLength(0);
		expect(vi.getTimerCount()).toBe(0);

		const sendFailure = createClient([
			{ sendError: new Error('native send failed') },
		]);
		sendFailure.factory.latest.open();
		await expectOneSettlement(
			sendFailure.client['/counter'].get(),
			() => {},
			'SMOLRPC_SEND_FAILED',
		);
		expect(sendFailure.factory.latest.sendAttempts).toHaveLength(1);
		expect(sendFailure.factory.latest.sent).toHaveLength(0);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('times out a waiting SET without later sending it', async () => {
		const setup = createClient();
		const socket = setup.factory.latest;
		const result = setup.client['/counter/set'].set({ request: 2 });

		vi.advanceTimersByTime(OPERATION_TIMEOUT_MS);
		await expect(result).rejects.toEqual(errorCode('SMOLRPC_TIMEOUT'));
		socket.open();
		expect(socket.sendAttempts).toHaveLength(0);
		expect(vi.getTimerCount()).toBe(0);
	});

	it.each([
		{ response: 'success', expected: undefined },
		{ response: 'rejection', expected: 'SMOLRPC_SERVER_REJECTION' },
	] as const)(
		'lets synchronous SET $response win over later send unwind',
		async ({ response, expected }) => {
			const setup = createClient([
				{
					onSend(socket, data) {
						const request = JSON.parse(data) as Frame;
						if (response === 'success') {
							socket.message({
								data: 3,
								id: request.id,
								resource: request.resource,
								type: 'SetSuccess',
							});
						} else {
							socket.message({
								error: 'denied',
								request,
								type: 'RequestReject',
							});
						}
					},
					sendError: new Error('after response'),
				},
			]);
			setup.factory.latest.open();
			const result = setup.client['/counter/set'].set({ request: 3 });
			if (expected == null) await expect(result).resolves.toBe(3);
			else await expect(result).rejects.toEqual(errorCode(expected));
			vi.advanceTimersByTime(OPERATION_TIMEOUT_MS);
			expect(vi.getTimerCount()).toBe(0);
		},
	);

	it.each([
		{ throws: false, expected: 'SMOLRPC_UNAVAILABLE' },
		{ throws: true, expected: 'SMOLRPC_SEND_FAILED' },
	] as const)(
		'defers GET retirement until native send unwinds (throws=$throws)',
		async ({ throws, expected }) => {
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
			const result = setup.client['/counter'].get().catch((error) => {
				order.push(`rejected:${error.code}`);
				throw error;
			});

			expect(order).toEqual(['send-entered', 'retirement-returned']);
			await expect(result).rejects.toEqual(errorCode(expected));
			expect(order).toEqual([
				'send-entered',
				'retirement-returned',
				`rejected:${expected}`,
			]);
			expect(vi.getTimerCount()).toBe(0);
		},
	);

	it('prevents old native send when the send hook restarts', async () => {
		const setup = createClient();
		const oldSocket = setup.factory.latest;
		oldSocket.open();
		setup.events.send.mockImplementation(() =>
			setup.clientMethods.restart(),
		);

		await expect(setup.client['/counter'].get()).rejects.toEqual(
			errorCode('SMOLRPC_UNAVAILABLE'),
		);
		expect(oldSocket.sendAttempts).toHaveLength(0);
		expect(setup.factory.sockets).toHaveLength(2);
	});

	it('prevents an old timeout from deleting a reused-ID GET', async () => {
		const setup = createClient();
		setup.factory.latest.open();
		const oldGet = setup.client['/counter'].get();
		vi.advanceTimersByTime(OPERATION_TIMEOUT_MS - 1);
		setup.clientMethods.restart();
		await expect(oldGet).rejects.toEqual(errorCode('SMOLRPC_UNAVAILABLE'));

		const replacement = setup.factory.latest;
		replacement.open();
		const replacementGet = setup.client['/counter'].get();
		const [replacementRequest] = frames(replacement);
		expect(replacementRequest.id).toBe(1);
		vi.advanceTimersByTime(1);
		replacement.message({
			data: 17,
			id: replacementRequest.id,
			resource: replacementRequest.resource,
			type: 'GetResponse',
		});
		await expect(replacementGet).resolves.toBe(17);
	});

	it('coalesces duplicate failures and keeps native error readiness-neutral', async () => {
		const errorSetup = createClient();
		const usableSocket = errorSetup.factory.latest;
		usableSocket.open();
		const states = [...errorSetup.states];
		usableSocket.error();
		expect(errorSetup.events.error).toHaveBeenCalledOnce();
		expect(errorSetup.states).toEqual(states);
		vi.advanceTimersByTime(20_000);
		expect(errorSetup.factory.attempts).toHaveLength(1);
		const get = errorSetup.client['/counter'].get();
		const [request] = frames(usableSocket);
		usableSocket.message({
			data: 18,
			id: request.id,
			resource: request.resource,
			type: 'GetResponse',
		});
		await expect(get).resolves.toBe(18);

		const coalesced = createClient();
		const retiredSocket = coalesced.factory.latest;
		retiredSocket.open();
		retiredSocket.peerClose();
		retiredSocket.peerClose();
		retiredSocket.error();
		vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0]);
		expect(coalesced.factory.attempts).toHaveLength(2);
		expect(coalesced.events.reconnect).toHaveBeenCalledOnce();
	});

	it('never replays an unavailable GET after a later open', async () => {
		const setup = createClient();
		setup.clientMethods.close();
		await expect(setup.client['/counter'].get()).rejects.toEqual(
			errorCode('SMOLRPC_UNAVAILABLE'),
		);
		setup.clientMethods.open();
		const replacement = setup.factory.latest;
		replacement.open();
		vi.advanceTimersByTime(20_000);
		expect(replacement.sendAttempts).toHaveLength(0);
	});

	it('never replays an accepted SET after asynchronous retirement', async () => {
		const setup = createClient();
		setup.factory.latest.open();
		const set = setup.client['/counter/set'].set({ request: 8 });
		expect(setup.factory.latest.sent).toHaveLength(1);
		setup.clientMethods.restart();
		await expect(set).rejects.toEqual(
			errorCode('SMOLRPC_MUTATION_OUTCOME_UNKNOWN'),
		);
		const replacement = setup.factory.latest;
		replacement.open();
		vi.advanceTimersByTime(OPERATION_TIMEOUT_MS);
		expect(replacement.sendAttempts).toHaveLength(0);
	});

	it.each([
		{ throws: false, expected: 'SMOLRPC_MUTATION_OUTCOME_UNKNOWN' },
		{ throws: true, expected: 'SMOLRPC_SEND_FAILED' },
	] as const)(
		'settles SET once only after synchronous retirement unwinds (throws=$throws)',
		async ({ throws, expected }) => {
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
			let settlements = 0;
			const set = setup.client['/counter/set']
				.set({ request: 9 })
				.catch((error: SmolRpcError) => {
					settlements++;
					order.push(`rejected:${error.code}`);
					throw error;
				});
			expect(order).toEqual(['send-entered', 'retirement-returned']);
			await expect(set).rejects.toEqual(errorCode(expected));
			vi.advanceTimersByTime(OPERATION_TIMEOUT_MS);
			expect(settlements).toBe(1);
			expect(order.at(-1)).toBe(`rejected:${expected}`);
		},
	);
});
