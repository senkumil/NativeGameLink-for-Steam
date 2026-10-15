import type * as React from 'react';
import { steamWebpackRuntime } from '../modules/SteamWebpackRuntime';
import { DocumentRuntimeCache } from './runtime-cache';

export interface DocumentUIComponents {
	Focusable?: React.ComponentType<any>;
	DialogButton?: React.ComponentType<any>;
	TextField?: React.ComponentType<any>;
	ProgressBar?: React.ComponentType<any>;
	Spinner?: React.ComponentType<any>;
	IconsModule?: Record<string, React.ComponentType<any>>;
	ModalRoot?: React.ComponentType<any>;
	showModal?: (node: React.ReactNode, parent?: EventTarget, props?: Record<string, any>) => any;
}
const states = new DocumentRuntimeCache(() => ({ ui: null as DocumentUIComponents | null, api: null as any }));
const bootstrapState = () => ({ count: -1, seen: new Map<string, Function>(), completed: new Set<number>() });
const bootstrapStates = new DocumentRuntimeCache(() => ({ ui: bootstrapState(), renderer: bootstrapState() }));
const rendererReactOwners = new WeakMap<object, typeof React>();

/** Production Steam exposes factories through require.m, without exposing its
 * private require cache. Load only identified presentation modules, never all
 * factories: many unrelated modules initialize stores and client services. */
function bootstrapLocalExports(doc: Document, kind: 'ui' | 'renderer'): void {
	const state = bootstrapStates.get(doc)[kind];
	const req = steamWebpackRuntime.getRequire(doc), factories = req?.m;
	if (!req || !factories || typeof factories !== 'object') return;
	const count = steamWebpackRuntime.getModuleFactoryCount?.(doc) ?? Object.keys(factories).length;
	// Private-cache Steam keeps the same runtime lease when another chunk adds
	// factories. Inspect only new code when its factory table grows; warm calls
	// never stringify or execute the table again.
	if (state.count === count) return;
	state.count = count;
	const signatures: ((source: string) => boolean)[] = kind === 'renderer' ? [
		source => source.includes('react-dom-client.production.js') && /\.createRoot\s*=\s*function/.test(source),
	] : [
		source => /"?flow-children"?:[$\w]+,"?onActivate"?:[$\w]+,"?onCancel"?:[$\w]+,"?focusClassName"?:[$\w]+,"?focusWithinClassName"?:[$\w]+/.test(source),
		source => source.includes('"DialogButton","_DialogLayout","Secondary"'),
		source => source.includes('static validateUrl(') && source.includes('static validateEmail(') && source.includes('m_elInput'),
		source => source.includes('role:"progressbar"') && source.includes('"aria-valuenow"') && source.includes('nTransitionSec'),
		source => source.includes('Achievement:()=>') && source.includes('Checkmark:()=>') && source.includes('Spinner:()=>'),
		source => source.includes('Either closeModal or onCancel should be passed to GenericDialog. Classes: '),
		source => source.includes('props.bDisableBackgroundDismiss') && source.includes('ShowLegacyPopupModal'),
	];
	let loaded = false;
	for (const [id, factory] of Object.entries(factories)) {
		if (typeof factory !== 'function' || state.seen.get(id) === factory) continue;
		const source = String(factory);
		const matched = signatures.map((match, index) => !state.completed.has(index) && match(source) ? index : -1).filter(index => index >= 0);
		if (matched.length === 0) { state.seen.set(id, factory); continue; }
		try {
			req(id); loaded = true; state.seen.set(id, factory);
			for (const index of matched) state.completed.add(index);
		} catch {}
		if (state.completed.size === signatures.length) break;
	}
	if (loaded && kind === 'ui') states.clear(doc);
}
function liveView(doc: Document): any | null {
	const view = doc.defaultView;
	return view && !view.closed && view.document === doc && doc.body?.isConnected ? view : null;
}
function isReact(value: any): value is typeof React {
	return value && typeof value.createElement === 'function' && typeof value.useState === 'function'
		&& typeof value.useEffect === 'function' && typeof value.useRef === 'function';
}

/** Hooks must use the React instance paired with this CEF Document's renderer. */
export function getDocumentReact(doc: Document): typeof React | null {
	const view = liveView(doc);
	if (!view) return null;
	const req = steamWebpackRuntime.getRequire(doc);
	try { const native = req?.(63696); if (isReact(native)) return native; } catch {}
	if (isReact(view.SP_REACT)) return view.SP_REACT;
	for (const module of steamWebpackRuntime.getAllModules(doc)) {
		if (isReact(module.exports)) return module.exports;
		if (isReact(module.exports?.default)) return module.exports.default;
	}
	return null;
}

