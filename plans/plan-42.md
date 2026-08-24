# Plan 42: Lean Implementation Plan for a Generation-Safe SMOLRPC Client

Date: 2026-08-21

Status: Complete — PRs 1, 2, and 3 complete; release verification passed

Based on: `plans/plan-41.md`

Target release: `smolrpc@0.56.0`

## Purpose

Fix the WebSocket replacement and pending-operation races identified in Plan 41 without redesigning unrelated client APIs or adding speculative infrastructure.

The implementation is organized around one invariant:

> Every socket-construction attempt and reconnect timer has identity ownership, and every native callback, request ID, operation record and its timer, SET waiter, subscription/cache index, and unsubscribe acknowledgement belongs to one immutable connection generation. Only the current lifecycle intent/construction attempt and current generation may affect transport state or accept new work.

Plan 41 remains the detailed bug analysis. This document is the implementation plan and narrows several parts of the earlier Plan 42 draft.

## Scope reductions

The following are deliberate YAGNI decisions:

-   Keep the existing `open()` and `close()` names. Add only the `restart()` and `invalidate()` lifecycle primitives required by the recovery use cases. Do not introduce a breaking rename to `start()`, `stop()`, `replaceConnection()`, and `invalidateConnection()`.
-   Do not add `getTransportSnapshot()` or make `ReadyStates` a new root export. Neither is required to isolate generations or clean pending work.
-   Use one exported `SmolRpcError` class with a stable `code` instead of seven nearly identical subclasses. Callers can branch on `error.code` without matching messages.
-   Do not require a dedicated internal TypeScript model file. Local JSDoc typedefs are sufficient unless implementation experience proves otherwise.
-   Do not add a scheduler abstraction, public generation API, schema validation for response payloads, automatic retries, subscription replay, heartbeats, or application health/authentication policy.
-   Malformed frames are diagnosed without automatically invalidating a healthy transport. If an ID can safely be extracted, a frame that addresses a live operation first terminalizes that operation; unknown-ID and genuinely unaddressable frames are dropped.
-   Do not prescribe exact helper names or generic state machinery beyond the logical transport states, generation/attempt identity, and operation send phases required for correctness.
-   Use three cohesive pull requests. Keep the client-correctness migration in one atomic core PR reviewed as final-state commits, rather than adapting every operation for generation retirement and then rewriting the same branches again for transactional behavior.

These reductions do not weaken the generation-ownership fix, prompt cleanup, mutation-outcome handling, or deterministic regression coverage.

## Required behavior

### 1. Runtime and generation ownership

Create one stable runtime for the lifetime of `initClient()`. Keep its lifecycle implementation inside `init-client-websocket.js`; `init-client.js` remains thin hook-ordering and proxy wiring. The runtime owns only:

-   whether automatic connection management is running;
-   the current logical transport state;
-   the current generation, if any;
-   the next generation number;
-   at most one identity-owned socket-construction attempt;
-   reconnect backoff state; and
-   at most one identity-owned reconnect timer.

Each successfully constructed native WebSocket gets a fresh generation object containing:

-   an immutable generation number and socket reference;
-   authoritative readiness and a retired guard;
-   its request-ID counter;
-   one `operations` map keyed by request ID;
-   SET open waiters; and
-   the subscription cache.

An operation record owns its expected response behavior, timer, send phase, identity-based detach logic, and any unsubscribe acknowledgement bookkeeping. A subscription record may be referenced by both `operations` and the subscription cache; those are indexes to the same identity-owned record, not duplicate state. Do not add separate listener, pending-operation, timer, or acknowledgement maps.

Do not retain proxy-level operation, subscription, ID, or waiter collections that are replaced on `open`.

Request IDs may restart for each generation because dispatch always receives the originating generation. A stale message must never be looked up in the current generation's `operations` map.

### 2. Native callback and reconnect guards

Every native `open`, `message`, `error`, and `close` handler captures its generation. Before acting, it verifies that the generation is current, not retired, and the client is still running.

A stale callback is a complete no-op. It must not:

-   change current readiness;
-   invoke a public WebSocket hook;
-   parse or dispatch a message;
-   wake SET waiters;
-   reset backoff; or
-   create/cancel reconnect work.

Reconnect timers use identity tokens. A timer may construct a socket only if it is still the runtime's pending token, the client is running, and no current generation exists. `close()` and `restart()` cancel the token by both clearing the timer and removing its identity.

Preserve the existing delays `[1000, 2000, 5000, 10000]` and 20% jitter. An open socket resets backoff. Initial `open()` and `restart()` reset it before their immediate attempt; `invalidate()` preserves current backoff history.

Native event ordering:

-   **open:** publish authoritative `OPEN`, reset backoff, publish logical `open`/invoke `statechange`, revalidate, invoke the raw open hook, revalidate again, then wake only that generation's SET waiters;
-   **message:** drop stale frames, invoke the raw message hook, revalidate, then parse and dispatch against the captured generation;
-   **error:** invoke the public error hook for the current generation, but do not change readiness or reconnect without a close;
-   **unexpected close:** retire the generation and establish one reconnect path before invoking the close hook, then deliver prepared operation settlements;
-   **caller-retired socket:** suppress its later native close and all other callbacks.

