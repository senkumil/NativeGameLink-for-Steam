import { injectLibraryStyle } from './inject';

export function ensureTradingCardStyles(doc: Document): void {
	injectLibraryStyle(doc, 'gdl-trading-card-styles', `
		#gdl-trading-cards-section,#gdl-trading-cards-section > *,#gdl-trading-cards-section [role="region"],#gdl-trading-cards-content,#gdl-trading-cards-content > * { max-width:100%;box-sizing:border-box;overflow:visible !important; }
		.gdl-trading-cards-body { display:flex;flex-direction:column;padding:10px;container-type:inline-size;min-width:0;max-width:100%;overflow:visible !important;box-sizing:border-box; }
		.gdl-native-sidebar-panel { width:100%;min-width:0;max-width:100%;box-sizing:border-box;background:var(--gdl-right-sidebar-box-bg,rgba(18,24,32,.32)) !important;border-color:var(--gdl-native-panel-border,rgba(255,255,255,.035)); }
		#gdl-trading-cards-section .gdl-native-sidebar-panel { background:transparent !important;border:0;padding:0;user-select:none; }
		.gdl-trading-card-grid { display:flex;flex-direction:row;flex-wrap:wrap;gap:8px;align-items:flex-start;justify-content:flex-start;width:100%;min-width:0;max-width:100%;overflow:visible;transform-style:flat;margin-bottom:10px; }
		.gdl-trading-card { --gdl-native-brightness:1;position:relative;min-width:56px;width:var(--gdl-trading-card-width,31%);max-width:var(--gdl-trading-card-max-width,85px);aspect-ratio:224/261;z-index:1;overflow:visible;cursor:pointer;transform-style:flat;animation:gdl-card-return .32s forwards; }
		@keyframes gdl-card-return { 0%,99% { z-index:9; } 100% { z-index:1; } }
		.gdl-trading-card-hitbox { position:absolute;z-index:99;pointer-events:none;background:transparent;cursor:pointer; }
		.gdl-trading-card-surface { position:absolute;inset:auto;width:150%;height:150%;left:-25%;top:-25%;z-index:1;perspective:500px;transform-style:flat;transform-origin:center center;transform:scale(.6666666667);transition:transform .32s ease;font-size:.1px;overflow:visible; }
		.gdl-trading-card[data-owned="true"] .gdl-trading-card-surface { width:250%;height:250%;left:-75%;top:-75%;transform:scale(.4); }
		.gdl-trading-card-motion { position:absolute;inset:0;width:100%;height:100%;box-sizing:content-box;border-radius:2px;border:.5px solid #000;transition-property:transform,box-shadow;transition-duration:0s,.21s;transition-timing-function:ease-in-out;overflow:hidden;background:#000;box-shadow:0 0 0 1px rgba(0,0,0,0);transform:rotate3d(0,0,0,0deg); }
		.gdl-trading-card-unowned .gdl-trading-card-motion { background:#394149;border-color:transparent; }
		.gdl-card-paper-mask { position:absolute;inset:0;pointer-events:none;-webkit-mask-repeat:repeat;-webkit-mask-size:30% 30%;opacity:var(--gdl-paper-opacity,0); }
		.gdl-card-paper-mask[data-edge="w"] { -webkit-mask-image:url(/images/bump_paper_w.png); }
		.gdl-card-paper-mask[data-edge="e"] { -webkit-mask-image:url(/images/bump_paper_e.png); }
		.gdl-card-paper-mask[data-edge="s"] { -webkit-mask-image:url(/images/bump_paper_s.png); }
		.gdl-card-paper-shine { pointer-events:none;width:20em;height:20em;background:radial-gradient(circle farthest-corner at 50% 40%,rgba(255,255,255,.7) 0%,rgba(255,255,255,.5) 33%,rgba(255,255,255,0) 60%,rgba(255,255,255,0) 100%);position:absolute;inset-inline-start:0;top:0;margin-inline-start:-6em;margin-top:-8em;opacity:0;transition:opacity .21s ease-in-out;left:var(--gdl-paper-left,0px);top:var(--gdl-paper-top,0px); }
		.gdl-card-hologram { display:none; }
		.gdl-trading-card.gdl-card-tilt-active { z-index:10;animation:none; }
		.gdl-trading-card.gdl-card-tilt-active .gdl-trading-card-hitbox { pointer-events:none; }
		.gdl-trading-card.gdl-card-tilt-active .gdl-trading-card-surface { pointer-events:auto; }
		.gdl-trading-card.gdl-card-tilt-active .gdl-trading-card-motion { box-shadow:10px 20px 32px 1px rgba(0,0,0,.6705882353); }
		.gdl-trading-card.gdl-card-tilt-active .gdl-card-paper-shine { opacity:1; }
		.gdl-trading-card img { display:block;width:100%;height:auto;min-width:0;margin-bottom:-2.5%;image-rendering:auto;border:0;filter:saturate(1) brightness(var(--gdl-native-brightness,1)); }
		.gdl-trading-card.gdl-trading-card-unowned img { opacity:.3;filter:saturate(.1) brightness(var(--gdl-native-brightness,1)); }
		.gdl-trading-card.gdl-trading-card-unowned.gdl-card-tilt-active img { filter:saturate(.3) brightness(var(--gdl-native-brightness,1)); }
		.gdl-trading-card[data-gdl-preview-allowed="false"],.gdl-trading-card[data-gdl-preview-allowed="false"] .gdl-trading-card-hitbox { cursor:default; }
		.gdl-trading-card-title { display:none;position:absolute;top:16px;width:100%;box-sizing:border-box;padding:0 5px;text-align:center;font-size:12px;color:#fff; }
		.gdl-card-image-failed .gdl-trading-card-title { display:block; }
		.gdl-card-image-failed .gdl-trading-card-motion { background:#394149;border-color:transparent; }
		.gdl-trading-card.gdl-card-image-failed img { opacity:0; }
		.gdl-trading-cards-badge-header { display:flex;flex-direction:row;padding:10px;position:relative;margin-bottom:8px;border-radius:2px;font-size:13px;color:#ccc; }
		.gdl-card-highlight-fallback { background:linear-gradient(to right,rgb(59,65,74) 0%,rgb(44,49,56) 95%);box-shadow:1px 2px 12px 1px rgba(26,27,37,.253); }
		.gdl-trading-badge { display:block;width:80px;height:80px;flex:0 0 auto;margin-top:-8px;margin-inline-start:6px;margin-inline-end:10px;padding:0;background:transparent;transition-property:transform,filter;transition-duration:.12s;transition-timing-function:ease-in-out; }
		.gdl-trading-badge:not(.gdl-trading-badge-empty):hover { transform:scale(1.05);filter:brightness(1.2);cursor:pointer; }
		.gdl-trading-badge-empty { box-sizing:border-box;width:52px;height:52px;margin:6px;margin-inline-end:14px;border-radius:50%;border:2px dashed #656565; }
		.gdl-trading-badge img { display:block;width:100%;height:100%;object-fit:contain;border-radius:0;image-rendering:auto; }
		.gdl-trading-badge-info { display:flex;flex-direction:column;justify-content:center;min-width:0; }
		.gdl-trading-badge-title { font-size:14px;font-weight:300;color:#ccc; }
		.gdl-trading-badge-xp { font-size:14px;color:#888; }
		.gdl-trading-card-remaining { display:block;font-size:13px;color:#888;margin-bottom:10px;text-decoration:none; }
		.gdl-trading-card-ready { color:#fff;background:linear-gradient(to right,#47bfff 0%,#1a44c2 60%);padding:10px;text-align:center;border-radius:2px;cursor:pointer; }
		.gdl-trading-card-maxed { color:#47bfff; }
		.gdl-trading-cards-view-link.DialogButton { align-self:flex-end;display:block;width:auto;min-width:0;min-height:0;margin-top:8px;padding:4px 12px;border:0;background:transparent;box-shadow:none;color:#8c9193;font-family:inherit;font-size:13px;font-weight:400;line-height:normal;text-align:right;cursor:pointer; }
		.gdl-trading-cards-view-link.DialogButton:hover { color:#fff;background:rgba(101,113,128,.357); }
		.gdl-trading-cards-help-btn { width:16px;height:16px;border-radius:50%;background:rgba(255,255,255,.17);border:0;color:rgba(255,255,255,.55);display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:500;font-family:"Motiva Sans",Arial,sans-serif;cursor:pointer;margin:0 6px;vertical-align:middle;padding:0;line-height:1; }
		.gdl-trading-cards-help-btn > span { margin-inline-start:1px; }
		.gdl-trading-cards-help-popup { background:#3d4450;border:1px solid rgba(255,255,255,0.08);box-shadow:0 8px 24px rgba(0,0,0,0.65);border-radius:2px;padding:14px 16px;color:#c6d4df;font-family:"Motiva Sans",Arial,sans-serif;font-size:12.5px;line-height:1.45;font-weight:400;text-transform:none;letter-spacing:0;pointer-events:none;box-sizing:border-box; }
		#gdl-trading-cards-section h2 > :not(:first-child) { display:none !important; }
		#gdl-trading-cards-section h2::before,#gdl-trading-cards-section h2::after { display:none !important; }
		#gdl-trading-card-preview { position:fixed;inset:0;z-index:2147483605;display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box;background:rgba(5,8,12,.86);opacity:0;transition:opacity .14s ease;-webkit-app-region:no-drag !important;pointer-events:auto !important; }
		#gdl-trading-card-preview.is-visible { opacity:1; }
		.gdl-trading-card-preview-panel { position:relative;display:flex;flex:0 1 auto;flex-direction:column;align-items:center;width:auto;max-width:calc(100vw - 30px);max-height:calc(100vh - 24px);padding:16px 16px 12px;box-sizing:border-box;background:#2b313a;border:1px solid #506070;box-shadow:0 18px 70px rgba(0,0,0,.82);-webkit-app-region:no-drag !important;pointer-events:auto !important; }
		.gdl-trading-card-preview-image { display:block;width:100%;height:auto;max-height:calc(100vh - 116px);object-fit:contain;image-rendering:auto;background:#080b0f;background-size:contain;background-position:center;background-repeat:no-repeat;pointer-events:none; }
		.gdl-trading-card-preview-x { position:absolute;z-index:6;top:2px;right:5px;padding:0;border:0;background:transparent;color:#82909d;font-size:27px;line-height:1;cursor:pointer !important;pointer-events:auto !important;touch-action:manipulation;-webkit-app-region:no-drag !important;text-shadow:0 1px 2px #000; }
		.gdl-trading-card-preview-x:hover { color:#dcdedf; }
		.gdl-trading-card-preview-close { position:relative;z-index:6;align-self:center;display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:50%;max-width:780px;min-width:0;min-height:46px;margin-top:16px;padding:10px 24px;border:0;border-radius:2px;background:linear-gradient(90deg,#3ea1ec,#2d6ed7);color:#eaf6ff;font-size:17px;line-height:1.2;cursor:pointer !important;pointer-events:auto !important;touch-action:manipulation;-webkit-app-region:no-drag !important;user-select:none; }
		.gdl-trading-card-preview-close, .gdl-trading-card-preview-close * { cursor:pointer !important; }
		.gdl-trading-card-preview-close:hover { filter:brightness(1.12); }
	`);
}
