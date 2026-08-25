import type { StandardSchemaV1 } from '@standard-schema/spec';
import { vi } from 'vitest';

import type { ServerLogger } from '../index.js';
import { json_parse } from '../index.js';
import type { Data, WS } from '../src/websocket.types.ts';

type EventType = 'close' | 'error' | 'message';
type Listener = (event: Record<string, unknown>) => unknown;

export function createTestSchema<Input, Output>(
	validate: (value: unknown) => StandardSchemaV1.Result<Output>,
): StandardSchemaV1<Input, Output> {
	return {
		'~standard': {
			types: undefined as unknown as { input: Input; output: Output },
			validate,
			vendor: 'smolrpc-test',
			version: 1,
		},
	};
}

export class ControlledServerSocket {
	readonly sent: string[] = [];
	private readonly listeners = new Map<EventType, Listener[]>();

	addEventListener(type: EventType, listener: Listener) {
		const listeners = this.listeners.get(type) ?? [];
		listeners.push(listener);
		this.listeners.set(type, listeners);
	}

	send(data: Data) {
		if (typeof data !== 'string') {
			throw new Error('server sent non-string WebSocket data');
		}
		this.sent.push(data);
	}

	async receive(data: Data) {
		const event = { data, target: this, type: 'message' };
		await Promise.all(
			(this.listeners.get('message') ?? []).map((listener) =>
				listener(event),
			),
		);
	}

	close() {
		const event = {
			code: 1000,
			reason: '',
			target: this,
			type: 'close',
			wasClean: true,
		};
		for (const listener of [...(this.listeners.get('close') ?? [])]) {
			listener(event);
		}
	}

	error(error: unknown = new Error('controlled socket error')) {
		const event = {
			error,
			message: 'controlled socket error',
			target: this,
			type: 'error',
		};
		for (const listener of [...(this.listeners.get('error') ?? [])]) {
			listener(event);
		}
		return event;
	}

	sentFrames<T = Record<string, unknown>>() {
		return this.sent.map((frame) => json_parse(frame) as T);
	}

	asWebSocket() {
		return this as unknown as WS;
	}
}

export function createServerLogger() {
	const receivedRequest = vi.fn();
	const sentResponse = vi.fn();
	const sentEvent = vi.fn();
	const sentReject = vi.fn();
	const error = vi.fn();
	const asyncValidationResult = vi.fn();
	const logger = {
		asyncValidationResult,
		error,
		receivedRequest,
		sentEvent,
		sentReject,
		sentResponse,
	} satisfies ServerLogger;
	return {
		asyncValidationResult,
		error,
		logger,
		receivedRequest,
		sentEvent,
		sentReject,
		sentResponse,
	};
}
