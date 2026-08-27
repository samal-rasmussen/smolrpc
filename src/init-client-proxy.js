import { SmolRpcError } from './client-errors.js';
import { ReadyStates } from './init-client-websocket.js';
import {
	getResourceWithParams,
	isRecord,
	json_parse,
	json_stringify,
} from './shared.js';

export const OPERATION_TIMEOUT_MS = 5_000;
const OPERATION_TIMEOUT_SECONDS = OPERATION_TIMEOUT_MS / 1_000;

/**
 * @typedef {import("./types").Subscribable<any>} Subscribable
 * @typedef {import("./message.types").Params} Params
 * @typedef {import("./message.types").Request<any>} Request
 * @typedef {NonNullable<ReturnType<ReturnType<import("./init-client-websocket").initClientWebSocket>["getCurrentGeneration"]>>} Generation
 * @typedef {ReturnType<import("./init-client-websocket").initClientWebSocket>} ClientWebSocket
 * @typedef {ConstructorParameters<typeof SmolRpcError>[0]} ErrorCode
 */

/**
 * @param {unknown} message
 * @returns {number | undefined}
 */
function extractRequestId(message) {
	if (!isRecord(message)) {
		return undefined;
	}
	if (Number.isSafeInteger(message.id)) {
		return /** @type {number} */ (message.id);
	}
	if (
		message.type === 'RequestReject' &&
		isRecord(message.request) &&
		Number.isSafeInteger(message.request.id)
	) {
		return /** @type {number} */ (message.request.id);
	}
	return undefined;
}

/**
 * @param {unknown} message
 * @param {number} requestId
 * @param {string} requestType
 * @param {string} resource
 */
function isMatchingRejection(message, requestId, requestType, resource) {
	return (
		isRecord(message) &&
		message.type === 'RequestReject' &&
		isRecord(message.request) &&
		message.request.id === requestId &&
		message.request.type === requestType &&
		message.request.resource === resource &&
		typeof message.error === 'string'
	);
}

/**
 * @template {import("./types").AnyResources} Resources
 * @param {ClientWebSocket} websocket
 * @param {(message: string, data: Record<string, unknown>) => void} reportInternalError
 * @return {{
 *  proxy: import("./client.types").Client<Resources>,
 *  onmessage: (generation: Generation, e: MessageEvent) => void,
 * }}
 */
