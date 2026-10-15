import React from 'react';
import { getDocumentReact, getDocumentUIComponents } from '../../steam/gamepad/document-ui-runtime';

// Context is a plain React context object; class consumers receive its value
// from the owner renderer without calling hooks from the plugin's React copy.
export const BigPictureUIContext = React.createContext<Document | null>(null);
export function BigPictureUIProvider(props: { document: Document; children: React.ReactNode }): React.ReactElement {
	return <BigPictureUIContext.Provider value={props.document}>{props.children}</BigPictureUIContext.Provider>;
}

type PrimitiveKind = 'Focusable' | 'DialogButton' | 'ProgressBar' | 'Spinner';
function primitive(kind: PrimitiveKind): React.ComponentType<any> {
	return class OwnerPrimitive extends React.Component<any> {
		static contextType = BigPictureUIContext;
		declare context: Document | null;
		render(): React.ReactNode {
			const { document: explicit, ...props } = this.props;
			const doc: Document | null = explicit || this.context;
			if (!doc) return null;
			const ownerReact = getDocumentReact(doc);
			if (!ownerReact) return null;
			const Native = getDocumentUIComponents(doc)[kind];
			const inputProps = kind === 'Focusable' && !props.onActivate && !props.onOKButton && typeof props.onClick === 'function'
				? { ...props, onActivate: props.onClick } : props;
			if (Native) return ownerReact.createElement(Native, inputProps);
			if (kind === 'ProgressBar') return ownerReact.createElement('div', {
				role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.max(0, Math.min(100, Math.round(props.nProgress || 0))),
				className: 'gdl-bp-progress',
			}, ownerReact.createElement('div', { style: { width: `${Math.max(0, Math.min(100, props.nProgress || 0))}%` } }));
			if (kind === 'Spinner') return ownerReact.createElement('div', { role: 'status', className: 'gdl-bp-loading' });
			const { onActivate, focusable, children, scrollIntoViewWhenChildFocused: _scroll, navRef: _nav,
				onCancelButton: _cancel, onSecondaryButton: _secondary, onOptionsButton: _options,
				onButtonDown: _down, onGamepadDirection: _direction, ...dom } = props;
			return ownerReact.createElement(kind === 'DialogButton' ? 'button' : 'div', {
				...dom, ...(kind === 'DialogButton' ? { type: 'button' } : {}),
				...(focusable ? { tabIndex: dom.tabIndex ?? 0 } : {}),
				onClick: dom.onClick || onActivate,
			}, children);
		}
	};
}

export const NativeFocusable = primitive('Focusable');
export const NativeButton = primitive('DialogButton');
export const NativeProgress = primitive('ProgressBar');
export const NativeSpinner = primitive('Spinner');
const iconComponents = new Map<string, React.ComponentType<any>>();
export const NativeIcons = new Proxy({} as Record<string, React.ComponentType<any>>, {
	get: (_target, key: string) => {
		if (!iconComponents.has(key)) iconComponents.set(key, class OwnerIcon extends React.Component<any> {
			static contextType = BigPictureUIContext;
			declare context: Document | null;
			render(): React.ReactNode {
				const { document: explicit, ...props } = this.props;
				const doc = explicit || this.context;
				if (!doc) return null;
				const C = getDocumentUIComponents(doc).IconsModule?.[key];
				return C ? getDocumentReact(doc)?.createElement(C, props) || null : null;
			}
		});
		return iconComponents.get(key);
	},
});
