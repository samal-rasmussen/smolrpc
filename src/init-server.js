/**
 * @typedef {import('./types.ts').Unsubscribable} Unsubscribable
 * @typedef {import('./message.types.ts').Params} Params
 * @typedef {import('./message.types.ts').RequestReject<any>} Reject
 * @typedef {import('./message.types.ts').Request<any>} Request
 * @typedef {import('./server.types.ts').GetHandler<any, any, any>} GetHandler
 * @typedef {import('./server.types.ts').GetHandlerWithParams<any, any, any>} GetHandlerWithParams
 * @typedef {import('./server.types.ts').SetHandler<any, any, any>} SetHandler
 *  * @typedef {import('./server.types.ts').SetHandlerWithParams<any, any, any>} SetHandlerWithParams
 * @typedef {import('./server.types.ts').SubscribeHandlerWithParams<any, any, any>} SubscribeHandlerWithParams
 * @typedef {import('./server.types.ts').SubscribeHandler<any, any, any>} SubscribeHandler
 * @typedef {import('./websocket.types.ts').WS} WS
 */
import { getResourceWithParams, json_parse, json_stringify } from './shared.js';

/**
 * @type {(
 * 	ws: WS,
 * 	message: string,
 * 	request: Request,
 * 	clientId: number,
 * 	remoteAddress: string | undefined,
 *  logger?: import('./server.types.ts').ServerLogger,
 *  error?: unknown
 * ) => void}
 */
