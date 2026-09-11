import { EVENT_CLASSES } from '../../../steam/css';
import { injectLibraryStyle } from './inject';

export function ensureActivityStyles(doc: Document): void {
	const event = EVENT_CLASSES();
	injectLibraryStyle(doc, 'gdl-activity-styles', `
		/* Steam's desktop details layout keeps RightColumn as a 33% right float.
		   A 100%-wide injected child cannot flow beside it and is moved below the
		   entire sidebar. Mirror Steam's own SpotlightLeftColumn breakpoints so
		   Activity and Community remain one stack in the actual left column. */
		#gdl-main-content-stack { width:calc(67% - 32px) !important; }
		div.NarrowWindow #gdl-main-content-stack { width:calc(67% - 22px) !important; }
		div.UltraNarrowRightPanel #gdl-main-content-stack { width:100% !important; }
		.gdl-activity-container,
		#gdl-activity-feed,
		#gdl-game-data { font-family:"Motiva Sans",Arial,Helvetica,sans-serif; }
		.gdl-activity-container .${event.AppActivityDate},
		#gdl-activity-feed .${event.AppActivityDate},
		#gdl-game-data .${event.AppActivityDate} { font-family:"Motiva Sans",Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:#8f98a0;letter-spacing:1px;text-transform:uppercase;display:flex;align-items:center;gap:12px;margin:0 0 8px; }
		.gdl-activity-container .${event.Rule},
		#gdl-activity-feed .${event.Rule},
		#gdl-game-data .${event.Rule} { flex:1;height:1px;background:rgba(255,255,255,.08); }
		.gdl-activity-container .${event.PartnerEventLargeUpdate} .${event.PartnerEventType},
		#gdl-activity-feed .${event.PartnerEventLargeUpdate} .${event.PartnerEventType},
		#gdl-game-data .${event.PartnerEventLargeUpdate} .${event.PartnerEventType} { color:#1a9fff; }
		.gdl-activity-container .${event.PartnerEventLargeUpdate} .${event.PartnerEventLargeImage_Container},
		#gdl-activity-feed .${event.PartnerEventLargeUpdate} .${event.PartnerEventLargeImage_Container},
		#gdl-game-data .${event.PartnerEventLargeUpdate} .${event.PartnerEventLargeImage_Container} { background:radial-gradient(100% 85% at 70% 95%,rgba(70,93,112,.30) 0%,rgba(41,57,71,.68) 32%,rgba(24,31,39,.88) 100%); }
		.gdl-activity-container .${event.PartnerEventLargeUpdate} .${event.PartnerEventLargeImage_Container}:hover,
		#gdl-activity-feed .${event.PartnerEventLargeUpdate} .${event.PartnerEventLargeImage_Container}:hover,
		#gdl-game-data .${event.PartnerEventLargeUpdate} .${event.PartnerEventLargeImage_Container}:hover { background:radial-gradient(100% 85% at 70% 95%,rgba(108,139,174,.30) 0%,rgba(48,79,108,.56) 35%,rgba(22,47,70,.72) 100%); }
		/* Steam caps this column at 130px. A three-line title plus three-line
		   excerpt then loses the bottom of the excerpt. Scope the override to
		   our injected feed so native library cards remain untouched. */
		#gdl-activity-feed .${event.PartnerEventLargeUpdate} .${event.PartnerEventLargeImage_TextColumn} { max-height:none !important;box-sizing:border-box;padding-bottom:20px; }
		.gdl-activity-container .${event.LeftSideMajorUpdateBar},
		#gdl-activity-feed .${event.LeftSideMajorUpdateBar},
		#gdl-game-data .${event.LeftSideMajorUpdateBar} { position:absolute;left:0;top:0;bottom:0;width:4px;background:#1a9fff;z-index:2;transition:background .15s ease-out,box-shadow .15s ease-out; }
		.gdl-activity-container .${event.PartnerEventMediumImage_Contents},
		#gdl-activity-feed .${event.PartnerEventMediumImage_Contents},
		#gdl-game-data .${event.PartnerEventMediumImage_Contents} { display:flex;flex-direction:row;align-items:stretch;min-height:120px;cursor:pointer; }
		.gdl-activity-container .${event.MediumImageContainer},
		#gdl-activity-feed .${event.MediumImageContainer},
		#gdl-game-data .${event.MediumImageContainer} { flex:0 0 42%;max-width:320px;min-width:180px;aspect-ratio:16/9;overflow:hidden;position:relative; }
		.gdl-activity-container .${event.PartnerEventMediumImage_Image},
		#gdl-activity-feed .${event.PartnerEventMediumImage_Image},
		#gdl-game-data .${event.PartnerEventMediumImage_Image} { width:100%;height:100%;object-fit:cover;display:block; }
		.gdl-activity-container .${event.PartnerEventMediumImage_TextColumn},
		#gdl-activity-feed .${event.PartnerEventMediumImage_TextColumn},
		#gdl-game-data .${event.PartnerEventMediumImage_TextColumn} { flex:1 1 auto;padding:12px 16px;display:flex;flex-direction:column;justify-content:flex-start;min-width:0;overflow:hidden; }
		.gdl-activity-container .${event.PartnerEventType},
		#gdl-activity-feed .${event.PartnerEventType},
		#gdl-game-data .${event.PartnerEventType} { font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#1a9fff;margin-bottom:4px; }
		.gdl-activity-container .${event.PartnerEventMediumImage_Title},
		#gdl-activity-feed .${event.PartnerEventMediumImage_Title},
		#gdl-game-data .${event.PartnerEventMediumImage_Title} { font-size:16px;font-weight:600;color:#e5e5e5;line-height:1.3;margin-bottom:6px;overflow:hidden;text-overflow:ellipsis; }
		.gdl-activity-container .${event.PartnerEventMediumImage_Summary},
		#gdl-activity-feed .${event.PartnerEventMediumImage_Summary},
		#gdl-game-data .${event.PartnerEventMediumImage_Summary} { font-size:13px;color:#8f98a0;line-height:1.45;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical; }
		#gdl-activity-feed .gdl-feed-day { margin-top:18px; }
		#gdl-activity-feed .gdl-feed-day:first-child { margin-top:0 !important; }
		#gdl-activity-feed .gdl-feed-date { font-family:"Motiva Sans",Arial,Helvetica,sans-serif;font-size:14px;font-weight:500;color:#8f98a0;letter-spacing:1px;text-transform:uppercase;display:flex;align-items:center;gap:12px;margin:0 0 8px; }
		#gdl-activity-feed .gdl-feed-rule { flex:1;height:1px;background:rgba(255,255,255,.11); }
		#gdl-activity-feed .gdl-news-card { position:relative;margin-bottom:16px;border:1px solid rgba(255,255,255,.045);box-shadow:0 2px 5px rgba(0,0,0,.22);cursor:pointer;overflow:hidden;transition:border-color .14s ease,box-shadow .14s ease; }
		#gdl-activity-feed .gdl-news-card:not(.gdl-major-update):not(.gdl-patch-note) { height:auto;min-height:0;max-height:none; }
		#gdl-activity-feed .gdl-news-card:hover { border-color:rgba(255,255,255,.09); }
		#gdl-activity-feed .gdl-news-layout { display:flex;align-items:stretch;column-gap:0;height:auto;min-height:0;padding:12px;box-sizing:border-box;overflow:hidden; }
		#gdl-activity-feed .gdl-news-image { flex:0 0 274px;width:274px;height:154px;max-height:154px;min-height:154px;max-width:274px;min-width:0;margin:0 16px 0 0;padding:0;box-sizing:border-box;background:#0e141b;position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:2px;align-self:flex-start; }
		#gdl-activity-feed .gdl-news-image img.gdl-news-image-blur { position:absolute;top:-15%;left:-15%;width:130%;height:130%;max-width:none;max-height:none;object-fit:cover;filter:blur(14px) brightness(0.45);opacity:0.75;pointer-events:none; }
		#gdl-activity-feed .gdl-news-image img.gdl-news-image-fg { position:relative;width:100%;height:100%;max-width:100%;max-height:100%;object-fit:contain;object-position:center;display:block;z-index:1; }
		#gdl-activity-feed .gdl-news-image img:not(.gdl-news-image-blur):not(.gdl-news-image-fg) { width:100%;height:100%;max-width:none;max-height:none;object-fit:cover;display:block; }
		#gdl-activity-feed .${event.PartnerEventMediumImage_TextColumn}.gdl-news-copy { flex:1 1 auto;min-width:0;max-height:none;padding:12px 18px 16px 0;box-sizing:border-box;display:flex;flex-direction:column;align-items:flex-start;justify-content:flex-start;overflow:hidden; }
		#gdl-activity-feed .gdl-news-type { color:#9da4ab;font-size:12px;line-height:1.25;font-weight:500;text-transform:uppercase;margin-bottom:5px; }
		#gdl-activity-feed .gdl-news-title { color:#d6d7d8;font-size:17px;line-height:1.28;font-weight:400;white-space:normal;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow-wrap:anywhere;margin-bottom:8px; }
		#gdl-activity-feed .gdl-news-summary { color:#9da4ab;font-size:13px;line-height:1.45;white-space:normal;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow-wrap:anywhere; }
		#gdl-activity-feed .gdl-patch-note { height:74px;min-height:74px;max-height:74px; }
		#gdl-activity-feed .gdl-patch-layout { display:flex;align-items:center;gap:12px;padding:10px 14px;height:74px;box-sizing:border-box;overflow:hidden; }
		#gdl-activity-feed .gdl-patch-icon { flex:0 0 44px;width:44px;height:44px;color:#9da4ab;display:flex;align-items:center;justify-content:center; }
		#gdl-activity-feed .gdl-patch-icon svg { width:42px;height:42px;fill:currentColor;display:block; }
		#gdl-activity-feed .gdl-patch-copy { min-width:0; }
		#gdl-activity-feed .gdl-patch-note .gdl-news-type { margin-bottom:3px; }
		#gdl-activity-feed .gdl-patch-note .gdl-news-title { margin:0;font-size:17px; }
		#gdl-activity-feed .gdl-load-more-row { display:flex;justify-content:center;margin:26px 0 8px; }
		#gdl-activity-feed .gdl-activity-end { display:flex;align-items:center;gap:22px;margin:26px 0 8px;color:#8f98a0;font-size:13px;line-height:1;white-space:nowrap; }
		#gdl-activity-feed .gdl-activity-end::before,#gdl-activity-feed .gdl-activity-end::after { content:"";height:1px;flex:1 1 auto;background:rgba(255,255,255,.08); }
		#gdl-activity-feed .gdl-activity-end span { flex:0 0 auto; }
		#gdl-activity-feed .gdl-load-more-activity { display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:0 24px;background:#2b323c;color:#9da4ab;font-size:13px;text-decoration:none;border:0;border-radius:2px;cursor:pointer;box-shadow:none; }
		#gdl-activity-feed .gdl-load-more-activity:hover { background:#353e49;color:#d6d7d8; }
		#gdl-game-data,.gdl-activity-container { display:flex;flex-direction:column;justify-content:flex-start;align-items:stretch;flex:none;height:auto;min-height:0;overflow:visible; }
		@media (max-width:1050px) { #gdl-activity-feed .gdl-news-image { flex-basis:210px;width:210px;height:118px;min-height:118px;max-height:118px; } #gdl-activity-feed .${event.PartnerEventMediumImage_TextColumn}.gdl-news-copy { max-height:none; } }
		div.UltraNarrowRightPanel #gdl-activity-feed .gdl-news-layout { flex-direction:column; }
		div.UltraNarrowRightPanel #gdl-activity-feed .gdl-news-image { width:100%;max-width:100%;height:auto;aspect-ratio:16/9;min-height:0;max-height:none;margin:0 0 12px; }
	`);
}