The existing `reconnect` hook is a raw attempt notification only for automatic attempts that begin after backoff. It does not run for automatic initialization, explicit `open()`, or the immediate attempt made by `restart()`. It runs only after the automatic attempt's socket has been successfully constructed, its handlers installed, and its generation published as current. A superseded construction attempt never invokes it.

#### Logical transport state

Add a logical state notification independent of raw native WebSocket callbacks:

```ts
export type ClientTransportState =
	| 'stopped'
	| 'connecting'
	| 'open'
	| 'unavailable'
	| 'backoff';

export interface ClientWebSocketEvents {
	statechange?: (state: ClientTransportState) => void;
	// Existing raw open/message/error/close/reconnect/send hooks remain unchanged.
}
```

Invoke `statechange` only when the logical value changes. It is a state signal, not a synthetic native event, and receives no `CloseEvent`. Export `ClientTransportState` through the public type declarations, but do not add a snapshot API.

When a current generation retires, publish `unavailable` exactly once for that generation after all of its transport-owned state is detached and before any prepared Promise rejection or `observer.error()` delivery. The retired socket's later native close emits neither another state transition nor a raw close hook. After the unavailable callback returns, revalidate lifecycle intent before continuing to the destination state; a reentrant newer lifecycle command supersedes that continuation but does not suppress already-prepared operation settlements.

Required logical transitions are:

```text
initialization/open:  STOPPED → CONNECTING → OPEN
close from OPEN:      OPEN → UNAVAILABLE → STOPPED
restart from OPEN:    OPEN → UNAVAILABLE → CONNECTING → OPEN
invalidate from OPEN: OPEN → UNAVAILABLE → BACKOFF → CONNECTING → OPEN
unexpected close:     OPEN → UNAVAILABLE → BACKOFF → CONNECTING → OPEN
close while constructing: CONNECTING → STOPPED
invalidate while constructing: CONNECTING → BACKOFF
restart while constructing: CONNECTING → CONNECTING (new attempt identity; no duplicate state callback)
close during backoff: BACKOFF → STOPPED
restart in backoff:   BACKOFF → CONNECTING → OPEN
```

A constructor failure before a generation exists has no `unavailable` transition: an initial/explicit-open failure moves `connecting → stopped`, while an automatic/restart failure moves `connecting → backoff` only if its attempt still owns the continuation. Stopped and backoff are observably distinct even though neither has a current socket.

#### Socket-construction attempt ownership

Every call path that may invoke application-provided `createWebSocket()`—initialization, `open()`, automatic reconnect, and `restart()`—creates a unique attempt token. Starting, stopping, invalidating, or replacing connection intent supersedes the prior token even when no generation has been published yet.

A construction attempt must:

1. Publish itself as the runtime's current attempt and enter logical `connecting` when appropriate.
2. Validate its token, running/lifecycle intent, and absence of a conflicting current generation immediately before calling `createWebSocket()`.
3. Revalidate after the factory returns.
4. Create the provisional generation and install handlers, then revalidate again before publishing that generation as current.
5. Close and discard a returned socket if either post-factory validation shows that the attempt was superseded. Its handlers remain guarded and invoke no public hook.
6. Invoke `reconnect` only for a still-owned successful automatic-backoff attempt, after publication.

The factory is a user-code and reentrancy boundary. For example, if attempt A's factory calls `close()`, A's returned socket is discarded and the client remains stopped. If it calls `restart()` and attempt B succeeds, A cannot overwrite B when its factory later returns.

On constructor throw, first verify that the attempt still owns the failure continuation. A superseded failure is stale and schedules nothing. For automatic-reconnect and `restart()` failures, report safely, then revalidate the attempt token, running state, lifecycle intent, and absence of a current generation after the diagnostic callback before entering backoff or scheduling another timer. Initial/explicit-`open()` failures restore stopped state and rethrow the original error as specified below.

### 3. One retirement path

Use one idempotent retirement operation for unexpected close, explicit close, restart, and invalidation. A constructor failure that occurs before a generation exists only needs to restore the runtime's stopped/backoff state.

Retirement must:

1. Return if the generation is already retired.
2. Mark it retired and unavailable before calling user code.
3. Remove it as current when applicable.
4. Cancel its SET waiters and operation-owned timers.
5. Detach operation records and evict subscription-cache indexes by record identity so old cleanup cannot remove newer state; unsubscribe acknowledgements are operation records, not a separate collection.
6. Prepare each Promise rejection and observer error exactly once. If an operation is inside native `send()`, mark retirement pending for that operation but defer its classification and settlement until `send()` unwinds.
7. Publish logical `unavailable` exactly once and invoke `statechange`.
8. Revalidate lifecycle intent, then establish and publish the requested stopped, backoff, or replacement state only if the retirement continuation still owns that intent.
9. Close the native socket when appropriate; its guarded callbacks are now stale.
10. Deliver non-deferred settlements after all old state is detached and after the unavailable notification, even if callback reentrancy changed the destination state.

