declare module 'smolrpc' {
	import type { StandardSchemaV1 } from '@standard-schema/spec';
	type GetHandler<
		Resources extends AnyResources,
		Resource extends keyof AnyResources,
	> = ResourceParams<Resource> extends null | undefined
		? () => Promise<
				StandardSchemaV1.InferOutput<Resources[Resource]['response']>
		  >
		: (args: {
				params: ResourceParams<Resource>;
		  }) => Promise<
				StandardSchemaV1.InferOutput<Resources[Resource]['response']>
		  >;
	type GetHandlerWithRequest<
		Resources extends AnyResources,
		Resource extends keyof AnyResources,
		Request extends AnyResource['request'],
	> = ResourceParams<Resource> extends null | undefined
		? (args: {
				request: Request extends StandardSchemaV1
					? StandardSchemaV1.InferInput<Request>
					: undefined;
		  }) => Promise<
				StandardSchemaV1.InferOutput<Resources[Resource]['response']>
		  >
		: (args: {
				request: Request extends StandardSchemaV1
					? StandardSchemaV1.InferInput<Request>
					: undefined;
				params: ResourceParams<Resource>;
		  }) => Promise<
				StandardSchemaV1.InferOutput<Resources[Resource]['response']>
		  >;
	type SetHandler<
		Resources extends AnyResources,
		Resource extends keyof AnyResources,
		Request extends AnyResource['request'],
	> = ResourceParams<Resource> extends null | undefined
		? (args: {
				request: Request extends StandardSchemaV1
					? StandardSchemaV1.InferInput<Request>
					: undefined;
		  }) => Promise<
				StandardSchemaV1.InferOutput<Resources[Resource]['response']>
		  >
		: (args: {
				request: Request extends StandardSchemaV1
					? StandardSchemaV1.InferInput<Request>
					: undefined;
				params: ResourceParams<Resource>;
		  }) => Promise<
				StandardSchemaV1.InferOutput<Resources[Resource]['response']>
		  >;
	type SubscribeHandler<
		Resources extends AnyResources,
		Resource extends keyof AnyResources,
	> = ResourceParams<Resource> extends null | undefined
		? (args?: {
				cache?: boolean;
		  }) => Subscribable<
				StandardSchemaV1.InferOutput<Resources[Resource]['response']>
		  >
		: (args: {
				cache?: boolean;
				params: ResourceParams<Resource>;
		  }) => Subscribable<
				StandardSchemaV1.InferOutput<Resources[Resource]['response']>
		  >;
	type SubscribeHandlerWithRequest<
		Resources extends AnyResources,
		Resource extends keyof AnyResources,
		Request extends AnyResource['request'],
	> = ResourceParams<Resource> extends null | undefined
		? (args: {
				cache?: boolean;
				request: Request extends StandardSchemaV1
					? StandardSchemaV1.InferInput<Request>
					: undefined;
		  }) => Subscribable<
				StandardSchemaV1.InferOutput<Resources[Resource]['response']>
		  >
		: (args: {
				cache?: boolean;
				request: Request extends StandardSchemaV1
					? StandardSchemaV1.InferInput<Request>
					: undefined;
				params: ResourceParams<Resource>;
		  }) => Subscribable<
				StandardSchemaV1.InferOutput<Resources[Resource]['response']>
		  >;
	export type Client<Resources extends AnyResources> = {
		[R in keyof Resources & string]: Resources[R] extends {
			type: 'get';
			request: infer Request extends StandardSchemaV1;
		}
			? {
					get: GetHandlerWithRequest<Resources, R, Request>;
			  }
			: Resources[R] extends {
					type: 'get';
			  }
			? {
					get: GetHandler<Resources, R>;
			  }
			: Resources[R] extends {
					type: 'set';
					request: infer Request extends StandardSchemaV1;
			  }
			? {
					set: SetHandler<Resources, R, Request>;
			  }
			: Resources[R] extends {
					type: 'subscribe';
					request: infer Request extends StandardSchemaV1;
					cache?: boolean;
			  }
			? {
					subscribe: SubscribeHandlerWithRequest<
						Resources,
						R,
						Request
					>;
			  }
			: Resources[R] extends {
					type: 'subscribe';
					cache?: boolean;
			  }
			? {
					subscribe: SubscribeHandler<Resources, R>;
			  }
			: Resources[R] extends {
					type: 'get|set';
					request: infer Request extends StandardSchemaV1;
			  }
			? {
					get: GetHandlerWithRequest<Resources, R, Request>;
					set: SetHandler<Resources, R, Request>;
			  }
			: Resources[R] extends {
					type: 'get|subscribe';
					request: infer Request extends StandardSchemaV1;
					cache?: boolean;
			  }
			? {
					get: GetHandlerWithRequest<Resources, R, Request>;
					subscribe: SubscribeHandlerWithRequest<
						Resources,
						R,
						Request
					>;
			  }
			: Resources[R] extends {
					type: 'get|subscribe';
					cache?: boolean;
			  }
			? {
					get: GetHandler<Resources, R>;
					subscribe: SubscribeHandler<Resources, R>;
			  }
			: Resources[R] extends {
					type: 'set|subscribe';
					request: infer Request extends StandardSchemaV1;
					cache?: boolean;
			  }
			? {
					set: SetHandler<Resources, R, Request>;
					subscribe: SubscribeHandlerWithRequest<
						Resources,
						R,
						Request
					>;
			  }
			: Resources[R] extends {
					type: 'get|set|subscribe';
					request: infer Request extends StandardSchemaV1;
					cache?: boolean;
			  }
			? {
					get: GetHandlerWithRequest<Resources, R, Request>;
					set: SetHandler<Resources, R, Request>;
					subscribe: SubscribeHandlerWithRequest<
						Resources,
						R,
						Request
					>;
			  }
			: never;
	};
	export interface ClientMethods {
		/**
		 * Stops automatic connection management, retires current work, and cancels
		 * any in-progress connection attempt or reconnect timer.
		 */
		close(): void;
		/**
		 * Starts connection management only when stopped, resets backoff, and makes
		 * an immediate connection attempt. It is a no-op while already running,
		 * including while connecting or waiting in reconnect backoff.
		 */
		open(): void;
		/**
		 * Immediately replaces the connection attempt or generation, or bypasses
		 * reconnect backoff, only while connection management is already running.
		 * It is a no-op while stopped and differs from `close(); open()` by avoiding
		 * an intermediate stopped intent and by recovering automatically if the
		 * replacement constructor fails.
		 */
		restart(): void;
		/**
		 * Marks a running connection attempt or generation unhealthy and enters
		 * normal delayed reconnect backoff without resetting its history. While
		 * already in backoff, the existing timer and delay are preserved. It is a
		 * no-op while stopped.
		 */
		invalidate(): void;
	}
	/** Logical transport state, reported independently of raw WebSocket events. */
	export type ClientTransportState =
		| 'stopped'
		| 'connecting'
		| 'open'
		| 'unavailable'
		| 'backoff';
	export interface ClientWebSocketEvents {
		/** Raw close event from the current socket. Retired sockets are ignored. */
		close?: (e: CloseEvent) => void;
		/** Raw error event from the current socket. An error alone does not start recovery. */
		error?: (e: Event) => void;
		/** Raw message event from the current socket, before protocol dispatch. */
		message?: (e: MessageEvent) => void;
		/** Raw open event from the current socket. */
		open?: (e: Event) => void;
		/**
		 * Runs after a current automatic backoff attempt successfully constructs and
		 * publishes a socket, before native open. Initialization, explicit open, and
		 * restart attempts do not invoke this hook.
		 */
		reconnect?: () => void;
		/** Raw request notification immediately before native send. */
		send?: (request: Request<any>) => void;
		/** Reports logical transport state independently of raw WebSocket events. */
		statechange?: (state: ClientTransportState) => void;
	}
	/** A stable, sanitised error produced by the SMOLRPC client. */
	export class SmolRpcError extends Error {
		constructor(
			code: SmolRpcErrorCode,
			message: string,
			metadata?: SmolRpcErrorMetadata | undefined,
		);

