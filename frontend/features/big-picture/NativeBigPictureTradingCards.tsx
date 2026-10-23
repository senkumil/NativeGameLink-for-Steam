import React, { Component, type ReactNode } from 'react';
import type { SteamCommunityBadgeAsset, SteamCommunityCardAsset, SteamCommunityItemsCatalog } from '../../domain/types';
import type { NativeAppDetailsClasses } from '../../steam/gamepad/components/AppDetailsNativeClasses';
import { steamWebpackRuntime } from '../../steam/modules/SteamWebpackRuntime';
import { DocumentRuntimeCache } from '../../steam/gamepad/runtime-cache';
import { getImmediateOfficialCommunityItems, getOfficialCommunityItems, normalizeCommunityAssetUrl, subscribeOfficialCommunityItems } from '../library/community-items';
import { linkedCardPresentation } from '../library/linked-card-presentation';
import { communityBadgeId, communityCardId, getCachedCommunityItemOptions, getCommunityItemOptions, subscribeCommunityItemOptions, type CommunityItemOptions } from '../../core/community-item-options';
import { backendLog } from '../../api/backend';
import { gdlText, loc } from '../../steam/localization';
import { NativeFocusable, NativeButton } from './document-primitives';
import { getDocumentReact } from '../../steam/gamepad/document-ui-runtime';

interface Card extends SteamCommunityCardAsset { owned: number | null }
const clickProps = (onClick: () => void) => ({ onClick });
interface Props {
	document: Document;
	steamAppId: string;
	shortcutAppId?: string;
	catalog: SteamCommunityItemsCatalog | null;
	hydrating: boolean;
	classes: NativeAppDetailsClasses;
	Section: React.ComponentType<any>;
	Strip: React.ComponentType<any>;
	isCurrent(): boolean;
	onOpenCard(card: SteamCommunityCardAsset): void;
	onOpenBadge(foil?: boolean): void;
}
type BadgeHook = (appid: number) => any;
const hooks = new DocumentRuntimeCache(() => ({ count: -1, hook: null as BadgeHook | null }));
function hasNativeInventory(badge: any): boolean {
	return Array.isArray(badge?.rgCards) && badge.rgCards.length > 0
		&& badge.rgCards.every((card: any) => Number.isSafeInteger(card?.nOwned) && card.nOwned >= 0);
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

export function bigPictureTradingCards(catalog: SteamCommunityItemsCatalog | null, badge: any, options?: CommunityItemOptions | null): Card[] {
	if (options?.enabled) return linkedCardPresentation(catalog, options).cards.map(card => ({ ...card, owned: card.owned ? 1 : 0 }));
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
		foil: card.bFoil === true || card.bIsFoil === true || Number(card.nCardBorder ?? card.nBorder ?? 0) === 1,
	}));
	const assets: SteamCommunityCardAsset[] = known ? nativeAssets : catalog?.cards || [];
	return assets.filter(card => !!card.image && (known || !card.foil)).map(card => ({ ...card,
		owned: owned.get(normalizeCommunityAssetUrl(card.image)) ?? null,
	}));
}

class BadgeBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
	state = { failed: false };
	static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
	render(): ReactNode { return this.state.failed ? this.props.fallback : this.props.children; }
}

