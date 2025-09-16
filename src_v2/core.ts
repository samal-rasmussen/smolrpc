import type { StandardSchemaV1 } from '@standard-schema/spec';

export type MaybePromise<T> = T | Promise<T>;

export interface Unsubscribable {
	unsubscribe(): void;
}

export interface Observer<T> {
	next: (value: T) => void;
	error: (err: unknown) => void;
	complete: () => void;
}

export interface Subscribable<T> {
	subscribe(observer: Partial<Observer<T>>): Unsubscribable;
}

export type ProcedureKind = 'query' | 'mutation' | 'subscription';

/**
 * A typed procedure with optional Standard Schema-based validation.
 * - If provided, `inputSchema` is used to validate/parse inputs at call time.
 * - If provided, `outputSchema` is used to validate/parse resolver results.
 */
export type Procedure<Input, Output, Ctx> = {
	type: ProcedureKind;
	resolve: (opts: { input: Input; ctx: Ctx }) => MaybePromise<Output>;
	inputSchema?: StandardSchemaV1<any, any>;
	outputSchema?: StandardSchemaV1<any, any>;
	// Phantom fields for inference
	_input: Input;
	_output: Output;
	_ctx: Ctx;
};

export type AnyProcedure = Procedure<any, any, any>;

/**
 * Fluent builder for a Procedure. You can:
 * - call `.input(schemaOrParser)` to set the input type and parser/validator
 * - call `.query/.mutation/.subscription` to create the procedure
 * - optionally pass `{ output: schema }` to validate results using Standard Schema
 */
export type ProcedureBuilder<Ctx, Input = void> = {
	/**
	 * Narrow or declare the input type.
	 * You may pass either a StandardSchemaV1 or a custom parser function.
	 */
	input<NewInput>(
		parserOrSchema?:
			| ((raw: unknown) => NewInput)
			| StandardSchemaV1<NewInput, any>,
	): ProcedureBuilder<Ctx, NewInput>;

	query<Output>(
		resolver: (opts: { input: Input; ctx: Ctx }) => MaybePromise<Output>,
		options?: { output?: StandardSchemaV1<Output, any> },
	): Procedure<Input, Output, Ctx>;

	mutation<Output>(
		resolver: (opts: { input: Input; ctx: Ctx }) => MaybePromise<Output>,
		options?: { output?: StandardSchemaV1<Output, any> },
	): Procedure<Input, Output, Ctx>;

	subscription<Output>(
		resolver: (opts: { input: Input; ctx: Ctx }) => Subscribable<Output>,
		options?: { output?: StandardSchemaV1<Output, any> },
	): Procedure<Input, Subscribable<Output>, Ctx>;
};

export function createProcedureBuilder<Ctx, Input = void>(
	inputSchema?: StandardSchemaV1<Input, any>,
): ProcedureBuilder<Ctx, Input> {
	const builder: ProcedureBuilder<Ctx, Input> = {
		input(
			newParserOrSchema?:
				| ((raw: unknown) => unknown)
				| StandardSchemaV1<any, any>,
		) {
			return createProcedureBuilder(
				newParserOrSchema as any,
			) as unknown as ProcedureBuilder<Ctx, any>;
		},
		query(resolver, options) {
			return {
				type: 'query',
				resolve: resolver as any,
				inputSchema,
				outputSchema: options?.output as
					| StandardSchemaV1<any, any>
					| undefined,
				_input: undefined as any,
				_output: undefined as any,
				_ctx: undefined as any,
			} as any;
		},
		mutation(resolver, options) {
			return {
				type: 'mutation',
				resolve: resolver as any,
				inputSchema,
				outputSchema: options?.output as
					| StandardSchemaV1<any, any>
					| undefined,
				_input: undefined as any,
				_output: undefined as any,
				_ctx: undefined as any,
			} as any;
		},
		subscription(resolver, options) {
			return {
				type: 'subscription',
				resolve: resolver as any,
				inputSchema,
				outputSchema: options?.output as
					| StandardSchemaV1<any, any>
					| undefined,
				_input: undefined as any,
				_output: undefined as any,
				_ctx: undefined as any,
			} as any;
		},
	};

	return builder;
}
