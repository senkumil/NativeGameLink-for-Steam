import React from 'react';
import { IconsModule } from '@steambrew/client';
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
			return this.props.fallback || null;
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
	// Avoid status component: calls useQuery() which crashes in isolated roots without QueryClientProvider
	const ControllerType = nativeIcons?.ControllerType || (IconsModule as any)?.ControllerType;
	const Controller = nativeIcons?.Controller || (IconsModule as any)?.Controller;
	const XboxOutline = nativeIcons?.XboxOneControllerFrontOutline || (IconsModule as any)?.XboxOneControllerFrontOutline;
	const Ps4Outline = nativeIcons?.PS4ControllerFrontOutline || (IconsModule as any)?.PS4ControllerFrontOutline;
	const Ps5Outline = nativeIcons?.PS5ControllerFrontOutline || (IconsModule as any)?.PS5ControllerFrontOutline;

	const items: React.ReactNode[] = [];

	// 1. Xbox / Generic controller (Rendered once when supported or as baseline fallback)
	if (support.xbox || (!support.ps4 && !support.ps5)) {
		if (XboxOutline) {
			items.push(<XboxOutline key="xbox" />);
		} else if (ControllerType) {
			items.push(<ControllerType key="xbox" controllerType={32} type="xbox" />);
		} else if (Controller) {
			items.push(<Controller key="xbox" type="xbox" />);
		}
	}

	// 2. PlayStation 4 controller (DualShock 4)
	if (support.ps4) {
		if (Ps4Outline) {
			items.push(<Ps4Outline key="ps4" />);
		} else if (ControllerType) {
			items.push(<ControllerType key="ps4" controllerType={34} type="ps4" />);
		} else if (Controller) {
			items.push(<Controller key="ps4" type="ps4" />);
		}
	}

	// 3. PlayStation 5 controller (DualSense)
	if (support.ps5) {
		if (Ps5Outline) {
			items.push(<Ps5Outline key="ps5" />);
		} else if (ControllerType) {
			items.push(<ControllerType key="ps5" controllerType={45} type="ps5" />);
		} else if (Controller) {
			items.push(<Controller key="ps5" type="ps5" />);
		}
	}

	return <>{items}</>;
};

const controllerRoots = new WeakMap<HTMLElement, ReactRootHandle>();

export function mountPlaybarControllerIcons(
	container: HTMLElement,
	doc: Document,
	support?: GameControllerSupport,
): () => void {
	const resolvedSupport: GameControllerSupport = support || { xbox: true, ps4: false, ps5: false };
	let root = controllerRoots.get(container);

	if (!root) {
		const reactDom = findReactDom(doc);
		if (reactDom) {
			if (typeof reactDom.createRoot === 'function') {
				root = reactDom.createRoot(container) as ReactRootHandle;
			} else if (typeof reactDom.render === 'function') {
				root = {
					render: node => reactDom.render(node, container),
					unmount: () => reactDom.unmountComponentAtNode?.(container),
				};
			}
			if (root) {
				controllerRoots.set(container, root);
			}
		}
	}

	if (root) {
		root.render(
			<PlaybarErrorBoundary fallback={<svg viewBox="0 0 36 36" fill="none" aria-hidden="true" />}>
				<PlaybarControllerIcons support={resolvedSupport} doc={doc} />
			</PlaybarErrorBoundary>
		);
		return () => {
			try {
				root?.unmount();
			} catch {}
			controllerRoots.delete(container);
		};
	}

	while (container.firstChild) container.removeChild(container.firstChild);
	const createSvgNode = (viewBox = '0 0 36 36') => {
		const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('viewBox', viewBox);
		svg.setAttribute('fill', 'none');
		svg.setAttribute('aria-hidden', 'true');
		return svg;
	};

	if (resolvedSupport.xbox || (!resolvedSupport.ps4 && !resolvedSupport.ps5)) {
		container.appendChild(createSvgNode());
	}
	if (resolvedSupport.ps4) {
		container.appendChild(createSvgNode());
	}
	if (resolvedSupport.ps5) {
		container.appendChild(createSvgNode());
	}

	return () => {
		while (container.firstChild) container.removeChild(container.firstChild);
	};
}
