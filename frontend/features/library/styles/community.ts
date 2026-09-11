import { injectLibraryStyle } from './inject';

export function ensureCommunityStyles(doc: Document): void {
	injectLibraryStyle(doc, 'gdl-community-styles', `
		#gdl-community-content { display:block;min-width:0;box-sizing:border-box;margin-top:34px;overflow:visible; }
		#gdl-community-content.gdl-community-wide { width:var(--gdl-community-wide-width) !important;max-width:none !important;align-self:flex-start !important; }
		#gdl-community-content>*,#gdl-community-content [role="region"] { min-width:0;max-width:100%;box-sizing:border-box; }
		.gdl-community-native-header { width:100%;min-width:0;max-width:100%;min-height:43px;margin:0 0 8px;padding:0 12px;box-sizing:border-box;display:flex;align-items:center;color:#c7e8ff;font-family:"Motiva Sans",Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;letter-spacing:1px;text-transform:uppercase;background:linear-gradient(180deg,rgba(60,75,94,.92),rgba(30,38,50,.94));border-top:1px solid #377eb5;border-radius:2px 2px 0 0;box-shadow:inset 0 1px 0 rgba(255,255,255,.08); }
		.gdl-community-help { position:relative;display:inline-flex;width:19px;height:19px;margin-inline-start:10px;border-radius:50%;align-items:center;justify-content:center;background:rgba(255,255,255,.19);color:#d6d7d8;font-size:12px;line-height:1;cursor:help;text-transform:none;letter-spacing:0; }
		.gdl-community-help:hover .gdl-community-help-tooltip { display:block; }
		.gdl-community-help-tooltip { display:none;position:absolute;z-index:20;top:28px;inset-inline-start:0;width:300px;padding:10px;background:#74727e;color:#f1f1f1;font-size:14px;line-height:1.2;font-weight:400;text-transform:none;letter-spacing:0;box-shadow:0 2px 8px rgba(0,0,0,.45);pointer-events:none; }
		#gdl-community-inner { width:100%;min-width:0;max-width:100%;overflow:hidden;height:auto;max-height:none;box-sizing:border-box; }
		.gdl-community-grid { display:grid;grid-template-columns:repeat(auto-fit,minmax(min(230px,100%),1fr));grid-auto-flow:dense;gap:24px;align-items:stretch;width:100%;min-width:0;max-width:100%;overflow:hidden;box-sizing:border-box; }
		@media (min-width: 680px) {
			.gdl-community-card-video { grid-column: span 2; }
		}
		.gdl-community-card { background:rgba(18,24,32,.32);overflow:hidden;cursor:pointer;display:flex;flex-direction:column;min-width:0;align-self:stretch;height:100%;box-sizing:border-box;transition:background .15s ease,box-shadow .15s ease; }
		.gdl-community-card:hover { background:rgba(255,255,255,.05);box-shadow:0 4px 14px rgba(0,0,0,.35); }
		.gdl-community-play-button { position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:68px;height:44px;background:rgba(0,0,0,.74);border-radius:4px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 10px rgba(0,0,0,.5);transition:background .18s ease,transform .18s ease;pointer-events:none; }
		.gdl-community-card-video:hover .gdl-community-play-button { background:rgba(26,159,255,.9) !important;transform:translate(-50%,-50%) scale(1.08) !important; }
		.gdl-community-card img { display:block;max-width:100%; }
		.gdl-community-card > img { width:100%;aspect-ratio:16/9;object-fit:cover; }
		.gdl-community-card[hidden] { display:none !important; }
		.gdl-community-card-title,.gdl-community-card-description,.gdl-community-author { white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere;word-break:normal; }
		.gdl-community-sentinel { height:2px;width:100%;grid-column:1/-1; }
	`);
}
