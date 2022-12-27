import type { Subscribable, Types, Resources, ResourceParams } from './shared';
import type {
	GetResponse,
	Reject,
	Request,
	SetResponse,
	SubscribeEvent,
} from './shared.message-types';
import { WebSocket } from 'ws';

type Handlers<Resource extends keyof Resources> = {
	get: (args: {
		params?: ResourceParams<Resource>;
	}) => Promise<Resources[Resource]['response']>;
	set: (args: {
		request: Resources[Resource]['request'];
		params?: ResourceParams<Resource>;
	}) => Promise<void>;
	subscribe: (args: {
		params?: ResourceParams<Resource>;
	}) => Subscribable<Resources[Resource]['response']>;
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
					get: (params?: string[]) => getHandler(p, params),
					set: (data: any, params?: string[]) =>
						setHandler(p, data, params),
					subscribe: (params?: string[]) =>
						subscribeHandler(p, params),
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
			console.log('socket.onmessage', event.type, event.data);
		};

		const getListeners = new Map<
			Number,
			(msg: GetResponse | Reject) => void
		>();
		const setListeners = new Map<
			Number,
			(msg: SetResponse | Reject) => void
		>();
		const subscribeListeners = new Map<
			Number,
			(msg: SubscribeEvent | Reject) => void
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
			params?: string[],
		): Promise<unknown> {
			return new Promise((resolve, reject) => {
				const msgId = ++id;
				sendMessage({
					id: msgId,
					resource,
					params,
					type: 'GetRequest',
				});
				getListeners.set(msgId, (msg) => {
					getListeners.delete(msgId);
					if (msg.type === 'Reject') {
						reject(msg.error);
					} else {
						resolve(msg.data);
					}
				});
			});
		}
		function setHandler(
			resource: keyof Resources,
			data: any,
			params?: string[],
		): Promise<unknown> {
			return new Promise((resolve, reject) => {
				const msgId = ++id;
				sendMessage({
					id: msgId,
					resource,
					data,
					params,
					type: 'SetRequest',
				});
				setListeners.set(msgId, (msg) => {
					setListeners.delete(msgId);
					if (msg.type === 'Reject') {
						reject(msg.error);
					} else {
						resolve(undefined);
					}
				});
			});
		}
		function subscribeHandler(
			resource: keyof Resources,
			params?: string[],
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
					subscribeListeners.set(msgId, (msg) => {
						setListeners.delete(msgId);
						if (msg.type === 'Reject') {
							observer.error?.(msg.error);
							subscribeListeners.delete(msgId);
						} else {
							observer.next?.(msg.data);
						}
					});
					return {
						unsubscribe: () => {
							sendMessage({
								id: msgId,
								type: 'unsubscribe',
							});
							subscribeListeners.delete(msgId);
						},
					};
				},
			};
		}
	});
}

const client = await makeClient();

const result = await client['/resourceA'].get({
	params: { id: '123' },
});
console.log('result', result);

client['/resourceB/:id']
	.subscribe({
		params: { id: '123' },
	})
	.subscribe({
		next: (val) => {
			console.log('received subscription val', val);
		},
	});
