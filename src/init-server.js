/**
 * @typedef {import('./types.ts').Unsubscribable} Unsubscribable
 * @typedef {import('./message.types.ts').Params} Params
 * @typedef {import('./message.types.ts').RequestReject<any>} Reject
 * @typedef {import('./message.types.ts').Request<any>} Request
 * @typedef {import('./server.types.ts').GetHandler<any, any, any>} GetHandler
 * @typedef {import('./server.types.ts').GetHandlerWithParams<any, any, any>} GetHandlerWithParams
 * @typedef {import('./server.types.ts').SetHandler<any, any, any>} SetHandler
 * @typedef {import('./server.types.ts').SetHandlerWithParams<any, any, any>} SetHandlerWithParams
 * @typedef {import('./server.types.ts').SubscribeHandlerWithParams<any, any, any>} SubscribeHandlerWithParams
 * @typedef {import('./server.types.ts').SubscribeHandler<any, any, any>} SubscribeHandler
 * @typedef {import('./websocket.types.ts').WS} WS
 */
import {
	getResourceParamNames,
	getResourceWithParams,
	isPromise,
	isRecord,
	json_parse,
	json_stringify,
} from './shared.js';

/**
 * @type {(
 * 	ws: WS,
 * 	message: string,
 * 	request: Request,
 * 	clientId: number,
 * 	remoteAddress: string | undefined,
 *  logger: import('./server.types.ts').ServerLogger,
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
	try {
		ws.send(json_stringify(reject));
		logger.sentReject?.(request, reject, clientId, remoteAddress, error);
	} catch (sendError) {
		// A dead socket must not escape the async message listener as an unhandled rejection.
		logger.error?.(
			'smolrpc.initServer.sendReject: send threw',
			clientId,
			remoteAddress,
			{ error: sendError },
		);
	}
}

/**
 * Sends a rejection only when no request can be safely associated with it.
 *
 * @param {WS} ws
 * @param {string} message
 * @param {number} clientId
 * @param {string | undefined} remoteAddress
 * @param {import('./server.types.ts').ServerLogger} logger
 * @param {unknown} [error]
 */
function sendGenericReject(
	ws,
	message,
	clientId,
	remoteAddress,
	logger,
	error,
) {
	/** @type {import('./message.types.ts').Reject} */
	const reject = {
		type: 'Reject',
		error: message,
	};
	try {
		ws.send(json_stringify(reject));
		logger.sentReject?.(undefined, reject, clientId, remoteAddress, error);
	} catch (sendError) {
		logger.error?.(
			'smolrpc.initServer.sendGenericReject: send threw',
			clientId,
			remoteAddress,
			{ error: sendError },
		);
	}
}

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isValidProtocolId(value) {
	return (
		typeof value === 'number' && Number.isSafeInteger(value) && value > 0
	);
}

/**
 * @param {string} resource
 * @param {Params} params
 * @returns {boolean}
 */
function validateParams(resource, params) {
	const expected = [...new Set(getResourceParamNames(resource))].sort();
	if (params == null) {
		return expected.length === 0;
	}
	if (!isRecord(params)) {
		return false;
	}
	const actual = Object.keys(params).sort();
	return (
		actual.length === expected.length &&
		actual.every((name, index) => {
			const value = params[name];
			return (
				name === expected[index] &&
				(typeof value === 'string' || typeof value === 'number')
			);
		})
	);
}

/**
 * @param {string} resourceType
 * @param {'get' | 'set' | 'subscribe'} operation
 */
function supportsOperation(resourceType, operation) {
	return resourceType.split('|').includes(operation);
}

/**
 * @template {import("./types").AnyResources} Resources
 * @param {import("./server.types.ts").Router<Resources>} router
 * @param {Resources} resources
 * @param {{serverLogger?: import('./server.types.ts').ServerLogger}} [options]
 * @returns {{
 * 	addConnection: (ws: WS, remoteAddress?: string | undefined) => number
 * }}
 */
