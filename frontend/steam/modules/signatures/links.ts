import { backendLog } from '../../../api/backend';
import { steamWebpackRuntime } from '../SteamWebpackRuntime';

export interface LinksCandidate {
	moduleId: string | number;
	exportKey: string;
	component: any;
	score: number;
	matchedSignatures: string[];
}

export function findTopLinksCandidates(maxResults = 3): LinksCandidate[] {
	const modules = steamWebpackRuntime.getAllModules();
	const candidates: LinksCandidate[] = [];

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

			const match = scoreLinksCandidate(mod.id, key, item);
			if (match && match.score >= 8) {
				candidates.push(match);
			}
		}
	}

	candidates.sort((a, b) => b.score - a.score);
	const top = candidates.slice(0, maxResults);

	if (top.length > 0) {
		backendLog(`[NGL][SteamResolver] Found ${candidates.length} LinksBar candidates. Top ${top.length}:`);
		top.forEach((c, idx) => {
			backendLog(`[NGL][SteamResolver] LinksBar Candidate #${idx + 1} -> moduleId: ${c.moduleId}, exportKey: "${c.exportKey}", score: ${c.score}`);
		});
	}

	return top;
}

function scoreLinksCandidate(
	moduleId: string | number,
	exportKey: string,
	target: any,
): LinksCandidate | null {
	let score = 0;
	const matchedSignatures: string[] = [];

	const fn = typeof target === 'function' ? target : target.render || target.type;
	if (typeof fn !== 'function') return null;

	const str = Function.prototype.toString.call(fn);
	const displayName = String(target.displayName || fn.name || target.name || '');

	if (/PrimaryLinks|LinksSection|AppDetailsLinks|GameDetailsSubNav|AppDetailsSubNav|GameLinks/i.test(displayName)) {
		score += 8;
		matchedSignatures.push(`displayName(${displayName})`);
	}

	if (str.includes('store.steampowered.com') || str.includes('StorePage') || str.includes('store_page')) {
		score += 4;
		matchedSignatures.push('prop:storePage');
	}
	if (str.includes('steamcommunity.com') || str.includes('CommunityHub') || str.includes('community_hub')) {
		score += 4;
		matchedSignatures.push('prop:communityHub');
	}
	if (str.includes('discussions') || str.includes('guides') || str.includes('workshop')) {
		score += 3;
		matchedSignatures.push('prop:gameFeatures');
	}
	if (str.includes('overflow') || str.includes('Overflow') || str.includes('DotDotDot') || str.includes('MenuButton')) {
		score += 3;
		matchedSignatures.push('feature:overflow');
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
