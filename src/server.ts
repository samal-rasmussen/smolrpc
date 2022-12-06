import { ServerHandlers } from './shared';

const handlers = {
	get: {
		resourceA: (request) => {
			console.log(request);
			return {
				value: '321',
			};
		},
		'/resourceB': (request) => {
			console.log(request);
			return {
				value: '321',
			};
		},
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
} as const satisfies ServerHandlers;
