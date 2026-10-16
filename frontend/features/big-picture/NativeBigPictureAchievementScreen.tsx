import React, { Component, type ReactNode } from 'react';
import { GamepadButton } from '@steambrew/client';
import type { LocalAchievementData, LocalAchievementItem } from '../../domain/types';
import { loc } from '../../steam/localization';
import { isCurrentLinkedGamepadTarget } from '../../steam/gamepad/GamepadContext';
import { steamUIModeService } from '../../steam/ui/SteamUIModeService';
import { getDocumentReact, getDocumentUIComponents } from '../../steam/gamepad/document-ui-runtime';
import { getCachedLocalAchievementsForShortcut, cacheLocalAchievements } from '../achievements/cache';
import { subscribeLocalAchievementData } from '../achievements/service';
import { formatLocalUnlockDate } from '../achievements/format';
import { linkedShortcutPortrait } from '../library/artwork';
import { getInstantPlaytimeStats, fetchPlaytimeStats } from '../playtime/service';
import { isShortcutPlaytimeTrackingEnabled } from '../playtime/playtime-settings';
import { formatPlaytimeMinutes } from '../playtime/format';
import { createBigPictureDetailViews } from './detail-views';
import { resolveBigPictureAchievementScreenParts, type NativeAchievementScreenParts } from './achievement-screen-parts';
import { BigPictureAchievementComparison, type BigPictureAchievementComparisonSelection } from './achievement-comparison';
import { focusBigPictureNativeElement } from './native-focus';
import { isRareAchievement } from '../achievements/rarity';
import { getCurrentSteamUser } from '../library/social/feed';
import { EXIT_TEXT_EDITOR_EVENT, isEditableTextTarget } from './editable-target';
import { switchBigPictureOwnedModalTab } from './gamepad-nav';
import { showBigPictureModal, type BigPictureModalLease } from './owned-modals';
import type { MappedShortcut } from './types';

type NativeComponent = React.ComponentType<any>;
export type BigPictureAchievementTab = 'mine' | 'global';
const clickProps = (action: () => void) => ({ onClick: action });

function DOMFocusable(props: any): React.ReactElement {
	const { children, focusable, onActivate, onCancel, onButtonDown: _button, onOKActionDescription: _ok,
		onCancelActionDescription: _cancel, 'flow-children': flow, ...rest } = props;
	return <div {...rest} flow-children={flow} tabIndex={focusable === false ? undefined : props.tabIndex ?? 0}
		onKeyDown={event => {
			if (event.defaultPrevented) return;
			if (event.key === 'Enter' && onActivate) { event.preventDefault(); onActivate(event); }
			else if (event.key === 'Escape' && onCancel) { event.preventDefault(); onCancel(event); }
		}}>{children}</div>;
}
interface ScreenUI {
	Focusable: NativeComponent; Button: NativeComponent; TextField: NativeComponent; Progress: NativeComponent;
	Icons: Record<string, NativeComponent>;
}
function screenUI(doc: Document): ScreenUI {
	const ui = getDocumentUIComponents(doc);
	return { Focusable: ui.Focusable || DOMFocusable, Button: ui.DialogButton || ((props: any) => <button {...props} />),
		TextField: ui.TextField || ((props: any) => <input {...props} type="search" />),
		Progress: ui.ProgressBar || ((props: any) => <div role="progressbar" aria-valuenow={props.nProgress}
			style={{ height: 8, background: '#1a9fff', width: `${props.nProgress}%` }} />),
		Icons: ui.IconsModule || {} };
}

function currentOwner(doc: Document, shortcut: MappedShortcut): boolean {
	return steamUIModeService.isGamepadUI(doc)
		&& isCurrentLinkedGamepadTarget(doc, shortcut.id, shortcut.steamAppId);
}

export function knownBigPictureAchievementPercent(item: LocalAchievementItem): number | null {
	return item.global_percent_known !== false && Number.isFinite(item.global_percent)
		? Math.max(0, Math.min(100, item.global_percent)) : null;
}

/** The personal list reads local unlocks; the global list only sorts metadata
 * rarity. Missing rarity never becomes 0% or the player's completion rate. */
