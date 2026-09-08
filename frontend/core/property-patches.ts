/** Restore only properties still owned by this patch, preserving later Steam updates. */
export class PropertyPatches {
	private entries: { target: object; key: string; original?: PropertyDescriptor; installed: PropertyDescriptor }[] = [];
	set(target: object, key: string, descriptor: PropertyDescriptor): boolean {
		const original = Object.getOwnPropertyDescriptor(target, key);
		try {
			Object.defineProperty(target, key, descriptor);
			this.entries.push({ target, key, original, installed: Object.getOwnPropertyDescriptor(target, key)! });
			return true;
		} catch { return false; }
	}
	restore(): void {
		for (const { target, key, original, installed } of this.entries.reverse()) {
			const current = Object.getOwnPropertyDescriptor(target, key);
			if (!current || current.value !== installed.value || current.get !== installed.get || current.set !== installed.set) continue;
			try {
				if (original) Object.defineProperty(target, key, original);
				else Reflect.deleteProperty(target, key);
			} catch {}
		}
		this.entries = [];
	}
}
