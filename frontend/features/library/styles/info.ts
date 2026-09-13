import { injectLibraryStyle } from './inject';

export function ensureInfoPanelStyles(doc: Document): void {
	injectLibraryStyle(doc, 'gdl-info-panel-styles', `
		[data-gdl-game-info-button="1"] { cursor:pointer;display:flex !important;align-items:center !important;justify-content:center !important;visibility:visible !important;opacity:1 !important;flex:0 0 auto !important; }
		/* Native MenuButton/DotDotDot classes own the icon dimensions. */
		[data-gdl-game-info-button="1"].gdl-info-button-fallback {
			width:40px;height:40px;display:flex;align-items:center;justify-content:center;
			padding:0;border:0;border-radius:2px;background:rgba(58,69,83,.72);color:#a8b0ba;
		}
		[data-gdl-game-info-button="1"].gdl-info-button-fallback:hover,
		[data-gdl-game-info-button="1"].gdl-info-button-fallback.gdl-info-active { background:rgba(78,91,108,.88);color:#fff;box-shadow:inset 0 1px 0 rgba(255,255,255,.12); }
		[data-gdl-game-info-button="1"].gdl-info-button-fallback svg { width:24px;height:24px;display:block; }
		[data-gdl-game-info-button="1"] svg.SVGIcon_Arrow,
		[data-gdl-game-info-button="1"] .gdl-scroll-top-icon { width: 16px; height: 16px; }

		#gdl-game-info-panel {
			transition: height 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.28s ease-in-out, transform 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
			overflow: hidden !important;
			box-sizing: border-box !important;
		}
		#gdl-game-info-panel.gdl-info-collapsed {
			height: 0px !important;
			max-height: 0px !important;
			opacity: 0 !important;
			pointer-events: none !important;
			padding-top: 0 !important;
			padding-bottom: 0 !important;
			margin-top: 0 !important;
			margin-bottom: 0 !important;
		}
		#gdl-game-info-panel.gdl-info-collapsing {
			pointer-events: none !important;
			overflow: hidden !important;
		}
		#gdl-game-info-panel.gdl-info-expanded {
			opacity: 1;
			pointer-events: auto !important;
		}

		/* When the current Steam class modules resolve successfully, Steam owns
		   the outer panel, expansion animation, column geometry and typography. */
		/* Keep the injected portrait on Steam's current 2:3 box-art geometry. The
		   private module does not constrain images inserted outside React, which
		   otherwise lets a horizontal legacy capsule cover every information
		   column. */
		#gdl-game-info-panel[data-gdl-native-layout="1"] .gdl-info-portrait {
			width:109px !important;min-width:109px !important;max-width:109px !important;
			height:163px !important;min-height:163px !important;max-height:163px !important;
			overflow:hidden !important;border-radius:2px !important;
		}
		#gdl-game-info-panel[data-gdl-native-layout="1"] .gdl-info-portrait img {
			width:100% !important;height:100% !important;object-fit:cover !important;display:block !important;
		}
		@media (max-width: 900px) {
			#gdl-game-info-panel .gdl-info-portrait,
			#gdl-game-info-panel .gdl-info-portrait img {
				width: 74px !important;
				min-width: 74px !important;
				max-width: 74px !important;
				height: 111px !important;
				min-height: 111px !important;
				max-height: 111px !important;
			}
		}
		div.NarrowWindow #gdl-game-info-panel .gdl-info-portrait,
		div.NarrowWindow #gdl-game-info-panel .gdl-info-portrait img {
			width: 74px !important;
			min-width: 74px !important;
			max-width: 74px !important;
			height: 111px !important;
			min-height: 111px !important;
			max-height: 111px !important;
		}
		#gdl-game-info-panel .gdl-info-associations {
			display: flex !important;
			flex-direction: column !important;
			gap: 8px !important;
		}
		#gdl-game-info-panel .gdl-info-row {
			display: flex !important;
			flex-direction: column !important;
			margin-bottom: 4px !important;
		}
		#gdl-game-info-panel .gdl-info-label {
			font-size: 11px !important;
			color: #8f98a0 !important;
			margin-bottom: 2px !important;
			text-transform: uppercase !important;
		}
		#gdl-game-info-panel .gdl-info-value {
			font-size: 13px !important;
			color: #dcdedf !important;
			line-height: 16px !important;
		}
		#gdl-game-info-panel .gdl-info-feature {
			display: flex;
			flex-flow: row;
			height: 24px;
			align-items: center;
			width: 100%;
		}
		#gdl-game-info-panel .gdl-info-feature svg,
		#gdl-game-info-panel .gdl-info-feature img,
		#gdl-game-info-panel .gdl-info-feature .gdl-feature-icon {
			box-sizing: border-box;
			width: 32px;
			height: 32px;
			padding: 6px 0px;
			opacity: .5;
			color: #fff;
			flex: 0 0 32px;
			object-fit: contain;
		}
		#gdl-game-info-panel .gdl-info-feature span {
			color: #919191;
			font-size: 13px;
			margin-inline-start: 5px;
			line-height: 24px;
			white-space: nowrap;
			text-overflow: ellipsis;
			overflow: hidden;
		}

		/* Safe fallback for a Steam build where the private game-info modules can
		   no longer be resolved. No stale Steam hashes are used on this path. */
		#gdl-game-info-panel[data-gdl-native-layout="0"] {
			height:0;opacity:0;overflow:hidden;box-sizing:border-box;
			background:linear-gradient(90deg,rgba(24,25,30,.92),rgba(31,28,33,.84));
			border-bottom:1px solid rgba(255,255,255,.035);
			transition:height 0.3s cubic-bezier(0.4, 0, 0.2, 1),opacity 0.28s ease-in-out;
		}
		#gdl-game-info-panel[data-gdl-native-layout="0"].gdl-info-expanded { opacity:1; }
		#gdl-game-info-panel[data-gdl-native-layout="0"] .gdl-game-info-container {
			width:100%;max-width:none;padding:10px 12px 14px;box-sizing:border-box;
		}
		#gdl-game-info-panel[data-gdl-native-layout="0"] .gdl-game-info-grid {
			display:grid;grid-template-columns:120px minmax(230px,1.05fr) minmax(245px,.9fr) minmax(230px,.82fr);
			grid-template-areas:"portrait desc stats features";gap:18px 26px;align-items:start;width:100%;min-height:194px;box-sizing:border-box;
		}
		#gdl-game-info-panel[data-gdl-native-layout="0"] .gdl-info-portrait {
			grid-area:portrait;width:120px;min-width:120px;max-width:120px;height:178px;min-height:178px;max-height:178px;
			margin:0;padding:0;overflow:hidden;background:rgba(0,0,0,.35);
		}
		#gdl-game-info-panel[data-gdl-native-layout="0"] .gdl-info-portrait img {
			width:120px;min-width:120px;max-width:120px;height:178px;min-height:178px;max-height:178px;
			object-fit:cover;display:block;margin:0;
		}
		#gdl-game-info-panel[data-gdl-native-layout="0"] .gdl-info-description {
			grid-area:desc;min-width:0;padding:8px 0 0;margin:0;color:#8f98a0;font-size:14px;line-height:1.38;
		}
		#gdl-game-info-panel[data-gdl-native-layout="0"] .gdl-info-description-text { max-width:390px; }
		#gdl-game-info-panel[data-gdl-native-layout="0"] .gdl-info-stats {
			grid-area:stats;min-width:0;padding:8px 0 0;margin:0;color:#8f98a0;font-size:13px;line-height:1.35;
		}
		#gdl-game-info-panel[data-gdl-native-layout="0"] .gdl-info-associations { display:flex;flex-direction:column;gap:6px; }
		#gdl-game-info-panel[data-gdl-native-layout="0"] .gdl-info-features {
			grid-area:features;min-width:0;padding:6px 0 0;margin:0;display:flex;flex-direction:column;gap:5px;color:#8f98a0;font-size:13px;line-height:1.3;
		}
		#gdl-game-info-panel[data-gdl-native-layout="0"] .gdl-info-row { display:flex;align-items:baseline;flex-wrap:wrap;gap:5px;min-height:18px; }
		#gdl-game-info-panel[data-gdl-native-layout="0"] .gdl-info-label { color:#8f98a0; }
		#gdl-game-info-panel[data-gdl-native-layout="0"] .gdl-info-value { color:#dcdedf;font-weight:700; }
		#gdl-game-info-panel[data-gdl-native-layout="0"] .gdl-info-feature { display:flex;align-items:center;gap:9px;min-height:22px; }
		#gdl-game-info-panel[data-gdl-native-layout="0"] .gdl-info-feature svg { width:22px;height:22px;min-width:22px;flex:0 0 22px; }
		@media (max-width:1180px) {
			#gdl-game-info-panel[data-gdl-native-layout="0"] .gdl-game-info-grid {
				grid-template-columns:120px minmax(0,1fr) minmax(230px,.9fr);
				grid-template-areas:"portrait desc stats" "portrait features features";
			}
		}
		@media (max-width:900px) {
			#gdl-game-info-panel[data-gdl-native-layout="0"] .gdl-game-info-grid {
				grid-template-columns:100px minmax(0,1fr);grid-template-areas:"portrait desc" "portrait stats" "features features";gap:12px 18px;
			}
			#gdl-game-info-panel[data-gdl-native-layout="0"] .gdl-info-portrait,
			#gdl-game-info-panel[data-gdl-native-layout="0"] .gdl-info-portrait img { width:100px;min-width:100px;max-width:100px;height:148px;min-height:148px;max-height:148px; }
		}
	`);
}