export function bigPictureAchievementRows(data: LocalAchievementData, tab: BigPictureAchievementTab,
	filter = '', revealed: ReadonlySet<string> = new Set()): LocalAchievementItem[] {
	const query = filter.trim().toLocaleLowerCase();
	const title = (item: LocalAchievementItem) => String(item.display_name || item.name || '');
	return data.achievements.filter(item => {
		if (!query) return true;
		if (item.hidden && !item.earned && !revealed.has(item.name)) return false;
		return `${title(item)} ${item.description || ''}`.toLocaleLowerCase().includes(query);
	}).sort((a, b) => {
		if (tab === 'mine') {
			const earned = Number(b.earned) - Number(a.earned);
			if (earned) return earned;
			if (a.earned) {
				const date = Number(b.earned_time || 0) - Number(a.earned_time || 0);
				if (date) return date;
			}
		}
		return (knownBigPictureAchievementPercent(b) ?? -1) - (knownBigPictureAchievementPercent(a) ?? -1)
			|| title(a).localeCompare(title(b));
	});
}

export { resolveBigPictureAchievementScreenParts } from './achievement-screen-parts';

class NativeScreenPartBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
	state = { failed: false };
	static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
	render(): ReactNode { return this.state.failed ? this.props.fallback : this.props.children; }
}

