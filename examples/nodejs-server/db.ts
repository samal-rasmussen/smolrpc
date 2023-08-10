import { Subscribable } from '../../src/types';

const map = new Map<string, any>();
const listeners = new Map<string, Set<(value: any) => void>>();

export const db = {
	get(resource: string): unknown {
		return map.get(resource);
	},
	getAll(resource: string) {
		return Array.from(map.entries())
			.filter(([key]) => key.startsWith(resource))
			.map(([_, value]) => value);
	},
	set<T>(resource: string, value: T) {
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
	subscribe(resource: string): Subscribable<unknown> {
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
