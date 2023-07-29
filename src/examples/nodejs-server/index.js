import { WebSocketServer } from 'ws';
import { initServer as uncontrainedInitServer } from '../../init-server.js';
import { router } from './router.js';

/**
 * @typedef {import("../resources.ts").Resources} Resources
 * @typedef {import("../../server.types.ts").Router<Resources>} Router
 */

const initServer =
	/** @type {(router: Router) => ReturnType<uncontrainedInitServer>} */ (
		uncontrainedInitServer
	);

const miniRpcServer = initServer(router);
const wss = new WebSocketServer({ port: 9200 });

wss.on('connection', function connection(ws) {
	miniRpcServer.addConnection(ws);
});
