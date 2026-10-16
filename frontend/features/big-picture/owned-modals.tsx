import React, { type ReactNode } from 'react';
import { getDocumentReact, getDocumentRenderer, getDocumentModalRuntime } from '../../steam/gamepad/document-ui-runtime';
import { steamWebpackRuntime } from '../../steam/modules/SteamWebpackRuntime';
import { isCurrentLinkedGamepadTarget } from '../../steam/gamepad/GamepadContext';
import { steamUIModeService } from '../../steam/ui/SteamUIModeService';
import { captureBigPictureReturnFocus, dismissBigPictureFocusRing } from './gamepad-nav';
import { BigPictureUIProvider } from './document-primitives';
import { registerBigPictureModalClose } from './modal-actions';
import { resolveSteamNav } from '../../steam/gamepad/components/AppDetailsNativeComponents';

type OwnedModal = { close: (restoreFocus?: boolean) => void; isCurrent: () => boolean };
const modalsByDocument = new Map<Document, Set<OwnedModal>>();
export interface BigPictureModalLease {
	react: NonNullable<ReturnType<typeof getDocumentReact>>;
	isCurrent: () => boolean;
	invalidate: () => void;
}
export interface BigPictureModalOptions { fullScreen?: boolean }

export function disposeBigPictureModals(doc: Document): void {
	for (const modal of [...(modalsByDocument.get(doc) || [])]) modal.close(false);
	modalsByDocument.delete(doc);
}

/** Every modal belongs to one linked-detail mount. Steam's other dialogs and
 * routing remain untouched, including when a pending callback closes a modal. */
