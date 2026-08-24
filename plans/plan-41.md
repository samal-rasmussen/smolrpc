# Plan 41: SMOLRPC Generation-Safe Client Lifecycle

Date: 2026-08-21

Status: Ready for implementation

Background: Prepared from a production investigation of `smolrpc@0.55.0`.

## Purpose

Correct the WebSocket lifecycle and pending-operation defects in `smolrpc@0.55.0` without replacing the protocol or moving application recovery policy into SMOLRPC.

A production user operates one long-lived typed SMOLRPC client for GETs, SETs, and live subscriptions. Incidents have surfaced as unrelated frontend streams failing with errors such as:

-   `initClientProxy.subscribeHandler: websocket not open`
-   `Get request on /user/me timed out after 5 seconds.`
-   `initClientProxy.onmessage: No listener found for response/event`

The affected application services are usually dependent victims rather than independent causes. The common failure is that transport state and request state are shared across native WebSocket replacements without strict connection-generation ownership. A transport disruption can therefore corrupt the replacement connection or terminate application lifecycle streams that would otherwise be able to reconstruct their subscriptions.

SMOLRPC is responsible for connection-generation isolation, operation cleanup, and safe lifecycle primitives. Application-specific policy remains outside the package: each application decides which health or identity failures should invalidate a connection and how to reconstruct its state after a new connection becomes ready.

## Current implementation context

The inspected package version is `smolrpc@0.55.0`.

Relevant files:

-   `src/init-client-websocket.js`: native socket lifecycle, shared readiness, and reconnect timer.
-   `src/init-client-proxy.js`: request IDs, listeners, timers, open waiters, subscriptions, and message dispatch.
-   `src/init-client.js`: transport/proxy wiring and public client methods.
-   `src/client.types.ts`: `ClientMethods` and client event types.
-   `index.js`: public runtime exports.
-   `src/tests/subscribe.test.ts`: currently prose rather than executable coverage.
-   `package.json`: currently has no test script or test-runner dependency.

The server and wire-message shapes do not need to change.

## Proven bugs

### 1. A stale native-socket callback can clobber its replacement

`initClientWebSocket()` stores one mutable `websocket` variable and one mutable wrapper `readyState`. Every native socket callback mutates those shared values without first proving that the callback belongs to the current socket.

A deterministic reproduction is:

```text
old socket is OPEN
  -> close() explicitly closes it and clears the shared socket reference
  -> open() creates a replacement
  -> replacement onopen sets shared readiness to OPEN
  -> delayed old onclose sets shared readiness to CLOSED
  -> new subscription throws "websocket not open"
```

The replacement native socket can remain physically open while SMOLRPC reports `CLOSED`. Because the old socket was explicitly closed, its delayed close also schedules no reconnect. The same ownership defect affects more than `close`: stale `open`, `message`, `error`, and reconnect-timer callbacks can all mutate or deliver into current state. A stale message is especially dangerous if its numeric request ID has been reused by the replacement generation.

### 2. An old request timer can delete a new listener

`initClientProxy()` resets both `id` and `listeners` in `onopen()`. GET and SET timeout closures call `listeners.delete(requestId)`, but `listeners` is a reassigned shared binding rather than the map in which the operation was registered.

A deterministic reproduction is:

```text
old GET uses request ID 1 and remains pending
  -> replacement opens; listeners is replaced and id resets to 0
  -> new operation uses request ID 1
  -> old GET timer fires and deletes ID 1 from the new listener map
  -> valid new response reports "No listener found"
  -> new operation later times out
```

GET, SET, subscribe, and unsubscribe share the ID namespace and listener map, so the victim can be any operation type. `setHandler()` has the same cross-generation deletion risk through `rejectOnce()`.

### 3. Pending and queued operations do not have generation ownership

Opening a replacement currently discards listener and subscription maps without settling the operations that owned them. Old timers remain live. RxJS unsubscription from `from(promise)` does not cancel the underlying Promise, listener, or timer.

