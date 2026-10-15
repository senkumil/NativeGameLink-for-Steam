import { injectLibraryStyle } from './inject';

export function ensureCommunityStyles(doc: Document): void {
	injectLibraryStyle(doc, 'gdl-community-styles', `
		#gdl-community-content { display:block;min-width:0;box-sizing:border-box;margin-top:34px;overflow:visible; }
		#gdl-community-content.gdl-community-wide { width:var(--gdl-community-wide-width) !important;max-width:none !important;align-self:flex-start !important; }
		#gdl-community-content>*,#gdl-community-content [role="region"] { min-width:0;max-width:100%;box-sizing:border-box; }
		#gdl-community-content .gdl-community-native-header { min-width:0;margin:0 0 8px;padding:12px 10px 14px;box-sizing:border-box;display:flex;align-items:center;color:#cdf1ff;font-family:"Motiva Sans",Helvetica,sans-serif;font-size:14px;font-weight:400;line-height:20px;letter-spacing:1px;text-transform:uppercase;border-radius:3px;background:radial-gradient(circle at 0% 20%,rgba(94,137,194,.15) 0%,rgba(34,34,39,0) 20%),linear-gradient(to bottom,rgba(67,133,247,.95) 0%,rgba(85,98,121,.55) 2px,rgba(85,98,121,.15) 50%,rgba(34,34,39,0) 100%); }
		#gdl-community-content .gdl-community-help { position:relative;display:inline-flex;flex-shrink:0;width:16px;height:16px;margin:0 6px;border-radius:50%;align-items:center;justify-content:center;background:rgba(255,255,255,.17);color:rgba(255,255,255,.55);font-size:12px;font-weight:500;line-height:15px;cursor:help;text-transform:none;letter-spacing:0; }
		#gdl-community-content .gdl-community-help:hover .gdl-community-help-tooltip { display:block; }
		#gdl-community-content .gdl-community-help-tooltip { display:none;position:absolute;z-index:20;top:28px;inset-inline-start:0;width:300px;padding:10px;background:#74727e;color:#f1f1f1;font-size:14px;line-height:1.2;font-weight:400;text-transform:none;letter-spacing:0;box-shadow:0 2px 8px rgba(0,0,0,.45);pointer-events:none; }
		#gdl-community-inner { width:100%;min-width:0;max-width:100%;overflow:hidden;height:auto;max-height:none;box-sizing:border-box; }
		#gdl-community-content .gdl-community-grid { display:grid;position:relative;grid-template-columns:repeat(var(--gdl-community-columns,1),minmax(0,1fr));grid-auto-rows:minmax(128px,auto);grid-auto-flow:row dense;gap:32px 24px;align-items:stretch;width:100%;min-width:0;max-width:100%;box-sizing:border-box; }
		#gdl-community-content .gdl-community-card { background:#3e4047;border-radius:6px;box-shadow:0 2px 10px rgba(0,0,0,.25);overflow:hidden;position:relative;grid-column-end:span var(--gdl-community-card-columns,1);grid-row-end:span var(--gdl-community-card-rows,1);cursor:pointer;display:flex;flex-direction:column;min-width:0;min-height:0;height:auto;box-sizing:border-box;transition:box-shadow .21s ease-in-out; }
		#gdl-community-content .gdl-community-card:hover { box-shadow:0 1px 2px rgba(0,0,0,.25),0 14px 14px rgba(0,0,0,.25),0 10px 5px rgba(0,0,0,.22); }
		#gdl-community-content .gdl-community-media,#gdl-community-content .gdl-community-video-thumb { display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:auto;position:relative;overflow:hidden;border-radius:6px 6px 0 0;min-width:0; }
		#gdl-community-content .gdl-community-media { flex:1 0 auto; }
		#gdl-community-content .gdl-community-media::before,#gdl-community-content .gdl-community-video-thumb::before { content:"";display:block;grid-area:1/1;width:100%;aspect-ratio:var(--gdl-community-media-ratio,16/9);pointer-events:none; }
		#gdl-community-content .gdl-community-preview { display:block;position:absolute;inset:0;grid-area:1/1;width:100%;height:100%;min-width:0;min-height:0;max-width:100%;object-fit:cover;vertical-align:middle; }
		#gdl-community-content .gdl-community-media[data-gdl-media-state="error"]::before,#gdl-community-content .gdl-community-video-thumb[data-gdl-media-state="error"]::before { aspect-ratio:auto;height:0; }
		#gdl-community-content [data-gdl-media-state="error"]>.gdl-community-preview { display:none; }
		#gdl-community-content .gdl-community-video-thumb { flex:none;background:#000; }
		#gdl-community-content .gdl-community-video-thumb>.gdl-community-preview { object-fit:cover; }
		#gdl-community-content .gdl-community-video-frame { position:absolute;inset:0;grid-area:1/1;width:100%;height:100%;min-width:0;min-height:0;border:0;display:block; }
		#gdl-community-content .gdl-community-caption { grid-area:1/1;position:relative;align-self:end;justify-self:start;min-width:0;max-width:100%;margin-inline-end:6px;border-start-end-radius:6px;background:linear-gradient(to right,rgba(60,62,69,.95) 0%,rgb(34,34,39) 100%);box-shadow:0 4px 6px rgba(0,0,0,.7);pointer-events:none; }
		#gdl-community-content .gdl-community-caption .gdl-community-card-title { color:#bbcddd;font-size:14px;font-weight:400;padding:5px 8px 0;margin-bottom:5px;text-align:start;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;text-overflow:ellipsis; }
		#gdl-community-content .gdl-community-author-bar { display:flex;flex-direction:row;align-items:center;box-sizing:border-box;margin-top:auto;padding:10px;min-height:52px;flex:none;color:#888;background:linear-gradient(to bottom,rgba(0,0,0,.7) 0%,rgba(46,51,58,.3) 2px,rgba(74,81,92,0) 24px,rgba(75,81,92,.35) 100%);border-radius:0 0 6px 6px; }
		#gdl-community-content .gdl-community-avatar { display:block;width:32px;height:32px;max-width:32px;object-fit:cover;flex:none; }
		#gdl-community-content .gdl-community-author { margin-inline-start:10px;font-size:13px;min-width:0;flex:1;white-space:normal;overflow:visible;overflow-wrap:anywhere; }
		#gdl-community-content .gdl-community-guide-kind { padding:4px 8px;font-size:13px;text-transform:uppercase;color:#829ebd; }
		#gdl-community-content .gdl-community-guide-header { display:flex;flex-direction:row;margin:0 2px;background:#292d33;border-radius:2px;min-width:0; }
		#gdl-community-content .gdl-community-guide-preview { display:block;width:256px;max-width:33%;height:auto;object-fit:contain;align-self:flex-start;flex:none; }
		#gdl-community-content .gdl-community-guide-header .gdl-community-card-title { margin:3px 3px 0 6px;min-width:0;flex:1;overflow:visible;color:#ebebeb;font-size:15px;line-height:22px;font-weight:200; }
		#gdl-community-content .gdl-community-description-body { flex:1 0 auto;padding:10px;min-width:0; }
		#gdl-community-content .gdl-community-card-description { padding:0;color:#888;font-size:14px;line-height:20px;display:block;overflow:visible; }
		#gdl-community-content .gdl-community-card-guide .gdl-community-card-description { display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden; }
		#gdl-community-content .gdl-community-play-button { position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:68px;height:44px;background:rgba(0,0,0,.74);border-radius:4px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 10px rgba(0,0,0,.5);pointer-events:none; }
		#gdl-community-content .gdl-community-video-thumb[data-gdl-media-state="error"] { display:flex;flex-direction:column; }
		#gdl-community-content .gdl-community-video-thumb[data-gdl-media-state="error"] .gdl-community-play-button { position:relative;top:auto;left:auto;transform:none;align-self:center;margin:8px 0;flex:none; }
		#gdl-community-content .gdl-community-card[hidden] { display:none !important; }
		#gdl-community-content .gdl-community-card-title,#gdl-community-content .gdl-community-card-description { white-space:normal;overflow-wrap:anywhere;word-break:normal; }
		#gdl-community-content .gdl-community-sentinel { height:2px;width:100%; }
	`);
}
