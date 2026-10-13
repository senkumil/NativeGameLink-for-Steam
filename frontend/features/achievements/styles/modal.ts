import { injectAchievementStyle } from './inject';
import { steamRareAchievementStyles } from './rare';

export function ensureAchievementModalStyles(doc: Document): void {
	injectAchievementStyle(doc, 'gdl-achievement-modal-style', `
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
			padding: 56px 0 0 !important;
			box-sizing: border-box !important;
			overflow: visible !important;
			font-family: "Motiva Sans", Arial, Helvetica, sans-serif !important;
			color: #dcdedf !important;
			outline: none !important;
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
${steamRareAchievementStyles().replace(/#gdl-achievement-modal/g, '#gdl-local-achievement-modal')}
		.BasicUI .gdl-lam-window,
		.gdl-lam-window {
			position: relative !important;
			width: 75% !important;
			max-width: 848px !important;
			height: 100% !important;
			min-height: 0 !important;
			display: flex !important;
			flex-direction: column !important;
			background: #0e141b !important;
			border: 1px solid #2c2f36 !important;
			border-radius: 4px !important;
			box-shadow: 0 0 32px #000 !important;
			overflow: visible !important;
		}
		.BasicUI .gdl-lam-head,
		.gdl-lam-head {
			position: relative !important;
			padding: 26px 24px 12px !important;
			background: #0e141b !important;
			border: none !important;
			border-radius: 3px 3px 0 0 !important;
			overflow: hidden !important;
			flex-shrink: 0 !important;
		}
		.BasicUI .gdl-lam-head::before,
		.gdl-lam-head::before {
			content: '';
			position: absolute;
			inset: -20px;
			background-image: var(--gdl-lam-hero-image);
			background-position: center center;
			background-size: cover;
			filter: brightness(0.6) blur(20px);
			pointer-events: none;
		}
		.BasicUI .gdl-lam-head::after,
		.gdl-lam-head::after {
			content: '';
			position: absolute;
			inset: 0;
			background: linear-gradient(180deg, rgba(0, 0, 0, 0.18), rgba(0, 0, 0, 0.32));
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
			gap: 10px !important;
			height: 32px !important;
			min-width: 0 !important;
			color: #fff !important;
			font-size: 22px !important;
			line-height: 32px !important;
			font-weight: 700 !important;
		}
		.gdl-lam-title > span {
			min-width: 0 !important;
			overflow: hidden !important;
			text-overflow: ellipsis !important;
			white-space: nowrap !important;
		}
		.BasicUI .gdl-lam-game-icon,
		.gdl-lam-game-icon {
			width: 32px !important;
			height: 32px !important;
			max-width: 32px !important;
			max-height: 32px !important;
			object-fit: cover !important;
			border: none !important;
			border-radius: 0 !important;
			flex: 0 0 32px !important;
			display: block !important;
		}
		.BasicUI .gdl-lam-close,
		.gdl-lam-close {
			position: absolute !important;
			right: -10px !important;
			top: -10px !important;
			z-index: 30 !important;
			width: 50px !important;
			height: 50px !important;
			border-radius: 50% !important;
			padding: 8px !important;
			border: 1px solid #656b73 !important;
			background: #282c34 !important;
			color: #9e9ead !important;
			display: flex !important;
			align-items: center !important;
			justify-content: center !important;
			cursor: pointer !important;
			outline: none !important;
			box-shadow: 0 3px 32px #000 !important;
			transition: background 0.15s ease, color 0.15s ease !important;
		}
		.gdl-lam-close:hover {
			background: #575761 !important;
			border-color: #9e9ead !important;
			color: #fff !important;
		}
		.gdl-lam-close-icon {
			width: 30px !important;
			height: 30px !important;
			flex: 0 0 30px !important;
			fill: none !important;
			stroke: currentColor !important;
			stroke-width: 2px !important;
		}
		.BasicUI .gdl-lam-progressbox,
		.gdl-lam-progressbox {
			margin-top: 5px !important;
			padding: 14px !important;
			height: 60px !important;
			position: relative !important;
			background: rgba(103, 112, 123, 0.2) !important;
		}
		.gdl-lam-progressbox.is-complete {
			display: flex !important;
			align-items: center !important;
			gap: 14px !important;
		}
		.gdl-lam-progress-copy {
			flex: 1 !important;
			min-width: 0 !important;
		}
		.gdl-lam-completion-badge,
		.gdl-lam-completion-art {
			width: 30px !important;
			height: 30px !important;
			flex: 0 0 30px !important;
			display: block !important;
			object-fit: contain !important;
		}
		.BasicUI .gdl-lam-progressline,
		.gdl-lam-progressline {
			display: flex !important;
			justify-content: space-between !important;
			gap: 12px !important;
			font-size: 12px !important;
			line-height: 17px !important;
			color: #dcdedf !important;
			font-weight: 700 !important;
			letter-spacing: 0.5px !important;
			text-transform: uppercase !important;
		}
		.gdl-lam-progressline > :last-child { flex-shrink: 0 !important; }
		.BasicUI .gdl-lam-track,
		.gdl-lam-track {
			height: 8px !important;
			margin-top: 7px !important;
			background: #3d4450 !important;
			border-radius: 4px !important;
			overflow: hidden !important;
		}
		.BasicUI .gdl-lam-fill,
		.gdl-lam-fill {
			height: 100% !important;
			background: #1a9fff !important;
			border-radius: 4px !important;
		}
		.BasicUI .gdl-lam-tabs,
		.gdl-lam-tabs {
			display: flex !important;
			align-items: center !important;
			justify-content: center !important;
			gap: 4px !important;
			margin-top: 12px !important;
			height: 34px !important;
		}
		.BasicUI .gdl-lam-tab,
		.gdl-lam-tab {
			border: 0 !important;
			background: transparent !important;
			color: #dcdedf !important;
			font-family: inherit !important;
			font-weight: 700 !important;
			font-size: 12px !important;
			line-height: 18px !important;
			letter-spacing: 0.5px !important;
			text-transform: uppercase !important;
			height: 34px !important;
			padding: 8px 16px !important;
			border-radius: 20px !important;
			cursor: pointer !important;
			outline: none !important;
			white-space: nowrap !important;
			transition: background 0.15s ease, color 0.15s ease !important;
		}
		.gdl-lam-tab:hover { background: rgba(255, 255, 255, 0.08) !important; color: #fff !important; }
		.BasicUI .gdl-lam-tab.active,
		.gdl-lam-tab.active {
			background: rgba(255, 255, 255, 0.15) !important;
			color: #fff !important;
			box-shadow: none !important;
		}
		.BasicUI .gdl-lam-scroll,
		.gdl-lam-scroll {
			flex: 1 !important;
			min-height: 0 !important;
			overflow-x: hidden !important;
			overflow-y: auto !important;
			background: #0e141b !important;
		}
		.gdl-lam-scroll::-webkit-scrollbar { width: 12px !important; background: transparent !important; }
		.gdl-lam-scroll::-webkit-scrollbar-thumb {
			border: 3px solid #0e141b !important;
			border-radius: 8px !important;
			background: #606875 !important;
			min-height: 32px !important;
		}
		.gdl-lam-scroll::-webkit-scrollbar-thumb:hover { background: #7b8492 !important; }
		.BasicUI .gdl-lam-toolbar,
		.gdl-lam-toolbar {
			display: flex !important;
			align-items: center !important;
			justify-content: flex-end !important;
			gap: 10px !important;
			padding: 8px 20px 0 !important;
			background: #0e141b !important;
			flex-shrink: 0 !important;
		}
		.BasicUI .gdl-lam-search,
		.gdl-lam-search,
		.BasicUI .gdl-lam-compare-control,
		.gdl-lam-compare-control {
			width: 220px !important;
			height: 42px !important;
			flex: 0 0 220px !important;
			background: #232a32 !important;
			border: 0 !important;
			border-radius: 3px !important;
			color: #dcdedf !important;
			font-family: inherit !important;
			font-size: 16px !important;
			line-height: 22px !important;
		}
		.BasicUI .gdl-lam-search,
		.gdl-lam-search {
			padding: 10px !important;
			font-size: 14px !important;
			font-style: italic !important;
			outline: none !important;
		}
		.gdl-lam-search::placeholder { color: #8b929a !important; opacity: 1 !important; }
		.gdl-lam-search:focus { box-shadow: inset 0 0 0 1px #1a9fff !important; }
		.gdl-lam-compare-control { position: relative !important; }
		.gdl-lam-compare {
			appearance: none !important;
			width: 100% !important;
			height: 100% !important;
			padding: 10px 38px 10px 12px !important;
			background: transparent !important;
			border: 0 !important;
			color: inherit !important;
			font-family: inherit !important;
			font-size: inherit !important;
			line-height: inherit !important;
			outline: none !important;
			cursor: pointer !important;
		}
		.gdl-lam-compare option { background: #232a32 !important; color: #dcdedf !important; }
		.gdl-lam-compare-chevron {
			position: absolute !important;
			right: 14px !important;
			top: 13px !important;
			width: 16px !important;
			height: 16px !important;
			color: #1a9fff !important;
			pointer-events: none !important;
		}
		.gdl-lam-compare-control[hidden],
		.gdl-lam-comparison-status[hidden] { display: none !important; }
		.gdl-lam-comparison-status {
			padding: 8px 20px 0 !important;
			font-size: 12px !important;
			line-height: 18px !important;
			color: #8b929a !important;
		}
		.BasicUI .gdl-lam-list,
		.gdl-lam-list {
			display: flex !important;
			flex-direction: column !important;
			gap: 8px !important;
			padding: 8px 20px 48px !important;
			background: #0e141b !important;
		}
		.BasicUI .gdl-lam-row,
		.gdl-lam-row {
			height: 80px !important;
			min-height: 80px !important;
			flex-shrink: 0 !important;
			background: #23262e !important;
			margin: 0 !important;
			display: flex !important;
			align-items: center !important;
			padding: 8px !important;
			gap: 8px !important;
			border: 0 !important;
			border-radius: 0 !important;
		}
		.gdl-lam-row.is-global { height: 68px !important; min-height: 68px !important; }
		.gdl-lam-row-icon-frame {
			position: relative !important;
			width: 48px !important;
			height: 48px !important;
			min-width: 48px !important;
			max-width: 48px !important;
			flex: 0 0 48px !important;
			display: inline-block !important;
			border-radius: 0 !important;
			overflow: visible !important;
			background: transparent !important;
			border: 0 !important;
		}
		.BasicUI .gdl-lam-row-icon-frame {
			width: 64px !important;
			height: 64px !important;
			min-width: 64px !important;
			max-width: 64px !important;
			flex-basis: 64px !important;
		}
		.BasicUI .gdl-lam-row-icon-frame .gdl-lam-row-icon,
		.gdl-lam-row-icon-frame .gdl-lam-row-icon {
			position: relative !important;
			z-index: 2 !important;
			width: 100% !important;
			height: 100% !important;
			object-fit: cover !important;
			vertical-align: top !important;
			border-radius: 0 !important;
			border: none !important;
			box-shadow: 0 0 3px rgba(0, 0, 0, 0.333) !important;
			cursor: pointer !important;
		}
		.gdl-lam-row-icon.locked { filter: none !important; opacity: 1 !important; }
		.BasicUI .gdl-lam-row-main,
		.gdl-lam-row-main { min-width: 0 !important; flex: 1 !important; }
		.BasicUI .gdl-lam-row-title,
		.gdl-lam-row-title {
			font-size: 16px !important;
			line-height: 20px !important;
			font-weight: 500 !important;
			color: #dcdedf !important;
		}
		.BasicUI .gdl-lam-row-desc,
		.gdl-lam-row-desc {
			font-size: 12px !important;
			color: #b8bcbf !important;
			margin: 0 !important;
			line-height: 18px !important;
		}
		.BasicUI .gdl-lam-row-global,
		.gdl-lam-row-global {
			font-size: 12px !important;
			color: #8b929a !important;
			margin: 0 !important;
			line-height: 18px !important;
		}
		.BasicUI .gdl-lam-row-right,
		.gdl-lam-row-right {
			align-self: center !important;
			min-width: 200px !important;
			text-align: right !important;
			color: #8b929a !important;
			font-size: 12px !important;
			font-weight: 400 !important;
			line-height: 16px !important;
		}
		.gdl-lam-row-progress-count,
		.gdl-lam-comparison-friend { font-size: 12px !important; line-height: 16px !important; }
		.gdl-lam-row-progress-count { color: #b8bcbf !important; font-weight: 400 !important; }
		.gdl-lam-comparison-friend { overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; }
		.gdl-lam-comparison-friend .is-earned { color: #1a9fff !important; }
		.gdl-lam-global-percent { color: #fff !important; font-size: 14px !important; font-weight: 700 !important; line-height: 18px !important; }
		.gdl-lam-row-track {
			width: 200px !important;
			height: 8px !important;
			margin: 4px 0 0 auto !important;
			background: #3d4450 !important;
			border-radius: 4px !important;
			overflow: hidden !important;
		}
		.gdl-lam-row-fill { height: 100% !important; background: #1a9fff !important; border-radius: 4px !important; }
		.BasicUI .gdl-lam-empty,
		.gdl-lam-empty { padding: 40px 20px !important; text-align: center !important; color: #8b929a !important; font-size: 15px !important; }
		@media (max-width: 900px) {
			.BasicUI #gdl-local-achievement-modal,
			#gdl-local-achievement-modal { padding-top: 20px !important; }
			.BasicUI .gdl-lam-window,
			.gdl-lam-window { width: calc(100% - 40px) !important; }
		}
		@media (max-width: 620px) {
			.BasicUI .gdl-lam-head,
			.gdl-lam-head { padding-inline: 16px !important; }
			.BasicUI .gdl-lam-title,
			.gdl-lam-title { font-size: 18px !important; }
			.BasicUI .gdl-lam-toolbar,
			.gdl-lam-toolbar { padding-inline: 12px !important; }
			.BasicUI .gdl-lam-search,
			.gdl-lam-search,
			.BasicUI .gdl-lam-compare-control,
			.gdl-lam-compare-control { width: 0 !important; min-width: 0 !important; flex: 1 1 0 !important; }
			.BasicUI .gdl-lam-list,
			.gdl-lam-list { padding-inline: 12px !important; }
			.BasicUI .gdl-lam-row,
			.gdl-lam-row { height: auto !important; min-height: 80px !important; flex-wrap: wrap !important; }
			.gdl-lam-row-main { flex-basis: calc(100% - 64px) !important; }
			.BasicUI .gdl-lam-row-right,
			.gdl-lam-row-right { margin-left: 56px !important; min-width: 0 !important; width: calc(100% - 56px) !important; }
			.gdl-lam-row-track { max-width: 100% !important; }
			.BasicUI .gdl-lam-row-main { flex-basis: calc(100% - 80px) !important; }
			.BasicUI .gdl-lam-row-right { margin-left: 72px !important; width: calc(100% - 72px) !important; }
		}
	`);
}
