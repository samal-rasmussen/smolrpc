import { WebSocketServer } from 'ws';
import { initServer as uncontrainedInitServer } from '../../src/init-server.js';
import { router } from './router.js';

/**
 * @typedef {import("../resources.ts").Resources} Resources
 * @typedef {import("../../src/server.types.ts").Router<Resources>} Router
 * @typedef {import("../../src/websocket.types.ts").WS} WS
 */

const initServer =
	/** @type {(router: Router) => ReturnType<uncontrainedInitServer>} */ (
		uncontrainedInitServer
	);

const server = initServer(router);
const wss = new WebSocketServer({ port: 9200 });

wss.on('connection', function connection(/** @type {WS} */ ws) {
	server.addConnection(ws);
});
