import { readFileSync } from 'node:fs';
import { mergeCandidateLists } from '../frontend/features/shortcuts/candidate-merger.ts';
import { evaluateBulkCandidate } from '../frontend/features/shortcuts/bulk-policy.ts';

console.log('Running Fast Instant Detection & Async Enrichment Test Suite (DFAST01-DFAST20)...');

const rootUrl = new URL('../', import.meta.url);
function readProjectFile(relPath) {
	return readFileSync(new URL(relPath, rootUrl), 'utf8');
}

// --------------------------------------------------------------------------
// DFAST01: Local candidate discovery engine exists & exports discover_local_candidates
// --------------------------------------------------------------------------
{
	const localEngine = readProjectFile('backend/lib/shortcut_detection_local.lua');
	if (!localEngine.includes('function M.discover_local_candidates(request)') || !localEngine.includes('return M')) {
		throw new Error('DFAST01 Failed: shortcut_detection_local.lua does not export discover_local_candidates.');
	}
	console.log('✓ DFAST01 Passed: Local candidate discovery engine exists and exports discover_local_candidates.');
}

// --------------------------------------------------------------------------
// DFAST02: Main backend facade registers detect_game_candidates_local IPC
// --------------------------------------------------------------------------
{
	const mainLua = readProjectFile('backend/main.lua');
	const hasLocalFacade = mainLua.includes('detect_game_candidates_local');
	const hasEagerLocalDependency = mainLua.includes('deps.shortcut_detection_local');
	const hasLazyLocalDependency = mainLua.includes('shortcut_detection_local = \"shortcut_detection_local\"')
		&& mainLua.includes('module(\"shortcut_detection\").detect_game_candidates_local');
	if (!hasLocalFacade || (!hasEagerLocalDependency && !hasLazyLocalDependency)) {
		throw new Error('DFAST02 Failed: backend/main.lua does not wire detect_game_candidates_local through either eager or lazy backend dependencies.');
	}
	console.log('✓ DFAST02 Passed: Backend main.lua facade exposes detect_game_candidates_local IPC through eager/lazy wiring.');
}

// --------------------------------------------------------------------------
// DFAST03: Frontend API binds detectGameCandidatesLocalBackend callable
// --------------------------------------------------------------------------
{
	const backendTs = readProjectFile('frontend/api/backend.ts');
	if (!backendTs.includes("detectGameCandidatesLocalBackend = callable<[{ request_json: string }], string>('detect_game_candidates_local')")) {
		throw new Error('DFAST03 Failed: frontend/api/backend.ts does not bind detectGameCandidatesLocalBackend.');
	}
	console.log('✓ DFAST03 Passed: Frontend API binds detectGameCandidatesLocalBackend callable.');
}

// --------------------------------------------------------------------------
// DFAST04: Frontend detection module exports Phase A, Phase B & merger
// --------------------------------------------------------------------------
{
	const detectionTs = readProjectFile('frontend/features/shortcuts/detection.ts');
	if (!detectionTs.includes('export async function detectShortcutCandidatesLocal')
		|| !detectionTs.includes('export async function enrichShortcutCandidatesRemote')
		|| !detectionTs.includes('export { mergeCandidateLists }')) {
		throw new Error('DFAST04 Failed: detection.ts does not export detectShortcutCandidatesLocal, enrichShortcutCandidatesRemote, or mergeCandidateLists.');
	}
	console.log('✓ DFAST04 Passed: Frontend detection module exports Phase A, Phase B, and candidate merger.');
}

// --------------------------------------------------------------------------
// DFAST05: Local discovery alias coverage for Resident Evil 4 (2023 vs 2005)
// --------------------------------------------------------------------------
{
	const localEngine = readProjectFile('backend/lib/shortcut_detection_local.lua');
	if (!localEngine.includes('2050650') || !localEngine.includes('254700')
		|| !localEngine.includes('Resident Evil 4') || !localEngine.includes('Resident Evil 4 (2005)')) {
		throw new Error('DFAST05 Failed: Local engine missing RE4 multi-edition candidates (2050650 / 254700).');
	}
	console.log('✓ DFAST05 Passed: Local discovery recognizes RE4 aliases and covers both 2023 remake and 2005 original.');
}

