import { initClientProxy } from './init-client-proxy.js';
import { initClientWebSocket } from './init-client-websocket.js';
import { safeInvoke } from './safe-invoke.js';

/**
 * @typedef {import("./message.types").Request<any>} Request
 * @typedef {import("./client.types").ClientWebSocketEvents} ClientWebSocketEvents
 */

/**
 * @template {import("./types").AnyResources} Resources
 * @param {{
 *  url: string,
 *  createWebSocket?: (url: string) => WebSocket,
 *  reportInternalError: (message: string, data: Record<string, unknown>) => void,
 *  webSocketEvents: ClientWebSocketEvents,
 * }} args
 * @return {{
 *  client: import("./client.types").Client<Resources>,
 *  clientMethods: import("./client.types").ClientMethods,
 * }}
 */
export function initClient({
	url,
	createWebSocket,
	reportInternalError,
	webSocketEvents,
}) {
	if (createWebSocket == null && globalThis.WebSocket == null) {
		throw new Error(
			`initClient: globalThis.WebSocket not found. ` +
				`When runnin initClient on runtimes like nodejs that don't have ` +
				`a WebSocket client built in, you will need to pass in a createWebSocket ` +
				`helper function that returns a new WebSocket client instance.`,
		);
	}
	if (reportInternalError == null || webSocketEvents == null) {
		throw new Error(
			`initClient: reportInternalError and webSocketEvents are required`,
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
		reportInternalError: (message, data) => {
			safeInvoke(
				'initClient.reportInternalError',
				reportInternalError,
				message,
				data,
			);
		},
		onopen: (e) => {
			/**
			 * clientProxyOnopen must be called before webSocketEvents.open
			 *
			 * clientProxyOnopen will reset the client and set it to be ready to use.
			 * webSocketEvents.open will notify the user that the client is ready to use.
			 *
			 * Calling webSocketEvents.open before clientProxyOnopen will cause lost messages,
			 * because it may trigger the user to make requests, which will be lost when
			 * clientProxy will be reset when calling clientProxyOnopen.
			 */
			clientProxyOnopen(e);
			safeInvoke(
				'initClient.webSocketEvents.open',
				webSocketEvents.open,
				e,
			);
		},
		onmessage: (e) => {
			/**
			 * webSocketEvents.message must be called before clientProxyOnmessage
			 *
			 * webSocketEvents.message is only meant for debug logging.
			 * clientProxyOnmessage will process the message and trigger the listeners.
			 * We want to see the raw messages logged before they are processed by the client.
			 */
			safeInvoke(
				'initClient.webSocketEvents.message',
				webSocketEvents.message,
				e,
			);
			clientProxyOnmessage(e);
		},
		onreconnect: () => {
			safeInvoke(
				'initClient.webSocketEvents.reconnect',
				webSocketEvents.reconnect,
			);
		},
		onclose: (e) => {
			safeInvoke(
				'initClient.webSocketEvents.close',
				webSocketEvents.close,
				e,
			);
		},
		onerror: (e) => {
			safeInvoke(
				'initClient.webSocketEvents.error',
				webSocketEvents.error,
				e,
			);
		},
		onsend: (request) => {
			safeInvoke(
				'initClient.webSocketEvents.send',
				webSocketEvents.send,
				request,
			);
		},
	});

	const {
		proxy,
		onmessage: clientProxyOnmessage,
		onopen: clientProxyOnopen,
	} = initClientProxy(clientWebSocket, (message, data) => {
		safeInvoke(
			'initClient.reportInternalError',
			reportInternalError,
			message,
			data,
		);
	});
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
