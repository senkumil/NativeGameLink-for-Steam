import React, { Component, type ReactNode } from 'react';
import type { SteamCommunityCardAsset, SteamCommunityItemsCatalog } from '../../domain/types';
import type { NativeAppDetailsClasses } from '../../steam/gamepad/components/AppDetailsNativeClasses';
import { steamWebpackRuntime } from '../../steam/modules/SteamWebpackRuntime';
import { DocumentRuntimeCache } from '../../steam/gamepad/runtime-cache';
import { normalizeCommunityAssetUrl } from '../library/community-items';
import { gdlText, loc } from '../../steam/localization';
import { NativeFocusable, NativeButton } from './document-primitives';
import { resolveNativeStuffComponents } from '../../steam/gamepad/components/NativeStuffComponents';

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
function hasNativeInventory(badge: any): boolean {
	return Array.isArray(badge?.rgCards) && badge.rgCards.every((card: any) => Number.isSafeInteger(card?.nOwned) && card.nOwned >= 0);
}

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
	const known = hasNativeInventory(badge);
	const native = known ? badge.rgCards : [];
	const owned = new Map<string, number>();
	for (const card of native) {
		const image = normalizeCommunityAssetUrl(card.strImgURL);
		if (image && Number.isFinite(card.nOwned) && card.nOwned >= 0) owned.set(image, card.nOwned);
	}
	const nativeAssets = native.map((card: any) => ({
		title: String(card.strTitle || card.strName || ''), image: normalizeCommunityAssetUrl(card.strImgURL),
		artwork: normalizeCommunityAssetUrl(card.strArtworkURL),
	}));
	const assets: SteamCommunityCardAsset[] = known ? nativeAssets : catalog?.cards || [];
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
	const readBadge = nativeBadgeHook(props.document);
	return readBadge ? <BadgeBoundary key={props.steamAppId} fallback={fallback}>
		<CardsWithBadge {...props} readBadge={readBadge} />
	</BadgeBoundary> : fallback;
}
function CardsWithBadge(props: Props & { readBadge: BadgeHook }): React.ReactElement {
	const badge = props.readBadge(Number(props.steamAppId));
	const NativeCards = hasNativeInventory(badge) ? resolveNativeStuffComponents(props.document).Cards : null;
	const fallback = <CardsContent {...props} badge={badge} />;
	if (!NativeCards) return fallback;
	return <BadgeBoundary key={`native-${props.steamAppId}`} fallback={fallback}>
		<div data-gdl-bp-native-cards="1" style={{ display: 'contents' }} onClickCapture={event => {
			if (!props.isCurrent()) { event.preventDefault(); event.stopPropagation(); }
		}}><NativeCards details={{ unAppID: Number(props.steamAppId) }} /></div>
	</BadgeBoundary>;
}

