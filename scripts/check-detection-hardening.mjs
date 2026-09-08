import { readFileSync } from 'node:fs';
import { evaluateBulkCandidate } from '../frontend/features/shortcuts/bulk-policy.ts';

const dummyContext = {
	shortcutAppId: 1001,
	shortcutName: 'Test Game',
	exePath: 'C:\\Games\\Test\\game.exe',
	startDir: 'C:\\Games\\Test',
	launchOptions: '',
};

console.log('Running Shortcut Detection Hardening Test Suite (D01-D20)...');

// Helper to create candidates
function createCandidate(overrides = {}) {
	return {
		appid: '100',
		name: 'Test Game',
		score: 90,
		confidence: 'high',
		reasons: ['title_exact'],
		source: 'search',
		evidence_tier: 'strong',
		validation_state: 'confirmed',
		...overrides,
	};
}

// --------------------------------------------------------------------------
// D01: Cyberpunk 2077 (Cyberpunk2077.exe) -> Proof, Manual #1 HIGH, Bulk accepts
// --------------------------------------------------------------------------
{
	const cpCandidate = createCandidate({
		appid: '1091500',
		name: 'Cyberpunk 2077',
		score: 98,
		confidence: 'exact',
		executable_match: true,
		reasons: ['official_executable_match', 'official_title_exact'],
		evidence_tier: 'proof',
	});
	const result = evaluateBulkCandidate(dummyContext, [cpCandidate]);
	if (!result.safe || result.candidate?.appid !== '1091500' || result.reason !== 'verified_identity') {
		throw new Error(`D01 Failed: Cyberpunk 2077 proof match was not accepted safely. Result: ${JSON.stringify(result)}`);
	}
	console.log('✓ D01 Passed: Cyberpunk 2077 official executable proof accepted safely by Bulk.');
}

// --------------------------------------------------------------------------
// D02: Black Myth: Wukong (b1-win64-shipping.exe) -> Corroborated with title/folder, Bulk safe
// --------------------------------------------------------------------------
{
	const wukong = createCandidate({
		appid: '2358720',
		name: 'Black Myth: Wukong',
		score: 92,
		confidence: 'high',
		reasons: ['official_title_exact', 'folder_exact'],
		evidence_tier: 'strong',
	});
	const result = evaluateBulkCandidate(dummyContext, [wukong]);
	if (!result.safe || result.candidate?.appid !== '2358720') {
		throw new Error(`D02 Failed: Black Myth: Wukong corroborated match was rejected. Result: ${JSON.stringify(result)}`);
	}
	console.log('✓ D02 Passed: Black Myth Wukong corroborated candidate accepted by Bulk.');
}

// --------------------------------------------------------------------------
// D03: Uncertain evidence must require manual review
// --------------------------------------------------------------------------
{
	const launcherCand = createCandidate({
		appid: '999',
		name: 'Launcher App',
		score: 65,
		confidence: 'low',
		reasons: ['generic_executable'],
		evidence_tier: 'hint',
	});
	const result = evaluateBulkCandidate(dummyContext, [launcherCand]);
	if (result.safe) {
		throw new Error(`D03 Failed: Uncertain candidate was linked automatically.`);
	}
	console.log('✓ D03 Passed: Uncertain identity requires manual review.');
}

// --------------------------------------------------------------------------
// D04: Resident Evil 4 (2005) vs Resident Evil 4 (2023 Remake)
// --------------------------------------------------------------------------
{
	const re4_2005 = createCandidate({
		appid: '254700',
		name: 'Resident Evil 4 (2005)',
		score: 95,
		confidence: 'high',
		reasons: ['official_executable_match', 'year_match'],
		evidence_tier: 'proof',
		identity_collision: true,
	});
	const re4_2023 = createCandidate({
		appid: '2050650',
		name: 'Resident Evil 4',
		score: 50,
		confidence: 'low',
		reasons: ['official_executable_match'],
		negative_reasons: ['year_mismatch', 'remake_mismatch'],
		evidence_tier: 'hint',
		identity_collision: true,
	});
	const result = evaluateBulkCandidate(dummyContext, [re4_2005, re4_2023]);
	if (!result.safe || result.candidate?.appid !== '254700') {
		throw new Error(`D04 Failed: RE4 (2005) with year match was not safely selected over remake. Result: ${JSON.stringify(result)}`);
	}
	console.log('✓ D04 Passed: RE4 (2005) with year match safely selected over 2023 remake.');
}

