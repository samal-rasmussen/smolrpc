/**
 * @typedef {import("./message.types.ts").Params} Params
 */

const RESOURCE_PARAM_PATTERN = /:([^/]+)/g;

/**
 * @param {string} resource
 * @returns {string[]}
 */
export function getResourceParamNames(resource) {
	return [...resource.matchAll(RESOURCE_PARAM_PATTERN)].map(
		(match) => match[1],
	);
}

/**
 * @type {(resource: string, params: Params) => string}
 */
export function getResourceWithParams(resource, params) {
	if (params == null) {
		return resource;
	}
	return resource.replace(RESOURCE_PARAM_PATTERN, (placeholder, key) =>
		Object.hasOwn(params, key) ? String(params[key]) : placeholder,
	);
}

// https://github.com/GoogleChromeLabs/jsbi/issues/30#issuecomment-1694399308

/**
 *
 * @param {string} key
 * @param {any} value
 * @returns
 */
function replacer(key, value) {
	if (typeof value === 'bigint') {
		return {
			__type: 'bigint',
			__value: value.toString(),
		};
	} else {
		return value;
	}
}

/**
 * @param {string} _key
 * @param {any} value
 */
function reviver(_key, value) {
	if (value && value.__type == 'bigint') {
		return BigInt(value.__value);
	}
	return value;
}

/**
 * Wrapper around JSON stringify methods to support bigint serialization
 *
 * @param {any} obj
 * @param {Parameters<typeof JSON.stringify>[2]} [space]
 * @returns
 */
export const json_stringify = (obj, space) => {
	return JSON.stringify(obj, replacer, space);
};

/**
 * Wrapper around JSON parse methods to support bigint serialization
 *
 * @param {string} s
 * @returns
 */
export const json_parse = (s) => {
	return JSON.parse(s, reviver);
};

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isRecord(value) {
	return typeof value === 'object' && value != null && !Array.isArray(value);
}

/** @type {(value: any) => value is Promise<any>} */
export function isPromise(value) {
	return (
		value instanceof Promise ||
		(typeof value === 'object' &&
			typeof value.then === 'function' &&
			typeof value.catch === 'function')
	);
}
