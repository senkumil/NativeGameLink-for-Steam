// Host-page React contexts for Steam's own app-page sections rendered inside
// the extension's Big Picture panel, which is a separate React root.
import type { ComponentType } from 'react';
import { backendLog } from '../../../api/backend';
import { steamWebpackRuntime } from '../../modules/SteamWebpackRuntime';

let cachedRuntimeIdentity: object | null = null;

// Drops cached lookups when Steam's webpack runtime is replaced (UI reload).
function ensureHostContextsRuntime(doc?: Document): void {
	steamWebpackRuntime.captureRuntime(doc);
	const identity = steamWebpackRuntime.getRuntimeIdentity(doc);
	if (identity && cachedRuntimeIdentity === identity) return;
	cachedQueryClientFallback = undefined;
	cachedNavigatorContext = undefined;
	cachedRuntimeIdentity = identity;
}

export interface NativeContextBridgeEntry {
	context: any;
	value: any;
}

// Fiber tag of a context provider in React 18 and 19.
const CONTEXT_PROVIDER_FIBER_TAG = 10;

function reactFiberOf(element: Element | null | undefined): any | null {
	if (!element) return null;
	const key = Object.keys(element).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
	return key ? (element as any)[key] : null;
}

/**
 * The context values Steam provides above the app page that hosts the panel.
 * The panel is a separate React root, so Steam's own section components lose
 * every context they read (React Query client, router, window, navigator).
 * Re-providing the host's values lets them render as they do on Steam's page.
 * Innermost value wins, matching what a component in the host tree would see.
 */
export function collectHostContextBridge(doc: Document, exclude: any[] = []): NativeContextBridgeEntry[] {
	const start = doc.getElementById('gdl-bp-detail-root')?.parentElement
		|| doc.querySelector('[role="tablist"]');
	const seen = new Set<any>(exclude.filter(Boolean));
	const entries: NativeContextBridgeEntry[] = [];
	for (let fiber = reactFiberOf(start); fiber; fiber = fiber.return) {
		if (fiber.tag !== CONTEXT_PROVIDER_FIBER_TAG) continue;
		const context = fiber.type?._context || fiber.type;
		if (!context?.Provider || seen.has(context)) continue;
		seen.add(context);
		const value = fiber.memoizedProps?.value;
		// The gamepad nav tree is provided by the panel itself so the native
		// sections stay children of the panel's Focusable.
		if (value?.Tree && typeof value.Tree.CreateNode === 'function') continue;
		entries.push({ context, value });
	}
	return entries;
}

function isQueryClient(value: any): boolean {
	return Boolean(value && typeof value.getQueryCache === 'function' && typeof value.getDefaultOptions === 'function');
}

export function hasBridgedQueryClient(entries: NativeContextBridgeEntry[]): boolean {
	return entries.some(entry => isQueryClient(entry.value));
}

export interface NativeQueryClientFallback {
	Provider: ComponentType<{ client: any; children?: any }>;
	client: any;
}

let cachedQueryClientFallback: NativeQueryClientFallback | null | undefined;

/** Steam's QueryClientProvider and shared client, for when the host chain has none. */
export function resolveNativeQueryClientFallback(doc?: Document): NativeQueryClientFallback | null {
	ensureHostContextsRuntime(doc);
	if (cachedQueryClientFallback !== undefined) return cachedQueryClientFallback;
	let Provider: ComponentType<any> | null = null;
	let client: any = null;
	for (const module of steamWebpackRuntime.getAllModules(doc)) {
		const exp = module.exports as any;
		if (!exp || typeof exp !== 'object') continue;
		if (!client && isQueryClient(exp.L) && typeof exp.s === 'function') client = exp.L;
		if (!Provider) {
			const fns = Object.values(exp).filter(v => typeof v === 'function') as Function[];
			if (fns.length === 2 && fns.some(fn => { try { return String(fn).includes('No QueryClient set'); } catch { return false; } })) {
				Provider = (fns.find(fn => { try { return String(fn).includes('.mount()'); } catch { return false; } }) as ComponentType<any>) || null;
			}
		}
		if (Provider && client) break;
	}
	cachedQueryClientFallback = Provider && client ? { Provider, client } : null;
	backendLog(`[NGL][Gamepad] Native QueryClient fallback ${cachedQueryClientFallback ? 'resolved' : 'missing'} (provider=${Boolean(Provider)} client=${Boolean(client)})`);
	return cachedQueryClientFallback;
}

export interface NativeNavigatorContext {
	context: any;
	getGlobalNavigator: () => any;
}

let cachedNavigatorContext: NativeNavigatorContext | null | undefined;

/**
 * The context behind GamepadUI's useNavigator(). Activity tiles call
 * Navigator.App(appid, { gidPartnerEvent }) from it, which would leave the
 * shortcut's page for the real app's page.
 */
export function resolveNativeNavigatorContext(doc?: Document): NativeNavigatorContext | null {
	ensureHostContextsRuntime(doc);
	if (cachedNavigatorContext !== undefined) return cachedNavigatorContext;
	for (const module of steamWebpackRuntime.getAllModules(doc)) {
		const exp = module.exports as any;
		if (!exp || typeof exp.br !== 'function' || typeof exp.lF !== 'function' || !exp.O0) continue;
		try {
			if (!String(exp.br).includes('No navigator context')) continue;
		} catch { continue; }
		const context = exp.O0._context || exp.O0;
		if (!context?.Provider) continue;
		cachedNavigatorContext = { context, getGlobalNavigator: () => { try { return exp.lF(); } catch { return null; } } };
		backendLog(`[NGL][Gamepad] Resolved native Navigator context from module ${module.id}`);
		return cachedNavigatorContext;
	}
	cachedNavigatorContext = null;
	return null;
}