let cardLabelSequence = 0;
class TradingCardTile extends Component<{
	card: Card; missing: boolean; known: boolean; name: string; index: number;
	css: NativeAppDetailsClasses['TradingCard']; isCurrent(): boolean; onOpenCard(card: SteamCommunityCardAsset): void;
}, { image: 'loading' | 'loaded' | 'failed' }> {
	state: { image: 'loading' | 'loaded' | 'failed' } = { image: 'loading' };
	private labelId = `gdl-bp-card-label-${++cardLabelSequence}`;
	render(): ReactNode {
		const { card, missing, known, name, index, css } = this.props;
		const ownership = known ? missing ? css?.Unowned : css?.Owned : undefined;
		const width = missing ? 85 : 100;
		const activate = () => { if (!missing && this.props.isCurrent()) this.props.onOpenCard(card); };
		const imageState = this.state.image === 'failed' ? css?.LoadFailed : this.state.image === 'loaded' ? css?.Loaded : css?.Loading;
		return <NativeFocusable focusable role="listitem" aria-labelledby={this.labelId}
			data-gdl-focus-key={`trading-card-${name}-${index}`} data-gdl-card-ownership={card.owned === null ? 'unknown' : card.owned > 0 ? 'owned' : 'unowned'}
			className={[css?.TradingCardCarouselItem, ownership, 'gdl-bp-trading-card'].filter(Boolean).join(' ')}
			onActivate={missing ? undefined : activate} onClick={missing ? undefined : activate}>
			<div className={[css?.CardWrapper, ownership].filter(Boolean).join(' ')} style={{ width, height: width * 261 / 224 }}>
				<div className={[css?.Card, imageState, ownership, !missing && css?.Clickable].filter(Boolean).join(' ')}
					style={{ width: '100%', height: '100%', inset: 0 }}>
					<div className={css?.CardContainer} style={this.state.image === 'failed' ? { backgroundColor: '#394149' } : undefined}>
						<img className={css?.CardImage} src={card.image} alt={card.title}
							ref={image => { if (image?.complete && image.naturalWidth > 0 && this.state.image === 'loading') this.setState({ image: 'loaded' }); }}
							onLoad={() => { if (this.props.isCurrent()) this.setState({ image: 'loaded' }); }}
							onError={() => { if (this.props.isCurrent()) this.setState({ image: 'failed' }); }}
							style={{ width: '100%', height: '100%', objectFit: 'contain', filter: `saturate(${missing ? '0.1' : '1'})`,
								...(this.state.image === 'failed' ? { visibility: 'hidden' } : {}) }} />
						<div id={this.labelId} className={[css?.Title, this.state.image === 'failed' && css?.LoadFailed].filter(Boolean).join(' ')}>{card.title}</div>
					</div>
				</div>
			</div>
		</NativeFocusable>;
	}
}

export function NativeBigPictureTradingCards(props: Props): React.ReactElement | null {
	if (!props.isCurrent()) return null;
	const react = getDocumentReact(props.document);
	return react ? react.createElement(CardsLease, { ...props, react, key: String(props.shortcutAppId || '') + ':' + props.steamAppId }) : null;
}

/** Parent hydration and service refreshes can overlap. An incomplete source
 * may enrich this link, but only a complete service result can retire assets. */