Prepared settlements must still run if a hook or observer creates a newer generation. They must never read from or delete newer state.

An explicit `sending` phase is required because retirement cannot know whether native `send()` accepted a frame while that call remains on the stack. Retirement still detaches the operation from `generation.operations`, cancels its timer/waiter, and removes any cache index, but a small operation-owned completion record remains until `send()` returns or throws. A valid matching synchronous response may settle first. Otherwise, a throw before settlement is a send failure; a successful return after retirement makes a SET's mutation outcome unknown. Deferred completion must run exactly once after the call unwinds and must not consult current-generation state.

Lifecycle transitions should be completed before observer/Promise delivery where possible. This avoids carrying a partially completed lifecycle command across a reentrant callback.

### 4. Lifecycle API

Retain and clarify the existing methods, then add the two recovery primitives:

```ts
export interface ClientMethods {
	close(): void;
	open(): void;
	restart(): void;
	invalidate(): void;
}
```

The methods represent four different lifecycle intents. Document them using this decision guide, not only as state transitions:

| Intent                                   | Method         | Recovery behavior                                                      | Typical reason                                                           |
| ---------------------------------------- | -------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Deliberately stop connection management  | `close()`      | Retire/cancel current work and remain stopped                          | The application no longer wants a connection                             |
| Deliberately start connection management | `open()`       | From stopped, reset backoff and attempt immediately                    | Resume a previously stopped client                                       |
| Replace the connection now               | `restart()`    | Keep management running, reset/bypass backoff, and attempt immediately | Authentication, identity, tenant, or connection inputs changed           |
| Declare the connection unhealthy         | `invalidate()` | Keep management running and enter/preserve normal delayed backoff      | Immediate reconnection may repeat a transient health or protocol failure |

The essential distinction is recovery policy:

-   `restart()` means **replace now**. It retires/supersedes current work, resets backoff, and starts an immediate attempt.
-   `invalidate()` means **recover gradually**. It retires/supersedes current work, preserves backoff history, and schedules the normal jittered retry; if already in backoff, it preserves the existing timer and delay.
-   `close(); open()` is not equivalent to `invalidate()`: it exposes an intermediate stopped intent, cancels recovery, resets backoff, attempts immediately, and an explicit-open constructor failure rethrows and remains stopped instead of continuing automatic retries.
-   `close(); open()` may resemble `restart()` in the simplest open-state case, but `restart()` is one replacement intent without an observable stopped transition, can bypass an existing backoff timer, and follows automatic-recovery constructor-failure behavior. It remains a no-op when deliberately stopped.

A validated motivating use case is an application-designated lifecycle-root GET, such as readiness or current-identity bootstrap, timing out while the native WebSocket still appears open. The application knows that continuing on that generation is unsafe, while immediate replacement may repeat a transient server, event-loop, network, or listener-state failure. Application code catches the typed `SMOLRPC_TIMEOUT`, calls `invalidate()`, and reconstructs its lifecycle root after a later open generation. SMOLRPC must not automatically classify particular resources or generic GET timeouts as unhealthy: ordinary RPC timeout/rejection remains operation-local, and the application owns the decision to invalidate.

`invalidate()` performs only the transport action. It does not revive a terminal reactive stream, replay the timed-out GET, or reconstruct subscriptions. The application must keep the timeout inside a recoverable lifecycle branch and explicitly recreate identity/readiness requests and dependent subscriptions after recovery. This division preserves the out-of-scope rule against library-owned application recovery policy and subscription replay.

| Current state     | `close()`                                    | `open()`                                    | `restart()`                                                       | `invalidate()`                               |
| ----------------- | -------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------- |
| stopped           | no-op                                        | start and immediately create one generation | no-op                                                             | no-op                                        |
| connecting/open   | stop; supersede attempt or retire generation | no-op                                       | supersede attempt or retire, then immediately attempt replacement | supersede/retire and schedule normal backoff |
| reconnect backoff | stop and cancel timer                        | no-op; do not bypass backoff                | cancel timer and immediately attempt one generation               | no-op; preserve timer/delay                  |

`close()`, `open()`, and `invalidate()` are idempotent. Sequential `restart()` calls while running are distinct replacement requests: each supersedes an in-progress construction attempt or retires the current generation before creating another.

`restart()` replaces connection intent only while automatic connection management is running. When stopped it remains stopped and constructs nothing; a later `open()` creates a connection using the then-current authentication/environment state. Do not document `restart()` as an unconditional “ensure connected” operation.

Add clear public TSDoc/JSDoc to all four lifecycle methods at their source declarations and implementation-facing API. The comments must explain intent and the important state-dependent behavior, not merely restate the method names:

-   `close()` stops automatic connection management and cancels current/backoff work;
-   `open()` starts only from stopped and attempts immediately;
-   `restart()` immediately replaces or bypasses backoff only while management is already running, remains a no-op while stopped, and differs from a `close()`/`open()` pair by avoiding an intermediate stopped intent; and
-   `invalidate()` marks a running connection attempt/generation unhealthy and enters or preserves normal backoff rather than reconnecting immediately.