function sendReject(
	ws,
	message,
	request,
	clientId,
	remoteAddress,
	logger,
	error,
) {
	/** @type {Reject} */
	const reject = {
		type: 'RequestReject',
		error: message,
		request,
	};
	ws.send(json_stringify(reject));
	logger?.sentReject(request, reject, clientId, remoteAddress, error);
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
 * @template {import("./types").AnyResources} Resources
 * @param {import("./server.types.ts").Router<Resources>} router
 * @param {import("./types.ts").AnyResources} resources
 * @param {{serverLogger?: import('./server.types.ts').ServerLogger}} [options]
 * @returns {{
 * 	addConnection: (ws: WS, remoteAddress?: string | undefined) => number
 * }}
 */
export function initServer(router, resources, options) {
	let nextClientId = 0;

	const errorLogger =
		options?.serverLogger?.error ??
		((message, clientId, remoteAddress, data) => {
			console.error({
				message,
				clientId,
				remoteAddress,
				data,
			});
		});

	/**
	 * @type {Map<WS, {
	 *  clientId: number,
	 *  remoteAddress: string | undefined,
	 *  listeners: Map<number, Unsubscribable>
	 * }>}
	 */
	const listeners = new Map();

	/**
	 *
	 * @param {WS} ws
	 * @returns {Map<number, Unsubscribable>}
	 */
	function getWebSocketListeners(ws) {
		const websocketListeners = listeners.get(ws);
		if (websocketListeners == null) {
			throw new Error(
				'Did not find map of listeners for websocket connection',
			);
		}
		return websocketListeners.listeners;
	}

	/**
	 * @param {WS} ws
	 * @param {string | undefined} [remoteAddress]
	 * @returns {number} clientId
	 */
	function addConnection(ws, remoteAddress) {
		const existing = listeners.get(ws);
		if (existing != null) {
			throw new Error(
				'initServer.onOpen: Found unexpected existing map of listeners for websocket connection',
			);
		}
		const clientId = nextClientId++;
		const listenerData = {
			clientId,
			listeners: new Map(),
			remoteAddress,
		};
		listeners.set(ws, listenerData);
		ws.addEventListener('close', () => {
			const existing = listeners.get(ws);
			if (existing == null) {
				throw new Error(
					'initServer.onClose: Map of listeners for websocket connection not found',
				);
			}
			for (const unsubscribable of existing.listeners.values()) {
				unsubscribable.unsubscribe();
			}
			listeners.delete(ws);
		});
		ws.addEventListener('error', (event) => {
			errorLogger(
				`smolrpc.initServer.addConnection: ws.onError`,
				clientId,
				remoteAddress,
				{
					event,
				},
			);
		});
		ws.addEventListener('message', async (event) => {
			await handleWSMessage(
				event.data,
				ws,
				listenerData.clientId,
				listenerData.remoteAddress,
			);
		});
		return clientId;
	}

	/**
	 * @param {import("./websocket.types.ts").Data} data
	 * @param {WS} ws
	 * @param {number} clientId
	 * @param {string | undefined} remoteAddress
	 */
	async function handleWSMessage(data, ws, clientId, remoteAddress) {
		if (typeof data != 'string') {
			errorLogger(
				`smolrpc.initServer.addConnection.handleWSMessage: Only string data supported.`,
				clientId,
				remoteAddress,
				{
					type: typeof data,
					data,
				},
			);
			/** @type {import('./message.types.ts').Reject} */
			const reject = {
				type: 'Reject',
				error: `Only string data supported. typeof event.data = ${typeof data}`,
			};
			ws.send(json_stringify(reject));
			options?.serverLogger?.sentReject(
				undefined,
				reject,
				clientId,
				remoteAddress,
			);
			return;
		}
		// console.log('received: %s', data);
		/** @type {Request} */
		const request = json_parse(data);
		request.params;
		if (typeof request.id !== 'number') {
			sendReject(
				ws,
				`no id number on request`,
				request,
				clientId,
				remoteAddress,
				options?.serverLogger,
			);
			return;
		}
		options?.serverLogger?.receivedRequest(
			request,
			clientId,
			remoteAddress,
		);
		if (typeof request.resource !== 'string') {
			sendReject(
				ws,
				`no resource string on request`,
				request,
				clientId,
				remoteAddress,
				options?.serverLogger,
			);
			return;
		}
		const routerHandlers = router[request.resource];
		if (routerHandlers == null) {
			sendReject(
				ws,
				`router handler for resource not found`,
				request,
				clientId,
				remoteAddress,
				options?.serverLogger,
			);
			return;
		}
		const resourceDefinition = resources[request.resource];
		if (resourceDefinition == null) {
			sendReject(
				ws,
				`resource definition for resource not found`,
				request,
				clientId,
				remoteAddress,
				options?.serverLogger,
			);
			return;
		}
		const responseSchema = resourceDefinition.response;
		if (!validateParams(request.resource, request.params)) {
			sendReject(
				ws,
				`invalid params`,
				request,
				clientId,
				remoteAddress,
				options?.serverLogger,
			);
			return;
		}
		if (request.type === 'GetRequest') {
			try {
				const requestSchema = resourceDefinition.request;
				if (requestSchema != null) {
					const parsedRequest = validateSchema(
						requestSchema,
						request.request,
					);
					if (parsedRequest.issues != null) {
						sendReject(
							ws,
							`request schema validation failed: ${parsedRequest.issues}}`,
							request,
							clientId,
							remoteAddress,
							options?.serverLogger,
						);
						return;
					}
				}
				/** @type {Parameters<GetHandlerWithParams>[0]} */
				const args = /** @type {any} */ ({
					clientId,
					resource: request.resource,
				});
				if (request.request != null) {
					args.request = request.request;
				}
				if (request.params != null) {
					const resourceWithParams = getResourceWithParams(
						request.resource,
						request.params,
					);
					args.params = request.params;
					args.resourceWithParams = resourceWithParams;
				} else {
					args.resourceWithParams = request.resource;
				}
				const getHandler =
					/** @type {{get: GetHandler | GetHandlerWithParams}}*/ (
						routerHandlers
					).get;
				const result = await getHandler(args);
				const parsed = validateSchema(responseSchema, result);
				if (parsed.issues != null) {
					errorLogger(
						`smolrpc.initServer.handleWSMessage: invalid route response for get request`,
						clientId,
						remoteAddress,
						{
							resource: request.resource,
							request,
							result: result,
							issues: parsed.issues,
						},
					);
					return;
				}
				/** @type {import("./message.types.ts").GetResponse<any>} */
				const response = {
					id: request.id,
					type: 'GetResponse',
					resource: request.resource,
					data: parsed.value,
				};
				ws.send(json_stringify(response));
				options?.serverLogger?.sentResponse(
					request,
					response,
					clientId,
					remoteAddress,
				);
			} catch (error) {
				errorLogger(
					`smolrpc.initServer.handleWSMessage: caught error while handling get request`,
					clientId,
					remoteAddress,
					{
						request,
						error,
					},
				);
				sendReject(
					ws,
					'500',
					request,
					clientId,
					remoteAddress,
					options?.serverLogger,
					error,
				);
			}
		} else if (request.type === 'SetRequest') {
			try {
				const requestSchema = resourceDefinition.request;
				if (requestSchema != null) {
					const parsedRequest = validateSchema(
						requestSchema,
						request.request,
					);
					if (parsedRequest.issues != null) {
						sendReject(
							ws,
							`request schema validation failed: ${parsedRequest.issues}}`,
							request,
							clientId,
							remoteAddress,
							options?.serverLogger,
						);
						return;
					}
				}
				/** @type {Parameters<SetHandlerWithParams>[0]} */
				const args = /** @type {any} */ ({
					clientId,
					resource: request.resource,
					request: request.request,
				});
				if (request.params != null) {
					const resourceWithParams = getResourceWithParams(
						request.resource,
						request.params,
					);
					args.params = request.params;
					args.resourceWithParams = resourceWithParams;
				} else {
					args.resourceWithParams = request.resource;
				}
				const setHandler =
					/** @type {{set: SetHandler | SetHandlerWithParams}}*/ (
						routerHandlers
					).set;
				const result = await setHandler(args);
				const parsed = validateSchema(responseSchema, result);
				if (parsed.issues != null) {
					errorLogger(
						`smolrpc.initServer.handleWSMessage: invalid route response for set request`,
						clientId,
						remoteAddress,
						{
							resource: request.resource,
							request,
							result: result,
							issues: parsed.issues,
						},
					);
					return;
				}
				/** @type {import("./message.types.ts").SetSuccess<any>} */
				const response = {
					id: request.id,
					type: 'SetSuccess',
					resource: request.resource,
					data: parsed.value,
				};
				ws.send(json_stringify(response));
				options?.serverLogger?.sentResponse(
					request,
					response,
					clientId,
					remoteAddress,
				);
			} catch (error) {
				errorLogger(
					`smolrpc.initServer.handleWSMessage: caught error while handling set request`,
					clientId,
					remoteAddress,
					{
						request,
						error,
					},
				);
				sendReject(
					ws,
					'500',
					request,
					clientId,
					remoteAddress,
					options?.serverLogger,
					error,
				);
			}
		} else if (request.type === 'SubscribeRequest') {
			try {
				const requestSchema = resourceDefinition.request;
				if (requestSchema != null) {
					const parsedRequest = validateSchema(
						requestSchema,
						request.request,
					);
					if (parsedRequest.issues != null) {
						sendReject(
							ws,
							`request schema validation failed: ${parsedRequest.issues}}`,
							request,
							clientId,
							remoteAddress,
							options?.serverLogger,
						);
						return;
					}
				}
				/** @type {Parameters<SubscribeHandlerWithParams>[0]} */
				const args = /** @type {any} */ ({
					clientId,
					resource: request.resource,
				});
				if (request.request != null) {
					args.request = request.request;
				}
				if (request.params != null) {
					const resourceWithParams = getResourceWithParams(
						request.resource,
						request.params,
					);
					args.params = request.params;
					args.resourceWithParams = resourceWithParams;
				} else {
					args.resourceWithParams = request.resource;
				}

				const subscribeHandler =
					/** @type {{subscribe: SubscribeHandlerWithParams | SubscribeHandler}}*/ (
						routerHandlers
					).subscribe;
				const subscribable = await subscribeHandler(args);

				// Send SubscribeAccept before calling subscribable.subscribe,
				// because subscribable.subscribe will send the initial subscription event
				/** @type {import("./message.types.ts").SubscribeAccept<any>} */
				const response = {
					id: request.id,
					type: 'SubscribeAccept',
					resource: request.resource,
				};
				ws.send(json_stringify(response));
				options?.serverLogger?.sentResponse(
					request,
					response,
					clientId,
					remoteAddress,
				);

				const subscription = subscribable.subscribe({
					next(val) {
						const parsed = validateSchema(responseSchema, val);
						if (parsed.issues != null) {
							errorLogger(
								`smolrpc.initServer.handleWSMessage: invalid route response for subscribe event`,
								clientId,
								remoteAddress,
								{
									resource: request.resource,
									request,
									val,
									issues: parsed.issues,
								},
							);
							return;
						}
						/** @type {import("./message.types.ts").SubscribeEvent<any>} */
						const event = {
							id: request.id,
							type: 'SubscribeEvent',
							resource: request.resource,
							data: parsed.value,
						};
						if (request.params != null) {
							event.params = request.params;
						}
						ws.send(json_stringify(event));
						options?.serverLogger?.sentEvent(
							request,
							event,
							clientId,
							remoteAddress,
						);
					},
				});
				const websocketListeners = getWebSocketListeners(ws);
				websocketListeners.set(request.id, subscription);
			} catch (error) {
				sendReject(
					ws,
					'500',
					request,
					clientId,
					remoteAddress,
					options?.serverLogger,
					error,
				);
			}
		} else if (request.type === 'UnsubscribeRequest') {
			try {
				const websocketListeners = getWebSocketListeners(ws);
				const subscription = websocketListeners.get(
					request.subscriptionId,
				);
				if (subscription == null) {
					sendReject(
						ws,
						'Not subscribed',
						request,
						clientId,
						remoteAddress,
						options?.serverLogger,
					);
					return;
				}
				subscription.unsubscribe();
				websocketListeners.delete(request.subscriptionId);
				/** @type {import("./message.types.ts").UnsubscribeAccept<any>} */
				const response = {
					id: request.id,
					type: 'UnsubscribeAccept',
					resource: request.resource,
				};
				ws.send(json_stringify(response));
				options?.serverLogger?.sentResponse(
					request,
					response,
					clientId,
					remoteAddress,
				);
			} catch (error) {
				sendReject(
					ws,
					'500',
					request,
					clientId,
					remoteAddress,
					options?.serverLogger,
				);
			}
		} else {
			try {
				exhaustive(request);
			} catch (e) {
				sendReject(
					ws,
					`Invalid request type`,
					request,
					clientId,
					remoteAddress,
					options?.serverLogger,
				);
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

/**
 * @param {import('@standard-schema/spec').StandardSchemaV1<any, any>} schema
 * @param {any} value
 * @returns {{value: any, issues: undefined} | {issues: string}}}
 */
function validateSchema(schema, value) {
	const parsed = schema['~standard'].validate(value);
	if (parsed instanceof Promise) {
		throw new Error(
			'smolrpc.initServer:Schema validation must be synchronous',
		);
	}
	if (parsed.issues != null) {
		return { issues: JSON.stringify(parsed.issues) };
	}
	return parsed;
}
