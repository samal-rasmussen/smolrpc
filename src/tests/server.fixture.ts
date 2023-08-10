import { WebSocketServer } from 'ws';
import { initServer } from '../init-server';
import { router } from './router';
import { Resources, resources } from './resources';

function setupServer() {
	const server = initServer<Resources>(router, resources);
	const wss = new WebSocketServer({ port: 9200 });

	wss.on('connection', function connection(ws, req) {
		server.addConnection(ws as any, req);
	});
}
