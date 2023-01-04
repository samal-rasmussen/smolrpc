import { makeClient } from './client.js';

const client = await makeClient();

const result1 = await client['/resourceA'].get({
	params: null,
});
console.log('result 1', result1);

const result2 = await client['/resourceB/:id'].get({
	params: { id: '123' },
});
console.log('result 2', result2);

client['/resourceB/:id']
	.subscribe({
		params: { id: '123' },
	})
	.subscribe({
		next: (val) => {
			console.log('received subscription val', val);
		},
	});

await client['/resourceB/:id'].set({
	request: { name: '321' },
	params: { id: '123' },
});