These comments are part of the public API contract and must appear in generated declarations so editors surface the guidance. The README lifecycle section must reproduce the concise intent/decision guide above and explicitly compare `restart()`, `invalidate()`, and `close(); open()`, including immediate versus delayed retry, reset versus preserved backoff, stopped-state behavior, and constructor-failure recovery. Avoid relying on the state matrix alone to communicate when applications should use each method.

Constructor failures:

-   automatic initialization and explicit `open()` from stopped clean up, publish stopped, schedule no reconnect, and rethrow the original error;
-   automatic reconnect and `restart()` failures do not escape to the caller/timer; while their attempt token is still current, they report safely, revalidate after diagnostics, and schedule one next backoff attempt only if lifecycle intent still permits it.

### 5. Operation contracts

All operations capture a generation and clean their own record by identity. Transport state is detached before terminal Promise settlement, `observer.error()`, unsubscribe completion, or terminal diagnostics. Ordinary `observer.next()` delivery is non-terminal and retains the active operation record and cache index.

| Operation state                                    | Retirement                       | Timeout                         | Replay                                 |
| -------------------------------------------------- | -------------------------------- | ------------------------------- | -------------------------------------- |
| GET with no open generation                        | rejected Promise: unavailable    | n/a                             | never retry                            |
| Sent GET                                           | unavailable                      | timeout                         | never retry                            |
| SET waiting for its captured connecting generation | unavailable                      | timeout                         | never move to another generation       |
| SET known not to have been sent                    | unavailable                      | timeout                         | never replay                           |
| SET accepted by native `send()`                    | mutation outcome unknown         | mutation outcome unknown        | never replay                           |
| Active subscription                                | remove state and error observers | n/a                             | application creates a new subscription |
| Subscribable first observed after owner retirement | error without send               | n/a                             | never bind to replacement              |
| Unsubscribe acknowledgement                        | discard                          | clean/report after five seconds | never affect replacement               |

#### GET

-   Always return a Promise.
-   If no current `OPEN` generation exists, return a rejected Promise rather than throwing synchronously.
-   Bind operation-record and timeout cleanup to the captured generation.
-   Remove state before resolving/rejecting.
-   Reject promptly on retirement; do not leave the old timeout running.

#### SET

-   A SET created while the current generation is `CONNECTING` may wait only for that generation.
-   A SET created while stopped or in reconnect backoff rejects immediately.
-   Its five-second timeout starts when the method is called.
-   Retirement removes a waiting SET so it cannot wake on a replacement.
-   Track explicit `unsent`, `sending`, and `sent` phases. A retirement or non-definitive response observed during `sending` is recorded for deferred classification and is not delivered while native `send()` remains on the stack.
-   A valid matching synchronous `SetSuccess` or `RequestReject` settles first. If native `send()` then returns or throws, later completion is a no-op.
-   If native `send()` throws before a definite response settles, report send failure, including when the generation retired synchronously inside `send()`.
-   If native `send()` returns successfully after the generation retired, or after a non-definitive terminal response was deferred, report mutation outcome unknown.

#### Subscribe

-   Fresh construction requires a current `OPEN` generation because the API has no Promise through which to report unavailability.
-   Construction while stopped, connecting, or in reconnect backoff synchronously throws `SmolRpcError` with code `SMOLRPC_UNAVAILABLE`, creates no logical/cache/operation record, and sends nothing.
-   Document that reactive consumers which want this failure delivered through their reactive error channel must construct lazily inside that channel rather than creating the subscribable eagerly.
-   The logical subscribable and any cache entry belong permanently to that generation.
-   Register its operation record before sending.
-   Retirement, rejection, protocol mismatch, serialization failure, or send failure removes operation/cache indexes and errors current observers once.
-   Later observers of that old logical object receive an error and cause no send. A fresh `client[path].subscribe()` call may create a new object.
-   Preserve existing cache sharing and last-value replay, including replay of `undefined` via an explicit `hasValue` flag.
-   Ordinary events use a small subscription-local delivery loop: take a recipient snapshot, retain the active operation/cache indexes, and revalidate owner generation, subscription liveness, and observer membership before each `observer.next()` callback. Do not introduce generic observer or reentrancy machinery.
-   Guard observer callbacks so one throwing observer does not prevent delivery to other still-live recipients or later terminal cleanup.
-   Unsubscribe handles are individually idempotent. Only removal of the final observer begins wire unsubscribe.

A retained subscribable may be used again only while its owner generation is still current. Once evicted, it must not overwrite a newer cache entry.

#### Unsubscribe

-   Perform local observer/operation/cache cleanup first.
-   If the owner generation is no longer current and open, do not send; server disconnect cleanup is sufficient.
-   Otherwise register acknowledgement bookkeeping and a five-second cleanup timer before sending.
-   `unsubscribe()` remains `void`; acknowledgement rejection, mismatch, serialization/send failure, or timeout is reported diagnostically and never thrown to the caller.
-   Retirement silently discards acknowledgement bookkeeping.