function ensureScreenStyles(doc: Document): void {
	if (doc.getElementById('gdl-bp-achievement-screen-styles')) return;
	const style = doc.createElement('style');
	style.id = 'gdl-bp-achievement-screen-styles';
	style.textContent = `
#gdl-bp-achievements-screen{width:100%;height:100%;min-height:0;color:var(--gpSystemLightestGrey,#dcdedf)}
#gdl-bp-achievements-screen .gdl-bp-ach-screen{display:flex;flex-direction:column;width:100%;height:100%;min-height:0;isolation:isolate;position:relative;overflow:clip;background:#0e141b}
#gdl-bp-achievements-screen .gdl-bp-ach-body{flex:1;display:flex;flex-direction:column;min-height:0;z-index:1;padding-top:24px;box-sizing:border-box}
#gdl-bp-achievements-screen .gdl-bp-ach-head{flex:none;margin-bottom:18px}
#gdl-bp-achievements-screen .gdl-bp-ach-portrait{display:block;width:145px;aspect-ratio:2/3;object-fit:cover;max-width:100%}
#gdl-bp-achievements-screen .gdl-bp-ach-header-content{min-width:0;flex:1}
#gdl-bp-achievements-screen .gdl-bp-ach-head-fallback{display:flex;align-items:center;gap:14px;padding:0 24px}
#gdl-bp-achievements-screen .gdl-bp-ach-head-fallback .gdl-bp-ach-header-content{display:flex;flex-direction:column;gap:14px}
#gdl-bp-achievements-screen .gdl-bp-ach-header-content>.gdl-bp-ach-fallback-title{font-size:22px;font-weight:400;color:#fff}
#gdl-bp-achievements-screen .gdl-bp-ach-stats-fallback{padding:14px;display:flex;gap:14px;background:rgba(103,112,123,.2)}
#gdl-bp-achievements-screen .gdl-bp-ach-stat-fallback{display:flex;gap:6px;align-items:center}
#gdl-bp-achievements-screen .gdl-bp-ach-big-stat-fallback{flex:1;align-items:flex-start}
#gdl-bp-achievements-screen .gdl-bp-ach-stat-value-fallback{flex:1;display:flex;flex-direction:column}
#gdl-bp-achievements-screen .gdl-bp-ach-label-fallback{font-size:12px;font-weight:700;letter-spacing:.5px;text-transform:uppercase}
#gdl-bp-achievements-screen .gdl-bp-ach-progress-label{display:flex;justify-content:space-between;gap:16px}
#gdl-bp-achievements-screen .gdl-bp-ach-progress{min-width:0}
#gdl-bp-achievements-screen .gdl-bp-ach-progress>div{width:100%}
#gdl-bp-achievements-screen .gdl-bp-ach-tabs{display:flex;justify-content:center;flex:none;gap:4px;padding:0 20px 12px}
#gdl-bp-achievements-screen .gdl-bp-ach-tab{cursor:pointer;display:flex;align-items:center;justify-content:center;padding:10px 16px;border-radius:40px;font-size:12px;font-weight:700;text-transform:uppercase;color:inherit;outline-offset:2px}
#gdl-bp-achievements-screen .gdl-bp-ach-tab[aria-selected=true]{background:rgba(255,255,255,.14)}
#gdl-bp-achievements-screen .gdl-bp-ach-scroll{min-height:0;overflow-y:auto;overscroll-behavior:contain;scroll-padding:8px;flex:1;background:#0e141b}
#gdl-bp-achievements-screen .gdl-bp-ach-search{display:flex;align-items:center;justify-content:flex-end;gap:10px}
#gdl-bp-achievements-screen .gdl-bp-ach-search>div:first-child{flex:1}
#gdl-bp-achievements-screen .gdl-bp-ach-search input{min-width:220px}
#gdl-bp-achievements-screen .gdl-bp-ach-avatar{width:32px;height:32px;object-fit:cover}
#gdl-bp-achievements-screen .gdl-bp-ach-global-label{white-space:nowrap;font-size:12px;font-weight:600;text-transform:uppercase}
#gdl-bp-achievements-screen .gdl-bp-ach-row{position:relative;scroll-margin:8px;flex-shrink:0}
#gdl-bp-achievements-screen .gdl-bp-ach-fallback-row{display:flex;align-items:center;gap:8px;min-height:80px;background:#23262e;padding:8px;box-sizing:border-box}
#gdl-bp-achievements-screen .gdl-bp-ach-fallback-row img{width:64px;height:64px;object-fit:contain;flex:none}
#gdl-bp-achievements-screen .gdl-bp-ach-fallback-copy{flex:1;min-width:0}
#gdl-bp-achievements-screen .gdl-bp-ach-fallback-title{font-size:16px;font-weight:600}
#gdl-bp-achievements-screen .gdl-bp-ach-fallback-description{font-size:14px;color:var(--gpSystemLighterGrey,#b8bcbf)}
#gdl-bp-achievements-screen .gdl-bp-ach-fallback-detail{color:var(--gpSystemLightGrey,#8f98a0);font-size:12px}
#gdl-bp-achievements-screen .gdl-bp-ach-global-content{display:flex;align-items:center;gap:12px;position:relative;min-height:68px;flex:1;padding:10px;box-sizing:border-box}
#gdl-bp-achievements-screen .gdl-bp-ach-global-content img{width:48px;height:48px;object-fit:contain}
#gdl-bp-achievements-screen .gdl-bp-ach-global-info{flex:1;min-width:0;z-index:1}
#gdl-bp-achievements-screen .gdl-bp-ach-global-fill{position:absolute;inset:0 auto 0 0;background:rgba(255,255,255,.055);pointer-events:none}
#gdl-bp-achievements-screen .gdl-bp-ach-percent{font-weight:700;white-space:nowrap;z-index:1}
#gdl-bp-achievements-screen .gdl-bp-ach-check{width:30px;flex:none;text-align:center}
#gdl-bp-achievements-screen .gdl-bp-ach-empty{padding:32px;text-align:center;color:var(--gpSystemLightGrey,#8f98a0)}
#gdl-bp-achievements-screen .gdl-bp-ach-background{position:absolute;inset:0;pointer-events:none;z-index:0}
#gdl-bp-achievements-screen .gdl-bp-ach-background img{width:100%;height:100%;object-fit:cover;filter:blur(24px) brightness(.38);opacity:.65}
#gdl-bp-achievements-screen .gdl-bp-ach-background:after{content:"";position:absolute;inset:0;background:linear-gradient(transparent,#0e141b)}
`;
	(doc.head || doc.body).appendChild(style);
}

function achievementText(token: string, fallback: string, ...values: number[]): string {
	return loc(token, fallback).replace(/%([1-9]\d*)\$[sd]/g, (match, index) => String(values[Number(index) - 1] ?? match));
}

interface ScreenProps { document: Document; shortcut: MappedShortcut; data: LocalAchievementData; close: () => void;
	lease: BigPictureModalLease; initialAchievementName?: string }

