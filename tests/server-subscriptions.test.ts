import { describe, expect, it, vi } from 'vitest';

import type { AnyResources, Router, Subscribable } from '../index.js';
import { initServer, json_stringify } from '../index.js';
import {
	ControlledServerSocket,
	createServerLogger,
	createTestSchema as schema,
} from './server-test-helpers.ts';

function controlledSubscribable<T>({
	initial,
	unsubscribe = vi.fn(),
}: {
	initial?: T;
	unsubscribe?: () => void;
} = {}) {
	const observers = new Set<(value: T) => void>();
	const subscribable: Subscribable<T> = {
		subscribe(observer) {
			if (observer.next != null) observers.add(observer.next);
			if (initial !== undefined) observer.next?.(initial);
			return {
				unsubscribe() {
					if (observer.next != null) observers.delete(observer.next);
					unsubscribe();
				},
			};
		},
	};
	return {
		emit(value: T) {
			for (const observer of [...observers]) observer(value);
		},
		subscribable,
		unsubscribe,
	};
}

const requestSchema = schema<string, string>((value) =>
	typeof value === 'string'
		? { value: value.toUpperCase() }
		: { issues: [{ message: 'expected string' }] },
);
const responseSchema = schema<number | bigint, { value: number | bigint }>(
	(value) =>
		typeof value === 'number' || typeof value === 'bigint'
			? { value: { value } }
			: { issues: [{ message: 'expected number or bigint' }] },
);
const resources = {
	'/streams/:groupId/items/:itemId': {
		request: requestSchema,
		response: responseSchema,
		type: 'subscribe',
	},
} as const satisfies AnyResources;
type Resources = typeof resources;

function subscribeRequest(id: number, request = 'topic') {
	return {
		id,
		params: { groupId: 'group', itemId: 2 },
		request,
		resource: '/streams/:groupId/items/:itemId',
		type: 'SubscribeRequest',
	} as const;
}

function unsubscribeRequest(id: number, subscriptionId: number) {
	return {
		id,
		params: { groupId: 'group', itemId: 2 },
		resource: '/streams/:groupId/items/:itemId',
		subscriptionId,
		type: 'UnsubscribeRequest',
	} as const;
}

