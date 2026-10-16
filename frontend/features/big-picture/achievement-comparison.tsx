import React from 'react';
import { getAchievementComparisonFriends, getFriendAchievementState, type AchievementComparisonFriend, type FriendAchievementState } from '../achievements/comparison';
import type { LocalAchievementData } from '../../domain/types';
import { gdlText, loc } from '../../steam/localization';
import { getDocumentUIComponents } from '../../steam/gamepad/document-ui-runtime';
import { steamWebpackRuntime } from '../../steam/modules/SteamWebpackRuntime';
import { DocumentRuntimeCache } from '../../steam/gamepad/runtime-cache';
import { focusBigPictureNativeElement } from './native-focus';
import type { MappedShortcut } from './types';

export interface BigPictureAchievementComparisonSelection {
	friendId: string;
	friendName: string;
	friendAvatar: string;
	loading: boolean;
	error: string;
	achievements: Map<string, FriendAchievementState> | null;
}
interface ComparisonView {
	friends: AchievementComparisonFriend[];
	friendsLoading: boolean;
	friendsError: string;
	selection: BigPictureAchievementComparisonSelection | null;
}
const emptyView = (): ComparisonView => ({ friends: [], friendsLoading: false, friendsError: '', selection: null });
const clickProps = (onClick: () => void) => ({ onClick });

/** Requests are read-only; an old friend, route or closed modal cannot publish a result. */
export function createBigPictureAchievementComparisonSession(doc: Document, shortcut: MappedShortcut,
	isCurrent: () => boolean, changed: (view: ComparisonView) => void) {
	let view = emptyView(), disposed = false, listGeneration = 0, selectionGeneration = 0;
	const current = () => !disposed && !!doc.defaultView && !doc.defaultView.closed && doc.defaultView.document === doc && isCurrent();
	const publish = (next: ComparisonView) => { if (current()) { view = next; changed(view); } };
	return {
		get snapshot(): ComparisonView { return view; },
		async loadFriends(): Promise<void> {
			if (!current()) return;
			const generation = ++listGeneration;
			publish({ ...view, friendsLoading: true, friendsError: '' });
			try {
				const friends = await getAchievementComparisonFriends(doc, shortcut.steamAppId);
				if (current() && generation === listGeneration) publish({ ...view, friends, friendsLoading: false });
			} catch {
				if (current() && generation === listGeneration) publish({ ...view, friendsLoading: false,
					friendsError: gdlText('achievement_comparison_friends_unavailable', 'Friends are unavailable. Try again.') });
			}
		},
		async select(friendId: string): Promise<boolean> {
			if (!current()) return false;
			const friend = friendId ? view.friends.find(item => item.steamid === friendId) : null;
			if (friendId && !friend) return false;
			const generation = ++selectionGeneration;
			if (!friend) { publish({ ...view, selection: null }); return true; }
			const selection: BigPictureAchievementComparisonSelection = { friendId: friend.steamid, friendName: friend.name,
				friendAvatar: friend.avatar, loading: true, error: '', achievements: null };
			publish({ ...view, selection });
			try {
				const achievements = await getFriendAchievementState(doc, shortcut.steamAppId, friend.steamid);
				if (current() && generation === selectionGeneration) publish({ ...view, selection: { ...selection, loading: false, achievements } });
			} catch {
				if (current() && generation === selectionGeneration) publish({ ...view, selection: { ...selection, loading: false,
					error: gdlText('achievement_comparison_unavailable', 'This friend’s achievements are private or unavailable.') } });
			}
			return true;
		},
		dispose(): void { disposed = true; listGeneration++; selectionGeneration++; },
	};
}

type NativeDropdown = React.ComponentType<any>;
const dropdowns = new DocumentRuntimeCache(() => ({ count: -1, value: null as NativeDropdown | null }));
function resolveComparisonDropdown(doc: Document): NativeDropdown | null {
	const req = steamWebpackRuntime.getRequire(doc);
	if (!req) return null;
	const cache = dropdowns.get(doc), count = steamWebpackRuntime.getModuleFactoryCount(doc);
	if (cache.count === count) return cache.value;
	cache.count = count;
	const select = (exports: any): NativeDropdown | null => {
		const candidate = exports?.ZU, prototype = candidate?.prototype;
		return ['SetSelectedOption', 'BuildMenu', 'OnValueSelected', 'ToggleMenu'].every(key => typeof prototype?.[key] === 'function') ? candidate : null;
	};
	for (const module of steamWebpackRuntime.getAllModules(doc)) {
		const candidate = select(module.exports);
		if (candidate) return cache.value = candidate;
	}
	for (const { id, factory } of steamWebpackRuntime.getModuleFactories(doc)) {
		if (req.m?.[id] !== factory || !['strDefaultLabel', 'SetSelectedOption', 'BuildMenu', 'contextMenuPositionOptions'].every(token => String(factory).includes(token))) continue;
		try { const candidate = select(req(id)); if (candidate) return cache.value = candidate; } catch {}
	}
	return cache.value = null;
}

export interface BigPictureAchievementComparisonProps {
	document: Document;
	shortcut: MappedShortcut;
	isCurrent: () => boolean;
	onSelection: (selection: BigPictureAchievementComparisonSelection | null) => void;
	data?: LocalAchievementData;
	react?: typeof React;
}
function FallbackButton({ onActivate, onClick, ...props }: any): React.ReactElement {
	return <button {...props} type="button" {...clickProps(onClick || onActivate)} />;
}
function FallbackGroup({ focusable: _focusable, onCancelButton, ...props }: any): React.ReactElement {
	return <div {...props} onKeyDown={event => { if (event.key === 'Escape') onCancelButton?.(event); }} />;
}

