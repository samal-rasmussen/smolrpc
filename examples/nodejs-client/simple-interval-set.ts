import { WebSocket as ws } from 'ws';

import { initClient } from '../../src/init-client';
import { SimpleResources } from '../simple-resources';

global.WebSocket = ws as any;

const { client } = initClient<SimpleResources>({
	url: 'ws://localhost:9200',
});

client['/posts/:postId']
	.subscribe({
		params: { postId: 123 },
	})
	.subscribe({
		next: (post) => {
			console.log('event', post);
		},
	});

setInterval(async () => {
	await client['/posts/:postId/create'].set({
		params: { postId: 123 },
		request: { content: 'sick post ' + Date.now() },
	});
}, 5347);