`setHandler()` also stores waiters in one global `onOpenCallbacks` array. A SET created before login, logout, registration, or impersonation replacement can therefore wake on the replacement socket and execute under a different cookie identity. That is not safe.

A logical subscribable has a related ambiguity: it can be constructed against one connection and first observed after another connection opens. Its cache, request ID, and unsubscribe bookkeeping must not straddle those generations accidentally.

### 4. Failed sends can leave registrations behind

Handlers register listeners, subscription cache entries, timers, or unsubscribe state around `websocket.send()`. If serialization or `send()` throws, all associated registration must be rolled back immediately. Unsubscribe currently sends before registering its response listener, which also permits a sufficiently fast or synchronous test response to arrive before the listener exists.

## Required invariant

Implement this as one structural invariant rather than separate race-condition patches:

> Every native callback, reconnect timer, request ID, listener, timeout, open waiter, subscription cache entry, unsubscribe operation, and authenticated operation belongs to one immutable connection generation. Only the current generation may affect public transport state or receive new work.

Socket-identity checks and monotonic request IDs may be useful defense in depth, but neither is a substitute for generation-owned operation state.

## Scope

In scope:

-   Generation ownership for every native socket and reconnect callback.
-   Generation-local request/listener/subscription/waiter state.
-   Immediate and idempotent cleanup when a generation closes or is replaced.
-   Safe semantics for GET, SET, subscribe, and unsubscribe during close, timeout, replacement, and failed send.
-   Explicit stop, restart, and liveness-invalidation mechanics.
-   Stable typed client errors.
-   Deterministic package-level regression tests.
-   Public exports, declarations, documentation, and release checks.

Out of scope:

-   Automatic retry of a GET on the same socket.
-   Automatic replay of a SET or any mutation.
-   Transport-owned durable subscription reconstruction.
-   Generic operation queueing across a closed/backoff interval.
-   Server heartbeat behavior.
-   Application-specific health checks, identity state, application context, or reactive-stream recovery policy.
-   Changes to the SMOLRPC wire protocol or server router.
-   Replacing SMOLRPC with another transport.

## Resolved design contracts

The following decisions are part of this plan and should not be left to the implementation.

### Public method and state behavior

`ClientMethods` will expose:

```ts
export type ReadyState = 0 | 1 | 2 | 3;

export interface ClientTransportSnapshot {
	readonly running: boolean;
	readonly generation: number | null;
	readonly readyState: ReadyState;
}

export interface ClientMethods {
	close(): void;
	open(): void;
	restart(): void;
	invalidate(): void;
	getTransportSnapshot(): Readonly<ClientTransportSnapshot>;
}
```

`ReadyState` remains the WebSocket-compatible numeric union `0 | 1 | 2 | 3`, and `ReadyStates` becomes a public runtime export. `getTransportSnapshot()` returns a new frozen value rather than a mutable live object. `generation` is `null` whenever there is no active native attempt, including stopped and reconnect-backoff states. `running` distinguishes stopped from backoff when both report `CLOSED` and `generation: null`.

Lifecycle commands have these semantics:

| Current state      | `close()`                                                  | `open()`                                                    | `restart()`                                                                      | `invalidate()`                                        |
| ------------------ | ---------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------- |
| stopped            | No-op                                                      | Set running, reset backoff, create one immediate generation | No-op; stopping remains authoritative                                            | No-op                                                 |
| connecting or open | Stop, cancel reconnect work, and retire current generation | No-op                                                       | Retire current generation, reset backoff, and immediately create one replacement | Retire current generation and schedule normal backoff |
| reconnect backoff  | Stop and cancel the reconnect token                        | No-op; it does not bypass backoff                           | Cancel backoff, reset it, and immediately create one generation                  | No-op; preserve the existing token and delay          |

`close()`, `open()`, and `invalidate()` are idempotent. `restart()` is deliberately **not** coalesced across sequential calls: each invocation while running represents a potentially new authentication intent and creates a new sequential generation. It must still synchronously retire the preceding generation before creating the next, so two native sockets are never current and no old generation receives new work.

Authoritative snapshots transition as follows:

| Runtime phase                                    | `running` | `generation`       | `readyState` |
| ------------------------------------------------ | --------- | ------------------ | ------------ |
| successful native attempt constructed            | `true`    | new generation     | `CONNECTING` |
| current native socket opened                     | `true`    | current generation | `OPEN`       |
| unexpected close, invalidation, or retry backoff | `true`    | `null`             | `CLOSED`     |
| explicit stop                                    | `false`   | `null`             | `CLOSED`     |
| immediate restart before replacement creation    | `true`    | `null` transiently | `CLOSED`     |
| native `error` without `close`                   | unchanged | unchanged          | unchanged    |

Logical retirement publishes `CLOSED` directly; it does not expose a transient `CLOSING` snapshot merely because native `socket.close()` is still completing. `ReadyStates.CLOSING` remains exported for WebSocket compatibility and diagnostics.

### Operation and Error delivery

-   GET never waits for a connecting generation. Its handler always returns a Promise; when no current `OPEN` generation exists, that Promise is rejected with `SmolRpcUnavailableError` rather than throwing synchronously.
-   SET may wait only for the specific generation that was `CONNECTING` when the SET was created. Its five-second timeout starts when the method is called. A SET created during stopped or backoff state rejects immediately as unavailable.
-   Subscribe construction requires a current `OPEN` generation. Because its API does not return a Promise, construction while unavailable throws `SmolRpcUnavailableError` synchronously.
-   A subscribe send failure is delivered synchronously through `observer.error`; `subscribe()` still returns an inert, idempotent unsubscribe handle.
-   A logical subscribable becomes permanently terminal after retirement, rejection, protocol failure, or failed send. Later observers of that same object receive the same typed terminal Error without sending. Cache state is removed, so a fresh `client[path].subscribe()` call can create a new logical subscribable.
-   `Unsubscribable.unsubscribe()` remains `void`. Unsubscribe acknowledgement rejection, protocol failure, send failure, or timeout is diagnostic-only because there is no caller-facing asynchronous result. Diagnostics must carry the applicable typed Error in safe `reportInternalError` data. Unsubscribe response bookkeeping gets a five-second cleanup timer so it cannot leak for the lifetime of a healthy generation.
-   Observer callbacks are isolated with guarded invocation. One observer throwing must not interrupt state cleanup or notification of the remaining observers.

Serialization failure uses `SmolRpcSerializationError`. A frame that is serialized but not accepted because native `socket.send()` throws uses `SmolRpcSendError`; it is considered not sent. A pre-send generation/readiness guard failure uses `SmolRpcUnavailableError`. For SET, use a `sending` state and defer close-retirement classification until the synchronous `send()` call returns or throws. If it returns and the generation retired during the call, reject as mutation outcome unknown. If it throws before any response settled the operation, reject as send failed. A synchronous response may settle the operation while `send()` is on the stack, and all later paths must remain no-ops.

A native `error` event alone does not prove the WebSocket closed. For a current generation it invokes the public diagnostic hook but does not change authoritative readiness, retire work, or schedule reconnect; a subsequent native `close` or explicit `invalidate()` performs retirement.

Malformed JSON, an unaddressable top-level `Reject`, or another frame that cannot safely be associated with an operation is a generation-level protocol failure: report `SmolRpcProtocolError` and invalidate that generation. An unexpected type or wrong resource for a known request ID fails and cleans up only that operation with `SmolRpcProtocolError`. An unknown request ID in the current generation is diagnostic-only because it may be a legitimate late response after timeout. Messages from stale generations are dropped before parsing or diagnostics.

### Callback reentrancy and ordering

Every public callback is a reentrancy boundary. Code must revalidate the captured generation after a public hook before continuing with transport work.

