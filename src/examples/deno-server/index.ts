import { initServer } from '../../mini-rpc/init-server.js';
import { router } from '../nodejs-server/router.js';
import type { Resources } from '../resources.ts';

const miniRpcServer = initServer<Resources>(router);

Deno.serve({ port: 9200, hostname: 'localhost' }, (req) => {
	if (req.headers.get('upgrade') != 'websocket') {
		return new Response(null, { status: 501 });
	}

	const { socket, response } = Deno.upgradeWebSocket(req);

	miniRpcServer.addConnection(socket);
	return response;
});
