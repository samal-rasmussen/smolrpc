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
	'/posts/limit': {
		get: async ({ resource, request }) => {
			console.log('ignore limit', request.limit);
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
			const result = db.set(`/posts/${id}`, { ...request, id });
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
		subscribe: ({ resourceWithParams, resource }) => {
			const result = db.subscribe(resourceWithParams) as Subscribable<
				Result<typeof resource>
			>;
			return result;
		},
	},
	'/posts/:postId/create': {
		set: async ({ params, resourceWithParams, request }) => {
			return db.set(resourceWithParams, {
				...request,
				id: Number(params.postId),
			});
		},
	},
	'/posts/:postId/comments': {
		get: async ({ resource, resourceWithParams }) => {
			const result = db.getAll(resourceWithParams) as Result<
				typeof resource
			>;
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
		set: async ({ params, request }) => {
			const id = commendId++;
			const result = db.set(`/posts/${params.postId}/comments/${id}`, {
				...request,
				id,
			});
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
		subscribe: ({ resourceWithParams, resource }) => {
			const result = db.subscribe(resourceWithParams) as Subscribable<
				Result<typeof resource>
			>;
			return result;
		},
	},
	'/posts/:postId/comments/:commentId/create': {
		set: async ({ params, resourceWithParams, request }) => {
			return db.set(resourceWithParams, {
				...request,
				id: Number(params.commentId),
			});
		},
	},
} as const satisfies Router<Resources>;
