import assert from 'node:assert/strict';
import { mergeCandidateLists } from '../frontend/features/shortcuts/candidate-merger.ts';
import { expandCandidatesWithEditions } from '../frontend/features/shortcuts/editions.ts';
import { evaluateBulkCandidate } from '../frontend/features/shortcuts/bulk-policy.ts';

const context = { shortcutAppId: 3000000001, title: 'bf3',
  exePath: 'E:\\Juegos\\Battlefield 3\\bf3.exe', startDir: 'E:\\Juegos\\Battlefield 3', launchOptions: '' };
const battlefield = { appid: '1238820', name: 'Battlefield 3™', score: 96, confidence: 'high',
  evidence_tier: 'strong', reasons: ['pe_product_exact', 'folder_exact'], validation_state: 'partial' };
const unrelated = { appid: '41070', name: 'Serious Sam 3: BFE', score: 7, confidence: 'low',
  evidence_tier: 'hint', reasons: [], validation_state: 'confirmed' };
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };

const merged = mergeCandidateLists([battlefield], [unrelated]);
check(merged[0].appid === battlefield.appid, 'A weak remote result cannot precede stronger local identity');
check(merged[0].validation_state === 'partial' && merged[0].warnings.includes('remote_validation_unavailable'),
  'Ranking retained local evidence does not invent official verification');
check(!evaluateBulkCandidate(context, merged).safe, 'Partial local identity remains available for review without automatic bulk linking');
const local = [unrelated, battlefield];
const localSnapshot = JSON.stringify(local);
check(mergeCandidateLists(local, [])[0].appid === battlefield.appid, 'Offline candidates use the same descending ranking');
check(JSON.stringify(local) === localSnapshot, 'Merging does not mutate input candidates or their order');
check(mergeCandidateLists([battlefield], [], [battlefield.appid]).length === 0,
  'An official rejection removes a local match even when no remote candidates remain');
check(mergeCandidateLists([battlefield], [battlefield], [battlefield.appid]).length === 0,
  'An official rejection cannot be resurrected by either phase');
check(mergeCandidateLists([battlefield], [], []).length === 1,
  'Absence or network failure preserves local matches when there is no official rejection');

const conflict = { ...battlefield, ambiguous: true, identity_collision: true,
  negative_reasons: ['sequel_mismatch'], warnings: ['identity_conflict', 'remote_validation_unavailable'] };
const weakUpdate = mergeCandidateLists([conflict], [{ ...battlefield, score: 92, ambiguous: false,
  identity_collision: false, validation_state: 'confirmed', negative_reasons: [], warnings: [] }])[0];
check(weakUpdate.negative_reasons.includes('sequel_mismatch'), 'Enrichment retains contradictory local identity evidence');
check(weakUpdate.identity_collision && weakUpdate.ambiguous, 'An ordinary remote hit cannot clear ambiguity or collisions');
check(weakUpdate.warnings.includes('identity_conflict') && !weakUpdate.warnings.includes('remote_validation_unavailable'),
  'Remote enrichment removes only the obsolete availability warning');
check(!evaluateBulkCandidate(context, [weakUpdate]).safe, 'Conflicting identity never becomes an automatic bulk match');

const resolved = mergeCandidateLists([{ ...battlefield, ambiguous: true }], [{ ...battlefield,
  score: 99, confidence: 'high', ambiguous: false, evidence_tier: 'proof', validation_state: 'confirmed',
  reasons: ['official_executable_match', 'official_title_exact'], image: 'https://example.invalid/header.jpg' }])[0];
check(!resolved.ambiguous && resolved.evidence_tier === 'proof', 'A confirmed official proof can resolve earlier ambiguity');
check(evaluateBulkCandidate(context, [resolved]).safe, 'Resolved distinct official identity still works in bulk linking');
check(resolved.image.endsWith('/header.jpg') && resolved.reasons.includes('folder_exact'),
  'Authoritative metadata enriches the candidate while keeping the original evidence');

for (const appid of ['1091500', '292030', '1174180', '2050650', '397540']) {
  const original = { ...conflict, appid, score: 94, phase: 'remote', remembered: true };
  const expanded = expandCandidatesWithEditions([original]);
  check(expanded.length > 1, `${appid}: a curated edition is available`);
  for (const edition of expanded.slice(1)) {
    for (const property of ['score', 'confidence', 'validation_state', 'evidence_tier', 'ambiguous', 'identity_collision', 'phase', 'remembered']) {
      check(edition[property] === original[property], `${appid}: edition preserves ${property}`);
    }
    check(edition.negative_reasons.includes('sequel_mismatch') && edition.warnings.includes('identity_conflict'),
      `${appid}: edition keeps all contradictory evidence`);
    check(!evaluateBulkCandidate(context, [edition]).safe, `${appid}: edition cannot bypass identity review`);
  }
  check(JSON.stringify(expandCandidatesWithEditions(expanded)) === JSON.stringify(expanded),
    `${appid}: repeated expansion preserves the same choices without duplicates`);
}
const reference = JSON.stringify(mergeCandidateLists([battlefield, unrelated], [{ ...battlefield, score: 99 }]));
for (let n = 0; n < 30; n++) check(JSON.stringify(mergeCandidateLists([battlefield, unrelated], [{ ...battlefield, score: 99 }])) === reference,
  'Concurrent phase completion produces deterministic candidate ranking');
console.log(`Detection candidate merge passed: ${checks} ranking, offline, conflict, official-proof and edition assertions.`);
