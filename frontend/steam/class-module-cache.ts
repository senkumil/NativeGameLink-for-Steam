import { steamWebpackRuntime } from './modules/SteamWebpackRuntime';

type ClassMap = Record<string, string>;

interface ClassModuleResult {
	classes: ClassMap;
	native: boolean;
}

interface ClassModuleContext {
	identity: object | null;
	chunkSource: unknown;
	nextProbeAt: number;
	candidates: ClassMap[];
	resolved: Map<ClassMap, ClassModuleResult>;
}

const PROBE_INTERVAL_MS = 1000;
let documentContexts = new WeakMap<Document, ClassModuleContext>();
let defaultContext: ClassModuleContext | undefined;

function createContext(): ClassModuleContext {
	return { identity: null, chunkSource: undefined, nextProbeAt: 0, candidates: [], resolved: new Map() };
}

function currentContext(doc?: Document): ClassModuleContext {
	if (doc) {
		let context = documentContexts.get(doc);
		if (!context) {
			context = createContext();
			documentContexts.set(doc, context);
		}
		return context;
	}
	return defaultContext ||= createContext();
}

/** Inspect loaded exports at most once per second per document. A fallback is
 * retried after that interval, and a new runtime generation drops live classes.
 * Icon rows can therefore read this on every item without scanning Webpack. */
export function resolveSteamClassModule(
	predicate: (module: ClassMap) => boolean,
	fallback: ClassMap,
	doc: Document | undefined = typeof document !== 'undefined' ? document : undefined,
): ClassModuleResult {
	const context = currentContext(doc);
	const win = doc?.defaultView as any;
	const chunkSource = win?.webpackChunksteamui || win?.webpackChunk || win?.webpackJsonp;
	const now = Date.now();
	const sourceChanged = context.chunkSource !== chunkSource;
	if (now >= context.nextProbeAt || sourceChanged) {
		// Replacing a window's chunk array replaces the runtime behind it. Drop
		// its captured require as well, otherwise it can still expose old exports.
		const replaceRuntime = sourceChanged && context.nextProbeAt > 0 && doc;
		context.nextProbeAt = now + PROBE_INTERVAL_MS;
		context.chunkSource = chunkSource;
		try {
			if (replaceRuntime) steamWebpackRuntime.invalidate(doc);
			const identity = steamWebpackRuntime.getRuntimeIdentity(doc);
			// Older adapters can omit a generation signal for newly loaded exports.
			// Retry unresolved families within the same bounded probe interval.
			const missingFamily = [...context.resolved.values()].some(result => !result.native);
			if (context.identity !== identity || !identity || missingFamily || sourceChanged) {
				context.identity = identity;
				context.resolved.clear();
				context.candidates = [];
				for (const entry of steamWebpackRuntime.getAllModules(doc)) {
					try {
						const exports = entry.exports;
						const candidates = [exports, exports?.default,
							...(exports && typeof exports === 'object' ? Object.values(exports) : [])];
						for (const candidate of candidates) {
							if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
								const values = Object.values(candidate);
								if (values.length && values.every(value => typeof value === 'string')) {
									context.candidates.push(candidate as ClassMap);
								}
							}
						}
					} catch {}
				}
			}
		} catch {
			context.identity = null;
			context.candidates = [];
			context.resolved.clear();
		}
	}
	const cached = context.resolved.get(fallback);
	if (cached) return cached;
	let classes: ClassMap | undefined;
	for (const candidate of context.candidates) {
		try {
			if (predicate(candidate)) { classes = candidate; break; }
		} catch {}
	}
	const result = { classes: classes || fallback, native: !!classes };
	context.resolved.set(fallback, result);
	return result;
}

export function resetSteamClassModuleCache(): void {
	documentContexts = new WeakMap();
	defaultContext = undefined;
}
