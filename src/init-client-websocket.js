/**
 * @typedef {import("./message.types").Request<any>} Request
 * @typedef {import("./client.types").ClientTransportState} ClientTransportState
 */

export const ReadyStates = Object.freeze({
	CONNECTING: 0,
	OPEN: 1,
	CLOSING: 2,
	CLOSED: 3,
});
/** @typedef {typeof ReadyStates[keyof typeof ReadyStates]} ReadyState */

export const NORMAL_CLOSE_CODE = 1000;
export const RECONNECT_DELAYS_MS = Object.freeze([1_000, 2_000, 5_000, 10_000]);
const RECONNECT_JITTER_PERCENT = 20;

/**
 * @typedef {object} ClientOperation
 * @property {'get' | 'set' | 'subscribe' | 'unsubscribe'} kind
 * @property {ConnectionGeneration} generation
 * @property {number} requestId
 * @property {'unsent' | 'sending' | 'sent'} phase
 * @property {() => void} detach
 * @property {() => (() => void) | undefined} prepareRetirement
 * @property {() => void} [onOpen]
 */

/**
 * @typedef {object} ConnectionGeneration
 * @property {number} number
 * @property {WebSocket} socket
 * @property {ReadyState} readyState
 * @property {boolean} retired
 * @property {number} nextRequestId
 * @property {Map<number, ClientOperation>} operations
 * @property {Set<ClientOperation>} setWaiters
 * @property {Map<string, ClientOperation>} subscriptions
 */

/**
 * @typedef {object} ConstructionAttempt
 * @property {number} number
 * @property {'explicit' | 'restart' | 'automatic'} kind
 * @property {object} intent
 */

/**
 * @typedef {object} ReconnectToken
 * @property {number} number
 * @property {object} intent
 * @property {ReturnType<typeof setTimeout> | undefined} timer
 */

/**
 * @param {number} number
 * @param {number} jitterPercentage
 * @returns {number}
 */
function addRandomJitter(number, jitterPercentage) {
	const jitter =
		Math.random() * (jitterPercentage / 100) * 2 * number -
		(jitterPercentage / 100) * number;
	return number + jitter;
}

/**
 * @param {{
 *  url: string,
 *  createWebSocket: (url: string) => WebSocket,
 *  onopen?: (e: Event) => void,
 *  onmessage?: (e: MessageEvent) => void,
 *  dispatchMessage: (generation: ConnectionGeneration, e: MessageEvent) => void,
 *  onstatechange?: (state: ClientTransportState) => void,
 *  onreconnect?: () => void,
 *  onclose?: (e: CloseEvent) => void,
 *  onerror?: (e: Event) => void,
 *  onsend?: (r: Request) => void,
 *  reportInternalError: (message: string, data: Record<string, unknown>) => void,
 * }} args
 */
