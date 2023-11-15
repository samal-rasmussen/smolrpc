import { WebSocketServer } from 'ws';

import { initServer } from '../init-server';
import { Resources, resources } from './resources';
import { router } from './router';

function setupServer() {
	const server = initServer<Resources>(router, resources);
	const wss = new WebSocketServer({ port: 9200 });

	wss.on('connection', function connection(ws, req) {
		server.addConnection(ws as any);
	});
}
