import { resolveProjectReferencePath } from 'typescript';
import {
	GetResources,
	Resources,
	AnyResources,
	SetResources,
	Subscribable,
	SubscribeResources,
	Types,
	MessageTypes,
} from './shared';

type HandlerType<
	R extends AnyResources,
	H extends GetResources<R> | SetResources<R> | SubscribeResources<R>,
> = {
	[key in keyof H]: (
		request: H[key]['request'],
	) => Promise<H[key]['response']>;
};

type Client<R extends AnyResources> = {
	get: HandlerType<R, GetResources<R>>;
	set: HandlerType<R, SetResources<R>>;
	subscribe: {
		[key in keyof SubscribeResources<R>]: (
			request: SubscribeResources<R>[key]['request'],
		) => Subscribable<SubscribeResources<R>[key]['response']>;
	};
};

function makeClient<R extends AnyResources>(): Client<R> {
	const socket = new WebSocket('localhost:9200');
	type receiveMessageType =
		| 'getReject'
		| 'getResponse'
		| 'setReject'
		| 'setResponse'
		| 'subscribeAccept'
		| 'subscribeEvent'
		| 'subscribeReject';
	const getListeners = new Map<
		Number,
		(
			msg:
				| {
						type: 'getResponse';
						response: any;
				  }
				| {
						type: 'getReject';
						error: any;
				  },
		) => void
	>();
	const setListeners = new Map<
		Number,
		(
			msg:
				| {
						type: 'setResponse';
						response: any;
				  }
				| {
						type: 'setReject';
						error: any;
				  },
		) => void
	>();
	const subscribeListeners = new Map<
		Number,
		(
			msg:
				| {
						type: 'subscribeReject';
						error: any;
				  }
				| { type: 'subscribeEvent'; response: any },
		) => void
	>();
	let id = 0;

	function sendMessage(
		msg:
			| {
					id: number;
					key: string;
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

	function getHandler(key: string, request: unknown): Promise<unknown> {
		return new Promise((resolve, reject) => {
			const msgId = ++id;
			sendMessage({
				id: msgId,
				key,
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
	function setHandler(key: string, request: unknown): Promise<unknown> {
		return new Promise((resolve, reject) => {
			const msgId = ++id;
			sendMessage({
				id: msgId,
				key,
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
		key: string,
		request: unknown,
	): Subscribable<unknown> {
		return {
			subscribe: (observer) => {
				const msgId = ++id;
				sendMessage({ id: msgId, key, request, type: 'subscribe' });
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
						listeners.delete(msgId);
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

const client = makeClient<Resources>();

const result = await client.get['resourceA']({ aId: '123' });
client.subscribe['/subscribeA']({ bId: '123' }).subscribe({
	next: (val) => {
		console.log('received subscription val', val);
	},
});
