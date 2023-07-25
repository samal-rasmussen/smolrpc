export type Data =
	| string
	| ArrayBufferLike
	| Blob
	| ArrayBufferView
	| Buffer
	| Buffer[];

interface WSErrorEvent {
	error: any;
	message: string;
	type: string;
	target: WS;
}

interface WSCloseEvent {
	wasClean: boolean;
	code: number;
	reason: string;
	type: string;
	target: WS;
}

interface WSMessageEvent {
	data: Data;
	type: string;
	target: WS;
}

interface WSEventListenerOptions {
	once?: boolean | undefined;
}

export type WS = {
	addEventListener(
		method: 'message',
		cb: (event: WSMessageEvent) => void,
		options?: WSEventListenerOptions,
	): void;
	addEventListener(
		method: 'close',
		cb: (event: WSCloseEvent) => void,
		options?: WSEventListenerOptions,
	): void;
	addEventListener(
		method: 'error',
		cb: (event: WSErrorEvent) => void,
		options?: WSEventListenerOptions,
	): void;
	send: (data: Data) => void;
};
