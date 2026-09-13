import { injectAchievementStyle } from './inject';
import { steamRareAchievementStyles } from './rare';


export function ensureAchievementSidebarStyles(doc: Document): void {
	injectAchievementStyle(doc, 'gdl-achievement-sidebar-style', `
		#gdl-achievements-section {
			overflow: visible !important;
			margin: 0 !important;
		}
		/* Normal linked-game sections clone Steam's live H2 node, so never override
		   that heading: it must inherit the exact native font metrics/alignment.
		   This fallback is only used when a native heading is temporarily unavailable. */
		.gdl-native-section-heading {
			font-family: "Motiva Sans", Arial, Helvetica, sans-serif;
			font-size: 14px;
			font-weight: 400;
			color: #8f98a0;
			text-transform: uppercase;
			letter-spacing: .7px;
			margin: 0 0 8px 0;
			padding: 0;
			line-height: 20px;
			user-select: none;
		}
		@keyframes gdl-achievement-focus-pulse {
			0% { box-shadow:0 0 0 0 rgba(26,159,255,0),0 0 0 rgba(26,159,255,0); }
			25% { box-shadow:0 0 0 4px rgba(26,159,255,.48),0 0 28px rgba(26,159,255,.72); }
			100% { box-shadow:0 0 0 0 rgba(26,159,255,0),0 0 0 rgba(26,159,255,0); }
		}
		#gdl-achievements-section.gdl-achievement-focus { position:relative;z-index:2;animation:gdl-achievement-focus-pulse 1.35s ease-out; }

${steamRareAchievementStyles()}

		/* Native Steam translucent panel matching official client */
		#gdl-achievements-section, #gdl-achievements-section *, .gdl-la-summary {
			box-sizing: border-box !important;
		}
		.gdl-la-summary,
		.BasicUI .gdl-la-summary {
			display: flex !important;
			flex-direction: column !important;
			width: 100% !important;
			min-width: 0 !important;
			max-width: 100% !important;
			box-sizing: border-box !important;
			background: var(--gdl-native-panel-bg, rgba(29, 36, 45, .65)) !important;
			border: 1px solid var(--gdl-native-panel-border, rgba(255, 255, 255, .04)) !important;
			border-radius: 0 !important;
			padding: 0 !important;
			font-family: "Motiva Sans", Arial, Helvetica, sans-serif !important;
			color: #d6d7d8 !important;
			cursor: pointer !important;
			overflow: visible !important;
			position: relative !important;
			box-shadow: none !important;
			transition: border-color .12s ease, background-color .12s ease !important;
		}
		.gdl-la-summary:hover,
		.BasicUI .gdl-la-summary:hover {
			border-color: rgba(255, 255, 255, .08) !important;
		}

		/* 100% Rosette Medal overlapping top-left corner */
		.gdl-la-ribbon-badge,
		.BasicUI .gdl-la-ribbon-badge {
			position: absolute !important;
			left: -11px !important;
			top: 1px !important;
			width: 70px !important;
			height: 76px !important;
			display: flex !important;
			align-items: center !important;
			justify-content: center !important;
			z-index: 3 !important;
			pointer-events: none !important;
		}
		.gdl-la-ribbon-art,
		.BasicUI .gdl-la-ribbon-art {
			width: 70px !important;
			height: 76px !important;
			display: block !important;
			object-fit: contain !important;
			image-rendering: auto !important;
			filter: drop-shadow(0 2px 2px rgba(0,0,0,.55)) !important;
		}

		.gdl-la-header,
		.BasicUI .gdl-la-header {
			position: relative !important;
			background: rgba(56, 66, 78, .55) !important;
			padding: 11px 10px 14px 10px !important;
			border-bottom: 1px solid rgba(0, 0, 0, .3) !important;
			display: flex !important;
			flex-direction: column !important;
			width: 100% !important;
			box-sizing: border-box !important;
			flex-shrink: 0 !important;
			visibility: visible !important;
			opacity: 1 !important;
		}
		.gdl-la-header.is-complete,
		.BasicUI .gdl-la-header.is-complete {
			padding: 7px 10px 7px 52px !important;
			min-height: 70px !important;
			display: flex !important;
			flex-direction: column !important;
			justify-content: center !important;
			position: relative !important;
			width: 100% !important;
			box-sizing: border-box !important;
			flex-shrink: 0 !important;
		}

		.gdl-la-unlocked,
		.BasicUI .gdl-la-unlocked {
			display: block !important;
			font-size: 13px !important;
			font-weight: 600 !important;
			line-height: 17px !important;
			margin: 0 !important;
			color: #ebebeb !important;
			white-space: normal !important;
			visibility: visible !important;
			opacity: 1 !important;
		}
		.gdl-la-unlocked .pct {
			color: #8f98a0 !important;
			font-weight: 400 !important;
		}
		.gdl-la-unlocked-sub,
		.BasicUI .gdl-la-unlocked-sub {
			display: block !important;
			font-size: 12px !important;
			color: #8f98a0 !important;
			line-height: 15px !important;
			margin: 1px 0 0 !important;
			font-weight: 400 !important;
			visibility: visible !important;
			opacity: 1 !important;
		}
		.gdl-la-header.is-complete .gdl-la-unlocked {
			white-space: nowrap !important;
			overflow: hidden !important;
			text-overflow: ellipsis !important;
		}

		.gdl-la-progress-track,
		.BasicUI .gdl-la-progress-track {
			height: 8px !important;
			background: rgba(0, 0, 0, .72) !important;
			border-radius: 2px !important;
			overflow: hidden !important;
			margin: 8px 0 0 0 !important;
			box-shadow: inset 0 1px 2px rgba(0, 0, 0, .8) !important;
			width: 100% !important;
			display: block !important;
			visibility: visible !important;
			flex-shrink: 0 !important;
		}
		.gdl-la-header.is-complete .gdl-la-progress-track,
		.BasicUI .gdl-la-header.is-complete .gdl-la-progress-track {
			margin-top: 4px !important;
			margin-left: 0 !important;
			background: rgba(0, 0, 0, .5) !important;
			position: relative !important;
			z-index: 1 !important;
		}
		.gdl-la-progress-fill,
		.BasicUI .gdl-la-progress-fill {
			height: 100% !important;
			background: #2b78ff !important;
			border-radius: 2px !important;
			min-width: 0 !important;
			transition: width .3s ease !important;
			display: block !important;
		}

		.gdl-la-body,
		.BasicUI .gdl-la-body {
			display: flex !important;
			flex-direction: column !important;
			width: 100% !important;
			box-sizing: border-box !important;
			padding: 16px 10px 10px 10px !important;
			background: linear-gradient(180deg, rgba(24, 30, 39, .24) 0%, rgba(16, 22, 30, .16) 100%) !important;
			backdrop-filter: blur(8px) saturate(112%) !important;
			-webkit-backdrop-filter: blur(8px) saturate(112%) !important;
			min-width: 0 !important;
			overflow: visible !important;
			flex-shrink: 0 !important;
			visibility: visible !important;
			opacity: 1 !important;
		}

		.gdl-la-feature,
		.BasicUI .gdl-la-feature {
			display: flex !important;
			flex-direction: row !important;
			gap: 8px !important;
			align-items: center !important;
			margin: 0 0 7px !important;
			min-width: 0 !important;
			width: 100% !important;
		}
		.gdl-la-feature .gdl-la-icon-frame {
			flex: 0 0 48px !important;
			width: 48px !important;
			height: 48px !important;
			min-width: 48px !important;
			max-width: 48px !important;
			min-height: 48px !important;
			max-height: 48px !important;
			aspect-ratio: 1 !important;
		}
		.gdl-la-feature-copy,
		.BasicUI .gdl-la-feature-copy,
		.gdl-la-feature .gdl-la-feature-copy {
			min-width: 0 !important;
			flex: 1 1 auto !important;
			display: flex !important;
			flex-direction: column !important;
			padding-top: 1px !important;
			visibility: visible !important;
			opacity: 1 !important;
		}
		.gdl-la-feature-title,
		.BasicUI .gdl-la-feature-title {
			display: block !important;
			font-size: 13px !important;
			font-weight: 600 !important;
			color: #d6d7d8 !important;
			white-space: nowrap !important;
			overflow: hidden !important;
			text-overflow: ellipsis !important;
			line-height: 16px !important;
			visibility: visible !important;
		}
		.gdl-la-feature-desc,
		.BasicUI .gdl-la-feature-desc {
			display: -webkit-box !important;
			-webkit-line-clamp: 2 !important;
			-webkit-box-orient: vertical !important;
			overflow: hidden !important;
			text-overflow: ellipsis !important;
			font-size: 12px !important;
			font-weight: 400 !important;
			color: #8f98a0 !important;
			line-height: 15px !important;
			margin-top: 2px !important;
			visibility: visible !important;
		}
		.gdl-la-feature-stat,
		.BasicUI .gdl-la-feature-stat {
			display: block !important;
			font-size: 12px !important;
			color: #717070 !important;
			margin-top: 2px !important;
			visibility: visible !important;
		}

		.gdl-la-earned-row-wrap,
		.gdl-la-locked-row-wrap,
		.BasicUI .gdl-la-earned-row-wrap,
		.BasicUI .gdl-la-locked-row-wrap {
			width: 100% !important;
			min-width: 0 !important;
			display: block !important;
			box-sizing: border-box !important;
		}

		.gdl-la-icon-row,
		.BasicUI .gdl-la-icon-row {
			display: grid !important;
			grid-template-columns: repeat(var(--gdl-achievement-columns, 5), 48px) !important;
			grid-auto-rows: 48px !important;
			gap: 8px !important;
			align-items: center !important;
			justify-content: start !important;
			width: 100% !important;
			min-width: 0 !important;
			max-width: 100% !important;
		}

		/* Official Steam 1:1 achievement icon frame */
		.gdl-la-icon-frame,
		.BasicUI .gdl-la-icon-frame {
			position: relative !important;
			width: 48px !important;
			height: 48px !important;
			min-width: 48px !important;
			max-width: 48px !important;
			min-height: 48px !important;
			max-height: 48px !important;
			aspect-ratio: 1 !important;
			display: inline-block !important;
			background: linear-gradient(180deg, #0f1720 0%, #101820 100%) !important;
			border: 1px solid rgba(0, 0, 0, .46) !important;
			box-sizing: border-box !important;
			overflow: visible !important;
		}
		.gdl-la-icon-frame.is-rare,
		.BasicUI .gdl-la-icon-frame.is-rare {
			border-color: transparent !important;
			background: transparent !important;
		}
		.gdl-la-icon-frame .gdl-la-icon,
		.BasicUI .gdl-la-icon-frame .gdl-la-icon {
			position: relative !important;
			z-index: 2 !important;
			width: 100% !important;
			height: 100% !important;
			object-fit: cover !important;
			display: block !important;
			border: none !important;
			box-shadow: 0 0 3px rgba(0, 0, 0, .333) !important;
			cursor: pointer !important;
		}
		.gdl-la-icon.is-locked,
		.BasicUI .gdl-la-icon.is-locked {
			filter: grayscale(1) brightness(.36) !important;
			opacity: .82 !important;
		}
		.gdl-la-icon-fallback,
		.BasicUI .gdl-la-icon-fallback {
			display: flex !important;
			align-items: center !important;
			justify-content: center !important;
			font-size: 18px !important;
			background: #131b25 !important;
			color: #78818d !important;
		}
		.gdl-la-icon-fallback.is-locked,
		.BasicUI .gdl-la-icon-fallback.is-locked { color: #49515b !important; }

		.gdl-la-divider,
		.BasicUI .gdl-la-divider {
			height: 1px !important;
			background: rgba(255, 255, 255, 0.08) !important;
			margin: 14px 0 10px !important;
			display: block !important;
			visibility: visible !important;
		}
		.gdl-la-locked-label,
		.BasicUI .gdl-la-locked-label {
			font-size: 12px !important;
			color: #8f98a0 !important;
			line-height: 16px !important;
			margin-bottom: 8px !important;
			font-weight: 400 !important;
			display: block !important;
			visibility: visible !important;
		}
		.gdl-la-more,
		.BasicUI .gdl-la-more {
			width: 48px !important;
			height: 48px !important;
			min-width: 48px !important;
			max-width: 48px !important;
			min-height: 48px !important;
			max-height: 48px !important;
			aspect-ratio: 1 !important;
			display: flex !important;
			align-items: center !important;
			justify-content: center !important;
			background: rgba(32, 42, 54, .9) !important;
			color: #ebebeb !important;
			font-size: 13px !important;
			font-weight: 600 !important;
			border: 1px solid rgba(255, 255, 255, .04) !important;
			box-sizing: border-box !important;
		}
		.gdl-la-view,
		.BasicUI .gdl-la-view {
			margin: 18px 0 0 auto !important;
			padding: 6px 12px !important;
			width: max-content !important;
			max-width: 100% !important;
			text-align: right !important;
			color: #8f98a0 !important;
			font-size: 12px !important;
			line-height: 16px !important;
			cursor: pointer !important;
			transition: color .12s ease, background-color .12s ease !important;
			display: block !important;
			visibility: visible !important;
		}
		.gdl-la-view:hover,
		.BasicUI .gdl-la-view:hover { color: #ffffff !important; background: rgba(115, 116, 136, .42) !important; text-decoration: none !important; }

		/* One translucency level for every NativeGameLink box in Steam's right sidebar.
		   Solid inner headers (achievements/trading cards) keep their own explicit
		   backgrounds and therefore are intentionally not affected. */
		#gdl-controller-section,
		#gdl-achievements-section,
		#gdl-trading-cards-section,
		#gdl-dlc-section,
		#gdl-workshop-section,
		#gdl-friends-section,
		#gdl-community-section {
			--gdl-right-sidebar-box-bg: rgba(18, 24, 32, .32);
		}
		#gdl-controller-section .gdl-native-sidebar-panel,
		#gdl-trading-cards-section .gdl-native-sidebar-panel,
		#gdl-dlc-section .gdl-native-sidebar-panel,
		#gdl-workshop-section .gdl-native-sidebar-panel,
		#gdl-friends-section #gdl-friends-content,
		#gdl-community-section .gdl-native-sidebar-panel {
			background: var(--gdl-right-sidebar-box-bg) !important;
		}

		/* Achievements mirrors Steam's split surface: solid header over a lighter,
		   translucent body that lets the game artwork bleed through. */
		#gdl-achievements-section .gdl-la-summary {
			background: transparent !important;
		}
		#gdl-achievements-section .gdl-la-header {
			backdrop-filter: none !important;
			-webkit-backdrop-filter: none !important;
		}

		/* Defer vertical spacing between right-sidebar sections to Steam's cloned wrapper nodes. */
		#gdl-controller-section,
		#gdl-achievements-section,
		#gdl-trading-cards-section,
		#gdl-dlc-section,
		#gdl-workshop-section,
		#gdl-friends-section,
		#gdl-community-section {
			margin-top: 0 !important;
			margin-bottom: 0 !important;
		}
	`);
}
