declare module 'smolrpc' {
	import type { z } from 'zod';
	type GetHandler<
		Resources extends AnyResources,
		Resource extends keyof AnyResources,
	> = ResourceParams<Resource> extends null | undefined
		? () => Promise<z.infer<Resources[Resource]['response']>>
		: (args: {
				params: ResourceParams<Resource>;
		  }) => Promise<z.infer<Resources[Resource]['response']>>;
	type GetHandlerWithRequest<
		Resources extends AnyResources,
		Resource extends keyof AnyResources,
		Request extends AnyResource['request'],
	> = ResourceParams<Resource> extends null | undefined
		? (args: {
				request: Request extends z.ZodTypeAny
					? z.infer<Request>
					: undefined;
		  }) => Promise<z.infer<Resources[Resource]['response']>>
		: (args: {
				request: Request extends z.ZodTypeAny
					? z.infer<Request>
					: undefined;
				params: ResourceParams<Resource>;
		  }) => Promise<z.infer<Resources[Resource]['response']>>;
	type SetHandler<
		Resources extends AnyResources,
		Resource extends keyof AnyResources,
		Request extends AnyResource['request'],
	> = ResourceParams<Resource> extends null | undefined
		? (args: {
				request: Request extends z.ZodTypeAny
					? z.infer<Request>
					: undefined;
		  }) => Promise<z.infer<Resources[Resource]['response']>>
		: (args: {
				request: Request extends z.ZodTypeAny
					? z.infer<Request>
					: undefined;
				params: ResourceParams<Resource>;
		  }) => Promise<z.infer<Resources[Resource]['response']>>;
	type SubscribeHandler<
		Resources extends AnyResources,
		Resource extends keyof AnyResources,
	> = ResourceParams<Resource> extends null | undefined
		? (args?: {
				cache?: boolean;
		  }) => Subscribable<z.infer<Resources[Resource]['response']>>
		: (args: {
				cache?: boolean;
				params: ResourceParams<Resource>;
		  }) => Subscribable<z.infer<Resources[Resource]['response']>>;
	type SubscribeHandlerWithRequest<
		Resources extends AnyResources,
		Resource extends keyof AnyResources,
		Request extends AnyResource['request'],
	> = ResourceParams<Resource> extends null | undefined
		? (args: {
				cache?: boolean;
				request: Request extends z.ZodTypeAny
					? z.infer<Request>
					: undefined;
		  }) => Subscribable<z.infer<Resources[Resource]['response']>>
		: (args: {
				cache?: boolean;
				request: Request extends z.ZodTypeAny
					? z.infer<Request>
					: undefined;
				params: ResourceParams<Resource>;
		  }) => Subscribable<z.infer<Resources[Resource]['response']>>;
	export type Client<Resources extends AnyResources> = {
		[R in keyof Resources & string]: Resources[R] extends {
			type: 'get';
		}
			? {
					get: GetHandler<Resources, R>;
			  }
			: Resources[R] extends {
					type: 'get';
					request: infer Request extends z.ZodTypeAny;
			  }
			? {
					get: GetHandlerWithRequest<Resources, R, Request>;
			  }
			: Resources[R] extends {
					type: 'set';
					request: infer Request extends z.ZodTypeAny;
			  }
			? {
					set: SetHandler<Resources, R, Request>;
			  }
			: Resources[R] extends {
					type: 'subscribe';
					cache?: boolean;
			  }
			? {
					subscribe: SubscribeHandler<Resources, R>;
			  }
			: Resources[R] extends {
					type: 'subscribe';
					request: infer Request extends z.ZodTypeAny;
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
					type: 'get|set';
					request: infer Request extends z.ZodTypeAny;
			  }
			? {
					get: GetHandlerWithRequest<Resources, R, Request>;
					set: SetHandler<Resources, R, Request>;
			  }
			: Resources[R] extends {
					type: 'get|subscribe';
					request: infer Request extends z.ZodTypeAny;
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
					request: infer Request extends z.ZodTypeAny;
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
					request: infer Request extends z.ZodTypeAny;
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
	interface ClientMethods {
		close: () => void;
		open: () => void;
	}
	export function initClient<Resources extends AnyResources>({
		url,
		createWebSocket,
		onopen,
		onmessage,
		onreconnect,
		onclose,
		onerror,
		onsend,
	}: {
		url: string;
		createWebSocket?: (url: string) => WebSocket;
		onopen?: (e: Event) => void;
		onmessage?: (e: MessageEvent) => void;
		onreconnect?: () => void;
		onclose?: (e: CloseEvent) => void;
		onerror?: (e: Event) => void;
		onsend?: (r: Request_1) => void;
	}): {
		client: Client<Resources>;
		clientMethods: ClientMethods;
	};
	type Request_1 = Request_1_2<any>;
	export function initServer<Resources extends AnyResources>(
		router: Router<Resources>,
		resources: AnyResources,
		options?:
			| {
					serverLogger?: ServerLogger;
			  }
			| undefined,
	): {
		addConnection: (ws: WS, remoteAddress?: string | undefined) => number;
	};
	type WS = WS_1;
	type HandlerResponse<
		Resources extends AnyResources,
		Resource extends keyof AnyResources,
	> =
		| z.infer<Resources[Resource]['response']>
		| Promise<z.infer<Resources[Resource]['response']>>;
	type SubscribeHandlerResponse<
		Resources extends AnyResources,
		Resource extends keyof AnyResources,
	> =
		| Subscribable<z.infer<Resources[Resource]['response']>>
		| Promise<Subscribable<z.infer<Resources[Resource]['response']>>>;
	type GetHandler_1<
		Resources extends AnyResources,
		Resource extends keyof AnyResources,
		Request_1_2 extends AnyResource['request'],
	> = (args: {
		clientId: number;
		resource: Resource;
		request: Request_1_2 extends z.ZodTypeAny
			? z.infer<Request_1_2>
			: undefined;
	}) => HandlerResponse<Resources, Resource>;
	type GetHandlerWithParams<
		Resources extends AnyResources,
		Resource extends keyof AnyResources,
		Request_1_2 extends AnyResource['request'],
	> = (args: {
		clientId: number;
		params: ResourceParams<Resource>;
		resourceWithParams: string;
		resource: Resource;
		request: Request_1_2 extends z.ZodTypeAny
			? z.infer<Request_1_2>
			: undefined;
	}) => HandlerResponse<Resources, Resource>;
	type PickGetHandler<
		Resources extends AnyResources,
		Resource extends keyof AnyResources,
		Request_1_2 extends AnyResource['request'],
	> = ResourceParams<Resource> extends null
		? GetHandler_1<Resources, Resource, Request_1_2>
		: GetHandlerWithParams<Resources, Resource, Request_1_2>;
	type SetHandler_1<
		Resources extends AnyResources,
		Resource extends keyof AnyResources,
		Request_1_2 extends AnyResource['request'],
	> = (args: {
		clientId: number;
		resource: Resource;
		request: Request_1_2 extends z.ZodTypeAny
			? z.infer<Request_1_2>
			: undefined;
	}) => HandlerResponse<Resources, Resource>;
	type SetHandlerWithParams<
		Resources extends AnyResources,
		Resource extends keyof AnyResources,
		Request_1_2 extends AnyResource['request'],
	> = (args: {
		clientId: number;
		params: ResourceParams<Resource>;
		resourceWithParams: string;
		resource: Resource;
		request: Request_1_2 extends z.ZodTypeAny
			? z.infer<Request_1_2>
			: undefined;
	}) => HandlerResponse<Resources, Resource>;
	type PickSetHandler<
		Resources extends AnyResources,
		Resource extends keyof AnyResources,
		Request_1_2 extends AnyResource['request'],
	> = ResourceParams<Resource> extends null
		? SetHandler_1<Resources, Resource, Request_1_2>
		: SetHandlerWithParams<Resources, Resource, Request_1_2>;
	type SubscribeHandler_1<
		Resources extends AnyResources,
		Resource extends keyof AnyResources,
		Request_1_2 extends AnyResource['request'],
	> = (args: {
		clientId: number;
		resource: Resource;
		request: Request_1_2 extends z.ZodTypeAny
			? z.infer<Request_1_2>
			: undefined;
	}) => SubscribeHandlerResponse<Resources, Resource>;
	type SubscribeHandlerWithParams<
		Resources extends AnyResources,
		Resource extends keyof AnyResources,
		Request_1_2 extends AnyResource['request'],
	> = (args: {
		clientId: number;
		params: ResourceParams<Resource>;
		resourceWithParams: string;
		resource: Resource;
		request: Request_1_2 extends z.ZodTypeAny
			? z.infer<Request_1_2>
			: undefined;
	}) => SubscribeHandlerResponse<Resources, Resource>;
	type PickSubscribeHandler<
		Resources extends AnyResources,
		Resource extends keyof AnyResources,
		Request_1_2 extends AnyResource['request'],
	> = ResourceParams<Resource> extends null
		? SubscribeHandler_1<Resources, Resource, Request_1_2>
		: SubscribeHandlerWithParams<Resources, Resource, Request_1_2>;
	export type Router<Resources extends AnyResources> = {
		[R in keyof Resources & string]: Resources[R] extends {
			type: 'get';
			request?: infer Request_1_2 extends z.ZodTypeAny;
		}
			? {
					get: PickGetHandler<Resources, R, Request_1_2>;
			  }
			: Resources[R] extends {
					type: 'set';
					request: infer Request_1_2 extends z.ZodTypeAny;
			  }
			? {
					set: PickSetHandler<Resources, R, Request_1_2>;
			  }
			: Resources[R] extends {
					type: 'subscribe';
					request?: infer Request_1_2 extends z.ZodTypeAny;
			  }
			? {
					subscribe: PickSubscribeHandler<Resources, R, Request_1_2>;
			  }
			: Resources[R] extends {
					type: 'get|set';
					request: infer Request_1_2 extends z.ZodTypeAny;
			  }
			? {
					get: PickGetHandler<Resources, R, Request_1_2>;
					set: PickSetHandler<Resources, R, Request_1_2>;
			  }
			: Resources[R] extends {
					type: 'get|subscribe';
					request?: infer Request_1_2 extends z.ZodTypeAny;
			  }
			? {
					get: PickGetHandler<Resources, R, Request_1_2>;
					subscribe: PickSubscribeHandler<Resources, R, Request_1_2>;
			  }
			: Resources[R] extends {
					type: 'set|subscribe';
					request: infer Request_1_2 extends z.ZodTypeAny;
			  }
			? {
					set: PickSetHandler<Resources, R, Request_1_2>;
					subscribe: PickSubscribeHandler<Resources, R, Request_1_2>;
			  }
			: Resources[R] extends {
					type: 'get|set|subscribe';
					request: infer Request_1_2 extends z.ZodTypeAny;
			  }
			? {
					get: PickGetHandler<Resources, R, Request_1_2>;
					set: PickSetHandler<Resources, R, Request_1_2>;
					subscribe: PickSubscribeHandler<Resources, R, Request_1_2>;
			  }
			: never;
	};
	interface ServerLogger {
		receivedRequest: (
			request: Request_1_2<any>,
			clientId: number,
			remoteAddress: string | undefined,
		) => void;
		sentResponse: (
			request: Request_1_2<any>,
			response: Response<any>,
			clientId: number,
			remoteAddress: string | undefined,
		) => void;
		sentEvent: (
			request: Request_1_2<any>,
			event: SubscribeEvent<any>,
			clientId: number,
			remoteAddress: string | undefined,
		) => void;
		sentReject: (
			request: Request_1_2<any> | undefined,
			reject: RequestReject<AnyResources> | Reject,
			clientId: number,
			remoteAddress: string | undefined,
			error?: unknown,
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
	type ResourceParams<T> =
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
		request?: z.ZodTypeAny;
		response: z.ZodTypeAny;
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
	type AnyResources = {
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
	> = z.infer<Resources[Resource]['response']>;
	export function dummyClient<
		Resources extends AnyResources,
	>(): Client<Resources>;
	type Params = Record<string, string> | null | undefined;
	type Request_1_2<Resources extends AnyResources> =
		| GetRequest<Resources>
		| SetRequest<Resources>
		| SubscribeRequest<Resources>
		| UnsubscribeRequest<Resources>;
	type Response<Resources extends AnyResources> =
		| GetResponse<Resources>
		| SetSuccess<Resources>
		| SubscribeAccept<Resources>
		| UnsubscribeAccept<Resources>;
	type RequestReject<Resources extends AnyResources> = {
		error: string;
		request: Request_1_2<Resources>;
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
		request?: Resources[keyof Resources]['request'] extends z.ZodTypeAny
			? z.infer<Resources[keyof Resources]['request']>
			: undefined;
		type: 'GetRequest';
	};
	type GetResponse<Resources extends AnyResources> = {
		data: z.infer<Resources[keyof Resources]['response']>;
		id: number;
		resource: keyof Resources & string;
		type: 'GetResponse';
	};
	type SetRequest<Resources extends AnyResources> = {
		id: number;
		params: Params;
		resource: keyof Resources & string;
		request: Resources[keyof Resources]['request'] extends z.ZodTypeAny
			? z.infer<Resources[keyof Resources]['request']>
			: undefined;
		type: 'SetRequest';
	};
	type SetSuccess<Resources extends AnyResources> = {
		id: number;
		resource: keyof Resources & string;
		data: z.infer<Resources[keyof Resources]['response']>;
		type: 'SetSuccess';
	};
	type SubscribeRequest<Resources extends AnyResources> = {
		id: number;
		params: Params;
		resource: keyof Resources & string;
		request?: Resources[keyof Resources]['request'] extends z.ZodTypeAny
			? z.infer<Resources[keyof Resources]['request']>
			: undefined;
		type: 'SubscribeRequest';
	};
	type SubscribeAccept<Resources extends AnyResources> = {
		id: number;
		resource: keyof Resources & string;
		type: 'SubscribeAccept';
	};
	type SubscribeEvent<Resources extends AnyResources> = {
		id: number;
		params?: Params;
		resource: keyof Resources & string;
		data: z.infer<Resources[keyof Resources]['response']>;
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
