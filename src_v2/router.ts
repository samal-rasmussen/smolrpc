/**
 * Router & caller types/utilities (tRPC-style)
 *
 * Design goals:
 * - The router is the single source of truth: keys are unconstrained strings; values
 *   must be Procedures or nested Routers.
 * - No separate "resources" map to cross-validate against. This keeps type errors
 *   localized to the line that defines an individual procedure.
 * - Composition via nesting or merging keeps error surfaces small and modular.
 */
import type { AnyProcedure, Procedure, Subscribable } from './core';

/** A Router definition: string keys that map to either Procedures or Routers. */
export type RouterDef = Record<string, AnyProcedure | Router<any>>;

/** Nominal Router wrapper around the raw definition. */
export type Router<Defs extends RouterDef> = {
	_def: Defs;
};

/**
 * Create a router from a record. Values are checked; keys are free-form strings.
 * Errors attach to the specific value (procedure) being declared.
 */
export function createRouter<Defs extends RouterDef>(defs: Defs): Router<Defs> {
	return { _def: defs } as any;
}

/**
 * Merge two routers shallowly. Runtime mirrors object spread `{...a, ...b}`.
 *
 * Type explanation of the mapped/conditional type:
 * - The key space is `keyof A['_def'] | keyof B['_def']` (union of keys).
 * - For each key K:
 *   - If K exists in B, choose `B['_def'][K]` (last-wins semantics).
 *   - Else if K exists in A, choose `A['_def'][K]`.
 *   - Else `never` (unreachable, but makes the mapping total).
 */
export function mergeRouters<A extends Router<any>, B extends Router<any>>(
	a: A,
	b: B,
): Router<{
	[K in keyof A['_def'] | keyof B['_def']]: K extends keyof B['_def']
		? B['_def'][K]
		: K extends keyof A['_def']
		? A['_def'][K]
		: never;
}> {
	return createRouter({ ...(a._def as any), ...(b._def as any) }) as any;
}

/** Extract Input/Output phantom fields from a Procedure type. */
export type InferProcedureInput<P extends AnyProcedure> = P['_input'];
export type InferProcedureOutput<P extends AnyProcedure> = P['_output'];

/**
 * InferRouterInputs walks the router shape and replaces:
 * - Procedure entries with their input types
 * - Nested routers with recursively inferred inputs
 *
 * The nested ternaries are mutually exclusive branches:
 * 1) `extends AnyProcedure`? use the procedure's `_input` phantom type
 * 2) else if nested `extends Router<any>`? recurse
 * 3) else `never` (should not occur)
 */
export type InferRouterInputs<R extends Router<any>> = {
	[K in keyof R['_def']]: R['_def'][K] extends AnyProcedure
		? InferProcedureInput<R['_def'][K]>
		: R['_def'][K] extends Router<any>
		? InferRouterInputs<R['_def'][K]>
		: never;
};

/** Same structure as InferRouterInputs but extracts `_output` types. */
export type InferRouterOutputs<R extends Router<any>> = {
	[K in keyof R['_def']]: R['_def'][K] extends AnyProcedure
		? InferProcedureOutput<R['_def'][K]>
		: R['_def'][K] extends Router<any>
		? InferRouterOutputs<R['_def'][K]>
		: never;
};

/**
 * CallerFromRouter converts a router into a callable surface.
 * For each key in the router definition:
 * - If the value is a Procedure<I, O, Ctx>:
 *   - Build a function whose argument is I (optional if I is void)
 *   - If O is a Subscribable, return Subscribable; else return Promise<O>
 * - If the value is a nested Router, recurse to build a nested caller object.
 *
 * The nested conditional `O extends Subscribable<any> ? ... : ...` models the
 * difference between subscriptions and queries/mutations.
 */
export type CallerFromRouter<R extends Router<any>, Ctx> = {
	[K in keyof R['_def']]: R['_def'][K] extends Procedure<
		infer I,
		infer O,
		any
	>
		? O extends Subscribable<any>
			? (input: I extends void ? void | undefined : I) => O
			: (input: I extends void ? void | undefined : I) => Promise<O>
		: R['_def'][K] extends Router<any>
		? CallerFromRouter<R['_def'][K], Ctx>
		: never;
};

/** Runtime helper to detect Routers. */
function isRouter(x: unknown): x is Router<any> {
	return !!x && typeof x === 'object' && '_def' in (x as any);
}

/**
 * Create a typed caller bound to a concrete context value.
 *
 * Implementation notes:
 * - `walk` mirrors the router's shape. For router nodes, it builds an object of
 *   the same keys by recursion. For procedures, it returns an invokable function.
 * - Input parsing: if `inputSchema` is present, we synchronously validate via Standard Schema.
 * - Output validation: if `outputSchema` is present, we synchronously validate
 *   the resolved result before returning it to the caller.
 *
 *  TODO: Should this be a recursive proxy implementation like trpc uses?
 *        See: https://trpc.io/blog/tinyrpc-client
 */
export function createCaller<R extends Router<any>, Ctx>(
	router: R,
	ctx: Ctx,
): CallerFromRouter<R, Ctx> {
	const walk = (
		node: Router<any>['_def'] | Router<any> | AnyProcedure,
	): any => {
		if (isRouter(node)) {
			const out: Record<string, unknown> = {};
			for (const key of Object.keys(node._def)) {
				out[key] = walk((node._def as any)[key]);
			}
			return out;
		}

		const proc = node as AnyProcedure;
		return (input?: unknown) => {
			// Step 1: input parsing/validation
			let parsed = input as unknown;
			if (proc.inputSchema) {
				const res = proc.inputSchema['~standard'].validate(input);
				if ('then' in res) {
					throw new Error(
						'Standard Schema validation must be synchronous',
					);
				}
				if ('issues' in res) {
					throw new Error(
						`input schema validation failed: ${JSON.stringify(
							res.issues,
						)}`,
					);
				}
				parsed = res.value;
			}

			// Step 2: call resolver
			const resolved = proc.resolve({ input: parsed as any, ctx } as any);

			// Subscription: return as-is (no output schema for stream envelope here)
			if (
				(resolved as any) &&
				typeof (resolved as any).subscribe === 'function'
			) {
				return resolved as any;
			}

			// Step 3: output validation (if provided)
			const wrap = async () => {
				const value = await resolved;
				if (proc.outputSchema) {
					const out = proc.outputSchema['~standard'].validate(value);
					if ((out as any).then) {
						throw new Error(
							'Standard Schema validation must be synchronous',
						);
					}
					if ((out as any).issues) {
						throw new Error(
							`output schema validation failed: ${JSON.stringify(
								(out as any).issues,
							)}`,
						);
					}
					return (out as any).value;
				}
				return value;
			};

			return wrap();
		};
	};

	return walk(router) as any;
}
