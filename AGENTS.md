# Coding Agent Documentation

This file is the always-loaded project overview for coding agents working on **smolrpc**. Keep it high-level: it should orient work, state project-wide invariants, and point to skills for detailed playbooks.

# 1. Product context

-   **smolrpc** is a small, ESM-only library for type-safe RPC over WebSockets. It is an npm library, not a hosted service.
-   Applications define one resource contract with TypeScript path literals and Standard Schema-compatible request/response schemas. That contract derives the client API and server router types.
-   Resources support `get`, `set`, and `subscribe` operations and their supported combinations. Colon-prefixed path segments, such as `/posts/:postId`, become typed parameters.
-   The runtime client exposes a resource-shaped API through a JavaScript `Proxy`. The client contract is enforced at compile time; runtime request and response validation happens on the server.
-   Consumers bring their own Standard Schema implementation (for example, Zod) and, in runtimes without a global `WebSocket`, their own WebSocket constructor.
-   Authentication, application health policy, retry policy, and reconstruction of application state after reconnect are application concerns. See `authentication.md` and `readme.md` before changing lifecycle behavior.

# 2. Repository map

-   `index.js` is the public runtime facade. `index.d.ts` is the declaration-source facade used by the type build.
-   `src/` contains the shipped implementation and source types:
    -   `init-client.js` wires together client lifecycle, transport, hooks, and the dynamic proxy.
    -   `init-client-websocket.js` owns connection attempts, generations, logical state, retirement, sending, and reconnect backoff.
    -   `init-client-proxy.js` implements GET, SET, subscription, and unsubscribe operation records.
    -   `init-server.js` validates and dispatches requests and manages server-side subscriptions.
    -   `client-errors.js`, `safe-invoke.js`, and `shared.js` contain stable client errors, callback isolation, path handling, and the BigInt-aware JSON codec.
    -   `*.types.ts` and `types.ts` define the public API, router, protocol, resource, and WebSocket types.
-   `types/` contains generated declarations published to npm. Change declaration sources instead of hand-editing generated output, then run `npm run build`.
-   `tests/` contains Vitest client behavior/correctness/lifecycle suites, a deterministic WebSocket test double, and shared test resources.
-   `examples/` contains shared contracts plus Node client/server and Deno server examples. These are examples, not deployed services.
-   `readme.md` is the primary user and API guide; `authentication.md` covers cookie-authentication integration.
-   `plans/` records design analysis. Treat implemented source, tests, and current user documentation as authoritative when an older plan differs.
-   `package.json` defines the export map, publish allowlist, exact dependencies, and all supported scripts. `tsconfig.json`, `.eslintrc.cjs`, and `.prettierrc.json` define checks and formatting.

# 3. Architecture and deployment context

## Contract and public API

-   A resource map satisfying `AnyResources` is the shared contract. Conditional and mapped types derive `Client<Resources>`, `Router<Resources>`, path parameters, request values, and response values.
-   Standard Schema validation is synchronous. The server validates and uses parsed request and response values. Keep the runtime schema-library-neutral.
-   The package exposes only its root `"."` subpath and has no default export or supported deep imports. Coordinate public API changes across runtime exports, declaration-source exports, source types, tests, documentation, and generated declarations.

## Runtime flow

-   `initClient()` creates one transport runtime, the resource proxy, safe public-hook adapters, and an initial connection attempt. Each successfully constructed socket creates an immutable connection generation.
-   The proxy materializes colon parameters, serializes with `json_stringify`, registers operation dispatch before native send, and routes responses through the operation's originating generation.
-   `initServer()` does not listen on a port. It returns `addConnection()`, and the host application supplies accepted WebSocket-like connections. The server parses requests, checks the resource/router, validates schemas, invokes handlers, and sends responses, events, or rejections.
-   Cached subscriptions share one wire subscription by materialized resource and serialized request. They replay the latest value, including explicit `undefined`, and send a wire unsubscribe only after the final observer leaves.

## Transport invariants

Preserve these invariants when changing client lifecycle or operation code:

