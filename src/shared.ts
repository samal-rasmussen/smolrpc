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

export type AnyRouter = {
	get: {
		[key: string]: (request: any) => any;
	};
	set: {
		[key: string]: (request: any) => any;
	};
	subscribe: {
		[key: string]: (request: any) => any;
	};
};

export type GetResources<R extends AnyRouter> = R['get'];
export type SetResources<R extends AnyRouter> = R['set'];
export type SubscribeResources<R extends AnyRouter> = R['subscribe'];

export type Client<R extends AnyRouter> = {
	get: {
		[Resource in keyof GetResources<R>]: (
			request: Parameters<GetResources<R>[Resource]>[0],
		) => Promise<ReturnType<GetResources<R>[Resource]>>;
	};
	set: {
		[Resource in keyof SetResources<R>]: (
			request: Parameters<SetResources<R>[Resource]>[0],
		) => Promise<ReturnType<SetResources<R>[Resource]>>;
	};
	subscribe: {
		[Resource in keyof SubscribeResources<R>]: (
			request: Parameters<SubscribeResources<R>[Resource]>[0],
		) => Subscribable<ReturnType<SubscribeResources<R>[Resource]>>;
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
