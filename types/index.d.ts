declare module 'smolrpc' {
	import type { z } from 'zod';
	type GetHandler<Resources extends AnyResources, Resource extends keyof AnyResources> = ResourceParams<Resource> extends null | undefined ? () => Promise<z.infer<Resources[Resource]['response']>> : (args: {
		params: ResourceParams<Resource>;
	}) => Promise<z.infer<Resources[Resource]['response']>>;
	type SetHandler<Resources extends AnyResources, Resource extends keyof AnyResources, Request extends AnySettableResource['request']> = ResourceParams<Resource> extends null | undefined ? (args: {
		request: z.infer<Request>;
	}) => Promise<z.infer<Resources[Resource]['response']>> : (args: {
		request: z.infer<Request>;
		params: ResourceParams<Resource>;
	}) => Promise<z.infer<Resources[Resource]['response']>>;
	type SubscribeHandler<Resources extends AnyResources, Resource extends keyof AnyResources> = ResourceParams<Resource> extends null | undefined ? () => Subscribable<z.infer<Resources[Resource]['response']>> : (args: {
		params: ResourceParams<Resource>;
	}) => Subscribable<z.infer<Resources[Resource]['response']>>;
	export type Client<Resources extends AnyResources> = {
		[R in keyof Resources & string]: Resources[R] extends {
			type: 'get';
		} ? {
			get: GetHandler<Resources, R>;
		} : Resources[R] extends {
			type: 'set';
			request: infer Request extends z.ZodTypeAny;
		} ? {
			set: SetHandler<Resources, R, Request>;
		} : Resources[R] extends {
			type: 'subscribe';
		} ? {
			subscribe: SubscribeHandler<Resources, R>;
		} : Resources[R] extends {
			type: 'get|set';
			request: infer Request extends z.ZodTypeAny;
		} ? {
			get: GetHandler<Resources, R>;
			set: SetHandler<Resources, R, Request>;
		} : Resources[R] extends {
			type: 'get|subscribe';
		} ? {
			get: GetHandler<Resources, R>;
			subscribe: SubscribeHandler<Resources, R>;
		} : Resources[R] extends {
			type: 'set|subscribe';
			request: infer Request extends z.ZodTypeAny;
		} ? {
			set: SetHandler<Resources, R, Request>;
			subscribe: SubscribeHandler<Resources, R>;
		} : Resources[R] extends {
			type: 'get|set|subscribe';
			request: infer Request extends z.ZodTypeAny;
		} ? {
			get: GetHandler<Resources, R>;
			set: SetHandler<Resources, R, Request>;
			subscribe: SubscribeHandler<Resources, R>;
		} : never;
	};
	interface ClientMethods {
		close: () => void;
		open: () => void;
	}
	export function initClient<Resources extends AnyResources>({ url, createWebSocket, onopen, onmessage, onreconnect, onclose, onerror, }: {
		url: string;
		createWebSocket?: ((url: string) => WebSocket) | undefined;
		onopen?: ((e: Event) => void) | undefined;
		onmessage?: ((e: MessageEvent) => void) | undefined;
		onreconnect?: (() => void) | undefined;
		onclose?: ((e: CloseEvent) => void) | undefined;
		onerror?: ((e: Event) => void) | undefined;
	}): {
		client: Client<Resources>;
		clientMethods: ClientMethods;
	};
	/**
	 * Given a URL-like string with :params (eg. `/thing/:thingId`), returns a type
	 * with the params as keys (eg. `{ thingId: string }`).
	 */
	type ResourceParams<T> = T extends `${infer _Start}:${infer Param}/${infer Rest}` ? {
		[k in Param | keyof ResourceParams<Rest>]: string | number;
	} : T extends `${infer _Start}:${infer Param}` ? {
		[k in Param]: string | number;
	} : null | undefined;
	type AnyResource = {
		response: z.ZodTypeAny;
		type: 'get' | 'subscribe' | 'get|subscribe';
	};
	type AnySettableResource = {
		request: z.ZodTypeAny;
		response: z.ZodTypeAny;
		type: 'set' | 'get|set' | 'set|subscribe' | 'get|set|subscribe';
	};
	type AnyResources = {
		[key: string]: AnyResource | AnySettableResource;
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
	export type Result<Resources extends AnyResources, Resource extends keyof Resources> = z.infer<Resources[Resource]['response']>;
	export function initServer<Resources extends AnyResources>(router: Router<Resources>, resources: AnyResources, options?: {
		serverLogger?: ServerLogger | undefined;
	} | undefined): {
		addConnection: (ws: WS, remoteAddress?: string | undefined) => number;
	};
	type WS = WS_1;
	type GetHandler_1<Resources extends AnyResources, Resource extends keyof AnyResources> = (args: {
		clientId: number;
		resource: Resource;
	}) => Promise<z.infer<Resources[Resource]['response']>>;
	type GetHandlerWithParams<Resources extends AnyResources, Resource extends keyof AnyResources> = (args: {
		clientId: number;
		params: ResourceParams<Resource>;
		resourceWithParams: string;
		resource: Resource;
	}) => Promise<z.infer<Resources[Resource]['response']>>;
	type PickGetHandler<Resources extends AnyResources, Resource extends keyof AnyResources> = ResourceParams<Resource> extends null ? GetHandler_1<Resources, Resource> : GetHandlerWithParams<Resources, Resource>;
	type SetHandler_1<Resources extends AnyResources, Resource extends keyof AnyResources, Request extends AnySettableResource['request']> = (args: {
		clientId: number;
		resource: Resource;
		request: z.infer<Request>;
	}) => Promise<z.infer<Resources[Resource]['response']>>;
	type SetHandlerWithParams<Resources extends AnyResources, Resource extends keyof AnyResources, Request extends AnySettableResource['request']> = (args: {
		clientId: number;
		params: ResourceParams<Resource>;
		resourceWithParams: string;
		resource: Resource;
		request: z.infer<Request>;
	}) => Promise<z.infer<Resources[Resource]['response']>>;
	type PickSetHandler<Resources extends AnyResources, Resource extends keyof AnyResources, Request extends AnySettableResource['request']> = ResourceParams<Resource> extends null ? SetHandler_1<Resources, Resource, Request> : SetHandlerWithParams<Resources, Resource, Request>;
	type SubscribeHandler_1<Resources extends AnyResources, Resource extends keyof AnyResources> = (args: {
		clientId: number;
		resource: Resource;
	}) => Subscribable<z.infer<Resources[Resource]['response']>>;
	type SubscribeHandlerWithParams<Resources extends AnyResources, Resource extends keyof AnyResources> = (args: {
		clientId: number;
		params: ResourceParams<Resource>;
		resourceWithParams: string;
		resource: Resource;
	}) => Subscribable<z.infer<Resources[Resource]['response']>>;
	type PickSubscribeHandler<Resources extends AnyResources, Resource extends keyof AnyResources> = ResourceParams<Resource> extends null ? SubscribeHandler_1<Resources, Resource> : SubscribeHandlerWithParams<Resources, Resource>;
	export type Router<Resources extends AnyResources> = {
		[R in keyof Resources & string]: Resources[R] extends {
			type: 'get';
		} ? {
			get: PickGetHandler<Resources, R>;
		} : Resources[R] extends {
			type: 'set';
			request: infer Request extends z.ZodTypeAny;
		} ? {
			set: PickSetHandler<Resources, R, Request>;
		} : Resources[R] extends {
			type: 'subscribe';
		} ? {
			subscribe: PickSubscribeHandler<Resources, R>;
		} : Resources[R] extends {
			type: 'get|set';
			request: infer Request extends z.ZodTypeAny;
		} ? {
			get: PickGetHandler<Resources, R>;
			set: PickSetHandler<Resources, R, Request>;
		} : Resources[R] extends {
			type: 'get|subscribe';
		} ? {
			get: PickGetHandler<Resources, R>;
			subscribe: PickSubscribeHandler<Resources, R>;
		} : Resources[R] extends {
			type: 'set|subscribe';
			request: infer Request extends z.ZodTypeAny;
		} ? {
			set: PickSetHandler<Resources, R, Request>;
			subscribe: PickSubscribeHandler<Resources, R>;
		} : Resources[R] extends {
			type: 'get|set|subscribe';
			request: infer Request extends z.ZodTypeAny;
		} ? {
			get: PickGetHandler<Resources, R>;
			set: PickSetHandler<Resources, R, Request>;
			subscribe: PickSubscribeHandler<Resources, R>;
		} : never;
	};
	interface ServerLogger {
		receivedRequest: (request: Request<any>, clientId: number, remoteAddress: string | undefined) => void;
	}
	export function dummyClient<Resources extends AnyResources>(): Client<Resources>;
	type Params = Record<string, string> | null | undefined;
	type Request<Resources extends AnyResources> = GetRequest<Resources> | SetRequest<Resources> | SubscribeRequest<Resources> | UnsubscribeRequest<Resources>;
	type GetRequest<Resources extends AnyResources> = {
		id: number;
		type: 'GetRequest';
		resource: keyof Resources & string;
		params: Params;
	};
	type SetRequest<Resources extends AnyResources> = {
		data: any;
		id: number;
		params: Params;
		resource: keyof Resources & string;
		type: 'SetRequest';
	};
	type SubscribeRequest<Resources extends AnyResources> = {
		id: number;
		type: 'SubscribeRequest';
		resource: keyof Resources & string;
		params: Params;
	};
	type UnsubscribeRequest<Resources extends AnyResources> = {
		id: number;
		resource: keyof Resources & string;
		type: 'UnsubscribeRequest';
		params: Params;
	};
	/// <reference types="node" />
	type Data = string | ArrayBufferLike | ArrayBufferView | Buffer | Buffer[];
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
		addEventListener(method: 'message', cb: (event: WSMessageEvent) => void, options?: WSEventListenerOptions): void;
		addEventListener(method: 'close', cb: (event: WSCloseEvent) => void, options?: WSEventListenerOptions): void;
		addEventListener(method: 'error', cb: (event: WSErrorEvent) => void, options?: WSEventListenerOptions): void;
		send: (data: Data) => void;
	};
}

//# sourceMappingURL=index.d.ts.map