import type { StandardSchemaV1 } from '@standard-schema/spec';

import {
	Reject,
	Request,
	RequestReject,
	Response,
	SubscribeEvent,
} from './message.types.ts';
import type {
	AnyResource,
	AnyResources,
	ResourceParams,
	Subscribable,
} from './types.ts';

export type HandlerResponse<
	Resources extends AnyResources,
	Resource extends keyof AnyResources,
> =
	| StandardSchemaV1.InferInput<Resources[Resource]['response']>
	| Promise<StandardSchemaV1.InferInput<Resources[Resource]['response']>>;

export type SubscribeHandlerResponse<
	Resources extends AnyResources,
	Resource extends keyof AnyResources,
> =
	| Subscribable<StandardSchemaV1.InferInput<Resources[Resource]['response']>>
	| Promise<
			Subscribable<
				StandardSchemaV1.InferInput<Resources[Resource]['response']>
			>
	  >;

export type GetHandler<
	Resources extends AnyResources,
	Resource extends keyof AnyResources,
	Request extends AnyResource['request'],
> = (args: {
	clientId: number;
	resource: Resource;
	request: Request extends StandardSchemaV1
		? StandardSchemaV1.InferInput<Request>
		: undefined;
}) => HandlerResponse<Resources, Resource>;

export type GetHandlerWithParams<
	Resources extends AnyResources,
	Resource extends keyof AnyResources,
	Request extends AnyResource['request'],
> = (args: {
	clientId: number;
	params: ResourceParams<Resource>;
	resourceWithParams: string;
	resource: Resource;
	request: Request extends StandardSchemaV1
		? StandardSchemaV1.InferInput<Request>
		: undefined;
}) => HandlerResponse<Resources, Resource>;

export type PickGetHandler<
	Resources extends AnyResources,
	Resource extends keyof AnyResources,
	Request extends AnyResource['request'],
> = ResourceParams<Resource> extends null
	? GetHandler<Resources, Resource, Request>
	: GetHandlerWithParams<Resources, Resource, Request>;

export type SetHandler<
	Resources extends AnyResources,
	Resource extends keyof AnyResources,
	Request extends AnyResource['request'],
> = (args: {
	clientId: number;
	resource: Resource;
	request: Request extends StandardSchemaV1
		? StandardSchemaV1.InferInput<Request>
		: undefined;
}) => HandlerResponse<Resources, Resource>;

export type SetHandlerWithParams<
	Resources extends AnyResources,
	Resource extends keyof AnyResources,
	Request extends AnyResource['request'],
> = (args: {
	clientId: number;
	params: ResourceParams<Resource>;
	resourceWithParams: string;
	resource: Resource;
	request: Request extends StandardSchemaV1
		? StandardSchemaV1.InferInput<Request>
		: undefined;
}) => HandlerResponse<Resources, Resource>;

export type PickSetHandler<
	Resources extends AnyResources,
	Resource extends keyof AnyResources,
	Request extends AnyResource['request'],
> = ResourceParams<Resource> extends null
	? SetHandler<Resources, Resource, Request>
	: SetHandlerWithParams<Resources, Resource, Request>;

export type SubscribeHandler<
	Resources extends AnyResources,
	Resource extends keyof AnyResources,
	Request extends AnyResource['request'],
> = (args: {
	clientId: number;
	resource: Resource;
	request: Request extends StandardSchemaV1
		? StandardSchemaV1.InferInput<Request>
		: undefined;
}) => SubscribeHandlerResponse<Resources, Resource>;

export type SubscribeHandlerWithParams<
	Resources extends AnyResources,
	Resource extends keyof AnyResources,
	Request extends AnyResource['request'],
> = (args: {
	clientId: number;
	params: ResourceParams<Resource>;
	resourceWithParams: string;
	resource: Resource;
	request: Request extends StandardSchemaV1
		? StandardSchemaV1.InferInput<Request>
		: undefined;
}) => SubscribeHandlerResponse<Resources, Resource>;

export type PickSubscribeHandler<
	Resources extends AnyResources,
	Resource extends keyof AnyResources,
	Request extends AnyResource['request'],
> = ResourceParams<Resource> extends null
	? SubscribeHandler<Resources, Resource, Request>
	: SubscribeHandlerWithParams<Resources, Resource, Request>;

export type Router<Resources extends AnyResources> = {
	[R in keyof Resources & string]: Resources[R] extends {
		type: 'get';
		request?: infer Request extends StandardSchemaV1;
	}
		? { get: PickGetHandler<Resources, R, Request> }
		: Resources[R] extends {
				type: 'set';
				request: infer Request extends StandardSchemaV1;
		  }
		? { set: PickSetHandler<Resources, R, Request> }
		: Resources[R] extends {
				type: 'subscribe';
				request?: infer Request extends StandardSchemaV1;
		  }
		? { subscribe: PickSubscribeHandler<Resources, R, Request> }
		: Resources[R] extends {
				type: 'get|set';
				request: infer Request extends StandardSchemaV1;
		  }
		? {
				get: PickGetHandler<Resources, R, Request>;
				set: PickSetHandler<Resources, R, Request>;
		  }
		: Resources[R] extends {
				type: 'get|subscribe';
				request?: infer Request extends StandardSchemaV1;
		  }
		? {
				get: PickGetHandler<Resources, R, Request>;
				subscribe: PickSubscribeHandler<Resources, R, Request>;
		  }
		: Resources[R] extends {
				type: 'set|subscribe';
				request: infer Request extends StandardSchemaV1;
		  }
		? {
				set: PickSetHandler<Resources, R, Request>;
				subscribe: PickSubscribeHandler<Resources, R, Request>;
		  }
		: Resources[R] extends {
				type: 'get|set|subscribe';
				request: infer Request extends StandardSchemaV1;
		  }
		? {
				get: PickGetHandler<Resources, R, Request>;
				set: PickSetHandler<Resources, R, Request>;
				subscribe: PickSubscribeHandler<Resources, R, Request>;
		  }
		: never;
};

export interface ServerLogger {
	receivedRequest: (
		request: Request<any>,
		clientId: number,
		remoteAddress: string | undefined,
	) => void;
	sentResponse: (
		request: Request<any>,
		response: Response<any>,
		clientId: number,
		remoteAddress: string | undefined,
	) => void;
	sentEvent: (
		request: Request<any>,
		event: SubscribeEvent<any>,
		clientId: number,
		remoteAddress: string | undefined,
	) => void;
	sentReject: (
		request: Request<any> | undefined,
		reject: RequestReject<AnyResources> | Reject,
		clientId: number,
		remoteAddress: string | undefined,
		error?: unknown,
	) => void;
	error: (
		message: string,
		clientId: number,
		remoteAddress: string | undefined,
		data: Record<string, unknown>,
	) => void;
	/**
	 * Smolrpc only supports synchronous schema validation and fails the validation if a promise is returned.
	 * But if the schema validation returns a promise, we need to log the result of the promise for debugging purposes.
	 */
	asyncValidationResult: (
		message: string,
		schema: StandardSchemaV1,
		value: any,
		promise_result:
			| { then_result: any; type: 'then' }
			| { catch_error: unknown; type: 'catch' },
	) => void;
}
