import { WebSocket as ws } from 'ws';
import { initClient } from '../../src/init-client.js';

global.WebSocket = /** @type {any} */ (ws);

/**
 * @typedef {import("../resources.ts").Resources} Resources
 * @typedef {import("../../src/client.types.ts").Client<Resources>} Client
 */
const client = /** @type {Client} */ (
	await initClient({
		url: 'ws://localhost:9200',
	})
);

const result1 = await client['/resourceA'].get();
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
	params: { id: '123' },
	request: { value: '321' },
});
