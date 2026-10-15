import { backendLog } from '../../../api/backend';
import { steamWebpackRuntime } from '../SteamWebpackRuntime';

export interface NewsCandidate {
	moduleId: string | number;
	exportKey: string;
	component: any;
	score: number;
	matchedSignatures: string[];
}

export function findTopNewsCandidates(maxResults = 3, doc?: Document): NewsCandidate[] {
	const modules = steamWebpackRuntime.getAllModules(doc);
	const candidates: NewsCandidate[] = [];

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

			const match = scoreNewsCandidate(mod.id, key, item);
			if (match && match.score >= 8) {
				candidates.push(match);
			}
		}
	}

	candidates.sort((a, b) => b.score - a.score);
	const top = candidates.slice(0, maxResults);

	if (top.length > 0) {
		backendLog(`[NGL][SteamResolver] Found ${candidates.length} news candidates. Top ${top.length}:`);
		top.forEach((c, idx) => {
			backendLog(`[NGL][SteamResolver] News Candidate #${idx + 1} -> moduleId: ${c.moduleId}, exportKey: "${c.exportKey}", score: ${c.score}`);
		});
	}

	return top;
}

function scoreNewsCandidate(
	moduleId: string | number,
	exportKey: string,
	target: any,
): NewsCandidate | null {
	let score = 0;
	const matchedSignatures: string[] = [];

	const fn = typeof target === 'function' ? target : target.render || target.type;
	if (typeof fn !== 'function') return null;

	const str = Function.prototype.toString.call(fn);
	const displayName = String(target.displayName || fn.name || target.name || '');

	if (/News|AppNews|WhatsNew|EventDetail|PatchNotes/i.test(displayName)) {
		score += 8;
		matchedSignatures.push(`displayName(${displayName})`);
	}

	if (str.includes('rgNews') || str.includes('newsItems') || str.includes('clanEvent')) {
		score += 4;
		matchedSignatures.push('prop:newsItems');
	}
	if (str.includes('gid') || str.includes('event_gid') || str.includes('bIsPatchNotes')) {
		score += 4;
		matchedSignatures.push('prop:patchNotes');
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
