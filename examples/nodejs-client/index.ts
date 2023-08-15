import { WebSocket as ws } from 'ws';
import { initClient } from '../../src/init-client.js';
import { Resources } from '../resources.js';

const client = initClient<Resources>({
	url: 'ws://localhost:9200',
	createWebSocket: (url) => new ws(url) as any as WebSocket,
	connectionStateCb: (state) => console.log(`connection state ${state}`),
});

const newPost = await client['/posts/new'].set({
	request: { content: 'sick post' },
});
console.log('set', newPost);
const posts = await client['/posts'].get();
console.log('get posts', posts);
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

await client['/posts/:postId'].set({
	params: { postId: newPost.id },
	request: { content: 'more sick post' },
});

// await sleep(1000);
// subscription.unsubscribe();
await client['/posts/:postId'].set({
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
await client['/posts/:postId/comments/:commentId'].set({
	params: {
		postId: newPost.id,
		commentId: newComment.id,
	},
	request: { content: 'more sick comment' },
});

function sleep(timeout: number) {
	new Promise<void>((res) => setTimeout(() => res(), timeout));
}