// --------------------------------------------------------------------------
// D05: Uncertain evidence must require manual review
// --------------------------------------------------------------------------
{
	const re4_cand1 = createCandidate({
		appid: '254700',
		name: 'Resident Evil 4',
		score: 82,
		confidence: 'medium',
		reasons: ['official_executable_match'],
		identity_collision: true,
	});
	const re4_cand2 = createCandidate({
		appid: '2050650',
		name: 'Resident Evil 4',
		score: 80,
		confidence: 'medium',
		reasons: ['official_executable_match'],
		identity_collision: true,
	});
	const result = evaluateBulkCandidate(dummyContext, [re4_cand1, re4_cand2]);
	if (result.safe) {
		throw new Error(`D05 Failed: Uncertain candidate was linked automatically.`);
	}
	console.log('✓ D05 Passed: Uncertain identity requires manual review.');
}

// --------------------------------------------------------------------------
// D06: GTA IV (GTAIV.exe) -> Proof, 12210 accepted
// --------------------------------------------------------------------------
{
	const gtaIv = createCandidate({
		appid: '12210',
		name: 'Grand Theft Auto IV: The Complete Edition',
		score: 96,
		confidence: 'exact',
		executable_match: true,
		reasons: ['official_executable_match', 'official_title_exact'],
		evidence_tier: 'proof',
	});
	const result = evaluateBulkCandidate(dummyContext, [gtaIv]);
	if (!result.safe || result.candidate?.appid !== '12210') {
		throw new Error(`D06 Failed: GTA IV proof candidate was rejected. Result: ${JSON.stringify(result)}`);
	}
	console.log('✓ D06 Passed: GTA IV proof candidate accepted.');
}

// --------------------------------------------------------------------------
// D07: GTA IV vs GTA V -> Sequel mismatch protection
// --------------------------------------------------------------------------
{
	const gtaVWrongCandidate = createCandidate({
		appid: '271590',
		name: 'Grand Theft Auto V',
		score: 55,
		confidence: 'low',
		reasons: ['franchise_match'],
		negative_reasons: ['sequel_mismatch'],
		evidence_tier: 'hint',
	});
	const result = evaluateBulkCandidate(dummyContext, [gtaVWrongCandidate]);
	if (result.safe) {
		throw new Error(`D07 Failed: GTA V candidate with sequel_mismatch was accepted for GTA IV shortcut.`);
	}
	if (result.reason !== 'below_bulk_score_threshold') {
		throw new Error(`D07 Failed: Expected below_bulk_score_threshold reason, got: ${result.reason}`);
	}
	console.log('✓ D07 Passed: 55% candidate remains below the automatic Bulk floor.');
}

// --------------------------------------------------------------------------
// D08: PES 2013 (delisted game) -> Verified alias and appinfo evidence accepted
// --------------------------------------------------------------------------
{
	const pes2013 = createCandidate({
		appid: '221430',
		name: 'Pro Evolution Soccer 2013',
		score: 95,
		confidence: 'exact',
		executable_match: true,
		reasons: ['official_executable_match', 'official_title_exact'],
		evidence_tier: 'proof',
	});
	const result = evaluateBulkCandidate(dummyContext, [pes2013]);
	if (!result.safe || result.candidate?.appid !== '221430') {
		throw new Error(`D08 Failed: PES 2013 delisted game was rejected. Result: ${JSON.stringify(result)}`);
	}
	console.log('✓ D08 Passed: PES 2013 delisted game accepted with verified evidence.');
}

// --------------------------------------------------------------------------
// D09: Mortal Kombat Komplete Edition (MKKE.exe) -> 237110 accepted
// --------------------------------------------------------------------------
{
	const mkke = createCandidate({
		appid: '237110',
		name: 'Mortal Kombat Komplete Edition',
		score: 95,
		confidence: 'exact',
		executable_match: true,
		reasons: ['official_executable_match', 'official_title_exact'],
		evidence_tier: 'proof',
	});
	const result = evaluateBulkCandidate(dummyContext, [mkke]);
	if (!result.safe || result.candidate?.appid !== '237110') {
		throw new Error(`D09 Failed: MKKE was rejected. Result: ${JSON.stringify(result)}`);
	}
	console.log('✓ D09 Passed: Mortal Kombat Komplete Edition proof candidate accepted.');
}

// --------------------------------------------------------------------------
// D10: Wrong history: remembered AppID 55 vs fresh evidence 96 -> Fresh 96 wins!
// --------------------------------------------------------------------------
{
	const freshProof = createCandidate({
		appid: '1091500',
		name: 'Cyberpunk 2077',
		score: 96,
		confidence: 'exact',
		executable_match: true,
		reasons: ['official_executable_match'],
		evidence_tier: 'proof',
	});
	const wrongRemembered = createCandidate({
		appid: '55',
		name: 'Wrong Game',
		score: 55,
		confidence: 'low',
		reasons: ['fuzzy_match'],
		evidence_tier: 'hint',
	});
	const result = evaluateBulkCandidate(dummyContext, [freshProof, wrongRemembered], '55');
	if (!result.safe || result.candidate?.appid !== '1091500') {
		throw new Error(`D10 Failed: Remembered AppID 55 overrode fresh proof candidate 1091500! Result: ${JSON.stringify(result)}`);
	}
	console.log('✓ D10 Passed: Fresh proof candidate (96%) wins over stale remembered AppID (55%).');
}

