import { initServer } from 'npm:smolrpc';
import { router } from '../nodejs-server/router.js';
import type { Resources } from '../resources.ts';

const server = initServer<Resources>(router);

Deno.serve({ port: 9200, hostname: 'localhost' }, (req) => {
	if (req.headers.get('upgrade') != 'websocket') {
		return new Response(null, { status: 501 });
	}

	const { socket, response } = Deno.upgradeWebSocket(req);

	server.addConnection(socket);
	return response;
});
