import { injectLibraryStyle } from './inject';

export function ensureControllerStyles(doc: Document): void {
	injectLibraryStyle(doc, 'gdl-controller-card-style', `
		/* Steam's controller capability surface matching official native layout */
		#gdl-controller-section { margin: 0 !important; }
		.gdl-controller-card {
			height: auto !important;
			min-height: unset !important;
			padding: 11px 16px 11px 12px !important;
			box-sizing: border-box !important;
			/* Native-like glass matching native Steam right sidebar panels. */
			background: rgba(20, 27, 36, .30) !important;
			border: 1px solid rgba(255, 255, 255, .085) !important;
			border-radius: 0 !important;
			box-shadow: inset 0 1px 0 rgba(255, 255, 255, .018) !important;
			backdrop-filter: none !important;
			-webkit-backdrop-filter: none !important;
			transition: background-color .20s ease, border-color .20s ease, box-shadow .20s ease !important;
			cursor: pointer;
			position: relative;
			padding: 12px 14px;
		}
		#gdl-controller-section[data-gdl-controller-scrolled="1"] .gdl-controller-card {
			background: rgba(16, 22, 30, .14) !important;
			border-color: rgba(255, 255, 255, .06) !important;
			box-shadow: inset 0 1px 0 rgba(255, 255, 255, .012) !important;
		}
		.gdl-controller-card:hover {
			border-color: rgba(255, 255, 255, .12) !important;
			box-shadow: inset 0 1px 0 rgba(255, 255, 255, .045) !important;
		}
		/* Steam Webpack Module 10191 Controller Classes & Semantic Fallbacks */
		#gdl-controller-section ._2A8NghNvAnMQQTHsudFu7H,
		#gdl-controller-section .gdl-controller-status-svg {
			width: 44px !important;
			min-width: 44px !important;
			flex-basis: 44px !important;
			height: 44px !important;
			color: #ffffff;
			margin-inline-start: 4px;
			display: flex;
			align-items: center;
			justify-content: center;
			flex-shrink: 0;
		}
		#gdl-controller-section ._2A8NghNvAnMQQTHsudFu7H svg,
		#gdl-controller-section .gdl-controller-status-svg svg {
			width: 100%;
			height: 100%;
			display: block;
		}
		#gdl-controller-section ._2A8NghNvAnMQQTHsudFu7H._3vJM7qN0DSpUfz-bhkewEQ,
		#gdl-controller-section .gdl-controller-status-svg.gdl-controller-unknown {
			color: #95999e !important;
		}
		#gdl-controller-section ._29FYex2d6Tntax9SEBTxkL,
		#gdl-controller-section .gdl-controller-stroke {
			position: absolute !important;
			width: 52px !important;
			height: 3px !important;
			top: 32px !important;
			inset-inline-start: 10px !important;
			background: #e05f5f !important;
			transform: rotate(155.43deg) !important;
			z-index: 2 !important;
			pointer-events: none !important;
		}
		#gdl-controller-section .bG5F-o9ZUikaoNCIniMEa,
		#gdl-controller-section .gdl-controller-body {
			display: flex;
			flex-direction: column;
			position: relative;
			min-width: 0;
		}
		#gdl-controller-section .Gs_qHIFwN4Z9JusWrfbfP,
		#gdl-controller-section .gdl-controller-row {
			display: flex;
			flex-direction: row;
			align-items: center;
			min-width: 0;
		}
		#gdl-controller-section ._1vvIpx6zQ1mZiiY1y-PtlS,
		#gdl-controller-section .gdl-controller-column {
			display: flex;
			flex-direction: column;
			margin-inline-start: 14px;
			margin-top: 2px;
			min-width: 0;
			flex: 1;
		}
		#gdl-controller-section ._2L06P_EWxoS_20kC2eNCQl,
		#gdl-controller-section .gdl-controller-header {
			color: #ffffff;
			font-family: "Motiva Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
			font-style: normal;
			font-weight: 500;
			font-size: 13px;
			line-height: 19px;
			text-wrap: wrap;
		}
		#gdl-controller-section ._8tm4KhHFNHvzsiuuyHgld,
		#gdl-controller-section .gdl-controller-desc {
			display: flex;
			font-family: "Motiva Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
			font-style: normal;
			font-weight: 400;
			font-size: 12px;
			line-height: 17px;
			text-wrap: wrap;
			color: #cacbcd;
			margin-top: 2px;
		}
		#gdl-controller-section .QO0udpE4qSEcDjkVg5IwH,
		#gdl-controller-section .gdl-controller-button-container {
			display: flex;
			justify-content: flex-end;
			margin-top: 10px;
		}
		#gdl-controller-section ._3Cdin80d-hVsakHUZboheb,
		#gdl-controller-section .gdl-controller-link {
			color: #8c9193;
			font-size: 12px;
			line-height: 16px;
			font-family: "Motiva Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
			background: transparent;
			border: 0;
			cursor: pointer;
			padding: 0;
			transition: color .15s ease;
		}
		#gdl-controller-section .gdl-controller-card:hover ._3Cdin80d-hVsakHUZboheb,
		#gdl-controller-section .gdl-controller-card:hover .gdl-controller-link,
		#gdl-controller-section ._3Cdin80d-hVsakHUZboheb:hover,
		#gdl-controller-section .gdl-controller-link:hover {
			color: #ffffff !important;
		}
	`);
}

export function removeControllerStyles(doc: Document): void {
	doc.getElementById('gdl-controller-card-style')?.remove();
}
