import { Resources } from './shared';

export type ResponseMessageType =
	| 'GetResponse'
	| 'SetSuccess'
	| 'SubscribeAccept';
export type RequestMessageType =
	| 'GetRequest'
	| 'SetRequest'
	| 'SubscribeRequest';

export type Request = GetRequest | SetRequest | SubscribeRequest;
export type Response = GetResponse | SetSuccess | SubscribeAccept;
export type Reject = {
	id: number;
	type: 'Reject';
	error: string;
};

export type GetRequest = {
	id: number;
	type: 'GetRequest';
	resource: keyof Resources;
	params?: Record<string, string>;
};
export type GetResponse = {
	id: number;
	type: 'GetResponse';
	data: any;
};
export type SetRequest = {
	id: number;
	type: 'SetRequest';
	resource: keyof Resources;
	data: any;
	params?: Record<string, string>;
};
export type SetSuccess = {
	id: number;
	type: 'SetSuccess';
};
export type SubscribeRequest = {
	id: number;
	type: 'SubscribeRequest';
	resource: keyof Resources;
	params?: Record<string, string>;
};
export type SubscribeAccept = {
	id: number;
	type: 'SubscribeAccept';
};
export type SubscribeEvent = {
	id: number;
	type: 'SubscribeEvent';
	data: any;
};
