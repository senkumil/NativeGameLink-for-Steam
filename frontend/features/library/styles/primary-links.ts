import { injectLibraryStyle } from './inject';

export function ensurePrimaryLinksStyles(doc: Document): void {
	injectLibraryStyle(doc, 'gdl-primary-links-styles', `
		#gdl-link-bar:not([data-gdl-links-settled="1"]) {
			visibility: hidden !important;
			opacity: 0 !important;
			pointer-events: none !important;
		}
		/* Steam's Section/Body/Links/LinkInner/Anchor/Link/Text classes own all
		 * dimensions, margins, type and hover styles. Only interaction belongs here. */
		#gdl-link-bar .gdl-primary-link { text-decoration:none;cursor:pointer; }
		#gdl-link-bar .gdl-primary-more { display:none;cursor:pointer; }
		#gdl-link-bar .gdl-primary-more summary {
			list-style:none;display:flex;align-items:center;justify-content:center;
			width:100%;padding:0;margin:0;cursor:pointer;
		}
		#gdl-link-bar .gdl-primary-more summary::-webkit-details-marker { display:none; }
		#gdl-link-bar .gdl-primary-more-menu { position:fixed;inset:auto;margin:0;min-width:115px;padding:4px 0;background:#3d4450;border:0;border-radius:0;box-shadow:0 5px 12px rgba(0,0,0,.5);width:max-content; }
		#gdl-link-bar .gdl-primary-overflow-link { display:block;padding:8px 16px;color:#dcdedf;text-decoration:none;font-family:"Motiva Sans",Arial,sans-serif;font-size:14px;line-height:18px;white-space:nowrap;box-sizing:border-box; }
		#gdl-link-bar .gdl-primary-overflow-link:hover,#gdl-link-bar .gdl-primary-overflow-link:focus-visible { color:#fff;background:#4b5361;outline:none; }
	`);
}
