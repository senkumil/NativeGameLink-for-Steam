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
			box-sizing: border-box;
		}
		.gdl-la-summary {
			width: 100%;
			min-width: 0;
			max-width: 100%;
			background: var(--gdl-native-panel-bg, rgba(29, 36, 45, .65)) !important;
			border: 1px solid var(--gdl-native-panel-border, rgba(255, 255, 255, .04));
			border-radius: 0;
			padding: 0;
			font-family: "Motiva Sans", Arial, Helvetica, sans-serif;
			color: #d6d7d8;
			cursor: pointer;
			overflow: visible !important;
			position: relative;
			box-shadow: none;
			transition: border-color .12s ease, background-color .12s ease;
		}
		.gdl-la-summary:hover {
			border-color: rgba(255, 255, 255, .08);
		}

		/* 100% Rosette Medal overlapping top-left corner */
		.gdl-la-ribbon-badge {
			position: absolute;
			left: -11px;
			top: 1px;
			width: 70px;
			height: 76px;
			display: flex;
			align-items: center;
			justify-content: center;
			z-index: 3;
			pointer-events: none;
		}
		.gdl-la-ribbon-art {
			width: 70px;
			height: 76px;
			display: block;
			object-fit: contain;
			image-rendering: auto;
			filter: drop-shadow(0 2px 2px rgba(0,0,0,.55));
		}

		.gdl-la-header {
			position: relative;
			background: rgba(56, 66, 78, .55) !important;
			padding: 11px 10px 14px 10px;
			border-bottom: 1px solid rgba(0, 0, 0, .3) !important;
		}
		.gdl-la-header.is-complete {
			padding: 7px 10px 7px 52px;
			min-height: 70px;
			display: flex;
			flex-direction: column;
			justify-content: center;
			position: relative;
		}

		.gdl-la-unlocked {
			font-size: 13px;
			font-weight: 600;
			line-height: 17px;
			margin: 0;
			color: #ebebeb;
		}
		.gdl-la-unlocked .pct {
			color: #8f98a0;
			font-weight: 400;
		}
		.gdl-la-unlocked-sub {
			font-size: 12px;
			color: #8f98a0;
			line-height: 15px;
			margin: 1px 0 0;
			font-weight: 400;
		}
		.gdl-la-header.is-complete .gdl-la-unlocked {
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.gdl-la-progress-track {
			height: 8px;
			background: rgba(0, 0, 0, .72);
			border-radius: 2px;
			overflow: hidden;
			margin: 8px 0 0 0;
			box-shadow: inset 0 1px 2px rgba(0, 0, 0, .8);
			width: 100%;
		}
		.gdl-la-header.is-complete .gdl-la-progress-track {
			margin-top: 4px;
			margin-left: 0;
			background: rgba(0, 0, 0, .5);
			position: relative;
			z-index: 1;
		}
		.gdl-la-progress-fill {
			height: 100%;
			background: #2b78ff;
			border-radius: 2px;
			min-width: 0;
			transition: width .3s ease;
		}

		.gdl-la-body {
			padding: 16px 10px 10px 10px;
			background: linear-gradient(180deg, rgba(24, 30, 39, .24) 0%, rgba(16, 22, 30, .16) 100%) !important;
			backdrop-filter: blur(8px) saturate(112%) !important;
			-webkit-backdrop-filter: blur(8px) saturate(112%) !important;
			min-width: 0;
			overflow: visible;
		}

		.gdl-la-feature {
			display: flex;
			gap: 8px;
			align-items: center;
			margin: 0 0 7px;
			min-width: 0;
		}
		.gdl-la-feature .gdl-la-icon-frame {
			flex: 0 0 48px;
			width: 48px;
			height: 48px;
			max-width: 48px;
			aspect-ratio: 1;
		}
		.gdl-la-feature-copy {
			min-width: 0;
			flex: 1;
			padding-top: 1px;
		}
		.gdl-la-feature-title {
			font-size: 13px;
			font-weight: 600;
			color: #d6d7d8;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
			line-height: 16px;
		}
		.gdl-la-feature-desc {
			font-size: 12px;
			font-weight: 400;
			color: #8f98a0;
			line-height: 15px;
			display: -webkit-box;
			-webkit-line-clamp: 2;
			-webkit-box-orient: vertical;
			overflow: hidden;
			text-overflow: ellipsis;
			margin-top: 2px;
		}

		.gdl-la-icon-row {
			display: grid;
			grid-template-columns: repeat(var(--gdl-achievement-columns, 5), 48px);
			grid-auto-rows: 48px;
			gap: 8px;
			align-items: center;
			justify-content: start;
			width: 100%;
			min-width: 0;
			max-width: 100%;
		}

		/* Official Steam 1:1 achievement icon frame */
		.gdl-la-icon-frame {
			position: relative;
			width: 48px;
			height: 48px;
			min-width: 48px;
			max-width: 48px;
			aspect-ratio: 1;
			display: inline-block;
			background: linear-gradient(180deg, #0f1720 0%, #101820 100%);
			border: 1px solid rgba(0, 0, 0, .46);
			box-sizing: border-box;
			overflow: visible;
		}
		.gdl-la-icon-frame.is-rare {
			border-color: transparent;
			background: transparent;
		}
		.gdl-la-icon-frame .gdl-la-icon {
			position: relative;
			z-index: 2;
			width: 100%;
			height: 100%;
			object-fit: cover;
			display: block;
			border: none !important;
			box-shadow: 0 0 3px rgba(0, 0, 0, .333);
			cursor: pointer;
		}
		.gdl-la-icon.is-locked {

			filter: grayscale(1) brightness(.36);
			opacity: .82;
		}
		.gdl-la-icon-fallback {
			display: flex;
			align-items: center;
			justify-content: center;
			font-size: 18px;
			background: #131b25;
			color: #78818d;
		}
		.gdl-la-icon-fallback.is-locked { color: #49515b; }

		.gdl-la-divider {
			height: 1px;
			background: rgba(255, 255, 255, 0.08);
			margin: 14px 0 10px;
		}
		.gdl-la-locked-label {
			font-size: 12px;
			color: #8f98a0;
			line-height: 16px;
			margin-bottom: 8px;
			font-weight: 400;
		}
		.gdl-la-more {
			width: 48px;
			height: 48px;
			min-width: 48px;
			max-width: 48px;
			aspect-ratio: 1;
			display: flex;
			align-items: center;
			justify-content: center;
			background: rgba(32, 42, 54, .9);
			color: #ebebeb;
			font-size: 13px;
			font-weight: 600;
			border: 1px solid rgba(255, 255, 255, .04);
			box-sizing: border-box;
		}
		.gdl-la-view {
			margin: 18px 0 0 auto;
			padding: 6px 12px;
			width: max-content;
			max-width: 100%;
			text-align: right;
			color: #8f98a0;
			font-size: 12px;
			line-height: 16px;
			cursor: pointer;
			transition: color .12s ease, background-color .12s ease;
			display: block;
		}
		.gdl-la-view:hover { color: #ffffff; background: rgba(115, 116, 136, .42); text-decoration: none; }

		/* Steam's controller capability surface matching official native layout */
		#gdl-controller-section { margin: 0 !important; }
		.gdl-controller-card {
			height: auto !important;
			min-height: unset !important;
			padding: 11px 16px 11px 12px !important;
			box-sizing: border-box !important;
			/* Native-like glass matching native Steam right sidebar panels. */
			background: rgba(20, 27, 36, .30) !important;
			border: 1px solid rgba(255, 255, 255, .085) !important;
			border-radius: 0 !important;
			box-shadow: inset 0 1px 0 rgba(255, 255, 255, .018) !important;
			backdrop-filter: none !important;
			-webkit-backdrop-filter: none !important;
			transition: background-color .20s ease, border-color .20s ease, box-shadow .20s ease !important;
			cursor: pointer;
			position: relative;
			padding: 12px 14px;
		}
		#gdl-controller-section[data-gdl-controller-scrolled="1"] .gdl-controller-card {
			background: rgba(16, 22, 30, .14) !important;
			border-color: rgba(255, 255, 255, .06) !important;
			box-shadow: inset 0 1px 0 rgba(255, 255, 255, .012) !important;
		}
		.gdl-controller-card:hover {
			border-color: rgba(255, 255, 255, .12) !important;
			box-shadow: inset 0 1px 0 rgba(255, 255, 255, .045) !important;
		}
		/* Steam Webpack Module 10191 Controller Classes & Semantic Fallbacks */
		._2A8NghNvAnMQQTHsudFu7H, .gdl-controller-status-svg {
			width: 44px !important;
			min-width: 44px !important;
			flex-basis: 44px !important;
			height: 44px !important;
			color: #ffffff;
			margin-inline-start: 4px;
			display: flex;
			align-items: center;
			justify-content: center;
			flex-shrink: 0;
		}
		._2A8NghNvAnMQQTHsudFu7H svg, .gdl-controller-status-svg svg {
			width: 100%;
			height: 100%;
			display: block;
		}
		._2A8NghNvAnMQQTHsudFu7H._3vJM7qN0DSpUfz-bhkewEQ, .gdl-controller-status-svg.gdl-controller-unknown {
			color: #95999e !important;
		}
		._29FYex2d6Tntax9SEBTxkL, .gdl-controller-stroke {
			position: absolute !important;
			width: 52px !important;
			height: 3px !important;
			top: 32px !important;
			inset-inline-start: 10px !important;
			background: #e05f5f !important;
			transform: rotate(155.43deg) !important;
			z-index: 2 !important;
			pointer-events: none !important;
		}
		.bG5F-o9ZUikaoNCIniMEa, .gdl-controller-body {
			display: flex;
			flex-direction: column;
			position: relative;
			min-width: 0;
		}
		.Gs_qHIFwN4Z9JusWrfbfP, .gdl-controller-row {
			display: flex;
			flex-direction: row;
			align-items: center;
			min-width: 0;
		}
		._1vvIpx6zQ1mZiiY1y-PtlS, .gdl-controller-column {
			display: flex;
			flex-direction: column;
			margin-inline-start: 14px;
			margin-top: 2px;
			min-width: 0;
			flex: 1;
		}
		._2L06P_EWxoS_20kC2eNCQl, .gdl-controller-header {
			color: #ffffff;
			font-family: "Motiva Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
			font-style: normal;
			font-weight: 500;
			font-size: 13px;
			line-height: 19px;
			text-wrap: wrap;
		}
		._8tm4KhHFNHvzsiuuyHgld, .gdl-controller-desc {
			display: flex;
			font-family: "Motiva Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
			font-style: normal;
			font-weight: 400;
			font-size: 12px;
			line-height: 17px;
			text-wrap: wrap;
			color: #cacbcd;
			margin-top: 2px;
		}
		.QO0udpE4qSEcDjkVg5IwH, .gdl-controller-button-container {
			display: flex;
			justify-content: flex-end;
			margin-top: 10px;
		}
		._3Cdin80d-hVsakHUZboheb, .gdl-controller-link {
			color: #8c9193;
			font-size: 12px;
			line-height: 16px;
			font-family: "Motiva Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
			background: transparent;
			border: 0;
			cursor: pointer;
			padding: 0;
			transition: color .15s ease;
		}
		.gdl-controller-card:hover ._3Cdin80d-hVsakHUZboheb,
		.gdl-controller-card:hover .gdl-controller-link,
		._3Cdin80d-hVsakHUZboheb:hover,
		.gdl-controller-link:hover {
			color: #ffffff !important;
		}

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