// --------------------------------------------------------------------------
// D11: Uncertain evidence must require manual review
// --------------------------------------------------------------------------
{
	const candA = createCandidate({
		appid: '100',
		name: 'Game Edition A',
		score: 76,
		confidence: 'medium',
		reasons: ['title_exact'],
		evidence_tier: 'supporting',
	});
	const candB = createCandidate({
		appid: '200',
		name: 'Game Edition B',
		score: 75,
		confidence: 'medium',
		reasons: ['title_exact'],
		evidence_tier: 'supporting',
	});
	// Candidate B is remembered, but candidate A has the higher percentage.
	const result = evaluateBulkCandidate(dummyContext, [candA, candB], '200');
	if (result.safe) {
		throw new Error(`D11 Failed: Uncertain candidate was linked automatically.`);
	}
	console.log('✓ D11 Passed: Uncertain identity requires manual review.');
}

// --------------------------------------------------------------------------
// D12: Uncertain evidence must require manual review
// --------------------------------------------------------------------------
{
	const wrongTxt = createCandidate({
		appid: '480',
		name: 'Spacewar',
		score: 60,
		confidence: 'low',
		reasons: ['steam_appid_file'],
		evidence_tier: 'hint',
	});
	const result = evaluateBulkCandidate(dummyContext, [wrongTxt]);
	if (result.safe) {
		throw new Error(`D12 Failed: Uncertain candidate was linked automatically.`);
	}
	console.log('✓ D12 Passed: Uncertain identity requires manual review.');
}

// --------------------------------------------------------------------------
// D13: Correct steam_appid.txt + official executable -> Accepted as Proof
// --------------------------------------------------------------------------
{
	const corroboratedTxt = createCandidate({
		appid: '1245620',
		name: 'ELDEN RING',
		score: 95,
		confidence: 'exact',
		executable_match: true,
		reasons: ['steam_appid_file', 'official_executable_match'],
		evidence_tier: 'proof',
	});
	const result = evaluateBulkCandidate(dummyContext, [corroboratedTxt]);
	if (!result.safe || result.candidate?.appid !== '1245620') {
		throw new Error(`D13 Failed: Corroborated steam_appid.txt + executable was rejected. Result: ${JSON.stringify(result)}`);
	}
	console.log('✓ D13 Passed: steam_appid.txt corroborated with official executable accepted as Proof.');
}

// --------------------------------------------------------------------------
// D14: Uncertain evidence must require manual review
// --------------------------------------------------------------------------
{
	const folderOnly = createCandidate({
		appid: '300',
		name: 'Some Game',
		score: 68,
		confidence: 'low',
		reasons: ['folder_exact'],
		evidence_tier: 'supporting',
	});
	const result = evaluateBulkCandidate(dummyContext, [folderOnly]);
	if (result.safe) {
		throw new Error(`D14 Failed: Uncertain candidate was linked automatically.`);
	}
	console.log('✓ D14 Passed: Uncertain identity requires manual review.');
}

// --------------------------------------------------------------------------
// D15: Uncertain evidence must require manual review
// --------------------------------------------------------------------------
{
	const cand1 = createCandidate({
		appid: '10',
		name: 'Game Version 1',
		score: 85,
		confidence: 'medium',
		reasons: ['title_exact'],
		evidence_tier: 'strong',
	});
	const cand2 = createCandidate({
		appid: '20',
		name: 'Game Version 2',
		score: 80,
		confidence: 'medium',
		reasons: ['title_exact'],
		evidence_tier: 'strong',
	});
	const result = evaluateBulkCandidate(dummyContext, [cand1, cand2]);
	if (result.safe) {
		throw new Error(`D15 Failed: Uncertain candidate was linked automatically.`);
	}
	console.log('✓ D15 Passed: Uncertain identity requires manual review.');
}

// --------------------------------------------------------------------------
// D16: Top #4 adaptive validation in Lua engine
// --------------------------------------------------------------------------
{
	const luaDetectorSource = readFileSync(new URL('../backend/lib/shortcut_detection.lua', import.meta.url), 'utf8');
	const initialValidation = luaDetectorSource.includes('for i = 1, math.min(#candidates, 3) do validate_candidate(candidates[i]) end')
		|| luaDetectorSource.includes('initial_validation_count = strong_local_candidate and 1 or math.min(#candidates, 3)');
	if (!initialValidation
		|| !luaDetectorSource.includes('for i = 4, math.min(#candidates, 6) do validate_candidate(candidates[i]) end')
		|| !luaDetectorSource.includes('top_gap < 15')) {
		throw new Error('D16 Failed: Lua detection engine missing adaptive validation expanding to candidates 4..6.');
	}
	console.log('✓ D16 Passed: Adaptive validation expanding to candidates 4..6 verified.');
}

