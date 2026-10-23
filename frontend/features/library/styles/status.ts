import { injectLibraryStyle } from './inject';

export function ensureStatusComposerStyles(doc: Document): void {
	injectLibraryStyle(doc, 'gdl-status-composer-styles', `
		/* The installed PostTextEntry and ViewLastNews classes own their chrome.
		   Retain only the local popup/textarea behavior; overrides of their width,
		   padding, background and minimum height diverge from native Activity. */
		.gdl-status-box-container { position:relative;overflow:visible; }
		#gdl-status-text { max-height:none;outline:none;overflow-wrap:break-word; }
		#gdl-status-post { box-sizing:content-box;font-family:inherit;line-height:inherit;cursor:default; }
		#gdl-status-post.is-enabled { cursor:pointer; }
		#gdl-status-post > div { pointer-events:none; }
		.gdl-latest-news-row { display:flex;justify-content:flex-end; }
		.gdl-latest-news-button { border:0;font-weight:inherit; }
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