export function initClientWebSocket({
	url,
	createWebSocket,
	onopen,
	onmessage,
	dispatchMessage,
	onstatechange,
	onreconnect,
	onclose,
	onerror,
	onsend,
	reportInternalError,
}) {
	const runtime = {
		running: false,
		/** @type {ClientTransportState} */
		state: 'stopped',
		/** @type {ConnectionGeneration | undefined} */
		currentGeneration: undefined,
		nextGeneration: 1,
		/** @type {ConstructionAttempt | undefined} */
		currentAttempt: undefined,
		nextAttempt: 1,
		/** @type {ReconnectToken | undefined} */
		reconnectToken: undefined,
		nextReconnectToken: 1,
		reopenCount: 0,
		intent: {},
	};

	/** @param {ClientTransportState} state */
	function publishState(state) {
		if (runtime.state === state) {
			return;
		}
		runtime.state = state;
		onstatechange?.(state);
	}

	function cancelReconnect() {
		const token = runtime.reconnectToken;
		if (token == null) {
			return;
		}
		runtime.reconnectToken = undefined;
		if (token.timer != null) {
			clearTimeout(token.timer);
		}
	}

	/** @param {WebSocket} socket */
	function discardSocket(socket) {
		try {
			socket.close(
				NORMAL_CLOSE_CODE,
				'connection attempt was superseded',
			);
		} catch {
			reportInternalError(
				'initClientWebSocket: failed to close a superseded socket',
				{ readyState: socket.readyState },
			);
		}
	}

	/** @param {ConnectionGeneration} generation */
	function isCurrent(generation) {
		return (
			runtime.running &&
			runtime.currentGeneration === generation &&
			!generation.retired
		);
	}

	/** @param {ConnectionGeneration} generation */
	function isCurrentOpen(generation) {
		return (
			isCurrent(generation) &&
			generation.readyState === ReadyStates.OPEN &&
			generation.socket.readyState === ReadyStates.OPEN
		);
	}

	/**
	 * @param {ConnectionGeneration} generation
	 * @param {'stopped' | 'backoff' | 'restart'} destination
	 * @param {object} intent
	 * @param {{ event?: CloseEvent, closeSocket?: boolean, closeReason?: string }} [options]
	 */
	function retireGeneration(generation, destination, intent, options = {}) {
		if (generation.retired) {
			return;
		}

		generation.retired = true;
		generation.readyState = ReadyStates.CLOSED;
		if (runtime.currentGeneration === generation) {
			runtime.currentGeneration = undefined;
		}

		const records = new Set([
			...generation.operations.values(),
			...generation.subscriptions.values(),
		]);
		/** @type {(() => void)[]} */
		const deliveries = [];
		for (const record of records) {
			const delivery = record.prepareRetirement();
			if (delivery != null) {
				deliveries.push(delivery);
			}
		}
		generation.operations.clear();
		generation.subscriptions.clear();
		generation.setWaiters.clear();

		publishState('unavailable');

		if (runtime.intent === intent) {
			if (destination === 'stopped' && !runtime.running) {
				publishState('stopped');
			} else if (destination === 'backoff' && runtime.running) {
				scheduleReconnect(intent);
			} else if (destination === 'restart' && runtime.running) {
				startAttempt('restart', intent);
			}
		}

		if (options.closeSocket) {
			try {
				generation.socket.close(
					NORMAL_CLOSE_CODE,
					options.closeReason ?? 'close was called',
				);
			} catch {
				reportInternalError(
					'initClientWebSocket.close: native close failed',
					{
						generation: generation.number,
						readyState: generation.socket.readyState,
					},
				);
			}
		}

		if (options.event != null) {
			onclose?.(options.event);
		}

		for (const deliver of deliveries) {
			deliver();
		}
	}

	/** @param {object} intent */
	function scheduleReconnect(intent) {
		if (
			!runtime.running ||
			runtime.intent !== intent ||
			runtime.currentGeneration != null
		) {
			return;
		}
		cancelReconnect();

		const n = runtime.reopenCount++;
		const base =
			RECONNECT_DELAYS_MS[
				n >= RECONNECT_DELAYS_MS.length
					? RECONNECT_DELAYS_MS.length - 1
					: n
			];
		const wait = addRandomJitter(base, RECONNECT_JITTER_PERCENT);
		/** @type {ReconnectToken} */
		const token = {
			number: runtime.nextReconnectToken++,
			intent,
			timer: undefined,
		};
		runtime.reconnectToken = token;
		publishState('backoff');
		if (
			runtime.reconnectToken !== token ||
			!runtime.running ||
			runtime.intent !== intent ||
			runtime.currentGeneration != null
		) {
			return;
		}
		token.timer = setTimeout(() => {
			if (
				runtime.reconnectToken !== token ||
				!runtime.running ||
				runtime.intent !== token.intent ||
				runtime.currentGeneration != null
			) {
				return;
			}
			runtime.reconnectToken = undefined;
			startAttempt('automatic', token.intent);
		}, wait);
	}

	/**
	 * @param {ConstructionAttempt} attempt
	 * @returns {boolean}
	 */
	function ownsAttempt(attempt) {
		return (
			runtime.running &&
			runtime.intent === attempt.intent &&
			runtime.currentAttempt === attempt &&
			runtime.currentGeneration == null
		);
	}

	/**
	 * @param {'explicit' | 'restart' | 'automatic'} kind
	 * @param {object} intent
	 */
	function startAttempt(kind, intent) {
		/** @type {ConstructionAttempt} */
		const attempt = {
			number: runtime.nextAttempt++,
			kind,
			intent,
		};
		runtime.currentAttempt = attempt;
		publishState('connecting');
		if (!ownsAttempt(attempt)) {
			return;
		}

		/** @type {WebSocket} */
		let socket;
		try {
			socket = createWebSocket(url);
		} catch (error) {
			if (!ownsAttempt(attempt)) {
				return;
			}
			if (kind === 'explicit') {
				runtime.currentAttempt = undefined;
				runtime.running = false;
				publishState('stopped');
				throw error;
			}
			reportInternalError(
				'initClientWebSocket: managed socket construction failed',
				{ readyState: ReadyStates.CLOSED },
			);
			if (!ownsAttempt(attempt)) {
				return;
			}
			runtime.currentAttempt = undefined;
			scheduleReconnect(intent);
			return;
		}

		if (!ownsAttempt(attempt)) {
			discardSocket(socket);
			return;
		}

		/** @type {ConnectionGeneration} */
		const generation = {
			number: runtime.nextGeneration++,
			socket,
			readyState: ReadyStates.CONNECTING,
			retired: false,
			nextRequestId: 1,
			operations: new Map(),
			setWaiters: new Set(),
			subscriptions: new Map(),
		};

		try {
			socket.onopen = (event) => {
				if (!isCurrent(generation)) {
					return;
				}
				generation.readyState = ReadyStates.OPEN;
				runtime.reopenCount = 0;
				publishState('open');
				if (!isCurrentOpen(generation)) {
					return;
				}
				onopen?.(event);
				if (!isCurrentOpen(generation)) {
					return;
				}
				for (const waiter of [...generation.setWaiters]) {
					if (!isCurrentOpen(generation)) {
						return;
					}
					if (generation.setWaiters.has(waiter)) {
						waiter.onOpen?.();
					}
				}
			};
			socket.onmessage = (event) => {
				if (!isCurrent(generation)) {
					return;
				}
				onmessage?.(event);
				if (!isCurrent(generation)) {
					return;
				}
				dispatchMessage(generation, event);
			};
			socket.onerror = (event) => {
				if (!isCurrent(generation)) {
					return;
				}
				onerror?.(event);
			};
			socket.onclose = (event) => {
				if (!isCurrent(generation)) {
					return;
				}
				generation.readyState = ReadyStates.CLOSED;
				const closeIntent = {};
				runtime.intent = closeIntent;
				retireGeneration(generation, 'backoff', closeIntent, {
					event,
				});
			};
		} catch (error) {
			generation.retired = true;
			discardSocket(socket);
			if (!ownsAttempt(attempt)) {
				return;
			}
			if (kind === 'explicit') {
				runtime.currentAttempt = undefined;
				runtime.running = false;
				publishState('stopped');
				throw error;
			}
			reportInternalError(
				'initClientWebSocket: socket handler installation failed',
				{ readyState: socket.readyState },
			);
			if (!ownsAttempt(attempt)) {
				return;
			}
			runtime.currentAttempt = undefined;
			scheduleReconnect(intent);
			return;
		}

		if (!ownsAttempt(attempt)) {
			generation.retired = true;
			discardSocket(socket);
			return;
		}
		runtime.currentGeneration = generation;
		runtime.currentAttempt = undefined;
		if (kind === 'automatic') {
			onreconnect?.();
		}
	}

	/**
	 * Stops automatic connection management, retires current work, and cancels
	 * any construction attempt or reconnect timer. Repeated calls while stopped
	 * are no-ops.
	 */
	function close() {
		if (!runtime.running && runtime.state === 'stopped') {
			return;
		}
		const intent = {};
		runtime.intent = intent;
		runtime.running = false;
		runtime.currentAttempt = undefined;
		cancelReconnect();
		const generation = runtime.currentGeneration;
		if (generation == null) {
			publishState('stopped');
			return;
		}
		retireGeneration(generation, 'stopped', intent, {
			closeSocket: true,
		});
	}

	/**
	 * Starts automatic connection management only when stopped, resets reconnect
	 * backoff, and makes an immediate explicit connection attempt. It does not
	 * bypass an in-progress connection or reconnect backoff.
	 */
	function open() {
		if (runtime.running) {
			return;
		}
		const intent = {};
		runtime.intent = intent;
		runtime.running = true;
		runtime.reopenCount = 0;
		cancelReconnect();
		startAttempt('explicit', intent);
	}

	/**
	 * Immediately replaces the current connection attempt or generation, or
	 * bypasses reconnect backoff, while connection management is running. It is
	 * a no-op while stopped and, unlike close followed by open, never publishes
	 * an intermediate stopped intent.
	 */
	function restart() {
		if (!runtime.running) {
			return;
		}
		const intent = {};
		runtime.intent = intent;
		runtime.reopenCount = 0;
		runtime.currentAttempt = undefined;
		cancelReconnect();
		const generation = runtime.currentGeneration;
		if (generation == null) {
			startAttempt('restart', intent);
			return;
		}
		retireGeneration(generation, 'restart', intent, {
			closeReason: 'restart was called',
			closeSocket: true,
		});
	}

	/**
	 * Marks the running connection attempt or generation unhealthy and enters
	 * normal delayed reconnect backoff without resetting its history. A call
	 * while already in backoff preserves the existing timer and delay; a call
	 * while stopped is a no-op.
	 */
	function invalidate() {
		if (!runtime.running) {
			return;
		}
		if (runtime.state === 'backoff' && runtime.reconnectToken != null) {
			return;
		}
		const intent = {};
		runtime.intent = intent;
		runtime.currentAttempt = undefined;
		cancelReconnect();
		const generation = runtime.currentGeneration;
		if (generation == null) {
			scheduleReconnect(intent);
			return;
		}
		retireGeneration(generation, 'backoff', intent, {
			closeReason: 'connection was invalidated',
			closeSocket: true,
		});
	}

	/** @returns {ConnectionGeneration | undefined} */
	function getCurrentGeneration() {
		return runtime.currentGeneration;
	}

	/** @param {ConnectionGeneration} generation */
	function allocateRequestId(generation) {
		return generation.nextRequestId++;
	}

	/**
	 * @param {ConnectionGeneration} generation
	 * @param {ClientOperation} operation
	 * @param {Request} request
	 * @param {string} serialized
	 * @returns {{ kind: 'returned' | 'unavailable' | 'settled' } | { kind: 'threw', error: unknown }}
	 */
	function sendFrame(generation, operation, request, serialized) {
		if (
			!isCurrentOpen(generation) ||
			generation.operations.get(operation.requestId) !== operation
		) {
			return { kind: 'unavailable' };
		}
		onsend?.(request);
		if (
			!isCurrentOpen(generation) ||
			generation.operations.get(operation.requestId) !== operation
		) {
			return generation.operations.get(operation.requestId) === operation
				? { kind: 'unavailable' }
				: { kind: 'settled' };
		}
		operation.phase = 'sending';
		try {
			generation.socket.send(serialized);
			return { kind: 'returned' };
		} catch (error) {
			return { kind: 'threw', error };
		}
	}

	return {
		allocateRequestId,
		close,
		getCurrentGeneration,
		isCurrent,
		isCurrentOpen,
		open,
		restart,
		invalidate,
		sendFrame,
		get readyState() {
			const generation = runtime.currentGeneration;
			if (generation != null) {
				return generation.readyState;
			}
			return runtime.state === 'connecting'
				? ReadyStates.CONNECTING
				: ReadyStates.CLOSED;
		},
		get state() {
			return runtime.state;
		},
	};
}
