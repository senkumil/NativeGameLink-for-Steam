import React from 'react';
import { getDocumentReact, getDocumentUIComponents } from '../../steam/gamepad/document-ui-runtime';
import { steamWebpackRuntime } from '../../steam/modules/SteamWebpackRuntime';
import { isCurrentLinkedGamepadTarget } from '../../steam/gamepad/GamepadContext';
import { steamUIModeService } from '../../steam/ui/SteamUIModeService';
import type { GameControllerSupport } from '../library/controller';
import { backendLog } from '../../api/backend';
import {
	resolveNativeControllerIcons,
	type NativeControllerIcons,
} from '../../steam/gamepad/components/AppDetailsNativeComponents';
import { findReactDom, type ReactRootHandle } from './NativeBigPictureDetails';

interface ErrorBoundaryState {
	hasError: boolean;
}

const FallbackControllerSvg: React.FC<{ type?: string }> = () => (
	<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
		<path d="M7 6h10a6 6 0 0 1 6 6v3a4 4 0 0 1-4 4 2 2 0 0 1-2-2l-1.5-3h-7L7 20a2 2 0 0 1-2 2 4 4 0 0 1-4-4v-3a6 6 0 0 1 6-6zm0 2a4 4 0 0 0-4 4v3a2 2 0 0 0 2 2l2-4h10l2 4a2 2 0 0 0 2-2v-3a4 4 0 0 0-4-4H7zm1 2h2v1.5H8.5V13H7v-1.5H5.5V10H7V8.5h1.5V10zm8.5 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm2 2a1 1 0 1 1 0 2 1 1 0 0 1 0-2z" />
	</svg>
);

export class PlaybarErrorBoundary extends React.Component<{ fallback?: React.ReactNode; children: React.ReactNode }, ErrorBoundaryState> {
	constructor(props: { fallback?: React.ReactNode; children: React.ReactNode }) {
		super(props);
		this.state = { hasError: false };
	}

	static getDerivedStateFromError(): ErrorBoundaryState {
		return { hasError: true };
	}

	componentDidCatch(error: any) {
		backendLog(`[PlaybarControllerIcons] Component render error caught: ${error}`);
	}

	render() {
		if (this.state.hasError) {
			return this.props.fallback || <FallbackControllerSvg />;
		}
		return this.props.children;
	}
}

interface PlaybarControllerIconsProps {
	support: GameControllerSupport;
	doc: Document;
}

export const PlaybarControllerIcons: React.FC<PlaybarControllerIconsProps> = ({ support, doc }) => {
	const nativeIcons: NativeControllerIcons | null = resolveNativeControllerIcons(doc);
	const IconsModule = getDocumentUIComponents(doc).IconsModule || {};
	// Avoid status component: calls useQuery() which crashes in isolated roots without QueryClientProvider
	const ControllerType = nativeIcons?.ControllerType || (IconsModule as any)?.ControllerType;
	const Controller = nativeIcons?.Controller || (IconsModule as any)?.Controller;
	const XboxOutline = nativeIcons?.XboxOneControllerFrontOutline || (IconsModule as any)?.XboxOneControllerFrontOutline;
	const Ps4Outline = nativeIcons?.PS4ControllerFrontOutline || (IconsModule as any)?.PS4ControllerFrontOutline;
	const Ps5Outline = nativeIcons?.PS5ControllerFrontOutline || (IconsModule as any)?.PS5ControllerFrontOutline;

	const items: React.ReactNode[] = [];

	// Platform glyphs describe verified support; unknown support stays generic.
	if (support.xbox) {
		if (ControllerType) {
			items.push(<ControllerType key="xbox" controllerType={32} eControllerType={32} nControllerType={32} type="xbox" />);
		} else if (XboxOutline) {
			items.push(<XboxOutline key="xbox" />);
		} else if (Controller) {
			items.push(<Controller key="xbox" type="xbox" />);
		} else {
			items.push(<FallbackControllerSvg key="xbox" type="xbox" />);
		}
	}

	// 2. PlayStation 4 controller (DualShock 4)
	if (support.ps4) {
		if (ControllerType) {
			items.push(<ControllerType key="ps4" controllerType={34} eControllerType={34} nControllerType={34} type="ps4" />);
		} else if (Ps4Outline) {
			items.push(<Ps4Outline key="ps4" />);
		} else if (Controller) {
			items.push(<Controller key="ps4" type="ps4" />);
		} else {
			items.push(<FallbackControllerSvg key="ps4" type="ps4" />);
		}
	}

	// 3. PlayStation 5 controller (DualSense)
	if (support.ps5) {
		if (ControllerType) {
			items.push(<ControllerType key="ps5" controllerType={45} eControllerType={45} nControllerType={45} type="ps5" />);
		} else if (Ps5Outline) {
			items.push(<Ps5Outline key="ps5" />);
		} else if (Controller) {
			items.push(<Controller key="ps5" type="ps5" />);
		} else {
			items.push(<FallbackControllerSvg key="ps5" type="ps5" />);
		}
	}

	if (items.length === 0) {
		items.push(Controller ? <Controller key="generic" /> : <FallbackControllerSvg key="generic" />);
	}

	return <>{items}</>;
};

