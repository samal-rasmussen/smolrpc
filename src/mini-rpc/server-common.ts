import {
	GetResponse,
	Params,
	Reject,
	Request,
	SetSuccess,
	SubscribeAccept,
	SubscribeEvent,
	UnsubscribeAccept,
} from './message-types';
import {
	GetHandler,
	GetHandlerWithParams,
	PickSetHandler,
	PickSubscribeHandler,
	Router,
	SetHandlerWithParams,
	SubscribeHandlerWithParams,
} from './server.types';
import { AnyResources, Unsubscribable } from './types';

type Data =
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

type WS = {
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

function getQualifiedResource(resource: string, params: Params) {
	Object.entries(params ?? {}).forEach(([key, value]) => {
		resource = resource.replace(`:${key}`, value);
	});
	return resource;
}

function sendReject<Resources extends AnyResources>(
	ws: WS,
	error: string,
	request: Request<Resources>,
) {
	const reject: Reject<Resources> = {
		error,
		type: 'Reject',
		request,
	};
	ws.send(JSON.stringify(reject));
}

function validateParams(resource: string, params: Params): boolean {
	const count = resource.split(':').length - 1;
	if (count > 0) {
		if (params == null) {
			return false;
		}
		if (Object.keys(params).length !== count) {
			return false;
		}
	}
	return true;
}

export function initServer<Resources extends AnyResources>(
	router: Router<Resources>,
) {
	const listeners = new Map<WS, Map<string, Unsubscribable>>();

	function getWebSocketListeners(ws: WS) {
		const websocketListeners = listeners.get(ws);
		if (websocketListeners == null) {
			throw new Error(
				'Did not find map of listeners for websocket connection',
			);
		}
		return websocketListeners;
	}

	function addConnection(ws: WS) {
		const existing = listeners.get(ws);
		if (existing != null) {
			throw new Error(
				'initServer.onOpen: Found unexpected existing map of listeners for websocket connection',
			);
		}
		listeners.set(ws, new Map());
		ws.addEventListener('close', () => {
			const existing = listeners.get(ws);
			if (existing == null) {
				throw new Error(
					'initServer.onClose: Map of listeners for websocket connection not found',
				);
			}
			listeners.delete(ws);
		});
		ws.addEventListener('error', (event) => {
			console.error(`initServer.onError: ${event}`);
		});
		ws.addEventListener('message', async (event) => {
			await handleWSMessage(event.data, ws);
		});
	}

	async function handleWSMessage(data: Data, ws: WS) {
		if (typeof data != 'string') {
			console.error(
				`only string data supported. typeof event.data = ${typeof data}`,
			);
			return;
		}
		// console.log('received: %s', data);
		const request = JSON.parse(data) as Request<Resources>;
		if (typeof request.id !== 'number') {
			console.error(`no id number on message`);
			return;
		}
		if (typeof request.resource !== 'string') {
			console.error(`no resource string on message`);
			return;
		}
		const routerResource = router[request.resource];
		if (routerResource == null) {
			sendReject(ws, `resource not found`, request);
			return;
		}
		if (!validateParams(request.resource, request.params)) {
			sendReject(ws, `invalid params`, request);
			return;
		}
		if (request.type === 'GetRequest') {
			try {
				const args: Parameters<GetHandlerWithParams<any, any>>[0] = {
					resource: request.resource,
				} as any;
				if (request.params != null) {
					const qualifiedResource = getQualifiedResource(
						request.resource,
						request.params,
					);
					args.params = request.params;
					args.qualifiedResource = qualifiedResource;
				}
				const get = (routerResource as any).get as GetHandler<any, any>;
				const result = await get(args);
				const response: GetResponse<Resources> = {
					id: request.id,
					data: result,
					type: 'GetResponse',
					resource: request.resource,
				};
				// console.log(response, JSON.stringify(response));
				ws.send(JSON.stringify(response));
			} catch (error) {
				console.error(error);
				sendReject(ws, '500', request);
			}
		} else if (request.type === 'SetRequest') {
			try {
				const args: Parameters<SetHandlerWithParams<any, any>>[0] = {
					resource: request.resource,
					request: request.data,
				} as any;
				if (request.params != null) {
					const qualifiedResource = getQualifiedResource(
						request.resource,
						request.params,
					);
					args.params = request.params;
					args.qualifiedResource = qualifiedResource;
				}
				const set = (routerResource as any).set as PickSetHandler<
					any,
					any
				>;
				await set(args);
				const response: SetSuccess<Resources> = {
					id: request.id,
					resource: request.resource,
					type: 'SetSuccess',
				};
				ws.send(JSON.stringify(response));
			} catch (error) {
				console.error(error);
				sendReject(ws, '500', request);
			}
		} else if (request.type === 'SubscribeRequest') {
			try {
				const args: Parameters<
					SubscribeHandlerWithParams<any, any>
				>[0] = {
					resource: request.resource,
				} as any;
				if (request.params != null) {
					const qualifiedResource = getQualifiedResource(
						request.resource,
						request.params,
					);
					args.params = request.params;
					args.qualifiedResource = qualifiedResource;
				}
				const websocketListeners = getWebSocketListeners(ws);
				const existingSubscription = websocketListeners.get(
					args.qualifiedResource ?? args.resource,
				);
				if (existingSubscription != null) {
					sendReject(ws, 'Already subscribed', request);
					return;
				}
				const subscribe = (routerResource as any)
					.subscribe as PickSubscribeHandler<any, any>;
				const observable = await subscribe(args);
				const subscription = observable.subscribe({
					next(val: any) {
						const event: SubscribeEvent<Resources> = {
							data: val,
							id: request.id,
							resource: request.resource,
							type: 'SubscribeEvent',
						};
						ws.send(JSON.stringify(event));
					},
				});
				websocketListeners.set(
					args.qualifiedResource ?? args.resource,
					subscription,
				);
				const response: SubscribeAccept<Resources> = {
					id: request.id,
					resource: request.resource,
					type: 'SubscribeAccept',
				};
				ws.send(JSON.stringify(response));
			} catch (error) {
				console.error(error);
				sendReject(ws, '500', request);
			}
		} else if (request.type === 'UnsubscribeRequest') {
			try {
				const resource =
					request.params != null
						? getQualifiedResource(request.resource, request.params)
						: request.resource;
				const websocketListeners = getWebSocketListeners(ws);
				const subscription = websocketListeners.get(resource);
				if (subscription == null) {
					sendReject(ws, 'Not subscribed', request);
					return;
				}
				subscription.unsubscribe();
				websocketListeners.delete(resource);
				const response: UnsubscribeAccept<Resources> = {
					id: request.id,
					resource: request.resource,
					type: 'UnsubscribeAccept',
				};
				ws.send(JSON.stringify(response));
			} catch (error) {
				console.error(error);
				sendReject(ws, '500', request);
			}
		} else {
			try {
				exhaustive(request);
			} catch (e) {
				sendReject(ws, `Invalid request type`, request);
			}
		}
	}

	return {
		addConnection,
	};
}

function exhaustive(arg: never): never {
	throw new Error(`Failed exhaustive check. Expected never but got ${arg}`);
}
