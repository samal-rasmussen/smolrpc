# Plan 43: Complete Test-Suite Hardening and Audit Remediation

Status: Implemented with compatibility-preserving amendments

Based on: `plans/plan-42.md` and the independent audit of the complete 90-test suite

Target release: Unassigned

## Implementation status

Implemented on 2026-08-24. All four specified PR scopes are complete in the working tree:

-   **PR 1 — Trustworthy client regression gate:** Completed. The swallowed hook assertion now uses record-then-assert; focused lifecycle, hook, operation, subscription, and protocol suites cover the strengthened Plan 42 cases; throwing hooks/diagnostics and observer reentrancy are isolated; shared client helpers are consolidated; and `tests/client-correctness.test.ts` was retired after focused replacements were added.
-   **PR 2 — Schema typing, codec, and parameters:** Completed. Transforming-schema boundaries use request inputs, parsed router request outputs, router response inputs, and client/protocol response outputs; `initServer()` infers the shared contract from its resources argument and rejects mismatched router/resources contracts; BigInt codec and representative protocol traffic are covered; string/numeric multi-parameters and cache separation are tested; and generated declarations were rebuilt.
-   **PR 3 — Deterministic server coverage:** Completed with a compatibility-preserving amendment. Direct server dispatch and subscription suites cover transformed GET/SET/subscribe traffic, rejection and validation paths, malformed input, operation support, exact parameter names, asynchronous-validation diagnostics, connection-local logging, unsubscribe ownership, and failure-isolated close cleanup. The implementation deliberately preserves existing valid-input behavior: numeric request IDs remain governed by the published `number` contract, decoded request objects retain request-associated rejection behavior, parameterless handlers retain `resourceWithParams`, and existing rejection wording, frame property order, handler arguments, and logger metadata are unchanged.
-   **PR 4 — Package artifact, documentation, and release gate:** Completed. The package test installs the real offline tarball without symlinks, executes it as ESM, compiles an installed declaration consumer, asserts the exact package allowlist and lifecycle TSDoc, and publishes `authentication.md`; documentation and `AGENTS.md` were updated; and verification now builds declarations before tests.

Compatibility takes precedence over the original proposal where they conflict, except for the intentional compile-time improvement that ties `initServer()`'s resources argument to its inferred router contract. That change has no runtime effect; it enables inference for matching contracts and rejects mismatched contracts.

Final verification recorded at implementation:

-   `npm run verify` passed.
-   Vitest passed **10 files and 125 tests**, with zero skipped or todo tests.
-   The five race-heavy client suites passed **77 tests in each of five independent runs** without unexpected stderr or unhandled rejections.
-   The installed tarball executed and consumer-compiled successfully.
-   The packed artifact contained exactly **18 intentional files**.
-   A standalone `npm test` did not change working-tree or generated-file status.
-   `git diff --check` and `git diff --cached --check` passed.

## Purpose

Preserve Plan 42's completed generation-safe client behavior while closing the test-assurance and public-contract gaps found by the independent audit.

The work has five goals:

1. Restore trust in the test gate by removing the false-green assertion that currently throws inside a safely invoked hook.
2. Turn every partial or incorrectly tested Plan 42 regression into an explicit behavioral proof.
3. Add direct tests for the public server, BigInt codec, parameter handling, transforming Standard Schema contracts, errors, diagnostics, hooks, observers, and packed package.
4. Correct source declarations or runtime behavior only where a focused red regression demonstrates a mismatch with the current documented contract.
5. Improve suite organization without introducing a generic test framework, real-network tests, or speculative production infrastructure.

Current audited baseline:

-   `npm run verify` exits successfully.
-   Vitest reports 7 files and 90 passing tests.
-   One assertion in `tests/client-lifecycle-hooks.test.ts` fails deterministically but is swallowed by the public hook boundary, so the suite is false-green.
-   The Plan 42 matrix audit found 37 full, 11 partial, 1 incorrectly tested, and 0 missing cases.
-   `initServer()` has no direct tests.
-   BigInt traffic, parameterized resources, transforming schemas, sanitised metadata, freshly packed runtime execution, and generated lifecycle TSDoc are not adequately protected.

Plan numbers remain planning bookkeeping. Permanent tests must continue to use behavior-focused names rather than matrix numbers.

## Relationship to Plan 42

Plan 42 remains the authoritative design and historical implementation record for generation-safe client lifecycle and operation behavior. Do not overwrite or weaken it.

