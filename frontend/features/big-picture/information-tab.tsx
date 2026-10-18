import React from 'react';
import { loc } from '../../steam/localization';
import { openSteamNavigationUrl } from '../../steam/navigation';
import { getNativeWindowInstance } from '../../steam/native-window-store';
import { LibraryStoreAdapter } from '../../steam/gamepad/stores/LibraryStoreAdapter';
import { resolveNativeGameInfoComponent } from '../../steam/gamepad/components/AppDetailsNativeComponents';
import { resolveNativeAppDetailsClasses } from '../../steam/gamepad/components/AppDetailsNativeClasses';
import { createBigPictureDetailViews } from './detail-views';
import { isBigPictureActionCurrent } from './detail-target';
import type { BigPictureDetailData, MappedShortcut } from './types';
import { NativeButton, NativeFocusable } from './document-primitives';
import { resolveNativeInformationComponents } from '../../steam/gamepad/components/NativeInformationComponents';
import { getDocumentReact } from '../../steam/gamepad/document-ui-runtime';
import { linkedShortcutPortrait } from '../library/artwork';

function clickProps(action: () => void): { onClick: () => void } { return { onClick: action }; }
interface InformationProps { document: Document; shortcut: MappedShortcut; data: BigPictureDetailData; generation?: number; Boundary: React.ComponentType<any> }

