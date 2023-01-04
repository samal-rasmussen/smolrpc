import { z } from 'zod';
import { Resources } from '../shared';
import { db } from './db.js';
import { Router } from './server.types';

export const router = {
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
