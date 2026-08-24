# Authentication with smolrpc

smolrpc works well with HTTP-only cookie authentication for secure browser-based applications. This approach keeps authentication credentials secure by:

1. Using HTTPS-only cookies that JavaScript cannot access
2. The server validates authentication while the browser automatically handles cookie management
3. WebSocket connections automatically include cookies during handshake

## Server-Side Implementation

First, set up HTTP routes for authentication alongside your WebSocket server:

```ts
// server.ts
import { createServer } from 'http';
import { parse as parseUrl } from 'url';
import { WebSocketServer } from 'ws';
import { initServer } from 'smolrpc';
import { Resources, resources } from './resources';
import { router } from './router';

// Parse cookies from header
function parseCookies(cookieHeader) {
	const cookies = {};
	if (!cookieHeader) return cookies;

	cookieHeader.split(';').forEach((cookie) => {
		const [name, value] = cookie.trim().split('=');
		cookies[name] = decodeURIComponent(value);
	});

	return cookies;
}

// Serialize cookies to string
function serializeCookie(name, value, options = {}) {
	let cookie = `${name}=${encodeURIComponent(value)}`;

	if (options.httpOnly) cookie += '; HttpOnly';
	if (options.secure) cookie += '; Secure';
	if (options.sameSite) cookie += `; SameSite=${options.sameSite}`;
	if (options.maxAge) cookie += `; Max-Age=${options.maxAge}`;

	return cookie;
}

// Create HTTP server
const server = createServer(async (req, res) => {
	const url = parseUrl(req.url, true);

	// Handle login route
	if (url.pathname === '/api/login' && req.method === 'POST') {
		let body = '';

		// Collect request body
		req.on('data', (chunk) => {
			body += chunk.toString();
		});

		req.on('end', async () => {
			try {
				// Parse JSON body
				const { username, password } = JSON.parse(body);

				// Your authentication logic
				const user = await authenticateUser(username, password);

				if (!user) {
					res.statusCode = 401;
					res.end(JSON.stringify({ error: 'Invalid credentials' }));
					return;
				}

				// Create session
				const sessionId = createSession(user.id);

				// Set HTTP-only, secure cookie
				res.setHeader(
					'Set-Cookie',
					serializeCookie('session', sessionId, {
						httpOnly: true, // Prevents JavaScript access
						secure: true, // Requires HTTPS
						sameSite: 'Strict', // Provides CSRF protection
						maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
					}),
				);

				res.statusCode = 200;
				res.setHeader('Content-Type', 'application/json');
				res.end(JSON.stringify({ success: true }));
			} catch (error) {
				res.statusCode = 500;
				res.end(JSON.stringify({ error: 'Server error' }));
			}
		});
	}
	// Handle logout route
	else if (url.pathname === '/api/logout' && req.method === 'POST') {
		// Clear the cookie by setting expiry in the past
		res.setHeader(
			'Set-Cookie',
			serializeCookie('session', '', {
				httpOnly: true,
				secure: true,
				sameSite: 'Strict',
				maxAge: 0, // Expire immediately
			}),
		);

		res.statusCode = 200;
		res.setHeader('Content-Type', 'application/json');
		res.end(JSON.stringify({ success: true }));
	}
	// Handle other routes
	else {
		res.statusCode = 404;
		res.end('Not Found');
	}
});

// Initialize smolrpc server
const smolrpcServer = initServer<Resources>(router, resources);

// Set up WebSocket server with auth verification
const wss = new WebSocketServer({
	server,
	verifyClient: (info, callback) => {
		const cookies = parseCookies(info.req.headers.cookie);
		const sessionId = cookies['session'];

		// Verify the session is valid
		const isValid = verifySession(sessionId);

		if (!isValid) {
			callback(false, 401, 'Unauthorized');
			return;
		}

		callback(true);
	},
});

// Handle WebSocket connections
wss.on('connection', function connection(ws, req) {
	const remoteAddress = req.socket.remoteAddress;
	smolrpcServer.addConnection(ws, remoteAddress);
});

// Start the server
server.listen(9200, () => {
	console.log('Server running on port 9200');
});
```

## Client-Side Implementation