export function initServer(router, resources, options) {
	let nextClientId = 0;

	// Single normalized logger: every helper sees the same object, and `error`
	// always exists so no failure is swallowed when no serverLogger is configured.
	/** @type {import('./server.types.ts').ServerLogger & { error: NonNullable<import('./server.types.ts').ServerLogger['error']> }} */
	const logger = {
		...options?.serverLogger,
		error:
			options?.serverLogger?.error ??
			((message, clientId, remoteAddress, data) => {
				console.error({ message, clientId, remoteAddress, data });
			}),
	};

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
				return;
			}
			listeners.delete(ws);
			const subscriptions = [...existing.listeners.values()];
			existing.listeners.clear();
			for (const unsubscribable of subscriptions) {
				try {
					unsubscribable.unsubscribe();
				} catch (error) {
					logger.error(
						'smolrpc.initServer.addConnection: subscription cleanup threw',
						clientId,
						remoteAddress,
						{ error },
					);
				}
			}
		});
		ws.addEventListener('error', (event) => {
			logger.error(
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
			logger.error(
				`smolrpc.initServer.addConnection.handleWSMessage: Only string data supported.`,
				clientId,
				remoteAddress,
				{
					type: typeof data,
					data,
				},
			);
			sendGenericReject(
				ws,
				`Only string data supported. typeof event.data = ${typeof data}`,
				clientId,
				remoteAddress,
				logger,
			);
			return;
		}
		// console.log('received: %s', data);
		/** @type {unknown} */
		let decoded;
		try {
			decoded = json_parse(data);
		} catch (error) {
			logger.error(
				'smolrpc.initServer.addConnection.handleWSMessage: Malformed JSON.',
				clientId,
				remoteAddress,
				{ error },
			);
			sendGenericReject(
				ws,
				'Malformed JSON request.',
				clientId,
				remoteAddress,
				logger,
				error,
			);
			return;
		}
		if (!isRecord(decoded)) {
			logger.error(
				'smolrpc.initServer.addConnection.handleWSMessage: Request must be an object.',
				clientId,
				remoteAddress,
				{ type: typeof decoded },
			);
			sendGenericReject(
				ws,
				'Request must be an object.',
				clientId,
				remoteAddress,
				logger,
			);
			return;
		}
		const request = /** @type {Request} */ (decoded);
		if (!isValidProtocolId(request.id)) {
			sendGenericReject(
				ws,
				`invalid request id`,
				clientId,
				remoteAddress,
				logger,
			);
			return;
		}
		logger.receivedRequest?.(request, clientId, remoteAddress);
		if (typeof request.resource !== 'string') {
			sendReject(
				ws,
				`no resource string on request`,
				request,
				clientId,
				remoteAddress,
				logger,
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
				logger,
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
				logger,
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
				logger,
			);
			return;
		}
		if (request.type === 'GetRequest') {
			try {
				const getHandler =
					/** @type {{get?: GetHandler | GetHandlerWithParams}}*/ (
						routerHandlers
					).get;
				if (
					!supportsOperation(resourceDefinition.type, 'get') ||
					typeof getHandler !== 'function'
				) {
					throw new TypeError('GET handler not found');
				}
				const requestSchema = resourceDefinition.request;
				let parsedGetRequestValue = request.request;
				if (requestSchema != null) {
					const parsedRequest = validateSchema(
						requestSchema,
						request.request,
						logger,
					);
					if (parsedRequest.issues != null) {
						sendReject(
							ws,
							`request schema validation failed: ${parsedRequest.issues}}`,
							request,
							clientId,
							remoteAddress,
							logger,
						);
						return;
					}
					parsedGetRequestValue = parsedRequest.value;
				}
				/** @type {Parameters<GetHandlerWithParams>[0]} */
				const args = /** @type {any} */ ({
					clientId,
					resource: request.resource,
				});
				if (requestSchema != null) {
					args.request = parsedGetRequestValue;
				} else if (request.request != null) {
					// Preserve schema-less request values accepted from JavaScript or direct wire callers.
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
				const result = await getHandler(args);
				const parsed = validateSchema(responseSchema, result, logger);
				if (parsed.issues != null) {
					logger.error(
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
					sendReject(
						ws,
						`response schema validation failed for ${request.resource}`,
						request,
						clientId,
						remoteAddress,
						logger,
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
				logger.sentResponse?.(
					request,
					response,
					clientId,
					remoteAddress,
				);
			} catch (error) {
				logger.error(
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
					logger,
					error,
				);
			}
		} else if (request.type === 'SetRequest') {
			try {
				const setHandler =
					/** @type {{set?: SetHandler | SetHandlerWithParams}}*/ (
						routerHandlers
					).set;
				if (
					!supportsOperation(resourceDefinition.type, 'set') ||
					typeof setHandler !== 'function'
				) {
					throw new TypeError('SET handler not found');
				}
				const requestSchema = resourceDefinition.request;
				let parsedSetRequestValue = request.request;
				if (requestSchema != null) {
					const parsedRequest = validateSchema(
						requestSchema,
						request.request,
						logger,
					);
					if (parsedRequest.issues != null) {
						sendReject(
							ws,
							`request schema validation failed: ${parsedRequest.issues}}`,
							request,
							clientId,
							remoteAddress,
							logger,
						);
						return;
					}
					parsedSetRequestValue = parsedRequest.value;
				}
				/** @type {Parameters<SetHandlerWithParams>[0]} */
				const args = /** @type {any} */ ({
					clientId,
					resource: request.resource,
					request: parsedSetRequestValue,
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
				const result = await setHandler(args);
				const parsed = validateSchema(responseSchema, result, logger);
				if (parsed.issues != null) {
					logger.error(
						`smolrpc.initServer.handleWSMessage: invalid route response for set request`,
						clientId,
						remoteAddress,
						{
							resource: request.resource,
							request,
							result,
							issues: parsed.issues,
						},
					);
					sendReject(
						ws,
						`response schema validation failed for ${request.resource}`,
						request,
						clientId,
						remoteAddress,
						logger,
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
				logger.sentResponse?.(
					request,
					response,
					clientId,
					remoteAddress,
				);
			} catch (error) {
				logger.error(
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
					logger,
					error,
				);
			}
		} else if (request.type === 'SubscribeRequest') {
			// Reserve the id before awaiting the handler. Close clears the map and
			// unsubscribe deletes the entry, so an identity check after the await
			// detects both races without extra state. The map must be fetched
			// before the await: getWebSocketListeners throws once the connection closed.
			const websocketListeners = getWebSocketListeners(ws);
			/** @type {Unsubscribable} */
			const placeholder = { unsubscribe() {} };
			try {
				if (websocketListeners.has(request.id)) {
					sendReject(
						ws,
						'duplicate subscription id',
						request,
						clientId,
						remoteAddress,
						logger,
					);
					return;
				}
				websocketListeners.set(request.id, placeholder);
				const subscribeHandler =
					/** @type {{subscribe?: SubscribeHandlerWithParams | SubscribeHandler}}*/ (
						routerHandlers
					).subscribe;
				if (
					!supportsOperation(resourceDefinition.type, 'subscribe') ||
					typeof subscribeHandler !== 'function'
				) {
					throw new TypeError('SUBSCRIBE handler not found');
				}
				const requestSchema = resourceDefinition.request;
				let parsedSubscribeRequestValue = request.request;
				if (requestSchema != null) {
					const parsedRequest = validateSchema(
						requestSchema,
						request.request,
						logger,
					);
					if (parsedRequest.issues != null) {
						sendReject(
							ws,
							`request schema validation failed: ${parsedRequest.issues}}`,
							request,
							clientId,
							remoteAddress,
							logger,
						);
						return;
					}
					parsedSubscribeRequestValue = parsedRequest.value;
				}
				/** @type {Parameters<SubscribeHandlerWithParams>[0]} */
				const args = /** @type {any} */ ({
					clientId,
					resource: request.resource,
				});
				if (requestSchema != null) {
					args.request = parsedSubscribeRequestValue;
				} else if (request.request != null) {
					// Preserve schema-less request values accepted from JavaScript or direct wire callers.
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

				const subscribable = await subscribeHandler(args);
				// Cancelled by close or unsubscribe during the handler: the client
				// has already forgotten the id, so no reply is sent.
				if (websocketListeners.get(request.id) !== placeholder) {
					return;
				}
				if (
					subscribable == null ||
					typeof subscribable.subscribe !== 'function'
				) {
					throw new TypeError(
						'Subscribe handler did not return a subscribable',
					);
				}

				// Send SubscribeAccept before calling subscribable.subscribe,
				// because subscribable.subscribe will send the initial subscription event
				/** @type {import("./message.types.ts").SubscribeAccept<any>} */
				const response = {
					id: request.id,
					type: 'SubscribeAccept',
					resource: request.resource,
				};
				ws.send(json_stringify(response));
				logger.sentResponse?.(
					request,
					response,
					clientId,
					remoteAddress,
				);

				const subscription = subscribable.subscribe({
					next(val) {
						const parsed = validateSchema(
							responseSchema,
							val,
							logger,
						);
						if (parsed.issues != null) {
							logger.error(
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
						try {
							ws.send(json_stringify(event));
							logger.sentEvent?.(
								request,
								event,
								clientId,
								remoteAddress,
							);
						} catch (error) {
							// Never let a transport failure escape into the application's notifier.
							logger.error(
								'smolrpc.initServer.handleWSMessage: subscribe event send threw',
								clientId,
								remoteAddress,
								{ error },
							);
						}
					},
				});
				websocketListeners.set(request.id, subscription);
			} catch (error) {
				if (websocketListeners.get(request.id) === placeholder) {
					websocketListeners.delete(request.id);
				}
				logger.error(
					`smolrpc.initServer.handleWSMessage: caught error while handling subscribe request`,
					clientId,
					remoteAddress,
					{ request, error },
				);
				sendReject(
					ws,
					'500',
					request,
					clientId,
					remoteAddress,
					logger,
					error,
				);
			}
		} else if (request.type === 'UnsubscribeRequest') {
			try {
				if (!isValidProtocolId(request.subscriptionId)) {
					sendReject(
						ws,
						'invalid subscription id',
						request,
						clientId,
						remoteAddress,
						logger,
					);
					return;
				}
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
						logger,
					);
					return;
				}
				websocketListeners.delete(request.subscriptionId);
				subscription.unsubscribe();
				/** @type {import("./message.types.ts").UnsubscribeAccept<any>} */
				const response = {
					id: request.id,
					type: 'UnsubscribeAccept',
					resource: request.resource,
				};
				ws.send(json_stringify(response));
				logger.sentResponse?.(
					request,
					response,
					clientId,
					remoteAddress,
				);
			} catch (error) {
				logger.error(
					`smolrpc.initServer.handleWSMessage: caught error while handling unsubscribe request`,
					clientId,
					remoteAddress,
					{ request, error },
				);
				sendReject(
					ws,
					'500',
					request,
					clientId,
					remoteAddress,
					logger,
					error,
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
					logger,
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
 * @param {import('./server.types.ts').ServerLogger} logger
 * @returns {{value: any, issues: undefined} | {issues: string}}}
 */
function validateSchema(schema, value, logger) {
	try {
		const parsed = schema['~standard'].validate(value);
		if (isPromise(parsed)) {
			parsed.then(
				(then_result) => {
					logger.asyncValidationResult?.(
						'smolrpc.initServer: validateSchema found a promise in the parsed result and on .then it produced a value',
						schema,
						value,
						{ type: 'then', then_result },
					);
				},
				(catch_error) => {
					logger.asyncValidationResult?.(
						'smolrpc.initServer: validateSchema found a promise in the parsed result on .catch it produced an error',
						schema,
						value,
						{ type: 'catch', catch_error },
					);
				},
			);
			return {
				issues: 'smolrpc.initServer: Schema validation must be synchronous',
			};
		}
		if (parsed.issues != null) {
			return { issues: json_stringify(parsed.issues) };
		}
		return parsed;
	} catch (error) {
		return {
			issues: json_stringify({
				message: 'smolrpc.initServer:Schema validation threw an error',
				value,
				error,
			}),
		};
	}
}