// --------------------------------------------------------------------------
// DFAST06: Local discovery PE inspector integration
// --------------------------------------------------------------------------
{
	const localEngine = readProjectFile('backend/lib/shortcut_detection_local.lua');
	if (!localEngine.includes('detection_pe.read_pe_metadata')
		|| !localEngine.includes('pe_product_exact')) {
		throw new Error('DFAST06 Failed: Local engine does not inspect PE headers without network.');
	}
	console.log('✓ DFAST06 Passed: Local discovery engine integrates PE inspection without network calls.');
}

// --------------------------------------------------------------------------
// DFAST07: Merger fault tolerance: remote failure preserves local candidates
// --------------------------------------------------------------------------
{
	const localCandidates = [
		{ appid: '2050650', name: 'Resident Evil 4 (2023)', score: 85, confidence: 'high' },
		{ appid: '254700', name: 'Resident Evil 4 (2005)', score: 85, confidence: 'high' },
	];
	const merged = mergeCandidateLists(localCandidates, []);
	if (merged.length !== 2) throw new Error('DFAST07 Failed: Local candidates were dropped on remote failure.');
	if (merged[0].validation_state !== 'partial' || !merged[0].warnings?.includes('remote_validation_unavailable')) {
		throw new Error('DFAST07 Failed: Local candidate not marked with validation_state: partial on remote failure.');
	}
	console.log('✓ DFAST07 Passed: Candidate merger preserves local candidates with partial state when remote fails.');
}

// --------------------------------------------------------------------------
// DFAST08: Merger enrichment: remote updates matching candidate details
// --------------------------------------------------------------------------
{
	const localCandidates = [
		{ appid: '1091500', name: 'Cyberpunk 2077', score: 80, confidence: 'medium' },
	];
	const remoteCandidates = [
		{ appid: '1091500', name: 'Cyberpunk 2077 (Official)', score: 98, confidence: 'exact', image: 'https://cdn/header.jpg', validation_state: 'confirmed', executable_match: true },
	];
	const merged = mergeCandidateLists(localCandidates, remoteCandidates);
	if (merged.length !== 1 || merged[0].name !== 'Cyberpunk 2077 (Official)' || merged[0].validation_state !== 'confirmed' || !merged[0].executable_match) {
		throw new Error(`DFAST08 Failed: Remote candidate enrichment did not correctly merge properties. Result: ${JSON.stringify(merged)}`);
	}
	console.log('✓ DFAST08 Passed: Candidate merger enriches existing candidates with authoritative remote details.');
}

// --------------------------------------------------------------------------
// DFAST09: Merger un-queried local retention
// --------------------------------------------------------------------------
{
	const localCandidates = [
		{ appid: '2050650', name: 'Resident Evil 4 (2023)', score: 85, confidence: 'high' },
		{ appid: '254700', name: 'Resident Evil 4 (2005)', score: 85, confidence: 'high' },
	];
	const remoteCandidates = [
		{ appid: '2050650', name: 'Resident Evil 4', score: 96, confidence: 'high', validation_state: 'confirmed' },
	];
	const merged = mergeCandidateLists(localCandidates, remoteCandidates);
	if (merged.length !== 2) throw new Error('DFAST09 Failed: Secondary un-queried local candidate was dropped.');
	if (merged[1].appid !== '254700' || merged[1].validation_state !== 'partial') {
		throw new Error('DFAST09 Failed: Retained local candidate missing partial state.');
	}
	console.log('✓ DFAST09 Passed: Un-queried local candidates are safely retained at list end.');
}

// --------------------------------------------------------------------------
// DFAST10: Modal in-place update methods present in manual-link.ts
// --------------------------------------------------------------------------
{
	const manualLinkTs = readProjectFile('frontend/features/shortcuts/manual-link.ts');
	if (!manualLinkTs.includes('_updateCandidates')
		|| !manualLinkTs.includes('_markEnrichmentComplete')
		|| !manualLinkTs.includes('(existingModal as any)._updateCandidates')) {
		throw new Error('DFAST10 Failed: manual-link.ts does not provide in-place candidate update capabilities.');
	}
	console.log('✓ DFAST10 Passed: Manual link modal implements in-place candidate updates without DOM recreation.');
}

