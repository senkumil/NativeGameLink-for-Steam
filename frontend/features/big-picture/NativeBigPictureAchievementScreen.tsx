import React, { Component, type ReactNode } from 'react';
import { GamepadButton } from '@steambrew/client';
import type { LocalAchievementData, LocalAchievementItem } from '../../domain/types';
import { loc } from '../../steam/localization';
import { steamWebpackRuntime } from '../../steam/modules/SteamWebpackRuntime';
import { isCurrentLinkedGamepadTarget } from '../../steam/gamepad/GamepadContext';
import { steamUIModeService } from '../../steam/ui/SteamUIModeService';
import { getDocumentReact, getDocumentUIComponents } from '../../steam/gamepad/document-ui-runtime';
import { getCachedLocalAchievementsForShortcut, cacheLocalAchievements } from '../achievements/cache';
import { subscribeLocalAchievementData } from '../achievements/service';
import { formatLocalUnlockDate } from '../achievements/format';
import { isRareAchievement } from '../achievements/rarity';
import { getCurrentSteamUser } from '../library/social/feed';
import { EXIT_TEXT_EDITOR_EVENT, isEditableTextTarget } from './editable-target';
import { switchBigPictureOwnedModalTab } from './gamepad-nav';
import { showBigPictureModal, type BigPictureModalLease } from './owned-modals';
import type { MappedShortcut } from './types';

type NativeComponent = React.ComponentType<any>;
type Classes = Record<string, string>;
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

interface NativeAchievementScreenParts {
	PersonalRow: NativeComponent | null;
	Image: NativeComponent | null;
	Search: NativeComponent | null;
	row: Classes;
	header: Classes;
	tabs: Classes;
}

function component(value: any): value is NativeComponent {
	return typeof value === 'function' || Boolean(value && typeof value === 'object' && value.$$typeof);
}

/** These are presentational exports from the installed Steam achievement
 * screen, not the AppID-backed screen that fetches a Steam account's progress. */
