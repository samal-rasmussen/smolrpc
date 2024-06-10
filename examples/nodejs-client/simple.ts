import { WebSocket as ws } from 'ws';

import { initClient } from '../../src/init-client';
import { SimpleResources } from '../simple-resources';

global.WebSocket = ws as any;

const { client } = await initClient<SimpleResources>({
	url: 'ws://localhost:9200',
});

// type: { content: string; id: string; }[]
const posts = await client['/posts'].get();
// type: { content: string; id: string; }
const post123 = await client['/posts/:postId'].get({
	params: { postId: 123 },
});
client['/posts/:postId']
	.subscribe({
		params: { postId: 123 },
		cache: false,
	})
	.subscribe({
		next: (post) => {
			console.log('event', post);
		},
	});
await client['/posts/:postId/create'].set({
	params: { postId: 123 },
	request: { content: 'sick post' },
});

const post2 = await client['/posts/:postId'].get({
	params: { postId: 123 },
});