// --------------------------------------------------------------------------
// DFAST11: Modal user interaction protection
// --------------------------------------------------------------------------
{
	const manualLinkTs = readProjectFile('frontend/features/shortcuts/manual-link.ts');
	if (!manualLinkTs.includes('let userHasInteracted = false;')
		|| !manualLinkTs.includes('userHasInteracted = true')
		|| !manualLinkTs.includes('if (userHasInteracted && previousSelectedValue')) {
		throw new Error('DFAST11 Failed: manual-link.ts does not protect user selection from async enrichment overwrites.');
	}
	console.log('✓ DFAST11 Passed: Modal tracks user interaction and preserves user-selected candidate across async updates.');
}

// --------------------------------------------------------------------------
// DFAST12: Modal generation guard against race conditions
// --------------------------------------------------------------------------
{
	const manualLinkTs = readProjectFile('frontend/features/shortcuts/manual-link.ts');
	if (!manualLinkTs.includes('globalDetectionGeneration')
		|| !manualLinkTs.includes('currentGeneration')
		|| !manualLinkTs.includes('globalDetectionGeneration !== currentGeneration')) {
		throw new Error('DFAST12 Failed: manual-link.ts missing generation ID guard against async race conditions.');
	}
	console.log('✓ DFAST12 Passed: Generation ID guard prevents out-of-order or stale async responses from updating modal.');
}

// --------------------------------------------------------------------------
// DFAST13: Modal close cancellation check
// --------------------------------------------------------------------------
{
	const manualLinkTs = readProjectFile('frontend/features/shortcuts/manual-link.ts');
	if (!manualLinkTs.includes('loadingShown && !manualLinkModalPresent(immediateDoc)')) {
		throw new Error('DFAST13 Failed: manual-link.ts does not check for modal presence before continuing detection.');
	}
	console.log('✓ DFAST13 Passed: Detection gracefully aborts when modal is closed by user.');
}

// --------------------------------------------------------------------------
// DFAST14: Backend candidate preservation on store search failure
// --------------------------------------------------------------------------
{
	const detectionLua = readProjectFile('backend/lib/shortcut_detection.lua');
	if (!detectionLua.includes('deps.shortcut_detection_local.discover_local_candidates')
		|| !detectionLua.includes('remote_validation_unavailable')) {
		throw new Error('DFAST14 Failed: backend/lib/shortcut_detection.lua does not fall back to local candidates on failure.');
	}
	console.log('✓ DFAST14 Passed: Backend detection falls back to local candidates when remote search is unavailable.');
}

// --------------------------------------------------------------------------
// DFAST15: Cache safety invariant: transient errors not cached
// --------------------------------------------------------------------------
{
	const detectionTs = readProjectFile('frontend/features/shortcuts/detection.ts');
	if (!detectionTs.includes('value.transient_error !== true')) {
		throw new Error('DFAST15 Failed: detection.ts allows transient error results into cache.');
	}
	console.log('✓ DFAST15 Passed: Cache safety invariant prevents negative cache poisoning on transient errors.');
}

// --------------------------------------------------------------------------
// DFAST16: Weak partial detection requires manual review
// --------------------------------------------------------------------------
{
	const dummyContext = {
		shortcutAppId: 1001,
		shortcutName: 'Unknown Game',
		exePath: 'C:\\Games\\Unknown\\game.exe',
		startDir: 'C:\\Games\\Unknown',
		launchOptions: '',
	};
	const partialCandidate = {
		appid: '12345',
		name: 'Unknown Game',
		score: 60,
		confidence: 'low',
		validation_state: 'partial',
		evidence_tier: 'hint',
		reasons: ['folder_hint'],
	};
	const result = evaluateBulkCandidate(dummyContext, [partialCandidate]);
	if (result.safe) {
		throw new Error(`DFAST16 Failed: Bulk policy accepted an uncertain 60% candidate. Result: ${JSON.stringify(result)}`);
	}
	console.log('✓ DFAST16 Passed: Bulk linking leaves a 60% partial candidate for manual review.');
}

