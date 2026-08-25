import { json_parse, json_stringify } from '../index.js';

const READY_STATES = {
	CLOSED: 3,
	CLOSING: 2,
	CONNECTING: 0,
	OPEN: 1,
} as const;

type HandlerName = 'close' | 'error' | 'message' | 'open';

type ConstructCallback = (
	socket: ControlledWebSocket,
	factory: ControlledWebSocketFactory,
) => void;

export interface ControlledSocketPlan {
	constructorError?: unknown;
	onConstruct?: ConstructCallback;
	onHandlerInstalled?: (
		socket: ControlledWebSocket,
		handler: HandlerName,
	) => void;
	onSend?: (socket: ControlledWebSocket, data: string) => void;
	sendError?: unknown;
}

/**
 * The small subset of a native WebSocket used by the client. Delivery methods
 * intentionally remain usable after close so tests can exercise stale native
 * callbacks from replaced sockets.
 */
export class ControlledWebSocket {
	readonly closeCalls: Array<{ code?: number; reason?: string }> = [];
	readonly sendAttempts: string[] = [];
	readonly sent: string[] = [];
	readonly url: string;

	readyState: number = READY_STATES.CONNECTING;

	private closeHandler: ((event: CloseEvent) => void) | null = null;
	private errorHandler: ((event: Event) => void) | null = null;
	private messageHandler: ((event: MessageEvent) => void) | null = null;
	private openHandler: ((event: Event) => void) | null = null;

	constructor(
		url: string,
		private readonly plan: ControlledSocketPlan,
	) {
		this.url = url;
	}

	get onclose() {
		return this.closeHandler;
	}

	set onclose(handler: ((event: CloseEvent) => void) | null) {
		this.closeHandler = handler;
		this.handlerInstalled('close');
	}

	get onerror() {
		return this.errorHandler;
	}

	set onerror(handler: ((event: Event) => void) | null) {
		this.errorHandler = handler;
		this.handlerInstalled('error');
	}

	get onmessage() {
		return this.messageHandler;
	}

	set onmessage(handler: ((event: MessageEvent) => void) | null) {
		this.messageHandler = handler;
		this.handlerInstalled('message');
	}

	get onopen() {
		return this.openHandler;
	}

	set onopen(handler: ((event: Event) => void) | null) {
		this.openHandler = handler;
		this.handlerInstalled('open');
	}

	close(code?: number, reason?: string) {
		this.closeCalls.push({ code, reason });
		this.readyState = READY_STATES.CLOSING;
	}

	open() {
		this.readyState = READY_STATES.OPEN;
		this.openHandler?.(this.event('open'));
	}

	message(data: unknown) {
		const serialized =
			typeof data === 'string' ? data : json_stringify(data);
		this.messageHandler?.(
			this.event('message', { data: serialized }) as MessageEvent,
		);
	}

	error() {
		this.errorHandler?.(this.event('error'));
	}

	peerClose({
		code = 1006,
		reason = '',
		wasClean = false,
	}: {
		code?: number;
		reason?: string;
		wasClean?: boolean;
	} = {}) {
		this.readyState = READY_STATES.CLOSED;
		this.closeHandler?.(
			this.event('close', { code, reason, wasClean }) as CloseEvent,
		);
	}

	send(data: string) {
		this.sendAttempts.push(data);
		this.plan.onSend?.(this, data);
		if (this.plan.sendError !== undefined) {
			throw this.plan.sendError;
		}
		this.sent.push(data);
	}

	sentFrames<T = Record<string, unknown>>() {
		return this.sent.map((frame) => json_parse(frame) as T);
	}

	private event(type: string, properties: Record<string, unknown> = {}) {
		return {
			target: this,
			type,
			...properties,
		} as unknown as Event;
	}

	private handlerInstalled(handler: HandlerName) {
		this.plan.onHandlerInstalled?.(this, handler);
	}
}

/** A queue-driven WebSocket factory used to deterministically control attempts. */
export class ControlledWebSocketFactory {
	/** Every constructor attempt, including attempts that throw or are superseded. */
	readonly attempts: ControlledWebSocket[] = [];
	/** Sockets whose constructors returned successfully, in return order. */
	readonly sockets: ControlledWebSocket[] = [];

	private readonly plans: ControlledSocketPlan[] = [];

	enqueue(plan: ControlledSocketPlan) {
		this.plans.push(plan);
		return this;
	}

	createWebSocket = (url: string): WebSocket => {
		const plan = this.plans.shift() ?? {};
		const socket = new ControlledWebSocket(url, plan);
		this.attempts.push(socket);
		plan.onConstruct?.(socket, this);
		if (plan.constructorError !== undefined) {
			throw plan.constructorError;
		}
		this.sockets.push(socket);
		return socket as unknown as WebSocket;
	};

	/**
	 * The most recently returned socket. This is a convenience for non-reentrant
	 * tests, not evidence that the socket owns the current runtime generation.
	 */
	get latest() {
		const socket = this.sockets.at(-1);
		if (socket == null) {
			throw new Error('No controlled WebSocket has been constructed');
		}
		return socket;
	}
}
