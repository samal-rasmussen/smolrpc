import { initClient } from '../../src/init-client';
import { SimpleResources } from '../simple-resources';

const client = await initClient<SimpleResources>({
	url: 'ws://localhost:9200',
});

// type: { content: string; id: string; }[]
const posts = await client['/posts'].get();
// type: { content: string; id: string; }
const post123 = await client['/posts/:id'].get({
	params: { id: 123 },
});
client['/posts/:id']
	.subscribe({
		params: { id: 123 },
	})
	.subscribe({
		next: (post) => {
			console.log(post);
		},
	});
await client['/posts/:id'].set({
	params: { id: '123' },
	request: { content: 'sick post' },
});
