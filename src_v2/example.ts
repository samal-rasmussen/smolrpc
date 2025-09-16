import { z } from 'zod';

import {
	type InferRouterInputs,
	type InferRouterOutputs,
	initSmolRpc,
} from './index';

type Ctx = { userId: string };

const t = initSmolRpc<Ctx>();

const userRouter = t.router({
	getById: t.procedure.input(z.object({ id: z.string() })).query(
		async ({ input, ctx }) => {
			return { id: input.id, name: 'Ada', viewer: ctx.userId };
		},
		{
			output: z.object({
				id: z.string(),
				name: z.string(),
				viewer: z.string(),
			}),
		},
	),

	list: t.procedure.query(
		async () => {
			return [{ id: '1', name: 'Ada' }];
		},
		{
			output: z.array(z.object({ id: z.string(), name: z.string() })),
		},
	),

	// simplified subscription demo
	onlineUsers: t.procedure.subscription(
		({ ctx }) => {
			let closed = false;
			const observers = new Set<
				Partial<import('./core').Observer<string>>
			>();
			const timer = setTimeout(() => {
				if (closed) return;
				for (const obs of observers) {
					obs.next?.(`user:${ctx.userId}`);
					obs.complete?.();
				}
			}, 10);
			return {
				subscribe(observer) {
					observers.add(observer);
					return {
						unsubscribe() {
							observers.delete(observer);
							clearTimeout(timer);
							closed = true;
						},
					};
				},
			};
		},
		{ output: z.string() },
	),
});

const postRouter = t.router({
	create: t.procedure.input(z.object({ title: z.string() })).mutation(
		({ input, ctx }) => {
			return { id: 'p1', title: input.title, authorId: ctx.userId };
		},
		{
			output: z.object({
				id: z.string(),
				title: z.string(),
				authorId: z.string(),
			}),
		},
	),
});

export const appRouter = t.router({
	user: userRouter,
	post: postRouter,
});

export type AppInputs = InferRouterInputs<typeof appRouter>;
export type AppOutputs = InferRouterOutputs<typeof appRouter>;

async function demo() {
	const caller = t.createCaller(appRouter, { userId: 'u1' });

	const u = await caller.user.getById({ id: '123' });
	const list = await caller.user.list();
	const p = await caller.post.create({ title: 'Hello' });

	const sub = caller.user.onlineUsers();
	const _unsub = sub.subscribe({
		next: (value) => console.log('subscription next', value),
		complete: () => console.log('subscription complete'),
		error: (err) => console.error('subscription error', err),
	});

	console.log({ u, list, p });
}

demo();
