import { WebSocketServer } from 'ws';
import { WS, initServer } from '../../src/init-server.js';
import { router } from './router.js';
import { Resources, resources } from '../resources.js';
import { IncomingMessage } from 'http';

const server = initServer<Resources>(router, resources, {
	serverLogger: {
		receivedRequest: (request, clientId, remoteAddress) => {
			console.log(
				`${clientId} ${remoteAddress} ${JSON.stringify(request)}`,
			);
		},
	},
});
const wss = new WebSocketServer({ port: 9200 });

wss.on('connection', function connection(ws, req) {
	const remoteAddress = getRemoteAddress(req);
	server.addConnection(
		{
			addEventListener: ws.addEventListener.bind(ws),
			send: ws.send.bind(ws),
		},
		remoteAddress,
	);
});

function getRemoteAddress(req: IncomingMessage) {
	const remoteAddress = req.socket.remoteAddress;
	if (remoteAddress == null) {
		return undefined;
	}
	const remotePort = req.socket.remotePort;
	if (remotePort == null) {
		return remoteAddress;
	}
	if (req.socket.remoteFamily === 'IPv6') {
		return `[${remoteAddress}]:${remotePort}`;
	}
	return `${remoteAddress}:${remotePort}`;
}
