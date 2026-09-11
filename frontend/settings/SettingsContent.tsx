import React from 'react';
import type { LocalAchievementItem } from '../domain/types';
import { backendLog } from '../api/backend';
import { gdlText, getSteamLanguage, subscribeSteamLanguageChange } from '../steam/localization';
import { fetchLocalAchievementData } from '../features/achievements/service';
import { refreshLocalAchievementUI } from '../features/achievements/runtime';
import { clearLibraryAssetCaches } from '../features/library/artwork';
import { getPreferences, setPreferences, subscribePreferences } from '../core/preferences';
import { AchievementFolderSection } from './AchievementFolderSection';
import { LinkManagementSection } from './LinkManagementSection';
import { SteamGridDbSettings } from './SteamGridDbSettings';
import { FactoryResetSection } from './FactoryResetSection';

export interface SettingsContentProps {
	clearAchievementCache: () => void;
	showAchievementToast: (appid: string, achievement: LocalAchievementItem) => Promise<void>;
}

interface SettingsToggleProps {
	checked: boolean;
	disabled?: boolean;
	label: string;
	onChange: (checked: boolean) => void;
}

/**
 * Keep global settings fully controlled by React. Steam has shipped different
 * Toggle onChange contracts across client builds, and some builds leave a
 * controlled toggle visually frozen even after its preference was persisted.
 */
const SettingsToggle = ({ checked, disabled = false, label, onChange }: SettingsToggleProps): React.ReactElement => {
	const controlRef = React.useRef<HTMLButtonElement>(null);
	const current = React.useRef({ checked, disabled, onChange });
	current.current = { checked, disabled, onChange };
	React.useEffect(() => {
		const control = controlRef.current;
		if (!control) return undefined;
		const activate = (event: Event): void => {
			if (current.current.disabled) return;
			event.preventDefault();
			event.stopPropagation();
			const next = !current.current.checked;
			current.current.checked = next;
			control.setAttribute('aria-checked', next ? 'true' : 'false');
			control.style.background = next ? '#1a9fff' : '#4b5869';
			const knob = control.firstElementChild as HTMLElement | null;
			if (knob) knob.style.left = next ? '21px' : '3px';
			current.current.onChange(next);
		};
		const onPointerDown = (event: PointerEvent): void => {
			if (event.button !== 0) return;
			activate(event);
		};
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === ' ' || event.key === 'Enter') {
				activate(event);
			}
		};
		control.addEventListener('pointerdown', onPointerDown);
		control.addEventListener('keydown', onKeyDown);
		return () => {
			control.removeEventListener('pointerdown', onPointerDown);
			control.removeEventListener('keydown', onKeyDown);
		};
	}, []);
	return (
		<button
			ref={controlRef}
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			disabled={disabled}
			tabIndex={disabled ? -1 : 0}
			style={{
				position: 'relative',
				width: '42px',
				minWidth: '42px',
				maxWidth: '42px',
				height: '24px',
				minHeight: '24px',
				maxHeight: '24px',
				flexShrink: 0,
				flexGrow: 0,
				display: 'inline-block',
				boxSizing: 'border-box',
				padding: 0,
				borderRadius: '12px',
				border: 'none',
				background: checked ? '#1a9fff' : '#4b5869',
				transition: 'background .12s ease',
				cursor: disabled ? 'default' : 'pointer',
				opacity: disabled ? .45 : 1,
				pointerEvents: 'auto',
			}}
		>
			<span aria-hidden="true" style={{
				position: 'absolute',
				top: '3px',
				left: checked ? '21px' : '3px',
				width: '18px',
				height: '18px',
				borderRadius: '50%',
				background: '#f1f1f1',
				transition: 'left .12s ease',
				boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
			}} />
		</button>
	);
};

