import { WebSocket as WS } from 'ws';
import { initClient } from '../mini-rpc/init-client.js';
import { Resources } from '../shared/resources.js';

const socket = new WS('ws://localhost:9200');
const client = await initClient<Resources>(socket as any as WebSocket);

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

function sleep(timeout: number) {
	new Promise<void>((res) => setTimeout(() => res(), timeout));
}
