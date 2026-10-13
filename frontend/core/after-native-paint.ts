interface PendingNativePaint {
	key: string;
	promise: Promise<void>;
	resolve: () => void;
	reject: (error: unknown) => void;
	cancelFrame?: () => void;
	cancelTimer?: () => void;
}

/** Coalesce heavy document work until Steam has had a native paint opportunity.
 * Only scheduled callbacks are shared: a running network request must not block
 * a later layout retry for the same destination. */
export class NativePaintQueue {
	private readonly pending = new Map<Document, PendingNativePaint>();
	private disposed = false;

	run(doc: Document, key: string, task: () => Promise<void> | void): Promise<void> {
		if (this.disposed || doc.hidden || doc.defaultView?.closed) {
			this.cancel(doc);
			return Promise.resolve();
		}
		const previous = this.pending.get(doc);
		if (previous?.key === key) return previous.promise;
		if (previous) this.cancel(doc);
		let resolve!: () => void;
		let reject!: (error: unknown) => void;
		const promise = new Promise<void>((done, failed) => { resolve = done; reject = failed; });
		const entry: PendingNativePaint = { key, promise, resolve, reject };
		this.pending.set(doc, entry);
		const view = doc.defaultView;
		const isPending = (): boolean => this.pending.get(doc) === entry;
		const scheduleTimer = (callback: () => void, delay: number): (() => void) => {
			if (view?.setTimeout) {
				const handle = view.setTimeout(callback, delay);
				return () => view.clearTimeout(handle);
			}
			const handle = setTimeout(callback, delay);
			return () => clearTimeout(handle);
		};
		const startTask = (): void => {
			entry.cancelTimer = undefined;
			if (!isPending()) return;
			// Remove before invoking task. Its asynchronous result may outlive the
			// route's next useful DOM/layout signal by several seconds.
			this.pending.delete(doc);
			if (this.disposed || doc.hidden || view?.closed) { entry.resolve(); return; }
			try { Promise.resolve(task()).then(entry.resolve, entry.reject); }
			catch (error) { entry.reject(error); }
		};
		if (view?.requestAnimationFrame) {
			const firstFrame = view.requestAnimationFrame(() => {
				entry.cancelFrame = undefined;
				if (!isPending()) return;
				if (doc.hidden || view.closed) { this.cancel(doc); return; }
				const secondFrame = view.requestAnimationFrame(() => {
					entry.cancelFrame = undefined;
					if (!isPending()) return;
					// The first frame can finish painting before this callback. Heavy
					// work starts in a later task, never in either RAF or its microtasks.
					entry.cancelTimer = scheduleTimer(startTask, 0);
				});
				entry.cancelFrame = () => view.cancelAnimationFrame?.(secondFrame);
			});
			entry.cancelFrame = () => view.cancelAnimationFrame?.(firstFrame);
		} else {
			entry.cancelTimer = scheduleTimer(startTask, 16);
		}
		return promise;
	}

	cancel(doc?: Document): void {
		const documents = doc ? [doc] : Array.from(this.pending.keys());
		for (const target of documents) {
			const entry = this.pending.get(target);
			if (!entry) continue;
			this.pending.delete(target);
			entry.cancelFrame?.();
			entry.cancelTimer?.();
			entry.resolve();
		}
	}

	dispose(): void {
		this.disposed = true;
		this.cancel();
	}
}
