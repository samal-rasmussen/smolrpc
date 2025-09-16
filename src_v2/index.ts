import { createProcedureBuilder } from './core';
import { createCaller, createRouter, mergeRouters } from './router';

export * from './core';
export * from './router';

export function initSmolRpc<Ctx>() {
	return {
		procedure: createProcedureBuilder<Ctx>(),
		router: createRouter,
		mergeRouters,
		createCaller<R extends import('./router').Router<any>>(
			router: R,
			ctx: Ctx,
		) {
			return createCaller(router, ctx);
		},
	};
}
