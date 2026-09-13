import type { ShortcutDetectionCandidate } from '../../domain/types';

export function mergeCandidateLists(
	local: ShortcutDetectionCandidate[],
	remote: ShortcutDetectionCandidate[],
): ShortcutDetectionCandidate[] {
	if (!remote || remote.length === 0) {
		return local.map(candidate => ({
			...candidate,
			validation_state: candidate.validation_state || 'partial',
			warnings: candidate.warnings && candidate.warnings.includes('remote_validation_unavailable')
				? candidate.warnings
				: [...(candidate.warnings || []), 'remote_validation_unavailable'],
		}));
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
				warnings: Array.from(new Set([...(loc.warnings || []).filter(warning => warning !== 'remote_validation_unavailable'), ...(rem.warnings || [])])),
				identity_collision: Boolean(loc.identity_collision || rem.identity_collision),
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

	return merged;
}
