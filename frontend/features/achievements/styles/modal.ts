import { injectAchievementStyle } from './inject';
import { steamRareAchievementStyles } from './rare';


export function ensureAchievementModalStyles(doc: Document): void {
	injectAchievementStyle(doc, 'gdl-achievement-modal-style', `
		/* Right-side achievements sheet matching native Steam behavior more closely */
		#gdl-local-achievement-modal {
			position: fixed;
			inset: auto;
			left: 0;
			top: 0;
			width: 0;
			height: 0;
			z-index: 2147483600;
			background: rgba(7, 11, 18, 0.34);
			backdrop-filter: blur(8px);
			display: flex;
			align-items: flex-start;
			justify-content: center;
			padding: 46px 34px 0;
			box-sizing: border-box;
			overflow: visible;
			font-family: "Motiva Sans", Arial, Helvetica, sans-serif;
			color: #d6d7d8;
			animation: gdl-lam-fadein 0.15s ease-out;
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
		.gdl-lam-window {
			width: min(840px, calc(100% - 96px));
			height: 100%;
			background: rgba(18, 24, 32, 0.72);
			border: 1px solid rgba(255, 255, 255, 0.06);
			box-shadow: 0 18px 48px rgba(0, 0, 0, 0.58);
			border-radius: 2px;
			position: relative;
			display: flex;
			flex-direction: column;
			overflow: visible;
			animation: gdl-lam-popin 0.15s ease-out;
		}
		.gdl-lam-head {
			padding: 24px 28px 16px;
			background: linear-gradient(180deg, rgba(55, 36, 24, 0.20) 0%, rgba(19, 24, 31, 0.18) 100%);
			backdrop-filter: blur(18px);
			position: relative;
			border-bottom: 1px solid rgba(255, 255, 255, 0.04);
			overflow: hidden;
		}
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
		.gdl-lam-head::after {
			content: '';
			position: absolute;
			inset: 0;
			background: linear-gradient(180deg, rgba(25, 15, 10, 0.18) 0%, rgba(17, 22, 29, 0.36) 100%);
			pointer-events: none;
		}
		.gdl-lam-head > * {
			position: relative;
			z-index: 1;
		}
		.gdl-lam-title {
			display: flex;
			align-items: center;
			gap: 12px;
			color: #ffffff;
			font-size: 20px;
			font-weight: 700;
			padding-right: 48px;
		}
		.gdl-lam-game-icon {
			width: 34px;
			height: 34px;
			object-fit: cover;
			border-radius: 3px;
			background: #17202b;
			flex-shrink: 0;
		}
		.gdl-lam-close {
			position: absolute;
			right: -4px;
			top: -8px;
			z-index: 30;
			width: 60px;
			height: 60px;
			border-radius: 50%;
			padding: 0;
			border: 1px solid rgba(176, 190, 207, 0.28);
			background: rgba(55, 63, 75, 0.88);
			color: #c5c9ce;
			font-size: 50px;
			font-weight: 300;
			line-height: 1;
			display: flex;
			align-items: center;
			justify-content: center;
			cursor: pointer;
			box-shadow: 0 10px 22px rgba(0, 0, 0, 0.42);
			transition: background 0.15s ease, color 0.15s ease;
		}
		.gdl-lam-close:hover {
			background: rgba(74, 84, 98, 0.96);
			color: #ffffff;
		}
		.gdl-lam-progressbox {
			margin-top: 16px;
			position: relative;
		}
		.gdl-lam-progressbox.is-complete {
			display: flex;
			align-items: flex-start;
			gap: 14px;
		}
		.gdl-lam-progress-copy {
			flex: 1;
			min-width: 0;
		}
		.gdl-lam-completion-badge {
			width: 36px;
			height: 41px;
			flex: 0 0 36px;
			display: flex;
			align-items: flex-start;
			justify-content: center;
			margin-top: 1px;
		}
		.gdl-lam-completion-art {
			width: 36px;
			height: 41px;
			display: block;
			object-fit: contain;
		}
		.gdl-lam-progressline {
			display: flex;
			justify-content: space-between;
			font-size: 13px;
			color: #d6d7d8;
			font-weight: 700;
			letter-spacing: 0.5px;
			text-transform: uppercase;
		}
		.gdl-lam-track {
			height: 8px;
			margin-top: 8px;
			background: rgba(255, 255, 255, 0.15);
			border-radius: 4px;
			overflow: hidden;
		}
		.gdl-lam-fill {
			height: 100%;
			background: #1a9fff;
			border-radius: 4px;
			transition: width 0.3s ease;
		}
		.gdl-lam-tabs {
			display: flex;
			align-items: center;
			justify-content: center;
			gap: 12px;
			margin-top: 16px;
		}
		.gdl-lam-tab {
			border: 0;
			background: transparent;
			color: #ffffff;
			font-weight: 700;
			font-size: 13px;
			letter-spacing: 0.5px;
			text-transform: uppercase;
			padding: 8px 24px;
			border-radius: 20px;
			cursor: pointer;
			transition: all 0.15s ease;
		}
		.gdl-lam-tab:hover {
			background: rgba(255, 255, 255, 0.08);
			color: #ffffff;
		}
		.gdl-lam-tab.active {
			background: rgba(106, 54, 34, 0.78);
			color: #ffffff;
			box-shadow: 0 2px 8px rgba(0, 0, 0, 0.24);
		}
		.gdl-lam-toolbar {
			display: flex;
			justify-content: flex-end;
			padding: 12px 28px 6px;
			background: rgba(18, 24, 32, 0.72);
		}
		.gdl-lam-search {
			width: 242px;
			background: rgba(19, 23, 29, 0.88);
			border: 1px solid #232a35;
			border-radius: 3px;
			color: #8f98a0;
			padding: 10px 12px;
			font-size: 13px;
			font-style: italic;
			outline: none;
			transition: border-color 0.2s, box-shadow 0.2s;
		}
		.gdl-lam-search:focus {
			border-color: #1a9fff;
			color: #e1e5ea;
		}
		.gdl-lam-list {
			flex: 1;
			overflow-y: auto;
			padding: 8px 28px 8px;
			background: rgba(18, 24, 32, 0.72);
		}
		.gdl-lam-row {
			min-height: 80px;
			background: rgba(31, 37, 46, 0.9);
			margin-bottom: 8px;
			display: flex;
			align-items: center;
			padding: 12px 16px;
			gap: 16px;
			border: 1px solid rgba(255, 255, 255, 0.02);
			border-radius: 2px;
			transition: background 0.12s ease;
		}
		.gdl-lam-row:hover {
			background: rgba(38, 45, 56, 0.96);
		}
		/* Official Steam 1:1 modal achievement icon frame */
		.gdl-lam-row-icon-frame {
			position: relative;
			width: 64px;
			height: 64px;
			min-width: 64px;
			max-width: 64px;
			flex: 0 0 64px;
			display: inline-block;
			border-radius: 3px;
			overflow: visible;
			background: linear-gradient(180deg, #101722 0%, #121820 100%);
			box-sizing: border-box;
			border: 1px solid rgba(0, 0, 0, 0.42);
		}
		.gdl-lam-row-icon-frame.is-rare {
			border-color: transparent;
			background: transparent;
		}
		.gdl-lam-row-icon-frame .gdl-lam-row-icon {
			position: relative;
			z-index: 2;
			width: 100%;
			height: 100%;
			object-fit: cover;
			border-radius: 2px;
			border: none !important;
			box-shadow: 0 0 3px rgba(0, 0, 0, 0.333);
			cursor: pointer;
		}
		.gdl-lam-row-icon-frame:not(.is-highlighted) .gdl-lam-row-icon {
			border: 1px solid rgba(255, 255, 255, 0.06);
		}
		.gdl-lam-row-icon.locked {
			filter: grayscale(1) brightness(0.48);
			opacity: 0.85;
		}
		.gdl-lam-row-main {

			min-width: 0;
			flex: 1;
		}
		.gdl-lam-row-title {
			font-size: 15px;
			font-weight: 700;
			color: #ffffff;
		}
		.gdl-lam-row-desc {
			font-size: 13px;
			color: #8f98a0;
			margin-top: 2px;
			line-height: 17px;
		}
		.gdl-lam-row-global {
			font-size: 12px;
			color: #8f98a0;
			margin-top: 3px;
		}
		.gdl-lam-row-right {
			min-width: 200px;
			text-align: right;
			color: #8f98a0;
			font-size: 12px;
			line-height: 17px;
		}
		.gdl-lam-empty {
			padding: 40px 20px;
			text-align: center;
			color: #8f98a0;
			font-size: 15px;
		}
	`);
}
