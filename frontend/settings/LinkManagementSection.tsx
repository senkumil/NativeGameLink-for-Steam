import React from 'react';
import { gdlText, loc } from '../steam/localization';
import { backendLog } from '../api/backend';
import type { GdlPreferences } from '../core/preferences';
import {
	getCommittedShortcutSteamAppId,
	hasPendingLinkJob,
	getAllShortcutRecords,
	linkAllShortcutsExperimental,
	requestManualShortcutLink,
	unlinkAllShortcutsFromSteam,
	unlinkShortcutFromSteam,
} from '../features/shortcuts/runtime';
import {
	getBulkLinkState,
	setBulkLinkState,
	subscribeBulkLinkState,
} from '../features/shortcuts/bulk-link-state';
import { subscribeMappings } from '../core/mappings';

export interface LinkManagementToggleProps {
	checked: boolean;
	disabled?: boolean;
	label: string;
	onChange: (checked: boolean) => void;
}

export interface LinkManagementSectionProps {
	preferences: GdlPreferences;
	onChange: (patch: Partial<GdlPreferences>) => void;
	Toggle: React.ComponentType<LinkManagementToggleProps>;
}

function bulkLinkReasonLabel(reason: string | undefined): string {
	switch (String(reason || '')) {
		case 'ambiguous_or_low_confidence':
		case 'identity_needs_review':
		case 'close_candidates_need_review':
		case 'shortcut_identity_ambiguous':
		case 'ambiguous_close_runner_up':
		case 'unresolved_identity_collision':
		case 'unverified_alias':
			return gdlText('bulk_link_reason_ambiguous', 'No sufficiently reliable match was found.');
		case 'no_candidates':
			return gdlText('bulk_link_reason_no_candidates', 'No Steam candidates were found.');
		case 'insufficient_confidence':
		case 'below_bulk_score_threshold':
		case 'insufficient_identity_evidence':
		case 'unverified_steam_appid_file':
		case 'folder_only_insufficient':
		case 'generic_executable_insufficient':
			return gdlText('bulk_link_reason_evidence', 'The match needs one more identity signal before automatic linking.');
		case 'contradictory_evidence':
			return gdlText('bulk_link_reason_conflict', 'Conflicting identity evidence was detected.');
		case 'context_unavailable':
			return gdlText('bulk_link_reason_context', 'The shortcut information could not be read.');
		case 'detection_failed':
			return gdlText('bulk_link_reason_detection', 'Candidate detection failed.');
		case 'invalid_appid':
			return gdlText('bulk_link_reason_invalid_appid', 'The detected Steam AppID was invalid.');
		case 'refusing_to_modify_native_steam_app':
			return gdlText('bulk_link_reason_native', 'The entry was not recognized as a non-Steam shortcut.');
		case 'canonical_data_unavailable':
		case 'setup_incomplete':
			return gdlText('bulk_link_reason_incomplete', 'The link could not finish all required resources.');
		default:
			return gdlText('bulk_link_reason_failed', 'The link could not be completed.');
	}
}

