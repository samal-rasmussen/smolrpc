import type { StandardSchemaV1 } from '@standard-schema/spec';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AnyResources, Router } from '../index.js';
import { initServer, json_stringify } from '../index.js';
import {
	ControlledServerSocket,
	createServerLogger,
	createTestSchema as schema,
} from './server-test-helpers.ts';

const requestSchema = schema<string | bigint, { parsed: string | bigint }>(
	(value) =>
		typeof value === 'string' || typeof value === 'bigint'
			? { value: { parsed: value } }
			: { issues: [{ message: 'expected string or bigint' }] },
);
const responseSchema = schema<
	{ handler: string | bigint },
	{ wire: string | bigint }
>((value) =>
	typeof value === 'object' &&
	value != null &&
	'handler' in value &&
	(typeof value.handler === 'string' || typeof value.handler === 'bigint')
		? { value: { wire: value.handler } }
		: { issues: [{ message: 'invalid handler response' }] },
);

const resources = {
	'/get-only': { response: responseSchema, type: 'get' },
	'/items/:teamId/posts/:postId': {
		request: requestSchema,
		response: responseSchema,
		type: 'get|set',
	},
} as const satisfies AnyResources;
type Resources = typeof resources;
const getOnlyResources = { '/get-only': resources['/get-only'] } as const;
type GetOnlyResources = typeof getOnlyResources;

afterEach(() => {
	vi.restoreAllMocks();
});

