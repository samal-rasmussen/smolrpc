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
