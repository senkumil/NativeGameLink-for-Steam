import type { ShortcutDetectionCandidate } from '../../domain/types';

function rankCandidates(candidates: ShortcutDetectionCandidate[]): ShortcutDetectionCandidate[] {
	return candidates.sort((left, right) => (Number(right.score) || 0) - (Number(left.score) || 0));
}

export function mergeCandidateLists(
	local: ShortcutDetectionCandidate[],
	remote: ShortcutDetectionCandidate[],
	rejectedAppIds: string[] = [],
): ShortcutDetectionCandidate[] {
	// Positive official rejections outrank a cached/local hint. A missing result
	// or network failure has no rejected IDs and still preserves local evidence.
	const rejected = new Set(rejectedAppIds.map(String));
	local = local.filter(candidate => !rejected.has(String(candidate.appid)));
	remote = (remote || []).filter(candidate => !rejected.has(String(candidate.appid)));
	if (!remote || remote.length === 0) {
		return rankCandidates(local.map(candidate => ({
			...candidate,
			validation_state: candidate.validation_state || 'partial',
			warnings: candidate.warnings && candidate.warnings.includes('remote_validation_unavailable')
				? candidate.warnings
				: [...(candidate.warnings || []), 'remote_validation_unavailable'],
		})));
	}
	const merged: ShortcutDetectionCandidate[] = [];
	const seen = new Set<string>();

	const getKey = (item: ShortcutDetectionCandidate): string =>
		item.candidate_key || (item.edition ? `${item.appid}:edition:${item.edition}` : item.appid);

	for (const rem of remote) {
		const remKey = getKey(rem);
		const loc = local.find(item => getKey(item) === remKey);
		if (loc) {
			merged.push({
				...loc,
				...rem,
				candidate_key: remKey,
				name: rem.name || loc.name,
				image: rem.image || loc.image,
				validation_state: rem.validation_state || 'confirmed',
				reasons: Array.from(new Set([...(loc.reasons || []), ...(rem.reasons || [])])),
				negative_reasons: Array.from(new Set([...(loc.negative_reasons || []), ...(rem.negative_reasons || [])])),
				warnings: Array.from(new Set([...(loc.warnings || []).filter(warning => warning !== 'remote_validation_unavailable'), ...(rem.warnings || [])])),
				identity_collision: Boolean(loc.identity_collision || rem.identity_collision),
				ambiguous: rem.validation_state === 'confirmed' && rem.evidence_tier === 'proof'
					? Boolean(rem.ambiguous) : Boolean(loc.ambiguous || rem.ambiguous),
			});
		} else {
			merged.push({
				...rem,
				candidate_key: remKey,
				validation_state: rem.validation_state || 'confirmed',
			});
		}
		seen.add(remKey);
	}

	for (const loc of local) {
		const locKey = getKey(loc);
		if (!seen.has(locKey)) {
			merged.push({
				...loc,
				candidate_key: locKey,
				validation_state: 'partial',
				warnings: loc.warnings && loc.warnings.includes('remote_validation_unavailable')
					? loc.warnings
					: [...(loc.warnings || []), 'remote_validation_unavailable'],
			});
			seen.add(locKey);
		}
	}

	// A weak search hit must not displace stronger local identity merely because
	// it arrived in the remote phase. Stable sorting retains each phase's tie
	// order and keeps base/edition options together at the same score.
	return rankCandidates(merged);
}
