import assert from 'node:assert/strict';
import { BULK_TOP_SCORE_THRESHOLD, evaluateBulkCandidate } from '../frontend/features/shortcuts/bulk-policy.ts';
const context = { title: 'Game', shortcutAppId: 3000000001, exePath: 'game.exe', startDir: '', launchOptions: '' };
const candidate = extra => ({ appid: '100', name: 'Game', score: 96, confidence: 'high', evidence_tier: 'strong', validation_state: 'confirmed', reasons: ['official_title_exact', 'folder_exact'], ...extra });
const evaluate = (list, remembered = '') => evaluateBulkCandidate(context, list, remembered);
assert.equal(BULK_TOP_SCORE_THRESHOLD, 90);
assert.equal(evaluate([candidate()]).safe, true);
for (const extra of [
 { score: 58 }, { score: 89 }, { confidence: 'low' }, { evidence_tier: 'hint' },
 { validation_state: 'partial' }, { identity_collision: true }, { ambiguous: true },
 { warnings: ['alias_requires_confirmation'] }, { negative_reasons: ['year_mismatch'] },
 { negative_reasons: ['sequel_mismatch'] }, { negative_reasons: ['remake_mismatch'] },
 { reasons: ['non_game_result'] }, { appid: '0' }, { appid: '2147483648' }, { appid: 'abc' },
]) assert.equal(evaluate([candidate(extra)]).safe, false, JSON.stringify(extra));
assert.equal(evaluate([candidate(), candidate({ appid: '200', score: 94 })]).safe, false, 'Close editions require review even at high scores');
assert.equal(evaluate([candidate(), candidate({ appid: '200', score: 94 })], '100').safe, false, 'Remembered choice cannot override ambiguity');
assert.equal(evaluate([candidate(), candidate({ appid: '200', score: 81 })]).safe, true, 'Distinct confirmed identity is eligible');
assert.equal(evaluate([candidate(), candidate({ appid: '100' })]).safe, true, 'Duplicate rows for one AppID are not competing games');
assert.equal(evaluate([candidate({ appid: '221430', evidence_tier: 'proof', validation_state: 'partial' })]).safe, true, 'Local verified proof supports delisted games');
assert.equal(evaluate([candidate({ appid: '254700', evidence_tier: 'proof', identity_collision: true, reasons: ['official_executable_match', 'year_match'] })]).safe, true, 'Proven original edition with matching year remains eligible');
assert.equal(evaluate([candidate({ appid: '500', score: 99, reasons: ['non_game_result'] }), candidate()]).candidate.appid, '100');
console.log('Bulk review policy passed: high-score ambiguity, aliases, remakes, partial evidence, invalid IDs, DLC, delisted proof and confirmed matches.');
