import React from 'react';
import { loc } from '../../steam/localization';
import { openSteamNavigationUrl } from '../../steam/navigation';
import type { NativeAppDetailsClasses } from '../../steam/gamepad/components/AppDetailsNativeClasses';
import { showBigPictureModal } from './owned-modals';
import { isBigPictureActionCurrent, type BigPictureActionOwner } from './detail-target';
import { NativeButton } from './document-primitives';

function clickProps(action: () => void): { onClick: () => void } { return { onClick: action }; }

export function showNativeImageModal(owner: BigPictureActionOwner, title: string, imageUrl: string, classes: NativeAppDetailsClasses): void {
	if (!imageUrl || !isBigPictureActionCurrent(owner)) return;
	if (!showBigPictureModal(owner.document, 'gdl-bp-community-modal', title, close => <>
		<img className={classes.Media?.ScreenshotModal} width="100%" src={imageUrl} alt={title} />
		<NativeButton {...clickProps(close)}>{loc('Button_Close', 'Cerrar')}</NativeButton>
	</>)) openSteamNavigationUrl(owner.document, imageUrl);
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
