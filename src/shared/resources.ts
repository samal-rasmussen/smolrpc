import { z } from 'zod';
import { AnyResources } from './types';

export const resources = {
	'/resourceA': {
		response: z.object({ name: z.string() }),
		type: 'get',
	},
	'/resourceB/:id': {
		request: z.object({ key: z.string() }),
		response: z.object({ key: z.string() }),
		type: 'get|set|subscribe',
	},
} as const satisfies AnyResources;
export type Resources = typeof resources;
