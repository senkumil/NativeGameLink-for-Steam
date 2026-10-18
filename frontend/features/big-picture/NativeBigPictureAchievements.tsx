import React, { type ReactElement, type ReactNode } from 'react';
import type { LocalAchievementItem } from '../../domain/types';
import { backendLog } from '../../api/backend';
import { gdlText, loc } from '../../steam/localization';
import type { NativeAppDetailsClasses } from '../../steam/gamepad/components/AppDetailsNativeClasses';
import {
	ensureAppDetailsStoreGuarded,
	registerNativeAchievementStateRestore,
	restoreNativeAchievementState,
} from '../../steam/gamepad/components/AppDetailsNativeComponents';
import {
	compareEarnedAchievementsForDisplay,
	compareLockedAchievementsForDisplay,
	highlightedAchievementNames,
} from '../achievements/rarity';
import type { BigPictureDetailData, MappedShortcut } from './types';
import { getCommittedShortcutSteamAppId } from '../shortcuts/registry';
import { getCachedLocalAchievementsForShortcut } from '../achievements/cache';
import { isCurrentLinkedGamepadTarget } from '../../steam/gamepad/GamepadContext';
import { steamUIModeService } from '../../steam/ui/SteamUIModeService';
import { openBigPictureAchievementsScreen } from './NativeBigPictureAchievementScreen';
import { getDocumentReact } from '../../steam/gamepad/document-ui-runtime';
import { resolveBigPictureAchievementScreenParts } from './achievement-screen-parts';
import { isRareAchievement } from '../achievements/rarity';

interface AchievementProjection {
	appId: number; appData: any; owners: Set<Document>; originalDetails: any; installedDetails: any;
	map: any; hadMyAchievements: boolean; originalMyAchievements: any; installedMyAchievements: any;
	unregister: () => void; restore: () => void;
}
const achievementProjections = new Set<AchievementProjection>();
const projectionByAppData = new WeakMap<object, AchievementProjection>();

export function restoreBigPictureAchievementProjections(shortcutAppId: number, owner?: Document): void {
	const id = shortcutAppId >>> 0;
	for (const projection of Array.from(achievementProjections)) {
		if (projection.appId !== id || (owner && !projection.owners.has(owner))) continue;
		if (owner) projection.owners.delete(owner);
		if (!owner || projection.owners.size === 0) projection.restore();
	}
	if (![...achievementProjections].some(projection => projection.appId === id)) restoreNativeAchievementState(id, owner);
}

export interface AchievementsSectionProps {
	shortcut: MappedShortcut;
	data: BigPictureDetailData;
	hydrating: boolean;
	document: Document;
	classes: NativeAppDetailsClasses;
	hideIfEmpty?: boolean;
	SectionComponent: React.ComponentType<any>;
	LoadingComponent: React.ComponentType<any>;
	NativeButton: React.ComponentType<any>;
	NativeFocusable: React.ComponentType<any>;
	NativeProgress: React.ComponentType<any>;
	NativeIcons: Record<string, React.ComponentType<any>>;
	NativeStrip: React.ComponentType<any>;
	NativeDetailsBoundary: React.ComponentType<{ children: ReactNode; fallback: ReactNode; name?: string }>;
	NativeCarousel?: React.ComponentType<any> | null;
	carouselItemClassName?: string;
}

function clickProps(action: () => void): { onClick: () => void } {
	return { onClick: action };
}

function isCurrentProjectionOwner(owner: Document | undefined, shortcutId: number, steamAppId: string): owner is Document {
	try {
		return Boolean(owner && steamUIModeService.isGamepadUI(owner)
			&& isCurrentLinkedGamepadTarget(owner, shortcutId, steamAppId));
	} catch { return false; }
}

