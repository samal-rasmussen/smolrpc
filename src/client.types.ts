import type { z } from 'zod';
import type {
	AnyResources,
	AnySettableResource,
	ResourceParams,
	Subscribable,
} from './types';

type GetHandler<
	Resources extends AnyResources,
	Resource extends keyof AnyResources,
> = ResourceParams<Resource> extends null | undefined
	? () => Promise<z.infer<Resources[Resource]['response']>>
	: (args: {
			params: ResourceParams<Resource>;
	  }) => Promise<z.infer<Resources[Resource]['response']>>;

type SetHandler<
	Resource extends keyof AnyResources,
	Request extends AnySettableResource['request'],
> = ResourceParams<Resource> extends null | undefined
	? (args: { request: z.infer<Request> }) => Promise<void>
	: (args: {
			request: z.infer<Request>;
			params: ResourceParams<Resource>;
	  }) => Promise<void>;

type SubscribeHandler<
	Resources extends AnyResources,
	Resource extends keyof AnyResources,
> = ResourceParams<Resource> extends null | undefined
	? () => Subscribable<z.infer<Resources[Resource]['response']>>
	: (args: {
			params: ResourceParams<Resource>;
	  }) => Subscribable<z.infer<Resources[Resource]['response']>>;

export type Client<Resources extends AnyResources> = {
	[R in keyof Resources]: Resources[R] extends {
		type: 'get';
	}
		? { get: GetHandler<Resources, R> }
		: Resources[R] extends {
				type: 'set';
				request: infer Request extends z.ZodTypeAny;
		  }
		? { set: SetHandler<R, Request> }
		: Resources[R] extends {
				type: 'subscribe';
		  }
		? { subscribe: SubscribeHandler<Resources, R> }
		: Resources[R] extends {
				type: 'get|set';
				request: infer Request extends z.ZodTypeAny;
		  }
		? { get: GetHandler<Resources, R>; set: SetHandler<R, Request> }
		: Resources[R] extends {
				type: 'get|subscribe';
		  }
		? {
				get: GetHandler<Resources, R>;
				subscribe: SubscribeHandler<Resources, R>;
		  }
		: Resources[R] extends {
				type: 'set|subscribe';
				request: infer Request extends z.ZodTypeAny;
		  }
		? {
				set: SetHandler<R, Request>;
				subscribe: SubscribeHandler<Resources, R>;
		  }
		: Resources[R] extends {
				type: 'get|set|subscribe';
				request: infer Request extends z.ZodTypeAny;
		  }
		? {
				get: GetHandler<Resources, R>;
				set: SetHandler<R, Request>;
				subscribe: SubscribeHandler<Resources, R>;
		  }
		: never;
};

export declare function initClient<Resources extends AnyResources>(
	websocket: WebSocket,
): Promise<Client<Resources>>;