describe('server request dispatch', () => {
	it('dispatches transformed GET and SET values to their originating connections', async () => {
		const get = vi.fn(
			({ request }: { request: { parsed: string | bigint } }) => ({
				handler: request.parsed,
			}),
		);
		const set = vi.fn(
			async ({ request }: { request: { parsed: string | bigint } }) => ({
				handler: request.parsed,
			}),
		);
		const router = {
			'/get-only': { get: () => ({ handler: 'ready' }) },
			'/items/:teamId/posts/:postId': { get, set },
		} as const satisfies Router<Resources>;
		const log = createServerLogger();
		const server = initServer(router, resources, {
			serverLogger: log.logger,
		});
		const first = new ControlledServerSocket();
		const second = new ControlledServerSocket();
		expect(server.addConnection(first.asWebSocket(), 'first.test')).toBe(0);
		expect(server.addConnection(second.asWebSocket(), 'second.test')).toBe(
			1,
		);

		const getRequest = {
			id: 1,
			params: { postId: 42, teamId: 'acme' },
			request: 9007199254740993n,
			resource: '/items/:teamId/posts/:postId',
			type: 'GetRequest',
		};
		await first.receive(json_stringify(getRequest));
		expect(get).toHaveBeenCalledWith({
			clientId: 0,
			params: { postId: 42, teamId: 'acme' },
			request: { parsed: 9007199254740993n },
			resource: '/items/:teamId/posts/:postId',
			resourceWithParams: '/items/acme/posts/42',
		});
		expect(first.sentFrames()).toEqual([
			{
				data: { wire: 9007199254740993n },
				id: 1,
				resource: '/items/:teamId/posts/:postId',
				type: 'GetResponse',
			},
		]);
		expect(first.sent).toEqual([
			json_stringify({
				id: 1,
				type: 'GetResponse',
				resource: '/items/:teamId/posts/:postId',
				data: { wire: 9007199254740993n },
			}),
		]);
		expect(second.sent).toEqual([]);
		expect(log.receivedRequest).toHaveBeenCalledWith(
			getRequest,
			0,
			'first.test',
		);
		expect(log.sentResponse).toHaveBeenCalledWith(
			getRequest,
			first.sentFrames()[0],
			0,
			'first.test',
		);

		const setRequest = {
			id: 1,
			params: { postId: 'post', teamId: 7 },
			request: 'written',
			resource: '/items/:teamId/posts/:postId',
			type: 'SetRequest',
		};
		await second.receive(json_stringify(setRequest));
		expect(set).toHaveBeenCalledWith({
			clientId: 1,
			params: { postId: 'post', teamId: 7 },
			request: { parsed: 'written' },
			resource: '/items/:teamId/posts/:postId',
			resourceWithParams: '/items/7/posts/post',
		});
		expect(second.sentFrames()).toEqual([
			{
				data: { wire: 'written' },
				id: 1,
				resource: '/items/:teamId/posts/:postId',
				type: 'SetSuccess',
			},
		]);
	});

	it('passes a parsed GET request when an absent wire value transforms successfully', async () => {
		const absentRequestSchema = schema<undefined, number>((value) =>
			value === undefined
				? { value: 42 }
				: { issues: [{ message: 'expected undefined' }] },
		);
		const numberResponseSchema = schema<number, number>((value) =>
			typeof value === 'number'
				? { value }
				: { issues: [{ message: 'expected number' }] },
		);
		const transformedResources = {
			'/transformed': {
				request: absentRequestSchema,
				response: numberResponseSchema,
				type: 'get',
			},
		} as const satisfies AnyResources;
		const get = vi.fn(({ request }: { request: number }) => request);
		const server = initServer(
			{ '/transformed': { get } },
			transformedResources,
		);
		const socket = new ControlledServerSocket();
		server.addConnection(socket.asWebSocket());

		await socket.receive(
			json_stringify({
				id: 1,
				resource: '/transformed',
				type: 'GetRequest',
			}),
		);

		expect(get).toHaveBeenCalledWith({
			clientId: 0,
			request: 42,
			resource: '/transformed',
			resourceWithParams: '/transformed',
		});
		expect(socket.sentFrames()).toEqual([
			{
				data: 42,
				id: 1,
				resource: '/transformed',
				type: 'GetResponse',
			},
		]);
	});

	it.each([
		['non-string data', new Uint8Array([1, 2, 3])],
		['malformed JSON', '{'],
		['null', 'null'],
		['array', '[]'],
		['primitive', '42'],
	] as const)('contains unaddressable %s', async (_name, data) => {
		const log = createServerLogger();
		const server = initServer(
			{
				'/get-only': { get: () => ({ handler: 'ok' }) },
				'/items/:teamId/posts/:postId': {
					get: () => ({ handler: 'ok' }),
					set: () => ({ handler: 'ok' }),
				},
			} satisfies Router<Resources>,
			resources,
			{ serverLogger: log.logger },
		);
		const socket = new ControlledServerSocket();
		server.addConnection(socket.asWebSocket(), 'invalid.test');

		await expect(socket.receive(data)).resolves.toBeUndefined();
		expect(socket.sentFrames()).toEqual([
			expect.objectContaining({ type: 'Reject' }),
		]);
		expect(log.sentReject.mock.calls[0]?.slice(0, 4)).toEqual([
			undefined,
			expect.objectContaining({ type: 'Reject' }),
			0,
			'invalid.test',
		]);
		expect(log.error).toHaveBeenCalledOnce();
	});

	it.each([
		[
			'missing',
			json_stringify({
				resource: '/get-only',
				type: 'GetRequest',
			}),
		],
		[
			'null',
			json_stringify({
				id: null,
				resource: '/get-only',
				type: 'GetRequest',
			}),
		],
		[
			'zero',
			json_stringify({
				id: 0,
				resource: '/get-only',
				type: 'GetRequest',
			}),
		],
		[
			'negative zero',
			json_stringify({
				id: -0,
				resource: '/get-only',
				type: 'GetRequest',
			}),
		],
		[
			'negative integer',
			json_stringify({
				id: -1,
				resource: '/get-only',
				type: 'GetRequest',
			}),
		],
		[
			'fractional number',
			json_stringify({
				id: 1.5,
				resource: '/get-only',
				type: 'GetRequest',
			}),
		],
		[
			'unsafe integer',
			json_stringify({
				id: Number.MAX_SAFE_INTEGER + 1,
				resource: '/get-only',
				type: 'GetRequest',
			}),
		],
		[
			'non-finite number',
			'{"id":1e400,"resource":"/get-only","type":"GetRequest"}',
		],
		[
			'string',
			json_stringify({
				id: '1',
				resource: '/get-only',
				type: 'GetRequest',
			}),
		],
		[
			'boolean',
			json_stringify({
				id: true,
				resource: '/get-only',
				type: 'GetRequest',
			}),
		],
		[
			'object',
			json_stringify({
				id: {},
				resource: '/get-only',
				type: 'GetRequest',
			}),
		],
		[
			'array',
			json_stringify({
				id: [1],
				resource: '/get-only',
				type: 'GetRequest',
			}),
		],
		[
			'bigint',
			json_stringify({
				id: 1n,
				resource: '/get-only',
				type: 'GetRequest',
			}),
		],
	] as const)(
		'generically rejects an invalid %s request id',
		async (_name, data) => {
			const get = vi.fn(() => ({ handler: 'ok' }));
			const log = createServerLogger();
			const server = initServer(
				{ '/get-only': { get } },
				getOnlyResources,
				{ serverLogger: log.logger },
			);
			const first = new ControlledServerSocket();
			const socket = new ControlledServerSocket();
			server.addConnection(first.asWebSocket(), 'first.test');
			server.addConnection(socket.asWebSocket(), 'invalid.test');

			await socket.receive(data);
			const reject = { error: 'invalid request id', type: 'Reject' };
			expect(socket.sentFrames()).toEqual([reject]);
			expect(socket.sentFrames()[0]).not.toHaveProperty('request');
			expect(log.sentReject.mock.calls[0]?.slice(0, 4)).toEqual([
				undefined,
				reject,
				1,
				'invalid.test',
			]);
			expect(log.receivedRequest).not.toHaveBeenCalled();
			expect(log.sentResponse).not.toHaveBeenCalled();
			expect(get).not.toHaveBeenCalled();
			expect(first.sent).toEqual([]);
		},
	);

	it.each([1, Number.MAX_SAFE_INTEGER])(
		'accepts the positive safe-integer request id %s',
		async (id) => {
			const get = vi.fn(() => ({ handler: 'ok' }));
			const server = initServer(
				{ '/get-only': { get } },
				getOnlyResources,
			);
			const socket = new ControlledServerSocket();
			server.addConnection(socket.asWebSocket());
			await socket.receive(
				json_stringify({
					id,
					resource: '/get-only',
					type: 'GetRequest',
				}),
			);
			expect(get).toHaveBeenCalledOnce();
			expect(socket.sentFrames()).toEqual([
				{
					data: { wire: 'ok' },
					id,
					resource: '/get-only',
					type: 'GetResponse',
				},
			]);
		},
	);

	it.each([
		['missing resource', { id: 1, type: 'GetRequest' }],
		[
			'unknown resource',
			{ id: 1, resource: '/missing', type: 'GetRequest' },
		],
		[
			'invalid operation',
			{ id: 1, resource: '/get-only', type: 'OtherRequest' },
		],
		[
			'unsupported operation',
			{ id: 1, resource: '/get-only', type: 'SetRequest' },
		],
		[
			'missing params',
			{
				id: 1,
				request: 'x',
				resource: '/items/:teamId/posts/:postId',
				type: 'GetRequest',
			},
		],
		[
			'extra params',
			{
				id: 1,
				params: { extra: 3, postId: 2, teamId: 1 },
				request: 'x',
				resource: '/items/:teamId/posts/:postId',
				type: 'GetRequest',
			},
		],
		[
			'wrong param names',
			{
				id: 1,
				params: { item: 2, team: 1 },
				request: 'x',
				resource: '/items/:teamId/posts/:postId',
				type: 'GetRequest',
			},
		],
		[
			'invalid param value',
			{
				id: 1,
				params: { postId: true, teamId: 1 },
				request: 'x',
				resource: '/items/:teamId/posts/:postId',
				type: 'GetRequest',
			},
		],
		[
			'invalid request schema value',
			{
				id: 1,
				params: { postId: 2, teamId: 1 },
				request: false,
				resource: '/items/:teamId/posts/:postId',
				type: 'GetRequest',
			},
		],
	] as const)('request-rejects %s', async (_name, request) => {
		const get = vi.fn(() => ({ handler: 'ok' }));
		const server = initServer(
			{
				'/get-only': { get },
				'/items/:teamId/posts/:postId': { get, set: get },
			} as unknown as Router<Resources>,
			resources,
			{ serverLogger: createServerLogger().logger },
		);
		const socket = new ControlledServerSocket();
		server.addConnection(socket.asWebSocket());
		await socket.receive(json_stringify(request));
		expect(socket.sentFrames()).toEqual([
			expect.objectContaining({ request, type: 'RequestReject' }),
		]);
		expect(get).not.toHaveBeenCalled();
		expect(
			socket
				.sentFrames<{ type: string }>()
				.some(
					({ type }) =>
						type === 'GetResponse' || type === 'SetSuccess',
				),
		).toBe(false);
	});

	it('does not invoke a router method excluded by the resource contract', async () => {
		const set = vi.fn(() => ({ handler: 'unexpected' }));
		const server = initServer(
			{ '/get-only': { set } } as unknown as Router<GetOnlyResources>,
			getOnlyResources,
			{ serverLogger: createServerLogger().logger },
		);
		const socket = new ControlledServerSocket();
		server.addConnection(socket.asWebSocket());

		await socket.receive(
			json_stringify({
				id: 1,
				resource: '/get-only',
				type: 'SetRequest',
			}),
		);
		expect(set).not.toHaveBeenCalled();
		expect(socket.sentFrames()).toEqual([
			expect.objectContaining({ error: '500', type: 'RequestReject' }),
		]);
	});

	it('contains schema throws, handler failures, and invalid responses', async () => {
		const throwingRequest = schema<unknown, unknown>(() => {
			throw new Error('request validation failed');
		});
		const invalidResponse = schema<unknown, unknown>(() => ({
			issues: [{ message: 'bad response' }],
		}));
		const cases = [
			{
				handler: () => ({ handler: 'unused' }),
				request: throwingRequest,
				response: responseSchema,
			},
			{
				handler: () => {
					throw new Error('handler failed');
				},
				request: requestSchema,
				response: responseSchema,
			},
			{
				handler: async () => Promise.reject(new Error('async failed')),
				request: requestSchema,
				response: responseSchema,
			},
			{
				handler: () => ({ handler: 'bad' }),
				request: requestSchema,
				response: invalidResponse,
			},
		];
		for (const [index, testCase] of cases.entries()) {
			const path = `/failure-${index}`;
			const testResources = {
				[path]: {
					request: testCase.request,
					response: testCase.response,
					type: 'get',
				},
			} satisfies AnyResources;
			const log = createServerLogger();
			const server = initServer(
				{ [path]: { get: testCase.handler } } as never,
				testResources,
				{ serverLogger: log.logger },
			);
			const socket = new ControlledServerSocket();
			server.addConnection(socket.asWebSocket());
			await socket.receive(
				json_stringify({
					id: 1,
					request: 'x',
					resource: path,
					type: 'GetRequest',
				}),
			);
			expect(socket.sentFrames()).toEqual([
				expect.objectContaining({ type: 'RequestReject' }),
			]);
			expect(socket.sentFrames()).toHaveLength(1);
		}
	});

	it.each([
		() => Promise.resolve({ value: 'later' }),
		() => Promise.reject(new Error('later')),
	])(
		'rejects asynchronous validation and diagnoses its result',
		async (createValidation) => {
			const asyncSchema = schema<unknown, string>(
				() =>
					createValidation() as Promise<
						StandardSchemaV1.Result<string>
					> as never,
			);
			const testResources = {
				'/async': {
					request: asyncSchema,
					response: responseSchema,
					type: 'get',
				},
			} as const satisfies AnyResources;
			const log = createServerLogger();
			const server = initServer(
				{ '/async': { get: () => ({ handler: 'never' }) } },
				testResources,
				{ serverLogger: log.logger },
			);
			const socket = new ControlledServerSocket();
			server.addConnection(socket.asWebSocket());
			await socket.receive(
				json_stringify({
					id: 1,
					request: 'x',
					resource: '/async',
					type: 'GetRequest',
				}),
			);
			await Promise.resolve();
			expect(socket.sentFrames()).toEqual([
				expect.objectContaining({ type: 'RequestReject' }),
			]);
			expect(log.asyncValidationResult).toHaveBeenCalledOnce();
		},
	);

	it('supports a logger with only selected optional methods', async () => {
		const consoleError = vi
			.spyOn(console, 'error')
			.mockImplementation(() => {});
		const sentReject = vi.fn();
		const server = initServer(
			{ '/get-only': { get: () => ({ handler: 'ok' }) } },
			getOnlyResources,
			{ serverLogger: { sentReject } },
		);
		const socket = new ControlledServerSocket();
		server.addConnection(socket.asWebSocket());
		await expect(socket.receive('{')).resolves.toBeUndefined();
		expect(sentReject).toHaveBeenCalledOnce();
		expect(consoleError).toHaveBeenCalledOnce();
	});
});
