import { steamWebpackRuntime } from '../modules/SteamWebpackRuntime';

/** Resolver values belong to one live Document and one Webpack generation. */
export class DocumentRuntimeCache<T> {
	private documents = new WeakMap<Document, { identity: object | null; value: T }>();
	private legacy: { identity: object | null; value: T } | null = null;
	constructor(private readonly create: () => T) {}
	public get(doc?: Document): T {
		const target = doc || (typeof document !== 'undefined' ? document : undefined);
		if (target && (!target.defaultView || target.defaultView.closed || target.defaultView.document !== target)) return this.create();
		const identity = steamWebpackRuntime.getRuntimeIdentity(target);
		let state = target ? this.documents.get(target) : this.legacy;
		if (!state || state.identity !== identity) {
			state = { identity, value: this.create() };
			if (target) this.documents.set(target, state); else this.legacy = state;
		}
		return state.value;
	}
	public clear(doc?: Document): void {
		if (doc) this.documents.delete(doc);
		else { this.documents = new WeakMap(); this.legacy = null; }
	}
}
