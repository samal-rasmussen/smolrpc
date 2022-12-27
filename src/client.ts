import type { Subscribable, Resources, ResourceParams } from './shared';
import type {
	Reject,
	Request,
	Response,
	SubscribeEvent,
} from './shared.message-types';
import { WebSocket } from 'ws';
import { z } from 'zod';

type Handlers<Resource extends keyof Resources> = {
	get: (args: {
		params?: ResourceParams<Resource>;
	}) => Promise<z.infer<Resources[Resource]['response']>>;
	set: (args: {
		request: z.infer<Resources[Resource]['request']>;
		params?: ResourceParams<Resource>;
	}) => Promise<void>;
	subscribe: (args: {
		params?: ResourceParams<Resource>;
	}) => Subscribable<z.infer<Resources[Resource]['response']>>;
};

export type Client = {
	[Resource in keyof Resources]: Resources[Resource]['type'] extends 'get'
		? Pick<Handlers<Resource>, 'get'>
		: Resources[Resource]['type'] extends 'set'
		? Pick<Handlers<Resource>, 'set'>
		: Resources[Resource]['type'] extends 'subscribe'
		? Pick<Handlers<Resource>, 'subscribe'>
		: Resources[Resource]['type'] extends 'get|set'
		? Pick<Handlers<Resource>, 'get' | 'set'>
		: Resources[Resource]['type'] extends 'get|subscribe'
		? Pick<Handlers<Resource>, 'get' | 'subscribe'>
		: Resources[Resource]['type'] extends 'set|subscribe'
		? Pick<Handlers<Resource>, 'set' | 'subscribe'>
		: Resources[Resource]['type'] extends 'get|set|subscribe'
		? Pick<Handlers<Resource>, 'get' | 'set' | 'subscribe'>
		: never;
};

async function makeClient(): Promise<Client> {
	return new Promise((resolve, reject) => {
		const proxy = new Proxy({} as any, {
			get(target, p: any, receiver) {
				return {
					get: ({ params }: { params?: Record<string, string> }) =>
						getHandler(p, params),
					set: ({
						request,
						params,
					}: {
						request: any;
						params?: Record<string, string>;
					}) => setHandler(p, request, params),
					subscribe: ({
						params,
					}: {
						params?: Record<string, string>;
					}) => subscribeHandler(p, params),
				};
			},
		});

		const socket = new WebSocket('ws://localhost:9200');
		socket.onopen = (event) => {
			console.log('socket.onopen', event.type);
			resolve(proxy);
		};
		socket.onclose = (event) => {
			console.log('socket.onclose', event.type, event.code, event.reason);
			reject();
		};
		socket.onerror = (event) => {
			console.log(
				'socket.onerror',
				event.type,
				event.error,
				event.message,
			);
		};
		socket.onmessage = (event) => {
			console.log(
				'socket.onmessage',
				event.type,
				typeof event.data,
				event.data,
			);
			const message = JSON.parse(event.data as string) as
				| Response
				| SubscribeEvent
				| Reject;
			const listener = listeners.get(message.id);
			if (listener == null) {
				console.error(`no listener found for message`, message);
				return;
			}
			listener(message);
		};

		const listeners = new Map<
			Number,
			(msg: Response | SubscribeEvent | Reject) => void
		>();
		let id = 0;

		function sendMessage(
			msg:
				| Request
				| {
						id: number;
						type: 'unsubscribe';
				  },
		): void {
			socket.send(JSON.stringify(msg));
		}

		function getHandler(
			resource: keyof Resources,
			params?: Record<string, string>,
		): Promise<unknown> {
			return new Promise((resolve, reject) => {
				const msgId = ++id;
				sendMessage({
					id: msgId,
					resource,
					params,
					type: 'GetRequest',
				});
				listeners.set(msgId, (msg) => {
					listeners.delete(msgId);
					if (msg.type === 'Reject') {
						reject(msg.error);
					} else if (msg.type === 'GetResponse') {
						resolve(msg.data);
					} else {
						console.error(
							`unexpected message type in get listener`,
							msg,
						);
					}
				});
			});
		}
		function setHandler(
			resource: keyof Resources,
			request: any,
			params?: Record<string, string>,
		): Promise<unknown> {
			return new Promise((resolve, reject) => {
				const msgId = ++id;
				sendMessage({
					id: msgId,
					resource,
					data: request,
					params,
					type: 'SetRequest',
				});
				listeners.set(msgId, (msg) => {
					listeners.delete(msgId);
					if (msg.type === 'Reject') {
						reject(msg.error);
					} else if (msg.type === 'SetSuccess') {
						resolve(undefined);
					} else {
						console.error(
							`unexpected message type in set listener`,
							msg,
						);
					}
				});
			});
		}
		function subscribeHandler(
			resource: keyof Resources,
			params?: Record<string, string>,
		): Subscribable<unknown> {
			return {
				subscribe: (observer) => {
					const msgId = ++id;
					sendMessage({
						id: msgId,
						resource,
						params,
						type: 'SubscribeRequest',
					});
					listeners.set(msgId, (msg) => {
						if (msg.type === 'Reject') {
							reject(msg.error);
						} else if (msg.type === 'SubscribeEvent') {
							observer.next?.(msg.data);
						} else {
							console.error(
								`unexpected message type in get listener`,
								msg,
							);
						}
					});
					return {
						unsubscribe: () => {
							sendMessage({
								id: msgId,
								type: 'unsubscribe',
							});
							listeners.delete(msgId);
						},
					};
				},
			};
		}
	});
}

const client = await makeClient();

const result = await client['/resourceA'].get({
	params: null,
});
console.log('result', result);

const result2 = await client['/resourceB/:id'].get({
	params: { id: '123' },
});
console.log('result2', result2);

client['/resourceB/:id']
	.subscribe({
		params: { id: '123' },
	})
	.subscribe({
		next: (val) => {
			console.log('received subscription val', val);
		},
	});

await client['/resourceB/:id'].set({
	request: { name: '321' },
	params: { id: '123' },
});
