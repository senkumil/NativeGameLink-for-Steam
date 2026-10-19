import { EVENT_CLASSES } from '../../../steam/css';
import { injectLibraryStyle } from './inject';

export function ensureActivityStyles(doc: Document): void {
	const event = EVENT_CLASSES(doc);
	injectLibraryStyle(doc, 'gdl-activity-styles', `
		/* Steam's desktop details layout keeps RightColumn as a 33% right float.
		   A 100%-wide injected child cannot flow beside it and is moved below the
		   entire sidebar. Mirror Steam's own SpotlightLeftColumn breakpoints so
		   Activity uses that width. Community supplies its own full width and
		   clearance after the taller column, within the same owned stack. */
		#gdl-main-content-stack, #gdl-skeleton { width:calc(67% - 32px) !important; }
		div.NarrowWindow #gdl-main-content-stack, div.NarrowWindow #gdl-skeleton { width:calc(67% - 22px) !important; }
		div.UltraNarrowRightPanel #gdl-main-content-stack, div.UltraNarrowRightPanel #gdl-skeleton { width:100% !important; }
		/* The owned main stack already supplies the native left-column width. */
		#gdl-activity-feed { max-width:100%; }
		/* Native event classes own dates, title typography, copy limits and the
		   major-update layout. The injected media keeps only its asset surface. */
		#gdl-activity-feed .gdl-news-layout { display:flex;align-items:stretch;column-gap:0;height:auto;min-height:0;padding:12px;box-sizing:border-box;overflow:hidden; }
		#gdl-activity-feed .gdl-news-image { flex:0 0 auto;width:274px;height:154px;max-height:154px;min-height:154px;max-width:100%;min-width:0;margin:0 16px 0 0;padding:0;box-sizing:border-box;background:#0e141b;position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:2px;align-self:flex-start; }
		#gdl-activity-feed .gdl-news-image img.gdl-news-image-blur { position:absolute;top:-15%;left:-15%;width:130%;height:130%;max-width:none;max-height:none;object-fit:cover;filter:blur(14px) brightness(0.45);opacity:0.75;pointer-events:none; }
		#gdl-activity-feed .gdl-news-image img.gdl-news-image-fg { position:relative;width:100%;height:100%;max-width:100%;max-height:100%;object-fit:contain;object-position:center;display:block;z-index:1; }
		#gdl-activity-feed .gdl-news-image img:not(.gdl-news-image-blur):not(.gdl-news-image-fg) { width:100%;height:100%;max-width:none;max-height:none;object-fit:cover;display:block; }
		#gdl-activity-feed .${event.PartnerEventMediumImage_TextColumn}.gdl-news-copy { min-width:0; }
		#gdl-activity-feed .gdl-news-summary { overflow:hidden; }
		#gdl-activity-feed .gdl-load-more-row { display:flex;justify-content:center; }
		#gdl-activity-feed .gdl-activity-end { display:flex;align-items:center;gap:22px;margin:26px 0 8px;color:#8f98a0;font-size:13px;line-height:1;white-space:nowrap; }
		#gdl-activity-feed .gdl-activity-end::before,#gdl-activity-feed .gdl-activity-end::after { content:"";height:1px;flex:1 1 auto;background:rgba(255,255,255,.08); }
		#gdl-activity-feed .gdl-activity-end span { flex:0 0 auto; }
		.gdl-activity-container { display:flex;flex-direction:column;justify-content:flex-start;align-items:stretch;flex:none;height:auto;min-height:0;overflow:visible; }
		/* Steam stacks medium news at the detail pane's own breakpoint. Window
		   media queries miss a resized library list and the client's UI scale. */
		div.NarrowRightPanel #gdl-activity-feed .gdl-news-layout,
		div.UltraNarrowRightPanel #gdl-activity-feed .gdl-news-layout { flex-direction:column; }
	`);
}