Plan 43 does not redesign the client. It strengthens proof of the completed behavior and extends coverage to public package areas that Plan 42 deliberately left out of scope, especially the server and shared codec.

If a stronger test exposes a client defect, make the smallest production correction that restores the Plan 42 invariant. Do not use this plan as an opportunity to replace the generation model, lifecycle API, wire protocol, or operation semantics.

## Non-negotiable invariants

### Client invariants

Preserve all Plan 42 ownership and ordering rules:

-   Every native callback, construction attempt, reconnect token, operation, timer, SET waiter, subscription/cache record, handle, and unsubscribe acknowledgement belongs to one immutable identity owner.
-   Stale generations and superseded construction attempts are complete no-ops.
-   Transport-owned state is detached before logical `unavailable`, Promise settlement, `observer.error()`, or terminal diagnostics where the contract requires it.
-   Operations are dispatchable before native `send()` and roll back transactionally on serialization or send failure.
-   GET, SET, subscriptions, and acknowledgements never move or replay across generations.
-   An accepted SET retains mutation-outcome ambiguity after timeout, retirement, or non-definitive protocol failure.
-   Hooks, observers, diagnostics, serializers, and socket factories remain application-code and reentrancy boundaries.
-   Error and diagnostic metadata remains restricted to the documented sanitised fields.

### Server and schema invariants

Use the current documented runtime model:

-   Client request arguments and request wire values are request-schema inputs.
-   The server validates requests and passes parsed request-schema outputs to router handlers.
-   Router GET/SET return values and subscription values are response-schema inputs.
-   The server validates those values and sends response-schema outputs.
-   Client GET/SET results, subscription values, protocol responses/events, and `Result` represent response-schema outputs.
-   Standard Schema validation remains synchronous. Promise-returning validation is rejected and diagnosed.
-   Production protocol traffic uses `json_stringify` and `json_parse`.
-   The server remains transport-hosted: `initServer()` returns `addConnection()` and does not listen on a port.

### Test-quality rules

-   Never execute `expect()` inside a hook, observer, diagnostic, socket-factory callback, or other callback whose exception production intentionally catches. Record observations in the callback and assert afterward in the test body.
-   Assert identities, order, frame payloads, destinations, cleanup, and important non-events—not only counts.
-   Check timer removal before advancing past the timer's deadline when prompt cleanup is the requirement.
-   A Promise's native single-settlement behavior is not proof that production terminalized an operation once. Use late addressed frames, diagnostics, cache identity, timer ownership, and observer calls to prove cleanup.
-   Use fake timers and controlled sockets for races. Do not use real network timing.
-   Keep `sendAttempts` distinct from successful `sent` frames.
-   Do not treat `ControlledWebSocketFactory.latest` as runtime-generation authority after nested construction. Retain explicit socket identities in reentrant tests.
-   Expected throwing-hook behavior must be observed through a `console.error` spy so test output remains quiet and intentional.
-   Ordinary `npm test` must not rewrite generated or tracked files.

## Scope

### Included

-   Repair and completion of all partial/incorrect Plan 42 matrix proofs.
-   Throwing-hook, diagnostic, observer-reentrancy, exact-delivery, and sanitisation tests.
-   Complete focused server dispatch and subscription suites.
-   Transforming Standard Schema type tests and resulting declaration-source fixes.
-   BigInt codec and representative protocol tests.
-   Parameterized resource runtime and type tests.
-   Installed packed-artifact runtime and declaration tests.
-   Exact packed-file inclusion/exclusion, lifecycle TSDoc, portability, and publication of linked authentication documentation.
-   Focused suite restructuring and helper consolidation.
-   README, authentication guide where needed, and `AGENTS.md` updates.

### Out of scope

-   New lifecycle methods or a client lifecycle redesign.
-   Automatic GET retry, SET replay, or subscription reconstruction.
-   Client-side response-schema validation.
-   New protocol messages or wire-shape changes.
-   Server listening, authentication policy, health policy, retry policy, or application reconstruction policy.
-   A real-WebSocket, browser, performance, snapshot, fuzzing, or coverage-percentage suite.
-   Generic schedulers, transaction frameworks, observable libraries, or test DSLs.
-   New production dependencies unless separately approved.
-   CI, package-version, or release-channel changes unless separately requested.

## Target suite structure

The final suite should have clear ownership:

-   `tests/client-baseline.test.ts`
    -   Small package-root happy-path smoke suite.
-   `tests/client-lifecycle.test.ts`
    -   Generations, construction attempts, reconnect/backoff, lifecycle matrix, and lifecycle-root recovery.