-   On current native `open`, publish `OPEN` and reset backoff before invoking `webSocketEvents.open`.
-   On current native `message`, invoke the existing raw debug `message` hook first, then revalidate generation ownership before parsing or proxy dispatch. If the hook restarts or closes the client, do not dispatch the old frame.
-   Before native send, complete operation registration, invoke the existing `send` hook, then revalidate generation and readiness before calling `socket.send()`.
-   On unexpected native `close`, first mark the generation unavailable, clear its collections, publish `CLOSED`, and create the single reconnect token. Invoke the current native `close` hook only after that coherent internal transition, then deliver generation-owned Promise and observer settlements. Reentrant lifecycle calls must cancel or supersede the token by identity.
-   Native `close` events from sockets already retired by caller-initiated `close()`, `restart()`, or `invalidate()` are stale and must be suppressed unconditionally. `webSocketEvents.close` represents only an unexpected close delivered by the current native generation. Do not add a synthetic lifecycle callback or terminal-event exception.
-   Never suppress settlement of already-retired operation records merely because a public callback created a later generation.

### Reconnect policy

Preserve the current backoff delays `[1000, 2000, 5000, 10000]` milliseconds and 20% jitter. The first unexpected failure schedules the first delay; each failed attempt advances once; a successful native `open` resets the counter. Explicit `open()` from stopped and `restart()` reset the counter before their immediate attempt. `invalidate()` uses the current backoff history.

Reconnect timers use identity tokens. When a timer wins, socket construction and handler installation occur before `webSocketEvents.reconnect` is invoked, so the callback observes a current `CONNECTING` generation. The callback is not emitted for initial start, explicit restart, a stale timer, or an attempt whose socket constructor threw. Tests may control jitter with fake timers and a scoped `Math.random` stub; no public scheduler API is required.

Synchronous construction failure is handled according to lifecycle intent:

-   The automatic initial start in `initClient()`, and a later explicit `open()` from stopped, clean up all tentative generation state, schedule no reconnect, invoke no socket lifecycle hooks, and rethrow the original constructor Error. Such failures indicate invalid configuration, an unsupported environment, or a faulty factory rather than transient network loss.
-   Construction failure during automatic reconnect or `restart()` reports a safe internal diagnostic, retires the failed attempt, and schedules exactly one next normal backoff attempt. It does not throw from the reconnect timer or `restart()`.

## Required operation semantics

| Operation state                                                 | Close, replacement, or invalidation behavior                                                                                      | Timeout behavior                                                                                      | Replay behavior                                                  |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| GET not sent                                                    | Reject as unavailable                                                                                                             | Not applicable; GET never waits for an open generation                                                | Never retry automatically                                        |
| GET sent                                                        | Reject as unavailable when its generation retires                                                                                 | Reject as timeout                                                                                     | Never retry automatically                                        |
| SET waiting for its current connecting generation               | Cancel and reject if that generation retires                                                                                      | Reject as timeout before send; outcome is known not to have been sent                                 | Never move to another generation                                 |
| SET successfully passed to `socket.send()`                      | Reject as mutation outcome unknown if the response is lost through close or timeout                                               | Reject as mutation outcome unknown                                                                    | Never replay automatically                                       |
| Active subscription                                             | Remove listener/cache state and error observers once with a typed unavailable Error                                               | No transport-owned resubscription                                                                     | Reconstruct only when the application creates a new subscription |
| Subscribable first observed after its owning generation retired | Fail without sending                                                                                                              | Not applicable                                                                                        | Must not bind accidentally to the replacement                    |
| Unsubscribe                                                     | Perform local observer/cache cleanup once; any response bookkeeping belongs to the same generation and is discarded on retirement | Clear bookkeeping after five seconds and report a diagnostic; never affect a replacement subscription | Never send an old unsubscribe on a new generation                |

Server `RequestReject` responses must produce a typed server-rejection Error and clean up the complete operation. Unexpected response types must produce a typed protocol Error and clean up the affected operation. GET and SET deliver those Errors by Promise rejection; subscribe delivers them to current and future observers of the terminal subscribable; unsubscribe reports them diagnostically because its public handle returns `void`.

## Implementation steps

### 1. Add an executable deterministic client test harness

Add an exact-pinned test runner with fake-timer support, such as Vitest, and add non-watch `test` and `test:watch` scripts to `package.json`.

Create a controlled fake WebSocket that can:

