import { findTopAchievementCandidates, findTopAchievementSectionCandidates } from './signatures/achievements';
import { findTopPlaybarCandidates } from './signatures/playbar';
import { findTopGameInfoCandidates } from './signatures/gameInfo';
import { findTopActivityCandidates } from './signatures/activity';
import { findTopNewsCandidates } from './signatures/news';
import { findTopLinksCandidates } from './signatures/links';

export type KnownSteamComponent =
	| 'DesktopAchievementItem'
	| 'DesktopAchievementSection'
	| 'DesktopPlayButton'
	| 'DesktopGameInfo'
	| 'DesktopActivityCard'
	| 'DesktopNews'
	| 'DesktopLinksBar';

class SteamComponentResolver {
	private cache = new Map<KnownSteamComponent, any>();

	public resolve<T = any>(name: KnownSteamComponent): T | null {
		if (this.cache.has(name)) return this.cache.get(name);

		let resolved: any = null;
		switch (name) {
			case 'DesktopAchievementItem': {
				const best = findTopAchievementCandidates(1)[0];
				resolved = best?.component || null;
				break;
			}
			case 'DesktopAchievementSection': {
				const best = findTopAchievementSectionCandidates(1)[0];
				resolved = best?.component || null;
				break;
			}
			case 'DesktopPlayButton': {
				const best = findTopPlaybarCandidates(1)[0];
				resolved = best?.component || null;
				break;
			}
			case 'DesktopGameInfo': {
				const best = findTopGameInfoCandidates(1)[0];
				resolved = best?.component || null;
				break;
			}
			case 'DesktopActivityCard': {
				const best = findTopActivityCandidates(1)[0];
				resolved = best?.component || null;
				break;
			}
			case 'DesktopNews': {
				const best = findTopNewsCandidates(1)[0];
				resolved = best?.component || null;
				break;
			}
			case 'DesktopLinksBar': {
				const best = findTopLinksCandidates(1)[0];
				resolved = best?.component || null;
				break;
			}
		}

		if (resolved) {
			this.cache.set(name, resolved);
		}
		return resolved;
	}

	public prewarmComponents(): void {
		const known: KnownSteamComponent[] = [
			'DesktopAchievementItem',
			'DesktopAchievementSection',
			'DesktopPlayButton',
			'DesktopGameInfo',
			'DesktopActivityCard',
			'DesktopNews',
			'DesktopLinksBar',
		];
		const schedule = typeof requestIdleCallback === 'function'
			? requestIdleCallback
			: (cb: () => void) => setTimeout(cb, 100);

		schedule(() => {
			for (const name of known) {
				try {
					if (!this.cache.has(name)) {
						this.resolve(name);
					}
				} catch {}
			}
		});
	}

	public clearCache(): void {
		this.cache.clear();
	}
}

export const steamComponents = new SteamComponentResolver();