-   All callbacks, request IDs, operations, timers, SET waiters, subscription cache entries, and unsubscribe acknowledgements belong to exactly one connection generation. Stale generations and superseded attempts must not affect current state.
-   Detach transport-owned state before invoking user callbacks or settling promises/observers. Cleanup and retirement must be prompt, idempotent, and identity-based.
-   Socket factories, hooks, diagnostics, serialization, and observers are reentrancy boundaries. Revalidate generation ownership and lifecycle intent after application code runs.
-   Register a dispatchable operation before native `send()` so synchronous responses work. Roll back timers, listeners, waiters, and cache entries transactionally on serialization or send failure.
-   Never automatically replay work across generations: GET is not retried, SET never moves or replays, and subscriptions terminate and must be recreated by the application.
-   Once native `send()` accepts a SET, a timeout, retirement, or non-definitive protocol failure is `SMOLRPC_MUTATION_OUTCOME_UNKNOWN`; do not imply that retry is safe.
-   `close()`, `open()`, `restart()`, and `invalidate()` express different intent. Logical lifecycle states are separate from raw WebSocket events, and a native `error` alone does not trigger reconnection.
-   Client failures use stable `SmolRpcError.code` values. Error metadata and internal diagnostics must never include payloads, params, credentials, cookies, native events, or raw frames.
-   Isolate throwing hooks and observers so they cannot corrupt cleanup or prevent delivery to other observers.
-   Use `json_stringify` and `json_parse` for production protocol traffic so BigInt support is preserved.

## Build and publication

-   Runtime JavaScript is shipped directly; there is no bundling or JavaScript transpilation step. TypeScript strictly checks both `.js` and `.ts` sources with `noEmit`.
-   `npm run build` uses dts-buddy to regenerate `types/index.d.ts` and its source map, then formats `types/`.
-   The npm package is ESM-only and publishes `index.js`, `src/`, and `types/` to the public npm registry. `@standard-schema/spec` is the only production dependency.
-   `prepublishOnly` runs `npm run verify`. There is no repository-owned CI workflow, Docker image, hosted deployment, or server process; consuming applications own deployment.

# 4. Local development setup and scripts

## Setup

-   Use Node.js and npm from the repository root. There is no declared `engines` or `packageManager` field; the current locked toolchain effectively requires Node `^20.19.0` or `>=22.12.0`.
-   Install exact locked dependencies with `npm ci`.
-   No service, database, environment variables, browser, Docker, or open port is needed for tests. Deno is optional and only needed for the Deno example.
-   The Node examples use `localhost:9200`; start server and client scripts in separate terminals.

## Useful commands

```bash
npm test                 # Run all tests once
npm run test:watch       # Run Vitest in watch mode
npm run typecheck        # Strict-check source, tests, and Node examples
npm run lint             # Check Prettier formatting, then run ESLint
npm run build            # Regenerate and format published declarations
npm run verify           # Run the complete package/release gate
npm run format           # Rewrite the repository with Prettier
npm run nodejs-server    # Run the Node server example in watch mode
npm run nodejs-client    # Run the Node client example in watch mode
npm run deno-server      # Run the Deno server example in watch mode
```

`npm run verify` runs tests, typechecking, declaration generation, linting, `publint`, and `npm pack --dry-run`. Be aware that `npm run build` and `npm run verify` can modify tracked files in `types/`, while `npm run format` rewrites files across the repository. Watch/example scripts are long-running.

# 5. Code style and implementation rules

