import { Subscribable, Types, Resources, ResourceParams } from './shared';
import {
	getReject,
	getResponse,
	setReject,
	setResponse,
	subscribeEvent,
	subscribeReject,
} from './shared.message-types';

type Handlers<Resource extends keyof Resources> = {
	get: (args: {
		params?: ResourceParams<Resource>;
	}) => Promise<Resources[Resource]['response']>
	set: (args: {
		request: Resources[Resource]['request'];
		params?: ResourceParams<Resource>;
	}) => Promise<void>
	subscribe: (args: {
		params?: ResourceParams<Resource>;
	}) => Subscribable<Resources[Resource]['response']>
}

export type Client = {
	[Resource in keyof Resources]: Resources[Resource]['type'] extends 'get'
		? Pick<Handlers<Resource>, 'get'> :
		Resources[Resource]['type'] extends 'set'
		? Pick<Handlers<Resource>, 'set'> :
		Resources[Resource]['type'] extends 'subscribe'
		? Pick<Handlers<Resource>, 'subscribe'>
		: Resources[Resource]['type'] extends 'get|set' ? 
		Pick<Handlers<Resource>, 'get' | 'set'>
		: Resources[Resource]['type'] extends 'get|subscribe' ? 
		Pick<Handlers<Resource>, 'get' | 'subscribe'>
		: Resources[Resource]['type'] extends 'set|subscribe' ? 
		Pick<Handlers<Resource>, 'set' | 'subscribe'>
		: Resources[Resource]['type'] extends 'get|set|subscribe' ? 
		Pick<Handlers<Resource>, 'get' | 'set' | 'subscribe'> : never;
};

function makeClient(): Client {
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

	return new Proxy(
		{} as any,
		{
			get(target, p, receiver) {
				return (r: any) => {
					return {
						get: (request: any) => getHandler(p as string, request),
						set: (request: any) => setHandler(p as string, request),
						subscribe: (request: any) => subscribeHandler(p as string, request),
					};
				};
			},
		},
	);
}

const client = makeClient();

const result = await client['/resourceA'].get({
	params: { id: '123' },
});
console.log('result', result)

client['/resourceB/:id'].subscribe({
	params: { id: '123' },
}).subscribe({
	next: (val) => {
		console.log('received subscription val', val);
	},
});
