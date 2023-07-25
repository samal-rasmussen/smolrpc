import type { z } from 'zod';
import type {
	AnyResources,
	AnySettableResource,
	ResourceParams,
	Subscribable,
} from './types';

export type GetHandler<
	Resources extends AnyResources,
	Resource extends keyof AnyResources,
> = (args: {
	resource: Resource;
}) => Promise<z.infer<Resources[Resource]['response']>>;

export type GetHandlerWithParams<
	Resources extends AnyResources,
	Resource extends keyof AnyResources,
> = (args: {
	params: ResourceParams<Resource>;
	qualifiedResource: string;
	resource: Resource;
}) => Promise<z.infer<Resources[Resource]['response']>>;

export type PickGetHandler<
	Resources extends AnyResources,
	Resource extends keyof AnyResources,
> = ResourceParams<Resource> extends null
	? GetHandler<Resources, Resource>
	: GetHandlerWithParams<Resources, Resource>;

export type SetHandler<
	Resource extends keyof AnyResources,
	Request extends AnySettableResource['request'],
> = (args: { resource: Resource; request: z.infer<Request> }) => Promise<void>;

export type SetHandlerWithParams<
	Resource extends keyof AnyResources,
	Request extends AnySettableResource['request'],
> = (args: {
	params: ResourceParams<Resource>;
	qualifiedResource: string;
	resource: Resource;
	request: z.infer<Request>;
}) => Promise<void>;

export type PickSetHandler<
	Resource extends keyof AnyResources,
	Request extends AnySettableResource['request'],
> = ResourceParams<Resource> extends null
	? SetHandler<Resource, Request>
	: SetHandlerWithParams<Resource, Request>;

export type SubscribeHandler<
	Resources extends AnyResources,
	Resource extends keyof AnyResources,
> = (args: {
	resource: Resource;
}) => Subscribable<z.infer<Resources[Resource]['response']>>;

export type SubscribeHandlerWithParams<
	Resources extends AnyResources,
	Resource extends keyof AnyResources,
> = (args: {
	params: ResourceParams<Resource>;
	qualifiedResource: string;
	resource: Resource;
}) => Subscribable<z.infer<Resources[Resource]['response']>>;

export type PickSubscribeHandler<
	Resources extends AnyResources,
	Resource extends keyof AnyResources,
> = ResourceParams<Resource> extends null
	? SubscribeHandler<Resources, Resource>
	: SubscribeHandlerWithParams<Resources, Resource>;

export type Router<Resources extends AnyResources> = {
	[R in keyof Resources]: Resources[R] extends {
		type: 'get';
	}
		? { get: PickGetHandler<Resources, R> }
		: Resources[R] extends {
				type: 'set';
				request: infer Request extends z.AnyZodObject;
		  }
		? { set: PickSetHandler<R, Request> }
		: Resources[R] extends {
				type: 'subscribe';
		  }
		? { subscribe: PickSubscribeHandler<Resources, R> }
		: Resources[R] extends {
				type: 'get|set';
				request: infer Request extends z.AnyZodObject;
		  }
		? { get: PickGetHandler<Resources, R>; set: PickSetHandler<R, Request> }
		: Resources[R] extends {
				type: 'get|subscribe';
		  }
		? {
				get: PickGetHandler<Resources, R>;
				subscribe: PickSubscribeHandler<Resources, R>;
		  }
		: Resources[R] extends {
				type: 'set|subscribe';
				request: infer Request extends z.AnyZodObject;
		  }
		? {
				set: PickSetHandler<R, Request>;
				subscribe: PickSubscribeHandler<Resources, R>;
		  }
		: Resources[R] extends {
				type: 'get|set|subscribe';
				request: infer Request extends z.AnyZodObject;
		  }
		? {
				get: PickGetHandler<Resources, R>;
				set: PickSetHandler<R, Request>;
				subscribe: PickSubscribeHandler<Resources, R>;
		  }
		: never;
};
