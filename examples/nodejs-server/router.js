import { db } from './db.js';

/**
 * @typedef {import("../resources.js").Resources} Resources
 * @typedef {import("smolrpc").Router<Resources>} Router
 */

/**
 * @template {keyof Resources} Resource
 * @typedef {import("smolrpc").Result<Resources, Resource>} Result
 */

/**
 * @const
 * @satisfies {Router}
 */
export const router = {
	'/resourceA': {
		async get({ resource }) {
			console.log('get', resource);
			const result = db.get(resource);
			return /** @type {Result<typeof resource>} */ (result);
		},
	},
	'/resourceB/:id': {
		get: async ({ params, resourceWithParams, resource }) => {
			console.log('get', resource, resourceWithParams, params);
			const result = /** @type {Result<typeof resource>} */ (
				db.get(resourceWithParams)
			);
			return result;
		},
		set: async ({ params, resourceWithParams, resource, request }) => {
			console.log('set', resource, resourceWithParams, params, request);
			db.set(resourceWithParams, request);
		},
		subscribe: ({ params, resourceWithParams, resource }) => {
			console.log('subscribe', resource, resourceWithParams, params);
			const result = db.subscribe(resourceWithParams);
			return result;
		},
	},
	'/resourceB/:id/resourceC/:key': {
		get: async ({ params, resourceWithParams, resource }) => {
			console.log('get', resource, resourceWithParams, params);
			const result = /** @type {Result<typeof resource>} */ (
				db.get(resourceWithParams)
			);
			return result;
		},
		set: async ({ params, resourceWithParams, resource, request }) => {
			console.log('set', resource, resourceWithParams, params, request);
			db.set(resourceWithParams, request);
		},
	},
};
