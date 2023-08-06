/**
 * @typedef {import("./types").AnyResources} AnyResources
 * @typedef {import("./types").Subscribable<any>} Subscribable
 * @typedef {import("./message.types").Params} Params
 * @typedef {import("./message.types").Reject<any>} Reject
 * @typedef {import("./message.types").Request<any>} Request
 * @typedef {import("./message.types").Response<any>} Response
 * @typedef {import("./message.types").SubscribeEvent<any>} SubscribeEvent
 */

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
 * @template {AnyResources} Resources
 * @param {{
 * 	url: string,
 * 	connectionStateCb?: (connectionState: import("./client.types").ConnectionState) => void}
 * } args
 * @return {Promise<import("./client.types").Client<Resources>>}
 */
export async function initClient({ url, connectionStateCb }) {
	if (globalThis.WebSocket == null) {
		throw new Error(
			`initClient: globalThis.WebScoket not found. On nodejs you will need to polyfill globalThis.WebSocket.`,
		);
	}
	return new Promise((resolve) => {
		/** @type {WebSocket | undefined} */
		let websocket;
		let reopenCount = 0;
		/** @type {NodeJS.Timeout | undefined} */
		let reopenTimeoutHandler;
		const reopenTimeouts = [2000, 5000, 10000, 15000];

		function close() {
			if (reopenTimeoutHandler) {
				clearTimeout(reopenTimeoutHandler);
				reopenTimeoutHandler = undefined;
			}

			if (websocket) {
				websocket.close();
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
					n >= reopenTimeouts.length - 1
						? reopenTimeouts.length - 1
						: n
				];
			const withJitter = addRandomJitter(timeout, 20);
			return withJitter;
		}

		function open() {
			if (reopenTimeoutHandler) {
				clearTimeout(reopenTimeoutHandler);
				reopenTimeoutHandler = undefined;
			}
			if (websocket) {
				console.warn('initClient.open: websocket already open');
				return;
			}
			websocket = new WebSocket(url);
			websocket.addEventListener('open', () => {
				// console.log('initClient: websocket connected');
				if (sendQueue.length > 0) {
					for (const request of sendQueue) {
						sendRequest(request);
					}
					sendQueue.length = 0;
				}
				reopenCount = 0;
				connectionStateCb?.('online');
			});
			websocket.addEventListener('close', (event) => {
				// console.log(
				// 	'initClient: websocket closed',
				// 	event.type,
				// 	event.code,
				// 	event.reason,
				// );
				close();
				reopenTimeoutHandler = setTimeout(() => {
					connectionStateCb?.('reconnecting');
					open();
				}, getWaitTime());
				connectionStateCb?.('offline');
			});
			websocket.addEventListener('error', (event) => {
				// console.log('initClient: websocket error', event);
			});
			websocket.addEventListener('message', (event) => {
				// console.log(
				// 	'initClient: websocket message',
				// 	event.type,
				// 	typeof event.data,
				// 	event.data,
				// );
				/** @type { Response | SubscribeEvent | Reject} */
				const response = JSON.parse(event.data);
				const id =
					response.type === 'Reject'
						? response.request.id
						: response.id;
				const listener = listeners.get(id);
				if (listener == null) {
					console.error(
						`No listener found for response/event`,
						response,
					);
					return;
				}
				listener(response);
			});
		}

		/**
		 * @type {Map<number, (msg: Response | SubscribeEvent | Reject) => void>}
		 */
		const listeners = new Map();
		let id = 0;

		/** @type {Request[]} */
		const sendQueue = [];

		/**
		 * @param {Request} request
		 */
		function sendRequest(request) {
			if (websocket == null || websocket.readyState !== WebSocket.OPEN) {
				sendQueue.push(request);
				return;
			}
			// TODO: Add timeout that will console log error after 30s
			websocket.send(JSON.stringify(request));
		}

		/**
		 * @param {PropertyKey} resource
		 * @param {Params} params
		 * @returns {Promise<unknown>}
		 */
		function getHandler(resource, params) {
			return new Promise((resolve, reject) => {
				const msgId = ++id;
				sendRequest({
					id: msgId,
					resource,
					params,
					type: 'GetRequest',
				});
				// TODO: Handle request timeout
				listeners.set(msgId, (msg) => {
					listeners.delete(msgId);
					if (msg.type === 'Reject') {
						reject(msg.error);
					} else if (msg.type === 'GetResponse') {
						resolve(msg.data);
					} else {
						console.error(
							`Unexpected message type in get listener`,
							msg,
						);
					}
				});
			});
		}
		/**
		 * @param {PropertyKey} resource
		 * @param {any} request
		 * @param {Params} params
		 * @returns {Promise<unknown>}
		 */
		function setHandler(resource, request, params) {
			return new Promise((resolve, reject) => {
				const msgId = ++id;
				sendRequest({
					id: msgId,
					resource,
					data: request,
					params,
					type: 'SetRequest',
				});
				// TODO: Handle request timeout
				listeners.set(msgId, (msg) => {
					listeners.delete(msgId);
					if (msg.type === 'Reject') {
						reject(msg.error);
					} else if (msg.type === 'SetSuccess') {
						resolve(undefined);
					} else {
						console.error(
							`Unexpected message type in set listener`,
							msg,
						);
					}
				});
			});
		}
		/**
		 *
		 * @param {PropertyKey} resource
		 * @param {Params} params
		 * @returns {Subscribable}
		 */
		function subscribeHandler(resource, params) {
			return {
				subscribe: (observer) => {
					const msgId = ++id;
					sendRequest({
						id: msgId,
						resource,
						params,
						type: 'SubscribeRequest',
					});
					// TODO: Handle request timeout
					listeners.set(msgId, (msg) => {
						if (msg.type === 'Reject') {
							observer.error?.(msg.error);
						} else if (msg.type === 'SubscribeEvent') {
							observer.next?.(msg.data);
						} else if (msg.type === 'SubscribeAccept') {
							// Happy path. Nothing to do.
						} else {
							console.error(
								`Unexpected message type in get listener`,
								msg,
							);
						}
					});
					return {
						unsubscribe: () => {
							listeners.delete(msgId);
							const unsubMsgId = ++id;
							sendRequest({
								id: unsubMsgId,
								params,
								resource,
								type: 'UnsubscribeRequest',
							});
							listeners.set(unsubMsgId, (msg) => {
								if (msg.type === 'Reject') {
									observer.error?.(msg.error);
								} else if (msg.type === 'UnsubscribeAccept') {
									// Happy path. Nothing to do.
								} else {
									console.error(
										`Unexpected message type in get listener`,
										msg,
									);
								}
							});
						},
					};
				},
			};
		}

		/** @type {any} */
		const proxy = new Proxy(
			{},
			{
				get(target, /** @type {any} */ p, receiver) {
					return {
						get: (/** @type {{ params: Params; }} */ args) =>
							getHandler(p, args?.params),
						set: (
							/** @type {{ params: Params; request: any }} */ {
								request,
								params,
							},
						) => setHandler(p, request, params),
						subscribe: (/** @type {{ params: Params; }} */ args) =>
							subscribeHandler(p, args?.params),
					};
				},
			},
		);

		open();
		resolve(proxy);
	});
}
