/**
 * @typedef {import("./types.ts").Unsubscribable} Unsubscribable
 * @typedef {import("./message.types.ts").Params} Params
 * @typedef {import("./message.types.ts").GetResponse<any>} GetResponse
 * @typedef {import("./message.types.ts").Reject<any>} Reject
 * @typedef {import("./message.types.ts").Request<any>} Request
 * @typedef {import("./message.types.ts").SetSuccess<any>} SetSuccess
 * @typedef {import("./message.types.ts").SubscribeAccept<any>} SubscribeAccept
 * @typedef {import("./message.types.ts").SubscribeEvent<any>} SubscribeEvent
 * @typedef {import("./message.types.ts").UnsubscribeAccept<any>} UnsubscribeAccept
 * @typedef {import("./server.types.ts").GetHandler<any, any>} GetHandler
 * @typedef {import("./server.types.ts").GetHandlerWithParams<any, any>} GetHandlerWithParams
 * @typedef {import("./server.types.ts").PickSetHandler<any, any>} PickSetHandler
 * @typedef {import("./server.types.ts").PickSubscribeHandler<any, any>} PickSubscribeHandler
 * @typedef {import("./server.types.ts").SetHandlerWithParams<any, any>} SetHandlerWithParams
 * @typedef {import("./server.types.ts").SubscribeHandlerWithParams<any, any>} SubscribeHandlerWithParams
 * @typedef {import("./websocket.types.ts").Data} Data
 * @typedef {import("./websocket.types.ts").WS} WS
 */

/**
 * @type {(resource: string, params: Params) => string}
 */
function getQualifiedResource(resource, params) {
	Object.entries(params ?? {}).forEach(([key, value]) => {
		resource = resource.replace(`:${key}`, value);
	});
	return resource;
}

/**
 * @type {(ws: WS, error: string, request: Request) => void}
 */
function sendReject(ws, error, request) {
	/** @type {Reject} */
	const reject = {
		error,
		type: 'Reject',
		request,
	};
	ws.send(JSON.stringify(reject));
}

/**
 * @param {string} resource
 * @param {Params} params
 * @returns {boolean}
 */
function validateParams(resource, params) {
	const count = resource.split(':').length - 1;
	if (count > 0) {
		if (params == null) {
			return false;
		}
		if (Object.keys(params).length !== count) {
			return false;
		}
	}
	return true;
}

/**
 * @type {typeof import("./server.types.ts").initServer}
 */
