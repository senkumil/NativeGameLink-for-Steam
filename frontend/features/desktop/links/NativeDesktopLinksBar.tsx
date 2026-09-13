import React, { Component, ErrorInfo, ReactNode } from 'react';
import { backendLog } from '../../../api/backend';
import { steamComponents } from '../../../steam/modules/SteamComponentResolver';
import { desktopFeatureFlags } from '../flags';
import { toSteamDesktopLinks, PrimaryLinksAdapterOptions } from '../../../steam/desktop/adapters/SteamDesktopLinksAdapter';

interface ErrorBoundaryProps {
	children: ReactNode;
	fallback?: ReactNode;
}

interface ErrorBoundaryState {
	hasError: boolean;
	error: string;
}

export class NativeGameLinkLinksErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
	state: ErrorBoundaryState = { hasError: false, error: '' };

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return { hasError: true, error: error?.message || 'Error in Desktop Native Links Bar' };
	}

	componentDidCatch(error: Error, info: ErrorInfo): void {
		backendLog(`[NGL][Desktop][Links] Error in native links bar: ${error} stack: ${info.componentStack}`);
	}

	render(): ReactNode {
		if (this.state.hasError) {
			return this.props.fallback || null;
		}
		return this.props.children;
	}
}

interface NativeDesktopLinksBarProps extends PrimaryLinksAdapterOptions {
	fallback?: ReactNode;
}

export const NativeDesktopLinksBar: React.FC<NativeDesktopLinksBarProps> = ({
	fallback,
	...options
}) => {
	if (!desktopFeatureFlags.desktopNativeLinks || !desktopFeatureFlags.desktopNativeUIEnabled) {
		return fallback ? <>{fallback}</> : null;
	}

	const NativeLinksComponent = steamComponents.resolve('DesktopLinksBar');
	if (!NativeLinksComponent) {
		return fallback ? <>{fallback}</> : null;
	}

	const props = toSteamDesktopLinks(options);

	return (
		<NativeGameLinkLinksErrorBoundary fallback={fallback}>
			<NativeLinksComponent {...props} />
		</NativeGameLinkLinksErrorBoundary>
	);
};

export function mountNativeDesktopLinksBar(
	container: HTMLElement,
	options: PrimaryLinksAdapterOptions,
	fallbackNode?: HTMLElement | null,
): () => void {
	const win = container.ownerDocument.defaultView as any;
	const reactDom = win?.ReactDOM || (typeof window !== 'undefined' ? (window as any).ReactDOM : null);
	if (!reactDom) {
		if (fallbackNode) container.appendChild(fallbackNode);
		return () => {};
	}

	try {
		if (typeof reactDom.createRoot === 'function') {
			const root = reactDom.createRoot(container);
			root.render(
				<NativeDesktopLinksBar
					{...options}
					fallback={fallbackNode ? <div ref={node => { if (node && fallbackNode && !node.hasChildNodes()) node.appendChild(fallbackNode); }} /> : null}
				/>
			);
			return () => {
				try { root.unmount(); } catch {}
			};
		}
		if (typeof reactDom.render === 'function') {
			reactDom.render(
				<NativeDesktopLinksBar
					{...options}
					fallback={fallbackNode ? <div ref={node => { if (node && fallbackNode && !node.hasChildNodes()) node.appendChild(fallbackNode); }} /> : null}
				/>,
				container
			);
			return () => {
				try { reactDom.unmountComponentAtNode?.(container); } catch {}
			};
		}
	} catch (e) {
		backendLog(`[NGL][Desktop][Links] React mount error: ${e}`);
		if (fallbackNode) container.appendChild(fallbackNode);
	}

	return () => {};
}
