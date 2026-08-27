import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SmolRpcError } from '../index.js';
import { getResourceWithParams } from '../src/shared.js';
import { createClient, errorCode, frames } from './client-test-helpers.ts';

beforeEach(() => {
	vi.useFakeTimers();
	vi.spyOn(Math, 'random').mockReturnValue(0.5);
});

afterEach(() => {
	vi.clearAllTimers();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe('client protocol frames and metadata', () => {
	it('materializes placeholders from the original path exactly once', () => {
		expect(
			getResourceWithParams('/teams/:teamId/items/:itemId', {
				itemId: 42,
				teamId: ':itemId',
			}),
		).toBe('/teams/:itemId/items/42');
	});

	it('transmits string and numeric multi-parameters on every operation', async () => {
		const setup = createClient();
		const socket = setup.factory.latest;
		socket.open();
		const path = '/teams/:teamId/items/:itemId' as const;
		const params = { itemId: 42, teamId: 'acme' };

		const get = setup.client[path].get({ params, request: 1 });
		const getRequest = frames(socket).at(-1);
		if (getRequest == null) {
			throw new Error('missing GET request');
		}
		expect(getRequest).toMatchObject({
			params,
			request: 1,
			resource: path,
			type: 'GetRequest',
		});
		socket.message({
			data: 1,
			id: getRequest.id,
			resource: path,
			type: 'GetResponse',
		});
		await expect(get).resolves.toBe(1);

		const set = setup.client[path].set({
			params: { itemId: 'item', teamId: 7 },
			request: 2,
		});
		const setRequest = frames(socket).at(-1);
		if (setRequest == null) {
			throw new Error('missing SET request');
		}
		expect(setRequest).toMatchObject({
			params: { itemId: 'item', teamId: 7 },
			request: 2,
			resource: path,
			type: 'SetRequest',
		});
		socket.message({
			data: 2,
			id: setRequest.id,
			resource: path,
			type: 'SetSuccess',
		});
		await expect(set).resolves.toBe(2);

		const subscription = setup.client[path].subscribe({
			params,
			request: 3,
		});
		subscription.subscribe({ next: vi.fn() });
		expect(frames(socket).at(-1)).toMatchObject({
			params,
			request: 3,
			resource: path,
			type: 'SubscribeRequest',
		});
	});

	it('keeps materialized subscription cache keys independent', () => {
		const setup = createClient();
		const socket = setup.factory.latest;
		socket.open();
		const path = '/teams/:teamId/items/:itemId' as const;
		const firstArgs = {
			params: { itemId: 1, teamId: 'a' },
			request: 1,
		};
		const secondArgs = {
			params: { itemId: 1, teamId: 'b' },
			request: 1,
		};
		const first = setup.client[path].subscribe(firstArgs);
		const firstAgain = setup.client[path].subscribe(firstArgs);
		const second = setup.client[path].subscribe(secondArgs);
		expect(firstAgain).toBe(first);
		expect(second).not.toBe(first);

		const firstHandle = first.subscribe({ next: vi.fn() });
		second.subscribe({ next: vi.fn() });
		expect(
			frames(socket).filter(({ type }) => type === 'SubscribeRequest'),
		).toHaveLength(2);
		firstHandle.unsubscribe();
		expect(
			frames(socket).filter(({ type }) => type === 'UnsubscribeRequest'),
		).toHaveLength(1);
		expect(setup.client[path].subscribe(secondArgs)).toBe(second);
		const freshFirst = setup.client[path].subscribe(firstArgs);
		expect(freshFirst).not.toBe(first);
		const freshHandle = freshFirst.subscribe({ next: vi.fn() });
		expect(
			frames(socket).filter(({ type }) => type === 'SubscribeRequest'),
		).toHaveLength(3);

		// A woken idle handle is re-cached, so a fresh lookup shares its wire subscription.
		freshHandle.unsubscribe();
		freshFirst.subscribe({ next: vi.fn() });
		expect(setup.client[path].subscribe(firstArgs)).toBe(freshFirst);
		expect(
			frames(socket).filter(({ type }) => type === 'SubscribeRequest'),
		).toHaveLength(4);
	});

	it('restricts public errors and diagnostics to sanitised metadata', async () => {
		const sentinel = {
			cookie: 'session=secret',
			credentials: 'secret',
			params: { account: 'private' },
			payload: 'private',
			rawFrame: 'private',
		};
		const setup = createClient();
		const socket = setup.factory.latest;
		socket.open();
		const result = (setup.client['/counter/set'] as any).set({
			request: sentinel,
		});
		const request = frames(socket).at(-1);
		if (request == null) {
			throw new Error('missing request');
		}
		socket.message({
			id: request.id,
			resource: request.resource,
			type: 'UnexpectedResponse',
			...sentinel,
		});
		const error = await result.catch((caught: SmolRpcError) => caught);
		expect(error).toEqual(errorCode('SMOLRPC_MUTATION_OUTCOME_UNKNOWN'));
		expect(Object.keys(error.metadata ?? {}).sort()).toEqual([
			'elapsedMs',
			'generation',
			'operation',
			'readyState',
			'requestId',
			'resource',
		]);
		expect(JSON.stringify(error.metadata)).not.toContain('secret');
		expect(JSON.stringify(error.metadata)).not.toContain('private');

		socket.message(JSON.stringify({ ...sentinel, type: 'Unknown' }));
		const [, diagnosticMetadata] =
			setup.reportInternalError.mock.calls.at(-1) ?? [];
		expect(Object.keys(diagnosticMetadata ?? {}).sort()).toEqual([
			'generation',
		]);
		expect(JSON.stringify(diagnosticMetadata)).not.toContain('secret');
		expect(JSON.stringify(diagnosticMetadata)).not.toContain('private');
	});
});
