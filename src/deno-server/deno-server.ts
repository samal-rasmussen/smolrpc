import { initServer } from '../mini-rpc/init-server.ts';
import { router } from './router.ts';

const miniRpcServer = initServer(router);

Deno.serve({ port: 9200, hostname: 'localhost' }, (req) => {
	if (req.headers.get('upgrade') != 'websocket') {
		return new Response(null, { status: 501 });
	}

	const { socket, response } = Deno.upgradeWebSocket(req);

	socket.addEventListener('open', () => {
		console.log('a client connected!');
		miniRpcServer.onConnect(socket);
	});

	socket.addEventListener('message', async (event) => {
		await miniRpcServer.onMessage(event.data, socket);
	});

	return response;
});
