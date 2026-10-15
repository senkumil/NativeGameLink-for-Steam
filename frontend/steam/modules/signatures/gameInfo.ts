import { backendLog } from '../../../api/backend';
import { steamWebpackRuntime } from '../SteamWebpackRuntime';

export interface GameInfoCandidate {
	moduleId: string | number;
	exportKey: string;
	component: any;
	score: number;
	matchedSignatures: string[];
}

export function findTopGameInfoCandidates(maxResults = 3, doc?: Document): GameInfoCandidate[] {
	const modules = steamWebpackRuntime.getAllModules(doc);
	const candidates: GameInfoCandidate[] = [];

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

			const match = scoreGameInfoCandidate(mod.id, key, item);
			if (match && match.score >= 8) {
				candidates.push(match);
			}
		}
	}

	candidates.sort((a, b) => b.score - a.score);
	const top = candidates.slice(0, maxResults);

	if (top.length > 0) {
		backendLog(`[NGL][SteamResolver] Found ${candidates.length} GameInfo candidates. Top ${top.length}:`);
		top.forEach((c, idx) => {
			backendLog(`[NGL][SteamResolver] GameInfo Candidate #${idx + 1} -> moduleId: ${c.moduleId}, exportKey: "${c.exportKey}", score: ${c.score}`);
		});
	}

	return top;
}

function scoreGameInfoCandidate(
	moduleId: string | number,
	exportKey: string,
	target: any,
): GameInfoCandidate | null {
	let score = 0;
	const matchedSignatures: string[] = [];

	const fn = typeof target === 'function' ? target : target.render || target.type;
	if (typeof fn !== 'function') return null;

	const str = Function.prototype.toString.call(fn);
	const displayName = String(target.displayName || fn.name || target.name || '');

	if (/GameInfo|AppDetailsInfo|AppProperties|DeveloperInfo/i.test(displayName)) {
		score += 8;
		matchedSignatures.push(`displayName(${displayName})`);
	}

	if (str.includes('developer') || str.includes('strDeveloper') || str.includes('publishers')) {
		score += 4;
		matchedSignatures.push('prop:developer');
	}
	if (str.includes('release_date') || str.includes('rtReleaseDate') || str.includes('strReleaseDate')) {
		score += 4;
		matchedSignatures.push('prop:releaseDate');
	}
	if (str.includes('controller_support') || str.includes('bHasControllerSupport') || str.includes('SteamDeck')) {
		score += 4;
		matchedSignatures.push('prop:controllerDeck');
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
