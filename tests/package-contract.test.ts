import { execFileSync } from 'node:child_process';
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

type PackResult = Array<{
	filename: string;
	files: Array<{ path: string }>;
}>;

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

function npmCliPath() {
	const candidates = [
		process.env.npm_execpath,
		resolve(
			dirname(process.execPath),
			'../lib/node_modules/npm/bin/npm-cli.js',
		),
		resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
	].filter((candidate): candidate is string => candidate != null);
	const cli = candidates.find(existsSync);
	if (cli == null) {
		throw new Error('Unable to locate the npm CLI');
	}
	return cli;
}

function runNpm(args: string[], cwd: string) {
	return execFileSync(process.execPath, [npmCliPath(), ...args], {
		cwd,
		encoding: 'utf8',
		stdio: 'pipe',
	});
}

function packedFileUrl(directory: string, pack: PackResult[number]) {
	return pathToFileURL(join(directory, pack.filename)).href;
}

const expectedPackagePaths = [
	'authentication.md',
	'index.js',
	'package.json',
	'readme.md',
	'src/client-errors.js',
	'src/client.types.ts',
	'src/init-client-proxy.js',
	'src/init-client-websocket.js',
	'src/init-client.js',
	'src/init-server.js',
	'src/message.types.ts',
	'src/safe-invoke.js',
	'src/server.types.ts',
	'src/shared.js',
	'src/types.ts',
	'src/websocket.types.ts',
	'types/index.d.ts',
	'types/index.d.ts.map',
].sort();