describe('server subscriptions', () => {
	it('preserves resourceWithParams for parameterless handlers', async () => {
		const stream = controlledSubscribable<number>();
		const subscribe = vi.fn(() => stream.subscribable);
		const plainResources = {
			'/plain': { response: responseSchema, type: 'subscribe' },
		} as const satisfies AnyResources;
		const server = initServer({ '/plain': { subscribe } }, plainResources);
		const socket = new ControlledServerSocket();
		server.addConnection(socket.asWebSocket());

		await socket.receive(
			json_stringify({
				id: 1,
				resource: '/plain',
				type: 'SubscribeRequest',
			}),
		);
		expect(subscribe).toHaveBeenCalledWith({
			clientId: 0,
			resource: '/plain',
			resourceWithParams: '/plain',
		});
	});

	it('accepts before synchronous transformed events and logs exact metadata', async () => {
		const stream = controlledSubscribable({ initial: 10n });
		const subscribe = vi.fn(() => stream.subscribable);
		const router = {
			'/streams/:groupId/items/:itemId': { subscribe },
		} satisfies Router<Resources>;
		const log = createServerLogger();
		const server = initServer(router, resources, {
			serverLogger: log.logger,
		});
		const socket = new ControlledServerSocket();
		server.addConnection(socket.asWebSocket(), 'subscriber.test');
		const request = subscribeRequest(1);

		await socket.receive(json_stringify(request));
		expect(subscribe).toHaveBeenCalledWith({
			clientId: 0,
			params: { groupId: 'group', itemId: 2 },
			request: 'TOPIC',
			resource: '/streams/:groupId/items/:itemId',
			resourceWithParams: '/streams/group/items/2',
		});
		expect(socket.sentFrames()).toEqual([
			{
				id: 1,
				resource: '/streams/:groupId/items/:itemId',
				type: 'SubscribeAccept',
			},
			{
				data: { value: 10n },
				id: 1,
				params: { groupId: 'group', itemId: 2 },
				resource: '/streams/:groupId/items/:itemId',
				type: 'SubscribeEvent',
			},
		]);
		expect(log.sentResponse).toHaveBeenCalledWith(
			request,
			socket.sentFrames()[0],
			0,
			'subscriber.test',
		);
		expect(log.sentEvent).toHaveBeenCalledWith(
			request,
			socket.sentFrames()[1],
			0,
			'subscriber.test',
		);
	});

	it('drops invalid events while keeping later valid BigInt events live', async () => {
		const stream = controlledSubscribable<number | bigint>();
		const log = createServerLogger();
		const server = initServer(
			{
				'/streams/:groupId/items/:itemId': {
					subscribe: () => stream.subscribable,
				},
			},
			resources,
			{ serverLogger: log.logger },
		);
		const socket = new ControlledServerSocket();
		server.addConnection(socket.asWebSocket());
		await socket.receive(json_stringify(subscribeRequest(1)));

		stream.emit('invalid' as unknown as number);
		expect(socket.sentFrames()).toHaveLength(1);
		expect(log.error).toHaveBeenCalledOnce();
		expect(log.sentEvent).not.toHaveBeenCalled();
		stream.emit(-9007199254740993n);
		expect(socket.sentFrames().at(-1)).toEqual({
			data: { value: -9007199254740993n },
			id: 1,
			params: { groupId: 'group', itemId: 2 },
			resource: '/streams/:groupId/items/:itemId',
			type: 'SubscribeEvent',
		});
		expect(log.sentEvent).toHaveBeenCalledOnce();
	});

	it.each([
		() => {
			throw new Error('subscribe failed');
		},
		() => Promise.reject(new Error('async subscribe failed')),
		() => null,
	])('contains invalid subscribe handler outcomes', async (subscribe) => {
		const log = createServerLogger();
		const server = initServer(
			{ '/streams/:groupId/items/:itemId': { subscribe } } as never,
			resources,
			{ serverLogger: log.logger },
		);
		const socket = new ControlledServerSocket();
		server.addConnection(socket.asWebSocket());
		await expect(
			socket.receive(json_stringify(subscribeRequest(1))),
		).resolves.toBeUndefined();
		expect(socket.sentFrames()).toEqual([
			expect.objectContaining({ type: 'RequestReject' }),
		]);
		expect(log.error).toHaveBeenCalledOnce();
		expect(log.sentReject).toHaveBeenCalledOnce();
	});

	it('unsubscribes the addressed handle once and rejects unknown IDs', async () => {
		const first = controlledSubscribable<number>();
		const second = controlledSubscribable<number>();
		const subscribe = vi
			.fn()
			.mockReturnValueOnce(first.subscribable)
			.mockReturnValueOnce(second.subscribable);
		const server = initServer(
			{ '/streams/:groupId/items/:itemId': { subscribe } },
			resources,
			{ serverLogger: createServerLogger().logger },
		);
		const socket = new ControlledServerSocket();
		server.addConnection(socket.asWebSocket());
		await socket.receive(json_stringify(subscribeRequest(1)));
		await socket.receive(json_stringify(subscribeRequest(2)));
		await socket.receive(json_stringify(unsubscribeRequest(3, 1)));
		expect(first.unsubscribe).toHaveBeenCalledOnce();
		expect(second.unsubscribe).not.toHaveBeenCalled();
		expect(socket.sentFrames().at(-1)).toEqual({
			id: 3,
			resource: '/streams/:groupId/items/:itemId',
			type: 'UnsubscribeAccept',
		});

		await socket.receive(json_stringify(unsubscribeRequest(4, 1)));
		expect(first.unsubscribe).toHaveBeenCalledOnce();
		expect(socket.sentFrames().at(-1)).toEqual(
			expect.objectContaining({ type: 'RequestReject' }),
		);
	});

	it('detaches a throwing unsubscribe before reporting its rejection', async () => {
		const failure = new Error('unsubscribe failed');
		const unsubscribe = vi.fn(() => {
			throw failure;
		});
		const stream = controlledSubscribable<number>({ unsubscribe });
		const log = createServerLogger();
		const server = initServer(
			{
				'/streams/:groupId/items/:itemId': {
					subscribe: () => stream.subscribable,
				},
			},
			resources,
			{ serverLogger: log.logger },
		);
		const socket = new ControlledServerSocket();
		server.addConnection(socket.asWebSocket(), 'throwing.test');
		await socket.receive(json_stringify(subscribeRequest(1)));
		const request = unsubscribeRequest(2, 1);
		await socket.receive(json_stringify(request));
		expect(unsubscribe).toHaveBeenCalledOnce();
		expect(log.error.mock.calls[0]?.slice(1)).toEqual([
			0,
			'throwing.test',
			expect.objectContaining({ error: failure }),
		]);
		expect(log.sentReject).toHaveBeenCalledWith(
			request,
			expect.objectContaining({ type: 'RequestReject' }),
			0,
			'throwing.test',
			failure,
		);
		await socket.receive(json_stringify(unsubscribeRequest(3, 1)));
		expect(unsubscribe).toHaveBeenCalledOnce();
	});

	it('cleans connection-local subscriptions exactly once and isolates failures', async () => {
		const firstFailure = new Error('close cleanup failed');
		const first = controlledSubscribable<number>({
			unsubscribe: vi.fn(() => {
				throw firstFailure;
			}),
		});
		const second = controlledSubscribable<number>();
		const other = controlledSubscribable<number>();
		const streams = [first, second, other];
		const subscribe = vi.fn(() => {
			const stream = streams.shift();
			if (stream == null) throw new Error('missing stream');
			return stream.subscribable;
		});
		const log = createServerLogger();
		const server = initServer(
			{ '/streams/:groupId/items/:itemId': { subscribe } },
			resources,
			{ serverLogger: log.logger },
		);
		const closing = new ControlledServerSocket();
		const remaining = new ControlledServerSocket();
		server.addConnection(closing.asWebSocket(), 'closing.test');
		server.addConnection(remaining.asWebSocket(), 'remaining.test');
		await closing.receive(json_stringify(subscribeRequest(1)));
		await closing.receive(json_stringify(subscribeRequest(2)));
		await remaining.receive(json_stringify(subscribeRequest(1)));

		closing.close();
		closing.close();
		expect(first.unsubscribe).toHaveBeenCalledOnce();
		expect(second.unsubscribe).toHaveBeenCalledOnce();
		expect(other.unsubscribe).not.toHaveBeenCalled();
		expect(log.error).toHaveBeenCalledWith(
			expect.stringContaining('cleanup threw'),
			0,
			'closing.test',
			expect.objectContaining({ error: firstFailure }),
		);
		other.emit(9);
		expect(remaining.sentFrames().at(-1)).toEqual(
			expect.objectContaining({
				data: { value: 9 },
				type: 'SubscribeEvent',
			}),
		);
		remaining.close();
		expect(other.unsubscribe).toHaveBeenCalledOnce();
	});

	it('logs socket errors with connection-local metadata', () => {
		const log = createServerLogger();
		const server = initServer(
			{
				'/streams/:groupId/items/:itemId': {
					subscribe: () => controlledSubscribable().subscribable,
				},
			},
			resources,
			{ serverLogger: log.logger },
		);
		const first = new ControlledServerSocket();
		const second = new ControlledServerSocket();
		server.addConnection(first.asWebSocket(), 'first.test');
		server.addConnection(second.asWebSocket(), 'second.test');
		const event = second.error(new Error('socket failed'));
		expect(log.error).toHaveBeenCalledWith(
			expect.stringContaining('ws.onError'),
			1,
			'second.test',
			{ event },
		);
	});
});