-   Let Prettier format code: tabs at width 4, semicolons, single quotes, and trailing commas. Do not manually align formatting against Prettier.
-   ESLint requires sorted imports/exports. Prefix intentionally unused variables, arguments, or caught errors with `_`.
-   Keep native ESM. Runtime relative imports include explicit `.js` extensions.
-   Runtime implementation is checked JavaScript with precise JSDoc (`@typedef`, `@template`, `@param`, `@returns`, and local `@type` where needed). Type-level API machinery belongs in TypeScript source files.
-   Prefer `import type` for type-only dependencies. Use `as const satisfies AnyResources` and `as const satisfies Router<Resources>` for resource/router definitions.
-   Follow existing naming: kebab-case files, camelCase functions/locals, PascalCase types/classes, and `SCREAMING_SNAKE_CASE` constants. Preserve established public snake-case names such as `json_stringify` for compatibility.
-   Prefer guard clauses and early returns. Use `== null` only when intentionally matching both `null` and `undefined`; otherwise use strict equality. Use optional chaining and nullish coalescing where they express the intended semantics.
-   Comments and JSDoc should document public contracts, ownership, ordering, cleanup, and reentrancy rationale rather than restating code.
-   Keep public operation failures in their Promise or observer channel. Reserve `reportInternalError` for non-operation diagnostics or failures with no caller-facing channel.
-   Keep runtime dependencies minimal, platform-neutral, Standard Schema-neutral, and WebSocket-constructor-injectable. Do not introduce Node-specific production coupling without an explicit API decision.
-   Generated `types/` files are build artifacts, not primary source. Any externally visible behavior or type change should include focused tests and corresponding updates to `readme.md` or `authentication.md`.
-   For lifecycle, transport, error, subscription, or protocol work, follow the invariants in section 3 and add deterministic regression coverage for stale callbacks, cleanup, reentrancy, and negative behavior as applicable.

# 6. Testing and verification

## Suite architecture

-   Vitest discovers `tests/*.test.ts` in its default Node environment; there is no custom Vitest configuration.
-   `tests/client-baseline.test.ts` covers normal GET/SET, cached and uncached subscriptions, rejection, close/open, and ordinary reconnect behavior.
-   `tests/client-correctness.test.ts` covers generation ownership, stale/reentrant callbacks, transactional operations, stable errors, protocol failures, subscription semantics, and cleanup.
-   `tests/client-lifecycle.test.ts` covers lifecycle methods and state sequences, backoff, constructor failures, callback reentrancy, and application-owned recovery/reconstruction.
-   `tests/controlled-websocket.ts` is the central deterministic fake transport. It can schedule construction/send failures, synchronous callbacks, and events delivered after close to exercise stale-generation handling.
-   `tests/resources.ts` defines the shared Zod-backed test contract. Tests use fresh clients, fake timers, and a fixed `Math.random()` when asserting timeout/backoff behavior.
-   Assert public outcomes, exact state/event ordering, serialized wire frames, stable `SmolRpcError.code` values, and important non-events. Avoid snapshots and nondeterministic timing.
-   The current suite has no dedicated server, real-WebSocket integration, browser, snapshot, or coverage suite. Do not assume those areas are covered by `npm test`.

## Running tests

```bash
npm test
npm run test:watch
npm test -- tests/client-lifecycle.test.ts
npm run test:watch -- tests/client-lifecycle.test.ts
npm test -- tests/client-correctness.test.ts -t "transactional GET and SET"
```

Use Vitest's `-t` filter for a named suite or test. Restore fake timers and mocks in cleanup so cases remain isolated.

## Verification expectations

-   During iteration, run the narrowest relevant test file or named test.
-   For behavior changes, run `npm test` and `npm run typecheck` at minimum.
-   Run `npm run lint` for all changes.
-   Run `npm run build` when declaration sources or public types change, and inspect generated `types/` changes.
-   Run `npm run verify` before release or when changing exports, package metadata, declarations, or publishing behavior.
-   The Deno example is excluded from normal TypeScript checking. `publint` and `npm pack --dry-run` are part of `npm run verify`, not `npm run lint`.

# 7. Git operations policy

Git is read-only for coding agents unless running in a cloud environment where git writes are explicitly allowed.

-   Never run git commands that write state, change history, change the index/staging area, change branches, or modify working tree files.
-   Never run destructive git commands.
-   The human user owns git write operations.

Allowed read-only examples: `git status`, `git diff`, `git log`, `git show`, `git branch --show-current`, `git rev-parse`, `git blame`.

Disallowed examples: `git add`, `git rm`, `git mv`, `git restore`, `git checkout`, `git switch`, `git commit`, `git merge`, `git rebase`, `git cherry-pick`, `git revert`, `git reset`, `git stash`, `git clean`, `git fetch`, `git pull`, `git push`, `git tag`, and `git worktree`.