describe('published package contract', () => {
	it('installs, executes, and type-checks the exact packed artifact', () => {
		const temporaryRoot = mkdtempSync(
			join(tmpdir(), 'smolrpc-package-contract-'),
		);
		try {
			const [smolrpcPack] = JSON.parse(
				runNpm(
					[
						'pack',
						'--json',
						'--ignore-scripts',
						'--pack-destination',
						temporaryRoot,
					],
					repositoryRoot,
				),
			) as PackResult;
			if (smolrpcPack == null) {
				throw new Error('npm pack returned no package');
			}
			expect(smolrpcPack.files.map(({ path }) => path).sort()).toEqual(
				expectedPackagePaths,
			);

			const standardSchemaPath = resolve(
				repositoryRoot,
				'node_modules/@standard-schema/spec',
			);
			const [standardSchemaPack] = JSON.parse(
				runNpm(
					[
						'pack',
						standardSchemaPath,
						'--json',
						'--ignore-scripts',
						'--pack-destination',
						temporaryRoot,
					],
					repositoryRoot,
				),
			) as PackResult;
			if (standardSchemaPack == null) {
				throw new Error('npm pack returned no Standard Schema package');
			}

			const consumerDirectory = join(temporaryRoot, 'consumer');
			mkdirSync(consumerDirectory);
			writeFileSync(
				join(consumerDirectory, 'package.json'),
				JSON.stringify({
					dependencies: {
						'@standard-schema/spec': packedFileUrl(
							temporaryRoot,
							standardSchemaPack,
						),
						smolrpc: packedFileUrl(temporaryRoot, smolrpcPack),
					},
					private: true,
					type: 'module',
				}),
			);
			runNpm(
				[
					'install',
					'--offline',
					'--ignore-scripts',
					'--no-audit',
					'--no-fund',
					'--no-package-lock',
				],
				consumerDirectory,
			);

			for (const packageName of ['smolrpc', '@standard-schema/spec']) {
				expect(
					lstatSync(
						join(consumerDirectory, 'node_modules', packageName),
					).isSymbolicLink(),
				).toBe(false);
			}

			const runtimeConsumer = join(consumerDirectory, 'consumer.mjs');
			writeFileSync(
				runtimeConsumer,
				`import assert from 'node:assert/strict';
import * as smolrpc from 'smolrpc';
assert.deepEqual(Object.keys(smolrpc).sort(), [
  'SmolRpcError', 'dummyClient', 'initClient', 'initServer', 'json_parse', 'json_stringify'
]);
const error = new smolrpc.SmolRpcError('SMOLRPC_UNAVAILABLE', 'offline', { operation: 'get' });
assert.equal(error.name, 'SmolRpcError');
assert.equal(error.code, 'SMOLRPC_UNAVAILABLE');
assert.deepEqual(error.metadata, { operation: 'get' });
const value = { nested: [0n, 1n, -2n] };
assert.deepEqual(smolrpc.json_parse(smolrpc.json_stringify(value)), value);
const resource = smolrpc.dummyClient()['/anything'];
assert.deepEqual(Object.keys(resource).sort(), ['get', 'set', 'subscribe']);
assert.ok(resource.get() instanceof Promise);
assert.ok(resource.set({ request: 1 }) instanceof Promise);
const handle = resource.subscribe().subscribe({ next() {} });
handle.unsubscribe();
`,
			);
			execFileSync(process.execPath, [runtimeConsumer], {
				cwd: consumerDirectory,
				stdio: 'pipe',
			});

			writeFileSync(
				join(consumerDirectory, 'consumer.mts'),
				`import type { StandardSchemaV1 } from '@standard-schema/spec';
import { initServer, SmolRpcError } from 'smolrpc';
import type {
  AnyResources, Client, ClientMethods, ClientTransportState,
  ClientWebSocketEvents, ResourceParams, Response, Result, Router,
  ServerLogger, SmolRpcErrorCode, SmolRpcErrorMetadata, Subscribable,
  SubscribeEvent,
} from 'smolrpc';
const request = null as unknown as StandardSchemaV1<string, number>;
const response = null as unknown as StandardSchemaV1<boolean, number>;
const resources = {
  '/get': { response, type: 'get' },
  '/set': { request, response, type: 'set' },
  '/sub': { response, type: 'subscribe' },
  '/get-set': { request, response, type: 'get|set' },
  '/get-sub': { request, response, type: 'get|subscribe' },
  '/set-sub': { request, response, type: 'set|subscribe' },
  '/all/:teamId/items/:itemId': { request, response, type: 'get|set|subscribe' },
} as const satisfies AnyResources;
type Resources = typeof resources;
declare const inputStream: Subscribable<boolean>;
const router = {
  '/get': { get: () => true },
  '/set': { set: ({ request }) => request > 0 },
  '/sub': { subscribe: () => inputStream },
  '/get-set': { get: ({ request }) => request > 0, set: ({ request }) => request > 0 },
  '/get-sub': { get: ({ request }) => request > 0, subscribe: () => inputStream },
  '/set-sub': { set: ({ request }) => request > 0, subscribe: () => inputStream },
  '/all/:teamId/items/:itemId': {
    get: ({ request }) => request > 0,
    set: ({ request }) => request > 0,
    subscribe: () => inputStream,
  },
} satisfies Router<Resources>;
initServer(router, resources);
declare const client: Client<Resources>;
const output: Promise<number> = client['/set'].set({ request: '1' });
const stream: Subscribable<number> = client['/all/:teamId/items/:itemId'].subscribe({
  params: { teamId: 'one', itemId: 2 }, request: '2'
});
// @ts-expect-error unsupported method
client['/get'].set({ request: '1' });
// @ts-expect-error wrong request input
client['/set'].set({ request: 1 });
// @ts-expect-error missing parameter
client['/all/:teamId/items/:itemId'].get({ params: { teamId: 1 }, request: '1' });
// @ts-expect-error extra parameter
client['/all/:teamId/items/:itemId'].get({ params: { teamId: 1, itemId: 2, extra: 3 }, request: '1' });
declare const methods: ClientMethods;
methods.close(); methods.open(); methods.restart(); methods.invalidate();
const state: ClientTransportState = 'backoff';
const events: ClientWebSocketEvents = { statechange(next) { const current: ClientTransportState = next; void current; } };
const params: ResourceParams<'/all/:teamId/items/:itemId'> = { teamId: 1, itemId: '2' };
const result: Result<Resources, '/get'> = true;
declare const protocolResponse: Response<Resources>;
declare const protocolEvent: SubscribeEvent<Resources>;
const code: SmolRpcErrorCode = 'SMOLRPC_TIMEOUT';
const metadata: SmolRpcErrorMetadata = { operation: 'get' };
new SmolRpcError(code, state, metadata);
declare const logger: ServerLogger;
void output; void stream; void events; void params; void result;
void protocolResponse; void protocolEvent; void logger;
`,
			);
			writeFileSync(
				join(consumerDirectory, 'tsconfig.json'),
				JSON.stringify({
					compilerOptions: {
						lib: ['ES2022', 'DOM'],
						module: 'NodeNext',
						moduleResolution: 'NodeNext',
						noEmit: true,
						skipLibCheck: false,
						strict: true,
						types: [],
					},
					files: ['consumer.mts'],
				}),
			);
			const typescriptEntry = require.resolve('typescript');
			const typescriptCli = join(dirname(typescriptEntry), 'tsc.js');
			execFileSync(
				process.execPath,
				[
					typescriptCli,
					'--project',
					join(consumerDirectory, 'tsconfig.json'),
				],
				{ cwd: consumerDirectory, stdio: 'pipe' },
			);

			const declarations = readFileSync(
				join(
					consumerDirectory,
					'node_modules',
					'smolrpc',
					'types',
					'index.d.ts',
				),
				'utf8',
			)
				.replace(/\s+/g, ' ')
				.replace(/ \* /g, ' ');
			expect(declarations).toContain(
				'Stops automatic connection management, retires current work, and cancels any in-progress connection attempt or reconnect timer.',
			);
			expect(declarations).toContain(
				'Starts connection management only when stopped, resets backoff, and makes an immediate connection attempt.',
			);
			expect(declarations).toContain(
				'It is a no-op while stopped and differs from `close(); open()`',
			);
			expect(declarations).toContain(
				'normal delayed reconnect backoff without resetting its history',
			);
			expect(declarations).toContain(
				'Logical transport state, reported independently of raw WebSocket events.',
			);
			expect(declarations).toContain(
				'Reports logical transport state independently of raw WebSocket events.',
			);
		} finally {
			rmSync(temporaryRoot, { force: true, recursive: true });
		}
	});
});
