import { z } from 'zod';
import { AnyRouter } from './shared';

function request<RequestType extends z.AnyZodObject>(zodType: RequestType) {
	function response<ResponseType>(
		handler: (request: z.infer<RequestType>) => ResponseType,
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
			(request) => {
				console.log(request);
				return { aVal: 321 };
			},
		),
		'/resourceB': request(z.object({ bId: z.string() })).response(
			(request) => {
				console.log(request);
				return { bVal: 321 };
			},
		),
	},
	set: {
		'/setA': (request) => {
			console.log(request);
			return {
				value: '321',
			};
		},
	},
	subscribe: {
		'/subscribeA': (request) => {
			console.log(request);
			return {
				value: '321',
			};
		},
	},
} as const satisfies AnyRouter;
export type Router = typeof router;
