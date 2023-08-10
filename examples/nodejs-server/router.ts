import { Router } from '../../src/server.types.js';
import { Result as SmolrpcResult, Subscribable } from '../../src/types.ts';
import { Resources } from '../resources.ts';
import { db } from './db.ts';

type Result<Resource extends keyof Resources> = SmolrpcResult<
	Resources,
	Resource
>;

let postId = 0;
let commendId = 0;

export const router = {
	'/wat': {
		get: async () => {
			return { wat: 'wat', watman: 123 };
		},
	},
	'/posts': {
		get: async ({ resource }) => {
			const result = db.getAll(resource) as Result<typeof resource>;
			return result;
		},
		subscribe: ({ resourceWithParams, resource }) => {
			const result = db.subscribe(resourceWithParams) as Subscribable<
				Result<typeof resource>
			>;
			return result;
		},
	},
	'/posts/new': {
		set: async ({ request }) => {
			const id = postId++;
			const result = db.set(String(id), { ...request, id });
			return { id: result.id, wat: 'wat' };
		},
	},
	'/posts/:postId': {
		get: async ({ resourceWithParams, resource }) => {
			const result = db.get(resourceWithParams) as Result<
				typeof resource
			>;
			return result;
		},
		set: async ({ params, resourceWithParams, request }) => {
			return db.set(resourceWithParams, {
				...request,
				id: Number(params.postId),
			});
		},
		subscribe: ({ resourceWithParams, resource }) => {
			const result = db.subscribe(resourceWithParams) as Subscribable<
				Result<typeof resource>
			>;
			return result;
		},
	},
	'/posts/:postId/comments': {
		get: async ({ resource }) => {
			const result = db.getAll(resource) as Result<typeof resource>;
			return result;
		},
		subscribe: ({ resourceWithParams, resource }) => {
			const result = db.subscribe(resourceWithParams) as Subscribable<
				Result<typeof resource>
			>;
			return result;
		},
	},
	'/posts/:postId/comments/new': {
		set: async ({ request }) => {
			const id = commendId++;
			const result = db.set(String(id), { ...request, id });
			return { id: result.id };
		},
	},
	'/posts/:postId/comments/:commentId': {
		get: async ({ resourceWithParams, resource }) => {
			const result = db.get(resourceWithParams) as Result<
				typeof resource
			>;
			return result;
		},
		set: async ({ params, resourceWithParams, request }) => {
			return db.set(resourceWithParams, {
				...request,
				id: Number(params.commentId),
			});
		},
		subscribe: ({ resourceWithParams, resource }) => {
			const result = db.subscribe(resourceWithParams) as Subscribable<
				Result<typeof resource>
			>;
			return result;
		},
	},
} as const satisfies Router<Resources>;
