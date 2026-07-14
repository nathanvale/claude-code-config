export function deepFreeze<T extends object>(value: T): T {
	Object.freeze(value);
	for (const child of Object.values(value)) {
		if (child && typeof child === "object" && !Object.isFrozen(child)) deepFreeze(child);
	}
	return value;
}
