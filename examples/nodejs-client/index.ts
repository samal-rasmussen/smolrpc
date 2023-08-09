import { WebSocket as ws } from 'ws';
import { initClient } from '../../src/init-client.js';
import { Resources } from '../resources.js';

global.WebSocket = ws as any;

const client = await initClient<Resources>({
	url: 'ws://localhost:9200',
});

const posts = await client['/posts'].get();
console.log('get posts', posts);

const post123 = await client['/posts/:postId'].get({
	params: { postId: '123' },
});
console.log('get post123', post123);

client['/posts/:postId']
	.subscribe({
		params: { postId: '123' },
	})
	.subscribe({
		next: (val) => {
			console.log('received subscription val', val);
		},
	});

await client['/posts/:postId'].set({
	params: { postId: '123' },
	request: { content: '321' },
});

// await sleep(1000);
// subscription.unsubscribe();
await client['/posts/:postId'].set({
	params: { postId: '123' },
	request: { content: '999' },
});

await client['/posts/:postId/comments/:commentId'].set({
	params: { postId: '123', commentId: '456' },
	request: { content: '888' },
});
const post123comments = await client['/posts/:postId/comments'].get({
	params: { postId: '123' },
});
console.log('get /posts/123/comments', post123comments);

function sleep(timeout: number) {
	new Promise<void>((res) => setTimeout(() => res(), timeout));
}