### 6. Transactional send

Do not build a generic transaction framework or a switch-heavy abstraction that owns every operation's settlement semantics. Use one narrow generation-aware native-send primitive for GET, SET, subscribe, and unsubscribe. It is responsible only for invoking the public send hook, revalidating the captured generation/operation and authoritative/native `OPEN` readiness, entering `sending` immediately before native send, and calling the captured socket's `send()`.

Operation-specific code remains responsible for:

1. Capturing the generation and allocating its request ID.
2. Building and serializing the frame before registration where possible.
3. Creating one operation record that owns response handling, timer, phase, and identity-based cleanup.
4. Registering that record and any subscription-cache index before native send.
5. Calling the narrow native-send primitive.
6. On unwind, preserving an already-settled valid synchronous response; otherwise classifying a throw as send failure; otherwise marking the operation sent and delivering any retirement or response failure deferred during `sending`.
7. On any terminal failure, detaching every index and settling/reporting once according to that operation's contract.

The operation record must be dispatchable before native send. A lifecycle change in the public send hook is still pre-send and prevents entry into `sending`. Retirement must not settle an operation while its native `send()` is on the stack. A deferred record is operation-owned and cannot accept more transport messages after retirement detached it from `generation.operations`. No timeout closure may delete through `runtime.currentGeneration` or another mutable current map.

The unwind rule applies to every operation, not only SET:

-   a valid matching synchronous response settles first for any operation;
-   GET retirement followed by send return rejects unavailable after unwind, while a throw before settlement rejects send-failed;
-   subscribe retirement followed by send return calls `observer.error()` with unavailable only after unwind, while a throw before settlement uses send-failed;
-   SET follows the mutation-ambiguity precedence in Section 5; and
-   unsubscribe retirement detaches acknowledgement bookkeeping immediately but performs no diagnostic or other completion while send is on the stack; after unwind, a send throw may be diagnosed once and a return requires no caller-facing settlement.

### 7. Errors and diagnostics

Export one concrete error class and supporting types:

```ts
export type SmolRpcErrorCode =
	| 'SMOLRPC_UNAVAILABLE'
	| 'SMOLRPC_TIMEOUT'
	| 'SMOLRPC_SERVER_REJECTION'
	| 'SMOLRPC_PROTOCOL_ERROR'
	| 'SMOLRPC_MUTATION_OUTCOME_UNKNOWN'
	| 'SMOLRPC_SERIALIZATION'
	| 'SMOLRPC_SEND_FAILED';

export class SmolRpcError extends Error {
	readonly code: SmolRpcErrorCode;
	readonly metadata?: SmolRpcErrorMetadata;
}
```

Use a constructor equivalent to `(code, message, metadata?)`. Library-created metadata may contain only:

-   `operation`;
-   `resource`;
-   `requestId`;
-   `generation`;
-   `readyState`; and
-   `elapsedMs`.

Do not place params, payloads, cookies, authentication data, native events, or raw request/response objects in errors or new diagnostics. Preserve useful message text, but callers branch on `code`.

Error mapping:

-   serialization throws: `SMOLRPC_SERIALIZATION`;
-   pre-send ownership/readiness failure or retirement before native send begins: `SMOLRPC_UNAVAILABLE`;
-   native send throws before definite settlement: `SMOLRPC_SEND_FAILED`;
-   ordinary GET/known-unsent SET timeout: `SMOLRPC_TIMEOUT`;
-   valid matching server `RequestReject`: `SMOLRPC_SERVER_REJECTION`;
-   known-operation wrong type/resource or malformed-but-addressable response: `SMOLRPC_PROTOCOL_ERROR`, except for an accepted SET;
-   after a SET's native `send()` returns successfully, every terminal failure other than a valid matching `SetSuccess` or `RequestReject`—including timeout, retirement, wrong type/resource, and malformed-but-addressable response—is primarily `SMOLRPC_MUTATION_OUTCOME_UNKNOWN`.

For the accepted-SET exception, explain the protocol mismatch in the error message or a sanitized cause without including the raw frame. The primary code must remain `SMOLRPC_MUTATION_OUTCOME_UNKNOWN` so callers do not infer that retry is safe.

### 8. Message handling

Message dispatch receives the originating generation explicitly and parses inside `try/catch`.

-   Drop stale-generation frames before the raw message hook or parsing.
-   After parsing, malformed-frame handling follows this precedence:
    1. Safely extract a candidate request ID wherever the protocol permits, including a top-level `id` or `RequestReject`'s `request.id`, without assuming the rest of the envelope is valid.
    2. Look up only `originatingGeneration.operations`. If that ID addresses a live record, let that operation validate its expected envelope/type/resource and terminalize itself. Apply the accepted-SET mutation-ambiguity rule from Section 7.
    3. If the extracted ID is unknown, diagnose and drop the frame; it may be a late response after timeout.
    4. Diagnose and drop only genuinely unaddressable frames, including malformed JSON and parsed frames from which no usable ID can be extracted.