function retainCardCatalog(previous: SteamCommunityItemsCatalog | null, next: SteamCommunityItemsCatalog | null,
	fromService: boolean): SteamCommunityItemsCatalog | null {
	if (!next) return previous;
	if (!previous) return next;
	const healthy = !next.error && !next.transient_error && !next.loading;
	const replaceCards = fromService && healthy && next.cards_complete === true;
	const replaceBadges = fromService && healthy && next.badges_complete === true;
	const merge = <T,>(incoming: T[], known: T[], identity: (item: T) => string): T[] => {
		const seen = new Set<string>();
		return [...incoming, ...known].filter(item => { const id = identity(item); if (seen.has(id)) return false; seen.add(id); return true; });
	};
	return { ...previous, ...next,
		cards: replaceCards ? next.cards : merge<SteamCommunityCardAsset>(next.cards || [], previous.cards || [], communityCardId),
		foil_cards: replaceCards ? next.foil_cards : merge(next.foil_cards || [], previous.foil_cards || [], card => communityCardId({ ...card, foil: true })),
		badges: replaceBadges ? next.badges : merge<SteamCommunityBadgeAsset>(next.badges || [], previous.badges || [], communityBadgeId),
		foil_badge: replaceBadges ? next.foil_badge : next.foil_badge || previous.foil_badge,
	};
}
function CardsLease(props: Props & { react: typeof React }): React.ReactElement | null {
	const react = props.react;
	const doc = props.document, scope = String(props.shortcutAppId || '') + ':' + props.steamAppId;
	const shortcut = String(props.shortcutAppId || ''), scoped = /^[1-9]\d*$/.test(shortcut);
	const latest = react.useRef(props); latest.current = props;
	const [selectionRetry, setSelectionRetry] = react.useState(0);
	const [snapshot, setSnapshot] = react.useState(() => ({ doc, scope,
		catalog: getImmediateOfficialCommunityItems(doc, props.steamAppId) || props.catalog,
		options: scoped ? getCachedCommunityItemOptions(doc, shortcut, props.steamAppId) : null, selectionFailed: false }));
	react.useEffect(() => {
		let active = true;
		const current = () => active && latest.current.document === doc
			&& String(latest.current.shortcutAppId || '') + ':' + latest.current.steamAppId === scope && latest.current.isCurrent();
		const catalog = (value: SteamCommunityItemsCatalog | null) => {
			if (!current()) return;
			const ready = getImmediateOfficialCommunityItems(doc, props.steamAppId) || value;
			if (ready) setSnapshot(previous => previous.catalog === ready ? previous : { ...previous, doc, scope,
				catalog: retainCardCatalog(previous.catalog, ready, true) });
		};
		const options = (value: CommunityItemOptions) => { if (current()) setSnapshot(previous => ({ ...previous, doc, scope, options: value, selectionFailed: false })); };
		const stopCatalog = subscribeOfficialCommunityItems(doc, props.steamAppId, catalog);
		const stopOptions = scoped ? subscribeCommunityItemOptions(doc, shortcut, props.steamAppId, options) : () => {};
		catalog(props.catalog);
		void getOfficialCommunityItems(doc, props.steamAppId).then(catalog).catch(error => {
			if (current()) backendLog('Big Picture card catalogue unavailable: ' + String(error));
		});
		if (scoped) void getCommunityItemOptions(doc, shortcut, props.steamAppId).then(options).catch(error => {
			if (current()) {
				setSnapshot(previous => ({ ...previous, doc, scope, selectionFailed: true }));
				backendLog('Big Picture card selection unavailable: ' + String(error));
			}
		});
		return () => { active = false; stopCatalog(); stopOptions(); };
	}, [doc, scope, selectionRetry]);
	react.useEffect(() => {
		const immediate = getImmediateOfficialCommunityItems(doc, props.steamAppId), catalog = immediate || props.catalog;
		setSnapshot(previous => previous.catalog === catalog ? previous : { ...previous, doc, scope,
			catalog: retainCardCatalog(previous.catalog, catalog, Boolean(immediate)) });
	}, [doc, scope, props.catalog]);
	if (!props.isCurrent()) return null;
	const input = { ...props, catalog: snapshot.doc === doc && snapshot.scope === scope ? snapshot.catalog : props.catalog,
		options: snapshot.doc === doc && snapshot.scope === scope ? snapshot.options : null };
	// A cold preference read may still contain an explicit normal/Steam choice.
	// Never paint an account set or an assumed default over that saved choice.
	if (scoped && !input.options) return <props.Section classes={props.classes}
		label={loc('AppDetails_SectionTitle_TradingCards', gdlText('trading_cards', 'Trading cards'))} rightColumn>
		<div role="status" data-gdl-card-selection-state={snapshot.selectionFailed ? 'failed' : 'loading'}>{snapshot.selectionFailed
			? gdlText('community_settings_load_failed', 'Could not load the saved selection. Retry before changing cards or badges.')
			: gdlText('community_settings_loading', 'Loading saved card and badge settings...')}</div>
		{snapshot.selectionFailed ? <NativeButton {...clickProps(() => {
			if (!props.isCurrent()) return;
			setSnapshot(previous => ({ ...previous, selectionFailed: false }));
			setSelectionRetry(value => value + 1);
		})}>{gdlText('community_retry', 'Retry')}</NativeButton> : null}
	</props.Section>;
	const fallback = <CardsContent {...input} badge={null} />;
	if (input.options?.enabled) return fallback;
	const readBadge = nativeBadgeHook(props.document);
	return readBadge ? <BadgeBoundary key={scope} fallback={fallback}>
		<CardsWithBadge {...input} readBadge={readBadge} />
	</BadgeBoundary> : fallback;
}
function CardsWithBadge(props: Props & { readBadge: BadgeHook; options: CommunityItemOptions | null }): React.ReactElement | null {
	const badge = props.readBadge(Number(props.steamAppId));
	return <CardsContent {...props} badge={badge} />;
}

