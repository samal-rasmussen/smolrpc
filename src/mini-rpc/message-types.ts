import { AnyResources } from './types';

export type Params = Record<string, string> | null | undefined;

export type ResponseMessageType =
	| 'GetResponse'
	| 'SetSuccess'
	| 'SubscribeAccept';
export type RequestMessageType =
	| 'GetRequest'
	| 'SetRequest'
	| 'SubscribeRequest';

export type Request<Resources extends AnyResources> =
	| GetRequest<Resources>
	| SetRequest<Resources>
	| SubscribeRequest<Resources>
	| UnsubscribeRequest<Resources>;
export type Response<Resources extends AnyResources> =
	| GetResponse<Resources>
	| SetSuccess<Resources>
	| SubscribeAccept<Resources>;
export type Reject<Resources extends AnyResources> = {
	error: string;
	id: number;
	params?: Params;
	resource: keyof Resources;
	type: 'Reject';
};

export type GetRequest<Resources extends AnyResources> = {
	id: number;
	type: 'GetRequest';
	resource: keyof Resources;
	params: Params;
};
export type GetResponse<Resources extends AnyResources> = {
	data: any;
	id: number;
	resource: keyof Resources;
	type: 'GetResponse';
};
export type SetRequest<Resources extends AnyResources> = {
	data: any;
	id: number;
	params: Params;
	resource: keyof Resources;
	type: 'SetRequest';
};
export type SetSuccess<Resources extends AnyResources> = {
	id: number;
	resource: keyof Resources;
	type: 'SetSuccess';
};
export type SubscribeRequest<Resources extends AnyResources> = {
	id: number;
	type: 'SubscribeRequest';
	resource: keyof Resources;
	params: Params;
};
export type UnsubscribeRequest<Resources extends AnyResources> = {
	id: number;
	resource: keyof Resources;
	type: 'UnsubscribeRequest';
	params: Params;
};
export type SubscribeAccept<Resources extends AnyResources> = {
	id: number;
	resource: keyof Resources;
	type: 'SubscribeAccept';
};
export type SubscribeEvent<Resources extends AnyResources> = {
	data: any;
	id: number;
	resource: keyof Resources;
	type: 'SubscribeEvent';
};