-   `tests/client-lifecycle-hooks.test.ts`
    -   Hook ordering, hook failure isolation, hook reentrancy, detachment, and settlement boundaries.
-   `tests/client-operations.test.ts`
    -   Complete GET and SET terminal matrices.
-   `tests/client-subscriptions.test.ts`
    -   Cache semantics, observer delivery, terminalization, handles, and unsubscribe acknowledgements.
-   `tests/client-protocol.test.ts`
    -   Malformed/addressed frames, protocol error mapping, diagnostics, and metadata sanitisation.
-   `tests/server-dispatch.test.ts`
    -   Connections, GET/SET dispatch, schemas, parameters, rejection paths, and loggers.
-   `tests/server-subscriptions.test.ts`
    -   Subscribe/accept/event/unsubscribe ordering, failures, and connection cleanup.
-   `tests/shared-codec.test.ts`
    -   Direct BigInt codec behavior and representative protocol round trips.
-   `tests/public-types.test-d.ts`
    -   Compile-only transforming-schema, resource, client, router, protocol, and negative type assertions.
-   `tests/package-contract.test.ts`
    -   Real packed-artifact runtime, generated declarations, TSDoc, portability, and exact package contents.

Retire `tests/client-correctness.test.ts` only after every unique test has moved to a focused destination and the stronger replacement assertions are green. Do not delete confidence merely to reduce duplication.

Shared support should remain small:

-   Consolidate `createClient`, `Frame`, `frames`, error matchers, and common lifecycle event recording in `tests/client-test-helpers.ts`.
-   Clarify attempted, returned, and explicitly retained socket identities in `tests/controlled-websocket.ts`.
-   Use production `json_stringify`/`json_parse` in frame helpers when BigInt support is under test.
-   Add only a minimal server socket helper, locally or as `tests/server-test-helpers.ts`, supporting the `addEventListener`, `send`, close, error, and awaited-message behavior used by `initServer()`.

## Implementation sequence

Use four cohesive pull requests. Each PR must be independently reviewable and must not depend on temporary production architectures.

## PR 1: Restore a trustworthy client regression gate

### 1. Fix the swallowed lifecycle assertion first

File: `tests/client-lifecycle-hooks.test.ts`

Replace the assertion currently executed inside `statechange('unavailable')` with record-then-assert behavior:

1. Create the active subscription and accepted SET.
2. Capture native-send attempts immediately before retirement, after both requests have been attempted.
3. In the `unavailable` callback:
    - record callback entry and the current send-attempt count;
    - call the old subscription handle's `unsubscribe()`;
    - record the count afterward;
    - execute no assertion.
4. After `clientMethods.close()` returns:
    - assert both recorded counts equal the pre-retirement count;
    - assert no `UnsubscribeRequest` was attempted;
    - assert `unavailable` preceded the subscription and SET terminal deliveries;
    - assert each terminal delivery happened once;
    - assert no unexpected `console.error` was produced.

Red criterion: the test fails normally if retirement leaves the subscription attached or sends an unsubscribe.

Green criterion: it passes without any hidden assertion failure or unexpected stderr.

Audit every existing test for assertions inside intentionally caught callbacks and convert any remaining case to record-then-assert form.

### 2. Consolidate client helpers without hiding ownership

Update:

-   `tests/client-test-helpers.ts`
-   `tests/controlled-websocket.ts`
-   Existing client suites.

Required changes:

-   Use one complete `Frame` type, including `params` and all response/rejection fields used by tests.
-   Reuse one `createClient()` and frame decoder where the setup is equivalent.
-   Preserve a deliberately small baseline helper only if it materially improves the smoke suite.
-   Document `attempts`, successful constructor returns, and nested-construction ordering.
-   Rename or narrow `latest` if needed so no name implies runtime authority.
-   In nested construction tests, retain the outer and winning sockets explicitly rather than selecting by return order.
-   Continue asserting `sendAttempts` for attempted native sends and `sent` only when successful return is relevant.

### 3. Close the partial Plan 42 client proofs

Add or strengthen focused tests for the following audited cases:

#### Stale callbacks and GET cleanup

-   After delayed stale open/message/error/close callbacks, issue and complete a new operation on the replacement. Assert readiness, state, hooks, attempts, and timer counts remain unchanged by stale delivery.
-   For every GET terminal path—response, server rejection, timeout, retirement, serialization failure, and native-send failure—assert prompt timer removal before advancing time.
-   Deliver a duplicate/late addressed frame after each terminal GET path and require unknown-ID diagnostic handling, proving operation-map removal.
-   For synchronous GET retirement followed by native-send return or throw, establish a replacement and prove the deferred old completion cannot alter it.

