import { z } from 'zod';
import { AnyResources } from './types';

export const resources = {
	'/resourceA': {
		request: z.NEVER,
		response: z.object({ name: z.string() }),
		type: 'get',
	},
	'/resourceB/:id': {
		request: z.object({ name: z.string() }),
		response: z.object({ name: z.string() }),
		type: 'get|set|subscribe',
	},
} as const satisfies AnyResources;
export type Resources = typeof resources;
