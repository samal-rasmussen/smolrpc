import { z } from 'zod';
import { db } from './db.js';
import type { Resources, ResourceParams, Subscribable } from './shared';
import { WebSocket, WebSocketServer } from 'ws';
import {
	GetResponse,
	Reject,
	Request,
	SetSuccess,
	SubscribeAccept,
	SubscribeEvent,
} from './shared.message-types.js';

type Handlers<Resource extends keyof Resources> = {
	get: (args: {
		resource: Resource;
		params?: ResourceParams<Resource>;
	}) => Promise<z.infer<Resources[Resource]['response']>>;
	set: (args: {
		resource: Resource;
		request: z.infer<Resources[Resource]['request']>;
		params?: ResourceParams<Resource>;
	}) => Promise<void>;
	subscribe: (args: {
		resource: Resource;
		params?: ResourceParams<Resource>;
	}) => Subscribable<z.infer<Resources[Resource]['response']>>;
};

export type Router = {
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

const router = {
	'/resourceA': {
		async get({ params, resource }) {
			console.log('get', resource, params);
			const result = db.get(resource);
			return result as z.infer<Resources['/resourceA']['response']>;
		},
	},
	'/resourceB/:id': {
		get: async ({ resource, params }) => {
			console.log('get', resource, params);
			const result = db.get(resource);
			return result as z.infer<Resources['/resourceA']['response']>;
		},
		set: async ({ resource, params, request }) => {
			console.log('set', resource, params, request);
			const result = db.set(resource, request);
			return result;
		},
		subscribe: ({ resource, params }) => {
			console.log('subscribe', resource, params);
			const result = db.subscribe(resource);
			return result;
		},
	},
} as const satisfies Router;

const wss = new WebSocketServer({ port: 9200 });

function sendReject(ws: WebSocket, id: number, error: string) {
	const reject: Reject = {
		id,
		error,
		type: 'Reject',
	};
	ws.send(JSON.stringify(reject));
}

function validateParams(
	resource: string,
	params?: Record<string, string>,
): boolean {
	const count = resource.split(':').length - 1;
	if (count > 0) {
		if (params == null) {
			return false;
		}
		if (Object.keys(params).length !== count) {
			return false;
		}
	}
	return true;
}

wss.on('connection', function connection(ws) {
	ws.on('message', async function message(rawData: any) {
		console.log('received: %s', rawData);
		const message = JSON.parse(rawData) as Request;
		if (typeof message.id !== 'number') {
			console.error(`no id number on message`);
			return;
		}
		if (typeof message.resource !== 'string') {
			console.error(`no resource string on message`);
			return;
		}
		const resource = router[message.resource];
		if (resource == null) {
			sendReject(ws, message.id, `resource not found`);
			return;
		}
		if (!validateParams(message.resource, message.params)) {
			sendReject(ws, message.id, `invalid params`);
			return;
		}
		if (message.type === 'GetRequest') {
			try {
				const get = resource.get as Handlers<any>['get'];
				const result = await get({
					resource: message.resource,
					params: message.params,
				});
				const response: GetResponse = {
					id: message.id,
					data: result,
					type: 'GetResponse',
				};
				console.log(response, JSON.stringify(response));
				ws.send(JSON.stringify(response));
			} catch (error) {
				sendReject(ws, message.id, '500');
			}
		} else if (message.type === 'SetRequest') {
			try {
				const set = (resource as any).set as Handlers<any>['set'];
				await set({
					resource: message.resource,
					request: message.data,
					params: message.params,
				});
				const response: SetSuccess = {
					id: message.id,
					type: 'SetSuccess',
				};
				ws.send(JSON.stringify(response));
			} catch (error) {
				console.error(error);
				sendReject(ws, message.id, '500');
			}
		} else if (message.type === 'SubscribeRequest') {
			try {
				const subscribe = (resource as any)
					.subscribe as Handlers<any>['subscribe'];
				const observable = await subscribe({
					resource: message.resource,
					params: message.params,
				});
				observable.subscribe({
					next(val) {
						const event: SubscribeEvent = {
							id: message.id,
							type: 'SubscribeEvent',
							data: val,
						};
						ws.send(JSON.stringify(event));
					},
				});
				const response: SubscribeAccept = {
					id: message.id,
					type: 'SubscribeAccept',
				};
				ws.send(JSON.stringify(response));
			} catch (error) {
				sendReject(ws, message.id, '500');
			}
		} else {
			sendReject(ws, (message as any).id, `invalid type`);
		}
	});
});
