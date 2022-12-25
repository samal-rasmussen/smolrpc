type receiveMessageType =
	| 'getReject'
	| 'getResponse'
	| 'setReject'
	| 'setResponse'
	| 'subscribeAccept'
	| 'subscribeEvent'
	| 'subscribeReject';

export type getRequest = {
	type: receiveMessageType;
	request: any;
};
export type getReject = {
	type: 'getReject';
	error: string;
};
export type getResponse = {
	type: 'getResponse';
	response: any;
};
export type setRequest = {
	type: 'setRequest';
	request: any;
};
export type setReject = {
	type: 'setReject';
	error: string;
};
export type setResponse = {
	type: 'setResponse';
	response: any;
};
export type subscribeRequest = {
	type: 'subscribeRequest';
	request: any;
};
export type subscribeReject = {
	type: 'subscribeReject';
	error: string;
};
export type subscribeEvent = {
	type: 'subscribeEvent';
	response: any;
};

export type Messages = getRequest | getRequest;
