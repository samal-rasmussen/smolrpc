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
		get: async ({ params, qualifiedResource, resource }) => {
			console.log('get', resource, qualifiedResource, params);
			const result = db.get(resource) as Result<typeof resource>;
			return result;
		},
		set: async ({ params, qualifiedResource, resource, request }) => {
			console.log('set', resource, qualifiedResource, params, request);
			const result = db.set(resource, request);
			return result;
		},
		subscribe: ({ params, qualifiedResource, resource }) => {
			console.log('subscribe', resource, qualifiedResource, params);
			const result = db.subscribe(resource);
			return result;
		},
	},
	'/resourceB/:id/resourceC/:key': {
		set: async ({ params, qualifiedResource, resource, request }) => {
			console.log('set', resource, qualifiedResource, params, request);
			const result = db.set(resource, request);
			return result;
		},
	},
} as const satisfies Router<Resources>;
