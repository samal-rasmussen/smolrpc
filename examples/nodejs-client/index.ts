import { WebSocket as ws } from 'ws';
import { initClient } from '../../src/init-client.js';
import { Resources } from '../resources.js';

global.WebSocket = ws as any;

const client = await initClient<Resources>({
	url: 'ws://localhost:9200',
	connectionStateCb: (state) => console.log(`connection state ${state}`),
});

const wat = await client['/wat'].get();
console.log('get wat', wat);

const setResult = await client['/posts/new'].set({
	request: { content: 'sick post' },
});
console.log('set', setResult);
const posts = await client['/posts'].get();
console.log('get posts', posts);
const post = await client['/posts/:postId'].get({
	params: { postId: setResult.id },
});
console.log('get post', post);

client['/posts/:postId']
	.subscribe({
		params: { postId: setResult.id },
	})
	.subscribe({
		next: (post) => {
			console.log('post event', post);
		},
	});

await client['/posts/:postId'].set({
	params: { postId: setResult.id },
	request: { content: 'more sick post' },
});

// await sleep(1000);
// subscription.unsubscribe();
await client['/posts/:postId'].set({
	params: { postId: '123' },
	request: { content: '999' },
});

await client['/posts/:postId/comments/:commentId'].set({
	params: { postId: 123, commentId: 456 },
	request: { content: 'sick comment' },
});
const post123comments = await client['/posts/:postId/comments'].get({
	params: { postId: 123 },
});
console.log('get /posts/123/comments', post123comments);

function sleep(timeout: number) {
	new Promise<void>((res) => setTimeout(() => res(), timeout));
}
