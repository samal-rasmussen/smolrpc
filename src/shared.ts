export type Types = 'get' | 'set' | 'subscribe';
export type MessageTypes = Types | 'unsubscribe';

/**
 * Given a URL-like string with :params (eg. `/thing/:thingId`), returns a type
 * with the params as keys (eg. `{ thingId: string }`).
 */
export type ResourceParams<T> =
	T extends `${infer _Start}:${infer Param}/${infer Rest}` // eslint-disable-line @typescript-eslint/no-unused-vars
		? { [k in Param | keyof ResourceParams<Rest>]: string }
		: T extends `${infer _Start}:${infer Param}` // eslint-disable-line @typescript-eslint/no-unused-vars
		? { [k in Param]: string }
		: unknown;

export type AnyRouter = {
	get: {
		[key: string]: (args: { resource: string; request: any }) => any;
	};
	set: {
		[key: string]: (args: { resource: string; request: any }) => any;
	};
	subscribe: {
		[key: string]: (args: { resource: string; request: any }) => any;
	};
};

export type GetResources<R extends AnyRouter> = R['get'];
export type SetResources<R extends AnyRouter> = R['set'];
export type SubscribeResources<R extends AnyRouter> = R['subscribe'];

export type Client<R extends AnyRouter> = {
	get: {
		[Resource in keyof GetResources<R>]: (args: {
			request: Parameters<GetResources<R>[Resource]>[0]['request'];
			params: ResourceParams<Resource>;
		}) => Promise<ReturnType<GetResources<R>[Resource]>>;
	};
	set: {
		[Resource in keyof SetResources<R>]: (args: {
			request: Parameters<SetResources<R>[Resource]>[0]['request'];
			params: ResourceParams<Resource>;
		}) => Promise<ReturnType<SetResources<R>[Resource]>>;
	};
	subscribe: {
		[Resource in keyof SubscribeResources<R>]: (args: {
			request: Parameters<SubscribeResources<R>[Resource]>[0]['request'];
			params: ResourceParams<Resource>;
		}) => Subscribable<ReturnType<SubscribeResources<R>[Resource]>>;
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