#### Subscription cache and unavailable construction

-   For subscription rejection, protocol mismatch, serialization failure, and native-send failure, request the same default-cached subscription again. Assert different logical identity and exactly one fresh wire request.
-   After subscription construction throws while connecting, stopped, or in backoff, later establish/open a generation and prove the first cached subscription is genuinely fresh.

#### Unsubscribe acknowledgement ownership

-   Assert no acknowledgement timeout at 4,999 ms and exactly one diagnostic/cleanup at 5,000 ms.
-   Record diagnostic timing around native `send()` to prove no diagnostic or completion is delivered while send remains on-stack.
-   After stale acknowledgements, recheck diagnostic counts as well as replacement behavior.
-   Use late addressed responses and timer counts to prove immediate acknowledgement detachment.

#### Lifecycle and ordering

-   Add `open()` while already open to the lifecycle no-op matrix.
-   Give state, close, reconnect, error, and diagnostic reentry cases prepared pending work where settlement preservation is part of the requirement.
-   Prove GET, SET, and subscription detachment before `unavailable` without executing assertions in `statechange`.

Where an internal resolver invocation count is not publicly observable, prove cleanup through timer ownership, late-frame diagnostics, cache identity, wire non-events, and observer delivery rather than a tautological Promise settlement count.

### 4. Complete throwing-hook and observer boundaries

Add focused parameterized tests for:

-   Throwing `statechange`, `open`, `message`, `send`, `error`, `close`, and `reconnect` hooks.
-   Throwing `reportInternalError`.
-   One terminal observer throwing while later observers still receive the same terminal error once.
-   An observer calling `close()`, `restart()`, its own `unsubscribe()`, or another handle's `unsubscribe()` during `next`.
-   An observer adding another observer during delivery; the new observer must not receive the event already in progress.
-   A first observer changing lifecycle so later snapshot recipients do not receive stale delivery.
-   Exact once-per-observer event and terminal delivery.

Spy on `console.error` for expected safe-invocation reports. Restore the spy in cleanup and assert no unexpected output.

### 5. Restructure the client suite carefully

Move unique cases from `tests/client-correctness.test.ts` to the focused lifecycle, operations, subscriptions, or protocol suites.

Before deleting the old file:

1. Map all 27 tests to their destination or stronger replacement.
2. Run old and new suites together once.
3. Confirm no unique generation, construction, transactional-send, observer, acknowledgement, or protocol path was lost.
4. Remove the old file only after the complete suite is green.

Also:

-   Move the package-root API test out of `client-lifecycle-hooks.test.ts`.
-   Move backoff progression/capping/reset from operations to lifecycle.
-   Keep permanent names behavior-focused.

PR 1 is complete when:

-   The false-green assertion is impossible.
-   Original Plan 42 client cases #1–#46 and #49 have full explicit proofs.
-   No assertion depends on escaping an intentionally caught callback.
-   Race-heavy suites pass repeatedly without stderr, unhandled rejections, or leaked timers.
-   No client production behavior changed unless a strengthened red test required a minimal Plan 42-compatible correction.

## PR 2: Correct schema typing, codec coverage, and parameters

### 1. Add transforming Standard Schema type regressions first

File: `tests/public-types.test-d.ts`

Use a Standard Schema-compatible test schema whose input and output differ, such as string input transformed to number output.

Prove:

-   Client request arguments use request-schema input.
-   Router request arguments use parsed request-schema output.
-   GET/SET router handlers return response-schema input or a Promise of it.
-   Subscription handlers emit response-schema input.
-   Client GET/SET results and subscription values use response-schema output.
-   `GetResponse`, `SetSuccess`, `SubscribeEvent`, and `Result` use response-schema output.
-   All seven operation combinations expose exactly their supported methods.
-   Unknown paths, unsupported methods, missing/extra/wrong parameters, and incorrect requests fail with `@ts-expect-error`.
-   Router and resource arguments passed to `initServer()` describe the same `Resources` contract.

The compile-only fixture must import only from the package root or declaration-source root appropriate to the phase; the installed package consumer in PR 4 repeats the critical public-root checks against generated declarations.

### 2. Correct declaration sources from the red tests

Expected files:

-   `src/client.types.ts`
-   `src/server.types.ts`
-   `src/message.types.ts`
-   `src/types.ts`
-   `index.d.ts`

