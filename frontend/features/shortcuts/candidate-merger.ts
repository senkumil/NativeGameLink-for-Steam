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

	for (const rem of remote) {
		const loc = local.find(item => item.appid === rem.appid);
		if (loc) {
			merged.push({
				...loc,
				...rem,
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
				validation_state: rem.validation_state || 'confirmed',
			});
		}
		seen.add(rem.appid);
	}

	for (const loc of local) {
		if (!seen.has(loc.appid)) {
			merged.push({
				...loc,
				validation_state: 'partial',
				warnings: loc.warnings && loc.warnings.includes('remote_validation_unavailable')
					? loc.warnings
					: [...(loc.warnings || []), 'remote_validation_unavailable'],
			});
			seen.add(loc.appid);
		}
	}

	return merged;
}
