# smolrpc

A really smol typesafe RPC implementation over WebSockets.

## Table of Contents

-   [Installation](#installation)
-   [What is smolrpc?](#what-is-smolrpc)
-   [Quick Start](#quick-start)
-   [How Type Safety Works](#how-type-safety-works)
-   [API Reference](#api-reference)
-   [Advanced Usage](#advanced-usage)
-   [Troubleshooting](#troubleshooting)
-   [How to Run Examples](#how-to-run-examples)
-   [Contributing](#contributing)
-   [License](#license)

## Installation

```bash
npm install smolrpc
```

Applications also need a Standard Schema-compatible schema library; the examples below use Zod (`npm install zod`). In runtimes without a global `WebSocket`, install a WebSocket implementation such as `ws` and pass it to `initClient`.

## What is smolrpc?

smolrpc is a lightweight Remote Procedure Call (RPC) library that enables type-safe communication between clients and servers over WebSockets.

### What is RPC?

Remote Procedure Call (RPC) is a protocol that allows a program to execute code on another machine without having to worry about the underlying network details. smolrpc implements this pattern with TypeScript type safety and WebSockets as the transport layer.

### Features

smolrpc allows you to:

-   Define your API in one place using TypeScript and Standard Schema
-   Get automatic type-checking on both client and server
-   Support three operations on user-defined resources: GET, SET, and SUBSCRIBE
-   Use statically typed resource paths and path parameters
-   Bring your own Standard Schema-compatible schema library, such as Zod

### Inspiration

smolrpc was inspired by typesafe TypeScript APIs like [tRPC](https://trpc.io/), [ts-rest](https://ts-rest.com/), and [Zodios](https://www.zodios.org/), and by the WebSocket API as implemented in [Sockette](https://github.com/lukeed/sockette).

## Quick Start

### 1. Define your resources

First, define your API using a resource object with Zod schemas:

```ts
// resources.ts
import { z } from 'zod';
import type { AnyResources } from 'smolrpc';

const post = z.object({
	content: z.string(),
	id: z.string(),
});

export const resources = {
	'/posts': {
		response: z.array(post),
		type: 'get|subscribe',
	},
	'/posts/:postId': {
		response: post,
		type: 'get|subscribe',
	},
	'/posts/:postId/create': {
		request: post.omit({ id: true }),
		response: post,
		type: 'set',
	},
} as const satisfies AnyResources;

export type Resources = typeof resources;
```

### 2. Set up the server

Create a router to handle the requests for your resources:

```ts
// router.ts
import type { Router } from 'smolrpc';
import type { Resources } from './resources';
import { db } from './db'; // your data source

export const router = {
	'/posts': {
		get: async ({ resource }) => {
			return db.getAll(resource);
		},
		subscribe: ({ resourceWithParams }) => {
			return db.subscribe(resourceWithParams);
		},
	},
	'/posts/:postId': {
		get: async ({ resourceWithParams }) => {
			return db.get(resourceWithParams);
		},
		subscribe: ({ resourceWithParams }) => {
			return db.subscribe(resourceWithParams);
		},
	},
	'/posts/:postId/create': {
		set: async ({ params, request }) => {
			return db.set(`/posts/${params.postId}`, {
				...request,
				id: params.postId,
			});
		},
	},
} as const satisfies Router<Resources>;
```

Initialize your server with WebSockets:

```ts
// server.ts
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { initServer } from 'smolrpc';
import { resources } from './resources';
import { router } from './router';

const smolrpcServer = initServer(router, resources);

const server = createServer();
const wss = new WebSocketServer({ server });

wss.on('connection', function connection(ws, req) {
	const remoteAddress = req.socket.remoteAddress;
	smolrpcServer.addConnection(ws, remoteAddress);
});

server.listen(9200, () => {
	console.log('Server listening on port 9200');
});
```

### 3. Use the client

Initialize and use the typesafe client:

```ts
// client.ts
import { initClient } from 'smolrpc';
import type { Resources } from './resources';
import { WebSocket as NodeWebSocket } from 'ws'; // Only when no global WebSocket exists

let resolveConnected: () => void;
const connected = new Promise<void>((resolve) => {
	resolveConnected = resolve;
});

const { client } = initClient<Resources>({
	url: 'ws://localhost:9200',
	createWebSocket: (url) => new NodeWebSocket(url) as unknown as WebSocket,
	reportInternalError: (message, data) => console.error(message, data),
	webSocketEvents: {
		open: () => resolveConnected(),
		close: (event) => console.log(`Closed with code ${event.code}`),
	},
});

await connected;

// Get all posts
const posts = await client['/posts'].get();
console.log(posts); // Type: { content: string; id: string; }[]

// Get a specific post
const post123 = await client['/posts/:postId'].get({
	params: { postId: '123' },
});
console.log(post123); // Type: { content: string; id: string; }

// Create a post
const newPost = await client['/posts/:postId/create'].set({
	params: { postId: '456' },
	request: { content: 'New post content' },
});
console.log(newPost);

// Subscribe to changes on a post
client['/posts/:postId']
	.subscribe({
		params: { postId: '123' },
		cache: true, // Optional: reuse existing subscription
	})
	.subscribe({
		next: (post) => {
			console.log('Post updated:', post);
		},
		error: (err) => {
			console.error('Subscription error:', err);
		},
		complete: () => {
			console.log('Subscription completed');
		},
	});
```

## How Type Safety Works

The `Client<Resources>` type derives the available paths, operations, arguments, and results from the shared resource contract. At runtime, a JavaScript `Proxy` routes client operations over the WebSocket; the server validates the requested resource and operation before dispatching it.

TypeScript enforces that:

-   Only defined resource paths are accessible
-   Only methods defined in the resource's `type` field are available
-   Parameters and return types match your Standard Schema schemas
-   Path parameters are required and type-checked

Schema transformations follow the runtime validation boundaries. Client request arguments and request wire values are request-schema inputs. The server validates them and passes parsed request-schema outputs to router handlers. Router GET/SET returns, subscription emissions, and the `Result<Resources, Resource>` helper are response-schema inputs; the server validates them and sends response-schema outputs. Client GET/SET results, subscription values, and protocol responses/events are therefore response-schema outputs.

This separation of concerns means runtime behavior is handled by JavaScript (the Proxy and WebSocket communication), while type safety is enforced by TypeScript at compile time:

```ts
// TypeScript enforces that this path exists and supports 'get'
const posts = await client['/posts'].get();
// TypeScript knows the return type from your Zod schema

// TypeScript would show a compile-time error if '/posts' didn't support 'subscribe'
// or if the parameters were missing/incorrect
client['/posts/:postId'].subscribe({
	params: { postId: '123' },
});
```

## API Reference

### Resource Definition

Resources are defined as an object where each key is a URL-like path, and the value describes the resource:

```ts
{
	[path: string]: {
		request?: StandardSchemaV1; // Required for SET; optional for GET and SUBSCRIBE
		response: StandardSchemaV1; // Standard Schema for response data
		type: 'get' | 'set' | 'subscribe' | 'get|set' | 'get|subscribe' | 'set|subscribe' | 'get|set|subscribe';
	}
}
```

Path parameters are defined with a colon prefix (`:paramName`). Callers supply string or number values for those parameters, and smolrpc materializes them into the wire resource path. Parameter keys must exactly match every colon-prefixed placeholder; merely supplying the same number of differently named keys is invalid.

Subscription caching is configured per `subscribe()` call with `cache`; it defaults to `true`.

### Client API

#### `initClient<Resources>(options)`

Initializes a client for communicating with the server.

Parameters:

-   `url`: WebSocket server URL
-   `createWebSocket?`: Function to create a WebSocket instance (required in environments without native WebSocket)
-   `reportInternalError`: Required callback for sanitized internal diagnostics that cannot be returned through an operation
-   `webSocketEvents`: Object with logical lifecycle and raw WebSocket event handlers
    -   `open?`: Event handler for connection open
    -   `message?`: Event handler for raw messages
    -   `statechange?`: Logical transport state handler (`stopped`, `connecting`, `open`, `unavailable`, or `backoff`)
    -   `reconnect?`: Raw notification after a successful automatic backoff attempt constructs and publishes a socket
    -   `close?`: Raw native connection-close handler
    -   `error?`: Raw native socket-error handler
    -   `send?`: Raw handler invoked before sending a request

Returns:

-   `client`: The proxy object for making API calls
-   `clientMethods`: Connection lifecycle controls
    -   `close()`: Stop connection management and cancel current/backoff work
    -   `open()`: Start only from stopped and attempt immediately
    -   `restart()`: Replace immediately while management is running
    -   `invalidate()`: Mark the running transport unhealthy and recover through normal backoff

#### Client Methods

For any resource with `type` including `get`:

```ts
client['/path/:param'].get({ params: { param: 'value' } });
```

For any resource with `type` including `set`:

```ts
client['/path/:param'].set({
	params: { param: 'value' },
	request: {
		/* data matching the request schema */
	},
});
```

For any resource with `type` including `subscribe`:

```ts
client['/path/:param'].subscribe({
	params: { param: 'value' },
	cache: true, // optional, defaults to true
});
```

### Server API

#### `initServer(router, resources, options?)`

Initializes a server for handling client requests. The resource contract is inferred from `resources`, and `router` must implement that same contract; an explicit generic argument is not needed.

Parameters:

-   `router`: Object mapping resource paths to handler functions
-   `resources`: Resource definitions object
-   `options?`: Optional configuration
    -   `serverLogger?`: Object with logging functions

Returns:

-   `addConnection`: Function to register a new WebSocket connection

### Connection Lifecycle

The client starts connection management during initialization. Unexpected native closes retire all work owned by that connection and recover using jittered backoff. Use the lifecycle method that matches the application's intent:

| Intent                           | Method         | Recovery behavior                                           | Typical reason                                                          |
| -------------------------------- | -------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| Deliberately stop management     | `close()`      | Retire/cancel current work and remain stopped               | The application no longer wants a connection                            |
| Deliberately start management    | `open()`       | From stopped, reset backoff and attempt immediately         | Resume a stopped client                                                 |
| Replace the connection now       | `restart()`    | While running, reset/bypass backoff and attempt immediately | Authentication, identity, tenant, or connection inputs changed          |
| Declare the connection unhealthy | `invalidate()` | While running, preserve/enter normal delayed backoff        | Immediate replacement may repeat a transient health or protocol failure |

`restart()` is a no-op while deliberately stopped. Unlike `close(); open()`, it has no intermediate stopped intent and a replacement-constructor failure continues through automatic backoff. `close(); open()` resets backoff, attempts immediately, and an explicit-open constructor failure is rethrown while the client remains stopped. `invalidate()` is delayed, preserves backoff history, and keeps an existing backoff timer instead of creating another one; constructor failures during that automatic recovery remain contained and continue through backoff.

#### Logical and raw lifecycle events

`webSocketEvents.statechange` reports logical client states independently of native events:

-   `stopped`: automatic connection management is disabled;
-   `connecting`: a socket is being constructed or is awaiting native open;
-   `open`: the current generation is authoritative and open;
-   `unavailable`: a generation was retired and its transport-owned work was detached; and
-   `backoff`: management is running but waiting before another attempt.

`stopped` and `backoff` are intentionally different: `open()` starts only from stopped, while `restart()` can bypass backoff and `invalidate()` preserves it. The `open`, `message`, `error`, and `close` callbacks are raw events from only the current socket. A socket retired by `close()`, `restart()`, or `invalidate()` does not later emit a raw `close` callback. A native `error` does not trigger recovery without a native close.

The raw `reconnect` hook runs only after a still-current **automatic backoff attempt** successfully constructs a socket, installs handlers, and publishes it. It does not mean that native open has fired, and it does not run for initialization, explicit `open()`, the immediate attempt made by `restart()`, failed construction, or superseded attempts.

#### Recovering an application lifecycle root

An application may designate a GET such as readiness or current identity as the root of its own lifecycle. If that request times out while the socket still appears open, the application can branch on the stable error code and invalidate the generation:

```ts
import { SmolRpcError } from 'smolrpc';

try {
	await client['/readiness'].get();
} catch (error) {
	if (error instanceof SmolRpcError && error.code === 'SMOLRPC_TIMEOUT') {
		clientMethods.invalidate();
		return;
	}
	throw error;
}
```

Do not invalidate automatically for ordinary RPC timeout or rejection: those failures are operation-local unless the application knows the resource is lifecycle-critical. `invalidate()` only performs the transport action. It does not replay the GET, revive a terminated stream, or reconstruct subscriptions. After a later logical `open`, application recovery code must explicitly issue a fresh root request and create fresh subscriptions.

## Advanced Usage

### BigInt protocol values

The package-root `json_stringify` and `json_parse` exports provide BigInt-aware JSON encoding. Production client and server protocol traffic uses this codec, so BigInt values can be carried in requests, validated responses, and subscription events when the resource schemas allow them. Use the exported codec when manually inspecting frames.

Schema values that cross the connection must preserve their runtime type and meaning through a `json_stringify`/`json_parse` round trip. Ordinary JSON data and BigInt are supported. Values such as `Date`, `Map`, `Set`, class instances, non-finite numbers, and objects with type-changing `toJSON()` methods are not revived as their original runtime types. Transform those values to a codec-stable representation in the schema, such as an ISO string for a date, and reconstruct richer application objects outside the RPC boundary.

### Subscription Management

Subscriptions return a standard observable-like interface:

```ts
const subscription = client['/resource'].subscribe(/* options */);

// Start receiving updates
const unsubscribable = subscription.subscribe({
	next: (value) => {
		/* handle value */
	},
	error: (err) => {
		/* handle error */
	},
	complete: () => {
		/* handle completion */
	},
});

// Stop receiving updates
unsubscribable.unsubscribe();
```

Creating a subscribable requires a currently open connection and otherwise throws `SmolRpcError` with code `SMOLRPC_UNAVAILABLE`. Reactive code that wants this failure delivered through its reactive error channel should construct it lazily inside that channel (for example with the reactive library's `defer` operator), rather than eagerly calling `client[path].subscribe()` first. Subscriptions belong to one connection generation and terminate when it is retired; they are never replayed on a replacement.

### Client Errors

Client operations fail with `SmolRpcError`. Branch on `error.code`, not message text. Codes include unavailable transport, timeout, server rejection, protocol error, serialization failure, native send failure, and `SMOLRPC_MUTATION_OUTCOME_UNKNOWN`.

A GET made without an open connection returns a rejected Promise and is never retried. A SET created while its current generation is connecting may wait only for that generation; it never moves to or replays on a replacement. A SET that was accepted by native `send()` is never retried automatically. A later timeout, retirement, or malformed response produces `SMOLRPC_MUTATION_OUTCOME_UNKNOWN` because the server may already have applied the mutation. Treat that outcome as ambiguous rather than assuming a retry is safe.

### Client Error Logging

`reportInternalError` is only for non-operation diagnostics and failures that cannot be returned to a caller, such as unsubscribe acknowledgement timeout. It receives sanitized metadata, not request payloads or credentials. Raw transport activity still belongs in `webSocketEvents`.

```ts
const { client } = initClient<Resources>({
	url: 'ws://localhost:9200',
	reportInternalError: (message, data) => {
		/* ... */
	},
	webSocketEvents: {},
});
```

### Server Logging

The server can log various events through the `serverLogger` option:

```ts
const server = initServer(router, resources, {
	serverLogger: {
		receivedRequest: (request, clientId, remoteAddress) => {
			/* ... */
		},
		sentResponse: (request, response, clientId, remoteAddress) => {
			/* ... */
		},
		sentEvent: (request, event, clientId, remoteAddress) => {
			/* ... */
		},
		sentReject: (request, reject, clientId, remoteAddress, error) => {
			/* ... */
		},
	},
});
```

### Authentication

Authentication is application-owned. Browser applications can integrate HTTP-only cookie authentication as described in the [Authentication Guide](authentication.md).

## Troubleshooting

### Common Issues

-   **WebSocket Not Found**: In runtimes without native WebSocket support, use the `createWebSocket` option
-   **Type Errors**: Ensure your Standard Schema-compatible schemas match the actual data being sent and received
-   **Connection Issues**: Check network connectivity and WebSocket server availability

## How to Run Examples

Run these commands in separate terminals:

```bash
# Type checking
npm run typecheck

# Run the server
npm run nodejs-server

# Run a client example
npm run nodejs-client
```

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests on the [GitHub repository](https://github.com/samal-rasmussen/smolrpc).

## License

MIT
