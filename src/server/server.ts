import { WebSocket, WebSocketServer } from 'ws';
import {
	GetResponse,
	Reject,
	Request,
	SetSuccess,
	SubscribeAccept,
	SubscribeEvent,
} from '../shared/message-types.js';
import { Resources } from '../shared/resources.js';
import { router } from './router.js';
import { Handlers } from './server.types.js';

const wss = new WebSocketServer({ port: 9200 });

function sendReject(ws: WebSocket, id: number, error: string) {
	const reject: Reject = {
		id,
		error,
		type: 'Reject',
	};
	ws.send(JSON.stringify(reject));
}

function validateParams(
	resource: string,
	params?: Record<string, string>,
): boolean {
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
				const get = resource.get as Handlers<any>['get'];
				const result = await get({
					resource: message.resource,
					params: message.params,
				});
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
				const set = (resource as any).set as Handlers<any>['set'];
				await set({
					resource: message.resource,
					request: message.data,
					params: message.params,
				});
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
				const subscribe = (resource as any)
					.subscribe as Handlers<any>['subscribe'];
				const observable = await subscribe({
					resource: message.resource,
					params: message.params,
				});
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
