import { WebSocket, WebSocketServer } from 'ws';
import {
	GetResponse,
	Params,
	Reject,
	Request,
	SetSuccess,
	SubscribeAccept,
	SubscribeEvent,
} from '../mini-rpc/message-types.js';
import {
	GetHandler,
	GetHandlerWithParams,
	PickSetHandler,
	PickSubscribeHandler,
	SetHandler,
	SetHandlerWithParams,
	SubscribeHandlerWithParams,
} from '../mini-rpc/server.types.js';
import { Resources } from '../shared/resources.js';
import { router } from './router.js';

const wss = new WebSocketServer({ port: 9200 });

function getQualifiedResource(resource: string, params: Params) {
	Object.entries(params ?? {}).forEach(([key, value]) => {
		resource = resource.replace(`:${key}`, value);
	});
	return resource;
}

function sendReject(ws: WebSocket, id: number, error: string) {
	const reject: Reject = {
		id,
		error,
		type: 'Reject',
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

wss.on('connection', function connection(ws) {
	ws.on('message', async function message(rawData: any) {
		// console.log('received: %s', rawData);
		const message = JSON.parse(rawData) as Request<Resources>;
		if (typeof message.id !== 'number') {
			console.error(`no id number on message`);
			return;
		}
		if (typeof message.resource !== 'string') {
			console.error(`no resource string on message`);
			return;
		}
		const resource = router[message.resource];
		if (resource == null) {
			sendReject(ws, message.id, `resource not found`);
			return;
		}
		if (!validateParams(message.resource, message.params)) {
			sendReject(ws, message.id, `invalid params`);
			return;
		}
		if (message.type === 'GetRequest') {
			try {
				const args: Parameters<GetHandlerWithParams<any, any>>[0] = {
					resource: message.resource,
				} as any;
				if (message.params != null) {
					const qualifiedResource = getQualifiedResource(
						message.resource,
						message.params,
					);
					args.params = message.params;
					args.qualifiedResource = qualifiedResource;
				}
				const get = (resource as any).get as GetHandler<any, any>;
				const result = await get(args);
				const response: GetResponse = {
					id: message.id,
					data: result,
					type: 'GetResponse',
				};
				// console.log(response, JSON.stringify(response));
				ws.send(JSON.stringify(response));
			} catch (error) {
				sendReject(ws, message.id, '500');
			}
		} else if (message.type === 'SetRequest') {
			try {
				const args: Parameters<SetHandlerWithParams<any, any>>[0] = {
					resource: message.resource,
					request: message.data,
				} as any;
				if (message.params != null) {
					const qualifiedResource = getQualifiedResource(
						message.resource,
						message.params,
					);
					args.params = message.params;
					args.qualifiedResource = qualifiedResource;
				}
				const set = (resource as any).set as PickSetHandler<any, any>;
				await set(args);
				const response: SetSuccess = {
					id: message.id,
					type: 'SetSuccess',
				};
				ws.send(JSON.stringify(response));
			} catch (error) {
				console.error(error);
				sendReject(ws, message.id, '500');
			}
		} else if (message.type === 'SubscribeRequest') {
			try {
				const args: Parameters<
					SubscribeHandlerWithParams<any, any>
				>[0] = {
					resource: message.resource,
				} as any;
				if (message.params != null) {
					const qualifiedResource = getQualifiedResource(
						message.resource,
						message.params,
					);
					args.params = message.params;
					args.qualifiedResource = qualifiedResource;
				}
				const subscribe = (resource as any)
					.subscribe as PickSubscribeHandler<any, any>;
				const observable = await subscribe(args);
				observable.subscribe({
					next(val) {
						const event: SubscribeEvent = {
							id: message.id,
							type: 'SubscribeEvent',
							data: val,
						};
						ws.send(JSON.stringify(event));
					},
				});
				const response: SubscribeAccept = {
					id: message.id,
					type: 'SubscribeAccept',
				};
				ws.send(JSON.stringify(response));
			} catch (error) {
				sendReject(ws, message.id, '500');
			}
		} else {
			sendReject(ws, (message as any).id, `invalid type`);
		}
	});
});
