export type Types = 'get' | 'set' | 'subscribe';
export type MessageTypes = Types | 'unsubscribe';

/**
 * Given a URL-like string with :params (eg. `/thing/:thingId`), returns a type
 * with the params as keys (eg. `{ thingId: string }`).
 */
export type RouteParams<T> =
	T extends `${infer _Start}:${infer Param}/${infer Rest}` // eslint-disable-line @typescript-eslint/no-unused-vars
		? { [k in Param | keyof RouteParams<Rest>]: string }
		: T extends `${infer _Start}:${infer Param}` // eslint-disable-line @typescript-eslint/no-unused-vars
		? { [k in Param]: string }
		: unknown;

export type AnyResources = {
	get: {
		[key: string]: {
			request?: any;
			response?: any;
		};
	};
	set: {
		[key: string]: {
			request?: any;
			response?: any;
		};
	};
	subscribe: {
		[key: string]: {
			request?: any;
			response?: any;
		};
	};
};

export const resources = {
	get: {
		resourceA: {
			request: { aId: '123' },
			response: { value: '321' },
		},
		'/resourceB': {
			request: { bId: '123' },
			response: { value: '321' },
		},
	},
	set: {
		'/setA': {
			request: { bId: '123' },
			response: { value: '321' },
		},
	},
	subscribe: {
		'/subscribeA': {
			request: { bId: '123' },
			response: { value: '321' },
		},
	},
} as const satisfies AnyResources;

export type Resources = typeof resources;

type ResourcesOfType<Type extends Types, R extends AnyResources> = R[Type];

export type GetResources<R extends AnyResources> = ResourcesOfType<'get', R>;
export type SetResources<R extends AnyResources> = ResourcesOfType<'set', R>;
export type SubscribeResources<R extends AnyResources> = ResourcesOfType<
	'subscribe',
	R
>;

export type ServerHandlers = {
	get: {
		[R in keyof GetResources<Resources>]: (
			request: GetResources<Resources>[R]['request'],
		) => GetResources<Resources>[R]['response'];
	};
	set: {
		[R in keyof SetResources<Resources>]: (
			request: SetResources<Resources>[R]['request'],
		) => SetResources<Resources>[R]['response'];
	};
	subscribe: {
		[R in keyof SubscribeResources<Resources>]: (
			request: SubscribeResources<Resources>[R]['request'],
		) => SubscribeResources<Resources>[R]['response'];
	};
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