Required input/output model:

-   Client request and request wire values: `InferInput<RequestSchema>`.
-   Router request arguments after server validation: `InferOutput<RequestSchema>`.
-   Router response/subscription values before response validation: `InferInput<ResponseSchema>`.
-   Client and response/event wire values after validation: `InferOutput<ResponseSchema>`.
-   `Result`: `InferOutput<ResponseSchema>`.

Do not hand-edit `types/index.d.ts` or its map. Regenerate them with `npm run build` and review the mechanical output.

Red criterion: the transforming-schema fixture fails with the current all-`InferInput` output declarations.

Green criterion: positive and negative source-type assertions compile at each intended boundary.

### 3. Add direct BigInt codec tests

File: `tests/shared-codec.test.ts`

Cover:

-   Top-level, nested, array, zero, positive, and negative BigInts.
-   Mixed ordinary JSON and BigInt values.
-   Optional pretty-print spacing.
-   Public package-root imports of `json_stringify` and `json_parse`.
-   Representative client GET/SET request/response and subscription-event traffic using the production codec.

Preserve the existing encoded representation. Characterize marker-shaped application objects and malformed marker values according to current behavior before deciding whether any behavior change belongs in scope; do not silently redesign the codec.

### 4. Add exact parameter tests

Expand `tests/resources.ts` with at least one resource containing multiple colon-prefixed parameters and a request schema where useful.

Runtime tests must prove:

-   String and numeric parameters are transmitted.
-   Multiple parameters materialize the expected `resourceWithParams`.
-   Different materialized values have independent cached subscriptions.
-   Missing, extra, and incorrect names are rejected by the server.
-   Cleanup for one materialized/cache key cannot evict another.

Type tests must prove the same path keys and accepted string/number values.

If red tests expose mismatches, make focused corrections to:

-   `src/message.types.ts` so protocol parameter values match the public string-or-number contract.
-   `src/shared.js` so parameter materialization stringifies values explicitly and predictably.
-   `src/init-server.js` so validation compares exact placeholder names rather than only key count.

Do not add BigInt path parameters or new path syntax.

PR 2 is complete when:

-   Transforming-schema source declarations follow the documented runtime boundaries.
-   BigInt behavior is explicit through public codec and client protocol tests.
-   Parameter names, values, materialization, and cache separation are directly tested.
-   Generated declarations are rebuilt and reviewed.
-   Focused tests, typecheck, build, and lint pass.

## PR 3: Add complete deterministic server coverage

### 1. Build a minimal server socket helper

The helper must support only production server needs:

-   `addEventListener('message' | 'close' | 'error', ...)`.
-   Awaited message delivery so async handlers settle deterministically.
-   Explicit close and error delivery.
-   Exact sent-string recording and production-codec frame decoding.
-   Multiple independent socket instances.

Do not use `ws`, a network port, real timing, browser globals, or a generic event-emitter framework.

### 2. Cover successful GET and SET dispatch

File: `tests/server-dispatch.test.ts`

For synchronous and asynchronous handlers, assert exact:

-   request ID and resource;
-   parsed/transformed request value;
-   client ID and remote address;
-   `params`, `resource`, and `resourceWithParams`;
-   response-schema transformation;
-   `GetResponse` and `SetSuccess` frame destination and payload;
-   BigInt request/response values;
-   `receivedRequest` and `sentResponse` logger arguments.

Use at least two connections to prove client IDs and response destinations are connection-local.

### 3. Cover server rejection and validation paths

Add table-driven cases for:

-   Non-string WebSocket data.
-   Malformed JSON and valid non-object JSON.
-   Missing, non-finite, fractional, or otherwise unusable request IDs according to the protocol contract.
-   Missing/non-string resource.
-   Unknown router resource or resource definition.
-   Invalid operation type.
-   Operation unsupported by the selected resource/router entry.
-   Missing, extra, or incorrect parameter names.
-   Request-schema issues or throws.
-   Promise-returning validation and `asyncValidationResult` diagnostics.
-   Response-schema issues or throws.
-   Synchronous handler throws and rejected handler promises.

Required safety behavior:

-   Malformed or unaddressable input must not escape as an unhandled rejection.
-   Unaddressable failures use the generic `Reject` channel and an error/logger path.
-   Addressable request failures use `RequestReject` associated with the original request.
-   A failed request emits no later success response.
-   Logger assertions include the exact request association, client ID, remote address, and destination socket without leaking unrelated connection data.

Where existing documentation does not specify exact message wording, assert stable response type, association, and safety outcome rather than freezing incidental prose.

