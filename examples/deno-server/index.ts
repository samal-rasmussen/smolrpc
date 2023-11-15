import { initServer } from '../../src/init-server.js';
import { router } from '../nodejs-server/router.js';
import { type Resources, resources } from '../resources.ts';

const server = initServer<Resources>(router, resources, {
	serverLogger: {
		receivedRequest: (request, clientId, remoteAddress) => {
			console.log(
				`${clientId} ${remoteAddress} ${JSON.stringify(request)}`,
			);
		},
	},
});

Deno.serve({ port: 9200, hostname: 'localhost' }, (req) => {
	if (req.headers.get('upgrade') != 'websocket') {
		return new Response(null, { status: 501 });
	}

	const { socket, response } = Deno.upgradeWebSocket(req);

	server.addConnection(socket);
	return response;
});