export const LinkManagementSection: React.FC<LinkManagementSectionProps> = ({ preferences, onChange, Toggle }) => {
	const [shortcutRevision, setShortcutRevision] = React.useState(0);
	const [shortcutActionStatus, setShortcutActionStatus] = React.useState<{ text: string; color: string } | null>(null);
	const [bulkLinkGlobal, setBulkLinkGlobal] = React.useState(() => getBulkLinkState());
	React.useEffect(() => subscribeBulkLinkState(setBulkLinkGlobal), []);

	const shortcutActionBusy = bulkLinkGlobal.busy;
	const bulkLinkProgress = bulkLinkGlobal.progress;
	const bulkLinkReport = bulkLinkGlobal.report;

	React.useEffect(() => {
		const refresh = (): void => setShortcutRevision(value => value + 1);
		const unsubscribeMappings = subscribeMappings(refresh);
		const onVisible = (): void => { if (!document.hidden) refresh(); };
		window.addEventListener('gdl:shortcuts-changed', refresh);
		window.addEventListener('gdl:pending-link-jobs-changed', refresh);
		window.addEventListener('focus', refresh);
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			unsubscribeMappings();
			window.removeEventListener('gdl:shortcuts-changed', refresh);
			window.removeEventListener('gdl:pending-link-jobs-changed', refresh);
			window.removeEventListener('focus', refresh);
			document.removeEventListener('visibilitychange', onVisible);
		};
	}, []);

	const shortcutRows = React.useMemo(() => getAllShortcutRecords()
		.map(record => ({
			id: record.id,
			title: record.title,
			steamAppId: String(getCommittedShortcutSteamAppId(record.id) || ''),
		}))
		.sort((a, b) => a.title.localeCompare(b.title)), [shortcutRevision]);
	const linkedShortcutCount = shortcutRows.filter(row => /^\d+$/.test(row.steamAppId)).length;
	const bulkNotLinked = bulkLinkReport?.outcomes.filter(item =>
		item.status === 'skipped' || item.status === 'failed' || item.status === 'SKIPPED' || item.status === 'FAILED') || [];
	const bulkQueued = bulkLinkReport?.outcomes.filter(item =>
		(item.status === 'queued' || item.status === 'RETRY_PENDING' || item.resourceRepairQueued)
		&& hasPendingLinkJob(item.shortcutAppId, item.title)) || [];

	const dynamicBulkLinkStatus = React.useMemo(() => {
		if (!bulkLinkGlobal.status) return null;
		if (bulkLinkGlobal.busy === 'bulk-link') return bulkLinkGlobal.status;
		if (!bulkLinkReport) return bulkLinkGlobal.status;
		if (bulkLinkReport.total === 0) {
			return { text: gdlText('bulk_link_none', 'There are no unlinked games to review.'), color: '#8f98a0' };
		}
		const pendingCount = bulkQueued.length;
		const notLinkedCount = bulkNotLinked.length;
		const totalConsidered = bulkLinkReport.total;
		const successfullyLinkedCount = Math.max(0, totalConsidered - notLinkedCount);

		if (notLinkedCount === 0) {
			if (pendingCount > 0) {
				return {
					text: gdlText('bulk_link_success_pending', 'Bulk linking completed: {linked} of {total} linked ({pending} downloading artwork in background).', {
						linked: String(successfullyLinkedCount),
						total: String(totalConsidered),
						pending: String(pendingCount),
					}),
					color: '#59bf40',
				};
			}
			return {
				text: gdlText('bulk_link_all_success', 'Bulk linking completed: all {total} game(s) linked successfully.', {
					total: String(totalConsidered),
				}),
				color: '#59bf40',
			};
		}
		return {
			text: gdlText('bulk_link_result', 'Bulk link completed: {linked} linked, {queued} in background, {skipped} ambiguous skipped, {failed} failed.', {
				linked: String(successfullyLinkedCount - pendingCount),
				queued: String(pendingCount),
				skipped: String(bulkLinkReport.skipped),
				failed: String(bulkLinkReport.failed),
			}),
			color: '#d6b25e',
		};
	}, [bulkLinkGlobal.status, bulkLinkGlobal.busy, bulkLinkReport, bulkQueued.length, bulkNotLinked.length]);

	const cancelBulkLink = (): void => {
		const current = getBulkLinkState();
		if (current.abortController) {
			current.abortController.abort();
		}
		setBulkLinkState({
			busy: '',
			abortController: null,
			progress: null,
			status: {
				text: gdlText('bulk_link_cancelled', 'Bulk linking cancelled.'),
				color: '#8f98a0',
			},
		});
		setShortcutRevision(value => value + 1);
	};

	const linkAllShortcuts = async (): Promise<void> => {
		if (shortcutActionBusy) return;
		const abortController = new AbortController();
		setBulkLinkState({
			busy: 'bulk-link',
			abortController,
			report: null,
			progress: null,
			status: { text: gdlText('bulk_link_running', 'Analyzing and linking high-confidence matches...'), color: '#66c0f4' },
		});
		setShortcutActionStatus(null);
		try {
			const result = await linkAllShortcutsExperimental((done, total, title, phase) => {
				if (abortController.signal.aborted) return;
				const text = phase === 'analyzing'
					? gdlText('bulk_link_analyzing_progress', 'Analyzing {done}/{total}: {game}', { done: String(done), total: String(total), game: title })
					: phase === 'resources'
						? gdlText('bulk_link_resources_progress', 'Applying resources {done}/{total}: {game}', { done: String(done), total: String(total), game: title })
						: gdlText('bulk_link_progress', 'Linking {done}/{total}: {game}', { done: String(done), total: String(total), game: title });
				setBulkLinkState({
					progress: { phase, done, total, title },
					status: { text, color: '#66c0f4' },
				});
			}, abortController.signal);
			if (abortController.signal.aborted) return;
			setShortcutRevision(value => value + 1);
			const finishedStatus = result.total === 0
				? { text: gdlText('bulk_link_none', 'There are no unlinked games to review.'), color: '#8f98a0' }
				: {
					text: gdlText('bulk_link_result', 'Bulk link finished: {linked} linked, {queued} in background, {skipped} ambiguous skipped, {failed} failed.', {
						linked: String(result.linked), queued: String(result.queued), skipped: String(result.skipped), failed: String(result.failed),
					}),
					color: result.failed > 0 || result.skipped > 0 ? '#d6b25e' : '#59bf40',
				};
			setBulkLinkState({
				busy: '',
				abortController: null,
				progress: null,
				report: result,
				status: finishedStatus,
			});
		} catch (error) {
			if (abortController.signal.aborted) return;
			backendLog('Experimental bulk link failed: ' + String(error));
			setBulkLinkState({
				busy: '',
				abortController: null,
				progress: null,
				status: { text: gdlText('bulk_link_failed', 'Bulk linking could not be completed.'), color: '#d94126' },
			});
		} finally {
			if (getBulkLinkState().abortController === abortController) {
				setBulkLinkState({ busy: '', abortController: null });
			}
		}
	};

	const unlinkAllShortcuts = async (): Promise<void> => {
		if (shortcutActionBusy) return;
		setBulkLinkState({ progress: null, status: null, report: null });
		setShortcutActionStatus({
			text: gdlText('bulk_unlink_success', 'All linked games were unlinked. Automatic prompts remain suppressed until you explicitly link again.'),
			color: '#59bf40',
		});
		setShortcutRevision(value => value + 1);

		void (async () => {
			try {
				const result = await unlinkAllShortcutsFromSteam();
				setShortcutRevision(value => value + 1);
				if (!result.ok) {
					setShortcutActionStatus({
						text: gdlText('bulk_unlink_partial', 'Some games could not be unlinked ({failed} failed).', { failed: String(result.failed) }),
						color: '#d6b25e',
					});
				}
			} catch (error) {
				backendLog('Bulk unlink failed: ' + String(error));
				setShortcutActionStatus({ text: gdlText('bulk_unlink_failed', 'Could not unlink all games.'), color: '#d94126' });
			}
		})();
	};

	const unlinkOneShortcut = async (row: { id: number; title: string; steamAppId: string }): Promise<void> => {
		if (shortcutActionBusy) return;
		setShortcutRevision(value => value + 1);
		setShortcutActionStatus({
			text: gdlText('settings_unlink_one_success', 'Unlinked: {game}', { game: row.title }),
			color: '#59bf40',
		});
		void (async () => {
			try {
				const result = await unlinkShortcutFromSteam({ shortcutAppId: row.id, title: row.title, steamAppId: row.steamAppId || undefined, clearIcon: true });
				setShortcutRevision(value => value + 1);
				if (!result.ok) {
					setShortcutActionStatus({
						text: gdlText('settings_unlink_one_failed', 'Could not unlink: {game}', { game: row.title }),
						color: '#d94126',
					});
				}
			} catch (error) {
				backendLog('Single unlink failed: ' + String(error));
			}
		})();
	};

	return (
		<div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,.08)' }}>
			<div style={{ padding: '11px 12px', background: 'rgba(229,173,55,.07)', border: '1px solid rgba(229,173,55,.28)', borderRadius: '4px' }}>
				<div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
					<div style={{ fontWeight: 600, color: '#e5c07b', fontSize: '13px' }}>
						{gdlText('link_management_title', 'Game link management')}
					</div>
					<span style={{ padding: '1px 6px', fontSize: '10px', fontWeight: 700, borderRadius: '3px', background: 'rgba(229,173,55,0.2)', color: '#e5c07b', letterSpacing: '0.5px' }}>
						{gdlText('experimental_badge', 'EXPERIMENTAL')}
					</span>
				</div>
				<div style={{ color: '#9da4ab', fontSize: '11.3px', lineHeight: 1.45 }}>
					{gdlText('experimental_description', 'These tools prioritize safety: bulk linking skips ambiguous matches, and automatic review can only run after Steam’s native Add a Non-Steam Game dialog closes.')}
				</div>

				<div style={{ marginTop: '10px', padding: '10px 11px', background: 'rgba(20,29,42,.75)', border: '1px solid rgba(255,255,255,.08)', borderRadius: '3px' }}>
					<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
						<div>
							<div style={{ color: '#8f98a0', fontSize: '11.5px' }}>
								{gdlText('link_management_summary', '{linked} of {total} non-Steam game(s) are linked.', { linked: String(linkedShortcutCount), total: String(shortcutRows.length) })}
							</div>
						</div>
						<div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap' }}>
							{shortcutActionBusy === 'bulk-link' ? (
								<button
									type="button"
									onClick={(): void => { cancelBulkLink(); }}
									style={{
										padding: '6px 12px',
										color: '#fff',
										background: '#d94126',
										border: 0,
										borderRadius: '2px',
										cursor: 'pointer',
										fontSize: '11.5px',
										fontWeight: 600,
									}}
								>
									{gdlText('cancel', loc('Button_Cancel', 'Cancel'))}
								</button>
							) : (
								<>
									<button
										type="button"
										disabled={Boolean(shortcutActionBusy) || shortcutRows.length === 0 || shortcutRows.length === linkedShortcutCount}
										onClick={(): void => { void linkAllShortcuts(); }}
										style={{
											padding: '6px 10px',
											color: '#fff',
											background: (shortcutActionBusy || shortcutRows.length === 0 || shortcutRows.length === linkedShortcutCount)
												? '#3d4450'
												: 'linear-gradient(90deg,#06bfff,#2d73ff)',
											border: 0,
											borderRadius: '2px',
											cursor: (shortcutActionBusy || shortcutRows.length === 0 || shortcutRows.length === linkedShortcutCount) ? 'default' : 'pointer',
											fontSize: '11.5px',
											fontWeight: 500,
										}}
									>
										{gdlText('link_all_button', 'Link all')}
									</button>
									<button
										type="button"
										disabled={Boolean(shortcutActionBusy) || shortcutRows.length === 0 || linkedShortcutCount === 0}
										onClick={(): void => { void unlinkAllShortcuts(); }}
										style={{
											padding: '6px 10px',
											color: '#dcdedf',
											background: '#3d4450',
											border: 0,
											borderRadius: '2px',
											cursor: (shortcutActionBusy || shortcutRows.length === 0 || linkedShortcutCount === 0) ? 'default' : 'pointer',
											fontSize: '11.5px',
										}}
									>
										{shortcutActionBusy === 'all' ? gdlText('bulk_unlinking_short', 'Unlinking...') : gdlText('unlink_all_button', 'Unlink all')}
									</button>
								</>
							)}
						</div>
					</div>
					{shortcutActionStatus && <div style={{ marginTop: '8px', color: shortcutActionStatus.color, fontSize: '11.5px' }}>{shortcutActionStatus.text}</div>}
					{dynamicBulkLinkStatus && shortcutActionBusy !== 'bulk-link' && <div style={{ marginTop: '8px', color: dynamicBulkLinkStatus.color, fontSize: '11.5px', lineHeight: 1.4 }}>{dynamicBulkLinkStatus.text}</div>}
					{bulkLinkProgress && shortcutActionBusy === 'bulk-link' && (
						<div style={{ marginTop: '9px' }}>
							<div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', color: '#c6d4df', fontSize: '11px' }}>
								<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
									{bulkLinkProgress.phase === 'analyzing'
										? gdlText('bulk_link_analyzing_game', 'Analyzing: {game}', { game: bulkLinkProgress.title })
										: bulkLinkProgress.phase === 'resources'
											? gdlText('bulk_link_resources_game', 'Applying resources: {game}', { game: bulkLinkProgress.title })
											: gdlText('bulk_link_linking_game', 'Linking: {game}', { game: bulkLinkProgress.title })}
								</span>
								<strong style={{ flex: '0 0 auto', color: '#66c0f4' }}>{bulkLinkProgress.done}/{bulkLinkProgress.total}</strong>
							</div>
							<div style={{ height: '4px', marginTop: '6px', background: 'rgba(255,255,255,.08)', borderRadius: '2px', overflow: 'hidden' }}>
								<div style={{
									height: '100%',
									width: `${((): number => {
										if (bulkLinkProgress.total <= 0) return 0;
										const phaseProgress = Math.min(1, bulkLinkProgress.done / bulkLinkProgress.total);
										if (bulkLinkProgress.phase === 'analyzing') return phaseProgress * 33.333;
										if (bulkLinkProgress.phase === 'linking') return 33.333 + phaseProgress * 33.333;
										return 66.666 + phaseProgress * 33.334;
									})()}%`,
									background: '#1a9fff',
									transition: 'width .18s ease',
								}} />
							</div>
						</div>
					)}
					{bulkNotLinked.length > 0 && (
						<div style={{ marginTop: '9px', padding: '8px 9px', background: 'rgba(217,65,38,.07)', border: '1px solid rgba(217,65,38,.18)', borderRadius: '2px' }}>
							<div style={{ color: '#e7b39f', fontWeight: 600, fontSize: '11px' }}>
								{gdlText('bulk_link_not_linked_title', 'Could not be linked ({count})', { count: String(bulkNotLinked.length) })}
							</div>
							<div style={{ marginTop: '5px', maxHeight: '130px', overflowY: 'auto' }}>
								{bulkNotLinked.map(item => (
									<div key={`${item.shortcutAppId}:${item.status}`} style={{ padding: '4px 0', borderTop: '1px solid rgba(255,255,255,.045)' }}>
										<div style={{ color: '#dcdedf', fontSize: '10.8px' }}>{item.title}</div>
										<div style={{ marginTop: '1px', color: '#8f98a0', fontSize: '10.2px' }}>{bulkLinkReasonLabel(item.reason)}</div>
									</div>
								))}
							</div>
						</div>
					)}
					{bulkQueued.length > 0 && (
						<div style={{ marginTop: '7px', color: '#d6b25e', fontSize: '10.8px', lineHeight: 1.4 }}>
							{gdlText('bulk_link_retrying_games', 'Still completing in the background ({count}): {games}', {
								count: String(bulkQueued.length), games: bulkQueued.map(item => item.title).join(', '),
							})}
						</div>
					)}
					<div style={{ marginTop: '9px', maxHeight: '250px', overflowY: 'auto', borderTop: '1px solid rgba(255,255,255,.07)' }}>
						{shortcutRows.length === 0 ? (
							<div style={{ padding: '9px 0 2px', color: '#8f98a0', fontSize: '11.5px' }}>{gdlText('link_management_empty', 'No non-Steam games are currently available.')}</div>
						) : shortcutRows.map(row => {
							const linked = /^\d+$/.test(row.steamAppId);
							const busy = shortcutActionBusy === String(row.id);
							return (
								<div key={row.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,.055)' }}>
									<div style={{ minWidth: 0, flex: 1 }}>
										<div title={row.title} style={{ color: '#dcdedf', fontSize: '11.8px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.title}</div>
										<div style={{ marginTop: '2px', color: linked ? '#59bf40' : '#8f98a0', fontSize: '10.8px' }}>
											{linked ? gdlText('game_linked_appid', 'Linked · Steam AppID {appid}', { appid: row.steamAppId }) : gdlText('game_unlinked_status', 'Unlinked')}
										</div>
									</div>
									{linked ? (
										<button
											type="button"
											disabled={Boolean(shortcutActionBusy)}
											onClick={(): void => { void unlinkOneShortcut(row); }}
											style={{ flex: '0 0 auto', padding: '5px 9px', color: '#dcdedf', background: '#3d4450', border: 0, borderRadius: '2px', cursor: shortcutActionBusy ? 'default' : 'pointer', fontSize: '11px' }}
										>
											{busy ? gdlText('bulk_unlinking_short', 'Unlinking...') : gdlText('unlink', 'Unlink')}
										</button>
									) : (
										<button
											type="button"
											disabled={Boolean(shortcutActionBusy)}
											onClick={(): void => {
												const opened = requestManualShortcutLink(row.id, row.title);
												setShortcutActionStatus({
													text: opened ? gdlText('manual_link_review_started', 'Link review opened for {game}.', { game: row.title }) : gdlText('manual_link_review_failed', 'Could not start link review for {game}.', { game: row.title }),
													color: opened ? '#66c0f4' : '#d94126',
												});
											}}
											style={{ flex: '0 0 auto', padding: '5px 9px', color: '#fff', background: 'linear-gradient(90deg,#06bfff,#2d73ff)', border: 0, borderRadius: '2px', cursor: shortcutActionBusy ? 'default' : 'pointer', fontSize: '11px' }}
										>
											{gdlText('link_button', 'Link')}
										</button>
									)}
								</div>
							);
						})}
					</div>

					<div style={{ marginTop: '10px', paddingTop: '9px', borderTop: '1px solid rgba(229,173,55,.18)' }}>
						<div style={{ fontWeight: 600, color: '#dcdedf', fontSize: '11.8px' }}>{gdlText('auto_detect_title', 'Native add-game detection')}</div>
						<div style={{ marginTop: '3px', color: '#8f98a0', fontSize: '11px', lineHeight: 1.4 }}>{gdlText('auto_detect_native_add_description', 'Only watches the session created by Steam’s Add a Non-Steam Game dialog. Startup, navigation, language changes and unlinking can never trigger this prompt.')}</div>
						<div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '8px' }}>
							<Toggle checked={preferences.autoDetectShortcuts} onChange={checked => onChange({ autoDetectShortcuts: checked })} label={gdlText('auto_detect_shortcuts_toggle', 'Suggest linking only after adding a game through Steam’s native Add a Non-Steam Game dialog')} />
							<span style={{ flex: 1, minWidth: 0, fontSize: '11.5px', color: '#c6d4df', lineHeight: 1.4 }}>{gdlText('auto_detect_shortcuts_toggle', 'Suggest linking only after adding a game through Steam’s native Add a Non-Steam Game dialog')}</span>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
};
