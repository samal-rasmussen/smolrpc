import { z } from 'zod';
import { Resources } from '../shared/resources';
import { ResourceParams, Subscribable } from '../shared/types';

type Handlers<Resource extends keyof Resources> = {
	get: (args: {
		params?: ResourceParams<Resource>;
	}) => Promise<z.infer<Resources[Resource]['response']>>;
	set: (args: {
		request: z.infer<Resources[Resource]['request']>;
		params?: ResourceParams<Resource>;
	}) => Promise<void>;
	subscribe: (args: {
		params?: ResourceParams<Resource>;
	}) => Subscribable<z.infer<Resources[Resource]['response']>>;
};

export type Client = {
	[Resource in keyof Resources]: Resources[Resource]['type'] extends 'get'
		? Pick<Handlers<Resource>, 'get'>
		: Resources[Resource]['type'] extends 'set'
		? Pick<Handlers<Resource>, 'set'>
		: Resources[Resource]['type'] extends 'subscribe'
		? Pick<Handlers<Resource>, 'subscribe'>
		: Resources[Resource]['type'] extends 'get|set'
		? Pick<Handlers<Resource>, 'get' | 'set'>
		: Resources[Resource]['type'] extends 'get|subscribe'
		? Pick<Handlers<Resource>, 'get' | 'subscribe'>
		: Resources[Resource]['type'] extends 'set|subscribe'
		? Pick<Handlers<Resource>, 'set' | 'subscribe'>
		: Resources[Resource]['type'] extends 'get|set|subscribe'
		? Pick<Handlers<Resource>, 'get' | 'set' | 'subscribe'>
		: never;
};
