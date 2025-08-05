import type { StandardSchemaV1 } from '@standard-schema/spec';

import type { AnyResources } from './types';

export type Params = Record<string, string> | null | undefined;

export type Request<Resources extends AnyResources> =
	| GetRequest<Resources>
	| SetRequest<Resources>
	| SubscribeRequest<Resources>
	| UnsubscribeRequest<Resources>;
export type Response<Resources extends AnyResources> =
	| GetResponse<Resources>
	| SetSuccess<Resources>
	| SubscribeAccept<Resources>
	| UnsubscribeAccept<Resources>;
export type RequestReject<Resources extends AnyResources> = {
	error: string;
	request: Request<Resources>;
	type: 'RequestReject';
};
export type Reject = {
	error: string;
	type: 'Reject';
};

export type GetRequest<Resources extends AnyResources> = {
	id: number;
	params: Params;
	resource: keyof Resources & string;
	request?: Resources[keyof Resources]['request'] extends StandardSchemaV1
		? StandardSchemaV1.InferInput<Resources[keyof Resources]['request']>
		: undefined;
	type: 'GetRequest';
};
export type GetResponse<Resources extends AnyResources> = {
	data: StandardSchemaV1.InferInput<Resources[keyof Resources]['response']>;
	id: number;
	resource: keyof Resources & string;
	type: 'GetResponse';
};
export type SetRequest<Resources extends AnyResources> = {
	id: number;
	params: Params;
	resource: keyof Resources & string;
	request: Resources[keyof Resources]['request'] extends StandardSchemaV1
		? StandardSchemaV1.InferInput<Resources[keyof Resources]['request']>
		: undefined;
	type: 'SetRequest';
};
export type SetSuccess<Resources extends AnyResources> = {
	id: number;
	resource: keyof Resources & string;
	data: StandardSchemaV1.InferInput<Resources[keyof Resources]['response']>;
	type: 'SetSuccess';
};
export type SubscribeRequest<Resources extends AnyResources> = {
	id: number;
	params: Params;
	resource: keyof Resources & string;
	request?: Resources[keyof Resources]['request'] extends StandardSchemaV1
		? StandardSchemaV1.InferInput<Resources[keyof Resources]['request']>
		: undefined;
	type: 'SubscribeRequest';
};
export type SubscribeAccept<Resources extends AnyResources> = {
	id: number;
	resource: keyof Resources & string;
	type: 'SubscribeAccept';
};
export type SubscribeEvent<Resources extends AnyResources> = {
	id: number;
	params?: Params;
	resource: keyof Resources & string;
	data: StandardSchemaV1.InferInput<Resources[keyof Resources]['response']>;
	type: 'SubscribeEvent';
};
export type UnsubscribeRequest<Resources extends AnyResources> = {
	id: number;
	subscriptionId: number;
	params: Params;
	resource: keyof Resources & string;
	type: 'UnsubscribeRequest';
};
export type UnsubscribeAccept<Resources extends AnyResources> = {
	id: number;
	resource: keyof Resources & string;
	type: 'UnsubscribeAccept';
};
