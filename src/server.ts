import { z } from 'zod';
import { db } from './db.js';
import type { Resources, ResourceParams, Subscribable } from './shared';
import { WebSocket, WebSocketServer } from 'ws';
import {
	GetResponse,
	Reject,
	Request,
	RequestMessageType,
	SetResponse,
	SubscribeAccept,
} from './shared.message-types.js';

type Handlers<Resource extends keyof Resources> = {
	get: (args: {
		resource: Resource;
		params?: ResourceParams<Resource>;
	}) => Promise<Resources[Resource]['response']>;
	set: (args: {
		resource: Resource;
		request: Resources[Resource]['request'];
		params?: ResourceParams<Resource>;
	}) => Promise<void>;
	subscribe: (args: {
		resource: Resource;
		params?: ResourceParams<Resource>;
	}) => Subscribable<Resources[Resource]['response']>;
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
			return result as Resources['/resourceA']['response'];
		},
	},
	'/resourceB/:id': {
		get: async ({ resource, params }) => {
			console.log('get', resource, params);
			const result = db.get(resource);
			return result as Resources['/resourceA']['response'];
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
	ws.send(reject);
}

wss.on('connection', function connection(ws) {
	ws.on('message', async function message(rawData: any) {
		console.log('received: %s', rawData);
		const data = JSON.parse(rawData) as Request;
		if (typeof data.id !== 'number') {
			console.error(`no id number on message`);
			return;
		}
		if (typeof data.resource !== 'string') {
			console.error(`no resource string on message`);
			return;
		}
		const resource = router[data.resource];
		if (resource == null) {
			sendReject(ws, data.id, `resource not found`);
		}
		if (data.type === 'GetRequest') {
			try {
				const get = resource.get as Handlers<any>['get'];
				const result = await get({
					resource: data.resource,
					params: data.params,
				});
				const response: GetResponse = {
					id: data.id,
					data: result,
					type: 'GetResponse',
				};
				ws.send(response);
			} catch (error) {
				sendReject(ws, data.id, '500');
			}
		} else if (data.type === 'SetRequest') {
			try {
				const set = (resource as any).set as Handlers<any>['set'];
				await set({
					resource: data.resource,
					request: data.data,
					params: data.params,
				});
				const response: SetResponse = {
					id: data.id,
					type: 'SetResponse',
				};
				ws.send(response);
			} catch (error) {
				sendReject(ws, data.id, '500');
			}
		} else if (data.type === 'SubscribeRequest') {
			try {
				const subscribe = (resource as any)
					.subscribe as Handlers<any>['subscribe'];
				const observable = await subscribe({
					resource: data.resource,
					params: data.params,
				});
				const response: SubscribeAccept = {
					id: data.id,
					type: 'SubscribeAccept',
				};
				ws.send(response);
			} catch (error) {
				sendReject(ws, data.id, '500');
			}
		} else {
			sendReject(ws, (data as any).id, `invalid type`);
		}
	});
});
