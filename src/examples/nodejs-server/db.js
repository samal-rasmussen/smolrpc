/**
 * @typedef {import("../../mini-rpc/types.ts").Subscribable<any>} Subscribable
 */

/** @type {Map<string, any>} */
const map = new Map();
/** @type {Map<string, Set<(value: any) => void>>} */
const listeners = new Map();

export const db = {
	/** @type {(resource: string) => unknown} */
	get(resource) {
		return map.get(resource);
	},
	/** @type {(resource: string, value: any) => void} */
	set(resource, value) {
		if (value === undefined) {
			map.delete(resource);
		} else {
			map.set(resource, value);
		}
		const resourceListeners = listeners.get(resource);
		resourceListeners?.forEach((l) => {
			l(value);
		});
	},
	/** @type {(resource: string) => Subscribable} */
	subscribe(resource) {
		return {
			subscribe: (observer) => {
				/** @type {(value: any) => void} */
				const listener = (value) => {
					observer.next?.(value);
				};
				let resourceListeners = listeners.get(resource);
				if (resourceListeners == null) {
					resourceListeners = new Set();
					listeners.set(resource, resourceListeners);
				}
				resourceListeners.add(listener);
				return {
					unsubscribe: () => {
						const resourceListeners = listeners.get(resource);
						resourceListeners?.delete(listener);
						if (resourceListeners?.size === 0) {
							listeners.delete(resource);
						}
					},
				};
			},
		};
	},
};