-   expose `CONNECTING`, `OPEN`, `CLOSING`, and `CLOSED` states;
-   record sent frames;
-   make `send()` throw on demand;
-   deliver `open`, `message`, `error`, and `close` events in arbitrary order;
-   deliver events from an old socket after a replacement exists;
-   optionally deliver a response synchronously from `send()`;
-   run reconnect and operation timeouts under fake timers.

Before refactoring, replace the prose in `src/tests/subscribe.test.ts` with executable baseline tests under a top-level `tests/` directory for GET, SET, subscription sharing/cache behavior, unsubscribe, server rejection, and ordinary reconnect backoff. Keeping tests outside `src/` prevents the package's current `files: ["src", ...]` rule from shipping the harness. Add failing regressions for the stale-close and old-timer reproductions above.

Do not use real network timing to test generation races.

### 2. Define the internal runtime and generation model

Keep one stable client runtime for the lifetime of `initClient()`. It should own only cross-generation intent and sequencing, for example:

-   whether the client is running or stopped;
-   the next generation number;
-   the current generation, if any;
-   one pending-reconnect token/timer, if any;
-   reconnect backoff state.

Create one generation object for each native WebSocket attempt. The generation must own at least:

-   an immutable generation number;
-   its native WebSocket;
-   its authoritative ready state;
-   its request-ID allocator;
-   its listener map;
-   its pending operations and operation timers;
-   its subscription cache;
-   its open waiters;
-   retirement and settlement guards.

`init-client.js` should coordinate the shared internal context. `init-client-websocket.js` should own native socket and reconnect mechanics. `init-client-proxy.js` should register and dispatch operations only through the captured generation. Do not keep reassigned listener, subscription, or waiter collections at proxy scope.

### 3. Guard every socket and reconnect callback

In `src/init-client-websocket.js`, every native `open`, `message`, `error`, and `close` callback must capture its generation.

Before changing readiness, invoking a public event, dispatching a message, or scheduling reconnect, verify that:

-   the callback's generation is still current;
-   the transition has not already been handled;
-   the client's current lifecycle intent permits the action.

A stale callback must be a no-op. In particular, it must not:

-   change current readiness;
-   invoke current-generation application callbacks;
-   route an old message into current listeners;
-   reset reconnect backoff;
-   schedule or cancel the current reconnect timer.

Represent a pending reconnect with an identity token that captures its owner and attempt. Its callback may create a new generation only if that exact token is still pending and the client still intends to run. Stop and restart must cancel the token.

Pass the originating generation into proxy message dispatch; never dispatch by consulting only a mutable current listener map.

### 4. Implement one idempotent generation-retirement path

Create one internal retirement operation used by native close, explicit stop, restart, invalidation, and connection-creation failure.

Retirement must:

1. Return immediately if the generation was already retired.
2. Mark the generation unavailable before user callbacks can reenter the client.
3. Cancel its open waiters and operation timers.
4. Detach and prepare settlement of each pending GET or SET exactly once.
5. Remove subscription and unsubscribe listeners and clear generation-local cache entries.
6. Prepare active subscription observers to receive the appropriate typed transport Error exactly once.
7. Make old unsubscribe handles harmless and idempotent.
8. Close the native socket when required.
9. Clear operation-owned collections before invoking Promise or observer callbacks, then deliver the prepared settlements in the callback order defined above so reentrant code cannot observe half-retired state.
10. Never read from or delete state belonging to a later generation.

Unexpected native close and liveness invalidation should enter the same existing reconnect/backoff path. Explicit stop must not reconnect. Atomic restart must create one immediate replacement without waiting for the old socket's delayed native close event.

### 5. Refactor all proxy operations onto generation-local records

In `src/init-client-proxy.js`, give each operation an explicit record containing its generation, operation kind, request ID when allocated, timer, send state, and settled flag.

#### GET

-   Require the current generation to be `OPEN` before registration; otherwise return a Promise already rejected with `SmolRpcUnavailableError`.
-   Bind timeout cleanup to the captured generation map.
-   Remove all state before resolving or rejecting.
-   Reject immediately on generation retirement instead of allowing an old five-second timer to survive reconnect.

