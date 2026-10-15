import React, { type ReactNode } from 'react';
import { getDocumentReact, getDocumentRenderer, getDocumentModalRuntime } from '../../steam/gamepad/document-ui-runtime';
import { steamWebpackRuntime } from '../../steam/modules/SteamWebpackRuntime';
import { isCurrentLinkedGamepadTarget } from '../../steam/gamepad/GamepadContext';
import { steamUIModeService } from '../../steam/ui/SteamUIModeService';
import { captureBigPictureReturnFocus, dismissBigPictureFocusRing } from './gamepad-nav';
import { BigPictureUIProvider } from './document-primitives';
import { registerBigPictureModalClose } from './modal-actions';

type OwnedModal = { close: (restoreFocus?: boolean) => void; isCurrent: () => boolean };
const modalsByDocument = new Map<Document, Set<OwnedModal>>();
export interface BigPictureModalLease {
	react: NonNullable<ReturnType<typeof getDocumentReact>>;
	isCurrent: () => boolean;
	invalidate: () => void;
}

export function disposeBigPictureModals(doc: Document): void {
	for (const modal of [...(modalsByDocument.get(doc) || [])]) modal.close(false);
	modalsByDocument.delete(doc);
}

/** Every modal belongs to one linked-detail mount. Steam's other dialogs and
 * routing remain untouched, including when a pending callback closes a modal. */
export function showBigPictureModal(doc: Document, id: string, title: string,
	render: (close: () => void, lease: BigPictureModalLease) => ReactNode): boolean {
	const root = doc.getElementById('gdl-bp-detail-root');
	if (!root || !id.startsWith('gdl-bp-')) return false;
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
		return ownerReact!.createElement('div', { id, 'data-gdl-bp-modal-owner': shortcutId, ref: element }, props.children);
	}
	let active = modalsByDocument.get(doc);
	if (!active) modalsByDocument.set(doc, active = new Set());
	active.add(state);
	try {
		handle = showModal(
			<ModalRoot onCancel={() => close()} closeModal={() => close()} bAllowFullSize bDisableBackgroundDismiss>
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
