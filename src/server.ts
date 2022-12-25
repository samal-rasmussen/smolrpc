import { z } from 'zod';
import { db } from './db';
import { AnyRouter, ResourceParams } from './shared';
import { WebSocketServer } from 'ws';

function request<RequestType extends z.AnyZodObject>(zodType?: RequestType) {
	function response<ResponseType>(
		handler: (args: {
			resource: string;
			request: z.infer<RequestType>;
		}) => ResponseType,
	) {
		return handler;
	}
	return {
		response,
	};
}

const router = {
	get: {
		'/resourceA': request(z.object({ aId: z.string() })).response(
			({ resource, request }) => {
				console.log('get ' + resource, request);
				const result = db.get('/resourceA/' + request.aId);
				return result;
			},
		),
		'/resourceB': request().response(({ resource, request }) => {
			console.log('get ' + resource, request);
			const result = db.get('/resourceA/' + request.aId);
			return result;
		}),
	},
	set: {
		'/setA': ({ resource, request }) => {
			console.log(request);
			return {
				value: '321',
			};
		},
	},
	subscribe: {
		'/subscribeA': ({ resource, request }) => {
			console.log(request);
			return {
				value: '321',
			};
		},
	},
} as const satisfies AnyRouter;
export type Router = typeof router;

const wss = new WebSocketServer({ port: 8080 });

wss.on('connection', function connection(ws) {
	ws.on('message', function message(data) {
		console.log('received: %s', data);
	});

	ws.send('something');
});
