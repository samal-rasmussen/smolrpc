import { makeClient } from '../mini-rpc/make-client.js';
import { Resources } from '../shared/resources.js';

const client = await makeClient<Resources>();

const result1 = await client['/resourceA'].get();
console.log('get /resourceA', result1);

const result2 = await client['/resourceB/:id'].get({
	params: { id: '123' },
});
console.log('get /resourceB/:id', result2);

client['/resourceB/:id']
	.subscribe({
		params: { id: '123' },
	})
	.subscribe({
		next: (val) => {
			console.log('subscription val /resourceB/:id', val);
		},
	});

await client['/resourceB/:id'].set({
	params: { id: '123' },
	request: { key: '321' },
});
