import { initServer } from '../mini-rpc/init-server.js';
import { router } from '../server/router.ts';

const miniRpcServer = initServer(router);

Deno.serve({ port: 9200, hostname: 'localhost' }, (req) => {
	if (req.headers.get('upgrade') != 'websocket') {
		return new Response(null, { status: 501 });
	}

	const { socket, response } = Deno.upgradeWebSocket(req);

	miniRpcServer.addConnection(123);
	return response;
});