### 4. Cover subscription and unsubscribe behavior

File: `tests/server-subscriptions.test.ts`

Cover:

-   `SubscribeAccept` is sent before a synchronous initial event.
-   Parsed/transformed request values reach the subscribe handler.
-   Valid transformed events carry the correct request ID, resource, params, and BigInt data.
-   Invalid event values are logged and dropped while later valid events remain deliverable.
-   Subscribe handler throw and rejected Promise.
-   Successful unsubscribe invokes the correct handle once and sends `UnsubscribeAccept`.
-   Unknown subscription IDs send `RequestReject`.
-   Throwing unsubscribe callbacks are contained and produce the defined rejection/logger outcome.
-   Native connection close cleans every active subscription exactly once.
-   One throwing close-cleanup callback cannot prevent cleanup of other active subscriptions or another connection.
-   Closing or unsubscribing one connection cannot affect another connection's subscriptions.
-   `sentResponse`, `sentEvent`, `sentReject`, and `error` logger callbacks receive exact connection-local arguments.

Do not add replay, server buffering, terminal protocol events, or another subscription registry.

### 5. Make only test-demonstrated server corrections

Expected production file: `src/init-server.js`.

Potential focused corrections include:

-   Catching malformed JSON at the message boundary.
-   Rejecting unusable request IDs and non-object requests safely.
-   Validating exact parameter names.
-   Checking operation support before invoking a missing handler.
-   Isolating close-time unsubscribe failures so remaining cleanup continues.
-   Aligning parsed request values with corrected router declarations.

Each production change requires a red regression first. Preserve public `addConnection()`, logger APIs, synchronous-validation policy, and existing response wire shapes.

PR 3 is complete when:

-   Every public server operation has direct happy and terminal-path coverage.
-   Schema parsing/transformation is proven for requests, responses, and events.
-   Server subscription ownership and close cleanup are deterministic and exactly once.
-   Malformed input cannot cause an unhandled rejection.
-   BigInt and parameters work through representative end-to-end server frames.
-   No real socket or real timer is used.

## PR 4: Package artifact, documentation, structure, and release gate

### 1. Test the real packed artifact

Replace the repository-symlink package consumer in `tests/package-contract.test.ts` with a temporary packed consumer.

Required procedure:

1. Create a temporary directory.
2. Run `npm pack --json --ignore-scripts --pack-destination <temp>`.
3. Create a temporary consumer package whose dependencies point to:
    - the generated local smolrpc tarball; and
    - the repository's local `@standard-schema/spec` package, avoiding network access.
4. Install with scripts, audit, funding output, and lockfile generation disabled.
5. Execute a real `.mjs` consumer with `process.execPath`.
6. Compile a `.mts` consumer against the installed declarations by invoking the repository TypeScript CLI through `process.execPath`.
7. Remove the complete temporary directory in `finally`.

Portability requirements:

-   Do not create package symlinks or junctions.
-   Do not execute `node_modules/.bin/tsc` directly.
-   Invoke the current npm CLI through `process.execPath` and `process.env.npm_execpath` where available, with an explicit cross-platform fallback.
-   Do not use shell syntax, Unix-only paths, globally installed tools, or a tarball path inside the repository.
-   Keep the test deterministic and network-free.

### 2. Assert the complete public package contract

The runtime consumer must import the package root as ESM and assert exact runtime export keys:

-   `SmolRpcError`
-   `dummyClient`
-   `initClient`
-   `initServer`
-   `json_parse`
-   `json_stringify`

Invoke representative safe behavior, including error construction, codec round trip, and `dummyClient` shape without waiting on its intentionally pending Promises.

The type consumer must import every public type-only root export and exercise:

-   all four lifecycle methods and `statechange`;
-   transforming client/router/result/response/event types;
-   resource parameters and operation combinations;
-   negative unsupported method, request, and parameter assertions.

The packed-file assertion must use an intentional exact allowlist rather than representative `arrayContaining` checks. It must:

-   include every runtime dependency reached by `index.js`;
-   include generated declarations and their map;
-   include `readme.md` and `authentication.md`;
-   exclude top-level tests, `src/tests`, plans, editor files, and repository-only metadata.

### 3. Protect lifecycle TSDoc in generated declarations

Read the installed `types/index.d.ts` and assert stable contractual phrases remain for all four methods:

-   `close()` stops management and cancels current/backoff work.
-   `open()` starts only from stopped and attempts immediately.
-   `restart()` replaces immediately only while management is running and differs from `close(); open()`.
-   `invalidate()` enters or preserves delayed backoff rather than reconnecting immediately.