export function BigPictureAchievementScreen(props: ScreenProps): React.ReactElement {
	const { document: doc, shortcut, close } = props;
	// A notification may render this body before the modal observer detects a
	// Steam reload. Keep hooks paired with the renderer that opened the modal.
	const ownerReact = props.lease.react;
	const runtimeCurrent = props.lease.isCurrent();
	const ui = ownerReact.useMemo(() => screenUI(doc), [doc]);
	const { Focusable: NativeFocusable, Button: NativeButton, TextField: NativeTextField, Progress: NativeProgress, Icons: NativeIcons } = ui;
	const [data, setData] = ownerReact.useState(props.data);
	const [tab, setTab] = ownerReact.useState<BigPictureAchievementTab>('mine');
	const [filters, setFilters] = ownerReact.useState({ mine: '', global: '' });
	const [revealed, setRevealed] = ownerReact.useState<Set<string>>(() => new Set(props.initialAchievementName ? [props.initialAchievementName] : []));
	const [comparison, setComparison] = ownerReact.useState<BigPictureAchievementComparisonSelection | null>(null);
	const [playtime, setPlaytime] = ownerReact.useState(() => isShortcutPlaytimeTrackingEnabled(shortcut.id)
		? getInstantPlaytimeStats(shortcut.id, shortcut.steamAppId) : null);
	const scroll = ownerReact.useRef<HTMLDivElement>(null);
	const scrollPositions = ownerReact.useRef({ mine: 0, global: 0 });
	const parts = ownerReact.useMemo(() => resolveBigPictureAchievementScreenParts(doc), [doc]);
	const ownerRoot = ownerReact.useRef(doc.getElementById('gdl-bp-detail-root'));
	const generation = ownerReact.useRef(ownerRoot.current?.dataset.gdlBpGeneration);
	const initialFocusPending = ownerReact.useRef(Boolean(props.initialAchievementName));
	const current = () => props.lease.isCurrent() && currentOwner(doc, shortcut) && ownerRoot.current?.isConnected
		&& doc.getElementById('gdl-bp-detail-root') === ownerRoot.current
		&& ownerRoot.current?.dataset.gdlBpGeneration === generation.current;
	ownerReact.useEffect(() => {
		let disposed = false;
		if (isShortcutPlaytimeTrackingEnabled(shortcut.id)) {
			void fetchPlaytimeStats(shortcut.id, shortcut.title, shortcut.steamAppId).then(value => {
				if (!disposed && current() && value) setPlaytime(value);
			}).catch(() => {});
		}
		const unsubscribe = subscribeLocalAchievementData(update => {
			if (disposed) return;
			if (!current()) { props.lease.invalidate(); return; }
			if (update.steamAppId !== shortcut.steamAppId || update.stateAppId !== String(shortcut.id)
				|| !update.data || String(update.data.metadata_appid || update.data.appid) !== shortcut.steamAppId) return;
			cacheLocalAchievements(update.data, shortcut.steamAppId, String(shortcut.id));
			setData(update.data);
		});
		return () => { disposed = true; unsubscribe(); };
	}, [doc, shortcut.id, shortcut.steamAppId]);
	ownerReact.useEffect(() => {
		const exitEditor = () => {
			if (current()) doc.getElementById('gdl-bp-achievements-screen')?.querySelector<HTMLElement>(`[data-gdl-achievement-tab="${tab}"]`)?.focus();
		};
		doc.addEventListener(EXIT_TEXT_EDITOR_EVENT, exitEditor);
		return () => doc.removeEventListener(EXIT_TEXT_EDITOR_EVENT, exitEditor);
	}, [doc, tab]);
	ownerReact.useLayoutEffect(() => { if (scroll.current) scroll.current.scrollTop = scrollPositions.current[tab]; }, [tab]);
	ownerReact.useLayoutEffect(() => {
		if (!initialFocusPending.current || !current() || !props.initialAchievementName) return undefined;
		const target = Array.from(scroll.current?.querySelectorAll<HTMLElement>('[data-gdl-achievement-name]') || [])
			.find(element => element.dataset.gdlAchievementName === props.initialAchievementName);
		if (!target) return undefined;
		initialFocusPending.current = false;
		const focus = () => {
			if (!current() || !target.isConnected) return;
			target.scrollIntoView({ block: 'center', inline: 'nearest' });
			if (!focusBigPictureNativeElement(doc, target)) target.focus({ preventScroll: true });
		};
		const frame = doc.defaultView!.requestAnimationFrame(focus);
		return () => doc.defaultView?.cancelAnimationFrame(frame);
	}, [doc, props.initialAchievementName]);
	const rows = ownerReact.useMemo(() => bigPictureAchievementRows(data, tab, filters[tab], revealed), [data, tab, filters, revealed]);
	ownerReact.useLayoutEffect(() => { if (!runtimeCurrent) props.lease.invalidate(); }, [runtimeCurrent, props.lease]);
	if (!runtimeCurrent) return <></>;
	const changeTab = (next: BigPictureAchievementTab) => {
		if (!current() || next === tab) return;
		if (scroll.current) scrollPositions.current[tab] = scroll.current.scrollTop;
		setTab(next);
	};
	const onFilter = (event: React.ChangeEvent<HTMLInputElement>) => {
		if (!current()) return;
		setFilters(value => ({ ...value, [tab]: event.target.value }));
		scrollPositions.current[tab] = 0;
		if (scroll.current) scroll.current.scrollTop = 0;
	};
	const reveal = (item: LocalAchievementItem) => {
		if (current() && item.hidden && !item.earned) setRevealed(value => new Set([...value, item.name]));
	};
	const total = Math.max(data.achievements.length, Number(data.total) || 0);
	const unlocked = Math.min(total, Math.max(data.achievements.filter(item => item.earned).length, Number(data.unlocked) || 0));
	const percent = total ? Math.round(unlocked * 100 / total) : 0;
	const complete = total > 0 && unlocked === total;
	const user = getCurrentSteamUser(doc);
	const view = createBigPictureDetailViews(doc, shortcut, null);
	const minutes = playtime ? (playtime.totalSeconds && playtime.totalSeconds > 0 ? playtime.totalSeconds / 60 : playtime.minutesForever)
		: Number(view.overview.minutes_playtime_forever ?? view.details.nPlaytimeForever) || 0;
	const recent = playtime?.minutesLastTwoWeeks ?? (Number(view.overview.minutes_playtime_last_two_weeks ?? view.details.nPlaytimeLastTwoWeeks) || 0);
	const percentLabel = percent === 0 && unlocked > 0 ? '(<1%)' : percent === 100 && unlocked < total ? '(>99%)' : '(' + percent + '%)';
	const comparisonControl = <BigPictureAchievementComparison document={doc} shortcut={shortcut} data={data}
		isCurrent={current} onSelection={setComparison} react={ownerReact} />;
	const displayedRows = tab === 'mine' ? rows.filter(item => !item.hidden || item.earned || revealed.has(item.name)) : rows;
	const hiddenItems = tab === 'mine' ? data.achievements.filter(item => item.hidden && !item.earned && !revealed.has(item.name)) : [];
	const revealHidden = () => { if (current()) setRevealed(value => new Set([...value, ...hiddenItems.map(item => item.name)])); };
	const globalLabel = loc('Achievements_GlobalAchievement_PercentUnlockedLabel', '% of all players');
	const searchRight = <div className="gdl-bp-ach-toolbar-right"><div hidden={tab !== 'mine'}>{comparisonControl}</div>
		<span hidden={tab !== 'global'} className="gdl-bp-ach-global-label">{globalLabel}</span></div>;
	const searchFallback = <div className="gdl-bp-ach-search">
		{tab === 'global' && user.avatar ? <img className="gdl-bp-ach-avatar" src={user.avatar} alt={user.name} /> : null}
		<div><NativeTextField value={filters[tab]} onChange={onFilter} aria-label={loc('Achievements_Filter_Default', 'Search')}
			placeholder={loc('Achievements_Filter_Default', 'Search')} /></div>
		{searchRight}
	</div>;
	return <NativeFocusable className="gdl-bp-ach-screen" flow-children="column" focusable={false}
		onCancel={close} onCancelButton={close} onCancelActionDescription={loc('ActionButtonLabelBack', 'Back')}
		onButtonDown={(event: any) => {
			if (!current() || event.defaultPrevented || event.detail?.is_repeat || isEditableTextTarget(doc.activeElement)) return;
			const offset = event.detail?.button === GamepadButton.BUMPER_LEFT ? -1 : event.detail?.button === GamepadButton.BUMPER_RIGHT ? 1 : 0;
			if (offset && switchBigPictureOwnedModalTab(doc, offset)) { event.preventDefault(); event.stopPropagation(); }
		}}>
		<div className="gdl-bp-ach-background" aria-hidden="true"><img src={linkedShortcutPortrait(shortcut.id, shortcut.steamAppId)} alt="" /></div>
		<div className="gdl-bp-ach-body">
		<div className={'gdl-bp-ach-head ' + (parts.page.HeaderContainer || '')}>
			<div className={parts.header.Container || 'gdl-bp-ach-head-fallback'}>
				<img className={'gdl-bp-ach-portrait ' + (parts.header.Portrait || '')} src={linkedShortcutPortrait(shortcut.id, shortcut.steamAppId)} alt="" />
				<div className={'gdl-bp-ach-header-content ' + (parts.header.Content || '')}>
					<div className={parts.header.Title || 'gdl-bp-ach-fallback-title'}>{shortcut.title}</div>
					<div className={parts.header.StatsBlock || 'gdl-bp-ach-stats-fallback'}>
						<div className={(parts.header.Stat || 'gdl-bp-ach-stat-fallback') + ' ' + (parts.header.BigStat || 'gdl-bp-ach-big-stat-fallback')}>
							{complete && NativeIcons.Achievement ? <NativeIcons.Achievement fullcolor className={parts.header.Ribbon} /> : null}
							<div className={parts.header.StatLabelAndValue || 'gdl-bp-ach-stat-value-fallback'}>
								<div className={'gdl-bp-ach-progress-label ' + (parts.header.ProgressLabel || '')}>
									<span className={parts.header.Label || 'gdl-bp-ach-label-fallback'}>{complete ? achievementText('AppDetails_PlayerUnlockedPercentAll', "You've unlocked all achievements! %1$s/%2$s", unlocked, total)
										: achievementText('Achievements_HeaderStats_Earned_Label', '%1$s of %2$s achievements earned', unlocked, total)}</span>
									<span className={parts.header.Label || 'gdl-bp-ach-label-fallback'}>{percentLabel}</span>
								</div><div className={'gdl-bp-ach-progress ' + (parts.header.Progress || '')}><NativeProgress nProgress={percent} /></div>
							</div>
						</div>
						{[[minutes, 'Achievements_HeaderStats_Playtime_Label', 'Play time'], [recent, 'Achievements_HeaderStats_PlaytimeRecent_Label', 'Last two weeks']].map(([value, token, fallback]) => Number(value) > 0
							? <div key={String(token)} className={parts.header.Stat || 'gdl-bp-ach-stat-fallback'} data-gdl-achievement-playtime={String(token)}><div className={parts.header.StatLabelAndValue || 'gdl-bp-ach-stat-value-fallback'}>
								<div className={parts.header.Label || 'gdl-bp-ach-label-fallback'}>{loc(String(token), String(fallback))}</div>
								<div className={parts.header.TextValue}>{formatPlaytimeMinutes(Number(value))}</div>
							</div></div> : null)}
					</div>
				</div>
			</div>
		</div>
		<NativeFocusable flow-children="row" focusable={false} role="tablist" className={`gdl-bp-ach-tabs ${parts.tabs.TabRow || ''}`}>
			{(['mine', 'global'] as const).map(value => <NativeFocusable key={value} focusable role="tab" tabIndex={0}
				className={`gdl-bp-ach-tab ${parts.tabs.Tab || ''} ${tab === value ? parts.tabs.Selected || '' : ''}`}
				data-gdl-achievement-tab={value} data-gdl-focus-key={`achievements-tab-${value}`} aria-selected={tab === value}
				onActivate={() => changeTab(value)} {...clickProps(() => changeTab(value))}>
				<span className={parts.tabs.TabTitle}>{value === 'mine' ? loc('Achievements_Tab_MyAchievements', 'My achievements') : loc('Achievements_Tab_GlobalAchievements', 'Global achievements')}</span>
			</NativeFocusable>)}
		</NativeFocusable>
		<div className="gdl-bp-ach-scroll" ref={scroll} role="tabpanel" aria-label={tab === 'mine' ? loc('Achievements_Tab_MyAchievements', 'My achievements') : loc('Achievements_Tab_GlobalAchievements', 'Global achievements')}>
			<NativeFocusable flow-children="column" focusable={false} className={parts.row.AchievementList}>
			{parts.Search ? <NativeScreenPartBoundary fallback={searchFallback}><parts.Search strFilter={filters[tab]} onChangeFilter={onFilter}
				leftContent={tab === 'global' && user.avatar ? <img className="gdl-bp-ach-avatar" src={user.avatar} alt={user.name} /> : undefined}
				className={parts.page.MyAchievementsHeader}
				rightContent={searchRight} /></NativeScreenPartBoundary> : searchFallback}
				{comparison && tab === 'mine' && (comparison.loading || comparison.error) ? <div role="status">{comparison.loading ? loc('Loading', 'Loading...') : comparison.error}</div> : null}
				{displayedRows.map((item, index) => <React.Fragment key={item.name}>
					{tab === 'mine' && !item.earned && (index === 0 || displayedRows[index - 1].earned) ? <div className={parts.row.ListTitle}>{loc('Achievements_LockedList_Title', 'Locked achievements')}</div> : null}
					<AchievementRow key={`${tab}:${item.name}`} item={item} tab={tab} parts={parts} ui={ui}
					revealed={revealed.has(item.name)} onReveal={() => reveal(item)} comparison={tab === 'mine' ? comparison : null} userAvatar={user.avatar} /></React.Fragment>)}
				{hiddenItems.length > 0 ? parts.HiddenRow ? <NativeScreenPartBoundary fallback={<NativeButton {...clickProps(revealHidden)} data-gdl-achievements-hidden="1">{hiddenItems.length} {loc('Achievements_HiddenAchievementItem_Individual_Title', 'Hidden achievements')}</NativeButton>}>
					<parts.HiddenRow count={hiddenItems.length} onActivate={revealHidden} {...clickProps(revealHidden)} data-gdl-achievements-hidden="1" />
				</NativeScreenPartBoundary> : <NativeButton {...clickProps(revealHidden)} data-gdl-achievements-hidden="1">{hiddenItems.length} {loc('Achievements_HiddenAchievementItem_Individual_Title', 'Hidden achievements')}</NativeButton> : null}
				{displayedRows.length === 0 && hiddenItems.length === 0 ? <div role="status" className="gdl-bp-ach-empty">{loc('Search_NoResults', 'No results')}</div> : null}
			</NativeFocusable>
		</div>
		</div>
	</NativeFocusable>;
}

