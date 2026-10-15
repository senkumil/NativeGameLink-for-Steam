import { backendLog } from '../../../api/backend';
import { steamWebpackRuntime } from '../SteamWebpackRuntime';

export interface ActivityCandidate {
	moduleId: string | number;
	exportKey: string;
	component: any;
	score: number;
	matchedSignatures: string[];
}

export function findTopActivityCandidates(maxResults = 3, doc?: Document): ActivityCandidate[] {
	const modules = steamWebpackRuntime.getAllModules(doc);
	const candidates: ActivityCandidate[] = [];

	for (const mod of modules) {
		const exp = mod.exports;
		if (!exp) continue;

		const exportEntries: [string, any][] =
			typeof exp === 'function'
				? [['default', exp]]
				: typeof exp === 'object'
				? Object.entries(exp)
				: [];

		for (const [key, item] of exportEntries) {
			if (!item || (typeof item !== 'function' && typeof item !== 'object')) continue;

			const match = scoreActivityCandidate(mod.id, key, item);
			if (match && match.score >= 8) {
				candidates.push(match);
			}
		}
	}

	candidates.sort((a, b) => b.score - a.score);
	const top = candidates.slice(0, maxResults);

	if (top.length > 0) {
		backendLog(`[NGL][SteamResolver] Found ${candidates.length} activity candidates. Top ${top.length}:`);
		top.forEach((c, idx) => {
			backendLog(`[NGL][SteamResolver] Activity Candidate #${idx + 1} -> moduleId: ${c.moduleId}, exportKey: "${c.exportKey}", score: ${c.score}`);
		});
	}

	return top;
}

function scoreActivityCandidate(
	moduleId: string | number,
	exportKey: string,
	target: any,
): ActivityCandidate | null {
	let score = 0;
	const matchedSignatures: string[] = [];

	const fn = typeof target === 'function' ? target : target.render || target.type;
	if (typeof fn !== 'function') return null;

	const str = Function.prototype.toString.call(fn);
	const displayName = String(target.displayName || fn.name || target.name || '');

	if (/ActivityFeed|ActivitySection|ActivityCard|FriendActivity/i.test(displayName)) {
		score += 8;
		matchedSignatures.push(`displayName(${displayName})`);
	}

	if (str.includes('feed') || str.includes('rgEvents') || str.includes('activityFeed')) {
		score += 4;
		matchedSignatures.push('prop:feed');
	}
	if (str.includes('friend') || str.includes('persona') || str.includes('m_steamid')) {
		score += 4;
		matchedSignatures.push('prop:friends');
	}

	if (target.$$typeof || str.includes('createElement') || str.includes('jsx') || str.includes('.jsxs') || str.includes('.jsx')) {
		score += 3;
		matchedSignatures.push('react:Component');
	}

	if (score < 8) return null;

	return {
		moduleId,
		exportKey,
		component: target,
		score,
		matchedSignatures,
	};
}
