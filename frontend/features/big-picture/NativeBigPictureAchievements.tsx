import React, { type ReactElement, type ReactNode } from 'react';
import type { LocalAchievementItem } from '../../domain/types';
import { backendLog } from '../../api/backend';
import { gdlText, loc } from '../../steam/localization';
import type { NativeAppDetailsClasses } from '../../steam/gamepad/components/AppDetailsNativeClasses';
import {
	ensureAppDetailsStoreGuarded,
	openNativeAchievementsScreen,
	resolveNativeAchievementsSectionComponent,
	resolveNativeAchievementStore,
	resolveNativeAppDetailsStore,
} from '../../steam/gamepad/components/AppDetailsNativeComponents';
import {
	compareEarnedAchievementsForDisplay,
	compareLockedAchievementsForDisplay,
	highlightedAchievementNames,
} from '../achievements/rarity';
import type { BigPictureDetailData, MappedShortcut } from './types';

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

export function syncAchievementsToNativeStore(
	appDetailsStore: any,
	appId: number,
	achievementsData: any,
	achievementStore?: any,
): void {
	if (!appDetailsStore || !appId || !achievementsData) return;
	try {
		ensureAppDetailsStoreGuarded(appDetailsStore);
		const appData = appDetailsStore.GetAppData(appId);
		if (!appData) return;
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
			flAchieved: Number.isFinite(item.global_percent) ? Number(item.global_percent) : (isEarned ? 50 : 25),
			rtUnlocked: (item as any).unlock_time || (isEarned ? Math.floor(Date.now() / 1000) : 0),
		});

		const nativeAchievements = {
			nTotal: Math.max(allItems.length, Number(achievementsData.total || 0)),
			nAchieved: Math.max(earned.length, Number(achievementsData.unlocked || 0)),
			vecHighlight: earned.map(item => toNativeItem(item, true)),
			vecUnachieved: unachieved.map(item => toNativeItem(item, false)),
			vecAchievedHidden: [] as any[],
		};

		appData.details = {
			...(appData.details || {}),
			unAppID: appId,
			achievements: nativeAchievements,
		};

		if (achievementStore && typeof achievementStore.m_mapMyAchievements?.set === 'function') {
			try {
				const achievedMap: Record<string, any> = {};
				for (const item of earned) {
					achievedMap[String(item.name)] = {
						bAchieved: true,
						strName: String(item.display_name || item.name || ''),
						rtUnlocked: (item as any).unlock_time || Math.floor(Date.now() / 1000),
					};
				}
				achievementStore.m_mapMyAchievements.set(appId, {
					data: { achieved: achievedMap },
					loading: false,
				});
			} catch {}
		}
	} catch (e) {
		backendLog(`[NGL][Gamepad] Failed to sync achievements to native store: ${e}`);
	}
}

export function NativeBigPictureAchievements(props: AchievementsSectionProps): ReactElement | null {
	const achievements = props.data.achievements;
	const items = achievements?.achievements || [];
	if (props.hideIfEmpty && items.length === 0 && !props.hydrating) return null;

	const NativeAchievements = resolveNativeAchievementsSectionComponent(props.document);
	const store = resolveNativeAppDetailsStore(props.document);
	const achievementStore = resolveNativeAchievementStore(props.document);
	const numericAppId = Number(props.shortcut.steamAppId || props.shortcut.id || 0);

	if (NativeAchievements && store && numericAppId > 0) {
		syncAchievementsToNativeStore(store, numericAppId, achievements, achievementStore);
		const shortcutId = Number(props.shortcut.id || 0);
		if (shortcutId > 0 && shortcutId !== numericAppId) {
			syncAchievementsToNativeStore(store, shortcutId, achievements, achievementStore);
		}
		return (
			<props.NativeDetailsBoundary
				key={`native-achievements-${numericAppId}-${achievements?.unlocked ?? 0}-${items.length}`}
				name="native-achievements"
				fallback={<FallbackAchievementsSection {...props} />}
			>
				<NativeAchievements details={{ unAppID: numericAppId }} />
			</props.NativeDetailsBoundary>
		);
	}

	return <FallbackAchievementsSection {...props} />;
}

