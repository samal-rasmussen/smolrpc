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
console.log('get /resourceA', result1);

const result2 = await client['/resourceB/:id'].get({
	params: { id: '123' },
});
console.log('get /resourceB/:id', result2);

const subscription = client['/resourceB/:id']
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
await sleep(1000);
subscription.unsubscribe();
await client['/resourceB/:id'].set({
	params: { id: '123' },
	request: { key: '999' },
});

await client['/resourceB/:id/resourceC/:key'].set({
	params: { id: '123', key: '456' },
	request: { key: '888' },
});
const result3 = await client['/resourceB/:id/resourceC/:key'].get({
	params: { id: '123', key: '456' },
});
console.log('get /resourceB/:id/resourceC/:key', result3);

/**
 * @param {number} timeout
 * @return {void}
 */
function sleep(timeout) {
	/** @type {Promise<void>} */ (
		new Promise((res) => setTimeout(() => res(), timeout))
	);
}