export function syncAchievementsToNativeStore(
	appDetailsStore: any,
	appId: number,
	achievementsData: any,
	achievementStore?: any,
	owner?: Document,
): void {
	const rawId = Number(appId), shortcutId = rawId >>> 0;
	if (!appDetailsStore || !achievementsData || !Number.isInteger(rawId)
		|| rawId < -2147483648 || rawId > 4294967295 || shortcutId < 2147483648) return;
	const mappedId = getCommittedShortcutSteamAppId(shortcutId);
	if (!mappedId || !isCurrentProjectionOwner(owner, shortcutId, mappedId)
		|| String(achievementsData.metadata_appid || achievementsData.appid) !== mappedId
		|| getCachedLocalAchievementsForShortcut(mappedId, String(shortcutId)) !== achievementsData) return;
	try {
		ensureAppDetailsStoreGuarded(appDetailsStore, owner);
		const appData = appDetailsStore.GetAppData(shortcutId);
		if (!appData) return;
		const candidateMap = achievementStore?.m_mapMyAchievements;
		const map = candidateMap && ['get', 'has', 'set', 'delete'].every(key => typeof candidateMap[key] === 'function') ? candidateMap : null;
		let projection = projectionByAppData.get(appData);
		if (projection && projection.map !== map) { projection.restore(); projection = undefined; }
		if (!projection) {
			const state: AchievementProjection = {
				appId: shortcutId, appData, owners: new Set([owner]), originalDetails: appData.details, installedDetails: undefined,
				map, hadMyAchievements: Boolean(map?.has(shortcutId)), originalMyAchievements: map?.get(shortcutId), installedMyAchievements: undefined,
				unregister: () => {}, restore: () => {},
			};
			state.restore = () => {
				if (appData.details === state.installedDetails) appData.details = state.originalDetails;
				if (map && map.get(shortcutId) === state.installedMyAchievements) {
					if (state.hadMyAchievements) map.set(shortcutId, state.originalMyAchievements); else map.delete(shortcutId);
				}
				state.unregister(); state.owners.clear(); achievementProjections.delete(state); projectionByAppData.delete(appData);
			};
			state.unregister = registerNativeAchievementStateRestore(shortcutId, state.restore, state.owners);
			achievementProjections.add(state); projectionByAppData.set(appData, state); projection = state;
		} else {
			// A fresh Steam callback supersedes our old baseline. Disposal must
			// preserve that newer native value rather than restoring stale data.
			if (appData.details !== projection.installedDetails) projection.originalDetails = appData.details;
			if (map && map.get(shortcutId) !== projection.installedMyAchievements) {
				projection.hadMyAchievements = map.has(shortcutId); projection.originalMyAchievements = map.get(shortcutId);
			}
		}
		if (owner) projection.owners.add(owner);
		const allItems: LocalAchievementItem[] = achievementsData.achievements || [];
		const earned = allItems.filter(a => a.earned);
		const unachieved = allItems.filter(a => !a.earned);

		const toNativeItem = (item: LocalAchievementItem, isEarned: boolean) => ({
			strID: String(item.name || ''),
			strName: String(item.display_name || item.name || ''),
			strDescription: String(item.description || ''),
			strImage: String(item.icon || ''),
			bAchieved: isEarned,
			bHidden: Boolean(item.hidden),
			...(item.global_percent_known !== false && Number.isFinite(item.global_percent) ? { flAchieved: Number(item.global_percent) } : {}),
			rtUnlocked: isEarned ? Math.max(0, Math.floor(Number(item.earned_time) || 0)) : 0,
			flMinProgress: 0,
			flCurrentProgress: Math.max(0, Number(item.progress) || 0),
			flMaxProgress: Math.max(0, Number(item.max_progress) || 0),
		});

		const nativeAchievements = {
			nTotal: Math.max(allItems.length, Number(achievementsData.total || 0)),
			nAchieved: Math.max(earned.length, Number(achievementsData.unlocked || 0)),
			vecHighlight: earned.map(item => toNativeItem(item, true)),
			vecUnachieved: unachieved.map(item => toNativeItem(item, false)),
			vecAchievedHidden: earned.filter(item => item.hidden).map(item => toNativeItem(item, true)),
		};

		projection.installedDetails = {
			...(appData.details || {}),
			unAppID: shortcutId,
			achievements: nativeAchievements,
		};
		appData.details = projection.installedDetails;

		if (map) {
			const data: { achieved: Record<string, any>; unachieved: Record<string, any>; hidden: Record<string, any> } = { achieved: {}, unachieved: {}, hidden: {} };
			for (const item of allItems) {
				const target = item.earned ? data.achieved : item.hidden ? data.hidden : data.unachieved;
				target[String(item.name)] = toNativeItem(item, Boolean(item.earned));
			}
			projection.installedMyAchievements = { data, loading: false };
			map.set(shortcutId, projection.installedMyAchievements);
		}
	} catch (e) {
		backendLog(`[NGL][Gamepad] Failed to sync achievements to native store: ${e}`);
	}
}

