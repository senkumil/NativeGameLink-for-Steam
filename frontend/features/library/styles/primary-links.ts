import { injectLibraryStyle } from './inject';

export function ensurePrimaryLinksStyles(doc: Document): void {
	injectLibraryStyle(doc, 'gdl-primary-links-styles', `
		#gdl-link-bar:not([data-gdl-links-settled="1"]) {
			visibility: hidden !important;
			opacity: 0 !important;
			pointer-events: none !important;
		}
		#gdl-link-bar {
			margin: 11px 20px var(--gdl-native-links-bottom-gap, 36px) 20px !important;
			width: calc(100% - 40px) !important;
			box-sizing: border-box !important;
			position: relative !important;
			background: rgba(255, 255, 255, 0.035) !important;
			border-top: 1px solid rgba(255, 255, 255, 0.04) !important;
			border-left: 1px solid rgba(255, 255, 255, 0.05) !important;
			border-right: 1px solid rgba(255, 255, 255, 0.05) !important;
			border-bottom: none !important;
			border-radius: 1px !important;
			backdrop-filter: blur(8px) !important;
			display: flex !important;
			align-items: center !important;
			justify-content: flex-start !important;
			container-type: inline-size !important;
			height: 36px !important;
			min-height: 36px !important;
			max-height: 36px !important;
			flex: 0 0 auto !important;
			padding: 0 14px 0 22px !important;
			gap: 52px !important;
			overflow: visible !important;
			min-width: 0 !important;
			scrollbar-width: none !important;
		}
		#gdl-link-bar::before {
			content: "" !important;
			position: absolute !important;
			top: -1px !important;
			left: 0 !important;
			right: 0 !important;
			height: 1px !important;
			border-radius: 1px 1px 0 0 !important;
			background: linear-gradient(90deg, rgba(255, 255, 255, 0.01) 0%, rgba(255, 255, 255, 0.06) 15%, rgba(255, 255, 255, 0.10) 50%, rgba(255, 255, 255, 0.06) 85%, rgba(255, 255, 255, 0.01) 100%) !important;
			pointer-events: none !important;
		}
		#gdl-link-bar::-webkit-scrollbar {
			display: none !important;
		}
		#gdl-link-bar .gdl-link-bar-fallback,
		#gdl-link-bar > div:not(.gdl-primary-more):not(.gdl-primary-more-menu) {
			display: contents !important;
		}
		#gdl-link-bar .gdl-primary-link {
			display: inline-flex !important;
			align-items: center !important;
			justify-content: center !important;
			color: rgba(255, 255, 255, 0.35) !important;
			font-family: "Motiva Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
			font-size: 13px !important;
			font-weight: 400 !important;
			line-height: 26px !important;
			height: 26px !important;
			padding: 0 10px !important;
			letter-spacing: 0.3px !important;
			text-decoration: none !important;
			white-space: nowrap !important;
			border-radius: 3px !important;
			transition: color 0.12s ease, background-color 0.12s ease !important;
			cursor: pointer !important;
			user-select: none !important;
		}
		#gdl-link-bar .gdl-primary-link:first-child {
			margin-left: 0 !important;
			transform: translateX(-10px) !important;
		}
		#gdl-link-bar .gdl-primary-link:hover {
			color: #ffffff !important;
			background: rgba(255, 255, 255, 0.08) !important;
		}
		#gdl-link-bar .gdl-primary-link:active {
			color: #ffffff !important;
			background: rgba(255, 255, 255, 0.14) !important;
		}
		#gdl-link-bar .gdl-primary-more { display:none;position:relative;margin-left:auto;flex:0 0 34px;min-width:34px;max-width:34px;z-index:4; }
		#gdl-link-bar .gdl-primary-more summary { list-style:none;display:flex;align-items:center;justify-content:center;width:34px;height:26px;border-radius:3px;color:rgba(255,255,255,0.35);font-size:18px;letter-spacing:1px;cursor:pointer;user-select:none; }
		#gdl-link-bar .gdl-primary-more summary::-webkit-details-marker { display:none; }
		#gdl-link-bar .gdl-primary-more[open] summary,#gdl-link-bar .gdl-primary-more summary:hover { color:#fff;background:rgba(255,255,255,.08); }
		#gdl-link-bar .gdl-primary-more-menu { position:fixed;inset:auto;margin:0;min-width:115px;padding:4px 0;background:#3d4450;border:0;border-radius:0;box-shadow:0 5px 12px rgba(0,0,0,.5);width:max-content; }
		#gdl-link-bar .gdl-primary-overflow-link { display:block;padding:8px 16px;color:#dcdedf;text-decoration:none;font-family:"Motiva Sans",Arial,sans-serif;font-size:14px;line-height:18px;white-space:nowrap;box-sizing:border-box; }
		#gdl-link-bar .gdl-primary-overflow-link:hover,#gdl-link-bar .gdl-primary-overflow-link:focus-visible { color:#fff;background:#4b5361;outline:none; }

	`);
}
