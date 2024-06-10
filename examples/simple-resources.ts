import { z } from 'zod';

import { AnyResources } from '../src/types';

const post = z.object({
	content: z.string(),
	id: z.string(),
});

export const resources = {
	'/posts': {
		response: z.array(post),
		type: 'get|subscribe',
	},
	'/posts/:postId': {
		response: post,
		type: 'get|subscribe',
	},
	'/posts/:postId/create': {
		request: post.omit({ id: true }),
		response: post,
		type: 'set',
	},
} as const satisfies AnyResources;
export type SimpleResources = typeof resources;
