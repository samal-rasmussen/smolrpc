import { describe, expect, it, vi } from 'vitest';

import { json_parse, json_stringify } from '../index.js';
import { createClient, frames } from './client-test-helpers.ts';

describe('BigInt JSON codec', () => {
	it('round-trips top-level, nested, array, signed, and mixed values', () => {
		const values = {
			array: [0n, 1n, -1n, { deep: 99n }],
			boolean: true,
			nested: { value: -9007199254740993n },
			null: null,
			number: 42,
			positive: 9007199254740993n,
			string: 'ordinary JSON',
			zero: 0n,
		};

		expect(json_parse(json_stringify(values))).toEqual(values);
		expect(json_parse(json_stringify(12n))).toBe(12n);
		expect(json_stringify({ value: 1n }, 2)).toContain(
			'\n  "value": {\n    "__type": "bigint",',
		);
	});

	it('characterizes marker-shaped objects and malformed marker values', () => {
		expect(json_parse('{"__type":"bigint","__value":"123"}')).toBe(123n);
		expect(() =>
			json_parse('{"__type":"bigint","__value":"not-an-integer"}'),
		).toThrow();
		expect(json_parse('{"__type":"other","__value":"123"}')).toEqual({
			__type: 'other',
			__value: '123',
		});
	});

	it('uses the production codec for client requests, responses, and events', async () => {
		const setup = createClient();
		const socket = setup.factory.latest;
		socket.open();

		const get = (setup.client['/counter'] as any).get({ request: 10n });
		const getRequest = frames(socket).at(-1);
		if (getRequest == null) {
			throw new Error('missing GET request');
		}
		expect(getRequest.request).toBe(10n);
		socket.message({
			data: -11n,
			id: getRequest.id,
			resource: getRequest.resource,
			type: 'GetResponse',
		});
		await expect(get).resolves.toBe(-11n);

		const set = (setup.client['/counter/set'] as any).set({ request: 12n });
		const setRequest = frames(socket).at(-1);
		if (setRequest == null) {
			throw new Error('missing SET request');
		}
		expect(setRequest.request).toBe(12n);
		socket.message({
			data: 13n,
			id: setRequest.id,
			resource: setRequest.resource,
			type: 'SetSuccess',
		});
		await expect(set).resolves.toBe(13n);

		const next = vi.fn();
		const subscription = (setup.client['/counter'] as any).subscribe({
			cache: false,
			request: 14n,
		});
		subscription.subscribe({ next });
		const subscribeRequest = frames(socket).at(-1);
		if (subscribeRequest == null) {
			throw new Error('missing subscribe request');
		}
		expect(subscribeRequest.request).toBe(14n);
		socket.message({
			data: 15n,
			id: subscribeRequest.id,
			resource: subscribeRequest.resource,
			type: 'SubscribeEvent',
		});
		expect(next).toHaveBeenCalledWith(15n);
	});
});
