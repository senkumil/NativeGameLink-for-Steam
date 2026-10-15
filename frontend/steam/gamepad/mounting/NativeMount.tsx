import React, { Component, type ReactNode } from 'react';
import { backendLog } from '../../../api/backend';
import { gamepadCapabilities, type GamepadCapabilityKey } from '../GamepadCapabilities';

export interface NativeMountProps {
	document?: Document;
	capabilityKey: GamepadCapabilityKey;
	nativeComponent: React.ComponentType<any> | null;
	nativeProps: Record<string, any>;
	fallback: ReactNode;
}

interface NativeMountState {
	hasError: boolean;
	errorMessage?: string;
}

export class NativeMount extends Component<NativeMountProps, NativeMountState> {
	constructor(props: NativeMountProps) {
		super(props);
		this.state = { hasError: false };
	}

	static getDerivedStateFromError(error: Error): NativeMountState {
		return { hasError: true, errorMessage: error.message };
	}

	componentDidCatch(error: Error, _errorInfo: React.ErrorInfo): void {
		backendLog(`[NGL][Gamepad][NativeMount] Error rendering native component for "${this.props.capabilityKey}": ${error.message}`);
		gamepadCapabilities.recordFailure(this.props.capabilityKey, error, this.props.document);
	}

	render(): ReactNode {
		const { capabilityKey, nativeComponent: NativeComp, nativeProps, fallback } = this.props;

		if (this.state.hasError || !NativeComp || !gamepadCapabilities.isAvailable(capabilityKey, this.props.document)) {
			return fallback;
		}

		try {
			return <NativeComp {...nativeProps} />;
		} catch (error) {
			backendLog(`[NGL][Gamepad][NativeMount] Immediate error rendering "${capabilityKey}": ${error}`);
			gamepadCapabilities.recordFailure(capabilityKey, error, this.props.document);
			return fallback;
		}
	}
}
