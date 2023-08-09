const map = new Map<string, any>();
const listeners = new Map<string, Set<(value: any) => void>>();

export const db = {
	/** @type {(resource: string) => unknown} */
	get(resource: any) {
		return map.get(resource);
	},
	set<T>(resource: any, value: T) {
		if (value === undefined) {
			map.delete(resource);
		} else {
			map.set(resource, value);
		}
		const resourceListeners = listeners.get(resource);
		resourceListeners?.forEach((l) => {
			l(value);
		});
		return value;
	},
	/** @type {(resource: string) => Subscribable} */
	subscribe(resource: any) {
		return {
			subscribe: (observer: any) => {
				/** @type {(value: any) => void} */
				const listener = (value: any) => {
					observer.next?.(value);
				};
				let resourceListeners = listeners.get(resource);
				if (resourceListeners == null) {
					resourceListeners = new Set();
					listeners.set(resource, resourceListeners);
				}
				resourceListeners.add(listener);
				observer.next?.(map.get(resource));
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
