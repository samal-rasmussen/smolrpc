import type { z } from 'zod';

export type Types = 'get' | 'set' | 'subscribe';
export type MessageTypes = Types | 'unsubscribe';

/**
 * Given a URL-like string with :params (eg. `/thing/:thingId`), returns a type
 * with the params as keys (eg. `{ thingId: string }`).
 */
export type ResourceParams<T> =
	T extends `${infer _Start}:${infer Param}/${infer Rest}` // eslint-disable-line @typescript-eslint/no-unused-vars
		? { [k in Param | keyof ResourceParams<Rest>]: string | number }
		: T extends `${infer _Start}:${infer Param}` // eslint-disable-line @typescript-eslint/no-unused-vars
		? { [k in Param]: string | number }
		: null | undefined;

export type AnyResource = {
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
export type AnyResources = {
	[key: string]: AnyResource;
};

export interface Observer<T> {
	next: (value: T) => void;
	error: (err: any) => void;
	complete: () => void;
}

export interface Unsubscribable {
	unsubscribe(): void;
}

export interface Subscribable<T> {
	subscribe(observer: Partial<Observer<T>>): Unsubscribable;
}

export type Result<
	Resources extends AnyResources,
	Resource extends keyof Resources,
> = z.infer<Resources[Resource]['response']>;
