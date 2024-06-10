import { z } from 'zod';

import { AnyResources } from '../src/types';

const post = z.object({ content: z.string(), id: z.number() });
const comment = z.object({ content: z.string(), id: z.number() });

// Resources for handling posts
export const posts = {
	'/posts': {
		response: z.array(post),
		type: 'get|subscribe',
	},
	'/posts/limit': {
		request: z.object({ limit: z.number() }),
		response: z.array(post),
		type: 'get|subscribe',
	},
	'/posts/new': {
		request: post.omit({ id: true }),
		response: z.object({ id: z.number() }),
		type: 'set',
	},
	'/posts/:postId': {
		response: post.or(z.undefined()),
		type: 'get|subscribe',
	},
	'/posts/:postId/create': {
		request: post.omit({ id: true }),
		response: post.or(z.undefined()),
		type: 'set',
	},
} as const satisfies AnyResources;

// Resources for handling comments on posts
export const comments = {
	...posts,
	'/posts/:postId/comments': {
		response: z.array(comment),
		type: 'get|subscribe',
	},
	'/posts/:postId/comments/new': {
		request: comment.omit({ id: true }),
		response: z.object({ id: z.number() }),
		type: 'set',
	},
	'/posts/:postId/comments/:commentId': {
		response: comment.or(z.undefined()),
		type: 'get|subscribe',
	},
	'/posts/:postId/comments/:commentId/create': {
		request: comment.omit({ id: true }),
		response: comment.or(z.undefined()),
		type: 'set',
	},
} as const satisfies AnyResources;

export const resources = {
	...posts,
	...comments,
} as const satisfies AnyResources;
export type Resources = typeof resources;
