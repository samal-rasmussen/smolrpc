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

## What is smolrpc?

smolrpc is a lightweight Remote Procedure Call (RPC) library that enables type-safe communication between clients and servers over WebSockets.

### What is RPC?

Remote Procedure Call (RPC) is a protocol that allows a program to execute code on another machine without having to worry about the underlying network details. smolrpc implements this pattern with TypeScript type safety and WebSockets as the transport layer.

### Features

smolrpc allows you to:

-   Define your API in one place using TypeScript and Zod
-   Get automatic type-checking on both client and server
-   Support three operations on user-defined resources: GET, SET, and SUBSCRIBE
-   Use statically typed resource URLs with parsed parameters
-   Have minimal dependencies (only Zod for runtime type-checking)

### Inspiration

smolrpc was inspired by typesafe TypeScript APIs like [tRPC](https://trpc.io/), [ts-rest](https://ts-rest.com/), and [Zodios](https://www.zodios.org/), and by the WebSocket API as implemented in [Sockette](https://github.com/lukeed/sockette).

## Quick Start

### 1. Define your resources

First, define your API using a resource object with Zod schemas:

```ts
// resources.ts
import { z } from 'zod';
import { AnyResources } from 'smolrpc';

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
import { Router } from 'smolrpc';
import { Resources } from './resources';
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
import { Resources, resources } from './resources';
import { router } from './router';

const smolrpcServer = initServer<Resources>(router, resources, {
	serverLogger: {
		receivedRequest: (request, clientId, remoteAddress) => {
			console.log(
				`${clientId} ${remoteAddress} ${JSON.stringify(request)}`,
			);
		},
		// other optional logger functions
	},
});

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
import { Resources } from './resources';
import { WebSocket as ws } from 'ws'; // Only for Node.js environments

const { client } = await initClient<Resources>({
	url: 'ws://localhost:9200',
	// For Node.js environments
	createWebSocket: (url) => new ws(url) as any as WebSocket,
	onopen: () => console.log('Connected to server'),
	onclose: (event) => console.log(`Closed with code ${event.code}`),
});

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

One of smolrpc's most powerful features is how the client automatically implements the right methods for each resource without you having to write any client-side implementation code.

The client is created using JavaScript's Proxy object, which intercepts property access. When you access a resource path like `client['/posts']`, the proxy:

1. Intercepts the property access and forwards it to handler functions
2. Returns an object with methods (`get`, `set`, and/or `subscribe`) corresponding to the operations supported by that resource
3. Handles WebSocket message routing between requests and responses

TypeScript provides the compile-time type checking and enforces that:

-   Only defined resource paths are accessible
-   Only methods defined in the resource's `type` field are available
-   Parameters and return types match your Zod schemas
-   URL parameters are required and type-checked

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
		request?: z.ZodTypeAny; // Zod schema for request data
		response: z.ZodTypeAny; // Zod schema for response data
		type: 'get' | 'set' | 'subscribe' | 'get|set' | 'get|subscribe' | 'set|subscribe' | 'get|set|subscribe';
		cache?: boolean; // Optional: controls subscription caching behavior
	}
}
```

URL Parameters are defined with a colon prefix (`:paramName`) and are automatically parsed as string/number parameter objects.

### Client API

#### `initClient<Resources>(options)`

Initializes a client for communicating with the server.

Parameters:

-   `url`: WebSocket server URL
-   `createWebSocket?`: Function to create a WebSocket instance (required in environments without native WebSocket)
-   `onopen?`: Event handler for connection open
-   `onmessage?`: Event handler for raw messages
-   `onreconnect?`: Event handler for reconnection attempts
-   `onclose?`: Event handler for connection close
-   `onerror?`: Event handler for errors
-   `onsend?`: Event handler when sending a request

Returns:

-   `client`: The proxy object for making API calls
-   `clientMethods`: Helper methods for managing the connection
    -   `open()`: Open the connection
    -   `close()`: Close the connection

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

#### `initServer<Resources>(router, resources, options?)`

Initializes a server for handling client requests.

Parameters:

-   `router`: Object mapping resource paths to handler functions
-   `resources`: Resource definitions object
-   `options?`: Optional configuration
    -   `serverLogger?`: Object with logging functions

Returns:

-   `addConnection`: Function to register a new WebSocket connection

### Connection Lifecycle

smolrpc handles the WebSocket connection lifecycle automatically:

1. **Initialization**: The client attempts to connect to the server when created
2. **Open**: The connection is established and ready for communication
3. **Message Exchange**: Requests/responses flow between client and server
4. **Reconnection**: Automatic reconnection attempts with exponential backoff if the connection is lost
5. **Close**: The connection is explicitly closed by the client or server

## Advanced Usage

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

### Server Logging

The server can log various events through the `serverLogger` option:

```ts
const server = initServer<Resources>(router, resources, {
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

smolrpc supports secure HTTP-only cookie authentication, which is ideal for browser-based applications. For detailed implementation instructions, see the [Authentication Guide](authentication.md).

## Troubleshooting

### Common Issues

-   **WebSocket Not Found**: In Node.js or other environments without native WebSocket support, use the `createWebSocket` option
-   **Type Errors**: Ensure your Zod schemas match the actual data being sent/received
-   **Connection Issues**: Check network connectivity and WebSocket server availability

## How to Run Examples

Run these commands in separate terminals:

```bash
# Type checking
npm run check

# Run the server
npm run nodejs-server

# Run a client example
npm run nodejs-client
```

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests on the [GitHub repository](https://github.com/samal-rasmussen/smolrpc).

## License

MIT
