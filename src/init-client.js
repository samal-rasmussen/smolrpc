import { initClientProxy } from './init-client-proxy.js';
import { initClientWebSocket } from './init-client-websocket.js';

/**
 * @typedef {import("./message.types").Request<any>} Request
 */

/**
 * @template {import("./types").AnyResources} Resources
 * @param {{
 * 	url: string,
 *  createWebSocket?: (url: string) => WebSocket,
 *  onopen?: (e: Event) => void,
 *  onmessage?: (e: MessageEvent) => void,
 *  onreconnect?: () => void,
 *  onclose?: (e: CloseEvent) => void,
 *  onerror?: (e: Event) => void,
 *  onsend?: (r: Request) => void,
 * }} args
 * @return {{
 *  client: import("./client.types").Client<Resources>,
 *  clientMethods: import("./client.types").ClientMethods,
 * }}
 */
export function initClient({
	url,
	createWebSocket,
	onopen,
	onmessage,
	onreconnect,
	onclose,
	onerror,
	onsend,
}) {
	if (createWebSocket == null && globalThis.WebSocket == null) {
		throw new Error(
			`initClient: globalThis.WebSocket not found. ` +
				`When runnin initClient on runtimes like nodejs that don't have ` +
				`a WebSocket client built in, you will need to pass in a createWebSocket ` +
				`helper function that returns a new WebSocket client instance.`,
		);
	}
	const cWebSocket =
		createWebSocket == null
			? (createWebSocket = (url) => {
					return new WebSocket(url);
			  })
			: createWebSocket;

	const clientWebSocket = initClientWebSocket({
		url,
		createWebSocket: cWebSocket,
		onopen: (e) => {
			onopen?.(e);
			clientProxyResult.onopen(e);
		},
		onmessage: (e) => {
			onmessage?.(e);
			clientProxyResult.onmessage(e);
		},
		onreconnect,
		onclose,
		onerror,
		onsend,
	});

	const clientProxyResult = initClientProxy(clientWebSocket);
	clientWebSocket.open();
	const client = /** @type {import("./client.types").Client<Resources>} */ (
		clientProxyResult.proxy
	);
	return {
		client,
		clientMethods: {
			open: clientWebSocket.open,
			close: clientWebSocket.close,
		},
	};
}

export { dummyClient } from './init-client-proxy.js';
