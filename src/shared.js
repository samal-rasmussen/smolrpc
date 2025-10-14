/**
 * @typedef {import("./message.types.ts").Params} Params
 */

/**
 * @type {(resource: string, params: Params) => string}
 */
export function getResourceWithParams(resource, params) {
	Object.entries(params ?? {}).forEach(([key, value]) => {
		resource = resource.replace(`:${key}`, value);
	});
	return resource;
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

/** @type {(value: any) => value is Promise<any>} */
export function isPromise(value) {
	return (
		value instanceof Promise ||
		(typeof value === 'object' &&
			typeof value.then === 'function' &&
			typeof value.catch === 'function')
	);
}
