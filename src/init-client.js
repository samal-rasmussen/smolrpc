import { initClientProxy } from './init-client-proxy.js';
import { initClientWebSocket } from './init-client-websocket.js';

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
 * }} args
 * @return {import("./client.types").Client<Resources>}
 */
export function initClient({
	url,
	createWebSocket,
	onopen,
	onmessage,
	onreconnect,
	onclose,
	onerror,
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
			clientProxyResult.onopen(e);
			onopen?.(e);
		},
		onmessage: (e) => {
			clientProxyResult.onmessage(e);
			onmessage?.(e);
		},
		onreconnect,
		onclose,
		onerror,
	});

	const clientProxyResult = initClientProxy(clientWebSocket);

	clientWebSocket.open();
	return /** @type {any} */ (clientProxyResult.proxy);
}

export { dummyClient } from './init-client-proxy.js';
