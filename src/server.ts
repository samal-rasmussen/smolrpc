import { z } from 'zod';
import { db } from './db';
import { Resources, ResourceParams, Subscribable } from './shared';
import { WebSocketServer } from 'ws';

type Handlers<Resource extends keyof Resources> = {
	get: (args: {
		resource: Resource,
		params?: ResourceParams<Resource>;
	}) => Promise<Resources[Resource]['response']>
	set: (args: {
		resource: Resource,
		request: Resources[Resource]['request'];
		params?: ResourceParams<Resource>;
	}) => Promise<void>
	subscribe: (args: {
		resource: Resource,
		params?: ResourceParams<Resource>;
	}) => Subscribable<Resources[Resource]['response']>
}

export type Router = {
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

const router = {
	'/resourceA': {
		get: async ({params, resource}) => {
			console.log('get', resource, params);
				const result = db.get(resource);
				return result as Resources['/resourceA']['response'];
		}
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
		}
	},
} as const satisfies Router;

const wss = new WebSocketServer({ port: 8080 });

wss.on('connection', function connection(ws) {
	ws.on('message', function message(data) {
		console.log('received: %s', data);
	});

	ws.send('something');
});