export function NativeBigPictureAchievements(props: AchievementsSectionProps): ReactElement | null {
	const numericAppId = Number(props.shortcut.id || 0);
	if (!Number.isInteger(numericAppId) || numericAppId < 2147483648 || numericAppId > 4294967295
		|| getCommittedShortcutSteamAppId(numericAppId) !== String(props.shortcut.steamAppId)
		|| !isCurrentProjectionOwner(props.document, numericAppId, String(props.shortcut.steamAppId))) {
		return null;
	}
	if (props.data.achievements && (!props.data.achievements.found
		|| (props.data.achievements.total === 0 && props.data.achievements.achievements.length === 0))) {
		restoreBigPictureAchievementProjections(numericAppId, props.document);
		return null;
	}
	// Hydration may update the exact shortcut cache before the parent receives
	// its batched patch. Render that authorized snapshot immediately, never an
	// empty section caused only by the old props object having another identity.
	const achievements = getCachedLocalAchievementsForShortcut(props.shortcut.steamAppId, String(numericAppId));
	const items = achievements?.achievements || [];
	if (!achievements) {
		restoreBigPictureAchievementProjections(numericAppId, props.document);
		return null;
	}
	if (props.hideIfEmpty && items.length === 0 && !props.hydrating) {
		restoreBigPictureAchievementProjections(numericAppId, props.document);
		return null;
	}

	// Steam's AppID-backed summary opens its own account-backed achievement
	// route. Use the same section/focus primitives with our explicit opener so
	// the complete personal/global flow keeps this installation's local state.
	return <FallbackAchievementsSection {...props} data={{ ...props.data, achievements }} />;
}

function FallbackAchievementsSection(props: AchievementsSectionProps): ReactElement | null {
	const ownerReact = getDocumentReact(props.document);
	if (!ownerReact) return null;
	const achievements = props.data.achievements;
	const total = Math.max(0, Number(achievements?.total || props.data.game?.achievements?.total || 0));
	const unlocked = Math.max(0, Math.min(total, Number(achievements?.unlocked || 0)));
	const percent = total > 0 ? Math.floor((unlocked / total) * 100) : 0;
	const native = props.classes.Achievement;
	const items = achievements?.achievements || [];
	if (props.hideIfEmpty && items.length === 0 && !props.hydrating) return null;

	const earned = items.filter(item => item.earned).sort(compareEarnedAchievementsForDisplay);
	const locked = items.filter(item => !item.earned).sort(compareLockedAchievementsForDisplay);
	const highlightedNames = highlightedAchievementNames(earned);

	const [prioritizedRow, setPrioritizedRow] = ownerReact.useState<'earned' | 'locked'>(
		earned.length > 0 ? 'earned' : 'locked',
	);

	const onOpenAchievements = (item?: LocalAchievementItem) => {
		if (achievements) openBigPictureAchievementsScreen(props.document, props.shortcut, achievements, props.shortcut.title, item?.name);
	};

	const highlight = total > 0 ? (
		<div className={[native?.HighlightDiv, percent === 100 && native?.AllAchieved].filter(Boolean).join(' ')}>
			{percent === 100 && props.NativeIcons.Achievement ? (
				<props.NativeIcons.Achievement className={native?.Ribbon} />
			) : null}
			<div className={native?.UnlockedLabel}>
				<span>
					{gdlText('achievements_unlocked', '{unlocked} of {total} achievements unlocked', {
						unlocked,
						total,
					})}
				</span>
				<span className={native?.UnlockedLabelPercent}> ({percent}%)</span>
			</div>
			<div className={native?.AchievementProgressContainer}>
				<props.NativeProgress nProgress={percent} />
			</div>
		</div>
	) : null;

	return (
		<props.SectionComponent
			classes={props.classes}
			label={loc('AppDetails_SectionTitle_Achievements', gdlText('achievements_label', 'Achievements'))}
			highlight={highlight}
			className={native?.BasicAppDetailsAchievementsSection}
			bodyClassName={[native?.BasicAppDetailsAchievementsSectionBody, earned.length > 0 && locked.length > 0 && native?.BodyStopJiggle].filter(Boolean).join(' ')}
			rightColumn
		>
			{earned.length > 0 ? <FallbackAchievementCarousel
				document={props.document}
				items={earned}
				classes={props.classes}
				name="NativeGameLink Achievements"
				highlightedNames={highlightedNames}
				isPrioritized={prioritizedRow === 'earned'}
				onRequestPriority={() => setPrioritizedRow('earned')}
				onSelect={onOpenAchievements}
				NativeFocusable={props.NativeFocusable}
				NativeStrip={props.NativeStrip}
			/> : null}
			{locked.length > 0 ? (
				<>
					<div className={native?.LockedAchievementsLabel}>
						{loc('AppDetails_Achievements_Locked', 'Logros bloqueados')}
					</div>
					<FallbackAchievementCarousel
						document={props.document}
						items={locked}
						classes={props.classes}
						name="NativeGameLink Locked Achievements"
						isPrioritized={prioritizedRow === 'locked'}
						onRequestPriority={() => setPrioritizedRow('locked')}
						onSelect={onOpenAchievements}
						NativeFocusable={props.NativeFocusable}
						NativeStrip={props.NativeStrip}
					/>
				</>
			) : null}
			{total > 0 && items.length === 0 ? (
				<props.NativeButton
					{...clickProps(() => onOpenAchievements())}
					className={[native?.ViewAllAchievementsButton, 'gdl-bp-view-all-achievements'].filter(Boolean).join(' ')}
					data-gdl-focus-key={`achievement-open-${props.shortcut.id}`}
					style={{ marginTop: '12px', display: 'inline-flex' }}
				>
					{loc('AppDetails_Achievements_ViewAll', 'Ver todos los logros')} ({unlocked}/{total})
				</props.NativeButton>
			) : null}
			{items.length === 0 ? (
				<props.LoadingComponent
					hydrating={props.hydrating}
					empty={gdlText('no_achievements', 'No achievements found.')}
				/>
			) : null}
		</props.SectionComponent>
	);
}