function CardsContent(props: Props & { badge: any }): React.ReactElement | null {
	const { badge, classes, Section, Strip } = props, css = classes.TradingCard;
	const cards = bigPictureTradingCards(props.catalog, badge);
	if (!props.hydrating && cards.length === 0) return null;
	const known = hasNativeInventory(badge);
	const badgeImage = known ? badge.nLevel > 0 ? normalizeCommunityAssetUrl(badge.strIconURL) : ''
		: '';
	const badgeName = known ? badge.nLevel > 0 ? badge.strName : badge.strNextLevelName
		: '';
	const remaining = badge?.bMaxed ? 0 : cards.filter(card => card.owned === 0).length;
	const remainingLabel = badge?.bMaxed ? loc('AppDetails_TradingCardsMaxed', 'Badge level is complete')
		: remaining === 0 ? loc('AppDetails_TradingCardsLevelUp', 'Ready to craft a badge')
		: gdlText('cards_remaining', '{count} cards remaining', { count: remaining });
	const openBadge = () => { if (props.isCurrent()) props.onOpenBadge(); };
	const highlight = cards.length > 0 ? <div className={css?.BadgeSection}>
		{badgeImage ? <img className={css?.Badge} src={badgeImage} alt="" data-gdl-badge-preview="1" />
			: <div className={[css?.Badge, css?.EmptyCircle].filter(Boolean).join(' ')} />}
		<div className={css?.BadgeInfo}>
			<div className={css?.BadgeName}>{badgeName || loc('AppDetails_SectionTitle_TradingCards', 'Tarjetas')}</div>
			{known ? <div className={css?.BadgeLevel}>{badge.nLevel > 0
				? loc('AppDetails_BadgeLevel', 'Level %1$s, %2$s XP').replace('%1$s', String(badge.nLevel)).replace('%2$s', String(badge.nXP ?? 0))
				: loc('AppDetails_UnearnedBadgeXP', '%1$s XP').replace('%1$s', String(badge.nNextLevelXP ?? 0))}</div> : null}
		</div>
	</div> : undefined;
	const row = (items: Card[], name: string) => items.length > 0 ? <Strip document={props.document} name={name} className={css?.SummaryCarouselContainer}>
		{items.map((card, index) => {
			const missing = known && card.owned === 0;
			const ownership = known ? missing ? css?.Unowned : css?.Owned : undefined;
			const width = missing ? 85 : 100;
			const activate = () => { if (!missing && props.isCurrent()) props.onOpenCard(card); };
			return <NativeFocusable key={`${card.image}-${index}`} focusable
			data-gdl-focus-key={`trading-card-${name}-${index}`} data-gdl-card-ownership={card.owned === null ? 'unknown' : card.owned > 0 ? 'owned' : 'unowned'}
			className={[css?.TradingCardCarouselItem, ownership, 'gdl-bp-trading-card'].filter(Boolean).join(' ')}
			onActivate={missing ? undefined : activate} onClick={missing ? undefined : activate}>
			<div className={[css?.CardWrapper, ownership].filter(Boolean).join(' ')}
				style={{ width, height: width * 261 / 224 }}>
				<div className={[css?.Card, css?.Loaded, ownership, !missing && css?.Clickable].filter(Boolean).join(' ')} style={{ width: '100%', height: '100%', inset: 0 }}>
					<div className={css?.CardContainer}>
						<img className={css?.CardImage} src={card.image} alt={card.title} style={{ width: '100%', height: '100%', objectFit: 'contain',
							...(missing ? { filter: 'saturate(0.1)' } : {}) }} />
						<div className={css?.Title}>{card.title}</div>
					</div>
				</div>
			</div>
		</NativeFocusable>; })}
	</Strip> : null;
	return <Section classes={classes} label={loc('AppDetails_SectionTitle_TradingCards', gdlText('trading_cards', 'Trading cards'))}
		className={css?.Container} highlight={highlight} rightColumn>
		{known ? row(cards.filter(card => (card.owned ?? 0) > 0), 'Owned cards') : row(cards, 'Card catalogue')}
		{known && cards.length > 0 ? <div className={[css?.CardsLeft, badge.bMaxed ? css?.BadgeMaxed : remaining === 0 ? css?.CanLevelUp : undefined].filter(Boolean).join(' ')}
			onClick={remaining === 0 && !badge.bMaxed ? openBadge : undefined}>{remainingLabel}</div> : null}
		{known ? row(cards.filter(card => card.owned === 0), 'Missing cards') : null}
		{cards.length === 0 ? <div role="status">{props.hydrating ? loc('Loading', 'Loading...')
			: gdlText('trading_cards_empty', 'No cards are available to display.')}</div> : null}
		<NativeButton {...clickProps(openBadge)} data-gdl-focus-key={`trading-cards-badge-${props.steamAppId}`}>
			{loc('AppDetails_TradingCards_ViewBadgeProgress', 'Ver progreso de la insignia')}
		</NativeButton>
	</Section>;
}