#### SET

-   Track at least `waiting`, `registered`, `sending`, `sent`, and `settled` state.
-   If retaining wait-for-open behavior, bind the waiter only to the current `CONNECTING` generation.
-   Do not queue a SET when there is no current generation during a closed/backoff gap.
-   Cancel a waiting SET when its generation is stopped, restarted, or invalidated.
-   Once `socket.send()` returns successfully, classify a lost response or timeout as mutation outcome unknown.
-   Never retry or replay a sent SET.

#### Subscribe

-   Bind each logical subscribable and cache entry to the current generation at construction.
-   If its first observer arrives after that generation retires, fail without sending.
-   On `RequestReject` or protocol failure, remove listener/cache state before erroring observers.
-   On retirement, detach the listener, clear cached replay data, and error current observers once.
-   Do not preserve a logical subscription descriptor for automatic reconstruction.

#### Unsubscribe

-   Remove the local observer first and send only when the final observer leaves.
-   Remove the original subscription listener and cache entry once.
-   Register unsubscribe response bookkeeping before sending the frame.
-   Bind that bookkeeping to the same generation as the subscription.
-   If the generation retires, discard it without affecting any replacement-generation subscription.

### 6. Make registration and send transactional

For every operation type:

1. Allocate the request ID from the captured generation.
2. Build and serialize the frame before registration where practical.
3. Register the listener, timer, cache entry, and operation record against that generation.
4. Call `generation.socket.send()` only after the response listener exists.
5. If serialization or `send()` throws, synchronously roll back every registration and settle the operation once.

A failed subscribe send must not leave a cached subscribable. A failed unsubscribe send must not leave a response listener. A failed operation must not prevent later valid operations in the same still-current generation.

The transport send function must verify both that the captured generation is current and that its socket is `OPEN`; checking a wrapper-level readiness value alone is insufficient.

### 7. Add stable typed client errors

Add and publicly export the concrete `SmolRpcError` hierarchy defined above, covering:

-   `SmolRpcUnavailableError` / `SMOLRPC_UNAVAILABLE`
-   `SmolRpcTimeoutError` / `SMOLRPC_TIMEOUT`
-   `SmolRpcServerRejectionError` / `SMOLRPC_SERVER_REJECTION`
-   `SmolRpcProtocolError` / `SMOLRPC_PROTOCOL_ERROR`
-   `SmolRpcMutationOutcomeUnknownError` / `SMOLRPC_MUTATION_OUTCOME_UNKNOWN`
-   `SmolRpcSerializationError` / `SMOLRPC_SERIALIZATION`
-   `SmolRpcSendError` / `SMOLRPC_SEND_FAILED`

Implement concrete exported Error subclasses, not an alternative discriminated shape. Every class extends an exported `SmolRpcError`; each instance has a read-only literal `code`. The shared constructor contract is `(message: string, metadata?: SmolRpcErrorMetadata)`, where metadata contains only optional `operation`, `resource`, `requestId`, `generation`, `readyState`, and `elapsedMs` fields. `operation` is `'get' | 'set' | 'subscribe' | 'unsubscribe'`. Do not attach params, arbitrary request bodies, response payloads, cookies, authentication material, or raw request/response objects. Existing messages that include params must be changed accordingly.

Preserve useful existing message text where practical, but callers must be able to branch on class or code rather than matching strings. A SET whose frame was successfully handed to the socket but whose result is lost must use the outcome-unknown type, not the ordinary timeout type.

Put runtime classes in a dedicated client-errors module. Export the base class, all concrete classes, error metadata/code types, `ReadyStates`, `ReadyState`, `ClientMethods`, and `ClientTransportSnapshot` from the package root. Update `index.js`, the declaration source `index.d.ts`, `src/client.types.ts`, and generated `types/index.d.ts`; verify both runtime and type-only package imports.

### 8. Add explicit, idempotent lifecycle methods

Preserve the existing `open()` and `close()` names while making their behavior unambiguous:

