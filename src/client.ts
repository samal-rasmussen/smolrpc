import { Router } from './server';
import { Subscribable, Types, Client, AnyRouter } from './shared';
import {
	getReject,
	getResponse,
	setReject,
	setResponse,
	subscribeEvent,
	subscribeReject,
} from './shared.message-types';

function makeClient<R extends AnyRouter>(): Client<R> {
	const socket = new WebSocket('localhost:9200');
	const getListeners = new Map<
		Number,
		(msg: getResponse | getReject) => void
	>();
	const setListeners = new Map<
		Number,
		(msg: setResponse | setReject) => void
	>();
	const subscribeListeners = new Map<
		Number,
		(msg: subscribeEvent | subscribeReject) => void
	>();
	let id = 0;

	function sendMessage(
		msg:
			| {
					id: number;
					resource: string;
					request: any;
					type: Types;
			  }
			| {
					id: number;
					type: 'unsubscribe';
			  },
	): void {
		socket.send(JSON.stringify(msg));
	}

	function getHandler(resource: string, request: unknown): Promise<unknown> {
		return new Promise((resolve, reject) => {
			const msgId = ++id;
			sendMessage({
				id: msgId,
				resource,
				request,
				type: 'get',
			});
			getListeners.set(msgId, (msg) => {
				getListeners.delete(msgId);
				if (msg.type === 'getReject') {
					reject(msg.error);
				} else {
					resolve(msg.response);
				}
			});
		});
	}
	function setHandler(resource: string, request: unknown): Promise<unknown> {
		return new Promise((resolve, reject) => {
			const msgId = ++id;
			sendMessage({
				id: msgId,
				resource,
				request,
				type: 'set',
			});
			setListeners.set(msgId, (msg) => {
				setListeners.delete(msgId);
				if (msg.type === 'setReject') {
					reject(msg.error);
				} else {
					resolve(msg.response);
				}
			});
		});
	}
	function subscribeHandler(
		resource: string,
		request: unknown,
	): Subscribable<unknown> {
		return {
			subscribe: (observer) => {
				const msgId = ++id;
				sendMessage({
					id: msgId,
					resource,
					request,
					type: 'subscribe',
				});
				subscribeListeners.set(msgId, (msg) => {
					setListeners.delete(msgId);
					if (msg.type === 'subscribeReject') {
						observer.error?.(msg.error);
						subscribeListeners.delete(msgId);
					} else {
						observer.next?.(msg.response);
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

	function proxyHandler(handler: (property: any, request: any) => any) {
		return new Proxy(
			{},
			{
				get(target, p, receiver) {
					return (r: any) => {
						return handler(p, r);
					};
				},
			},
		);
	}

	return {
		get: proxyHandler(getHandler),
		set: proxyHandler(setHandler),
		subscribe: proxyHandler(subscribeHandler),
	} as any;
}

const client = makeClient<Router>();

const result = await client.get['/resourceB']({
	request: { aId: '123' },
	params: { id: '123' },
});
client.subscribe['/subscribeA']({
	request: { aId: '123' },
	params: null,
}).subscribe({
	next: (val) => {
		console.log('received subscription val', val);
	},
});
