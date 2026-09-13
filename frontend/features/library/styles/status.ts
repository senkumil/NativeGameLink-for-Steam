import { POST_CLASSES } from '../../../steam/css';
import { injectLibraryStyle } from './inject';

export function ensureStatusComposerStyles(doc: Document): void {
	const post = POST_CLASSES();
	injectLibraryStyle(doc, 'gdl-status-composer-styles', `
		.gdl-status-box-container { display:block !important;margin:0 0 2px 0 !important;min-height:0 !important;height:auto !important;position:relative !important;z-index:50 !important;overflow:visible !important; }
		.gdl-status-box-container textarea,
		#gdl-status-text {
			width: 100% !important;
			field-sizing: content !important;
			height: auto !important;
			min-height: 40px !important;
			max-height: none !important;
			background: rgba(0, 0, 0, 0.22) !important;
			border: 1px solid rgba(255, 255, 255, 0.05) !important;
			border-radius: 2px !important;
			color: #d6d7d8 !important;
			font-family: "Motiva Sans", Arial, Helvetica, sans-serif !important;
			font-size: 13.5px !important;
			line-height: 1.35 !important;
			padding: 9px 14px !important;
			box-sizing: border-box !important;
			resize: none !important;
			outline: none !important;
			overflow: hidden !important;
			overflow-wrap: break-word !important;
			word-break: break-word !important;
			white-space: pre-wrap !important;
			scrollbar-width: none !important;
			-ms-overflow-style: none !important;
			transition: min-height 0.2s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.15s ease, background 0.15s ease !important;
		}
		.gdl-status-box-container textarea::-webkit-scrollbar,
		#gdl-status-text::-webkit-scrollbar {
			display: none !important;
			width: 0 !important;
			height: 0 !important;
		}
		.gdl-status-box-container textarea::placeholder,
		#gdl-status-text::placeholder {
			font-style: italic !important;
			color: #8f98a0 !important;
			font-size: 13.5px !important;
			font-family: "Motiva Sans", Arial, sans-serif !important;
		}
		.gdl-status-box-container textarea:focus,
		.gdl-status-box-container.gdl-composer-active textarea,
		#gdl-status-text:focus {
			min-height: 64px !important;
			max-height: none !important;
			background: rgba(0, 0, 0, 0.35) !important;
			border-color: rgba(255, 255, 255, 0.12) !important;
		}
		.gdl-status-box-container .${post.Controls} {
			display: flex !important;
			align-items: center !important;
			justify-content: flex-end !important;
			gap: 8px !important;
			max-height: 0px !important;
			opacity: 0 !important;
			transform: translateY(-4px) !important;
			overflow: hidden !important;
			pointer-events: none !important;
			margin-top: 0px !important;
			position: relative !important;
			z-index: 51 !important;
			transition: max-height 0.24s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease, transform 0.24s ease, margin-top 0.24s ease !important;
		}
		.gdl-status-box-container .${post.Controls}.${post.Active},
		.gdl-status-box-container.gdl-composer-active .${post.Controls} {
			max-height: 42px !important;
			opacity: 1 !important;
			transform: translateY(0) !important;
			overflow: visible !important;
			pointer-events: auto !important;
			margin-top: 6px !important;
		}
		.gdl-status-box-container .${post.EmoticonButton},
		.gdl-emoticon-btn {
			background: #1d2227 !important;
			border: 0 !important;
			border-radius: 2px !important;
			width: 44px !important;
			min-width: 44px !important;
			height: 38px !important;
			display: flex !important;
			align-items: center !important;
			justify-content: center !important;
			color: #8f98a0 !important;
			cursor: pointer !important;
			position: relative !important;
			padding: 0 !important;
			box-shadow: none !important;
			transition: background .15s,color .15s !important;
		}
		.gdl-status-box-container .${post.EmoticonButton}:hover,
		.gdl-emoticon-btn:hover {
			background: #353e49 !important;
			color: #ffffff !important;
		}
		.gdl-status-box-container .${post.PostButton},
		#gdl-status-post {
			background: #1d2227 !important;
			border: 0 !important;
			border-radius: 2px !important;
			color: #92999f !important;
			font-family: "Motiva Sans",Arial,Helvetica,sans-serif !important;
			font-size: 13.5px !important;
			font-weight: 400 !important;
			padding: 0 20px !important;
			height: 38px !important;
			width: 140px !important;
			min-width: 140px !important;
			display: flex !important;
			align-items: center !important;
			justify-content: center !important;
			cursor: default !important;
			opacity: 1 !important;
			box-shadow: none !important;
			transition: background .15s,color .15s,border-color .15s, box-shadow .15s !important;
		}
		#gdl-status-post .${post.Label},
		#gdl-status-post > div { pointer-events:none; }
		.gdl-status-box-container .${post.PostButton}.${post.Enabled},
		#gdl-status-post.is-enabled {
			background: linear-gradient(90deg, #47a8f8 0%, #2f7eea 100%) !important;
			border-color: rgba(87, 174, 255, .72) !important;
			color: #fff !important;
			font-weight: 700 !important;
			cursor: pointer !important;
			box-shadow: inset 0 1px 0 rgba(255,255,255,.18) !important;
		}
		.gdl-status-box-container .${post.PostButton}.${post.Enabled}:hover,
		#gdl-status-post.is-enabled:hover { background:linear-gradient(90deg, #56b5ff 0%, #3b8df5 100%) !important;border-color:rgba(108, 194, 255, .9) !important; }
		.gdl-latest-news-row { display:flex;justify-content:flex-end;align-items:center;margin:2px 0 8px !important;min-height:0 !important;padding:0 !important; }
		.gdl-latest-news-button {
			background: transparent !important;
			border: 0 !important;
			border-radius: 2px !important;
			color: #8f98a0 !important;
			font-family: "Motiva Sans", Arial, Helvetica, sans-serif !important;
			font-size: 12.5px !important;
			font-weight: 400 !important;
			line-height: 1.2 !important;
			padding: 4px 6px !important;
			cursor: pointer !important;
			text-decoration: none !important;
			box-shadow: none !important;
			transition: background .15s ease, color .15s ease !important;
		}
		.gdl-latest-news-button:hover,
		.gdl-latest-news-button:focus-visible {
			background: rgba(79, 85, 98, .94) !important;
			color: #ffffff !important;
			outline: none !important;
		}
		#gdl-emoticon-picker { position:absolute;top:0;right:0;bottom:auto;width:260px;background:#232932;border:1px solid rgba(255,255,255,.16);box-shadow:0 16px 48px rgba(0,0,0,.95),0 0 0 1px rgba(255,255,255,.1);border-radius:4px;padding:12px 14px;z-index:999999;font-family:"Motiva Sans",Arial,Helvetica,sans-serif;color:#d6d7d8;animation:gdl-ep-popin .12s ease-out;box-sizing:border-box;transform-origin:100% 100%; }
		@keyframes gdl-ep-popin { from { transform:scale(.95);opacity:0; } to { transform:scale(1);opacity:1; } }
		.gdl-ep-heading { font-size:10.5px;font-weight:700;color:#8f98a0;letter-spacing:.5px;text-transform:uppercase;margin-bottom:6px; }
		.gdl-ep-grid { display:flex;flex-wrap:wrap;gap:5px; }
		.gdl-ep-item { width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:17px;cursor:pointer;border-radius:2px;background:rgba(0,0,0,.2);transition:background .1s,transform .1s;user-select:none; }
		.gdl-ep-item:hover { background:rgba(255,255,255,.15);transform:scale(1.15); }
		.gdl-ep-all { max-height:120px !important;overflow-y:auto; }
		.gdl-ep-search { width:100%;background:#191e25;border:1px solid #14181f;border-radius:2px;color:#8f98a0;padding:6px 9px;font-size:12px;font-style:italic;outline:none;margin-top:8px;box-sizing:border-box; }
		.gdl-ep-search:focus { border-color:#1a9fff;color:#fff; }
	`);
}