export function InformationTab(props: InformationProps): React.ReactElement {
	const ownerReact = getDocumentReact(props.document);
	if (!ownerReact) return <></>;
	const collectionLabel = ownerReact.useId();
	const classes = resolveNativeAppDetailsClasses(props.document);
	const native = classes.GameInfo, frame = classes.GameInfoFrame, quick = classes.QuickLinks;
	const views = createBigPictureDetailViews(props.document, props.shortcut, props.data.game, true);
	const NativeInfo = resolveNativeGameInfoComponent(props.document);
	const components = resolveNativeInformationComponents(props.document);
	const game = props.data.game;
	const rows = [
		[loc('AppDetails_Developer', 'Desarrollador'), game?.developers?.join(', ')],
		[loc('AppDetails_Publisher', 'Editor'), game?.publishers?.join(', ')],
		[loc('AppDetails_Franchise', 'Franquicia'), game?.franchises?.join(', ')],
		[loc('AppDetails_ReleaseDate', 'Fecha de lanzamiento'), game?.release_date?.date],
	];
	const fallback = <div className={[frame?.AppGameInfoContainer, frame?.AppDetailsExpanded].filter(Boolean).join(' ')}>
		<div className={native?.Container}><div className={native?.InnerContainer}>
			{game ? <div className={native?.Portrait}><img className={native?.BoxArt} src={linkedShortcutPortrait(props.shortcut.id, props.shortcut.steamAppId)} alt={game.name} /></div> : null}
			<div className={[native?.Description, native?.SectionContainer].filter(Boolean).join(' ')}><div className={native?.GameDescription}>{game?.short_description}</div></div>
			<div className={[native?.Stats, native?.SectionContainer].filter(Boolean).join(' ')}>{rows.filter(([, value]) => value).map(([label, value]) => <div key={label} className={native?.AssociationList}><div className={native?.Label}>{label}</div><div className={native?.Association}>{value}</div></div>)}</div>
			<div className={[native?.FeaturesList, native?.SectionContainer].filter(Boolean).join(' ')}>{game?.categories?.map(category => <div className={classes.Feature?.Container} key={category.id}>{category.description}</div>)}</div>
		</div></div>
	</div>;
	const links = [
		[loc('AppDetails_Links_Store', 'Página de la tienda'), `https://store.steampowered.com/app/${props.shortcut.steamAppId}/`],
		...(game?.dlc?.length ? [[loc('AppDetails_Links_DLC', 'DLC'), `https://store.steampowered.com/dlc/${props.shortcut.steamAppId}/`]] : []),
		[loc('AppDetails_Links_Community', 'Punto de encuentro'), `https://steamcommunity.com/app/${props.shortcut.steamAppId}`],
		...(props.data.cards?.cards?.length ? [[loc('AppDetails_Links_PointsShop', 'Tienda de puntos'), `https://store.steampowered.com/points/shop/app/${props.shortcut.steamAppId}`]] : []),
		[loc('AppDetails_Link_Discussions', 'Discusiones'), `https://steamcommunity.com/app/${props.shortcut.steamAppId}/discussions/`],
		[loc('AppDetails_Link_Guides', 'Guías'), `https://steamcommunity.com/app/${props.shortcut.steamAppId}/guides/`],
		...(game?.categories?.some(item => item.id === 30) ? [[loc('AppDetails_Link_Workshop', 'Workshop'), `https://steamcommunity.com/app/${props.shortcut.steamAppId}/workshop/`]] : []),
		[loc('AppDetails_Link_Support', 'Soporte'), `https://help.steampowered.com/wizard/HelpWithGame/?appid=${props.shortcut.steamAppId}`],
	];
	let collections: any[] = [];
	try { collections = (components.collectionStore || LibraryStoreAdapter.getStore(props.document))?.GetCollectionListForAppID?.(props.shortcut.id >>> 0) || []; } catch {}
	const CollectionWrapper = components.CollectionWrapper || 'div';
	const collectionFallback = (collection: any) => <NativeButton {...clickProps(() => {
		if (!isBigPictureActionCurrent(props) || collection.id == null) return;
		const view = props.document.defaultView as any;
		if (!view || view.closed || view.document !== props.document) return;
		// Portal-owned CEF documents often have no g_Router. Use the same
		// exact-window histories that authorize this detail session.
		const instance = getNativeWindowInstance(props.document);
		const history = [instance?.History, instance?.m_history, view.tempNavStore?.m_history,
			view.g_Router?.history, view.g_Router?.m_history].find(value => typeof value?.push === 'function');
		try { history?.push(`/library/collection/${encodeURIComponent(collection.id)}`); } catch {}
	})}>{collection.displayName || collection.display_name || collection.name || collection.id}</NativeButton>;
	const nativeCollection = (collection: any): boolean => {
		try { return Boolean(components.CollectionCard && Array.isArray(collection.visibleApps)); } catch { return false; }
	};
	const cards = collections.map(collection => <CollectionWrapper key={collection.id}>
		{nativeCollection(collection) && components.CollectionCard
			? <props.Boundary name="collection" fallback={collectionFallback(collection)}><components.CollectionCard
				collection={collection} eCoverSize={2} bStartFocused={false} bNoFooterFilter /></props.Boundary>
			: collectionFallback(collection)}
	</CollectionWrapper>);
	let scrollElement = props.document.getElementById('gdl-bp-detail-root')?.parentElement || null;
	while (scrollElement && scrollElement !== props.document.body
		&& !/(auto|scroll)/.test(props.document.defaultView?.getComputedStyle(scrollElement).overflowY || '')) scrollElement = scrollElement.parentElement;
	if (!scrollElement || scrollElement === props.document.body) scrollElement = props.document.scrollingElement as HTMLElement | null;
	const collectionRows = <NativeFocusable flow-children="row">{cards}</NativeFocusable>;
	const guard = (event: React.SyntheticEvent) => {
		if (!isBigPictureActionCurrent(props)) { event.preventDefault(); event.stopPropagation(); }
	};
	return <NativeFocusable focusable={false} flow-children="column" className={quick?.GameInfoContainer} onClickCapture={guard} onContextMenuCapture={guard}>
		{NativeInfo ? <props.Boundary name="information" fallback={fallback}><NativeInfo {...views} concise={false} expand collapsible={false} suppressTransition /></props.Boundary> : fallback}
		<NativeFocusable flow-children="row" className={quick?.GameInfoQuickLinks}>
			{links.map(([label, url]) => {
				const fallback = <NativeButton {...clickProps(() => { if (isBigPictureActionCurrent(props)) openSteamNavigationUrl(props.document, url); })}>{label}</NativeButton>;
				return components.Link ? <props.Boundary key={url} name="information-link" fallback={fallback}>
					<components.Link label={label} url={url} isVisible />
				</props.Boundary> : <ownerReact.Fragment key={url}>{fallback}</ownerReact.Fragment>;
			})}
		</NativeFocusable>
		{collections.length ? <div className={quick?.GameInfoCollections}><div className={quick?.CollectionsHeaderContainer}><div id={collectionLabel} className={quick?.CollectionsHeader}>{loc('AppDetails_GameInfo_CollectionsHeader', 'Colecciones')}</div><div className={quick?.CollectionsHeaderHR} /></div>
			{components.CollectionGrid && components.grid && scrollElement ? <props.Boundary name="collection-grid" fallback={collectionRows}>
				<components.CollectionGrid aria-labelledby={collectionLabel} {...components.grid} scaleGridItems={1} renderOutsideRows={2}
					paddingLeft={0} paddingRight={0} gridClassName={quick?.Grid} scrollElement={scrollElement} childElements={cards} name="GameInfo Collections" />
			</props.Boundary> : collectionRows}
		</div> : null}
	</NativeFocusable>;
}
