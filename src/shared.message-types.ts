import { Resources } from './shared';

export type ResponseMessageType =
	| 'GetResponse'
	| 'SetResponse'
	| 'SubscribeAccept';
export type RequestMessageType =
	| 'GetRequest'
	| 'SetRequest'
	| 'SubscribeRequest';

export type Request = GetRequest | SetRequest | SubscribeRequest;
export type Response = GetResponse | SetResponse | SubscribeAccept;
export type Reject = {
	id: number;
	type: 'Reject';
	error: string;
};

export type GetRequest = {
	id: number;
	type: 'GetRequest';
	resource: keyof Resources;
	params?: string[];
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
	params?: string[];
};
export type SetResponse = {
	id: number;
	type: 'SetResponse';
};
export type SubscribeRequest = {
	id: number;
	type: 'SubscribeRequest';
	resource: keyof Resources;
	params?: string[];
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