function AchievementRow({ item, tab, parts, ui, revealed, onReveal, comparison, userAvatar }: { item: LocalAchievementItem; tab: BigPictureAchievementTab;
	parts: NativeAchievementScreenParts; ui: ScreenUI; revealed: boolean; onReveal: () => void;
	comparison: BigPictureAchievementComparisonSelection | null; userAvatar: string }): React.ReactElement {
	const { Focusable: NativeFocusable, Icons: NativeIcons } = ui;
	const hidden = item.hidden && !item.earned && !revealed;
	const percent = knownBigPictureAchievementPercent(item);
	const title = hidden ? loc('Achievements_HiddenAchievementItem_Individual_Title', 'Hidden achievement') : item.display_name || item.name;
	const description = hidden ? loc('Achievements_HiddenAchievementItem_Description', 'Details will be revealed once unlocked.') : item.description;
	const icon = item.earned ? item.icon : item.icon_gray || item.icon;
	const friend = comparison?.achievements?.get(item.name);
	const progress = !item.earned && item.max_progress > 0 ? { flCurrent: item.progress, flMax: item.max_progress,
		flPercentage: Math.max(0, Math.min(100, item.progress * 100 / item.max_progress)) } : undefined;
	const friendProgress = friend && !friend.earned && item.max_progress > 0 ? { flCurrent: friend.progress, flMax: item.max_progress,
		flPercentage: Math.max(0, Math.min(100, friend.progress * 100 / item.max_progress)) } : undefined;
	const props = { className: 'gdl-bp-ach-row', 'data-gdl-achievement-name': item.name,
		'data-gdl-focus-key': `achievement-${tab}-${item.name}`, tabIndex: 0, onActivate: onReveal, onClick: onReveal,
		onOKActionDescription: hidden ? loc('Achievements_HiddenAchievementItem_Individual_Reveal', 'Reveal achievement') : null };
	const fallback = <NativeFocusable {...props} focusable className="gdl-bp-ach-row gdl-bp-ach-fallback-row">
		{hidden ? <span aria-hidden="true">?</span> : <img loading="lazy" src={icon} alt="" />}
		<div className="gdl-bp-ach-fallback-copy"><div className="gdl-bp-ach-fallback-title">{title}</div><div className="gdl-bp-ach-fallback-description">{description}</div>
			{item.earned && percent !== null ? <div className="gdl-bp-ach-fallback-detail">{loc('AppDetails_PctUnlocked', '%1$s% of players have this achievement').replace('%1$s', percent.toFixed(1))}</div> : null}
		</div><div className="gdl-bp-ach-fallback-detail">{item.earned ? <div>{item.earned_time > 0 ? formatLocalUnlockDate(item.earned_time) : loc('AppDetails_Achievements_Unlocked', 'Unlocked')}</div> : null}
			{friend ? <div>{comparison!.friendName} {friend.earned ? '✓' : '○'}</div> : null}</div>
	</NativeFocusable>;
	if (tab === 'mine') {
		if (friend && (!friend.earned || friend.earnedTime > 0) && (!item.earned || item.earned_time > 0) && parts.ComparisonRow) return <NativeScreenPartBoundary fallback={fallback}><parts.ComparisonRow {...props}
			title={title} description={description} imgUrl={icon} hidden={hidden} percentGlobalUnlocked={percent ?? undefined}
			primaryAchiever={{ avatarURL: userAvatar, unlockDate: item.earned ? item.earned_time : 0, progress }}
			secondaryAchiever={{ avatarURL: comparison!.friendAvatar, unlockDate: friend.earned ? friend.earnedTime : 0, progress: friendProgress }} /></NativeScreenPartBoundary>;
		if ((item.earned && item.earned_time <= 0) || (friend?.earned && friend.earnedTime <= 0)) return fallback;
		return parts.PersonalRow ? <NativeScreenPartBoundary fallback={fallback}><parts.PersonalRow {...props}
			className={`gdl-bp-ach-row ${parts.row.AchievementListItemBase || ''}`}
			title={title} description={description} imgUrl={icon} hidden={hidden} glow={item.earned && isRareAchievement(item)}
			unlockDate={item.earned ? item.earned_time : 0} percentGlobalUnlocked={percent ?? undefined}
			progress={progress} /></NativeScreenPartBoundary> : fallback;
	}
	const css = parts.row;
	return <NativeFocusable {...props} focusable className={`gdl-bp-ach-row ${css.GlobalAchievementListItem || 'gdl-bp-ach-fallback-row'}`}>
		<div className={css.UnlockContainer || 'gdl-bp-ach-check'} aria-label={item.earned ? loc('AppDetails_Achievements_Unlocked', 'Unlocked') : undefined}>
			{item.earned ? NativeIcons.Checkmark ? <NativeIcons.Checkmark /> : '✓' : ''}</div>
		<div className={`${css.Content || 'gdl-bp-ach-global-content'} ${hidden ? css.Hidden || '' : ''}`}>
			<div className={css.ImageContainer}>{parts.Image ? <NativeScreenPartBoundary fallback={<img width="48" height="48" loading="lazy" src={item.icon} alt="" />}>
				<parts.Image hidden={hidden} glow={false} imgURL={item.icon} /></NativeScreenPartBoundary>
				: hidden ? <span aria-hidden="true">?</span> : <img width="48" height="48" loading="lazy" src={item.icon} alt="" />}</div>
			<div className={css.Right || 'gdl-bp-ach-global-info'}>
				<div className={css.Info}><div className={css.Title || 'gdl-bp-ach-fallback-title'}>{title}</div>
					<div className={css.Description || 'gdl-bp-ach-fallback-description'}>{description}</div></div>
				<span className={css.Percent || 'gdl-bp-ach-percent'}>{percent === null ? '—' : `${percent.toFixed(1)}%`}</span>
				{hidden && css.SpoilerWarning ? <div className={css.SpoilerWarning}>{loc('Achievements_HiddenAchievementItem_Individual_Reveal_Gamepad', 'Select to reveal achievement')}</div> : null}
			</div>
			{percent !== null ? <div className={css.ProgressFill || 'gdl-bp-ach-global-fill'} style={{ width: `${percent}%` }} aria-hidden="true" /> : null}
		</div>
	</NativeFocusable>;
}

export function openBigPictureAchievementsScreen(doc: Document, shortcut: MappedShortcut,
	data: LocalAchievementData, title = shortcut.title, initialAchievementName?: string): boolean {
	const ownerReact = getDocumentReact(doc);
	if (!currentOwner(doc, shortcut) || !ownerReact || getCachedLocalAchievementsForShortcut(shortcut.steamAppId, String(shortcut.id)) !== data
		|| String(data.metadata_appid || data.appid) !== shortcut.steamAppId) return false;
	ensureScreenStyles(doc);
	return showBigPictureModal(doc, 'gdl-bp-achievements-screen', title,
		(close, lease) => <BigPictureAchievementScreen document={doc} shortcut={shortcut} data={data} close={close} lease={lease} initialAchievementName={initialAchievementName} />, { fullScreen: true });
}