export function initServer(router) {
	/**
	 * @type {Map<WS, Map<string, Unsubscribable>>}
	 */
	const listeners = new Map();

	/**
	 *
	 * @param {WS} ws
	 * @returns {Map<string, Unsubscribable>}
	 */
	function getWebSocketListeners(ws) {
		const websocketListeners = listeners.get(ws);
		if (websocketListeners == null) {
			throw new Error(
				'Did not find map of listeners for websocket connection',
			);
		}
		return websocketListeners;
	}

	/**
	 * @param {WS} ws
	 */
	function addConnection(ws) {
		const existing = listeners.get(ws);
		if (existing != null) {
			throw new Error(
				'initServer.onOpen: Found unexpected existing map of listeners for websocket connection',
			);
		}
		listeners.set(ws, new Map());
		ws.addEventListener('close', () => {
			const existing = listeners.get(ws);
			if (existing == null) {
				throw new Error(
					'initServer.onClose: Map of listeners for websocket connection not found',
				);
			}
			listeners.delete(ws);
		});
		ws.addEventListener('error', (event) => {
			console.error(`initServer.onError: ${event}`);
		});
		ws.addEventListener('message', async (event) => {
			await handleWSMessage(event.data, ws);
		});
	}

	/**
	 * @param {Data} data
	 * @param {WS} ws
	 */
	async function handleWSMessage(data, ws) {
		if (typeof data != 'string') {
			console.error(
				`only string data supported. typeof event.data = ${typeof data}`,
			);
			return;
		}
		// console.log('received: %s', data);
		/** @type {Request} */
		const request = JSON.parse(data);
		if (typeof request.id !== 'number') {
			console.error(`no id number on message`);
			return;
		}
		if (typeof request.resource !== 'string') {
			console.error(`no resource string on message`);
			return;
		}
		const routerResource = router[request.resource];
		if (routerResource == null) {
			sendReject(ws, `resource not found`, request);
			return;
		}
		if (!validateParams(request.resource, request.params)) {
			sendReject(ws, `invalid params`, request);
			return;
		}
		if (request.type === 'GetRequest') {
			try {
				/** @type {Parameters<GetHandlerWithParams>[0]} */
				const args = /** @type {any} */ ({
					resource: request.resource,
				});
				if (request.params != null) {
					const qualifiedResource = getQualifiedResource(
						request.resource,
						request.params,
					);
					args.params = request.params;
					args.qualifiedResource = qualifiedResource;
				}
				/** @type {GetHandler} */
				const get = /** @type {any} */ (routerResource).get;
				const result = await get(args);
				/** @type {GetResponse} */
				const response = {
					id: request.id,
					data: result,
					type: 'GetResponse',
					resource: request.resource,
				};
				// console.log(response, JSON.stringify(response));
				ws.send(JSON.stringify(response));
			} catch (error) {
				console.error(error);
				sendReject(ws, '500', request);
			}
		} else if (request.type === 'SetRequest') {
			try {
				/** @type {Parameters<SetHandlerWithParams>[0]} */
				const args = /** @type {any} */ ({
					resource: request.resource,
					request: request.data,
				});
				if (request.params != null) {
					const qualifiedResource = getQualifiedResource(
						request.resource,
						request.params,
					);
					args.params = request.params;
					args.qualifiedResource = qualifiedResource;
				}
				/** @type {PickSetHandler} */
				const set = /** @type {any} */ (routerResource).set;
				await set(args);
				/** @type {SetSuccess} */
				const response = {
					id: request.id,
					resource: request.resource,
					type: 'SetSuccess',
				};
				ws.send(JSON.stringify(response));
			} catch (error) {
				console.error(error);
				sendReject(ws, '500', request);
			}
		} else if (request.type === 'SubscribeRequest') {
			try {
				/** @type {Parameters<SubscribeHandlerWithParams>[0]} */
				const args = /** @type {any} */ ({
					resource: request.resource,
				});
				if (request.params != null) {
					const qualifiedResource = getQualifiedResource(
						request.resource,
						request.params,
					);
					args.params = request.params;
					args.qualifiedResource = qualifiedResource;
				}
				const websocketListeners = getWebSocketListeners(ws);
				const existingSubscription = websocketListeners.get(
					args.qualifiedResource ?? args.resource,
				);
				if (existingSubscription != null) {
					sendReject(ws, 'Already subscribed', request);
					return;
				}
				/** @type {PickSubscribeHandler} */
				const subscribe = /** @type {any}*/ (routerResource).subscribe;
				const observable = await subscribe(args);
				const subscription = observable.subscribe({
					next(val) {
						/** @type {SubscribeEvent} */
						const event = {
							data: val,
							id: request.id,
							resource: request.resource,
							type: 'SubscribeEvent',
						};
						ws.send(JSON.stringify(event));
					},
				});
				websocketListeners.set(
					args.qualifiedResource ?? args.resource,
					subscription,
				);
				/** @type {SubscribeAccept} */
				const response = {
					id: request.id,
					resource: request.resource,
					type: 'SubscribeAccept',
				};
				ws.send(JSON.stringify(response));
			} catch (error) {
				console.error(error);
				sendReject(ws, '500', request);
			}
		} else if (request.type === 'UnsubscribeRequest') {
			try {
				const resource =
					request.params != null
						? getQualifiedResource(request.resource, request.params)
						: request.resource;
				const websocketListeners = getWebSocketListeners(ws);
				const subscription = websocketListeners.get(resource);
				if (subscription == null) {
					sendReject(ws, 'Not subscribed', request);
					return;
				}
				subscription.unsubscribe();
				websocketListeners.delete(resource);
				/** @type {UnsubscribeAccept} */
				const response = {
					id: request.id,
					resource: request.resource,
					type: 'UnsubscribeAccept',
				};
				ws.send(JSON.stringify(response));
			} catch (error) {
				console.error(error);
				sendReject(ws, '500', request);
			}
		} else {
			try {
				exhaustive(request);
			} catch (e) {
				sendReject(ws, `Invalid request type`, request);
			}
		}
	}

	return {
		addConnection,
	};
}

/** @type {(arg: never) => never} */
function exhaustive(arg) {
	throw new Error(`Failed exhaustive check. Expected never but got ${arg}`);
}
