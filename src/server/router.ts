import { Resources } from '../shared/resources';
import { db } from './db.js';
import { Router } from '../mini-rpc/server.types';
import { Result as MiniRpcResult } from '../mini-rpc/types';

type Result<Resource extends keyof Resources> = MiniRpcResult<
	Resources,
	Resource
>;

export const router = {
	'/resourceA': {
		async get({ resource }) {
			console.log('get', resource);
			const result = db.get(resource) as Result<typeof resource>;
			return result;
		},
	},
	'/resourceB/:id': {
		get: async ({ resource, params }) => {
			console.log('get', resource, params);
			const result = db.get(resource) as Result<typeof resource>;
			return result;
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
} as const satisfies Router<Resources>;
