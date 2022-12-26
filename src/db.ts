import { Subscribable } from './shared';

const map = new Map<string, any>();
const listeners = new Map<string, Set<(value: any) => void>>();

export const db = {
	get(resource: string): unknown {
		return map.get(resource);
	},
	set(resource: string, value: any): void {
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
	subscribe(resource: string): Subscribable<any> {
		return {
			subscribe: (observer) => {
				const listener = (value: any) => {
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
