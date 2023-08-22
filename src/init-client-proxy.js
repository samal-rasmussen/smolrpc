import { ReadyStates } from './init-client-websocket';
import { getResourceWithParams } from './shared.js';

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

	/** @type {Map<string, {
	 * 	subscribable: Subscribable,
	 * 	requestId: number | undefined
	 * }>} */
	const subscriptions = new Map();

	/**
	 * @param {string} resource
	 * @param {Params} params
	 * @returns {Promise<unknown>}
	 */
	function getHandler(resource, params) {
		if (websocket.readyState !== ReadyStates.OPEN) {
			throw new Error('websocket not open');
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
		if (websocket.readyState !== ReadyStates.OPEN) {
			throw new Error('websocket not open');
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
		if (websocket.readyState !== ReadyStates.OPEN) {
			throw new Error('websocket not open');
		}
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
					websocket.send({
						id: unsubRequestId,
						params,
						resource,
						type: 'UnsubscribeRequest',
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
				};
				// TODO: Handle request timeout
				listeners.set(subscriptionData.requestId, {
					listener: (msg) => {
						if (msg.type === 'RequestReject') {
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
				websocket.send({
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

	/** @type {import("./client.types").Client<Resources>} */
	const proxy = /** @type {any} */ (
		new Proxy(
			{},
			{
				get(target, /** @type {string} */ p, receiver) {
					if (p === 'close') {
						return close;
					}
					if (p === 'open') {
						return open;
					}
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
		)
	);

	function onopen() {
		// The server clears all pending requests and subscriptions on disconnect,
		// so we need to start from scratch on the client.
		id = 0;
		// Don't overwrite existing listeners map yet, because we reuse listeners for
		// sendQueue and resubscribe below.
		const newListeners = new Map();

		// Resubscribe old existing subscriptions
		for (const subscriptionData of subscriptions.values()) {
			if (subscriptionData.requestId == null) {
				return;
			}
			const oldListener = listeners.get(subscriptionData.requestId);
			if (oldListener == null) {
				throw new Error(
					`initClient: on open resubscript did not find old listener. requestId: ${subscriptionData.requestId}`,
				);
			}
			const newRequestId = ++id;
			subscriptionData.requestId = newRequestId;
			newListeners.set(newRequestId, oldListener);
			websocket.send({
				id: newRequestId,
				resource: oldListener.resource,
				params: oldListener.params,
				type: 'SubscribeRequest',
			});
		}
		listeners = newListeners;
	}

	/**
	 * @param {MessageEvent} event
	 */
	function onmessage(event) {
		const response = JSON.parse(event.data);
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

const noop = () => {};

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
			get(targeg, p) {
				if (p === 'close') {
					return noop;
				}
				if (p === 'open') {
					return noop;
				}
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