		readonly code: SmolRpcErrorCode;

		readonly metadata:
			| {
					operation?:
						| 'get'
						| 'set'
						| 'subscribe'
						| 'unsubscribe'
						| undefined;
					resource?: string | undefined;
					requestId?: number | undefined;
					generation?: number | undefined;
					readyState?: number | undefined;
					elapsedMs?: number | undefined;
			  }
			| undefined;
	}
	export type SmolRpcErrorCode =
		| 'SMOLRPC_UNAVAILABLE'
		| 'SMOLRPC_TIMEOUT'
		| 'SMOLRPC_SERVER_REJECTION'
		| 'SMOLRPC_PROTOCOL_ERROR'
		| 'SMOLRPC_MUTATION_OUTCOME_UNKNOWN'
		| 'SMOLRPC_SERIALIZATION'
		| 'SMOLRPC_SEND_FAILED';
	export type SmolRpcErrorMetadata = {
		operation?: 'get' | 'set' | 'subscribe' | 'unsubscribe' | undefined;
		resource?: string | undefined;
		requestId?: number | undefined;
		generation?: number | undefined;
		readyState?: number | undefined;
		elapsedMs?: number | undefined;
	};
	export function initClient<Resources extends AnyResources>({
		url,
		createWebSocket,
		reportInternalError,
		webSocketEvents,
	}: {
		url: string;
		createWebSocket?: (url: string) => WebSocket;
		reportInternalError: (
			message: string,
			data: Record<string, unknown>,
		) => void;
		webSocketEvents: ClientWebSocketEvents_1;
	}): {
		client: Client<Resources>;
		clientMethods: ClientMethods;
	};
	type ClientWebSocketEvents_1 = ClientWebSocketEvents;
	export function initServer<Resources extends AnyResources>(
		router: Router<Resources>,
		resources: Resources,
		options?:
			| {
					serverLogger?: ServerLogger;
			  }
			| undefined,
	): {
		addConnection: (ws: WS, remoteAddress?: string | undefined) => number;
	};
	type WS = WS_1;
	type Params = Record<string, string | number> | null | undefined;
	type Request<Resources extends AnyResources> =
		| GetRequest<Resources>
		| SetRequest<Resources>
		| SubscribeRequest<Resources>
		| UnsubscribeRequest<Resources>;
	export type Response<Resources extends AnyResources> =
		| GetResponse<Resources>
		| SetSuccess<Resources>
		| SubscribeAccept<Resources>
		| UnsubscribeAccept<Resources>;
	type RequestReject<Resources extends AnyResources> = {
		error: string;
		request: Request<Resources>;
		type: 'RequestReject';
	};
	type Reject = {
		error: string;
		type: 'Reject';
	};
	type GetRequest<Resources extends AnyResources> = {
		id: number;
		params: Params;
		resource: keyof Resources & string;
		request?: Resources[keyof Resources]['request'] extends StandardSchemaV1
			? StandardSchemaV1.InferInput<Resources[keyof Resources]['request']>
			: undefined;
		type: 'GetRequest';
	};
	type GetResponse<Resources extends AnyResources> = {
		data: StandardSchemaV1.InferOutput<
			Resources[keyof Resources]['response']
		>;
		id: number;
		resource: keyof Resources & string;
		type: 'GetResponse';
	};
	type SetRequest<Resources extends AnyResources> = {
		id: number;
		params: Params;
		resource: keyof Resources & string;
		request: Resources[keyof Resources]['request'] extends StandardSchemaV1
			? StandardSchemaV1.InferInput<Resources[keyof Resources]['request']>
			: undefined;
		type: 'SetRequest';
	};
	type SetSuccess<Resources extends AnyResources> = {
		id: number;
		resource: keyof Resources & string;
		data: StandardSchemaV1.InferOutput<
			Resources[keyof Resources]['response']
		>;
		type: 'SetSuccess';
	};
	type SubscribeRequest<Resources extends AnyResources> = {
		id: number;
		params: Params;
		resource: keyof Resources & string;
		request?: Resources[keyof Resources]['request'] extends StandardSchemaV1
			? StandardSchemaV1.InferInput<Resources[keyof Resources]['request']>
			: undefined;
		type: 'SubscribeRequest';
	};
	type SubscribeAccept<Resources extends AnyResources> = {
		id: number;
		resource: keyof Resources & string;
		type: 'SubscribeAccept';
	};
	export type SubscribeEvent<Resources extends AnyResources> = {
		id: number;
		params?: Params;
		resource: keyof Resources & string;
		data: StandardSchemaV1.InferOutput<
			Resources[keyof Resources]['response']
		>;
		type: 'SubscribeEvent';
	};
	type UnsubscribeRequest<Resources extends AnyResources> = {
		id: number;
		subscriptionId: number;
		params: Params;
		resource: keyof Resources & string;
		type: 'UnsubscribeRequest';
	};
	type UnsubscribeAccept<Resources extends AnyResources> = {
		id: number;
		resource: keyof Resources & string;
		type: 'UnsubscribeAccept';
	};
	type HandlerResponse<
		Resources extends AnyResources,
		Resource extends keyof AnyResources,
	> =
		| StandardSchemaV1.InferInput<Resources[Resource]['response']>
		| Promise<StandardSchemaV1.InferInput<Resources[Resource]['response']>>;
	type SubscribeHandlerResponse<
		Resources extends AnyResources,
		Resource extends keyof AnyResources,
	> =
		| Subscribable<
				StandardSchemaV1.InferInput<Resources[Resource]['response']>
		  >
		| Promise<
				Subscribable<
					StandardSchemaV1.InferInput<Resources[Resource]['response']>
				>
		  >;
	type GetHandler_1<
		Resources extends AnyResources,
		Resource extends keyof AnyResources,
		Request extends AnyResource['request'],
	> = (args: {
		clientId: number;
		resource: Resource;
		request: Request extends StandardSchemaV1
			? StandardSchemaV1.InferOutput<Request>
			: undefined;
	}) => HandlerResponse<Resources, Resource>;
	type GetHandlerWithParams<
		Resources extends AnyResources,
		Resource extends keyof AnyResources,
		Request extends AnyResource['request'],
	> = (args: {
		clientId: number;
		params: ResourceParams<Resource>;
		resourceWithParams: string;
		resource: Resource;
		request: Request extends StandardSchemaV1
			? StandardSchemaV1.InferOutput<Request>
			: undefined;
	}) => HandlerResponse<Resources, Resource>;
	type PickGetHandler<
		Resources extends AnyResources,
		Resource extends keyof AnyResources,
		Request extends AnyResource['request'],
	> = ResourceParams<Resource> extends null
		? GetHandler_1<Resources, Resource, Request>
		: GetHandlerWithParams<Resources, Resource, Request>;
	type SetHandler_1<
		Resources extends AnyResources,
		Resource extends keyof AnyResources,
		Request extends AnyResource['request'],
	> = (args: {
		clientId: number;
		resource: Resource;
		request: Request extends StandardSchemaV1
			? StandardSchemaV1.InferOutput<Request>
			: undefined;
	}) => HandlerResponse<Resources, Resource>;
	type SetHandlerWithParams<
		Resources extends AnyResources,
		Resource extends keyof AnyResources,
		Request extends AnyResource['request'],
	> = (args: {
		clientId: number;
		params: ResourceParams<Resource>;
		resourceWithParams: string;
		resource: Resource;
		request: Request extends StandardSchemaV1
			? StandardSchemaV1.InferOutput<Request>
			: undefined;
	}) => HandlerResponse<Resources, Resource>;
	type PickSetHandler<
		Resources extends AnyResources,
		Resource extends keyof AnyResources,
		Request extends AnyResource['request'],
	> = ResourceParams<Resource> extends null
		? SetHandler_1<Resources, Resource, Request>
		: SetHandlerWithParams<Resources, Resource, Request>;
	type SubscribeHandler_1<
		Resources extends AnyResources,
		Resource extends keyof AnyResources,
		Request extends AnyResource['request'],
	> = (args: {
		clientId: number;
		resource: Resource;
		request: Request extends StandardSchemaV1
			? StandardSchemaV1.InferOutput<Request>
			: undefined;
	}) => SubscribeHandlerResponse<Resources, Resource>;
	type SubscribeHandlerWithParams<
		Resources extends AnyResources,
		Resource extends keyof AnyResources,
		Request extends AnyResource['request'],
	> = (args: {
		clientId: number;
		params: ResourceParams<Resource>;
		resourceWithParams: string;
		resource: Resource;
		request: Request extends StandardSchemaV1
			? StandardSchemaV1.InferOutput<Request>
			: undefined;
	}) => SubscribeHandlerResponse<Resources, Resource>;
	type PickSubscribeHandler<
		Resources extends AnyResources,
		Resource extends keyof AnyResources,
		Request extends AnyResource['request'],
	> = ResourceParams<Resource> extends null
		? SubscribeHandler_1<Resources, Resource, Request>
		: SubscribeHandlerWithParams<Resources, Resource, Request>;
	export type Router<Resources extends AnyResources> = {
		[R in keyof Resources & string]: Resources[R] extends {
			type: 'get';
			request?: infer Request extends StandardSchemaV1;
		}
			? {
					get: PickGetHandler<Resources, R, Request>;
			  }
			: Resources[R] extends {
					type: 'set';
					request: infer Request extends StandardSchemaV1;
			  }
			? {
					set: PickSetHandler<Resources, R, Request>;
			  }
			: Resources[R] extends {
					type: 'subscribe';
					request?: infer Request extends StandardSchemaV1;
			  }
			? {
					subscribe: PickSubscribeHandler<Resources, R, Request>;
			  }
			: Resources[R] extends {
					type: 'get|set';
					request: infer Request extends StandardSchemaV1;
			  }
			? {
					get: PickGetHandler<Resources, R, Request>;
					set: PickSetHandler<Resources, R, Request>;
			  }
			: Resources[R] extends {
					type: 'get|subscribe';
					request?: infer Request extends StandardSchemaV1;
			  }
			? {
					get: PickGetHandler<Resources, R, Request>;
					subscribe: PickSubscribeHandler<Resources, R, Request>;
			  }
			: Resources[R] extends {
					type: 'set|subscribe';
					request: infer Request extends StandardSchemaV1;
			  }
			? {
					set: PickSetHandler<Resources, R, Request>;
					subscribe: PickSubscribeHandler<Resources, R, Request>;
			  }
			: Resources[R] extends {
					type: 'get|set|subscribe';
					request: infer Request extends StandardSchemaV1;
			  }
			? {
					get: PickGetHandler<Resources, R, Request>;
					set: PickSetHandler<Resources, R, Request>;
					subscribe: PickSubscribeHandler<Resources, R, Request>;
			  }
			: never;
	};
	export interface ServerLogger {
		receivedRequest?: (
			request: Request<any>,
			clientId: number,
			remoteAddress: string | undefined,
		) => void;
		sentResponse?: (
			request: Request<any>,
			response: Response<any>,
			clientId: number,
			remoteAddress: string | undefined,
		) => void;
		sentEvent?: (
			request: Request<any>,
			event: SubscribeEvent<any>,
			clientId: number,
			remoteAddress: string | undefined,
		) => void;
		sentReject?: (
			request: Request<any> | undefined,
			reject: RequestReject<AnyResources> | Reject,
			clientId: number,
			remoteAddress: string | undefined,
			error?: unknown,
		) => void;
		error?: (
			message: string,
			clientId: number,
			remoteAddress: string | undefined,
			data: Record<string, unknown>,
		) => void;
		/**
		 * Smolrpc only supports synchronous schema validation and fails the validation if a promise is returned.
		 * But if the schema validation returns a promise, we need to log the result of the promise for debugging purposes.
		 */
		asyncValidationResult?: (
			message: string,
			schema: StandardSchemaV1,
			value: any,
			promise_result:
				| {
						then_result: any;
						type: 'then';
				  }
				| {
						catch_error: unknown;
						type: 'catch';
				  },
		) => void;
	}
	export function json_stringify(
		obj: any,
		space?: Parameters<typeof JSON.stringify>[2],
	): string;
	export function json_parse(s: string): any;
	/**
	 * Given a URL-like string with :params (eg. `/thing/:thingId`), returns a type
	 * with the params as keys (eg. `{ thingId: string }`).
	 */
	export type ResourceParams<T> =
		T extends `${infer _Start}:${infer Param}/${infer Rest}`
			? {
					[k in Param | keyof ResourceParams<Rest>]: string | number;
			  }
			: T extends `${infer _Start}:${infer Param}`
			? {
					[k in Param]: string | number;
			  }
			: null | undefined;
	type AnyResource = {
		request?: StandardSchemaV1;
		response: StandardSchemaV1;
		cache?: boolean;
		type:
			| 'get'
			| 'set'
			| 'subscribe'
			| 'get|set'
			| 'get|subscribe'
			| 'set|subscribe'
			| 'get|set|subscribe';
	};
	export type AnyResources = {
		[key: string]: AnyResource;
	};
	interface Observer<T> {
		next: (value: T) => void;
		error: (err: any) => void;
		complete: () => void;
	}
	interface Unsubscribable {
		unsubscribe(): void;
	}
	export interface Subscribable<T> {
		subscribe(observer: Partial<Observer<T>>): Unsubscribable;
	}
	export type Result<
		Resources extends AnyResources,
		Resource extends keyof Resources,
	> = StandardSchemaV1.InferOutput<Resources[Resource]['response']>;
	export function dummyClient<
		Resources extends AnyResources,
	>(): Client<Resources>;
	type Data = string | ArrayBufferLike | ArrayBufferView | ArrayBufferView[];
	interface WSErrorEvent {
		error: any;
		message: string;
		type: string;
		target: WS_1;
	}
	interface WSCloseEvent {
		wasClean: boolean;
		code: number;
		reason: string;
		type: string;
		target: WS_1;
	}
	interface WSMessageEvent {
		data: Data;
		type: string;
		target: WS_1;
	}
	interface WSEventListenerOptions {
		once?: boolean | undefined;
	}
	type WS_1 = {
		addEventListener(
			method: 'message',
			cb: (event: WSMessageEvent) => void,
			options?: WSEventListenerOptions,
		): void;
		addEventListener(
			method: 'close',
			cb: (event: WSCloseEvent) => void,
			options?: WSEventListenerOptions,
		): void;
		addEventListener(
			method: 'error',
			cb: (event: WSErrorEvent) => void,
			options?: WSEventListenerOptions,
		): void;
		send: (data: Data) => void;
	};

	export {};
}

//# sourceMappingURL=index.d.ts.map
