import { WebSocketServer } from 'ws';
import { initServer as uncontrainedInitServer } from 'smolrpc';
import { router } from './router.js';

/**
 * @typedef {import("../resources.ts").Resources} Resources
 * @typedef {import("smolrpc").Router<Resources>} Router
 * @typedef {import("smolrpc").WS} WS
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
