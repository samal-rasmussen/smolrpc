import { initClientProxy } from './init-client-proxy.js';
import { initClientWebSocket } from './init-client-websocket.js';
import { safeInvoke } from './safe-invoke.js';

/**
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
				`When running initClient on runtimes like nodejs that don't have ` +
				`a WebSocket client built in, you will need to pass in a createWebSocket ` +
				`helper function that returns a new WebSocket client instance.`,
		);
	}
	if (reportInternalError == null || webSocketEvents == null) {
		throw new Error(
			`initClient: reportInternalError and webSocketEvents are required`,
		);
	}

	const create =
		createWebSocket ??
		((socketUrl) => {
			return new WebSocket(socketUrl);
		});
	/** @type {(message: string, data: Record<string, unknown>) => void} */
	const report = (message, data) => {
		safeInvoke(
			'initClient.reportInternalError',
			reportInternalError,
			message,
			data,
		);
	};

	/**
	 * Assigned before the initial connection attempt. Native messages cannot be
	 * accepted until a generation has been published.
	 * @type {(generation: any, event: MessageEvent) => void}
	 */
	let dispatchMessage;
	const clientWebSocket = initClientWebSocket({
		url,
		createWebSocket: create,
		reportInternalError: report,
		dispatchMessage: (generation, event) => {
			dispatchMessage(generation, event);
		},
		onstatechange: (state) => {
			safeInvoke(
				'initClient.webSocketEvents.statechange',
				webSocketEvents.statechange,
				state,
			);
		},
		onopen: (event) => {
			safeInvoke(
				'initClient.webSocketEvents.open',
				webSocketEvents.open,
				event,
			);
		},
		onmessage: (event) => {
			safeInvoke(
				'initClient.webSocketEvents.message',
				webSocketEvents.message,
				event,
			);
		},
		onreconnect: () => {
			safeInvoke(
				'initClient.webSocketEvents.reconnect',
				webSocketEvents.reconnect,
			);
		},
		onclose: (event) => {
			safeInvoke(
				'initClient.webSocketEvents.close',
				webSocketEvents.close,
				event,
			);
		},
		onerror: (event) => {
			safeInvoke(
				'initClient.webSocketEvents.error',
				webSocketEvents.error,
				event,
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

	const clientProxy = initClientProxy(clientWebSocket, report);
	dispatchMessage = clientProxy.onmessage;
	clientWebSocket.open();

	return {
		client: /** @type {import("./client.types").Client<Resources>} */ (
			clientProxy.proxy
		),
		clientMethods: {
			open: clientWebSocket.open,
			close: clientWebSocket.close,
			restart: clientWebSocket.restart,
			invalidate: clientWebSocket.invalidate,
		},
	};
}

export { dummyClient } from './init-client-proxy.js';
