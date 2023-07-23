import {
	GetResponse,
	Params,
	Reject,
	Request,
	SetSuccess,
	SubscribeAccept,
	SubscribeEvent,
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
import { AnyResources } from './types';

type WS = {
	send: (data: string | ArrayBufferLike | Blob | ArrayBufferView) => void;
};

export function getQualifiedResource(resource: string, params: Params) {
	Object.entries(params ?? {}).forEach(([key, value]) => {
		resource = resource.replace(`:${key}`, value);
	});
	return resource;
}

export function sendReject<Resources extends AnyResources>(
	ws: WS,
	id: number,
	error: string,
	resource: keyof Resources,
	params: Params,
) {
	if (params == null) {
		const reject: Reject<Resources> = {
			id,
			error,
			type: 'Reject',
			resource,
		};
		ws.send(JSON.stringify(reject));
	} else {
		const reject: Required<Reject<Resources>> = {
			id,
			error,
			params,
			type: 'Reject',
			resource,
		};
		ws.send(JSON.stringify(reject));
	}
}

export function validateParams(resource: string, params: Params): boolean {
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
	async function handleWSMessage(
		data: string | Buffer | ArrayBuffer | Buffer[],
		ws: WS,
	) {
		if (typeof data != 'string') {
			console.error(
				`only string data supported. typeof event.data = ${typeof data}`,
			);
			return;
		}
		// console.log('received: %s', data);
		const message = JSON.parse(data) as Request<Resources>;
		if (typeof message.id !== 'number') {
			console.error(`no id number on message`);
			return;
		}
		if (typeof message.resource !== 'string') {
			console.error(`no resource string on message`);
			return;
		}
		const routerResource = router[message.resource];
		if (routerResource == null) {
			sendReject(
				ws,
				message.id,
				`resource not found`,
				message.resource,
				message.params,
			);
			return;
		}
		if (!validateParams(message.resource, message.params)) {
			sendReject(
				ws,
				message.id,
				`invalid params`,
				message.resource,
				message.params,
			);
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
				const get = (routerResource as any).get as GetHandler<any, any>;
				const result = await get(args);
				const response: GetResponse<Resources> = {
					id: message.id,
					data: result,
					type: 'GetResponse',
					resource: message.resource,
				};
				// console.log(response, JSON.stringify(response));
				ws.send(JSON.stringify(response));
			} catch (error) {
				sendReject(
					ws,
					message.id,
					'500',
					message.resource,
					message.params,
				);
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
				const set = (routerResource as any).set as PickSetHandler<
					any,
					any
				>;
				await set(args);
				const response: SetSuccess<Resources> = {
					id: message.id,
					resource: message.resource,
					type: 'SetSuccess',
				};
				ws.send(JSON.stringify(response));
			} catch (error) {
				console.error(error);
				sendReject(
					ws,
					message.id,
					'500',
					message.resource,
					message.params,
				);
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
				const subscribe = (routerResource as any)
					.subscribe as PickSubscribeHandler<any, any>;
				const observable = await subscribe(args);
				observable.subscribe({
					next(val: any) {
						const event: SubscribeEvent<Resources> = {
							data: val,
							id: message.id,
							resource: message.resource,
							type: 'SubscribeEvent',
						};
						ws.send(JSON.stringify(event));
					},
				});
				const response: SubscribeAccept<Resources> = {
					id: message.id,
					resource: message.resource,
					type: 'SubscribeAccept',
				};
				ws.send(JSON.stringify(response));
			} catch (error) {
				sendReject(
					ws,
					message.id,
					'500',
					message.resource,
					message.params,
				);
			}
		} else {
			sendReject(
				ws,
				(message as any).id,
				`invalid type`,
				message.resource,
				message.params,
			);
		}
	}

	return {
		onMessage: handleWSMessage,
	};
}
