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
			/**
			 * clientProxyOnopen must be called before onopen
			 *
			 * clientProxyOnopen will reset the client and set it to be ready to use.
			 * onopen will notify the user that the client is ready to use.
			 *
			 * Calling onopen before clientProxyOnopen will cause lost messages,
			 * because it may trigger the user to make requests, which will be lost when
			 * clientProxy will be reset when calling clientProxyOnopen.
			 */
			clientProxyOnopen(e);
			onopen?.(e);
		},
		onmessage: (e) => {
			/**
			 * onmessage must be called before clientProxyOnmesage
			 *
			 * onmessage is only meant for debug logging.
			 * clientProxyOnmesage will process the message and trigger the listeners.
			 * We want to see the raw messages logged before they are processed by the client.
			 */
			onmessage?.(e);
			clientProxyOnmesage(e);
		},
		onreconnect,
		onclose,
		onerror,
		onsend,
	});

	const {
		proxy,
		onmessage: clientProxyOnmesage,
		onopen: clientProxyOnopen,
	} = initClientProxy(clientWebSocket);
	clientWebSocket.open();
	return {
		client: /** @type {import("./client.types").Client<Resources>} */ (
			proxy
		),
		clientMethods: {
			open: clientWebSocket.open,
			close: clientWebSocket.close,
		},
	};
}

export { dummyClient } from './init-client-proxy.js';
