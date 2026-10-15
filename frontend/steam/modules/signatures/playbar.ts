import { backendLog } from '../../../api/backend';
import { steamWebpackRuntime } from '../SteamWebpackRuntime';

export interface PlaybarCandidate {
	moduleId: string | number;
	exportKey: string;
	component: any;
	score: number;
	matchedSignatures: string[];
}

export function findTopPlaybarCandidates(maxResults = 3, doc?: Document): PlaybarCandidate[] {
	const modules = steamWebpackRuntime.getAllModules(doc);
	const candidates: PlaybarCandidate[] = [];

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

			const match = scorePlaybarCandidate(mod.id, key, item);
			if (match && match.score >= 8) {
				candidates.push(match);
			}
		}
	}

	candidates.sort((a, b) => b.score - a.score);
	const top = candidates.slice(0, maxResults);

	if (top.length > 0) {
		backendLog(`[NGL][SteamResolver] Found ${candidates.length} playbar candidates. Top ${top.length}:`);
		top.forEach((c, idx) => {
			backendLog(`[NGL][SteamResolver] Playbar Candidate #${idx + 1} -> moduleId: ${c.moduleId}, exportKey: "${c.exportKey}", score: ${c.score}`);
		});
	}

	return top;
}

function scorePlaybarCandidate(
	moduleId: string | number,
	exportKey: string,
	target: any,
): PlaybarCandidate | null {
	let score = 0;
	const matchedSignatures: string[] = [];

	const fn = typeof target === 'function' ? target : target.render || target.type;
	if (typeof fn !== 'function') return null;

	const str = Function.prototype.toString.call(fn);
	const displayName = String(target.displayName || fn.name || target.name || '');

	if (/PlayBar|PlayButton|LaunchButton|AppActionButtons|ActionButtons|AppDetailsPlayBar/i.test(displayName)) {
		score += 8;
		matchedSignatures.push(`displayName(${displayName})`);
	}

	if (str.includes('bIsRunning') || str.includes('bIsLaunching') || str.includes('bIsUpdating') || str.includes('isRunning')) {
		score += 5;
		matchedSignatures.push('prop:runningState');
	}
	if (str.includes('onPlay') || str.includes('onLaunch') || str.includes('LaunchApp') || str.includes('RunGame')) {
		score += 4;
		matchedSignatures.push('prop:launchAction');
	}
	if (str.includes('playtime') || str.includes('nPlaytime') || str.includes('strPlaytime') || str.includes('PlayTime')) {
		score += 3;
		matchedSignatures.push('prop:playtime');
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
