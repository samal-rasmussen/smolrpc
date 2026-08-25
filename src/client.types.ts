import type { StandardSchemaV1 } from '@standard-schema/spec';

import type { Request } from './message.types';
import type {
	AnyResource,
	AnyResources,
	ResourceParams,
	Subscribable,
} from './types';

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
		? { get: GetHandlerWithRequest<Resources, R, Request> }
		: Resources[R] extends {
				type: 'get';
		  }
		? { get: GetHandler<Resources, R> }
		: Resources[R] extends {
				type: 'set';
				request: infer Request extends StandardSchemaV1;
		  }
		? { set: SetHandler<Resources, R, Request> }
		: Resources[R] extends {
				type: 'subscribe';
				request: infer Request extends StandardSchemaV1;
				cache?: boolean;
		  }
		? { subscribe: SubscribeHandlerWithRequest<Resources, R, Request> }
		: Resources[R] extends {
				type: 'subscribe';
				cache?: boolean;
		  }
		? { subscribe: SubscribeHandler<Resources, R> }
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
				subscribe: SubscribeHandlerWithRequest<Resources, R, Request>;
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
				subscribe: SubscribeHandlerWithRequest<Resources, R, Request>;
		  }
		: Resources[R] extends {
				type: 'get|set|subscribe';
				request: infer Request extends StandardSchemaV1;
				cache?: boolean;
		  }
		? {
				get: GetHandlerWithRequest<Resources, R, Request>;
				set: SetHandler<Resources, R, Request>;
				subscribe: SubscribeHandlerWithRequest<Resources, R, Request>;
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