export function resolveBigPictureAchievementScreenParts(doc: Document): NativeAchievementScreenParts {
	const result: NativeAchievementScreenParts = { PersonalRow: null, Image: null, Search: null, row: {}, header: {}, tabs: {} };
	if (!doc.defaultView || doc.defaultView.document !== doc || doc.defaultView.closed) return result;
	steamWebpackRuntime.captureRuntime(doc);
	const req = steamWebpackRuntime.getRequire(doc);
	if (!req) return result;
	const read = (id: number): any => { try { return req(id); } catch { return null; } };
	const rows = read(18980);
	if (rows && ['AchievementListItemBase', 'GlobalAchievementListItem', 'UnlockContainer', 'ProgressFill']
		.every(key => typeof rows[key] === 'string')) result.row = rows;
	const header = read(83097);
	if (header && ['StatsBlock', 'BigStat', 'ProgressLabel', 'AchievementSearchHeader'].every(key => typeof header[key] === 'string')) result.header = header;
	const tabs = read(62645);
	if (tabs && ['Tab', 'Selected', 'TabRow', 'TabTitle'].every(key => typeof tabs[key] === 'string')) result.tabs = tabs;
	const rowComponent = read(36000)?.fm;
	if (component(rowComponent) && ['unlockDate', 'percentGlobalUnlocked', 'imgUrl'].every(key => String(rowComponent).includes(key))) result.PersonalRow = rowComponent;
	const image = read(3270)?._;
	if (component(image) && ['imgURL', 'hidden', 'glow'].every(key => String(image).includes(key))) result.Image = image;
	const search = read(24124)?.zp;
	if (component(search) && ['strFilter', 'onChangeFilter', 'leftContent'].every(key => String(search).includes(key))) result.Search = search;
	return result;
}

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
#gdl-bp-achievements-screen{width:min(90vw,1200px);max-width:100%;color:var(--gpSystemLightestGrey,#dcdedf)}
#gdl-bp-achievements-screen .gdl-bp-ach-screen{display:flex;flex-direction:column;max-height:82vh;min-height:420px;gap:16px}
#gdl-bp-achievements-screen .gdl-bp-ach-head{flex:none;display:flex;align-items:center;gap:16px}
#gdl-bp-achievements-screen .gdl-bp-ach-head>div{flex:1;min-width:0}
#gdl-bp-achievements-screen .gdl-bp-ach-progress-label{display:flex;justify-content:space-between;gap:16px;margin-bottom:8px}
#gdl-bp-achievements-screen .gdl-bp-ach-ribbon{width:40px;height:40px;flex:none}
#gdl-bp-achievements-screen .gdl-bp-ach-tabs{display:flex;flex:none;gap:12px}
#gdl-bp-achievements-screen .gdl-bp-ach-tab{cursor:pointer;padding:12px 20px;border-bottom:3px solid transparent}
#gdl-bp-achievements-screen .gdl-bp-ach-tab[aria-selected=true]{border-color:var(--gpColor-Blue,#1a9fff)}
#gdl-bp-achievements-screen .gdl-bp-ach-scroll{min-height:0;overflow-y:auto;overscroll-behavior:contain;scroll-padding:12px;flex:1;padding:4px 8px 8px 4px}
#gdl-bp-achievements-screen .gdl-bp-ach-search{display:flex;align-items:center;gap:16px;margin-bottom:12px}
#gdl-bp-achievements-screen .gdl-bp-ach-search>div{flex:1}
#gdl-bp-achievements-screen .gdl-bp-ach-avatar{width:36px;height:36px}
#gdl-bp-achievements-screen .gdl-bp-ach-global-label{white-space:nowrap;font-size:14px;font-weight:600}
#gdl-bp-achievements-screen .gdl-bp-ach-row{position:relative;min-height:68px;margin-bottom:8px;scroll-margin:12px}
#gdl-bp-achievements-screen .gdl-bp-ach-row:focus-visible,#gdl-bp-achievements-screen .gdl-bp-ach-row.gpfocus{outline:3px solid var(--gpSystemLightestGrey,#fff);outline-offset:1px}
#gdl-bp-achievements-screen .gdl-bp-ach-fallback-row{display:flex;align-items:center;gap:12px;background:var(--gpBackground-LightSoft,#242830);padding:10px;box-sizing:border-box}
#gdl-bp-achievements-screen .gdl-bp-ach-fallback-row img{width:60px;height:60px;object-fit:contain;flex:none}
#gdl-bp-achievements-screen .gdl-bp-ach-fallback-copy{flex:1;min-width:0}
#gdl-bp-achievements-screen .gdl-bp-ach-fallback-title{font-size:18px;font-weight:600}
#gdl-bp-achievements-screen .gdl-bp-ach-fallback-description{font-size:14px;color:var(--gpSystemLighterGrey,#b8bcbf)}
#gdl-bp-achievements-screen .gdl-bp-ach-fallback-detail{color:var(--gpSystemLightGrey,#8f98a0);font-size:13px}
#gdl-bp-achievements-screen .gdl-bp-ach-global-content{display:flex;align-items:center;gap:12px;position:relative;min-height:68px;flex:1;padding:10px;box-sizing:border-box}
#gdl-bp-achievements-screen .gdl-bp-ach-global-content img{width:60px;height:60px;object-fit:contain}
#gdl-bp-achievements-screen .gdl-bp-ach-global-info{flex:1;min-width:0;z-index:1}
#gdl-bp-achievements-screen .gdl-bp-ach-global-fill{position:absolute;inset:0 auto 0 0;background:rgba(255,255,255,.055);pointer-events:none}
#gdl-bp-achievements-screen .gdl-bp-ach-percent{font-weight:700;white-space:nowrap;z-index:1}
#gdl-bp-achievements-screen .gdl-bp-ach-check{width:30px;flex:none;text-align:center}
#gdl-bp-achievements-screen .gdl-bp-ach-empty{padding:32px;text-align:center;color:var(--gpSystemLightGrey,#8f98a0)}
#gdl-bp-achievements-screen .gdl-bp-ach-footer{display:flex;justify-content:flex-end;flex:none}
`;
	(doc.head || doc.body).appendChild(style);
}

function achievementText(token: string, fallback: string, ...values: number[]): string {
	return loc(token, fallback).replace(/%([1-9]\d*)\$[sd]/g, (match, index) => String(values[Number(index) - 1] ?? match));
}

interface ScreenProps { document: Document; shortcut: MappedShortcut; data: LocalAchievementData; close: () => void;
	lease: BigPictureModalLease }

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
	const [revealed, setRevealed] = ownerReact.useState<Set<string>>(() => new Set());
	const scroll = ownerReact.useRef<HTMLDivElement>(null);
	const scrollPositions = ownerReact.useRef({ mine: 0, global: 0 });
	const parts = ownerReact.useMemo(() => resolveBigPictureAchievementScreenParts(doc), [doc]);
	const ownerRoot = ownerReact.useRef(doc.getElementById('gdl-bp-detail-root'));
	const generation = ownerReact.useRef(ownerRoot.current?.dataset.gdlBpGeneration);
	const current = () => props.lease.isCurrent() && currentOwner(doc, shortcut) && ownerRoot.current?.isConnected
		&& doc.getElementById('gdl-bp-detail-root') === ownerRoot.current
		&& ownerRoot.current?.dataset.gdlBpGeneration === generation.current;
	ownerReact.useEffect(() => {
		let disposed = false;
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
	const globalLabel = loc('Achievements_GlobalAchievement_PercentUnlockedLabel', '% of all players');
	const searchFallback = <div className="gdl-bp-ach-search">
		{tab === 'global' && user.avatar ? <img className="gdl-bp-ach-avatar" src={user.avatar} alt={user.name} /> : null}
		<div><NativeTextField value={filters[tab]} onChange={onFilter} aria-label={loc('Achievements_Filter_Default', 'Search')}
			placeholder={loc('Achievements_Filter_Default', 'Search')} /></div>
		{tab === 'global' ? <span className="gdl-bp-ach-global-label">{globalLabel}</span> : null}
	</div>;
	return <NativeFocusable className="gdl-bp-ach-screen" flow-children="column" focusable={false}
		onCancel={close} onCancelActionDescription={loc('Button_Back', 'Back')}
		onButtonDown={(event: any) => {
			if (!current() || event.defaultPrevented || event.detail?.is_repeat || isEditableTextTarget(doc.activeElement)) return;
			const offset = event.detail?.button === GamepadButton.BUMPER_LEFT ? -1 : event.detail?.button === GamepadButton.BUMPER_RIGHT ? 1 : 0;
			if (offset && switchBigPictureOwnedModalTab(doc, offset)) { event.preventDefault(); event.stopPropagation(); }
		}}>
		<div className={`gdl-bp-ach-head ${parts.header.StatsBlock || ''}`}>
			{complete && NativeIcons.Achievement ? <NativeIcons.Achievement fullcolor className={`gdl-bp-ach-ribbon ${parts.header.Ribbon || ''}`} /> : null}
			<div className={parts.header.BigStat}><div className={`gdl-bp-ach-progress-label ${parts.header.ProgressLabel || ''}`}>
				<span>{complete ? achievementText('AppDetails_PlayerUnlockedPercentAll', "You've unlocked all achievements! %1$s/%2$s", unlocked, total)
					: achievementText('Achievements_HeaderStats_Earned_Label', '%1$s of %2$s achievements earned', unlocked, total)}</span><span>({percent}%)</span>
			</div><NativeProgress nProgress={percent} /></div>
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
			{parts.Search ? <NativeScreenPartBoundary fallback={searchFallback}><parts.Search strFilter={filters[tab]} onChangeFilter={onFilter}
				leftContent={tab === 'global' && user.avatar ? <img className="gdl-bp-ach-avatar" src={user.avatar} alt={user.name} /> : undefined}
				rightContent={tab === 'global' ? <span className="gdl-bp-ach-global-label">{globalLabel}</span> : undefined} /></NativeScreenPartBoundary> : searchFallback}
			<NativeFocusable flow-children="column" focusable={false} className={parts.row.AchievementList}>
				{rows.map(item => <AchievementRow key={`${tab}:${item.name}`} item={item} tab={tab} parts={parts} ui={ui}
					revealed={revealed.has(item.name)} onReveal={() => reveal(item)} />)}
				{rows.length === 0 ? <div role="status" className="gdl-bp-ach-empty">{loc('Search_NoResults', 'No results')}</div> : null}
			</NativeFocusable>
		</div>
		<div className="gdl-bp-ach-footer"><NativeButton className="gdl-bp-ach-close-trigger" {...clickProps(close)}>
			{loc('Button_Back', 'Back')}</NativeButton></div>
	</NativeFocusable>;
}

function AchievementRow({ item, tab, parts, ui, revealed, onReveal }: { item: LocalAchievementItem; tab: BigPictureAchievementTab;
	parts: NativeAchievementScreenParts; ui: ScreenUI; revealed: boolean; onReveal: () => void }): React.ReactElement {
	const { Focusable: NativeFocusable, Icons: NativeIcons } = ui;
	const hidden = item.hidden && !item.earned && !revealed;
	const percent = knownBigPictureAchievementPercent(item);
	const title = hidden ? loc('Achievements_HiddenAchievementItem_Individual_Title', 'Hidden achievement') : item.display_name || item.name;
	const description = hidden ? loc('Achievements_HiddenAchievementItem_Description', 'Details will be revealed once unlocked.') : item.description;
	const icon = item.earned ? item.icon : item.icon_gray || item.icon;
	const props = { className: 'gdl-bp-ach-row', 'data-gdl-achievement-name': item.name,
		'data-gdl-focus-key': `achievement-${tab}-${item.name}`, tabIndex: 0, onActivate: onReveal, onClick: onReveal,
		onOKActionDescription: hidden ? loc('Achievements_HiddenAchievementItem_Individual_Reveal', 'Reveal achievement') : null };
	const fallback = <NativeFocusable {...props} focusable className="gdl-bp-ach-row gdl-bp-ach-fallback-row">
		{hidden ? <span aria-hidden="true">?</span> : <img loading="lazy" src={icon} alt="" />}
		<div className="gdl-bp-ach-fallback-copy"><div className="gdl-bp-ach-fallback-title">{title}</div><div className="gdl-bp-ach-fallback-description">{description}</div>
			{item.earned && percent !== null ? <div className="gdl-bp-ach-fallback-detail">{loc('AppDetails_PctUnlocked', '%1$s% of players have this achievement').replace('%1$s', percent.toFixed(1))}</div> : null}
		</div>{item.earned_time > 0 && item.earned ? <span className="gdl-bp-ach-fallback-detail">{formatLocalUnlockDate(item.earned_time)}</span> : null}
	</NativeFocusable>;
	if (tab === 'mine') {
		return parts.PersonalRow ? <NativeScreenPartBoundary fallback={fallback}><parts.PersonalRow {...props}
			className={`gdl-bp-ach-row ${parts.row.AchievementListItemBase || ''}`}
			title={title} description={description} imgUrl={icon} hidden={hidden} glow={item.earned && isRareAchievement(item)}
			unlockDate={item.earned ? item.earned_time : 0} percentGlobalUnlocked={percent ?? undefined}
			progress={!item.earned && item.max_progress > 0 ? { flCurrent: item.progress, flMax: item.max_progress,
				flPercentage: Math.max(0, Math.min(100, item.progress * 100 / item.max_progress)) } : undefined} /></NativeScreenPartBoundary> : fallback;
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
	data: LocalAchievementData, title = shortcut.title): boolean {
	const ownerReact = getDocumentReact(doc);
	if (!currentOwner(doc, shortcut) || !ownerReact || getCachedLocalAchievementsForShortcut(shortcut.steamAppId, String(shortcut.id)) !== data
		|| String(data.metadata_appid || data.appid) !== shortcut.steamAppId) return false;
	ensureScreenStyles(doc);
	return showBigPictureModal(doc, 'gdl-bp-achievements-screen', title,
		(close, lease) => <BigPictureAchievementScreen document={doc} shortcut={shortcut} data={data} close={close} lease={lease} />);
}
