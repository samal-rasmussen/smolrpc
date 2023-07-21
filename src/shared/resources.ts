import { z } from 'zod';
import { AnyResources } from '../mini-rpc/types';

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
	'/resourceB/:id/resourceC/:key': {
		request: z.object({ key: z.string() }),
		response: z.object({ key: z.string() }),
		type: 'set',
	},
} as const satisfies AnyResources;
export type Resources = typeof resources;