-   A frame such as `{"id": 4}` therefore fails live operation 4 rather than being treated as merely unaddressable.
-   A valid `RequestReject` uses `response.request.id` and must match the operation record's expected operation/resource. Do not add a second generic protocol router outside operation records.
-   Do not reconnect solely because one frame is malformed. Do not add response payload schema validation or change wire shapes.

### 9. Reentrancy boundaries

Only guard boundaries after which the implementation continues meaningful work:

-   after `statechange('unavailable')`, before publishing a destination state or starting replacement/backoff work;
-   immediately before and after `createWebSocket()`, and after handler installation before generation publication;
-   after logical-open state hook and again after the raw open hook, before waking SET waiters;
-   after message hook, before parsing/dispatch;
-   after send hook, before native send;
-   after constructor-failure or other diagnostics when a lifecycle continuation remains;
-   after close, reconnect, error, or state hooks whenever the implementation still has transport work to perform; and
-   before each observer callback after taking a recipient snapshot.

All public hooks, diagnostics, observer callbacks, and the socket factory may synchronously invoke lifecycle methods. Use generation, attempt-token, and lifecycle-intent checks at the listed continuations; do not add generic reentrancy machinery where ordering leaves no continuation. A raw hook already prepared for a real current native event may still be delivered, but it must not allow an older continuation to overwrite newer state.

Terminal transport state is detached before Promise settlement, `observer.error()`, and unsubscribe completion. Ordinary `observer.next()` is not cleanup: it retains the operation/cache indexes and revalidates generation and liveness before each recipient callback. A throwing callback is reported safely and does not interrupt other still-live recipients or remaining terminal cleanup. Avoid adding generic reentrancy machinery where simple ordering eliminates the continuation.

## Pull-request plan

Use three stacked PRs. PR 2 is intentionally one atomic client-correctness migration so production paths are rewritten once. Keep its review manageable with focused final-state commits and corresponding tests; do not introduce temporary operation adapters merely to create merge boundaries.

### PR 1: Deterministic test harness and baseline

**Status: Complete.**

Add exact-pinned Vitest with non-watch `test` and watch scripts. Move tests out of `src/tests` into top-level `tests/` so they are executable and not packed.

Create a small controlled WebSocket/factory that supports only what production uses:

-   explicit open/message/error/peer-close delivery;
-   delivery from an old socket after replacement;
-   sent-frame recording;
-   configured send/constructor throws;
-   optional callbacks during construction before return/throw and during handler installation, including lifecycle reentry;
-   an optional callback during send to prove operation-registration-before-send ordering and to synchronously retire before configured return/throw outcomes; and
-   fake-timer control for reconnect and operation timeouts.

Add baseline tests for successful GET, SET, cached/uncached subscriptions, final-observer unsubscribe, server rejection, `close()`/`open()`, and ordinary reconnect. Do not change production behavior in this PR.

Known regressions may be added with the PR that fixes them; do not merge permanently failing or indefinitely skipped tests.

**Done when:** baseline tests, typecheck, lint, and pack audit pass, and `src/tests` is no longer shipped.

### PR 2: Atomic generation and operation correctness

**Status: Complete.**

Refactor `src/init-client-websocket.js`, `src/init-client-proxy.js`, and their wiring once into the final internal shape. Add `src/client-errors.js` in the same PR. This PR is atomic at the production-behavior level because splitting generation retirement from final operation semantics would rewrite and re-review the same branches twice.

Use the following focused review-commit sequence:

1. Add `SmolRpcError`, `ClientTransportState`/`statechange`, the transport-owned runtime, identity-owned construction attempts, fresh generations, guarded native callbacks, and identity-owned reconnect tokens.
2. Add the final `operations` map/record shape, one retirement path, the narrow native-send primitive, and final GET/SET behavior including deferred `sending` classification.
3. Add final generation-owned subscription/cache behavior, subscription-local observer delivery, and transactional unsubscribe acknowledgement records.
4. Add operation-centric safe dispatch, malformed-but-addressable precedence, root/type exports, generated declarations, and the remaining regressions.

These commits are review units, not excuses for temporary production architectures. Keep commits testable where practical, but do not add a proxy-global compatibility map, separate listener/timer/acknowledgement registries, a generic transaction framework, or a send path that consults only mutable wrapper readiness.

Across the PR:

-   pass captured generations and construction-attempt tokens explicitly through their continuations;
-   publish logical unavailable/destination states before prepared operation delivery while keeping raw native hooks separate;
-   preserve `open()`/`close()` names and the existing backoff policy;
-   register each final operation record before native send and detach it by identity;
-   implement GET rejected-Promise semantics and SET generation/send-phase ownership;
-   preserve ordinary multi-event subscriptions while terminal paths detach before observer errors;
-   roll back serialization/send failures completely;
-   keep unsubscribe acknowledgement failures diagnostic-only and bounded to five seconds;
-   parse defensively and let addressed operation records validate type/resource; and
-   activate all applicable generation, operation, subscription, protocol, and reentrancy regressions from the matrix below.