function CardsContent(props: Props & { badge: any; options: CommunityItemOptions | null }): React.ReactElement | null {
	const { classes, Section, Strip } = props, css = classes.TradingCard;
	const selected = props.options?.enabled ? linkedCardPresentation(props.catalog, props.options) : null;
	const badge = selected ? { nLevel: selected.level, nXP: selected.xp, bMaxed: selected.maxed,
		strIconURL: selected.badge?.image, strName: selected.badge?.title,
		strNextLevelName: selected.nextBadge?.title || gdlText('community_badge_none', 'No local badge'),
		nNextLevelXP: selected.nextLevelXP } : props.badge;
	const cards = bigPictureTradingCards(props.catalog, props.badge, props.options);
	if (!props.hydrating && cards.length === 0 && !selected?.badge) return null;
	const known = Boolean(selected) || hasNativeInventory(badge);
	const badgeImage = known ? badge.nLevel > 0 ? normalizeCommunityAssetUrl(badge.strIconURL) : ''
		: '';
	const badgeName = known ? badge.nLevel > 0 ? badge.strName : badge.strNextLevelName
		: '';
	const remaining = badge?.bMaxed ? 0 : cards.filter(card => card.owned === 0).length;
	const remainingLabel = badge?.bMaxed ? loc('AppDetails_TradingCardsMaxed', 'Badge level is complete')
		: remaining === 0 ? loc('AppDetails_TradingCardsLevelUp', 'Ready to craft a badge')
		: loc(remaining === 1 ? 'AppDetails_TradingCardsLeft' : 'AppDetails_TradingCardsLeft_Plural',
			remaining === 1 ? '1 trading card left to collect' : '%1$s trading cards left to collect').replace('%1$s', String(remaining));
	const openBadge = () => { if (props.isCurrent()) props.onOpenBadge(selected?.foil ?? cards.some(card => card.foil === true)); };
	const highlight = cards.length > 0 || selected?.badge ? <div className={css?.BadgeSection}>
		{badgeImage ? <img className={css?.Badge} src={badgeImage} alt={badgeName || ''} data-gdl-badge-preview="1" {...clickProps(openBadge)} />
			: <div className={[css?.Badge, css?.EmptyCircle].filter(Boolean).join(' ')} />}
		<div className={css?.BadgeInfo}>
			<div className={css?.BadgeName}>{badgeName || loc('AppDetails_SectionTitle_TradingCards', 'Tarjetas')}</div>
			{known ? <div className={css?.BadgeLevel}>{badge.nLevel > 0
				? loc('AppDetails_BadgeLevel', 'Level %1$s, %2$s XP').replace('%1$s', String(badge.nLevel)).replace('%2$s', String(badge.nXP ?? 0))
				: loc('AppDetails_UnearnedBadgeXP', '%1$s XP').replace('%1$s', String(badge.nNextLevelXP ?? 0))}</div> : null}
		</div>
	</div> : undefined;
	const row = (items: Card[], name: string) => items.length > 0 ? <Strip document={props.document} name={name} className={css?.SummaryCarouselContainer}>
		{items.map((card, index) => <TradingCardTile key={`${card.foil ? 'foil' : 'normal'}:${card.image}:${card.title}`}
			card={card} index={index} name={name} missing={known && card.owned === 0} known={known} css={css}
			isCurrent={props.isCurrent} onOpenCard={props.onOpenCard} />)}
	</Strip> : null;
	return <Section classes={classes} label={loc('AppDetails_SectionTitle_TradingCards', gdlText('trading_cards', 'Trading cards'))}
		className={css?.Container} highlight={highlight} rightColumn>
		{known ? row(cards.filter(card => (card.owned ?? 0) > 0), 'Owned cards') : row(cards, 'Card catalogue')}
		{known && cards.length > 0 ? <div className={[css?.CardsLeft, badge.bMaxed ? css?.BadgeMaxed : remaining === 0 ? css?.CanLevelUp : undefined].filter(Boolean).join(' ')}
			onClick={remaining === 0 && !badge.bMaxed ? openBadge : undefined}>{remainingLabel}</div> : null}
		{known ? row(cards.filter(card => card.owned === 0), 'Missing cards') : null}
		{cards.length === 0 && props.hydrating ? <div role="status">{loc('Loading', 'Loading...')}</div> : null}
		<NativeButton {...clickProps(openBadge)} className="gdl-bp-badge-action" data-gdl-focus-key={`trading-cards-badge-${props.steamAppId}`}>
			{loc('AppDetails_ViewBadgePage', 'View Badge Page')}
		</NativeButton>
	</Section>;
}