Do not snapshot the whole generated declaration. Check only intent-bearing phrases that are part of the public editor contract.

Also add source TSDoc for `ClientTransportState`, `statechange`, `reconnect`, and raw lifecycle hooks where the current declaration lacks enough raw-versus-logical guidance, then verify the generated comments survive.

### 4. Fix package contents and verification ordering

Update `package.json`:

-   Add `authentication.md` to the published files so the README's relative link works in the npm artifact.
-   Keep `prepublishOnly` delegated to `npm run verify`.
-   Order the complete verification gate so generated declarations exist before packed-artifact consumer tests run.
-   Keep ordinary `npm test` read-only with respect to generated files.
-   Do not add dependencies or change the package version without separate release direction.

The release gate must ensure this order conceptually:

1. Source typecheck.
2. Declaration build.
3. Tests, including installed packed-artifact consumers against the newly built declarations.
4. Formatting/lint checks.
5. `publint`.
6. Final dry-run pack audit.

The exact script decomposition may introduce a dedicated package-contract/release test command if needed to avoid making ordinary client iteration rebuild declarations.

### 5. Finish suite organization

After all unique coverage has moved:

-   Remove `tests/client-correctness.test.ts`.
-   Remove duplicate local client factories and frame definitions.
-   Keep helpers domain-specific and small; do not create generic test machinery.
-   Ensure each test resides in the file named for its behavior.
-   Keep large end-to-end lifecycle-root and packed-artifact tests intact where splitting would hide ordering.

### 6. Update documentation

Update `readme.md` to state the schema boundaries clearly:

-   Router request values are parsed request-schema outputs.
-   Router response/subscription values are response-schema inputs.
-   Client response/subscription values are parsed response-schema outputs.
-   BigInt support applies through the exported codec and production protocol traffic.
-   Parameter keys must match colon-prefixed placeholders exactly.

Keep the existing lifecycle, mutation-ambiguity, and application-owned recovery guidance unchanged unless a regression requires clarification.

Review `authentication.md` only for package-relative links and consistency; do not redesign authentication policy.

Update `AGENTS.md` to:

-   describe the final client, protocol, server, codec, public-type, and package suites;
-   document record-then-assert for safely invoked callbacks;
-   explain `sendAttempts` versus `sent`;
-   warn that nested construction return order is not runtime generation ownership;
-   describe the final declaration-build and packed-artifact verification order.

PR 4 is complete when:

-   The actual tarball installs, executes as ESM, and consumer-compiles.
-   Tests consume freshly generated declarations in the release gate.
-   Runtime exports and packed paths are exact.
-   Lifecycle TSDoc is protected.
-   `authentication.md` is published.
-   Package tests avoid shell, symlink, network, and Unix-specific assumptions.
-   The final suite structure is coherent and non-duplicative.

## Final Plan 42 regression acceptance

Plan 43 is not complete until every original Plan 42 matrix row is fully proven. The strengthened proof target for each audited partial or incorrect case is:

| Plan 42 case | Required Plan 43 proof                                                                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1           | Deliver all stale native callback types, then successfully create and complete fresh replacement work while asserting unchanged state, hooks, attempts, and timer ownership.     |
| #16          | For every GET terminal path, assert prompt timer removal before time advances and require late addressed frames to be unknown-ID diagnostics.                                    |
| #22          | After synchronous GET retirement and native-send return, establish a replacement and prove deferred unavailable settlement cannot affect it.                                     |
| #23          | After synchronous GET retirement and native-send throw, prove send-failed precedence, prompt detachment, late-frame handling, and replacement isolation.                         |
| #30          | Rejection, mismatch, serialization, and send failure each evict the default cache and permit exactly one fresh wire subscription.                                                |
| #33          | Acknowledgement timeout occurs once at 5,000 ms and not at 4,999 ms.                                                                                                             |
| #35          | Unavailable subscription construction sends nothing and leaves no cache or logical record visible after a later open.                                                            |
| #37          | Acknowledgement state detaches during native send, and no completion/diagnostic is emitted on-stack; return/throw and stale acknowledgements cannot affect replacement state.    |
| #43          | GET, SET, and subscription state is detached before `unavailable`, terminal delivery follows it, and no assertion is executed inside the safely invoked hook.                    |
| #44          | State, close, reconnect, error, and diagnostic hook reentry each have pending work where applicable and cannot suppress prepared settlements or create obsolete attempts/timers. |
| #46          | Cover every lifecycle state/method pair, including `open()` while already open.                                                                                                  |
| #48          | Install and execute the real tarball and assert the complete intentional runtime/declaration/document allowlist and exclusions.                                                  |

