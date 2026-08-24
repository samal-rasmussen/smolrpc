/**
 * @typedef {'SMOLRPC_UNAVAILABLE' | 'SMOLRPC_TIMEOUT' | 'SMOLRPC_SERVER_REJECTION' | 'SMOLRPC_PROTOCOL_ERROR' | 'SMOLRPC_MUTATION_OUTCOME_UNKNOWN' | 'SMOLRPC_SERIALIZATION' | 'SMOLRPC_SEND_FAILED'} SmolRpcErrorCode
 */

/**
 * @typedef {object} SmolRpcErrorMetadata
 * @property {'get' | 'set' | 'subscribe' | 'unsubscribe'} [operation]
 * @property {string} [resource]
 * @property {number} [requestId]
 * @property {number} [generation]
 * @property {number} [readyState]
 * @property {number} [elapsedMs]
 */

/** A stable, sanitised error produced by the SMOLRPC client. */
export class SmolRpcError extends Error {
	/**
	 * @param {SmolRpcErrorCode} code
	 * @param {string} message
	 * @param {SmolRpcErrorMetadata} [metadata]
	 */
	constructor(code, message, metadata) {
		super(message);
		this.name = 'SmolRpcError';
		/** @readonly */
		this.code = code;
		/** @readonly */
		this.metadata = metadata == null ? undefined : { ...metadata };
	}
}