Export `SmolRpcError` and its types from source/root declarations, then regenerate declarations in the final mechanical commit.

**Done when:** stale generations cannot affect current state, every operation is represented by one generation-owned record, retirement and terminal paths detach exactly once before delivery, ordinary subscription events retain their active indexes, failed send leaves no registration, and no operation is retried or replayed.

### PR 3: Recovery lifecycle, documentation, and release

**Status: Complete.**

Add public `restart()` and `invalidate()` using the existing retirement/reconnect primitives. Complete the logical state-transition matrix plus lifecycle-specific constructor-failure and callback-reentrancy tests.

Use a red/green workflow for the validated lifecycle-root recovery scenario before considering `invalidate()` complete:

1. Add and run a deterministic test that suppresses responses for an application-designated lifecycle-root GET while leaving the controlled socket open; confirm it fails for the expected missing/incorrect invalidation behavior.
2. Implement `invalidate()` and make the test green by proving timeout → application catch → invalidation → one preserved-backoff recovery path → replacement open → application-owned root/subscription reconstruction.
3. Keep the red test out of merged intermediate states if required by CI, but record the red run in the PR description. The final test must exercise the public API rather than an internal retirement helper.

Update:

-   `src/client.types.ts`, `index.d.ts`, and generated declarations with all four lifecycle methods, their public TSDoc/JSDoc guidance, the type-only `ClientTransportState` export, and the `statechange` callback; update `index.js` only for applicable runtime exports;
-   `readme.md` with a concise lifecycle-method decision guide, the lifecycle-root timeout use case (using generic readiness/identity examples rather than Bókin-specific resource names), a warning not to invalidate on ordinary RPC failures, logical versus raw lifecycle events, stopped versus backoff, exact `reconnect` semantics, errors, mutation ambiguity, unavailable subscription construction/lazy reactive guidance, stopped-state `restart()`, and application-owned recovery;
-   `authentication.md` to use `restart()` after cookie/identity changes; and
-   package version/scripts/lockfile for `0.56.0`.

Keep `open()` and `close()` available and documented. Do not add renamed aliases or snapshots.

Replace the recursive publish script with a normal verification gate, for example:

```json
{
	"test": "vitest run",
	"test:watch": "vitest",
	"typecheck": "tsc --noEmit",
	"build": "dts-buddy",
	"format": "prettier --write .",
	"verify": "npm test && npm run typecheck && npm run build && npm run lint && publint && npm pack --dry-run",
	"prepublishOnly": "npm run verify"
}
```

Publishing remains the ordinary `npm publish` command.

**Done when:** lifecycle behavior, root runtime/type exports, documentation, declarations, package contents, and `npm run verify` all pass.

## Required regression coverage

Keep one regression matrix rather than duplicating test lists in every PR and acceptance section.

### Generation and reconnect

1. Delayed old-socket open/message/error/close cannot affect a replacement or invoke current hooks.
2. Caller-retired native close is suppressed and emits no duplicate logical transition.
3. A stale reconnect timer after close/restart creates no socket.
4. An old response with a reused ID cannot settle a current operation.
5. An old timeout cannot delete a current operation record with the same ID.
6. Unexpected failures coalesce into one reconnect timer.
7. Backoff advances, caps, and resets after open.
8. Native error without close changes no state/readiness and schedules no reconnect.
9. Initial/open constructor failure rethrows without reconnect; reconnect/restart failure schedules one retry without escaping.
10. Attempt A's factory synchronously calls `close()` and returns a socket; A is closed/discarded and the client remains stopped.
11. Attempt A's factory synchronously calls `restart()`, attempt B succeeds, and A's later returned socket cannot overwrite or compete with B.
12. Lifecycle reentry during handler installation supersedes the attempt before publication; the provisional socket is closed/discarded.
13. Constructor-failure diagnostics that synchronously call `close()`, `open()`, or `restart()` cannot cause the failed outer attempt to publish state or schedule an obsolete reconnect.
14. A superseded construction attempt invokes no `reconnect` hook, including when its factory later returns or throws.

### GET and SET

15. GET unavailable returns a rejected Promise and is never retried.
16. GET response, rejection, timeout, retirement, serialization failure, and send failure each settle once and fully clean up.
17. A SET waits only for its captured connecting generation and never sends on a replacement.
18. A waiting/known-unsent SET times out normally.
19. A SET accepted by native send reports outcome unknown after timeout/retirement and is never replayed.
20. Operation registration precedes native send; valid synchronous test responses settle once and win over later send unwind.
21. When native `send()` synchronously retires the generation, retirement settlement is deferred: a subsequent return gives SET mutation-outcome-unknown, while a subsequent throw gives send-failed.
22. GET native send synchronously retires then returns: rejection occurs once with unavailable only after send unwinds and cannot affect replacement state.
23. GET native send synchronously retires then throws: rejection occurs once with send-failed only after send unwinds and cleanup is complete.
24. Send-hook close/restart prevents old native send.

### Subscription and unsubscribe