function FallbackAchievementsSection(props: AchievementsSectionProps): ReactElement | null {
	const achievements = props.data.achievements;
	const total = Math.max(0, Number(achievements?.total || props.data.game?.achievements?.total || 0));
	const unlocked = Math.max(0, Math.min(total, Number(achievements?.unlocked || 0)));
	const percent = total > 0 ? Math.round((unlocked / total) * 100) : 0;
	const native = props.classes.Achievement;
	const items = achievements?.achievements || [];
	if (props.hideIfEmpty && items.length === 0 && !props.hydrating) return null;

	const earned = items.filter(item => item.earned).sort(compareEarnedAchievementsForDisplay);
	const locked = items.filter(item => !item.earned).sort(compareLockedAchievementsForDisplay);
	const highlightedNames = highlightedAchievementNames(earned);
	const carouselItems = earned.length > 0 ? earned : locked.slice(0, 16);

	const [prioritizedRow, setPrioritizedRow] = React.useState<'earned' | 'locked'>(
		earned.length > 0 ? 'earned' : 'locked',
	);

	const onOpenAchievements = () => openNativeAchievementsScreen(props.document, props.shortcut.steamAppId);

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
				<props.NativeProgress nProgress={percent / 100} />
			</div>
		</div>
	) : null;

	return (
		<props.SectionComponent
			classes={props.classes}
			label={loc('AppDetails_SectionTitle_Achievements', gdlText('achievements_label', 'Achievements'))}
			highlight={highlight}
			className={native?.BasicAppDetailsAchievementsSection}
			bodyClassName={native?.BasicAppDetailsAchievementsSectionBody}
			rightColumn
		>
			<FallbackAchievementCarousel
				items={carouselItems}
				classes={props.classes}
				name="NativeGameLink Achievements"
				highlightedNames={highlightedNames}
				isPrioritized={prioritizedRow === 'earned'}
				onRequestPriority={() => setPrioritizedRow('earned')}
				onSelect={onOpenAchievements}
				NativeFocusable={props.NativeFocusable}
				NativeStrip={props.NativeStrip}
			/>
			{earned.length > 0 && locked.length > 0 ? (
				<>
					<div className={native?.LockedAchievementsLabel}>
						{loc('AppDetails_Achievements_Locked', 'Logros bloqueados')}
					</div>
					<FallbackAchievementCarousel
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
			{total > 0 ? (
				<props.NativeFocusable
					focusable
					role="button"
					onActivate={onOpenAchievements}
					{...clickProps(onOpenAchievements)}
					className={[native?.ViewAllAchievementsButton, 'gdl-bp-view-all-achievements'].filter(Boolean).join(' ')}
					style={{ marginTop: '12px', display: 'inline-flex' }}
				>
					<props.NativeButton {...clickProps(onOpenAchievements)}>
						{loc('AppDetails_Achievements_ViewAll', 'Ver todos los logros')} ({unlocked}/{total})
					</props.NativeButton>
				</props.NativeFocusable>
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
	items,
	classes,
	name,
	highlightedNames,
	isPrioritized,
	onRequestPriority,
	onSelect,
	NativeFocusable,
	NativeStrip,
}: {
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
	const [focused, setFocused] = React.useState(0);
	const achievement = classes.Achievement;
	if (items.length === 0) return null;

	return (
		<NativeStrip name={name} className={achievement?.SummaryCarouselContainer}>
			{items.slice(0, 32).map((item, index) => {
				const isHighlighted = highlightedNames ? highlightedNames.has(String(item.name)) : false;
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
						className={[
							achievement?.AchievementCarouselItem,
							isDetailed && achievement?.Detailed,
						]
							.filter(Boolean)
							.join(' ')}
					>
						<img
							className={[
								achievement?.CarouselIcon,
								(isDetailed || isHighlighted) && achievement?.Prioritized,
								item.earned ? achievement?.Achieved : achievement?.NotAchieved,
							]
								.filter(Boolean)
								.join(' ')}
							src={item.icon}
							alt={isDetailed ? '' : (item.display_name || item.name)}
						/>
						{isDetailed ? (
							<div className={achievement?.AchivementCarouselItemDetails}>
								<div className={achievement?.Name}>{item.display_name || item.name}</div>
								<div className={achievement?.Description}>{item.description}</div>
								{Number.isFinite(item.global_percent) ? (
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