/** The native dropdown owns its focus/menu; only its option data comes from NGL. */
export class BigPictureAchievementComparison extends React.Component<BigPictureAchievementComparisonProps, ComparisonView & { pickerOpen: boolean }> {
	state = { ...emptyView(), pickerOpen: false };
	private session: ReturnType<typeof createBigPictureAchievementComparisonSession> | null = null;
	private selected: BigPictureAchievementComparisonSelection | null | undefined;
	private pickerOpen = false;
	private host: HTMLDivElement | null = null;
	componentDidMount(): void { this.start(); }
	componentDidUpdate(previous: BigPictureAchievementComparisonProps): void {
		if (previous.document !== this.props.document || previous.shortcut.id !== this.props.shortcut.id
			|| previous.shortcut.steamAppId !== this.props.shortcut.steamAppId) this.start();
	}
	componentWillUnmount(): void { this.session?.dispose(); this.session = null; this.pickerOpen = false; this.host = null; }
	private start(): void {
		this.session?.dispose(); this.selected = undefined; this.pickerOpen = false;
		this.setState({ pickerOpen: false });
		this.session = createBigPictureAchievementComparisonSession(this.props.document, this.props.shortcut, () => this.props.isCurrent(), view => {
			this.setState(view);
			if (view.selection !== this.selected) { this.selected = view.selection; this.props.onSelection(view.selection); }
		});
		void this.session.loadFriends();
	}
	private friendLabel(friend: AchievementComparisonFriend): React.ReactNode {
		return <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
			{friend.avatar ? <img src={friend.avatar} width="32" height="32" alt="" /> : null}<span>{friend.name}</span>
		</span>;
	}
	private openFallback = (): void => {
		if (!this.props.isCurrent()) return;
		this.pickerOpen = true; this.setState({ pickerOpen: true }, () => {
			this.focusFallback('[data-gdl-bp-comparison-option]');
		});
	};
	private closeFallback = (): void => {
		if (!this.props.isCurrent()) return;
		this.pickerOpen = false; this.setState({ pickerOpen: false }, () => {
			this.focusFallback('[data-gdl-bp-comparison-trigger]');
		});
	};
	private focusFallback(selector: string): void {
		if (!this.props.isCurrent()) return;
		const target = this.host?.querySelector<HTMLElement>(selector);
		if (target && !focusBigPictureNativeElement(this.props.document, target)) target.focus({ preventScroll: true });
	}
	private chooseFallback(friendId: string): void {
		if (!this.pickerOpen || !this.props.isCurrent()) return;
		this.closeFallback(); void this.session?.select(friendId);
	}
	render(): React.ReactNode {
		if (!this.props.isCurrent()) return null;
		const doc = this.props.document, Dropdown = resolveComparisonDropdown(doc), ui = getDocumentUIComponents(doc);
		const Button: React.ComponentType<any> = ui.DialogButton || FallbackButton;
		const Focusable: React.ComponentType<any> = ui.Focusable || FallbackGroup;
		const label = loc('Achievements_ComparisonLabel_NotComparing', 'Compare with...');
		if (this.state.friendsError) return <div><Button {...clickProps(() => { void this.session?.loadFriends(); })} title={this.state.friendsError}>
			{label}</Button><span role="status">{this.state.friendsError}</span></div>;
		if (Dropdown) return <Dropdown controlled selectedOption={this.state.selection?.friendId || ''}
			rgOptions={[{ data: '', label: this.state.selection ? loc('Achievements_ComparisonLabel_Clear', 'Clear comparison') : label },
				...this.state.friends.map(friend => ({ data: friend.steamid, label: this.friendLabel(friend) }))]}
			strDefaultLabel={label} aria-label={label} disabled={this.state.friendsLoading || this.state.friends.length === 0}
			onMenuWillOpen={() => this.props.isCurrent()} onChange={(option: { data: string }) => { void this.session?.select(String(option.data)); }} />;
		// A second owned modal would retire the achievement screen and its lease.
		// Keep fallback options inside this screen's existing navigation tree.
		return <div ref={element => { this.host = element; }}><Focusable focusable={false} flow-children="column" onCancelButton={(event: any) => {
			if (this.pickerOpen && this.props.isCurrent()) { this.closeFallback(); event?.preventDefault?.(); event?.stopPropagation?.(); }
		}}>
			<Button data-gdl-bp-comparison-trigger {...clickProps(this.openFallback)} onActivate={this.openFallback}
				disabled={this.state.friendsLoading || this.state.friends.length === 0} aria-expanded={this.state.pickerOpen}>{label}</Button>
			{this.state.pickerOpen ? <Focusable focusable={false} flow-children="column" style={{ maxHeight: '32vh', overflowY: 'auto' }}>
				<Button data-gdl-bp-comparison-option {...clickProps(() => this.chooseFallback(''))} onActivate={() => this.chooseFallback('')}>
					{loc('Achievements_ComparisonLabel_Clear', 'Clear comparison')}</Button>
				{this.state.friends.map(friend => <Button data-gdl-bp-comparison-option key={friend.steamid} {...clickProps(() => this.chooseFallback(friend.steamid))}
					onActivate={() => this.chooseFallback(friend.steamid)}>{this.friendLabel(friend)}</Button>)}
				<Button {...clickProps(this.closeFallback)} onActivate={this.closeFallback}>{loc('Button_Cancel', 'Cancel')}</Button>
			</Focusable> : null}
		</Focusable></div>;
	}
}
