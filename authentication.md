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

On the client side, you need to handle reconnection after login/logout:

```ts
// client.ts
import { initClient } from 'smolrpc';
import { Resources } from './resources';

// Keep a reference to client methods for reconnection
let clientMethods;

// Function to initialize WebSocket connection
async function connectWebSocket() {
	const { client, clientMethods: methods } = initClient<Resources>({
		url: 'ws://localhost:9200',
		// Browsers automatically include cookies in WebSocket handshake
		onopen: () => console.log('Connected to server'),
		onclose: (event) => {
			console.log(`Connection closed with code ${event.code}`);
			// You might want to auto-reconnect based on the close code
			// 1000 (normal) or 1001 (going away) are normal closes
			// 1006 (abnormal) or 4xx (application) might indicate auth issues
		},
	});

	clientMethods = methods;
	return client;
}

// Initial connection
let client = await connectWebSocket();

// Login function - will need to reconnect WebSocket after login
async function login(username, password) {
	try {
		const response = await fetch('/api/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username, password }),
			credentials: 'include', // Important: include cookies
		});

		if (!response.ok) {
			throw new Error('Login failed');
		}

		// Close existing connection
		if (clientMethods) {
			clientMethods.close();
		}

		// Reconnect with new auth cookie
		client = await connectWebSocket();

		return true;
	} catch (error) {
		console.error('Login error:', error);
		return false;
	}
}

// Logout function - also reconnects WebSocket
async function logout() {
	try {
		const response = await fetch('/api/logout', {
			method: 'POST',
			credentials: 'include', // Important: include cookies
		});

		if (!response.ok) {
			throw new Error('Logout failed');
		}

		// Close existing connection
		if (clientMethods) {
			clientMethods.close();
		}

		// Reconnect (will fail if server requires authentication)
		// or you could redirect to login page instead
		client = await connectWebSocket();

		return true;
	} catch (error) {
		console.error('Logout error:', error);
		return false;
	}
}
```

## Security Benefits

This approach provides several security benefits:

1. Authentication credentials are never accessible to JavaScript
2. The HTTP-only cookie cannot be stolen via XSS attacks
3. The secure flag ensures the cookie is only sent over HTTPS
4. The sameSite flag helps protect against CSRF attacks

By reconnecting the WebSocket after login/logout, you ensure the connection always reflects the current authentication state.
