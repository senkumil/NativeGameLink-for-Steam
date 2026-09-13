import { injectAchievementStyle } from './inject';

export function ensureAchievementPlaybarStyles(doc: Document): void {
	injectAchievementStyle(doc, 'gdl-achievement-playbar-style', `
		.gdl-local-playbar { cursor:pointer;transition:filter .12s ease; }
		.gdl-local-playbar:hover { filter:brightness(1.08); }
		[data-gdl-playbar-achievements="1"] .gdl-lp-fill { background:#2d73ff !important; }
		[data-gdl-playbar-achievements="1"] .gdl-lp-icon,
		[data-gdl-playbar-achievements="1"] ._1tIg-QIrwMNtCm7NcYADyi,
		[data-gdl-playbar-achievements="1"] ._3bkqc-SsCg0b3FTEuewlK8 {
			width: 30px !important;
			height: 30px !important;
			margin: 3px !important;
			display: flex !important;
			align-items: center !important;
			justify-content: center !important;
			flex-shrink: 0 !important;
		}
		[data-gdl-playbar-achievements="1"] .gdl-lp-icon svg,
		[data-gdl-playbar-achievements="1"] ._1tIg-QIrwMNtCm7NcYADyi svg,
		[data-gdl-playbar-achievements="1"] ._3bkqc-SsCg0b3FTEuewlK8 svg {
			width: 100% !important;
			height: 100% !important;
			display: block !important;
		}
	`);
}
