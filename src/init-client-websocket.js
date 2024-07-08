/**
 * @typedef {import("./message.types").Request<any>} Request
 */

import { json_stringify } from './shared.js';

export const ReadyStates = Object.freeze({
	CONNECTING: 0,
	OPEN: 1,
	CLOSING: 2,
	CLOSED: 3,
});
/** @typedef {typeof ReadyStates[keyof typeof ReadyStates]} ReadyState */

/**
 * @param {number} number
 * @param {number} jitterPercentage
 * @returns {number}
 */
function addRandomJitter(number, jitterPercentage) {
	var jitter =
		Math.random() * (jitterPercentage / 100) * 2 * number -
		(jitterPercentage / 100) * number;
	return number + jitter;
}

/**
 * @param {{
 * 	url: string,
 *  createWebSocket: (url: string) => WebSocket,
 *  onopen: (e: Event) => void,
 *  onmessage: (e: MessageEvent) => void,
 *  onreconnect?: () => void,
 *  onclose?: (e: CloseEvent) => void,
 *  onerror?: (e: Event) => void,
 *  onsend?: (r: Request) => void,
 * }} args
 * @return {{
 *  close: () => void
 *  open: () => void
 *  send: (request: Request) => void,
 *  readyState: ReadyState
 * }}
 */
export function initClientWebSocket({
	url,
	createWebSocket,
	onopen,
	onmessage,
	onreconnect,
	onclose,
	onerror,
	onsend,
}) {
	/** @type {WebSocket | undefined} */
	let websocket;
	let reopenCount = 0;
	/** @type {NodeJS.Timeout | undefined} */
	let reopenTimeoutHandler;
	const reopenTimeouts = [1000, 2000, 5000, 10000];

	function close() {
		if (reopenTimeoutHandler) {
			clearTimeout(reopenTimeoutHandler);
			reopenTimeoutHandler = undefined;
		}

		if (websocket) {
			// Mark the websocket as closed, so we know not to run the reopen timer
			// in the onclose handler.
			/**@type {WebSocket & {isClosed: boolean}} */ (
				websocket
			).isClosed = true;
			websocket.close(1000, 'close was called');
			websocket = undefined;
		}
	}

	/**
	 * @returns {number}
	 */
	function getWaitTime() {
		const n = reopenCount;
		reopenCount++;

		const timeout =
			reopenTimeouts[
				n >= reopenTimeouts.length - 1 ? reopenTimeouts.length - 1 : n
			];
		const withJitter = addRandomJitter(timeout, 20);
		return withJitter;
	}

	function open() {
		if (reopenTimeoutHandler) {
			clearTimeout(reopenTimeoutHandler);
			reopenTimeoutHandler = undefined;
		}
		if (
			websocket != null &&
			!(
				websocket?.readyState === ReadyStates.CLOSED ||
				websocket?.readyState === ReadyStates.CLOSED
			)
		) {
			throw new Error(`initClient.open: websocket isn't closed`);
		}
		websocket = createWebSocket(url);
		websocket.onopen = (event) => {
			returnObject.readyState = ReadyStates.OPEN;
			reopenCount = 0;
			onopen(event);
		};
		websocket.onclose = (event) => {
			returnObject.readyState = ReadyStates.CLOSED;
			const target = /**@type {WebSocket & {isClosed: boolean}} */ (
				event.target
			);
			if (!target.isClosed) {
				reopenTimeoutHandler = setTimeout(() => {
					if (target.readyState !== ReadyStates.CLOSED) {
						throw new Error(
							`initClient.reconnect: websocket isn't closed ${target.readyState}`,
						);
					}
					returnObject.readyState = ReadyStates.CONNECTING;
					open();
					onreconnect?.();
				}, getWaitTime());
			}
			onclose?.(event);
		};
		websocket.onerror = (event) => {
			returnObject.readyState = ReadyStates.CLOSING;
			onerror?.(event);
		};
		websocket.onmessage = (event) => {
			onmessage(event);
		};
	}

	/**
	 * @param {Request} request
	 */
	function send(request) {
		if (websocket == null || websocket.readyState !== ReadyStates.OPEN) {
			console.error('initClientWebSocket.send:websocket not open', {
				request,
			});
			throw new Error('initClientWebSocket.send:websocket not open');
		}
		// TODO: Add timeout that will console log error after 30s
		onsend?.(request);
		websocket.send(json_stringify(request));
	}

	const returnObject = {
		close,
		open,
		send,
		/** @type {ReadyState} */
		readyState: ReadyStates.CONNECTING,
	};
	return returnObject;
}
