import React, { Component, type ReactNode } from 'react';
import type { SteamCommunityCardAsset, SteamCommunityItemsCatalog } from '../../domain/types';
import type { NativeAppDetailsClasses } from '../../steam/gamepad/components/AppDetailsNativeClasses';
import { steamWebpackRuntime } from '../../steam/modules/SteamWebpackRuntime';
import { DocumentRuntimeCache } from '../../steam/gamepad/runtime-cache';
import { normalizeCommunityAssetUrl } from '../library/community-items';
import { linkedCardPresentation } from '../library/linked-card-presentation';
import { gdlText, loc } from '../../steam/localization';
import { NativeFocusable, NativeButton } from './document-primitives';

interface Card extends SteamCommunityCardAsset { owned: number | null }
const clickProps = (onClick: () => void) => ({ onClick });
interface Props {
	document: Document;
	steamAppId: string;
	catalog: SteamCommunityItemsCatalog | null;
	hydrating: boolean;
	classes: NativeAppDetailsClasses;
	Section: React.ComponentType<any>;
	Strip: React.ComponentType<any>;
	isCurrent(): boolean;
	onOpenCard(card: SteamCommunityCardAsset): void;
	onOpenBadge(): void;
}
type BadgeHook = (appid: number) => any;
const hooks = new DocumentRuntimeCache(() => ({ count: -1, hook: null as BadgeHook | null }));

/** Steam's observable badge reader, from this document's runtime only. Its
 * empty account response must never gate the linked game's public catalogue. */
function nativeBadgeHook(doc: Document): BadgeHook | null {
	const req = steamWebpackRuntime.getRequire(doc);
	if (!req) return null;
	const state = hooks.get(doc), count = steamWebpackRuntime.getModuleFactoryCount(doc);
	if (state.count === count) return state.hook;
	state.count = count;
	for (const { id, factory } of steamWebpackRuntime.getModuleFactories(doc)) {
		if (req.m?.[id] !== factory || !['m_mapBadgeData', 'GetBadgeData(', 'strNextLevelName', 'GetCommunityItemDefinitions(', 'H_:'].every(token => String(factory).includes(token))) continue;
		try {
			const hook = req(Number(id))?.H_;
			if (typeof hook === 'function' && String(hook).includes('GetBadgeData')) return state.hook = hook;
		} catch {}
	}
	return state.hook = null;
}

export function bigPictureTradingCards(catalog: SteamCommunityItemsCatalog | null, badge: any): Card[] {
	const native = Array.isArray(badge?.rgCards) ? badge.rgCards : [];
	const owned = new Map<string, number>();
	for (const card of native) {
		const image = normalizeCommunityAssetUrl(card.strImgURL);
		if (image && Number.isFinite(card.nOwned) && card.nOwned >= 0) owned.set(image, card.nOwned);
	}
	const assets: SteamCommunityCardAsset[] = catalog?.cards?.length ? catalog.cards : native.map((card: any) => ({
		title: String(card.strTitle || card.strName || ''), image: normalizeCommunityAssetUrl(card.strImgURL),
		artwork: normalizeCommunityAssetUrl(card.strArtworkURL),
	}));
	return assets.filter(card => !!card.image && !card.foil).map(card => ({ ...card,
		owned: owned.get(normalizeCommunityAssetUrl(card.image)) ?? null,
	}));
}

class BadgeBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
	state = { failed: false };
	static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
	render(): ReactNode { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function NativeBigPictureTradingCards(props: Props): React.ReactElement | null {
	if (!props.isCurrent()) return null;
	const fallback = <CardsContent {...props} badge={null} />;
	// The linked catalogue already has all presentation data. Do not start an
	// account badge request (and its observable rerenders) just to show it.
	if (props.catalog) return fallback;
	const readBadge = nativeBadgeHook(props.document);
	return readBadge ? <BadgeBoundary key={props.steamAppId} fallback={fallback}>
		<CardsWithBadge {...props} readBadge={readBadge} />
	</BadgeBoundary> : fallback;
}
function CardsWithBadge(props: Props & { readBadge: BadgeHook }): React.ReactElement {
	return <CardsContent {...props} badge={props.readBadge(Number(props.steamAppId))} />;
}

function CardsContent(props: Props & { badge: any }): React.ReactElement {
	const { badge, classes, Section, Strip } = props, css = classes.TradingCard;
	const cards = bigPictureTradingCards(props.catalog, badge);
	const presentation = linkedCardPresentation(props.catalog);
	const badgeImage = presentation.badge?.image || cards[0]?.image;
	const badgeName = presentation.badge?.title || props.catalog?.badges?.[0]?.title;
	const openBadge = () => { if (props.isCurrent()) props.onOpenBadge(); };
	const highlight = cards.length > 0 ? <div className={css?.BadgeSection}>
		{badgeImage ? <img className={css?.Badge} src={badgeImage} alt="" data-gdl-badge-preview="1" />
			: <div className={[css?.Badge, css?.EmptyCircle].filter(Boolean).join(' ')} />}
		<div className={css?.BadgeInfo}>
			<div className={css?.BadgeName}>{badgeName || loc('AppDetails_SectionTitle_TradingCards', 'Tarjetas')}</div>
			<div className={css?.BadgeLevel}>{gdlText('experience_points', '100 XP')}</div>
		</div>
	</div> : undefined;
	const row = (items: Card[], name: string) => items.length > 0 ? <Strip document={props.document} name={name}>
		{items.map((card, index) => <NativeFocusable key={`${card.image}-${index}`} focusable
			data-gdl-focus-key={`trading-card-${name}-${index}`} data-gdl-card-ownership={card.owned === null ? 'unknown' : card.owned > 0 ? 'owned' : 'unowned'}
			className={[css?.TradingCardCarouselItem, 'gdl-bp-trading-card'].filter(Boolean).join(' ')}
			onActivate={() => { if (props.isCurrent()) props.onOpenCard(card); }}
			onClick={() => { if (props.isCurrent()) props.onOpenCard(card); }}>
			<div className={css?.CardWrapper}
				style={{ width: 100, height: 100 * 261 / 224 }}>
				<div className={[css?.Card, css?.Loaded, css?.Clickable].filter(Boolean).join(' ')} style={{ width: '100%', height: '100%', inset: 0 }}>
					<div className={css?.CardContainer}>
						<img className={css?.CardImage} src={card.image} alt={card.title} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
						<div className={css?.Title}>{card.title}</div>
					</div>
				</div>
			</div>
		</NativeFocusable>)}
	</Strip> : null;
	return <Section classes={classes} label={loc('AppDetails_SectionTitle_TradingCards', gdlText('trading_cards', 'Trading cards'))}
		className={css?.Container} highlight={highlight} rightColumn>
		{cards.length > 0 ? <div className={css?.CardsLeft}>{gdlText('cards_remaining', '{count} cards remaining', { count: presentation.remaining })}</div> : null}
		{row(cards, 'Card catalogue')}
		{cards.length === 0 ? <div role="status">{props.hydrating ? loc('Loading', 'Loading...')
			: gdlText('trading_cards_empty', 'No cards are available to display.')}</div> : null}
		<NativeButton {...clickProps(openBadge)} data-gdl-focus-key={`trading-cards-badge-${props.steamAppId}`}>
			{loc('AppDetails_TradingCards_ViewBadgeProgress', 'Ver progreso de la insignia')}
		</NativeButton>
	</Section>;
}
