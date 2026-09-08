import type { ShortcutDetectionCandidate, ShortcutDetectionContext } from '../../domain/types';

export interface BulkEvaluationResult {
	candidate: ShortcutDetectionCandidate | null;
	safe: boolean;
	reason: string;
}

/** Automatic bulk linking requires a strong, distinct identity. Uncertain
 * candidates remain available for the user's manual confirmation. */
export const BULK_TOP_SCORE_THRESHOLD = 90;

export function evaluateBulkCandidate(
	_context: ShortcutDetectionContext,
	candidates: ShortcutDetectionCandidate[],
	_rememberedAppId = '',
): BulkEvaluationResult {
	if (!Array.isArray(candidates) || candidates.length === 0) {
		return { candidate: null, safe: false, reason: 'no_candidates' };
	}

	const eligible = candidates
		.map((candidate, index) => ({ candidate, index, score: Number(candidate?.score) }))
		.filter(({ candidate, score }) => {
			if (!candidate || !/^\d+$/.test(String(candidate.appid || ''))) return false;
			if (Number(candidate.appid) <= 0 || Number(candidate.appid) >= 2147483648) return false;
			if (!Number.isFinite(score)) return false;
			const reasons = candidate.reasons || [];
			const negativeReasons = candidate.negative_reasons || [];
			return !reasons.includes('non_game_result') && !negativeReasons.includes('non_game_result');
		})
		.sort((left, right) => (right.score - left.score) || (left.index - right.index));

	if (eligible.length === 0) {
		return { candidate: null, safe: false, reason: 'no_game_candidates' };
	}

	const top = eligible[0];
	if (top.score < BULK_TOP_SCORE_THRESHOLD) {
		return { candidate: null, safe: false, reason: 'below_bulk_score_threshold' };
	}

	const candidate = top.candidate;
	const signals = [...(candidate.reasons || []), ...(candidate.negative_reasons || []), ...(candidate.warnings || [])];
	if (candidate.ambiguous || signals.some(signal => /mismatch|requires_confirmation|identity_conflict/.test(signal))) {
		return { candidate: null, safe: false, reason: 'identity_needs_review' };
	}
	const proof = candidate.evidence_tier === 'proof';
	if (candidate.identity_collision && !(proof && signals.includes('year_match'))) {
		return { candidate: null, safe: false, reason: 'identity_needs_review' };
	}
	const runnerUp = eligible.find(item => item.candidate.appid !== candidate.appid);
	if (runnerUp && top.score - runnerUp.score < 15) {
		return { candidate: null, safe: false, reason: 'close_candidates_need_review' };
	}
	if (!['high', 'exact'].includes(candidate.confidence)
		|| (!proof && (candidate.evidence_tier !== 'strong' || candidate.validation_state !== 'confirmed'))) {
		return { candidate: null, safe: false, reason: 'insufficient_identity_evidence' };
	}
	return { candidate, safe: true, reason: 'verified_identity' };
}