-   `close()`: idempotent stop; synchronously make the current generation unavailable, cancel reconnect, retire current work, close the socket, and remain stopped.
-   `open()`: idempotent start when stopped; duplicate calls while connecting or open do not create another socket.
-   `restart()`: atomic immediate replacement for authentication changes while running; retire the old generation, cancel stale reconnect work, and create exactly one replacement without waiting for old native close. Sequential calls are distinct intents rather than idempotent duplicates.
-   `invalidate()`: declare the current generation untrustworthy; retire it and enter the normal coalesced reconnect/backoff path rather than opening a parallel socket immediately.

Apply the command-state matrix in **Resolved design contracts**. Concurrent `invalidate()` calls, a timeout followed by native close, and duplicate native failures must coalesce into one retirement and one reconnect path.

Expose the exact `getTransportSnapshot()` contract defined above. Update state before invoking existing public socket callbacks. This lets applications gate work without mirroring SMOLRPC's private transport state. Do not add an application-ready concept: each user application remains responsible for its own health-check or bootstrap handshake.

Update `ClientMethods` and event declarations in `src/client.types.ts`. Existing native event hooks keep their signatures, but stale-generation native events must not be presented as current lifecycle events. In particular, caller-retired sockets never emit `webSocketEvents.close`.

### 9. Complete the package regression matrix

Add deterministic tests for all of the following:

1. Delayed old-socket `open`, `message`, `error`, and `close` after replacement; none changes replacement state or current listeners, and none invokes a public native hook.
2. A stale reconnect timer after stop or restart; it creates no socket and emits no reconnect event.
3. An old response with a reused numeric ID; it cannot settle a replacement-generation operation.
4. An old GET timer firing after replacement; it cannot delete a new listener.
5. GET close-versus-timeout races; the Promise rejects once and all old state is gone.
6. A SET waiting during authentication restart; it is canceled and never sent on the replacement.
7. A sent SET followed by close or timeout; it rejects as outcome unknown and is never replayed.
8. Subscription retirement; observers error once, old cache is removed, and a new generation can create a fresh subscription.
9. A subscribable created in generation A and first observed in generation B; it fails without sending.
10. Old unsubscribe handles and delayed unsubscribe responses; neither affects replacement subscriptions.
11. `RequestReject` and unexpected message types for every operation; state is cleaned before callbacks run.
12. Serialization or `send()` throwing for GET, SET, subscribe, and unsubscribe; listener/cache/timer rollback is complete.
13. A response delivered synchronously from fake `send()`; the listener already exists.
14. Concurrent invalidations; exactly one backoff timer and one replacement attempt result.
15. `createWebSocket()` throwing: initial `initClient()` and explicit start clean up and rethrow without a timer or lifecycle hook, while automatic reconnect and `restart()` retire the failed attempt and uniquely schedule the next backoff without throwing.
16. Reentrant Promise/observer callbacks that start new work; they see either the current healthy generation or a typed unavailable Error, never half-retired state.
17. Typed Error classes/codes and safe metadata.
18. Explicit assertions that GETs are not retried, SETs are not replayed, and subscriptions are not automatically reconstructed.
19. Reentrant `message` and `send` hooks that restart or close; the old frame is neither dispatched nor sent.
20. A native `error` without `close`; it emits diagnostics but does not retire the generation or alter readiness.
21. Terminal subscribables; later observers receive the same typed Error without sending, while a fresh cached lookup creates a new object.
22. Unsubscribe rejection, send failure, protocol failure, and five-second timeout; each cleans response bookkeeping and reports diagnostics without touching replacement state.
23. Every lifecycle command-state matrix entry and every transport snapshot transition.
24. `cache: true`, `cache: false`, cached last-value replay, terminal cache eviction, and repeated unsubscribe handles.
25. Native close after caller-initiated `close()`, `restart()`, or `invalidate()`; it never invokes `webSocketEvents.close`, changes state, or schedules reconnect.

Retain baseline tests for normal GET, SET, subscribe/cache, unsubscribe, server rejection, explicit stop/start, and automatic reconnect behavior.

### 10. Document, publish, and verify the release

