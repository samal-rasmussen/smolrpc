import { z } from 'zod';
import type {
	AnyResources,
	AnySettableResource,
	ResourceParams,
	Subscribable,
} from './types';

export type GetHandler<
	Resources extends AnyResources,
	Resource extends keyof AnyResources,
> = ResourceParams<Resource> extends null
	? (args: {
			resource: Resource;
	  }) => Promise<z.infer<Resources[Resource]['response']>>
	: (args: {
			resource: Resource;
			params: ResourceParams<Resource>;
	  }) => Promise<z.infer<Resources[Resource]['response']>>;

export type SetHandler<
	Resource extends keyof AnyResources,
	Request extends AnySettableResource['request'],
> = ResourceParams<Resource> extends null
	? (args: { resource: Resource; request: z.infer<Request> }) => Promise<void>
	: (args: {
			resource: Resource;
			request: z.infer<Request>;
			params: ResourceParams<Resource>;
	  }) => Promise<void>;

export type SubscribeHandler<
	Resources extends AnyResources,
	Resource extends keyof AnyResources,
> = ResourceParams<Resource> extends null
	? (args: {
			resource: Resource;
	  }) => Subscribable<z.infer<Resources[Resource]['response']>>
	: (args: {
			resource: Resource;
			params: ResourceParams<Resource>;
	  }) => Subscribable<z.infer<Resources[Resource]['response']>>;

export type Router<Resources extends AnyResources> = {
	[R in keyof Resources]: Resources[R] extends {
		type: 'get';
	}
		? { get: GetHandler<Resources, R> }
		: Resources[R] extends {
				type: 'set';
				request: infer Request extends z.AnyZodObject;
		  }
		? { set: SetHandler<R, Request> }
		: Resources[R] extends {
				type: 'subscribe';
		  }
		? { subscribe: SubscribeHandler<Resources, R> }
		: Resources[R] extends {
				type: 'get|set';
				request: infer Request extends z.AnyZodObject;
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
				request: infer Request extends z.AnyZodObject;
		  }
		? {
				set: SetHandler<R, Request>;
				subscribe: SubscribeHandler<Resources, R>;
		  }
		: Resources[R] extends {
				type: 'get|set|subscribe';
				request: infer Request extends z.AnyZodObject;
		  }
		? {
				get: GetHandler<Resources, R>;
				set: SetHandler<R, Request>;
				subscribe: SubscribeHandler<Resources, R>;
		  }
		: never;
};
