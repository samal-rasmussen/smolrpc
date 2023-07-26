import { WebSocketServer } from 'ws';
import { initServer } from '../mini-rpc/init-server.js';
import { Resources } from '../shared/resources.js';
import { router } from './router.js';

const miniRpcServer = initServer<Resources>(router);
const wss = new WebSocketServer({ port: 9200 });

wss.on('connection', function connection(ws) {
	miniRpcServer.addConnection(ws);
});
