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
	// Avoid status component: calls useQuery() which crashes in isolated roots without QueryClientProvider
	const ControllerType = nativeIcons?.ControllerType || (IconsModule as any)?.ControllerType;
	const Controller = nativeIcons?.Controller || (IconsModule as any)?.Controller;
	const XboxOutline = nativeIcons?.XboxOneControllerFrontOutline || (IconsModule as any)?.XboxOneControllerFrontOutline;
	const Ps4Outline = nativeIcons?.PS4ControllerFrontOutline || (IconsModule as any)?.PS4ControllerFrontOutline;
	const Ps5Outline = nativeIcons?.PS5ControllerFrontOutline || (IconsModule as any)?.PS5ControllerFrontOutline;

	const items: React.ReactNode[] = [];

	// 1. Xbox controller (rendered when game supports Xbox, or as baseline fallback if neither PS4 nor PS5)
	if (support.xbox || (!support.ps4 && !support.ps5)) {
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
		items.push(<FallbackControllerSvg key="fallback" type="fallback" />);
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
			<PlaybarErrorBoundary fallback={<FallbackControllerSvg />}>
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
	const createSvgNode = () => {
		const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('viewBox', '0 0 24 24');
		svg.setAttribute('width', '22');
		svg.setAttribute('height', '22');
		svg.setAttribute('fill', 'currentColor');
		svg.setAttribute('aria-hidden', 'true');
		const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
		path.setAttribute('d', 'M7 6h10a6 6 0 0 1 6 6v3a4 4 0 0 1-4 4 2 2 0 0 1-2-2l-1.5-3h-7L7 20a2 2 0 0 1-2 2 4 4 0 0 1-4-4v-3a6 6 0 0 1 6-6zm0 2a4 4 0 0 0-4 4v3a2 2 0 0 0 2 2l2-4h10l2 4a2 2 0 0 0 2-2v-3a4 4 0 0 0-4-4H7zm1 2h2v1.5H8.5V13H7v-1.5H5.5V10H7V8.5h1.5V10zm8.5 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm2 2a1 1 0 1 1 0 2 1 1 0 0 1 0-2z');
		svg.appendChild(path);
		return svg;
	};

	if (resolvedSupport.xbox || resolvedSupport.ps4 || resolvedSupport.ps5) {
		container.appendChild(createSvgNode());
	}

	return () => {
		while (container.firstChild) container.removeChild(container.firstChild);
	};
}