interface ControllerRootState {
 doc: Document; parent: Node | null; detail: HTMLElement; generation: string | undefined;
 react: unknown; renderer: any; runtime: object | null; handle: ReactRootHandle | null;
 nodes: Node[]; unload: () => void;
}
const controllerRoots = new WeakMap<HTMLElement, ControllerRootState>();
const documentContainers = new WeakMap<Document, Set<HTMLElement>>();
function linkedControllerOwner(doc: Document): HTMLElement | null {
 const root = doc.getElementById('gdl-bp-detail-root');
 return root?.isConnected && steamUIModeService.isGamepadUI(doc)
  && isCurrentLinkedGamepadTarget(doc, root.dataset.gdlShortcutAppId, root.dataset.gdlSteamAppId) ? root : null;
}
export function unmountPlaybarControllerIcons(container: HTMLElement): void {
 const state = controllerRoots.get(container);
 if (!state) return;
 controllerRoots.delete(container);
 state.doc.defaultView?.removeEventListener('beforeunload', state.unload);
 const containers = documentContainers.get(state.doc); containers?.delete(container);
 if (!containers?.size) documentContainers.delete(state.doc);
 try { state.handle?.unmount(); } catch {}
 for (const node of state.nodes) if (node.parentNode === container) node.parentNode.removeChild(node);
}
export function disposePlaybarControllerIcons(doc: Document): void {
 for (const container of [...(documentContainers.get(doc) || [])]) unmountPlaybarControllerIcons(container);
}
export function mountPlaybarControllerIcons(container: HTMLElement, doc: Document, support?: GameControllerSupport): () => void {
 const detail = linkedControllerOwner(doc);
 if (container.ownerDocument !== doc) return () => {};
 let scoped = false;
 for (let parent = container.parentElement; parent && parent !== doc.body && parent !== doc.documentElement; parent = parent.parentElement) {
  if (detail && parent.contains(detail)) { scoped = true; break; }
 }
 if (!container.isConnected || !detail || !scoped || container.closest('[role="dialog"], [aria-modal="true"], [class*="ModalPosition"], [class*="Settings"]')) {
  unmountPlaybarControllerIcons(container); return () => {};
 }
 const resolvedSupport: GameControllerSupport = support || { xbox: false, ps4: false, ps5: false };
 const react = getDocumentReact(doc), renderer = findReactDom(doc), runtime = steamWebpackRuntime.getRuntimeIdentity(doc);
 let state = controllerRoots.get(container);
 if (state && (state.doc !== doc || state.parent !== container.parentNode || state.detail !== detail || state.generation !== detail.dataset.gdlBpGeneration
  || state.react !== react || state.renderer !== renderer || state.runtime !== runtime)) { unmountPlaybarControllerIcons(container); state = undefined; }
 if (!state) {
  let handle: ReactRootHandle | null = null;
  if (react && renderer) {
   if (typeof renderer.createRoot === 'function') handle = renderer.createRoot(container);
   else if (typeof renderer.render === 'function') handle = { render: node => renderer.render(node, container), unmount: () => renderer.unmountComponentAtNode?.(container) };
  }
  const owned: ControllerRootState = { doc, parent: container.parentNode, detail, generation: detail.dataset.gdlBpGeneration,
   react, renderer, runtime, handle, nodes: [], unload: () => { if (controllerRoots.get(container) === owned) unmountPlaybarControllerIcons(container); } };
  state = owned; controllerRoots.set(container, state);
  let containers = documentContainers.get(doc); if (!containers) documentContainers.set(doc, containers = new Set()); containers.add(container);
  doc.defaultView?.addEventListener('beforeunload', owned.unload);
 }
 if (state.handle && react) {
  state.handle.render(react.createElement(PlaybarErrorBoundary, { fallback: react.createElement(FallbackControllerSvg),
   children: react.createElement(PlaybarControllerIcons, { support: resolvedSupport, doc }) }));
 } else if (!state.nodes.length) {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '22'); svg.setAttribute('height', '22');
  svg.setAttribute('fill', 'currentColor'); svg.setAttribute('aria-hidden', 'true');
  const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M7 6h10a6 6 0 0 1 6 6v3a4 4 0 0 1-4 4 2 2 0 0 1-2-2l-1.5-3h-7L7 20a2 2 0 0 1-2 2 4 4 0 0 1-4-4v-3a6 6 0 0 1 6-6zm0 2a4 4 0 0 0-4 4v3a2 2 0 0 0 2 2l2-4h10l2 4a2 2 0 0 0 2-2v-3a4 4 0 0 0-4-4H7zm1 2h2v1.5H8.5V13H7v-1.5H5.5V10H7V8.5h1.5V10zm8.5 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm2 2a1 1 0 1 1 0 2 1 1 0 0 1 0-2z');
  svg.appendChild(path); container.appendChild(svg); state.nodes.push(svg);
 }
 const owned = state;
 return () => { if (controllerRoots.get(container) === owned) unmountPlaybarControllerIcons(container); };
}