export function initClientProxy(websocket, reportInternalError) {
	/**
	 * @param {'get' | 'set' | 'subscribe' | 'unsubscribe'} operation
	 * @param {string} resource
	 * @param {Generation | undefined} generation
	 * @param {number | undefined} [requestId]
	 * @param {number | undefined} [startedAt]
	 */
	function metadata(operation, resource, generation, requestId, startedAt) {
		return {
			operation,
			resource,
			...(requestId == null ? {} : { requestId }),
			...(generation == null
				? {}
				: {
						generation: generation.number,
						readyState: generation.socket.readyState,
				  }),
			...(startedAt == null
				? {}
				: { elapsedMs: Math.max(0, Date.now() - startedAt) }),
		};
	}

	/**
	 * @param {ErrorCode} code
	 * @param {string} message
	 * @param {'get' | 'set' | 'subscribe' | 'unsubscribe'} operation
	 * @param {string} resource
	 * @param {Generation | undefined} generation
	 * @param {number | undefined} [requestId]
	 * @param {number | undefined} [startedAt]
	 */
	function clientError(
		code,
		message,
		operation,
		resource,
		generation,
		requestId,
		startedAt,
	) {
		return new SmolRpcError(
			code,
			message,
			metadata(operation, resource, generation, requestId, startedAt),
		);
	}

	/**
	 * @param {string} label
	 * @param {'get' | 'set' | 'subscribe' | 'unsubscribe'} operation
	 * @param {string} resource
	 * @param {Generation | undefined} generation
	 * @param {number | undefined} [requestId]
	 * @param {number | undefined} [startedAt]
	 */
	function diagnose(
		label,
		operation,
		resource,
		generation,
		requestId,
		startedAt,
	) {
		reportInternalError(
			label,
			metadata(operation, resource, generation, requestId, startedAt),
		);
	}

	/**
	 * @param {unknown} frame
	 * @param {'get' | 'set' | 'subscribe' | 'unsubscribe'} operation
	 * @param {string} resource
	 * @param {Generation} generation
	 * @param {number} requestId
	 * @param {number} startedAt
	 */
	function serialize(
		frame,
		operation,
		resource,
		generation,
		requestId,
		startedAt,
	) {
		try {
			return json_stringify(frame);
		} catch {
			throw clientError(
				'SMOLRPC_SERIALIZATION',
				`${operation.toUpperCase()} request on ${resource} could not be serialized.`,
				operation,
				resource,
				generation,
				requestId,
				startedAt,
			);
		}
	}

	/**
	 * @param {string} resource
	 * @param {any} request
	 * @param {Params} params
	 * @returns {Promise<unknown>}
	 */
	function getHandler(resource, request, params) {
		const generation = websocket.getCurrentGeneration();
		const startedAt = Date.now();
		if (generation == null || !websocket.isCurrentOpen(generation)) {
			return Promise.reject(
				clientError(
					'SMOLRPC_UNAVAILABLE',
					`GET request on ${resource} could not be sent because the connection is unavailable.`,
					'get',
					resource,
					generation,
					undefined,
					startedAt,
				),
			);
		}

		return new Promise((resolve, reject) => {
			const requestId = websocket.allocateRequestId(generation);
			/** @type {Request} */
			const frame = {
				id: requestId,
				type: 'GetRequest',
				resource,
				params,
				request,
			};
			/** @type {string} */
			let serialized;
			try {
				serialized = serialize(
					frame,
					'get',
					resource,
					generation,
					requestId,
					startedAt,
				);
			} catch (error) {
				reject(error);
				return;
			}
			if (!websocket.isCurrentOpen(generation)) {
				reject(
					clientError(
						'SMOLRPC_UNAVAILABLE',
						`GET request on ${resource} could not be sent because the connection is unavailable.`,
						'get',
						resource,
						generation,
						requestId,
						startedAt,
					),
				);
				return;
			}

			let settled = false;
			/** @type {SmolRpcError | undefined} */
			let pendingError;
			/** @type {ReturnType<typeof setTimeout> | undefined} */
			let timer;

			const record = {
				kind: /** @type {const} */ ('get'),
				generation,
				requestId,
				phase: /** @type {'unsent' | 'sending' | 'sent'} */ ('unsent'),
				detach() {
					if (generation.operations.get(requestId) === record) {
						generation.operations.delete(requestId);
					}
					if (timer != null) {
						clearTimeout(timer);
						timer = undefined;
					}
				},
				/** @param {SmolRpcError} error */
				fail(error) {
					if (settled) return;
					settled = true;
					record.detach();
					reject(error);
				},
				/** @param {SmolRpcError} error */
				failNonDefinitive(error) {
					if (settled) return;
					record.detach();
					if (record.phase === 'sending') {
						pendingError = error;
						return;
					}
					record.fail(error);
				},
				/** @param {unknown} value */
				succeed(value) {
					if (settled) return;
					settled = true;
					record.detach();
					resolve(value);
				},
				prepareRetirement() {
					if (settled) return undefined;
					const error = clientError(
						'SMOLRPC_UNAVAILABLE',
						`GET request on ${resource} was interrupted because the connection became unavailable.`,
						'get',
						resource,
						generation,
						requestId,
						startedAt,
					);
					record.detach();
					if (record.phase === 'sending') {
						pendingError = error;
						return undefined;
					}
					settled = true;
					return () => reject(error);
				},
				/** @param {unknown} message */
				handleMessage(message) {
					if (settled) return;
					if (
						isMatchingRejection(
							message,
							requestId,
							'GetRequest',
							resource,
						)
					) {
						const rejection = /** @type {Record<string, any>} */ (
							message
						);
						record.fail(
							clientError(
								'SMOLRPC_SERVER_REJECTION',
								`Get request on ${resource} rejected with error: ${rejection.error}`,
								'get',
								resource,
								generation,
								requestId,
								startedAt,
							),
						);
						return;
					}
					if (
						isRecord(message) &&
						message.type === 'GetResponse' &&
						message.id === requestId &&
						message.resource === resource
					) {
						record.succeed(message.data);
						return;
					}
					record.failNonDefinitive(
						clientError(
							'SMOLRPC_PROTOCOL_ERROR',
							`GET request on ${resource} received an unexpected response.`,
							'get',
							resource,
							generation,
							requestId,
							startedAt,
						),
					);
				},
			};

			timer = setTimeout(() => {
				record.failNonDefinitive(
					clientError(
						'SMOLRPC_TIMEOUT',
						`Get request on ${resource} timed out after ${OPERATION_TIMEOUT_SECONDS} seconds.`,
						'get',
						resource,
						generation,
						requestId,
						startedAt,
					),
				);
			}, OPERATION_TIMEOUT_MS);
			generation.operations.set(requestId, record);

			const result = websocket.sendFrame(
				generation,
				record,
				frame,
				serialized,
			);
			if (settled || result.kind === 'settled') return;
			if (result.kind === 'threw') {
				record.fail(
					clientError(
						'SMOLRPC_SEND_FAILED',
						`GET request on ${resource} failed during native send.`,
						'get',
						resource,
						generation,
						requestId,
						startedAt,
					),
				);
				return;
			}
			if (result.kind === 'unavailable') {
				record.fail(
					clientError(
						'SMOLRPC_UNAVAILABLE',
						`GET request on ${resource} could not be sent because the connection is unavailable.`,
						'get',
						resource,
						generation,
						requestId,
						startedAt,
					),
				);
				return;
			}
			record.phase = 'sent';
			if (pendingError != null) {
				record.fail(pendingError);
			}
		});
	}

	/**
	 * @param {string} resource
	 * @param {any} request
	 * @param {Params} params
	 * @returns {Promise<unknown>}
	 */
	function setHandler(resource, request, params) {
		const currentGeneration = websocket.getCurrentGeneration();
		const startedAt = Date.now();
		if (
			currentGeneration == null ||
			!websocket.isCurrent(currentGeneration) ||
			(currentGeneration.readyState !== ReadyStates.CONNECTING &&
				currentGeneration.readyState !== ReadyStates.OPEN)
		) {
			return Promise.reject(
				clientError(
					'SMOLRPC_UNAVAILABLE',
					`SET request on ${resource} could not be sent because the connection is unavailable.`,
					'set',
					resource,
					currentGeneration,
					undefined,
					startedAt,
				),
			);
		}
		const generation = currentGeneration;

		return new Promise((resolve, reject) => {
			const requestId = websocket.allocateRequestId(generation);
			/** @type {Request} */
			const frame = {
				id: requestId,
				type: 'SetRequest',
				resource,
				params,
				request,
			};
			/** @type {string} */
			let serialized;
			try {
				serialized = serialize(
					frame,
					'set',
					resource,
					generation,
					requestId,
					startedAt,
				);
			} catch (error) {
				reject(error);
				return;
			}
			if (
				!websocket.isCurrent(generation) ||
				(generation.readyState !== ReadyStates.CONNECTING &&
					generation.readyState !== ReadyStates.OPEN)
			) {
				reject(
					clientError(
						'SMOLRPC_UNAVAILABLE',
						`SET request on ${resource} could not be sent because the connection is unavailable.`,
						'set',
						resource,
						generation,
						requestId,
						startedAt,
					),
				);
				return;
			}

			let settled = false;
			/** @type {SmolRpcError | undefined} */
			let pendingError;
			/** @type {ReturnType<typeof setTimeout> | undefined} */
			let timer;

			/** @param {string} reason */
			const outcomeUnknown = (reason) =>
				clientError(
					'SMOLRPC_MUTATION_OUTCOME_UNKNOWN',
					`SET request on ${resource} was accepted by native send, but its mutation outcome is unknown: ${reason}.`,
					'set',
					resource,
					generation,
					requestId,
					startedAt,
				);

			const record = {
				kind: /** @type {const} */ ('set'),
				generation,
				requestId,
				phase: /** @type {'unsent' | 'sending' | 'sent'} */ ('unsent'),
				detach() {
					if (generation.operations.get(requestId) === record) {
						generation.operations.delete(requestId);
					}
					generation.setWaiters.delete(record);
					if (timer != null) {
						clearTimeout(timer);
						timer = undefined;
					}
				},
				/** @param {SmolRpcError} error */
				fail(error) {
					if (settled) return;
					settled = true;
					record.detach();
					reject(error);
				},
				/** @param {SmolRpcError} error */
				failNonDefinitive(error) {
					if (settled) return;
					record.detach();
					if (record.phase === 'sending') {
						pendingError = error;
						return;
					}
					record.fail(
						record.phase === 'sent'
							? outcomeUnknown(error.message)
							: error,
					);
				},
				/** @param {unknown} value */
				succeed(value) {
					if (settled) return;
					settled = true;
					record.detach();
					resolve(value);
				},
				prepareRetirement() {
					if (settled) return undefined;
					const unavailable = clientError(
						'SMOLRPC_UNAVAILABLE',
						`SET request on ${resource} was interrupted because the connection became unavailable.`,
						'set',
						resource,
						generation,
						requestId,
						startedAt,
					);
					record.detach();
					if (record.phase === 'sending') {
						pendingError = unavailable;
						return undefined;
					}
					settled = true;
					const error =
						record.phase === 'sent'
							? outcomeUnknown(
									'the connection became unavailable',
							  )
							: unavailable;
					return () => reject(error);
				},
				/** @param {unknown} message */
				handleMessage(message) {
					if (settled) return;
					if (
						isMatchingRejection(
							message,
							requestId,
							'SetRequest',
							resource,
						)
					) {
						const rejection = /** @type {Record<string, any>} */ (
							message
						);
						record.fail(
							clientError(
								'SMOLRPC_SERVER_REJECTION',
								`Set request on ${resource} rejected with error: ${rejection.error}`,
								'set',
								resource,
								generation,
								requestId,
								startedAt,
							),
						);
						return;
					}
					if (
						isRecord(message) &&
						message.type === 'SetSuccess' &&
						message.id === requestId &&
						message.resource === resource
					) {
						record.succeed(message.data);
						return;
					}
					record.failNonDefinitive(
						clientError(
							'SMOLRPC_PROTOCOL_ERROR',
							`SET request on ${resource} received an unexpected response.`,
							'set',
							resource,
							generation,
							requestId,
							startedAt,
						),
					);
				},
				onOpen() {
					if (settled) return;
					generation.setWaiters.delete(record);
					sendSet();
				},
			};

			function sendSet() {
				if (settled) return;
				const result = websocket.sendFrame(
					generation,
					record,
					frame,
					serialized,
				);
				if (settled || result.kind === 'settled') return;
				if (result.kind === 'threw') {
					record.fail(
						clientError(
							'SMOLRPC_SEND_FAILED',
							`SET request on ${resource} failed during native send.`,
							'set',
							resource,
							generation,
							requestId,
							startedAt,
						),
					);
					return;
				}
				if (result.kind === 'unavailable') {
					record.fail(
						clientError(
							'SMOLRPC_UNAVAILABLE',
							`SET request on ${resource} could not be sent because the connection is unavailable.`,
							'set',
							resource,
							generation,
							requestId,
							startedAt,
						),
					);
					return;
				}
				record.phase = 'sent';
				if (pendingError != null) {
					record.fail(outcomeUnknown(pendingError.message));
				}
			}

			timer = setTimeout(() => {
				record.failNonDefinitive(
					clientError(
						'SMOLRPC_TIMEOUT',
						`Set request on ${resource} timed out after ${OPERATION_TIMEOUT_SECONDS} seconds.`,
						'set',
						resource,
						generation,
						requestId,
						startedAt,
					),
				);
			}, OPERATION_TIMEOUT_MS);
			generation.operations.set(requestId, record);
			if (websocket.isCurrentOpen(generation)) {
				sendSet();
			} else if (
				websocket.isCurrent(generation) &&
				generation.readyState === ReadyStates.CONNECTING
			) {
				generation.setWaiters.add(record);
			} else {
				record.fail(
					clientError(
						'SMOLRPC_UNAVAILABLE',
						`SET request on ${resource} could not be sent because the connection is unavailable.`,
						'set',
						resource,
						generation,
						requestId,
						startedAt,
					),
				);
			}
		});
	}

	/**
	 * @param {string} resource
	 * @param {any} request
	 * @param {Params} params
	 * @param {boolean} cache
	 * @returns {Subscribable}
	 */
	function subscribeHandler(resource, request, params, cache) {
		const currentGeneration = websocket.getCurrentGeneration();
		if (
			currentGeneration == null ||
			!websocket.isCurrentOpen(currentGeneration)
		) {
			throw clientError(
				'SMOLRPC_UNAVAILABLE',
				`Subscription on ${resource} could not be created because the connection is unavailable.`,
				'subscribe',
				resource,
				currentGeneration,
			);
		}
		const generation = currentGeneration;

		const resourceWithParams = getResourceWithParams(resource, params);
		/** @type {string | undefined} */
		let cacheKey;
		if (cache) {
			try {
				cacheKey = getCacheKey(resourceWithParams, request);
			} catch {
				throw clientError(
					'SMOLRPC_SERIALIZATION',
					`Subscription on ${resource} could not be serialized.`,
					'subscribe',
					resource,
					generation,
				);
			}
		}
		if (!websocket.isCurrentOpen(generation)) {
			throw clientError(
				'SMOLRPC_UNAVAILABLE',
				`Subscription on ${resource} could not be created because the connection is unavailable.`,
				'subscribe',
				resource,
				generation,
			);
		}
		if (cacheKey != null) {
			const existing = generation.subscriptions.get(cacheKey);
			if (existing != null) {
				return /** @type {any} */ (existing).subscribable;
			}
		}

		/** @type {Set<{ observer: Partial<import("./types").Observer<any>> }>} */
		const observers = new Set();
		let status = /** @type {'idle' | 'active' | 'terminal'} */ ('idle');
		let requestId = 0;
		let startedAt = Date.now();
		let hasValue = false;
		let deliveryDepth = 0;
		/** @type {any} */
		let lastValue;
		/** @type {SmolRpcError | undefined} */
		let terminalError;
		/** @type {SmolRpcError | undefined} */
		let pendingError;
		/** @type {{ observer: Partial<import("./types").Observer<any>> }[] | undefined} */
		let pendingObservers;
		let definiteResponse = false;

		/**
		 * @param {Partial<import("./types").Observer<any>>} observer
		 * @param {'next' | 'error'} method
		 * @param {unknown} value
		 */
		function invokeObserver(observer, method, value) {
			try {
				observer[method]?.(value);
			} catch {
				diagnose(
					`initClientProxy: subscription observer ${method} callback threw`,
					'subscribe',
					resource,
					generation,
					requestId || undefined,
					startedAt,
				);
			}
		}

		/**
		 * @param {{ observer: Partial<import("./types").Observer<any>> }[]} recipients
		 * @param {SmolRpcError} error
		 */
		function deliverErrors(recipients, error) {
			for (const recipient of recipients) {
				invokeObserver(recipient.observer, 'error', error);
			}
		}

		const record = {
			kind: /** @type {const} */ ('subscribe'),
			generation,
			get requestId() {
				return requestId;
			},
			set requestId(value) {
				requestId = value;
			},
			phase: /** @type {'unsent' | 'sending' | 'sent'} */ ('unsent'),
			/** @type {Subscribable} */
			subscribable: /** @type {any} */ (undefined),
			detach() {
				if (
					requestId !== 0 &&
					generation.operations.get(requestId) === record
				) {
					generation.operations.delete(requestId);
				}
				if (
					cacheKey != null &&
					generation.subscriptions.get(cacheKey) === record
				) {
					generation.subscriptions.delete(cacheKey);
				}
			},
			/**
			 * @param {SmolRpcError} error
			 * @param {boolean} deferWhileSending
			 */
			fail(error, deferWhileSending) {
				if (status === 'terminal') return;
				const recipients = [...observers];
				observers.clear();
				record.detach();
				status = 'terminal';
				terminalError = error;
				if (deferWhileSending && record.phase === 'sending') {
					pendingError = error;
					pendingObservers = recipients;
					return;
				}
				deliverErrors(recipients, error);
			},
			prepareRetirement() {
				if (status === 'terminal') return undefined;
				const error = clientError(
					'SMOLRPC_UNAVAILABLE',
					`Subscription on ${resource} ended because the connection became unavailable.`,
					'subscribe',
					resource,
					generation,
					requestId || undefined,
					startedAt,
				);
				const recipients = [...observers];
				observers.clear();
				record.detach();
				status = 'terminal';
				terminalError = error;
				if (record.phase === 'sending') {
					pendingError = error;
					pendingObservers = recipients;
					return undefined;
				}
				return () => deliverErrors(recipients, error);
			},
			/** @param {unknown} message */
			handleMessage(message) {
				if (status !== 'active') return;
				if (
					isMatchingRejection(
						message,
						requestId,
						'SubscribeRequest',
						resource,
					)
				) {
					definiteResponse = true;
					const rejection = /** @type {Record<string, any>} */ (
						message
					);
					record.fail(
						clientError(
							'SMOLRPC_SERVER_REJECTION',
							`Subscription on ${resource} rejected with error: ${rejection.error}`,
							'subscribe',
							resource,
							generation,
							requestId,
							startedAt,
						),
						false,
					);
					return;
				}
				if (
					isRecord(message) &&
					message.id === requestId &&
					message.resource === resource &&
					message.type === 'SubscribeAccept'
				) {
					return;
				}
				if (
					isRecord(message) &&
					message.id === requestId &&
					message.resource === resource &&
					message.type === 'SubscribeEvent'
				) {
					hasValue = true;
					lastValue = message.data;
					const recipients = [...observers];
					deliveryDepth++;
					try {
						for (const recipient of recipients) {
							if (
								status !== 'active' ||
								!websocket.isCurrent(generation) ||
								!observers.has(recipient)
							) {
								continue;
							}
							invokeObserver(
								recipient.observer,
								'next',
								message.data,
							);
						}
					} finally {
						deliveryDepth--;
					}
					return;
				}
				record.fail(
					clientError(
						'SMOLRPC_PROTOCOL_ERROR',
						`Subscription on ${resource} received an unexpected response.`,
						'subscribe',
						resource,
						generation,
						requestId,
						startedAt,
					),
					true,
				);
			},
		};

		/** @param {SmolRpcError} error */
		function finishPending(error) {
			const recipients = pendingObservers ?? [];
			pendingObservers = undefined;
			pendingError = undefined;
			terminalError = error;
			deliverErrors(recipients, error);
		}

		function sendSubscription() {
			startedAt = Date.now();
			requestId = websocket.allocateRequestId(generation);
			/** @type {Request} */
			const frame = {
				id: requestId,
				type: 'SubscribeRequest',
				resource,
				params,
				request,
			};
			/** @type {string} */
			let serialized;
			try {
				serialized = serialize(
					frame,
					'subscribe',
					resource,
					generation,
					requestId,
					startedAt,
				);
			} catch (error) {
				record.fail(/** @type {SmolRpcError} */ (error), false);
				return;
			}
			if (!websocket.isCurrentOpen(generation)) {
				record.fail(
					clientError(
						'SMOLRPC_UNAVAILABLE',
						`Subscription on ${resource} could not be sent because the connection is unavailable.`,
						'subscribe',
						resource,
						generation,
						requestId,
						startedAt,
					),
					false,
				);
				return;
			}

			status = 'active';
			record.phase = 'unsent';
			definiteResponse = false;
			generation.operations.set(requestId, record);
			// A woken idle handle re-enters the cache so later lookups share it.
			if (cacheKey != null && !generation.subscriptions.has(cacheKey)) {
				generation.subscriptions.set(cacheKey, record);
			}
			const result = websocket.sendFrame(
				generation,
				record,
				frame,
				serialized,
			);
			if (result.kind === 'settled') return;
			if (result.kind === 'threw') {
				if (definiteResponse && pendingObservers == null) {
					return;
				}
				const error = clientError(
					'SMOLRPC_SEND_FAILED',
					`Subscription on ${resource} failed during native send.`,
					'subscribe',
					resource,
					generation,
					requestId,
					startedAt,
				);
				if (pendingObservers != null) {
					finishPending(error);
				} else {
					record.fail(error, false);
				}
				return;
			}
			if (result.kind === 'unavailable') {
				record.fail(
					clientError(
						'SMOLRPC_UNAVAILABLE',
						`Subscription on ${resource} could not be sent because the connection is unavailable.`,
						'subscribe',
						resource,
						generation,
						requestId,
						startedAt,
					),
					false,
				);
				return;
			}
			if (status === 'active') record.phase = 'sent';
			if (pendingError != null) {
				finishPending(pendingError);
			}
		}

		/** @param {number} subscriptionId */
		function sendUnsubscribe(subscriptionId) {
			if (!websocket.isCurrentOpen(generation)) return;
			const ackStartedAt = Date.now();
			const ackId = websocket.allocateRequestId(generation);
			/** @type {Request} */
			const frame = {
				id: ackId,
				subscriptionId,
				type: 'UnsubscribeRequest',
				resource,
				params,
			};
			/** @type {string} */
			let serialized;
			try {
				serialized = serialize(
					frame,
					'unsubscribe',
					resource,
					generation,
					ackId,
					ackStartedAt,
				);
			} catch {
				diagnose(
					'initClientProxy: unsubscribe serialization failed',
					'unsubscribe',
					resource,
					generation,
					ackId,
					ackStartedAt,
				);
				return;
			}
			if (!websocket.isCurrentOpen(generation)) {
				diagnose(
					'initClientProxy: unsubscribe connection unavailable',
					'unsubscribe',
					resource,
					generation,
					ackId,
					ackStartedAt,
				);
				return;
			}

			let settled = false;
			let retirementPending = false;
			/** @type {SmolRpcError | undefined} */
			let ackPendingError;
			/** @type {ReturnType<typeof setTimeout> | undefined} */
			let timer;
			const ack = {
				kind: /** @type {const} */ ('unsubscribe'),
				generation,
				requestId: ackId,
				phase: /** @type {'unsent' | 'sending' | 'sent'} */ ('unsent'),
				detach() {
					if (generation.operations.get(ackId) === ack) {
						generation.operations.delete(ackId);
					}
					if (generation.operations.get(subscriptionId) === ack) {
						generation.operations.delete(subscriptionId);
					}
					if (timer != null) {
						clearTimeout(timer);
						timer = undefined;
					}
				},
				prepareRetirement() {
					if (settled) return undefined;
					ack.detach();
					if (ack.phase === 'sending') {
						retirementPending = true;
					} else {
						settled = true;
					}
					return undefined;
				},
				/** @param {unknown} message */
				handleMessage(message) {
					if (settled) {
						return;
					}
					// The ack doubles as a tombstone for the old subscription id:
					// frames still in flight for it are expected, not diagnostics.
					if (extractRequestId(message) === subscriptionId) {
						return;
					}
					if (
						isRecord(message) &&
						message.type === 'UnsubscribeAccept' &&
						message.id === ackId &&
						message.resource === resource
					) {
						settled = true;
						ack.detach();
						return;
					}
					if (
						isMatchingRejection(
							message,
							ackId,
							'UnsubscribeRequest',
							resource,
						)
					) {
						settled = true;
						ack.detach();
						diagnose(
							'initClientProxy: unsubscribe acknowledgement rejected',
							'unsubscribe',
							resource,
							generation,
							ackId,
							ackStartedAt,
						);
						return;
					}
					const error = clientError(
						'SMOLRPC_PROTOCOL_ERROR',
						`Unsubscribe on ${resource} received an unexpected response.`,
						'unsubscribe',
						resource,
						generation,
						ackId,
						ackStartedAt,
					);
					ack.detach();
					if (ack.phase === 'sending') {
						ackPendingError = error;
						return;
					}
					settled = true;
					diagnose(
						'initClientProxy: unsubscribe acknowledgement failed',
						'unsubscribe',
						resource,
						generation,
						ackId,
						ackStartedAt,
					);
				},
			};

			timer = setTimeout(() => {
				if (settled) {
					return;
				}
				ack.detach();
				if (ack.phase === 'sending') {
					ackPendingError = clientError(
						'SMOLRPC_TIMEOUT',
						`Unsubscribe on ${resource} timed out.`,
						'unsubscribe',
						resource,
						generation,
						ackId,
						ackStartedAt,
					);
					return;
				}
				settled = true;
				diagnose(
					'initClientProxy: unsubscribe acknowledgement timed out',
					'unsubscribe',
					resource,
					generation,
					ackId,
					ackStartedAt,
				);
			}, OPERATION_TIMEOUT_MS);
			generation.operations.set(ackId, ack);
			generation.operations.set(subscriptionId, ack);
			const result = websocket.sendFrame(
				generation,
				ack,
				frame,
				serialized,
			);
			if (settled || result.kind === 'settled') return;
			if (result.kind === 'threw') {
				ack.detach();
				settled = true;
				diagnose(
					'initClientProxy: unsubscribe native send failed',
					'unsubscribe',
					resource,
					generation,
					ackId,
					ackStartedAt,
				);
				return;
			}
			if (result.kind === 'unavailable') {
				ack.detach();
				settled = true;
				diagnose(
					'initClientProxy: unsubscribe connection unavailable',
					'unsubscribe',
					resource,
					generation,
					ackId,
					ackStartedAt,
				);
				return;
			}
			ack.phase = 'sent';
			if (retirementPending || !websocket.isCurrent(generation)) {
				settled = true;
				ackPendingError = undefined;
				return;
			}
			if (ackPendingError != null) {
				settled = true;
				diagnose(
					'initClientProxy: unsubscribe acknowledgement failed',
					'unsubscribe',
					resource,
					generation,
					ackId,
					ackStartedAt,
				);
			}
		}

		function beginLocalUnsubscribe() {
			if (status !== 'active') return;
			const subscriptionId = requestId;
			record.detach();
			status = 'idle';
			requestId = 0;
			record.phase = 'unsent';
			pendingError = undefined;
			pendingObservers = undefined;
			definiteResponse = false;
			sendUnsubscribe(subscriptionId);
		}

		/**
		 * @param {{ observer: Partial<import("./types").Observer<any>> }} recipient
		 */
		function createHandle(recipient) {
			let unsubscribed = false;
			return {
				unsubscribe() {
					if (unsubscribed) return;
					unsubscribed = true;
					observers.delete(recipient);
					if (observers.size === 0) {
						beginLocalUnsubscribe();
					}
				},
			};
		}

		record.subscribable = {
			subscribe(observer) {
				if (status === 'terminal') {
					invokeObserver(
						observer,
						'error',
						terminalError ??
							clientError(
								'SMOLRPC_UNAVAILABLE',
								`Subscription on ${resource} is no longer available.`,
								'subscribe',
								resource,
								generation,
							),
					);
					return { unsubscribe() {} };
				}
				if (!websocket.isCurrentOpen(generation)) {
					const error = clientError(
						'SMOLRPC_UNAVAILABLE',
						`Subscription on ${resource} is no longer owned by the current connection.`,
						'subscribe',
						resource,
						generation,
					);
					// Only the newcomer is errored here. Existing observers are
					// retired by onclose, after statechange('unavailable').
					invokeObserver(observer, 'error', error);
					return { unsubscribe() {} };
				}
				const recipient = { observer };
				observers.add(recipient);
				const handle = createHandle(recipient);
				if (status === 'active') {
					if (
						hasValue &&
						deliveryDepth === 0 &&
						status === 'active' &&
						observers.has(recipient) &&
						websocket.isCurrent(generation)
					) {
						invokeObserver(observer, 'next', lastValue);
					}
					return handle;
				}
				sendSubscription();
				return handle;
			},
		};

		if (cacheKey != null) {
			generation.subscriptions.set(cacheKey, record);
		}
		return record.subscribable;
	}

	/** @type {import("./client.types").Client<Resources>} */
	const proxy = /** @type {any} */ (
		new Proxy(
			{},
			{
				get(_target, /** @type {string} */ resource) {
					return {
						get: (
							/** @type {{ params: Params; request: any } | undefined} */ args,
						) => getHandler(resource, args?.request, args?.params),
						set: (
							/** @type {{ params: Params; request: any }} */ args,
						) => setHandler(resource, args.request, args.params),
						subscribe: (
							/** @type {{ params: Params; request: any, cache: boolean } | undefined} */ args,
						) =>
							subscribeHandler(
								resource,
								args?.request,
								args?.params,
								args?.cache ?? true,
							),
					};
				},
			},
		)
	);

	/**
	 * @param {Generation} generation
	 * @param {MessageEvent} event
	 */
	function onmessage(generation, event) {
		let message;
		try {
			message = json_parse(event.data);
		} catch {
			reportInternalError(
				'initClientProxy.onmessage: malformed or unaddressable frame',
				{ generation: generation.number },
			);
			return;
		}
		const requestId = extractRequestId(message);
		if (requestId == null) {
			reportInternalError(
				'initClientProxy.onmessage: unaddressable frame',
				{ generation: generation.number },
			);
			return;
		}
		const operation = generation.operations.get(requestId);
		if (operation == null) {
			reportInternalError(
				'initClientProxy.onmessage: no operation found for response',
				{ generation: generation.number, requestId },
			);
			return;
		}
		/** @type {{ handleMessage?: (message: unknown) => void }} */ (
			operation
		).handleMessage?.(message);
	}

	return { onmessage, proxy };
}

/**
 * @template {import("./types").AnyResources} Resources
 * @return {import("./client.types").Client<Resources>}
 */
export function dummyClient() {
	const noopPromise = new Promise(() => {});
	const noopSubscribable = /** @type {Subscribable} */ ({
		subscribe: () => ({ unsubscribe: () => {} }),
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
	if (request == null) return resourceWithParams;
	return `${resourceWithParams}-${json_stringify(request)}`;
}
