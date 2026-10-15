interface PendingNativePaint {
	key: string;
	promise: Promise<void>;
	resolve: () => void;
	reject: (error: unknown) => void;
	cancelFrame?: () => void;
	cancelTimer?: () => void;
	cancelReady?: () => void;
}

export type NativePaintReadiness = (doc: Document, ready: () => void) => () => void;

/** Coalesce heavy document work until native content is ready and can paint.
 * Only scheduled callbacks are shared: a running network request must not block
 * a later layout retry for the same destination. */
export class NativePaintQueue {
	private readonly pending = new Map<Document, PendingNativePaint>();
	private disposed = false;

	run(doc: Document, key: string, task: () => Promise<void> | void, waitUntilReady?: NativePaintReadiness): Promise<void> {
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
		let ready = false;
		const schedulePaint = (): void => {
			if (ready || !isPending()) return;
			ready = true;
			entry.cancelReady?.();
			entry.cancelReady = undefined;
			if (this.disposed || doc.hidden || view?.closed) { this.cancel(doc); return; }
			if (view?.requestAnimationFrame) {
				const firstFrame = view.requestAnimationFrame(() => {
					entry.cancelFrame = undefined;
					if (!isPending()) return;
					if (doc.hidden || view.closed) { this.cancel(doc); return; }
					const secondFrame = view.requestAnimationFrame(() => {
						entry.cancelFrame = undefined;
						if (!isPending()) return;
						// Let the native artwork paint before the heavy callback.
						entry.cancelTimer = scheduleTimer(startTask, 0);
					});
					entry.cancelFrame = () => view.cancelAnimationFrame?.(secondFrame);
				});
				entry.cancelFrame = () => view.cancelAnimationFrame?.(firstFrame);
			} else {
				entry.cancelTimer = scheduleTimer(startTask, 16);
			}
		};
		if (waitUntilReady) {
			try {
				const cancelReady = waitUntilReady(doc, schedulePaint);
				// A cached native image can be ready synchronously. Dispose the
				// returned handle as well as handles installed before its callback.
				if (ready || !isPending()) cancelReady();
				else entry.cancelReady = cancelReady;
			} catch (error) {
				if (isPending()) {
					this.pending.delete(doc);
					entry.cancelFrame?.();
					entry.cancelTimer?.();
					entry.reject(error);
				}
			}
		} else schedulePaint();
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
			entry.cancelReady?.();
			entry.resolve();
		}
	}

	dispose(): void {
		this.disposed = true;
		this.cancel();
	}
}
