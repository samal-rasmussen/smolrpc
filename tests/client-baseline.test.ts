import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dummyClient } from '../index.js';
import {
	createOpenClient as setupClient,
	frames,
} from './client-test-helpers.ts';
import type { Resources } from './resources.ts';

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.clearAllTimers();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe('client baseline', () => {
	it('completes a successful GET', async () => {
		const { client, socket } = setupClient();

		const result = client['/counter'].get();
		const [request] = frames(socket);
		expect(request).toMatchObject({
			resource: '/counter',
			type: 'GetRequest',
		});

		socket.message({
			data: 42,
			id: request.id,
			resource: request.resource,
			type: 'GetResponse',
		});

		await expect(result).resolves.toBe(42);
	});

	it('completes a successful SET', async () => {
		const { client, socket } = setupClient();

		const result = client['/counter/set'].set({ request: 12 });
		const [request] = frames(socket);
		expect(request).toMatchObject({
			request: 12,
			resource: '/counter/set',
			type: 'SetRequest',
		});

		socket.message({
			data: 12,
			id: request.id,
			resource: request.resource,
			type: 'SetSuccess',
		});

		await expect(result).resolves.toBe(12);
	});

	it('shares cached subscriptions and replays their last value', () => {
		const { client, socket } = setupClient();
		const first = client['/counter'].subscribe();
		const second = client['/counter'].subscribe();
		const firstNext = vi.fn();
		const secondNext = vi.fn();

		expect(first).toBe(second);
		first.subscribe({ next: firstNext });
		second.subscribe({ next: secondNext });
		const subscribeRequests = frames(socket).filter(
			(frame) => frame.type === 'SubscribeRequest',
		);
		expect(subscribeRequests).toHaveLength(1);

		const [request] = subscribeRequests;
		socket.message({
			id: request.id,
			resource: request.resource,
			type: 'SubscribeAccept',
		});
		socket.message({
			data: 7,
			id: request.id,
			resource: request.resource,
			type: 'SubscribeEvent',
		});

		expect(firstNext).toHaveBeenCalledWith(7);
		expect(secondNext).toHaveBeenCalledWith(7);
		const replayNext = vi.fn();
		first.subscribe({ next: replayNext });
		expect(replayNext).toHaveBeenCalledWith(7);
	});

	it('creates independent uncached subscriptions', () => {
		const { client, socket } = setupClient();
		const first = client['/counter'].subscribe({ cache: false });
		const second = client['/counter'].subscribe({ cache: false });

		expect(first).not.toBe(second);
		first.subscribe({ next: vi.fn() });
		second.subscribe({ next: vi.fn() });

		expect(
			frames(socket).filter((frame) => frame.type === 'SubscribeRequest'),
		).toHaveLength(2);
	});

	it('sends unsubscribe only after the final observer leaves', () => {
		const { client, socket } = setupClient();
		const subscribable = client['/counter'].subscribe();
		const first = subscribable.subscribe({ next: vi.fn() });
		const second = subscribable.subscribe({ next: vi.fn() });
		const [subscribeRequest] = frames(socket);

		first.unsubscribe();
		expect(
			frames(socket).filter(
				(frame) => frame.type === 'UnsubscribeRequest',
			),
		).toHaveLength(0);

		second.unsubscribe();
		const unsubscribeRequests = frames(socket).filter(
			(frame) => frame.type === 'UnsubscribeRequest',
		);
		expect(unsubscribeRequests).toHaveLength(1);
		const [unsubscribeRequest] = unsubscribeRequests;
		expect(unsubscribeRequest).toMatchObject({
			resource: '/counter',
			subscriptionId: subscribeRequest.id,
		});

		socket.message({
			id: unsubscribeRequest.id,
			resource: unsubscribeRequest.resource,
			type: 'UnsubscribeAccept',
		});
		expect(vi.getTimerCount()).toBe(0);
	});

	it('dummyClient never settles, never throws, and never delivers', async () => {
		const client = dummyClient<Resources>();
		const settled = vi.fn();
		void client['/counter'].get().then(settled, settled);
		void client['/counter/set'].set({ request: 1 }).then(settled, settled);
		const observed = vi.fn();
		const handle = client['/counter']
			.subscribe()
			.subscribe({ error: observed, next: observed });
		expect(() => handle.unsubscribe()).not.toThrow();

		await vi.runAllTimersAsync();
		expect(settled).not.toHaveBeenCalled();
		expect(observed).not.toHaveBeenCalled();
	});

	it('rejects a request when the server rejects it', async () => {
		const { client, socket } = setupClient();
		const result = client['/reject'].get();
		const [request] = frames(socket);
		const rejected = expect(result).rejects.toThrow(
			'Get request on /reject rejected with error: denied',
		);

		socket.message({
			error: 'denied',
			request,
			type: 'RequestReject',
		});

		await rejected;
	});

	it('closes and explicitly opens a fresh socket', async () => {
		const { client, clientMethods, factory, socket } = setupClient();

		clientMethods.close();
		expect(socket.closeCalls).toEqual([
			{ code: 1000, reason: 'close was called' },
		]);

		clientMethods.open();
		expect(factory.sockets).toHaveLength(2);
		const replacement = factory.latest;
		replacement.open();
		const result = client['/counter'].get();
		const [request] = frames(replacement);
		replacement.message({
			data: 9,
			id: request.id,
			resource: request.resource,
			type: 'GetResponse',
		});

		await expect(result).resolves.toBe(9);
	});

	it('reconnects after an ordinary peer close', () => {
		vi.spyOn(Math, 'random').mockReturnValue(0.5);
		const { events, factory, socket } = setupClient();

		socket.peerClose();
		expect(events.close).toHaveBeenCalledOnce();
		expect(factory.sockets).toHaveLength(1);

		vi.advanceTimersByTime(999);
		expect(factory.sockets).toHaveLength(1);
		vi.advanceTimersByTime(1);
		expect(factory.sockets).toHaveLength(2);
		expect(events.reconnect).toHaveBeenCalledOnce();

		factory.latest.open();
		expect(events.open).toHaveBeenCalledTimes(2);
	});
});
