import { z } from 'zod';
import { AnyResources } from '../types';

const post = z.object({ content: z.string(), id: z.number() });
const comment = z.object({ content: z.string(), id: z.number() });

// Resources for handling posts
export const posts = {
	'/posts': {
		response: z.array(post),
		type: 'get|subscribe',
	},
	'/posts/new': {
		request: post.omit({ id: true }),
		response: post,
		type: 'set',
	},
	'/posts/:postId': {
		request: post.omit({ id: true }),
		response: post,
		type: 'get|set|subscribe',
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
		response: comment,
		type: 'set',
	},
	'/posts/:postId/comments/:commentId': {
		request: comment.omit({ id: true }),
		response: comment,
		type: 'get|set|subscribe',
	},
} as const satisfies AnyResources;

export const resources = {
	...posts,
	...comments,
} as const satisfies AnyResources;
export type Resources = typeof resources;