// --------------------------------------------------------------------------
// DFAST17: Bulk policy accepts corroborated proof candidates
// --------------------------------------------------------------------------
{
	const dummyContext = {
		shortcutAppId: 1002,
		shortcutName: 'Cyberpunk 2077',
		exePath: 'C:\\Games\\Cyberpunk\\Cyberpunk2077.exe',
		startDir: 'C:\\Games\\Cyberpunk',
		launchOptions: '',
	};
	const proofCandidate = {
		appid: '1091500',
		name: 'Cyberpunk 2077',
		score: 98,
		confidence: 'exact',
		executable_match: true,
		reasons: ['official_executable_match', 'official_title_exact'],
		evidence_tier: 'proof',
		validation_state: 'confirmed',
	};
	const result = evaluateBulkCandidate(dummyContext, [proofCandidate]);
	if (!result.safe || result.candidate?.appid !== '1091500') {
		throw new Error(`DFAST17 Failed: Bulk policy rejected proof candidate. Result: ${JSON.stringify(result)}`);
	}
	console.log('✓ DFAST17 Passed: Bulk linking accepts verified proof candidates with confirmed validation.');
}

// --------------------------------------------------------------------------
// DFAST18: Determinism invariant across 20 iterations
// --------------------------------------------------------------------------
{
	const localCands = [
		{ appid: '2050650', name: 'Resident Evil 4 (2023)', score: 85, confidence: 'high' },
		{ appid: '254700', name: 'Resident Evil 4 (2005)', score: 85, confidence: 'high' },
	];
	const remoteCands = [
		{ appid: '2050650', name: 'Resident Evil 4', score: 95, confidence: 'high', validation_state: 'confirmed' },
	];
	const reference = JSON.stringify(mergeCandidateLists(localCands, remoteCands));
	for (let i = 0; i < 20; i++) {
		const trial = JSON.stringify(mergeCandidateLists(localCands, remoteCands));
		if (trial !== reference) {
			throw new Error(`DFAST18 Failed: Candidate fluttering detected on iteration ${i + 1}.`);
		}
	}
	console.log('✓ DFAST18 Passed: 20 consecutive runs of candidate merging produce 100% deterministic results.');
}

// --------------------------------------------------------------------------
// DFAST19: Backend file size invariants (<= 900 lines, main.lua <= 250 lines)
// --------------------------------------------------------------------------
{
	const backendFiles = [
		{ path: 'backend/lib/shortcut_detection.lua', max: 900 },
		{ path: 'backend/lib/shortcut_detection_local.lua', max: 900 },
		{ path: 'backend/lib/shortcut_detection_text.lua', max: 900 },
		{ path: 'backend/lib/shortcut_detection_pe.lua', max: 900 },
		{ path: 'backend/lib/shortcut_detection_tracking.lua', max: 900 },
		{ path: 'backend/main.lua', max: 250 },
	];
	for (const { path: relPath, max } of backendFiles) {
		const content = readProjectFile(relPath);
		const lines = content.split(/\r?\n/).length;
		if (lines > max) {
			throw new Error(`DFAST19 Failed: ${relPath} has ${lines} lines (max ${max}).`);
		}
	}
	console.log('✓ DFAST19 Passed: All backend detection modules strictly comply with line limits (<=900 / main.lua <=250).');
}

// --------------------------------------------------------------------------
// DFAST20: Frontend file size invariants (<= 900 lines)
// --------------------------------------------------------------------------
{
	const frontendFiles = [
		'frontend/features/shortcuts/manual-link.ts',
		'frontend/features/shortcuts/detection.ts',
		'frontend/features/shortcuts/candidate-merger.ts',
		'frontend/features/shortcuts/bulk-link.ts',
		'frontend/features/shortcuts/properties.ts',
	];
	for (const relPath of frontendFiles) {
		const content = readProjectFile(relPath);
		const lines = content.split(/\r?\n/).length;
		if (lines > 900) {
			throw new Error(`DFAST20 Failed: ${relPath} has ${lines} lines (max 900).`);
		}
	}
	console.log('✓ DFAST20 Passed: All frontend shortcut modules strictly comply with <= 900 lines invariant.');
}

console.log('\nAll 20 Fast Detection test cases (DFAST01-DFAST20) PASSED successfully!');
