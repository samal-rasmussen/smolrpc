import { WebSocket as ws } from 'ws';

import { initClient } from '../../src/init-client.js';
import { Resources } from '../resources.js';

let resolve: () => void;
const connected = new Promise<void>((res) => {
	resolve = res;
});

const {
	client,
	clientMethods: { open, close },
} = initClient<Resources>({
	url: 'ws://localhost:9200',
	createWebSocket: (url) => new ws(url) as any as WebSocket,
	onopen: () => {
		resolve();
	},
	onclose: (event) => {
		console.log(
			`closed with code ${event.code} and reason ${event.reason}`,
		);
	},
});

await connected;

const newPost = await client['/posts/new'].set({
	request: { content: 'sick post' },
});
console.log('set', newPost);
const all_posts = await client['/posts'].get();
console.log('get posts', all_posts);
const limit_posts = await client['/posts/limit'].get({
	request: { limit: 10 },
});
console.log('get posts', limit_posts);
const post = await client['/posts/:postId'].get({
	params: { postId: newPost.id },
});
console.log('get post', post);

const subscription = client['/posts/:postId']
	.subscribe({
		params: { postId: newPost.id },
	})
	.subscribe({
		next: (post) => {
			console.log('post event', post);
		},
	});

await client['/posts/:postId/create'].set({
	params: { postId: newPost.id },
	request: { content: 'more sick post' },
});

// await sleep(1000);
// subscription.unsubscribe();
await client['/posts/:postId/create'].set({
	params: { postId: newPost.id },
	request: { content: 'sickest post' },
});

const newComment = await client['/posts/:postId/comments/new'].set({
	params: { postId: newPost.id },
	request: { content: 'sick comment' },
});
const newComment2 = await client['/posts/:postId/comments/new'].set({
	params: { postId: newPost.id },
	request: { content: 'another sick comment' },
});
const postcomments = await client['/posts/:postId/comments'].get({
	params: { postId: newPost.id },
});
console.log('get /posts/:id/comments', postcomments);
await client['/posts/:postId/comments/:commentId/create'].set({
	params: {
		postId: newPost.id,
		commentId: newComment.id,
	},
	request: { content: 'more sick comment' },
});

async function sleep(timeout: number) {
	return new Promise<void>((res) => setTimeout(res, timeout));
}
