import { execFileSync } from 'node:child_process';
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

type PackResult = Array<{
	files: Array<{ path: string }>;
}>;

describe('published package contract', () => {
	it('supports clean runtime and type-only package-root imports', () => {
		const directory = mkdtempSync(join(tmpdir(), 'smolrpc-types-'));
		try {
			const nodeModules = join(directory, 'node_modules');
			mkdirSync(nodeModules);
			symlinkSync(
				process.cwd(),
				join(nodeModules, 'smolrpc'),
				process.platform === 'win32' ? 'junction' : 'dir',
			);
			writeFileSync(
				join(directory, 'consumer.mts'),
				`import { SmolRpcError } from 'smolrpc';
import type {
	ClientMethods,
	ClientTransportState,
	ClientWebSocketEvents,
	SmolRpcErrorCode,
	SmolRpcErrorMetadata,
} from 'smolrpc';

declare const methods: ClientMethods;
const code: SmolRpcErrorCode = 'SMOLRPC_UNAVAILABLE';
const metadata: SmolRpcErrorMetadata = { operation: 'get' };
const state: ClientTransportState = 'connecting';
const events: ClientWebSocketEvents = { statechange: (_next) => {} };
new SmolRpcError(code, state, metadata);
methods.close();
methods.open();
methods.restart();
methods.invalidate();
void events;
`,
			);
			writeFileSync(
				join(directory, 'tsconfig.json'),
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

			expect(() =>
				execFileSync(
					resolve('node_modules/.bin/tsc'),
					['--project', join(directory, 'tsconfig.json')],
					{ encoding: 'utf8', stdio: 'pipe' },
				),
			).not.toThrow();
		} finally {
			rmSync(directory, { force: true, recursive: true });
		}
	});

	it('includes runtime and declarations while excluding repository tests and plans', () => {
		const output = execFileSync(
			'npm',
			['pack', '--dry-run', '--json', '--ignore-scripts'],
			{
				cwd: process.cwd(),
				encoding: 'utf8',
			},
		);
		const [pack] = JSON.parse(output) as PackResult;
		if (pack == null) throw new Error('npm pack returned no package');
		const paths = pack.files.map((file) => file.path);

		expect(paths).toEqual(
			expect.arrayContaining([
				'index.js',
				'src/init-client.js',
				'src/init-client-websocket.js',
				'types/index.d.ts',
			]),
		);
		expect(
			paths.filter(
				(path) =>
					path === 'tests' ||
					path.startsWith('tests/') ||
					path === 'plans' ||
					path.startsWith('plans/') ||
					path === 'src/tests' ||
					path.startsWith('src/tests/'),
			),
		).toEqual([]);
	});
});
