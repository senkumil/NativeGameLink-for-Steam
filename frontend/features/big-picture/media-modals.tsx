import React from 'react';
import { loc } from '../../steam/localization';
import { openSteamNavigationUrl } from '../../steam/navigation';
import type { NativeAppDetailsClasses } from '../../steam/gamepad/components/AppDetailsNativeClasses';
import { showBigPictureModal } from './owned-modals';
import { isBigPictureActionCurrent, type BigPictureActionOwner } from './detail-target';
import { NativeButton, NativeFocusable } from './document-primitives';

function clickProps(action: () => void): { onClick: () => void } { return { onClick: action }; }

export function showNativeImageModal(owner: BigPictureActionOwner, title: string, imageUrl: string, classes: NativeAppDetailsClasses, fullScreen = false): void {
	if (!imageUrl || !isBigPictureActionCurrent(owner)) return;
	const artwork = classes.ArtworkModal;
	if (!showBigPictureModal(owner.document, 'gdl-bp-community-modal', title, close => fullScreen ?
		<NativeFocusable focusable={false} flow-children="column" onCancelButton={close}
			data-gdl-card-artwork="1" style={{ width: '100%', height: '100%', padding: 24, boxSizing: 'border-box' }}>
			<div className={[artwork?.ArtworkModal, artwork?.ModalBox].filter(Boolean).join(' ')} style={{ width: '100%', height: '100%', overflow: 'hidden', backgroundColor: '#25282e' }}>
				<div className={artwork?.ArtworkModalContainer} style={{ height: '100%', boxSizing: 'border-box' }}>
					<div className={artwork?.ArtworkContainer} style={{ maxWidth: '100%', flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
						<img src={imageUrl} alt={title} style={{ maxWidth: '100%', width: 'auto', maxHeight: 600, objectFit: 'contain' }} />
					</div>
					<div className={artwork?.ArtworkModalDetails}><div className={artwork?.Header}>
						<NativeButton className={artwork?.ModalArtCloseButton} style={{ display: 'block', width: '50%', margin: '0 auto' }} {...clickProps(close)}>{loc('Button_Close', 'Cerrar')}</NativeButton>
					</div></div>
				</div>
			</div>
		</NativeFocusable> : <>
		<img className={classes.Media?.ScreenshotModal} width="100%" src={imageUrl} alt={title} />
		<NativeButton {...clickProps(close)}>{loc('Button_Close', 'Cerrar')}</NativeButton>
	</>, { fullScreen })) openSteamNavigationUrl(owner.document, imageUrl);
}

export function showNativeVideoModal(owner: BigPictureActionOwner, title: string, youtubeId: string): void {
	if (!/^[\w-]{11}$/.test(youtubeId) || !isBigPictureActionCurrent(owner)) return;
	if (!showBigPictureModal(owner.document, 'gdl-bp-community-modal', title, close => <>
		<div className="gdl-bp-video-modal-wrap"><iframe
			src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeId)}?autoplay=1&enablejsapi=1&rel=0`}
			className="gdl-bp-video-modal-frame" title={title}
			allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen />
		</div>
		<div className="gdl-bp-video-modal-footer"><NativeButton {...clickProps(close)}>{loc('Button_Close', 'Cerrar')}</NativeButton></div>
	</>)) openSteamNavigationUrl(owner.document, `https://www.youtube.com/watch?v=${youtubeId}`);
}
