import { ReadyStates } from './init-client-websocket.js';
import { getResourceWithParams, json_parse, json_stringify } from './shared.js';

/**
 * @typedef {import("./types").Subscribable<any>} Subscribable
 * @typedef {import("./message.types").Params} Params
 * @typedef {import("./message.types").RequestReject<any>} RequestReject
 * @typedef {import("./message.types").Reject} Reject
 * @typedef {import("./message.types").Request<any>} Request
 * @typedef {import("./message.types").Response<any>} Response
 * @typedef {import("./message.types").SubscribeEvent<any>} SubscribeEvent
 */

/**
 * @template {import("./types").AnyResources} Resources
 * @param {ReturnType<import("./init-client-websocket").initClientWebSocket>} websocket
 * @return {{
 *  proxy: import("./client.types").Client<Resources>,
 *  onopen: (e: Event) => void,
 *  onmessage: (e: MessageEvent) => void,
 * }}
 */
export function initClientProxy(websocket) {
	/**
	 * @type {Map<number, {
	 * 	listener: (msg: Response | SubscribeEvent | RequestReject) => void,
	 * 	params: Params,
	 * 	resource: string,
	 *  type: 'get' | 'set' | 'subscribe' | 'unsubscribe'
	 * }>}
	 */
	let listeners = new Map();

	/** @type {number} */
	let id = 0;

	/** @type {number} */
	let connection_number = 0;

	/** @type {Map<string, {
	 * 	subscribable: Subscribable,
	 * 	requestId: number | undefined
	 * }>} */
	let subscriptions = new Map();

	/**
	 * @param {string} resource
	 * @param {any} request
	 * @param {Params} params
	 * @returns {Promise<unknown>}
	 */
	function getHandler(resource, request, params) {
		if (websocket.readyState !== ReadyStates.OPEN) {
			console.error('initClientProxy.getHandler: websocket not open', {
				resource,
				request,
				params,
			});
			throw new Error('initClientProxy.getHandler: websocket not open');
		}
		return new Promise((resolve, reject) => {
			const requestId = ++id;
			// TODO: Handle request timeout
			listeners.set(requestId, {
				listener: (msg) => {
					if (msg.type === 'RequestReject') {
						const paramsErrMsg =
							msg.request.params != null
								? ` with params ${JSON.stringify(
										msg.request.params,
								  )}`
								: '';
						const errMsg =
							`Get request on ${msg.request.resource}` +
							paramsErrMsg +
							` rejected with error: ${msg.error}`;
						reject(new Error(errMsg));
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
			websocket.send({
				id: requestId,
				type: 'GetRequest',
				resource,
				params,
				request: request,
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
		if (websocket.readyState !== ReadyStates.OPEN) {
			console.error('initClientProxy.setHandler: websocket not open', {
				resource,
				request,
				params,
			});
			throw new Error('initClientProxy.setHandler: websocket not open');
		}
		return new Promise((resolve, reject) => {
			const requestId = ++id;
			// TODO: Handle request timeout
			listeners.set(requestId, {
				listener: (msg) => {
					if (msg.type === 'RequestReject') {
						const paramsErrMsg =
							msg.request.params != null
								? ` with params ${JSON.stringify(
										msg.request.params,
								  )}`
								: '';
						const errMsg =
							`Set request on ${msg.request.resource}` +
							paramsErrMsg +
							` rejected with error: ${msg.error}`;
						reject(new Error(errMsg));
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
			websocket.send({
				id: requestId,
				type: 'SetRequest',
				resource,
				params,
				request: request,
			});
		});
	}

	/**
	 *
	 * @param {string} resource
	 * @param {any} request
	 * @param {Params} params
	 * @param {boolean} cache
	 * @returns {Subscribable}
	 */
	function subscribeHandler(resource, request, params, cache) {
		if (websocket.readyState !== ReadyStates.OPEN) {
			console.error(
				'initClientProxy.subscribeHandler: websocket not open',
				{
					resource,
					request,
					params,
				},
			);
			throw new Error(
				'initClientProxy.subscribeHandler: websocket not open',
			);
		}
		const resourceWithParams = getResourceWithParams(resource, params);
		if (cache) {
			const cacheKey = getCacheKey(resourceWithParams, request);
			const existing = subscriptions.get(cacheKey);
			if (existing) {
				return existing.subscribable;
			}
		}
		let current_connection_number = connection_number;
		/** @type {Set<Partial<import("./types").Observer<any>>>} */
		const observers = new Set();
		/** @type {(() => void) | undefined} */
		let unsubscribeFn = undefined;
		/** @type {Subscribable} */
		const subscribable = {
			subscribe: (observer) => {
				if (observers.size > 0) {
					// Reuse the existing subscription
					observers.add(observer);
					if (subscriptionData.lastVal !== undefined) {
						observer.next?.(subscriptionData.lastVal);
					}
					return {
						unsubscribe: () => {
							observers.delete(observer);
							unsubscribeFn?.();
						},
					};
				}
				// No existing subscription, create new
				subscriptionData.requestId = ++id;
				observers.add(observer);
				unsubscribeFn = () => {
					if (observers.size > 0) {
						return;
					}
					if (typeof subscriptionData.requestId !== 'number') {
						throw new Error(
							`initClient: Unsubscribe error. No requestId found. requestId was${subscriptionData.requestId}`,
						);
					}
					if (current_connection_number !== connection_number) {
						// The connection has been closed and reopened since this subscription was created.
						// All subscription are cleared on disconnect, so we don't need to send an unsubscribe request.
						return;
					}
					listeners.delete(subscriptionData.requestId);
					if (cache) {
						const cacheKey = getCacheKey(
							resourceWithParams,
							request,
						);
						subscriptions.delete(cacheKey);
					}
					const unsubRequestId = ++id;
					if (websocket.readyState === ReadyStates.OPEN) {
						// No need to send unsubscribe request if the websocket is closed.
						// The server will clear all subscriptions on disconnect.
						websocket.send({
							id: unsubRequestId,
							subscriptionId: subscriptionData.requestId,
							type: 'UnsubscribeRequest',
							resource,
							params,
						});
						listeners.set(unsubRequestId, {
							listener: (msg) => {
								if (msg.type === 'RequestReject') {
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
					}
				};
				// TODO: Handle request timeout
				listeners.set(subscriptionData.requestId, {
					listener: (msg) => {
						if (msg.type === 'RequestReject') {
							for (const obs of observers) {
								obs.error?.(msg.error);
							}
						} else if (msg.type === 'SubscribeEvent') {
							subscriptionData.lastVal = msg.data;
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
				websocket.send({
					id: subscriptionData.requestId,
					type: 'SubscribeRequest',
					resource,
					params,
					request: request,
				});
				return {
					unsubscribe: () => {
						observers.delete(observer);
						unsubscribeFn?.();
					},
				};
			},
		};
		/** @type {{lastVal: any, requestId: number | undefined, subscribable: Subscribable}} */
		const subscriptionData = {
			lastVal: undefined,
			requestId: undefined,
			subscribable,
		};
		if (cache) {
			const cacheKey = getCacheKey(resourceWithParams, request);
			subscriptions.set(cacheKey, subscriptionData);
		}
		return subscribable;
	}

	/** @type {import("./client.types").Client<Resources>} */
	const proxy = /** @type {any} */ (
		new Proxy(
			{},
			{
				get(target, /** @type {string} */ p) {
					return {
						get: (
							/** @type {{ params: Params; request: any } | undefined} */ args,
						) => getHandler(p, args?.request, args?.params),
						set: (
							/** @type {{ params: Params; request: any }} */ args,
						) => setHandler(p, args.request, args.params),
						subscribe: (
							/** @type {{ params: Params; request: any, cache: boolean } | undefined} */ args,
						) =>
							subscribeHandler(
								p,
								args?.request,
								args?.params,
								args?.cache ?? true,
							),
					};
				},
			},
		)
	);

	function onopen() {
		// The server clears all pending requests and subscriptions on disconnect,
		// so we need to start from scratch on the client.
		id = 0;
		listeners = new Map();
		subscriptions = new Map();
		connection_number++;
	}

	/**
	 * @param {MessageEvent} event
	 */
	function onmessage(event) {
		const response = json_parse(event.data);
		if (response.type === 'Reject') {
			console.error('Received Reject response', response);
			return;
		}
		const id =
			response.type === 'RequestReject'
				? response.request.id
				: response.id;
		const listener = listeners.get(id);
		if (listener == null) {
			console.error(`No listener found for response/event`, response);
			return;
		}
		if (listener.type !== 'subscribe') {
			listeners.delete(id);
		}
		listener.listener(response);
	}

	return {
		onmessage,
		onopen,
		proxy,
	};
}

/**
 * @template {import("./types").AnyResources} Resources
 * @return {import("./client.types").Client<Resources>}
 */
export function dummyClient() {
	const noopPromise = new Promise(() => {});
	const noopSubscribable = /** @type {Subscribable} */ ({
		subscribe: () => ({
			unsubscribe: () => {},
		}),
	});
	/** @type {any} */
	const proxy = new Proxy(
		{},
		{
			get() {
				return {
					get: () => noopPromise,
					set: () => noopPromise,
					subscribe: () => noopSubscribable,
				};
			},
		},
	);

	return proxy;
}

/**
 * @param {string} resourceWithParams
 * @param {any} request
 * @returns {string}
 */
function getCacheKey(resourceWithParams, request) {
	if (request == null) {
		return `${resourceWithParams}`;
	}
	return `${resourceWithParams}-${json_stringify(request)}`;
}