export function showBigPictureModal(doc: Document, id: string, title: string,
	render: (close: () => void, lease: BigPictureModalLease) => ReactNode, options: BigPictureModalOptions = {}): boolean {
	const root = doc.getElementById('gdl-bp-detail-root');
	if (!root || !/^gdl-bp-[a-z0-9-]+$/.test(id)) return false;
	const shortcutId = root.dataset.gdlShortcutAppId, steamId = root.dataset.gdlSteamAppId;
	const generation = root.dataset.gdlBpGeneration;
	const ownsRoute = () => root.isConnected && doc.getElementById(root.id) === root
		&& root.dataset.gdlBpGeneration === generation && root.dataset.gdlShortcutAppId === shortcutId
		&& root.dataset.gdlSteamAppId === steamId && steamUIModeService.isGamepadUI(doc)
		&& isCurrentLinkedGamepadTarget(doc, shortcutId, steamId);
	if (!ownsRoute()) return false;
	const modalRuntime = getDocumentModalRuntime(doc), ownerReact = getDocumentReact(doc);
	if (!modalRuntime || !ownerReact) return false;
	const { ModalRoot, showModal } = modalRuntime;
	const fullScreen = options.fullScreen === true;
	const modalClass = `gdl-bp-fullscreen-modal-${id}`, bodyClass = `gdl-bp-fullscreen-body-${id}`;
	// Steam creates the modal's navigation tree, focus ring and window context.
	// Only the committed owner's data/router providers cross into its content;
	// borrowing the details tree here would leave B/Back on the wrong screen.
	let providers: Array<{ context: any; value: any }> = [];
	try { providers = (resolveSteamNav?.(doc)?.providers || []).filter(provider =>
		['query-client', 'router-history', 'service-transport', 'active-account'].includes(provider.kind)); } catch {}
	const renderer = getDocumentRenderer(doc), runtime = steamWebpackRuntime.getRuntimeIdentity(doc);
	const isCurrent = () => {
		if (!ownsRoute() || getDocumentReact(doc) !== ownerReact || getDocumentRenderer(doc) !== renderer
			|| steamWebpackRuntime.getRuntimeIdentity(doc) !== runtime) return false;
		const current = getDocumentModalRuntime(doc);
		return current?.ModalRoot === ModalRoot && current.showModal === showModal;
	};
	if (!isCurrent()) return false;
	disposeBigPictureModals(doc);
	const restore = captureBigPictureReturnFocus(doc);
	dismissBigPictureFocusRing(doc);
	let handle: { Close(): void } | undefined;
	let closed = false;
	let unregisterClose = () => {};
	const view = doc.defaultView!;
	const observer = new view.MutationObserver(() => { if (!isCurrent()) close(false); });
	const modeObserver = new view.MutationObserver(() => { if (!isCurrent()) close(false); });
	const onRoute = () => { if (!isCurrent()) close(false); };
	const onUnload = () => close(false);
	const close = (restoreFocus = true) => {
		if (closed) return;
		closed = true;
		unregisterClose();
		observer.disconnect();
		modeObserver.disconnect();
		view.removeEventListener('popstate', onRoute);
		view.removeEventListener('hashchange', onRoute);
		view.removeEventListener('beforeunload', onUnload);
		modalsByDocument.get(doc)?.delete(state);
		if (!modalsByDocument.get(doc)?.size) modalsByDocument.delete(doc);
		try { handle?.Close(); } catch {}
		if (restoreFocus && isCurrent()) restore();
	};
	const state: OwnedModal = { close, isCurrent };
	const lease: BigPictureModalLease = { react: ownerReact, isCurrent, invalidate: () => close(false) };
	function Lifecycle(props: { children: ReactNode }): ReactNode {
		const element = ownerReact!.useRef<HTMLDivElement>(null);
		ownerReact!.useLayoutEffect(() => {
			if (element.current) unregisterClose = registerBigPictureModalClose(element.current, () => close());
			return () => { unregisterClose(); close(false); };
		}, []);
		ownerReact!.useLayoutEffect(() => { if (!isCurrent()) close(false); });
		if (!isCurrent()) return null;
		let content = props.children;
		for (const provider of providers) content = ownerReact!.createElement(provider.context.Provider, { value: provider.value }, content);
		return ownerReact!.createElement('div', { id, 'data-gdl-bp-modal-owner': shortcutId,
			...(fullScreen ? { 'data-gdl-bp-fullscreen': '1' } : {}), ref: element },
			fullScreen ? ownerReact!.createElement('style', { 'data-gdl-bp-fullscreen-styles': id }, `
.${modalClass}{padding:0!important;overflow:hidden!important}
.${modalClass} .ModalPosition_Content{width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;margin:0!important;padding:0!important}
.${modalClass} .ModalPosition_TopBar,.${modalClass} .ModalPosition_Dismiss{display:none!important}
.${bodyClass}{position:fixed!important;inset:var(--basicui-header-height,56px) 0 var(--gamepadui-current-footer-height,56px)!important;width:100%!important;height:auto!important;max-width:none!important;max-height:none!important;min-width:0!important;min-height:0!important;margin:0!important;padding:0!important;border:0!important;border-radius:0!important;box-sizing:border-box!important;animation:none!important;transform:none!important;background:transparent!important;overflow:hidden!important}
.${bodyClass} .DialogContent_InnerWidth,.${bodyClass} .DialogBody{width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;min-width:0!important;min-height:0!important;margin:0!important;padding:0!important;box-sizing:border-box!important}
.${bodyClass}>.DialogContent_InnerWidth>form,.${bodyClass}>form{width:100%!important;height:100%!important;min-height:0!important;margin:0!important;padding:0!important;box-sizing:border-box!important}
#${id}[data-gdl-bp-fullscreen="1"]{position:relative!important;width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;min-width:0!important;min-height:0!important;overflow:hidden!important;box-sizing:border-box!important}
`) : null, content);
	}
	let active = modalsByDocument.get(doc);
	if (!active) modalsByDocument.set(doc, active = new Set());
	active.add(state);
	try {
		handle = showModal(
			<ModalRoot onCancel={() => close()} closeModal={() => close()} bAllowFullSize bDisableBackgroundDismiss
				{...(fullScreen ? { className: bodyClass, modalClassName: modalClass, bHideCloseIcon: true } : {})}>
				<Lifecycle><BigPictureUIProvider document={doc}>{render(() => close(), lease)}</BigPictureUIProvider></Lifecycle>
			</ModalRoot>, view as EventTarget,
			{ strTitle: title, bNeverPopOut: true, bHideMainWindowForPopouts: false },
		);
		if (closed) handle.Close();
		else {
			observer.observe(doc.body, { childList: true, subtree: true });
			modeObserver.observe(doc.body, { attributes: true, attributeFilter: ['class'] });
			modeObserver.observe(doc.documentElement, { attributes: true, attributeFilter: ['class'] });
			view.addEventListener('popstate', onRoute);
			view.addEventListener('hashchange', onRoute);
			view.addEventListener('beforeunload', onUnload);
		}
		return !closed;
	} catch { close(false); return false; }
}