export const SettingsContent = ({ clearAchievementCache, showAchievementToast }: SettingsContentProps) => {
	const [, setLanguageRevision] = React.useState(0);
	React.useEffect(() => {
		let active = true;
		void getSteamLanguage(true).then(() => {
			if (active) setLanguageRevision(value => value + 1);
		}).catch(() => {});
		const unsubscribe = subscribeSteamLanguageChange(() => {
			if (active) setLanguageRevision(value => value + 1);
		});
		const onFocus = (): void => {
			void getSteamLanguage(true).then(() => {
				if (active) setLanguageRevision(value => value + 1);
			}).catch(() => {});
		};
		window.addEventListener('focus', onFocus);
		return () => {
			active = false;
			unsubscribe();
			window.removeEventListener('focus', onFocus);
		};
	}, []);

	const [preferences, setPreferencesState] = React.useState(() => getPreferences());
	React.useEffect(() => subscribePreferences(setPreferencesState), []);

	const [testingAchievement, setTestingAchievement] = React.useState(false);
	const [testStatus, setTestStatus] = React.useState<{ text: string; color: string } | null>(null);

	const updatePreferences = (patch: Parameters<typeof setPreferences>[0]): void => {
		const next = setPreferences(patch);
		setPreferencesState(next);
		if ('steamGridDbApiKey' in patch || 'autoCommunityArtwork' in patch) clearLibraryAssetCaches();
		clearAchievementCache();
		if ('simulateAchievements' in patch || 'unlockOnlineAchievements' in patch) {
			refreshLocalAchievementUI();
		}
	};

	const testRandomAchievement = async (): Promise<void> => {
		if (testingAchievement) return;
		setTestingAchievement(true);
		setTestStatus(null);
		const games = [
			{ appid: '400', game: 'Portal', ach: 'Heartbreaker', desc: 'Complete Portal', icon: 'https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/400/17ee24fb705d8bc1da1231f74b439c065f49df16.jpg' },
			{ appid: '220', game: 'Half-Life 2', ach: 'Trusty Hardware', desc: 'Get the crowbar.', icon: 'https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/220/8254c25eb4d6ad5e48398e096f4fcfffe6f50543.jpg' },
			{ appid: '730', game: 'Counter-Strike 2', ach: 'Someone Set Up Us The Bomb', desc: 'Win a round by planting a bomb.', icon: 'https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/730/c02cfb62e4313b0c950de00570fc2de38e8ec2fb.jpg' },
			{ appid: '1086940', game: "Baldur's Gate 3", ach: 'Descent From Avernus', desc: 'Take control of the nautiloid and escape the Hells.', icon: 'https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/1086940/ca805eec0fbba34e06385aef16b67e3cefcb43a9.jpg' },
			{ appid: '413150', game: 'Stardew Valley', ach: 'Greenhorn', desc: 'Earn 15,000g.', icon: 'https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/413150/d24492bf22bc968c92a6fdf942f2ed84501a3ea3.jpg' },
			{ appid: '1091500', game: 'Cyberpunk 2077', ach: 'The World', desc: 'Complete the main storyline.', icon: 'https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/1091500/1258671eb2a06148386121fbe61d6ec677b10287.jpg' },
			{ appid: '1245620', game: 'ELDEN RING', ach: 'Elden Lord', desc: 'Achieved the "Elden Lord" ending.', icon: 'https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/1245620/b382cf8fa83a9cefd07db7159c3a3881432f8016.jpg' },
			{ appid: '367520', game: 'Hollow Knight', ach: 'Judgment', desc: 'Defeat the Last Judge.', icon: 'https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/367520/731ca0cb64619ad4ae94819d45e7f1ef504eb207.jpg' },
			{ appid: '1145360', game: 'Hades', ach: 'Is There No Escape?', desc: 'Clear an escape attempt.', icon: 'https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/1145360/4cbeec94e1e07b22cf3316f73db2f6f5925e01cb.jpg' },
			{ appid: '1790600', game: 'DRAGON BALL: Sparking! ZERO', ach: 'A New Legend Begins', desc: 'Completed your first battle.', icon: 'https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/1790600/7a57a550fa63fe3509930fca68340d850ecf6cb9.jpg' }
		];
		const randomGame = { ...games[Math.floor(Math.random() * games.length)] };
		try {
			const metadata = await fetchLocalAchievementData(randomGame.appid, {
				stateAppId: randomGame.appid,
				allowSimulated: true,
			});
			const candidates = Array.isArray(metadata?.achievements)
				? metadata.achievements.filter(item => !!(item.icon || item.icon_gray))
				: [];
			if (candidates.length > 0) {
				const picked = candidates[Math.floor(Math.random() * candidates.length)];
				randomGame.ach = picked.display_name || picked.name;
				randomGame.desc = picked.description || randomGame.desc;
				randomGame.icon = picked.icon || picked.icon_gray || randomGame.icon;
			}
		} catch (e) {
			backendLog('Test achievement metadata refresh failed; using bundled fallback: ' + String(e));
		}
		const fakeItem: LocalAchievementItem = {
			name: 'TEST_' + Math.random().toString(36).substring(2, 7),
			display_name: randomGame.ach,
			description: randomGame.desc,
			icon: randomGame.icon,
			icon_gray: '',
			hidden: false,
			global_percent: Math.random() * 100,
			earned: true,
			earned_time: Math.floor(Date.now() / 1000),
			progress: 100,
			max_progress: 100
		};
		try {
			await showAchievementToast(randomGame.appid, fakeItem);
			setTestStatus({
				text: gdlText('achievement_test_sent', '✓ Test notification sent: {game} — {achievement}', {
					game: randomGame.game,
					achievement: randomGame.ach
				}),
				color: '#59bf40',
			});
		} catch (e) {
			backendLog('Test toast error: ' + String(e));
			setTestStatus({
				text: gdlText('achievement_test_failed', 'Could not show the test notification. Check the Millennium log.'),
				color: '#d94126',
			});
		} finally {
			setTestingAchievement(false);
		}
	};

	return (
		<div style={{
			fontSize: '12px',
			color: '#acb2b8',
			lineHeight: '1.45',
			width: '100%',
			maxWidth: '100%',
			minWidth: 0,
			boxSizing: 'border-box',
			overflowX: 'hidden',
			overflowWrap: 'anywhere',
			paddingRight: '2px',
			// Steam reserves the bottom edge of this sidebar window for native
			// resize gestures. Extra scrollable space keeps the final controls out
			// of that hit-test area at every UI scale and window size.
			paddingBottom: '64px',
		}}>
			{/* ── Tarjeta Guía Rápida Paso a Paso ──────────────────────── */}
			<div style={{
				background: 'linear-gradient(180deg, rgba(27,40,56,0.7) 0%, rgba(20,29,42,0.85) 100%)',
				border: '1px solid rgba(102, 192, 244, 0.2)',
				borderRadius: '4px',
				padding: '10px 12px',
				marginBottom: '12px'
			}}>
				<div style={{ marginBottom: '6px', fontWeight: 600, color: '#66c0f4', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
					<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H7c0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.04-.42 1.99-1.07 2.75z"/></svg>
					{gdlText('settings_guide_title', 'How do I link games to Steam?')}
				</div>
				<div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11.5px', color: '#c6d4df', lineHeight: '1.4' }}>
					<div><b style={{ color: '#fff' }}>1.</b> {gdlText('settings_step_1', 'Add your game in Steam (+ Add a Game → Add a Non-Steam Game).')}</div>
					<div><b style={{ color: '#fff' }}>2.</b> {gdlText('settings_step_2', 'Right-click the game in your Steam library → Properties.')}</div>
					<div><b style={{ color: '#fff' }}>3.</b> {gdlText('settings_step_3', 'In the "Linked game" field, paste the Steam AppID or Store URL (for example, 1245620 for Elden Ring).')}</div>
					<div><b style={{ color: '#59bf40' }}>✓</b> {gdlText('settings_step_4', 'Done! Your game will load official artwork, news, screenshots, local achievements and Big Picture compatibility.')}</div>
				</div>
			</div>

			{/* ── Carpeta local de logros ─────────────────────────────── */}
			<AchievementFolderSection />

			{/* ── Probar notificaciones ────────────────────────────────── */}
			<div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,.08)' }}>
				<div style={{ marginBottom: '3px', fontWeight: 600, color: '#dcdedf', fontSize: '13px' }}>
					{gdlText('achievement_test_title', 'Test achievement notifications')}
				</div>
				<div style={{ marginBottom: '6px', color: '#8f98a0', fontSize: '11.5px' }}>
					{gdlText('achievement_test_description', 'Send a random achievement notification to check that notifications work.')}
				</div>
				<button
					type="button"
					disabled={testingAchievement}
					onClick={(): void => { void testRandomAchievement(); }}
					style={{ width: '100%', maxWidth: '280px', minWidth: 0, padding: '7px 12px', color: '#fff', background: testingAchievement ? '#3d4450' : 'linear-gradient(90deg,#06bfff,#2d73ff)', border: 0, borderRadius: '2px', cursor: testingAchievement ? 'default' : 'pointer', fontWeight: 500, fontSize: '12px' }}
				>
					{testingAchievement
						? gdlText('achievement_test_loading', 'Sending test notification...')
						: gdlText('achievement_test_button', 'Test notification')}
				</button>
				{testStatus && <div style={{ marginTop: '6px', color: testStatus.color, fontSize: '11.5px' }}>{testStatus.text}</div>}
			</div>

			{/* ── Gestión de vinculaciones (Experimental) ──────────────── */}
			<LinkManagementSection preferences={preferences} onChange={updatePreferences} Toggle={SettingsToggle} />

			{/* ── Modo Big Picture (Experimental) ────────────────────────── */}
			<div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,.08)' }}>
				<div style={{ padding: '11px 12px', background: 'rgba(229,173,55,.07)', border: '1px solid rgba(229,173,55,.28)', borderRadius: '4px' }}>
					<div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
						<div style={{ fontWeight: 600, color: '#e5c07b', fontSize: '13px' }}>
							{gdlText('big_picture_settings_title', 'Big Picture Mode')}
						</div>
						<span style={{ padding: '1px 6px', fontSize: '10px', fontWeight: 700, borderRadius: '3px', background: 'rgba(229,173,55,0.2)', color: '#e5c07b', letterSpacing: '0.5px' }}>
							{gdlText('experimental_badge', 'EXPERIMENTAL')}
						</span>
					</div>
					<div style={{ color: '#9da4ab', fontSize: '11.3px', lineHeight: 1.45, marginBottom: '8px' }}>
						{gdlText('big_picture_settings_description', 'Configure NativeGameLink behavior in Steam Big Picture mode.')}
					</div>
					<div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '4px' }}>
						<SettingsToggle
							checked={!preferences.defaultBigPictureMode}
							onChange={checked => updatePreferences({ defaultBigPictureMode: !checked })}
							label={gdlText('enable_big_picture_toggle', 'Enable enhanced Big Picture interface')}
						/>
						<span style={{ fontSize: '12px', color: '#dcdedf' }}>
							{gdlText('enable_big_picture_toggle', 'Enable enhanced Big Picture interface')}
						</span>
					</div>
					<div style={{ color: '#8f98a0', fontSize: '11px', marginTop: '2px', marginLeft: '50px' }}>
						{gdlText('enable_big_picture_description', 'Displays achievements, trading cards, badges, and community hub in Big Picture. Disabled by default to preserve native stability.')}
					</div>
				</div>
			</div>

			{/* ── SteamGridDB Settings ─────────────────────────────────── */}
			<div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,.08)' }}>
				<SteamGridDbSettings preferences={preferences} onChange={updatePreferences} Toggle={SettingsToggle} />
			</div>

			<FactoryResetSection onResetComplete={() => window.dispatchEvent(new Event('gdl:shortcuts-changed'))} />
		</div>
	);
};
