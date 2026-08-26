import type { StandardSchemaV1 } from '@standard-schema/spec';

import {
	type AnyResources,
	type Client,
	initServer,
	type Result,
	type Router,
	type Subscribable,
} from '../index.js';
import type {
	GetResponse,
	SetSuccess,
	SubscribeEvent,
} from '../src/message.types.ts';

const requestSchema = null as unknown as StandardSchemaV1<string, number>;
const responseSchema = null as unknown as StandardSchemaV1<boolean, number>;

const resources = {
	'/get': { response: responseSchema, type: 'get' },
	'/set': { request: requestSchema, response: responseSchema, type: 'set' },
	'/subscribe': { response: responseSchema, type: 'subscribe' },
	'/get-set': {
		request: requestSchema,
		response: responseSchema,
		type: 'get|set',
	},
	'/get-subscribe': {
		request: requestSchema,
		response: responseSchema,
		type: 'get|subscribe',
	},
	'/set-subscribe': {
		request: requestSchema,
		response: responseSchema,
		type: 'set|subscribe',
	},
	'/all/:teamId/items/:itemId': {
		request: requestSchema,
		response: responseSchema,
		type: 'get|set|subscribe',
	},
} as const satisfies AnyResources;

type Resources = typeof resources;
declare const client: Client<Resources>;
declare const booleanStream: Subscribable<boolean>;

const router = {
	'/get': {
		get: () => true,
	},
	'/set': {
		set: ({ request }) => {
			const parsedRequest: number = request;
			return Promise.resolve(parsedRequest > 0);
		},
	},
	'/subscribe': {
		subscribe: () => booleanStream,
	},
	'/get-set': {
		get: ({ request }) => request > 0,
		set: ({ request }) => request > 0,
	},
	'/get-subscribe': {
		get: ({ request }) => request > 0,
		subscribe: ({ request }) => {
			const parsedRequest: number = request;
			void parsedRequest;
			return booleanStream;
		},
	},
	'/set-subscribe': {
		set: ({ request }) => request > 0,
		subscribe: () => Promise.resolve(booleanStream),
	},
	'/all/:teamId/items/:itemId': {
		get: ({ params, request, resourceWithParams }) => {
			const parsedRequest: number = request;
			const teamId: string | number = params.teamId;
			const itemId: string | number = params.itemId;
			const materialized: string = resourceWithParams;
			void parsedRequest;
			void teamId;
			void itemId;
			void materialized;
			return true;
		},
		set: ({ request }) => request > 0,
		subscribe: () => booleanStream,
	},
} as const satisfies Router<Resources>;

initServer(router, resources);

const getResult: Promise<number> = client['/get'].get();
const setResult: Promise<number> = client['/set'].set({ request: '1' });
const getSetGetResult: Promise<number> = client['/get-set'].get({
	request: '2',
});
const getSetSetResult: Promise<number> = client['/get-set'].set({
	request: '3',
});
const getSubscribeResult: Promise<number> = client['/get-subscribe'].get({
	request: '4',
});
const getSubscribeStream: Subscribable<number> = client[
	'/get-subscribe'
].subscribe({
	request: '5',
});
const subscribeStream: Subscribable<number> = client['/subscribe'].subscribe();
const setSubscribeSetResult: Promise<number> = client['/set-subscribe'].set({
	request: '6',
});
const setSubscribeStream: Subscribable<number> = client[
	'/set-subscribe'
].subscribe({
	request: '7',
});
const allGetResult: Promise<number> = client['/all/:teamId/items/:itemId'].get({
	params: { itemId: 2, teamId: 'one' },
	request: '8',
});
const allSetResult: Promise<number> = client['/all/:teamId/items/:itemId'].set({
	params: { itemId: 'two', teamId: 1 },
	request: '9',
});
const allStream: Subscribable<number> = client[
	'/all/:teamId/items/:itemId'
].subscribe({
	params: { itemId: 2, teamId: 'one' },
	request: '10',
});

const result: Result<Resources, '/get'> = true;
const getResponse: GetResponse<Resources> = {
	data: 1,
	id: 1,
	resource: '/get',
	type: 'GetResponse',
};
const setSuccess: SetSuccess<Resources> = {
	data: 2,
	id: 2,
	resource: '/set',
	type: 'SetSuccess',
};
const subscribeEvent: SubscribeEvent<Resources> = {
	data: 3,
	id: 3,
	resource: '/subscribe',
	type: 'SubscribeEvent',
};

// @ts-expect-error Result represents router response-schema input
const invalidResult: Result<Resources, '/get'> = 1;
// @ts-expect-error router response producers use response-schema input
const invalidGetHandler: Router<Resources>['/get']['get'] = () => 1;
const invalidSubscribeHandler: Router<Resources>['/subscribe']['subscribe'] =
	() =>
		// @ts-expect-error subscription producers emit response-schema input
		null as unknown as Subscribable<number>;
const incompatibleResources = {
	...resources,
	'/get': { response: requestSchema, type: 'get' },
} as const;
// @ts-expect-error router and resources must describe the same contract
initServer(router, incompatibleResources);
// @ts-expect-error unknown resource path
client['/missing'];
// @ts-expect-error get-only resources do not expose set
client['/get'].set({ request: '1' });
// @ts-expect-error set-only resources do not expose get
client['/set'].get();
// @ts-expect-error subscribe-only resources do not expose get
client['/subscribe'].get();
// @ts-expect-error request arguments use schema input, not output
client['/set'].set({ request: 1 });
// @ts-expect-error request is required
client['/set'].set({});
// @ts-expect-error parameters are required
client['/all/:teamId/items/:itemId'].get({ request: '1' });
client['/all/:teamId/items/:itemId'].get({
	// @ts-expect-error a required parameter is missing
	params: { teamId: 1 },
	request: '1',
});
client['/all/:teamId/items/:itemId'].get({
	// @ts-expect-error extra parameter names are rejected
	params: { extra: 1, itemId: 2, teamId: 1 },
	request: '1',
});
client['/all/:teamId/items/:itemId'].get({
	// @ts-expect-error incorrect parameter names are rejected
	params: { item: 2, teamId: 1 },
	request: '1',
});
client['/all/:teamId/items/:itemId'].get({
	// @ts-expect-error parameter values are only strings or numbers
	params: { itemId: true, teamId: 1 },
	request: '1',
});

void getResult;
void setResult;
void getSetGetResult;
void getSetSetResult;
void getSubscribeResult;
void getSubscribeStream;
void subscribeStream;
void setSubscribeSetResult;
void setSubscribeStream;
void allGetResult;
void allSetResult;
void allStream;
void result;
void getResponse;
void setSuccess;
void subscribeEvent;
void invalidResult;
void invalidGetHandler;
void invalidSubscribeHandler;
