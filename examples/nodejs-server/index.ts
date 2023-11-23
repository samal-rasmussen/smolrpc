import { IncomingMessage } from 'http';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

import { initServer } from '../../src/init-server.js';
import { Response } from '../../src/message.types.js';
import { Resources, resources } from '../resources.js';
import { router } from './router.js';

const smolrpcServer = initServer<Resources>(router, resources, {
	serverLogger: {
		receivedRequest: (request, clientId, remoteAddress) => {
			console.log(
				`${clientId} ${remoteAddress} ${JSON.stringify(request)}`,
			);
		},
		sentResponse: (
			request,
			response: Response<Resources>,
			clientId,
			remoteAddress,
		) => {
			console.log(
				'sent response',
				request,
				response,
				clientId,
				remoteAddress,
			);
		},
		sentEvent: (request, event, clientId, remoteAddress) => {
			console.log('sent event', request, event, clientId, remoteAddress);
		},
		sentReject: (request, reject, clientId, remoteAddress) => {
			console.log(
				'sent reject',
				request,
				reject,
				clientId,
				remoteAddress,
			);
		},
	},
});

const wss = new WebSocketServer({ noServer: true });
wss.on('connection', function connection(ws, req) {
	const remoteAddress = getRemoteAddress(req);
	smolrpcServer.addConnection(
		{
			addEventListener: ws.addEventListener.bind(ws),
			send: ws.send.bind(ws),
		},
		remoteAddress,
	);
});

const httpServer = createServer();
httpServer.on('upgrade', (request, socket, head) => {
	wss.handleUpgrade(request, socket, head, (ws) => {
		wss.emit('connection', ws, request);
	});
});
const port = 9200;
const host = 'localhost';
httpServer.listen(port, host, () => {
	console.log(`http server listening on ${host}:${port}`);
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