On the client side, keep one client runtime and call `restart()` after a cookie or identity change. This immediately replaces the running connection without publishing an intermediate stopped state:

```ts
// client.ts
import { initClient } from 'smolrpc';
import { Resources } from './resources';

const { client, clientMethods } = initClient<Resources>({
	url: 'ws://localhost:9200',
	// Browsers automatically include cookies in the WebSocket handshake.
	reportInternalError: (message, data) => console.error(message, data),
	webSocketEvents: {
		open: () => console.log('Connected to server'),
		close: (event) => {
			console.log(`Connection closed with code ${event.code}`);
		},
	},
});

async function login(username, password) {
	try {
		const response = await fetch('/api/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username, password }),
			credentials: 'include',
		});

		if (!response.ok) throw new Error('Login failed');

		// The replacement handshake includes the new authentication cookie.
		clientMethods.restart();
		return true;
	} catch (error) {
		console.error('Login error:', error);
		return false;
	}
}

async function logout() {
	try {
		const response = await fetch('/api/logout', {
			method: 'POST',
			credentials: 'include',
		});

		if (!response.ok) throw new Error('Logout failed');

		// This server rejects unauthenticated WebSocket connections, so stop
		// connection management rather than entering automatic reconnect backoff.
		clientMethods.close();
		return true;
	} catch (error) {
		console.error('Logout error:', error);
		return false;
	}
}
```

### WebSocket close codes

The `close` hook receives the browser's [`CloseEvent`](https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent). Its `code`, `reason`, and `wasClean` fields are useful diagnostics, but a close code alone should not determine whether an application retries or signs a user out.

Common standard codes include:

| Code | Meaning | Authentication/recovery guidance |
| --- | --- | --- |
| `1000` | Normal closure | Usually an intentional shutdown, but interpret it in application context. |
| `1001` | Endpoint going away | Common during navigation, shutdown, or server restart; it is not necessarily an error. |
| `1002`–`1003` | Protocol error or unsupported data | Usually indicates an incompatibility or implementation problem. |
| `1007`–`1009` | Invalid payload, policy violation, or message too large | `1008` can represent an authorization policy failure, but that meaning is not standardized. |
| `1011` | Unexpected server condition | Usually transient, although repeated failures should be investigated. |
| `1012`–`1013` | Service restart or temporary overload | Normally suitable for delayed retry. |
| `3000`–`3999` | Registered library/framework codes | Interpret according to the component that defines the code. |
| `4000`–`4999` | Private application codes | Define explicit codes for conditions such as session expiry or account replacement. There is no generic WebSocket “4xx authentication” meaning. |

Codes `1005`, `1006`, and `1015` are reserved status values and are never sent in a WebSocket close frame. A browser may report `1005` when no status was supplied, `1006` when the connection ended without a valid close handshake, or `1015` for a TLS-handshake failure. In particular, a rejected HTTP upgrade may appear to browser code only as `1006`; the HTTP status is not reliably exposed through `CloseEvent`.

Treat `reason` as untrusted diagnostic text and avoid putting credentials or other secrets in it. Applications that define an authentication close code should document whether it means “retry with refreshed credentials,” “remain disconnected,” or “sign out,” rather than inferring that policy from the numeric range.

`restart()` only replaces a connection while automatic connection management is already running. If the client was deliberately stopped with `close()`, `restart()` is a no-op; call `open()` when the application intends to resume management. Requests and subscriptions from the old authenticated generation are retired, so application lifecycle code must reconstruct any identity-dependent work after the replacement opens.

This server example rejects unauthenticated WebSocket connections. After logout, call `close()` or redirect if the application should remain disconnected. Use `restart()` after logout only when the server accepts an anonymous replacement connection or another identity has already been established; otherwise automatic connection management will continue retrying with normal backoff.

## Security Benefits

This approach provides several security benefits:

1. Authentication credentials are never accessible to JavaScript
2. The HTTP-only cookie cannot be stolen via XSS attacks
3. The secure flag ensures the cookie is only sent over HTTPS
4. The sameSite flag helps protect against CSRF attacks

By restarting after login or another identity change—and stopping after logout when anonymous connections are rejected—you ensure the WebSocket lifecycle reflects the current authentication state without creating a second client runtime.
