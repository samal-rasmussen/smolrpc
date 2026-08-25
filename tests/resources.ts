import { z } from 'zod';

import type { AnyResources } from '../src/types.ts';

export const resources = {
	'/counter': {
		response: z.number(),
		type: 'get|subscribe',
	},
	'/counter/set': {
		request: z.number(),
		response: z.number(),
		type: 'set',
	},
	'/reject': {
		response: z.string(),
		type: 'get',
	},
	'/teams/:teamId/items/:itemId': {
		request: z.number(),
		response: z.number(),
		type: 'get|set|subscribe',
	},
} as const satisfies AnyResources;

export type Resources = typeof resources;
