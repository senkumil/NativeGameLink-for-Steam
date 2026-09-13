import { findModuleExport } from '@steambrew/client';

export interface SteamRareAchievementClasses {
	wrapper: string;
	glowRoot: string;
	glowContainer: string;
	glow: string;
	iconGlow: string;
	icon: string;
	noAnimation: string;
}

export const FALLBACK_RARE_CLASSES: Readonly<SteamRareAchievementClasses> = Object.freeze({
	wrapper: '_1fEbX-PfpZ2FhkhttWcm-V',
	glowRoot: '_2HUbCbZUn27MliiC8gRxGB',
	glowContainer: '_2D_EJk8-jCnfqiwoKkOMVh',
	glow: '_1Z2eJs9-zNTKcWKy4M-oDE',
	iconGlow: '_3s4Rq3jnntBVP7HbJj1RMQ',
	icon: '_2V2sHETNfa62yMoDwSF3_t',
	noAnimation: '_1a4bwiE4yUR3XXBKI6mKqt',
});

let cachedRareClasses: SteamRareAchievementClasses | null = null;

/**
 * Resolves Steam's official rare achievement CSS class names directly from
 * Webpack Module 33175 at runtime, falling back to verified extracted hashes.
 */
export function getSteamRareAchievementClasses(): SteamRareAchievementClasses {
	if (cachedRareClasses) return cachedRareClasses;
	try {
		const mod = findModuleExport(
			(m: any) =>
				m &&
				typeof m === 'object' &&
				'RareAchievementIconGlowContainerRoot' in m &&
				'RareAchievementIconGlow' in m,
		);
		if (mod) {
			cachedRareClasses = {
				wrapper: String(mod.AchievementIconWrapper || FALLBACK_RARE_CLASSES.wrapper),
				glowRoot: String(mod.RareAchievementIconGlowContainerRoot || FALLBACK_RARE_CLASSES.glowRoot),
				glowContainer: String(mod.RareAchievementIconGlowContainer || FALLBACK_RARE_CLASSES.glowContainer),
				glow: String(mod.RareAchievementIconGlow || FALLBACK_RARE_CLASSES.glow),
				iconGlow: String(mod.IconGlow || FALLBACK_RARE_CLASSES.iconGlow),
				icon: String(mod.Icon || FALLBACK_RARE_CLASSES.icon),
				noAnimation: String(mod.RareAchievementNoAnimation || FALLBACK_RARE_CLASSES.noAnimation),
			};
			return cachedRareClasses;
		}
	} catch {}
	return FALLBACK_RARE_CLASSES;
}

/**
 * Generates the official Steam 1:1 nested 3-level glow container DOM structure:
 * <div class="gdl-rare-glow-root [SteamRareRoot]">
 *   <div class="gdl-rare-glow-container [SteamRareContainer]">
 *     <div class="gdl-rare-glow [SteamRareGlow]"></div>
 *   </div>
 * </div>
 */
export function renderSteamRareGlowHtml(classes = getSteamRareAchievementClasses()): string {
	return `<div class="gdl-rare-glow-root ${classes.glowRoot}"><div class="gdl-rare-glow-container ${classes.glowContainer}"><div class="gdl-rare-glow ${classes.glow}"></div></div></div>`;
}
