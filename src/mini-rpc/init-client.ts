import type { AnyResources, Subscribable } from './types';
import type {
	Params,
	Reject,
	Request,
	Response,
	SubscribeEvent,
} from './message-types';
import { WebSocket } from 'ws';
import { Client } from './client';

export async function initClient<Resources extends AnyResources>(): Promise<
	Client<Resources>
> {
	return new Promise((resolve, reject) => {
		const proxy = new Proxy({} as any, {
			get(target, p: any, receiver) {
				return {
					get: (args: { params: Params } | undefined) =>
						getHandler(p, args?.params),
					set: ({
						request,
						params,
					}: {
						request: any;
						params: Params;
					}) => setHandler(p, request, params),
					subscribe: (args: { params: Params }) =>
						subscribeHandler(p, args?.params),
				};
			},
		});

		const socket = new WebSocket('ws://localhost:9200');
		socket.onopen = (event) => {
			console.log('websocket connected');
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
			// console.log(
			// 	'socket.onmessage',
			// 	event.type,
			// 	typeof event.data,
			// 	event.data,
			// );
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
				| Request<Resources>
				| {
						id: number;
						type: 'unsubscribe';
				  },
		): void {
			socket.send(JSON.stringify(msg));
		}

		function getHandler(
			resource: keyof Resources,
			params: Params,
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
			params: Params,
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
			params: Params,
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
						} else if (msg.type === 'SubscribeAccept') {
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
