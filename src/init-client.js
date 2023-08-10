/**
 * @typedef {import("./types").AnyResources} AnyResources
 * @typedef {import("./types").Subscribable<any>} Subscribable
 * @typedef {import("./message.types").Params} Params
 * @typedef {import("./message.types").Reject<any>} Reject
 * @typedef {import("./message.types").Request<any>} Request
 * @typedef {import("./message.types").Response<any>} Response
 * @typedef {import("./message.types").SubscribeEvent<any>} SubscribeEvent
 */

import { getResourceWithParams } from './shared.js';

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

				// The server clears all pending requests and subscriptions on disconnect,
				// so we need to start from scratch on the client.
				id = 0;
				// Don't overwrite existing listeners map yet, because we reuse listeners for
				// sendQueue and resubscribe below.
				const newListeners = new Map();
				reopenCount = 0;

				// All requests are queued while the websocket isn't connected. These are sent now.
				if (sendQueue.length > 0) {
					for (const request of sendQueue) {
						const requestId = ++id;
						const listener = listeners.get(request.id);
						newListeners.set(requestId, listener);
						request.id = requestId;
						sendRequest(request);
					}
					sendQueue.length = 0;
				}

				// Resubscribe old existing subscriptions
				for (const subscriptionData of subscriptions.values()) {
					if (subscriptionData.requestId == null) {
						return;
					}
					const oldListener = listeners.get(
						subscriptionData.requestId,
					);
					if (oldListener == null) {
						throw new Error(
							`initClient: on open resubscript did not find old listener. requestId: ${subscriptionData.requestId}`,
						);
					}
					const newRequestId = ++id;
					subscriptionData.requestId = newRequestId;
					newListeners.set(newRequestId, oldListener);
					sendRequest({
						id: newRequestId,
						resource: oldListener.resource,
						params: oldListener.params,
						type: 'SubscribeRequest',
					});
				}
				listeners = newListeners;

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
				if (listener.type !== 'subscribe') {
					listeners.delete(id);
				}
				listener.listener(response);
			});
		}

		/**
		 * @type {Map<number, {
		 * 	listener: (msg: Response | SubscribeEvent | Reject) => void,
		 * 	params: Params,
		 * 	resource: string,
		 *  type: 'get' | 'set' | 'subscribe' | 'unsubscribe'
		 * }>}
		 */
		let listeners = new Map();

		/** @type {number} */
		let id = 0;

		/** @type {Request[]} */
		const sendQueue = [];

		/** @type {Map<string, {
		 * 	subscribable: Subscribable,
		 * 	requestId: number | undefined
		 * }>} */
		const subscriptions = new Map();

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
		 * @param {string} resource
		 * @param {Params} params
		 * @returns {Promise<unknown>}
		 */
		function getHandler(resource, params) {
			return new Promise((resolve, reject) => {
				const requestId = ++id;
				// TODO: Handle request timeout
				listeners.set(requestId, {
					listener: (msg) => {
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
					},
					params,
					resource,
					type: 'get',
				});
				sendRequest({
					id: requestId,
					resource,
					params,
					type: 'GetRequest',
				});
			});
		}
		/**
		 * @param {string} resource
		 * @param {any} request
		 * @param {Params} params
		 * @returns {Promise<unknown>}
		 */
		function setHandler(resource, request, params) {
			return new Promise((resolve, reject) => {
				const requestId = ++id;
				// TODO: Handle request timeout
				listeners.set(requestId, {
					listener: (msg) => {
						if (msg.type === 'Reject') {
							reject(msg.error);
						} else if (msg.type === 'SetSuccess') {
							resolve(msg.data);
						} else {
							console.error(
								`Unexpected message type in set listener`,
								msg,
							);
						}
					},
					params,
					resource,
					type: 'set',
				});
				sendRequest({
					id: requestId,
					resource,
					data: request,
					params,
					type: 'SetRequest',
				});
			});
		}
		/**
		 *
		 * @param {string} resource
		 * @param {Params} params
		 * @returns {Subscribable}
		 */
		function subscribeHandler(resource, params) {
			const resourceWithParams = getResourceWithParams(resource, params);
			const existing = subscriptions.get(resourceWithParams);
			if (existing) {
				return existing.subscribable;
			}
			/** @type {Set<Partial<import("./types").Observer<any>>>} */
			const observers = new Set();
			/** @type {(() => void) | undefined} */
			let unsubscribeFn = undefined;
			/** @type {Subscribable} */
			const subscribable = {
				subscribe: (observer) => {
					if (observers.size > 0) {
						observers.add(observer);
						return {
							unsubscribe: () => {
								observers.delete(observer);
								unsubscribeFn?.();
							},
						};
					}
					subscriptionData.requestId = ++id;
					observers.add(observer);
					unsubscribeFn = () => {
						if (observers.size > 1) {
							return;
						}
						if (typeof subscriptionData.requestId !== 'number') {
							throw new Error(
								`initClient: Unsubscribe error. No requestId found. requestId was${subscriptionData.requestId}`,
							);
						}
						listeners.delete(subscriptionData.requestId);
						const unsubRequestId = ++id;
						sendRequest({
							id: unsubRequestId,
							params,
							resource,
							type: 'UnsubscribeRequest',
						});
						listeners.set(unsubRequestId, {
							listener: (msg) => {
								if (msg.type === 'Reject') {
									for (const obs of observers) {
										obs.error?.(msg.error);
									}
								} else if (msg.type === 'UnsubscribeAccept') {
									observers.clear();
								} else {
									console.error(
										`Unexpected message type in get listener`,
										msg,
									);
								}
							},
							params,
							resource,
							type: 'unsubscribe',
						});
					};
					// TODO: Handle request timeout
					listeners.set(subscriptionData.requestId, {
						listener: (msg) => {
							if (msg.type === 'Reject') {
								for (const obs of observers) {
									obs.error?.(msg.error);
								}
							} else if (msg.type === 'SubscribeEvent') {
								for (const obs of observers) {
									obs.next?.(msg.data);
								}
							} else if (msg.type === 'SubscribeAccept') {
								// Happy path. Nothing to do.
							} else {
								console.error(
									`Unexpected message type in get listener`,
									msg,
								);
							}
						},
						params,
						resource,
						type: 'subscribe',
					});
					if (typeof subscriptionData.requestId !== 'number') {
						throw new Error(
							`initClient: Send subscription request error. No requestId found. requestId was ${subscriptionData.requestId}`,
						);
					}
					sendRequest({
						id: subscriptionData.requestId,
						resource,
						params,
						type: 'SubscribeRequest',
					});
					return {
						unsubscribe: () => {
							observers.delete(observer);
							unsubscribeFn?.();
						},
					};
				},
			};
			/** @type {{subscribable: Subscribable, requestId: number | undefined}} */
			const subscriptionData = {
				subscribable,
				requestId: undefined,
			};
			subscriptions.set(resourceWithParams, subscriptionData);
			return subscribable;
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
