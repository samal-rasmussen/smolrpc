/**
 * @param {string} label
 * @param {((...args: any[]) => unknown) | null | undefined} fn
 * @param {...any} args
 */
export function safeInvoke(label, fn, ...args) {
	if (fn == null) {
		return;
	}

	try {
		fn(...args);
	} catch (error) {
		console.error(`smolrpc ${label} hook threw`, { error });
	}
}
