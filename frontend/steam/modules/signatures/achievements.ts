import { backendLog } from '../../../api/backend';
import { steamWebpackRuntime } from '../SteamWebpackRuntime';

export interface AchievementCandidate {
	moduleId: string | number;
	exportKey: string;
	component: any;
	score: number;
	matchedSignatures: string[];
	propsShape: Record<string, string>;
}

export function findTopAchievementCandidates(maxResults = 3, doc?: Document): AchievementCandidate[] {
	const modules = steamWebpackRuntime.getAllModules(doc);
	const candidates: AchievementCandidate[] = [];

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

			const match = scoreAchievementCandidate(mod.id, key, item);
			if (match && match.score >= 8) {
				candidates.push(match);
			}
		}
	}

	candidates.sort((a, b) => b.score - a.score);
	const top = candidates.slice(0, maxResults);

	// Log top candidates for diagnostics
	if (top.length > 0) {
		backendLog(`[NGL][SteamResolver] Found ${candidates.length} achievement item candidates. Top ${top.length}:`);
		top.forEach((c, idx) => {
			backendLog(`[NGL][SteamResolver] Item Candidate #${idx + 1} -> moduleId: ${c.moduleId}, exportKey: "${c.exportKey}", score: ${c.score}, signatures: [${c.matchedSignatures.join(', ')}]`);
		});
	}

	return top;
}

export function findTopAchievementSectionCandidates(maxResults = 3, doc?: Document): AchievementCandidate[] {
	const modules = steamWebpackRuntime.getAllModules(doc);
	const candidates: AchievementCandidate[] = [];

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

			const match = scoreAchievementSectionCandidate(mod.id, key, item);
			if (match && match.score >= 8) {
				candidates.push(match);
			}
		}
	}

	candidates.sort((a, b) => b.score - a.score);
	const top = candidates.slice(0, maxResults);

	if (top.length > 0) {
		backendLog(`[NGL][SteamResolver] Found ${candidates.length} achievement section candidates. Top ${top.length}:`);
		top.forEach((c, idx) => {
			backendLog(`[NGL][SteamResolver] Section Candidate #${idx + 1} -> moduleId: ${c.moduleId}, exportKey: "${c.exportKey}", score: ${c.score}`);
		});
	}

	return top;
}

function scoreAchievementCandidate(
	moduleId: string | number,
	exportKey: string,
	target: any,
): AchievementCandidate | null {
	let score = 0;
	const matchedSignatures: string[] = [];
	const propsShape: Record<string, string> = {};

	const fn = typeof target === 'function' ? target : target.render || target.type;
	if (typeof fn !== 'function') return null;

	const str = Function.prototype.toString.call(fn);
	const displayName = String(target.displayName || fn.name || target.name || '');

	// 1. Display name hints
	if (/Achievement.*(?:Item|Card|Row|Detail|View|Entry|Tile)/i.test(displayName)) {
		score += 8;
		matchedSignatures.push(`displayName(${displayName})`);
	} else if (/Achievement/i.test(displayName)) {
		score += 4;
		matchedSignatures.push(`displayNameHint(${displayName})`);
	}

	// 2. Prop signatures in source code
	if (str.includes('bAchieved')) {
		score += 5;
		matchedSignatures.push('prop:bAchieved');
		propsShape['bAchieved'] = 'boolean';
	}
	if (str.includes('strName')) {
		score += 4;
		matchedSignatures.push('prop:strName');
		propsShape['strName'] = 'string';
	}
	if (str.includes('strDescription')) {
		score += 3;
		matchedSignatures.push('prop:strDescription');
		propsShape['strDescription'] = 'string';
	}
	if (str.includes('strImage') || str.includes('icon_gray') || str.includes('icon')) {
		score += 4;
		matchedSignatures.push('prop:strImage');
		propsShape['strImage'] = 'string (url)';
	}
	if (str.includes('flAchievedDate') || str.includes('flUnlockTime')) {
		score += 3;
		matchedSignatures.push('prop:flAchievedDate');
		propsShape['flAchievedDate'] = 'number (timestamp)';
	}
	if (str.includes('flRarity') || str.includes('r_percent') || str.includes('global_percent')) {
		score += 3;
		matchedSignatures.push('prop:flRarity');
		propsShape['flRarity'] = 'number (percentage)';
	}

	// 3. Focus and Gamepad navigation
	if (str.includes('onGamepadDirection') || str.includes('bFocusable') || str.includes('Focusable')) {
		score += 4;
		matchedSignatures.push('gamepad:Focusable');
	}

	// 4. React component structure
	if (target.$$typeof || str.includes('createElement') || str.includes('jsx') || str.includes('return React.') || str.includes('.jsxs') || str.includes('.jsx')) {
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
		propsShape,
	};
}

function scoreAchievementSectionCandidate(
	moduleId: string | number,
	exportKey: string,
	target: any,
): AchievementCandidate | null {
	let score = 0;
	const matchedSignatures: string[] = [];
	const propsShape: Record<string, string> = {};

	const fn = typeof target === 'function' ? target : target.render || target.type;
	if (typeof fn !== 'function') return null;

	const str = Function.prototype.toString.call(fn);
	const displayName = String(target.displayName || fn.name || target.name || '');

	if (/Achievement.*(?:Section|List|Summary|Overview|Group|Panel)/i.test(displayName)) {
		score += 8;
		matchedSignatures.push(`displayName(${displayName})`);
	}

	if (str.includes('rgAchievements') || str.includes('achievements') || str.includes('vecAchievements')) {
		score += 5;
		matchedSignatures.push('prop:rgAchievements');
		propsShape['rgAchievements'] = 'Array';
	}
	if (str.includes('nUnlocked') || str.includes('unlockedCount') || str.includes('unlocked')) {
		score += 4;
		matchedSignatures.push('prop:nUnlocked');
		propsShape['nUnlocked'] = 'number';
	}
	if (str.includes('nTotal') || str.includes('totalCount') || str.includes('total')) {
		score += 3;
		matchedSignatures.push('prop:nTotal');
		propsShape['nTotal'] = 'number';
	}
	if (str.includes('flPercentage') || str.includes('completion_percentage')) {
		score += 4;
		matchedSignatures.push('prop:flPercentage');
		propsShape['flPercentage'] = 'number';
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
		propsShape,
	};
}