25. Cached observers share one request; `cache: false` does not.
26. Last-value replay handles both ordinary values and `undefined`.
27. Multiple ordinary events reach active observers without removing the operation or cache indexes.
28. Retirement errors active observers once, evicts cache, and permits a fresh subscription on a new generation.
29. A generation-A subscribable first observed in B errors without sending.
30. Rejection, protocol mismatch, serialization failure, and send failure clean and terminalize the old logical subscription.
31. One throwing observer does not block others.
32. Handles are idempotent and only the final observer sends unsubscribe.
33. Unsubscribe operation registration precedes send and expires after five seconds.
34. Old handles and delayed acknowledgements cannot affect replacement subscriptions.
35. Fresh subscription construction while stopped, connecting, or in backoff synchronously throws `SMOLRPC_UNAVAILABLE`, creates no operation/cache state, and sends nothing.
36. Subscribe native send synchronously retires: `observer.error()` occurs once only after send unwinds, with complete cleanup and no effect on replacement subscriptions.
37. Unsubscribe native send synchronously retires: acknowledgement bookkeeping is detached immediately, no completion occurs on the send stack, and return/throw cannot affect replacement state.

### Protocol, lifecycle, and package

38. Genuinely unaddressable frames are diagnosed and dropped without throwing; safely extracted unknown IDs are diagnostic-only.
39. Malformed-but-addressable frames and known wrong type/resource fail only the addressed operation.
40. An accepted SET maps wrong type/resource and malformed-but-addressable responses to mutation-outcome-unknown, while valid matching `SetSuccess` and `RequestReject` retain their definite result mappings.
41. Message/send/open hooks that change lifecycle prevent stale continuation.
42. The logical state transition sequences for close, restart, invalidate, unexpected close, backoff attempt, and open match Section 2; each retired generation emits unavailable exactly once and its later native close emits nothing.
43. Logical unavailable notification occurs after old transport state is detached and before every prepared Promise rejection and `observer.error()`.
44. Lifecycle calls reentered from state, close, reconnect, error, and diagnostic hooks cannot overwrite newer state, suppress prepared settlements, or create duplicate attempts/timers.
45. `reconnect` runs only for a still-owned successful automatic-backoff construction, never for initialization, explicit `open()`, immediate `restart()`, or a superseded attempt.
46. Every lifecycle matrix entry is covered, including repeated calls, restart during backoff, and `restart()` remaining a no-op while stopped until later `open()`.
47. Runtime and type-only package imports expose `SmolRpcError`, its code/types, `ClientTransportState`/`statechange`, and all four lifecycle methods.
48. Packed output includes runtime/declarations but excludes `src/tests`, top-level tests, and plans.
49. Lifecycle-root recovery regression: while the native socket remains open, suppress two designated root GET responses until timeout; application test code branches on typed `SMOLRPC_TIMEOUT` and calls `invalidate()`; concurrent invalidations coalesce into one existing-backoff timer with no immediate socket; after the timer and replacement open, the application recovery branch explicitly reissues its root request and creates a fresh subscription, both succeed, and no old operation/subscription is replayed automatically. Assert the ordered `unavailable → backoff → connecting → open` states and that delayed old-generation frames cannot affect the rebuilt branch.

Use fake timers and controlled sockets; do not use real network timing for race tests.

## Acceptance criteria

The release is complete when:

-   every native callback, reconnect timer, and socket-construction continuation proves identity ownership before acting;
-   superseded construction attempts close/discard returned sockets and cannot publish a generation or reconnect hook;
-   IDs, operation records and their timers, waiters, subscription indexes, and acknowledgements are generation-local;
-   one idempotent retirement path clears old work, emits one logical unavailable transition, and settles prepared work exactly once in that order;
-   logical stopped, connecting, open, unavailable, and backoff states are observably distinct from raw native events;
-   stale callbacks, frames, timers, construction attempts, and unsubscribe handles cannot affect a replacement;
-   waiting SETs cannot cross generations and sent SETs are never replayed;
-   failed serialization/send rolls back all registration;
-   subscriptions terminate on retirement without transport-owned reconstruction, while fresh unavailable construction throws synchronously without registration;
-   `open()`, `close()`, `restart()`, and `invalidate()` match the lifecycle matrix, including stopped-state `restart()`;
-   `reconnect` is limited to still-owned automatic-backoff attempts;
-   callers can branch on stable `SmolRpcError.code` values without unsafe metadata;
-   the wire protocol and typed resource API remain compatible;
-   all required deterministic regressions pass, including the public-API lifecycle-root timeout → invalidate → backoff → application reconstruction scenario developed red/green; and
-   `npm run verify` and the packed-file audit pass for `0.56.0`.

## Out of scope

-   GET retry or SET replay;
-   subscription reconstruction across generations;
-   generic queueing while stopped or in backoff;
-   heartbeat/server changes;
-   application authentication, health, bootstrap, or reactive recovery policy;
-   response payload schema validation;
-   public scheduler/generation/snapshot APIs;
-   lifecycle method renames or compatibility aliases;
-   richer telemetry or payload diagnostics; and
-   any server or wire-protocol change.