function FallbackAchievementCarousel({
	document: doc,
	items,
	classes,
	name,
	isPrioritized,
	onRequestPriority,
	onSelect,
	NativeFocusable,
	NativeStrip,
}: {
	document: Document;
	items: LocalAchievementItem[];
	classes: NativeAppDetailsClasses;
	name: string;
	highlightedNames?: Set<string>;
	isPrioritized: boolean;
	onRequestPriority: () => void;
	onSelect?: (item: LocalAchievementItem) => void;
	NativeFocusable: React.ComponentType<any>;
	NativeStrip: React.ComponentType<any>;
}): ReactElement | null {
	const ownerReact = getDocumentReact(doc);
	if (!ownerReact) return null;
	const [focused, setFocused] = ownerReact.useState(0);
	const achievement = classes.Achievement;
	const NativeIcon = resolveBigPictureAchievementScreenParts(doc, true).Image;
	if (items.length === 0) return null;

	return (
		<NativeStrip document={doc} name={name} className={achievement?.SummaryCarouselContainer}>
			{items.map((item, index) => {
				const isDetailed = isPrioritized && focused === index;

				return (
					<NativeFocusable
						key={item.name}
						focusable
						onFocus={() => {
							onRequestPriority();
							setFocused(index);
						}}
						onActivate={onSelect ? () => onSelect(item) : undefined}
						{...(onSelect ? clickProps(() => onSelect(item)) : {})}
						data-gdl-focus-key={`achievement-summary-${item.name}`}
						className={[
							achievement?.AchievementCarouselItem,
							isDetailed && achievement?.Detailed,
						]
							.filter(Boolean)
							.join(' ')}
					>
						<div className={item.earned ? achievement?.Achieved : achievement?.NotAchieved} data-gdl-achievement-state={item.earned ? 'earned' : 'locked'}>
							{NativeIcon ? <NativeIcon
								className={[achievement?.Icon, achievement?.CarouselIcon, isPrioritized && achievement?.Prioritized].filter(Boolean).join(' ')}
								imgURL={item.earned ? item.icon : (item.icon_gray || item.icon)}
								glow={item.earned && isRareAchievement(item)} pauseAnimation={!isDetailed}
								style={item.earned ? undefined : { filter: 'grayscale(1)' }}
								alt={isDetailed ? '' : (item.display_name || item.name)}
							/> : <img
								className={[achievement?.Icon, achievement?.CarouselIcon, isPrioritized && achievement?.Prioritized].filter(Boolean).join(' ')}
								src={item.earned ? item.icon : (item.icon_gray || item.icon)}
								alt={isDetailed ? '' : (item.display_name || item.name)}
								style={item.earned ? undefined : { filter: 'grayscale(1)' }}
							/>}
						</div>
						{isDetailed ? (
							<div className={achievement?.AchivementCarouselItemDetails}>
								<div className={achievement?.Name}>{item.display_name || item.name}</div>
								<div className={achievement?.Description}>{item.description}</div>
								{item.global_percent_known !== false && Number.isFinite(item.global_percent) ? (
									<div className={achievement?.Achieved}>
										{loc(
											'AppDetails_PctUnlocked',
											'%1$s% de los jugadores tienen este logro',
										).replace('%1$s', item.global_percent!.toFixed(1))}
									</div>
								) : null}
							</div>
						) : null}
					</NativeFocusable>
				);
			})}
		</NativeStrip>
	);
}