/** A renderer supplied by a Window is usable only with its paired React. */
export function getDocumentRenderer(doc: Document): any | null {
	const view = liveView(doc), react = getDocumentReact(doc);
	if (!view || !react) return null;
	const matches = (value: any) => value && (typeof value === 'object' || typeof value === 'function')
		&& (!rendererReactOwners.has(value) || rendererReactOwners.get(value) === react)
		&& (typeof value.createRoot === 'function' || (typeof value.render === 'function' && typeof value.unmountComponentAtNode === 'function'));
	const select = (value: any) => { rendererReactOwners.set(value, react); return value; };
	if (view.SP_REACT === react) for (const candidate of [view.SP_REACTDOM, view.ReactDOM]) if (matches(candidate)) return select(candidate);
	bootstrapLocalExports(doc, 'renderer');
	for (const module of steamWebpackRuntime.getAllModules(doc)) {
		const exp = module.exports;
		for (const candidate of [exp, exp?.default, ...Object.values(exp || {})]) if (matches(candidate)) return select(candidate);
	}
	return null;
}

/** Resolve local exports without executing a component or borrowing another CEF. */
export function getDocumentUIComponents(doc: Document): DocumentUIComponents {
	const view = liveView(doc);
	if (!view) return {};
	bootstrapLocalExports(doc, 'ui');
	const api = view.SP_REACT === getDocumentReact(doc) ? view.MILLENNIUM_API : null;
	const state = states.get(doc);
	if (state.ui && state.api === api) return state.ui;
	const ui: DocumentUIComponents = {};
	let showModalRaw: any;
	for (const module of steamWebpackRuntime.getAllModules(doc)) {
		const exp = module.exports;
		const candidates = typeof exp === 'function' ? [exp] : exp && typeof exp === 'object' ? Object.values(exp) : [];
		for (const candidate of candidates as any[]) {
			if (!candidate || (typeof candidate !== 'function' && typeof candidate !== 'object')) continue;
			const source = typeof candidate.render === 'function' ? candidate.render.toString() : typeof candidate === 'function' ? candidate.toString() : '';
			if (!ui.Focusable && /"?flow-children"?:[$\w]+,"?onActivate"?:[$\w]+,"?onCancel"?:[$\w]+,"?focusClassName"?:[$\w]+,"?focusWithinClassName"?:[$\w]+/.test(source)) ui.Focusable = candidate;
			if (!ui.DialogButton && source.includes('"DialogButton","_DialogLayout","Secondary"')) ui.DialogButton = candidate;
			if (!ui.TextField && typeof candidate.validateUrl === 'function' && typeof candidate.validateEmail === 'function') ui.TextField = candidate;
			if (!ui.ProgressBar && (source.includes('.ProgressBar,"standard"==') || (source.includes('role:"progressbar"')
				&& source.includes('"aria-valuenow"') && source.includes('nTransitionSec')))) ui.ProgressBar = candidate;
			if (!ui.Spinner && (/Spinner\)\}\)?,.\.createElement\("path",\{d:"M18 /.test(source)
				|| (source.includes('.Spinner') && source.includes('d:"M18 10C17.4696')))) { ui.Spinner = candidate; ui.IconsModule ||= exp; }
			if (!ui.ModalRoot && typeof candidate === 'function' && source.includes('Either closeModal or onCancel should be passed to GenericDialog. Classes: ')) ui.ModalRoot = candidate;
			if (!showModalRaw && typeof candidate === 'function' && source.includes('props.bDisableBackgroundDismiss') && !candidate.prototype?.Cancel) showModalRaw = candidate;
		}
	}
	if (showModalRaw) ui.showModal = (node, _parent, props = {}) => {
		if (!liveView(doc)) throw new Error('The modal owner Document was replaced');
		return showModalRaw(node, view, props.strTitle, props, undefined, { bHideActions: props.bHideActionIcons });
	};
	// A client API can supply exports not loaded in the native module cache,
	// but only when it is paired with this Document's exact React instance.
	for (const key of ['Focusable', 'DialogButton', 'TextField', 'ProgressBar', 'Spinner', 'IconsModule', 'ModalRoot', 'showModal'] as const) {
		if (!(ui as any)[key] && api?.[key]) (ui as any)[key] = api[key];
	}
	if (!showModalRaw && typeof api?.showModal === 'function') ui.showModal = (node, _parent, props = {}) => {
		if (!liveView(doc)) throw new Error('The modal owner Document was replaced');
		return api.showModal(node, view, props);
	};
	// Missing capabilities stay cached until a selected late factory adds local
	// exports; bootstrap clears this cache without revoking the owning root lease.
	state.ui = ui;
	state.api = api;
	return ui;
}
export function resolveNativeFocusable(doc: Document): React.ComponentType<any> | null {
	return getDocumentUIComponents(doc).Focusable || null;
}
export function getDocumentModalRuntime(doc: Document): Pick<Required<DocumentUIComponents>, 'ModalRoot' | 'showModal'> | null {
	const ui = getDocumentUIComponents(doc);
	return ui.ModalRoot && ui.showModal ? { ModalRoot: ui.ModalRoot, showModal: ui.showModal } : null;
}
export function clearDocumentUIRuntime(doc?: Document): void { states.clear(doc); bootstrapStates.clear(doc); }