// --------------------------------------------------------------------------
// D17: DLC collision -> Base game outranks DLC, Bulk never links DLC
// --------------------------------------------------------------------------
{
	const dlcCandidate = createCandidate({
		appid: '500',
		name: 'Awesome Game: Soundtrack and DLC',
		score: 45,
		confidence: 'low',
		reasons: ['franchise_match'],
		negative_reasons: ['non_game_result'],
		evidence_tier: 'hint',
	});
	const result = evaluateBulkCandidate(dummyContext, [dlcCandidate]);
	if (result.safe) {
		throw new Error(`D17 Failed: DLC candidate was accepted in Bulk.`);
	}
	console.log('✓ D17 Passed: DLC candidate with non_game_result rejected by Bulk.');
}

// --------------------------------------------------------------------------
// D18: Uncertain evidence must require manual review
// --------------------------------------------------------------------------
{
	const remasterCandidate = createCandidate({
		appid: '570940',
		name: 'DARK SOULS™: REMASTERED',
		score: 60,
		confidence: 'low',
		reasons: ['franchise_match'],
		negative_reasons: ['remake_mismatch'],
		evidence_tier: 'hint',
	});
	const result = evaluateBulkCandidate(dummyContext, [remasterCandidate]);
	if (result.safe) {
		throw new Error(`D18 Failed: Uncertain candidate was linked automatically.`);
	}
	console.log('✓ D18 Passed: Uncertain identity requires manual review.');
}

// --------------------------------------------------------------------------
// D19: Uncertain evidence must require manual review
// --------------------------------------------------------------------------
{
	const shortAliasCand = createCandidate({
		appid: '1245620',
		name: 'ELDEN RING',
		score: 65,
		confidence: 'medium',
		reasons: ['alias_requires_confirmation'],
		evidence_tier: 'hint',
	});
	const result = evaluateBulkCandidate(dummyContext, [shortAliasCand]);
	if (result.safe) {
		throw new Error(`D19 Failed: Uncertain candidate was linked automatically.`);
	}
	console.log('✓ D19 Passed: Uncertain identity requires manual review.');
}

// --------------------------------------------------------------------------
// D20: Factory Reset cache invalidation & Model Version
// --------------------------------------------------------------------------
{
	const detectionSource = readFileSync(new URL('../frontend/features/shortcuts/detection.ts', import.meta.url), 'utf8');
	const match = detectionSource.match(/export const DETECTION_MODEL_VERSION = '([^']+)';/);
	const modelVersion = match ? match[1] : null;
	if (modelVersion !== 'v10') {
		throw new Error(`D20 Failed: Expected DETECTION_MODEL_VERSION to be 'v10', got '${modelVersion}'.`);
	}
	const factoryResetSource = readFileSync(new URL('../frontend/features/shortcuts/factory-reset.ts', import.meta.url), 'utf8');
	if (!factoryResetSource.includes('clearShortcutDetectionCache()')) {
		throw new Error('D20 Failed: Factory reset does not call clearShortcutDetectionCache().');
	}
	if (!detectionSource.includes('export function clearShortcutDetectionCache(): void')
		|| !detectionSource.includes('cacheKey = [DETECTION_MODEL_VERSION,')) {
		throw new Error('D20 Failed: Detection cache does not incorporate DETECTION_MODEL_VERSION or lack clear function.');
	}
	console.log('✓ D20 Passed: Factory reset invalidates shortcut detection cache with model version v10.');
}

// --------------------------------------------------------------------------
// Architectural Invariants Check: Line counts <= 900
// --------------------------------------------------------------------------
{
	const filesToCheck = [
		'../backend/lib/shortcut_detection.lua',
		'../backend/lib/shortcut_detection_text.lua',
		'../backend/lib/shortcut_detection_pe.lua',
		'../frontend/features/shortcuts/bulk-policy.ts',
		'../frontend/features/shortcuts/bulk-link.ts',
		'../frontend/features/shortcuts/detection.ts',
		'../frontend/features/shortcuts/properties.ts',
		'../frontend/features/shortcuts/manual-link.ts',
		'../frontend/steam/localization.ts',
	];

	for (const relPath of filesToCheck) {
		const content = readFileSync(new URL(relPath, import.meta.url), 'utf8');
		const lines = content.split(/\r?\n/).length;
		if (lines > 900) {
			throw new Error(`Line count violation: ${relPath} has ${lines} lines (max 900 allowed).`);
		}
	}
	console.log('✓ File size invariant passed: All detection modules strictly <= 900 lines.');
}

console.log('\nAll 20 Detection Hardening test cases (D01-D20) and invariants PASSED successfully!');
