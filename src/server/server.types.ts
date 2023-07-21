import { z } from 'zod';
import type {
	AnyResources,
	AnySettableResources,
	ResourceParams,
	Subscribable,
} from '../shared/types';

export type Handlers<Resource extends keyof AnyResources> = {
	get: (args: {
		resource: Resource;
		params?: ResourceParams<Resource>;
	}) => Promise<z.infer<AnyResources[Resource]['response']>>;
	set: (args: {
		resource: Resource;
		request: z.infer<AnySettableResources[Resource]['request']>;
		params?: ResourceParams<Resource>;
	}) => Promise<void>;
	subscribe: (args: {
		resource: Resource;
		params?: ResourceParams<Resource>;
	}) => Subscribable<z.infer<AnyResources[Resource]['response']>>;
};

export type Router<Resources extends AnyResources> = {
	[R in keyof Resources]: Resources[R]['type'] extends 'get'
		? Pick<Handlers<R>, 'get'>
		: Resources[R]['type'] extends 'set'
		? Pick<Handlers<R>, 'set'>
		: Resources[R]['type'] extends 'subscribe'
		? Pick<Handlers<R>, 'subscribe'>
		: Resources[R]['type'] extends 'get|set'
		? Pick<Handlers<R>, 'get' | 'set'>
		: Resources[R]['type'] extends 'get|subscribe'
		? Pick<Handlers<R>, 'get' | 'subscribe'>
		: Resources[R]['type'] extends 'set|subscribe'
		? Pick<Handlers<R>, 'set' | 'subscribe'>
		: Resources[R]['type'] extends 'get|set|subscribe'
		? Pick<Handlers<R>, 'get' | 'set' | 'subscribe'>
		: never;
};