Update the package README with:

-   the connection-generation ownership model;
-   exact `open`, `close`, `restart`, and `invalidate` semantics;
-   operation behavior on timeout, close, and replacement;
-   the mutation-outcome-unknown warning;
-   the fact that applications own GET retry and subscription reconstruction policy;
-   typed Error classes/codes and safe handling examples;
-   the 0.56 raw-event change: caller-retired sockets do not invoke `webSocketEvents.close`;
-   migration guidance to publish application-unavailable state before calling lifecycle methods and to replace authentication-related `close(); open()` sequences with `restart()`.

Use exact-pinned Vitest and define non-recursive scripts with these responsibilities:

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

Remove the current `publish` lifecycle script that invokes `npm publish` recursively. Publishing is performed with the ordinary `npm publish` command, which invokes `prepublishOnly`. Keep formatting separate from build so verification does not modify the repository after linting. Update `package-lock.json` and add runtime/type-only package-export smoke tests in addition to inspecting generated `types/index.d.ts`, source exports, and the packed file list.

Publish as exact version `0.56.0`. Document that applications should exact-pin the release and verify immediate authentication replacement, lifecycle-root timeout invalidation, identity reconstruction, ordinary reconnect, and resumed live convergence. Consumer integration tests complement but do not replace the package-level fake-socket and fake-timer regressions.

## Acceptance criteria

The implementation is complete when:

-   Every native callback and reconnect timer proves current-generation ownership before acting.
-   Delayed events from an old socket cannot alter readiness, invoke current lifecycle callbacks, or dispatch to current listeners; native close from any caller-retired socket is suppressed.
-   Request IDs, listeners, timers, waiters, and subscription caches cannot be deleted or settled by another generation.
-   Closing, restarting, or invalidating settles all generation-owned work exactly once.
-   A queued SET cannot cross an authentication replacement.
-   A sent SET is never replayed and reports unknown outcome when its response is lost.
-   Failed serialization or send leaves no listener, timer, cache, waiter, or unsubscribe registration behind.
-   `close()`, `open()`, and `invalidate()` are idempotent; every sequential `restart()` is a distinct intent but never creates parallel current sockets.
-   Concurrent failure signals produce one reconnect/backoff path, not parallel sockets.
-   Callers can distinguish unavailable, timeout, server rejection, protocol failure, serialization failure, send failure, and unknown mutation outcome without matching Error messages.
-   Error metadata contains no params, payloads, cookies, authentication data, or raw protocol objects.
-   `getTransportSnapshot()` and public ready-state exports match the documented stopped, connecting, open, and backoff transitions.
-   Initial or explicit-start socket-construction failure cleans up and rethrows without reconnect, while reconnect/restart construction failure schedules one backoff path.
-   The wire protocol and typed resource API remain compatible.
-   All deterministic lifecycle and operation tests pass and are required by the publish workflow.

## Risks and implementation cautions

-   **Reentrancy:** Promise rejection and observer error callbacks can immediately invoke client methods. Clear old generation state before invoking them.
-   **Synchronous test sockets:** A fake can invoke callbacks inside `send()` or `close()`. Listener registration and generation guards must remain correct under synchronous delivery.
-   **Close/timeout races:** Both paths may attempt settlement. Operation-local settled guards are mandatory.
-   **Backoff ownership:** Restart and stop must cancel pending reconnect tokens. Stale opens must not reset backoff.
-   **Mutation ambiguity:** Once `socket.send()` succeeds, absence of a response cannot prove that the server did not commit the SET.
-   **Compatibility during rollout:** Active subscriptions should now error promptly on generation retirement rather than hang. Caller-retired sockets also no longer invoke the raw `close` hook. Document both changes clearly so applications publish unavailable state before lifecycle calls, replace authentication `close(); open()` sequences with `restart()`, and deploy compatible lifecycle-root recovery.
-   **Diagnostics versus correctness:** Generation IDs and typed Error metadata are useful, but richer backend correlation, last-message timing, heartbeat behavior, and payload diagnostics should not delay the ownership fix.
