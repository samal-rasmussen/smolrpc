import { z } from 'zod';
import { AnyResources } from 'smolrpc';

export const resources = {
	'/resourceA': {
		response: z.object({ name: z.string() }),
		type: 'get',
	},
	'/resourceB/:id': {
		request: z.object({ value: z.string() }),
		response: z.object({ value: z.string() }),
		type: 'get|set|subscribe',
	},
} as const satisfies AnyResources;
export type Resources = typeof resources;