All other Plan 42 cases must remain green with assertion strength at least equal to their existing tests.

## Additional audit acceptance matrix

| ID  | Required proof                                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | GET and SET server dispatch uses parsed requests, validated/transformed responses, exact handler arguments, correct connection destination, and exact logger metadata. |
| S2  | Malformed, invalid, schema-failing, and handler-failing server requests are contained and use the correct generic or request-associated rejection path.                |
| S3  | Server subscription accept/event/unsubscribe ordering, transformations, invalid-event dropping, and logger behavior are direct and deterministic.                      |
| S4  | Connection-close subscription cleanup is exactly once, failure-isolated, and connection-local.                                                                         |
| T1  | Transforming schemas compile with correct input/output boundaries across client, router, protocol responses/events, and `Result`.                                      |
| T2  | All seven operation combinations and positive/negative resource parameter cases are compile-tested.                                                                    |
| C1  | Direct and representative protocol BigInt round trips cover nested, array, zero, positive, negative, request, response, and event values.                              |
| P1  | String/numeric multi-parameters materialize correctly; missing, extra, and incorrect names fail; cache keys remain independent.                                        |
| H1  | Every public hook and diagnostic callback may throw without corrupting continuation, and expected failures are captured without noisy test output.                     |
| O1  | Observer next/error throwing, lifecycle reentry, addition, and removal preserve recipient snapshots and exactly-once semantics.                                        |
| E1  | Error and diagnostic metadata contains only allowed keys and excludes sentinel payload, params, native errors/events, credentials, and raw frames.                     |
| K1  | The real packed artifact installs, executes, consumer-compiles, retains lifecycle TSDoc, and includes every linked public document.                                    |

## Verification plan

### Focused iteration

Run the narrowest changed suite:

```bash
npm test -- tests/client-lifecycle.test.ts
npm test -- tests/client-lifecycle-hooks.test.ts
npm test -- tests/client-operations.test.ts
npm test -- tests/client-subscriptions.test.ts
npm test -- tests/client-protocol.test.ts
npm test -- tests/server-dispatch.test.ts
npm test -- tests/server-subscriptions.test.ts
npm test -- tests/shared-codec.test.ts
npm test -- tests/package-contract.test.ts
npm run typecheck
```

Run race-heavy client files at least five independent times during PR 1. Every run must be quiet: no swallowed assertion, unexpected `console.error`, unhandled rejection, or leaked timer.

### Declaration verification

When declaration sources change:

```bash
npm run typecheck
npm run build
git diff -- types/index.d.ts types/index.d.ts.map
```

Inspect generated changes for:

-   request `InferOutput` at router parsed-value boundaries;
-   response `InferOutput` at client and response/event wire boundaries;
-   response `InferInput` at router producer boundaries;
-   retained lifecycle TSDoc;
-   no accidental new root export.

### Final gate

At minimum:

```bash
npm test
npm run typecheck
npm run lint
npm run verify
git diff --check
git diff --cached --check
git status --short
npm pack --dry-run --json --ignore-scripts
```

The final implementation report must record:

-   exact test file and test counts;
-   zero skipped/todo tests and zero falsely swallowed assertions;
-   repeated race-suite outcomes;
-   exact packed-file count and paths;
-   confirmation that an installed tarball executed and consumer-compiled;
-   confirmation that ordinary `npm test` did not modify tracked/generated files;
-   generated declaration changes;
-   working-tree/index status before and after verification.

## Completion criteria

Plan 43 is complete only when:

-   Every Plan 42 matrix case is fully and accurately proven.
-   Additional audit cases S1–K1 are fully proven.
-   The false-green hook assertion is removed and tests fail normally when their assertions fail.
-   Client generation-safe behavior remains intact.
-   Server dispatch, subscriptions, validation, and cleanup have deterministic direct tests.
-   Transforming schemas have correct runtime-aligned public declarations.
-   BigInt, parameters, sanitisation, throwing hooks, and observer reentrancy have focused regressions.
-   The real package artifact executes and consumer-compiles against freshly generated declarations.
-   Packed files and lifecycle TSDoc are intentional and protected.
-   Suite files and helpers have coherent, non-duplicative responsibilities.
-   `npm run verify` and the final pack audit pass without mutating unexpected files.
