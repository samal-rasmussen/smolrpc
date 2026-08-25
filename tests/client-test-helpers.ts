import { expect, vi } from 'vitest';

import type {
	ClientTransportState,
	ClientWebSocketEvents,
	SmolRpcErrorCode,
} from '../index.js';
import { initClient } from '../index.js';
import {
	type ControlledSocketPlan,
	ControlledWebSocket,
	ControlledWebSocketFactory,
} from './controlled-websocket.ts';
import type { Resources } from './resources.ts';

export type Frame = {
	data?: unknown;
	error?: string;
	id: number;
	params?: Record<string, string | number> | null;
	request?: unknown;
	resource: string;
	subscriptionId?: number;
	type: string;
};

export function createClient(plans: ControlledSocketPlan[] = []) {
	const factory = new ControlledWebSocketFactory();
	for (const plan of plans) factory.enqueue(plan);
	const states: ClientTransportState[] = [];
	const events = {
		close: vi.fn(),
		error: vi.fn(),
		message: vi.fn(),
		open: vi.fn(),
		reconnect: vi.fn(),
		send: vi.fn(),
		statechange: vi.fn((state: ClientTransportState) => {
			states.push(state);
		}),
	} satisfies ClientWebSocketEvents;
	const reportInternalError = vi.fn();
	const result = initClient<Resources>({
		createWebSocket: factory.createWebSocket,
		reportInternalError,
		url: 'ws://smolrpc.test',
		webSocketEvents: events,
	});
	return { ...result, events, factory, reportInternalError, states };
}

export function createOpenClient() {
	const setup = createClient();
	const socket = setup.factory.latest;
	socket.open();
	return { ...setup, socket };
}

export function frames(socket: ControlledWebSocket) {
	return socket.sentFrames<Frame>();
}

export function errorCode(code: SmolRpcErrorCode) {
	return expect.objectContaining({ code });
}

export function circularValue() {
	const value: Record<string, unknown> = {};
	value.self = value;
	return value;
}
