import { injectAchievementStyle } from './inject';
import { steamRareAchievementStyles } from './rare';


export function ensureAchievementModalStyles(doc: Document): void {
	injectAchievementStyle(doc, 'gdl-achievement-modal-style', `
		/* Right-side achievements sheet matching native Steam behavior more closely */
		.BasicUI #gdl-local-achievement-modal,
		#gdl-local-achievement-modal {
			position: fixed !important;
			inset: auto;
			left: 0;
			top: 0;
			width: 0;
			height: 0;
			z-index: 2147483600 !important;
			background: rgba(7, 11, 18, 0.34) !important;
			backdrop-filter: blur(8px) !important;
			display: flex !important;
			align-items: flex-start !important;
			justify-content: center !important;
			padding: 46px 34px 0 !important;
			box-sizing: border-box !important;
			overflow: visible !important;
			font-family: "Motiva Sans", Arial, Helvetica, sans-serif !important;
			color: #d6d7d8 !important;
			animation: gdl-lam-fadein 0.15s ease-out;
		}
		.BasicUI #gdl-local-achievement-modal *,
		#gdl-local-achievement-modal * {
			box-sizing: border-box;
		}
		@keyframes gdl-lam-fadein {
			from { opacity: 0; }
			to { opacity: 1; }
		}
		@keyframes gdl-lam-popin {
			from { transform: translateX(18px); opacity: 0; }
			to { transform: translateX(0); opacity: 1; }
		}
${steamRareAchievementStyles()}
		.BasicUI .gdl-lam-window,
		.gdl-lam-window {
			width: min(840px, calc(100% - 96px)) !important;
			height: 100% !important;
			background: rgba(18, 24, 32, 0.72) !important;
			border: 1px solid rgba(255, 255, 255, 0.06) !important;
			box-shadow: 0 18px 48px rgba(0, 0, 0, 0.58) !important;
			border-radius: 2px !important;
			position: relative !important;
			display: flex !important;
			flex-direction: column !important;
			overflow: visible !important;
			animation: gdl-lam-popin 0.15s ease-out;
		}
		.BasicUI .gdl-lam-head,
		.gdl-lam-head {
			padding: 24px 28px 16px !important;
			background: linear-gradient(180deg, rgba(55, 36, 24, 0.20) 0%, rgba(19, 24, 31, 0.18) 100%) !important;
			backdrop-filter: blur(18px) !important;
			position: relative !important;
			border-bottom: 1px solid rgba(255, 255, 255, 0.04) !important;
			overflow: hidden !important;
			flex-shrink: 0 !important;
		}
		.BasicUI .gdl-lam-head::before,
		.gdl-lam-head::before {
			content: '';
			position: absolute;
			inset: 0;
			background-image: var(--gdl-lam-hero-image);
			background-position: center center;
			background-size: cover;
			filter: blur(18px) saturate(1.08);
			transform: scale(1.08);
			opacity: 0.92;
			pointer-events: none;
		}
		.BasicUI .gdl-lam-head::after,
		.gdl-lam-head::after {
			content: '';
			position: absolute;
			inset: 0;
			background: linear-gradient(180deg, rgba(25, 15, 10, 0.18) 0%, rgba(17, 22, 29, 0.36) 100%);
			pointer-events: none;
		}
		.BasicUI .gdl-lam-head > *,
		.gdl-lam-head > * {
			position: relative !important;
			z-index: 1 !important;
		}
		.BasicUI .gdl-lam-title,
		.gdl-lam-title {
			display: flex !important;
			align-items: center !important;
			gap: 12px !important;
			color: #ffffff !important;
			font-size: 20px !important;
			font-weight: 700 !important;
			padding-right: 48px !important;
		}
		.BasicUI .gdl-lam-game-icon,
		.gdl-lam-game-icon {
			width: 34px !important;
			height: 34px !important;
			max-width: 34px !important;
			max-height: 34px !important;
			object-fit: cover !important;
			border-radius: 3px !important;
			background: #17202b !important;
			flex-shrink: 0 !important;
			display: block !important;
		}
		.BasicUI .gdl-lam-close,
		.gdl-lam-close {
			position: absolute !important;
			right: -4px !important;
			top: -8px !important;
			z-index: 30 !important;
			width: 60px !important;
			height: 60px !important;
			border-radius: 50% !important;
			padding: 0 !important;
			border: 1px solid rgba(176, 190, 207, 0.28) !important;
			background: rgba(55, 63, 75, 0.88) !important;
			color: #c5c9ce !important;
			font-size: 50px !important;
			font-weight: 300 !important;
			line-height: 1 !important;
			display: flex !important;
			align-items: center !important;
			justify-content: center !important;
			cursor: pointer !important;
			outline: none !important;
			box-shadow: 0 10px 22px rgba(0, 0, 0, 0.42) !important;
			transition: background 0.15s ease, color 0.15s ease !important;
		}
		.gdl-lam-close:hover {
			background: rgba(74, 84, 98, 0.96) !important;
			color: #ffffff !important;
		}
		.BasicUI .gdl-lam-progressbox,
		.gdl-lam-progressbox {
			margin-top: 16px !important;
			position: relative !important;
		}
		.gdl-lam-progressbox.is-complete {
			display: flex !important;
			align-items: flex-start !important;
			gap: 14px !important;
		}
		.gdl-lam-progress-copy {
			flex: 1 !important;
			min-width: 0 !important;
		}
		.gdl-lam-completion-badge {
			width: 36px !important;
			height: 41px !important;
			flex: 0 0 36px !important;
			display: flex !important;
			align-items: flex-start !important;
			justify-content: center !important;
			margin-top: 1px !important;
		}
		.gdl-lam-completion-art {
			width: 36px !important;
			height: 41px !important;
			display: block !important;
			object-fit: contain !important;
		}
		.BasicUI .gdl-lam-progressline,
		.gdl-lam-progressline {
			display: flex !important;
			justify-content: space-between !important;
			font-size: 13px !important;
			color: #d6d7d8 !important;
			font-weight: 700 !important;
			letter-spacing: 0.5px !important;
			text-transform: uppercase !important;
		}
		.BasicUI .gdl-lam-track,
		.gdl-lam-track {
			height: 8px !important;
			margin-top: 8px !important;
			background: rgba(255, 255, 255, 0.15) !important;
			border-radius: 4px !important;
			overflow: hidden !important;
		}
		.BasicUI .gdl-lam-fill,
		.gdl-lam-fill {
			height: 100% !important;
			background: #1a9fff !important;
			border-radius: 4px !important;
			transition: width 0.3s ease !important;
		}
		.BasicUI .gdl-lam-tabs,
		.gdl-lam-tabs {
			display: flex !important;
			align-items: center !important;
			justify-content: center !important;
			gap: 12px !important;
			margin-top: 16px !important;
		}
		.BasicUI .gdl-lam-tab,
		.gdl-lam-tab {
			border: 0 !important;
			background: transparent !important;
			color: #ffffff !important;
			font-weight: 700 !important;
			font-size: 13px !important;
			letter-spacing: 0.5px !important;
			text-transform: uppercase !important;
			padding: 8px 24px !important;
			border-radius: 20px !important;
			cursor: pointer !important;
			outline: none !important;
			transition: all 0.15s ease !important;
		}
		.gdl-lam-tab:hover {
			background: rgba(255, 255, 255, 0.08) !important;
			color: #ffffff !important;
		}
		.BasicUI .gdl-lam-tab.active,
		.gdl-lam-tab.active {
			background: rgba(106, 54, 34, 0.78) !important;
			color: #ffffff !important;
			box-shadow: 0 2px 8px rgba(0, 0, 0, 0.24) !important;
		}
		.BasicUI .gdl-lam-toolbar,
		.gdl-lam-toolbar {
			display: flex !important;
			justify-content: flex-end !important;
			padding: 12px 28px 6px !important;
			background: rgba(18, 24, 32, 0.72) !important;
			flex-shrink: 0 !important;
		}
		.BasicUI .gdl-lam-search,
		.gdl-lam-search {
			width: 242px !important;
			background: rgba(19, 23, 29, 0.88) !important;
			border: 1px solid #232a35 !important;
			border-radius: 3px !important;
			color: #8f98a0 !important;
			padding: 10px 12px !important;
			font-size: 13px !important;
			font-style: italic !important;
			outline: none !important;
			transition: border-color 0.2s, box-shadow 0.2s !important;
		}
		.gdl-lam-search:focus {
			border-color: #1a9fff !important;
			color: #e1e5ea !important;
		}
		.BasicUI .gdl-lam-list,
		.gdl-lam-list {
			flex: 1 !important;
			overflow-y: auto !important;
			padding: 8px 28px 8px !important;
			background: rgba(18, 24, 32, 0.72) !important;
		}
		.BasicUI .gdl-lam-row,
		.gdl-lam-row {
			min-height: 80px !important;
			background: rgba(31, 37, 46, 0.9) !important;
			margin-bottom: 8px !important;
			display: flex !important;
			align-items: center !important;
			padding: 12px 16px !important;
			gap: 16px !important;
			border: 1px solid rgba(255, 255, 255, 0.02) !important;
			border-radius: 2px !important;
			transition: background 0.12s ease !important;
		}
		.gdl-lam-row:hover {
			background: rgba(38, 45, 56, 0.96) !important;
		}
		/* Official Steam 1:1 modal achievement icon frame */
		.BasicUI .gdl-lam-row-icon-frame,
		.gdl-lam-row-icon-frame {
			position: relative !important;
			width: 64px !important;
			height: 64px !important;
			min-width: 64px !important;
			max-width: 64px !important;
			flex: 0 0 64px !important;
			display: inline-block !important;
			border-radius: 3px !important;
			overflow: visible !important;
			background: linear-gradient(180deg, #101722 0%, #121820 100%) !important;
			box-sizing: border-box !important;
			border: 1px solid rgba(0, 0, 0, 0.42) !important;
		}
		.gdl-lam-row-icon-frame.is-rare {
			border-color: transparent !important;
			background: transparent !important;
		}
		.BasicUI .gdl-lam-row-icon-frame .gdl-lam-row-icon,
		.gdl-lam-row-icon-frame .gdl-lam-row-icon {
			position: relative !important;
			z-index: 2 !important;
			width: 100% !important;
			height: 100% !important;
			object-fit: cover !important;
			border-radius: 2px !important;
			border: none !important;
			box-shadow: 0 0 3px rgba(0, 0, 0, 0.333) !important;
			cursor: pointer !important;
		}
		.gdl-lam-row-icon-frame:not(.is-highlighted) .gdl-lam-row-icon {
			border: 1px solid rgba(255, 255, 255, 0.06) !important;
		}
		.gdl-lam-row-icon.locked {
			filter: grayscale(1) brightness(0.48) !important;
			opacity: 0.85 !important;
		}
		.BasicUI .gdl-lam-row-main,
		.gdl-lam-row-main {
			min-width: 0 !important;
			flex: 1 !important;
		}
		.BasicUI .gdl-lam-row-title,
		.gdl-lam-row-title {
			font-size: 15px !important;
			font-weight: 700 !important;
			color: #ffffff !important;
		}
		.BasicUI .gdl-lam-row-desc,
		.gdl-lam-row-desc {
			font-size: 13px !important;
			color: #8f98a0 !important;
			margin-top: 2px !important;
			line-height: 17px !important;
		}
		.BasicUI .gdl-lam-row-global,
		.gdl-lam-row-global {
			font-size: 12px !important;
			color: #8f98a0 !important;
			margin-top: 3px !important;
		}
		.BasicUI .gdl-lam-row-right,
		.gdl-lam-row-right {
			min-width: 200px !important;
			text-align: right !important;
			color: #8f98a0 !important;
			font-size: 12px !important;
			line-height: 17px !important;
		}
		.BasicUI .gdl-lam-empty,
		.gdl-lam-empty {
			padding: 40px 20px !important;
			text-align: center !important;
			color: #8f98a0 !important;
			font-size: 15px !important;
		}
	`);
}
