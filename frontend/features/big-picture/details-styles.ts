export function ensureBigPictureDetailStyles(doc: Document): void {
	if (!doc.head) return;
	if (doc.getElementById('gdl-bp-detail-styles')) return;

	const style = doc.createElement('style');
	style.id = 'gdl-bp-detail-styles';
	style.textContent = `
/* Big Picture Community tab layout */
.gdl-bp-community-grid {
	display: grid !important;
	grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
	gap: 16px !important;
	width: 100% !important;
	box-sizing: border-box !important;
	padding: 4px 0 28px 0 !important;
}
.gdl-bp-community-item {
	display: flex !important;
	flex-direction: column !important;
	background: rgba(255, 255, 255, 0.05) !important;
	border-radius: 6px !important;
	overflow: hidden !important;
	cursor: pointer !important;
	transition: transform 0.15s ease, background 0.15s ease, box-shadow 0.15s ease !important;
	box-sizing: border-box !important;
	padding: 8px !important;
	border: 1px solid rgba(255, 255, 255, 0.04) !important;
}
.gdl-bp-community-item:hover,
.gdl-bp-community-item:focus,
.gdl-bp-community-item.gpfocus,
.gdl-bp-community-item[data-focus="true"] {
	background: rgba(255, 255, 255, 0.14) !important;
	border-color: rgba(255, 255, 255, 0.3) !important;
	transform: scale(1.02) !important;
	box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5) !important;
	outline: none !important;
}
.gdl-bp-community-preview-wrap {
	width: 100% !important;
	aspect-ratio: 16 / 9 !important;
	max-height: 200px !important;
	overflow: hidden !important;
	border-radius: 4px !important;
	background: rgba(0, 0, 0, 0.6) !important;
	position: relative !important;
	display: flex !important;
	align-items: center !important;
	justify-content: center !important;
}
.gdl-bp-community-preview-img {
	width: 100% !important;
	height: 100% !important;
	object-fit: cover !important;
	display: block !important;
}
.gdl-bp-video-play-btn {
	position: absolute !important;
	top: 50% !important;
	left: 50% !important;
	transform: translate(-50%, -50%) !important;
	width: 52px !important;
	height: 52px !important;
	fill: #ffffff !important;
	color: #ffffff !important;
	background: rgba(0, 0, 0, 0.65) !important;
	border-radius: 50% !important;
	padding: 10px !important;
	box-sizing: border-box !important;
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.6) !important;
	pointer-events: none !important;
	transition: transform 0.15s ease, background 0.15s ease !important;
}
.gdl-bp-community-item:hover .gdl-bp-video-play-btn,
.gdl-bp-community-item:focus .gdl-bp-video-play-btn,
.gdl-bp-community-item.gpfocus .gdl-bp-video-play-btn,
.gdl-bp-community-item[data-focus="true"] .gdl-bp-video-play-btn {
	background: rgba(26, 159, 255, 0.9) !important;
	transform: translate(-50%, -50%) scale(1.1) !important;
}
.gdl-bp-video-modal-wrap {
	width: 100% !important;
	max-width: 1060px !important;
	aspect-ratio: 16 / 9 !important;
	margin: 0 auto !important;
	background: #000000 !important;
	border-radius: 8px !important;
	overflow: hidden !important;
}
.gdl-bp-video-modal-frame {
	width: 100% !important;
	height: 100% !important;
	border: none !important;
	display: block !important;
}
.gdl-bp-video-modal-footer {
	display: flex !important;
	justify-content: flex-end !important;
	margin-top: 12px !important;
}
.gdl-bp-community-title {
	font-size: 13px !important;
	font-weight: 500 !important;
	color: #e6e6e6 !important;
	margin-top: 8px !important;
	white-space: nowrap !important;
	overflow: hidden !important;
	text-overflow: ellipsis !important;
	line-height: 1.3 !important;
}
.gdl-bp-community-author {
	display: flex !important;
	align-items: center !important;
	gap: 6px !important;
	margin-top: 6px !important;
	font-size: 11px !important;
	color: #8f98a0 !important;
}
.gdl-bp-community-avatar {
	width: 18px !important;
	height: 18px !important;
	border-radius: 50% !important;
	display: block !important;
}

/* Big Picture Game Info tab layout */
.gdl-bp-info-root {
	display: flex !important;
	flex-direction: column !important;
	width: 100% !important;
	gap: 20px !important;
	box-sizing: border-box !important;
	padding: 4px 0 28px 0 !important;
}
.gdl-bp-info-main {
	display: flex !important;
	flex-direction: row !important;
	gap: 24px !important;
	width: 100% !important;
	background: rgba(0, 0, 0, 0.35) !important;
	backdrop-filter: blur(12px) !important;
	border-radius: 8px !important;
	padding: 20px !important;
	box-sizing: border-box !important;
	border: 1px solid rgba(255, 255, 255, 0.08) !important;
}
.gdl-bp-info-cover-wrap {
	flex-shrink: 0 !important;
	width: 200px !important;
	border-radius: 6px !important;
	overflow: hidden !important;
	box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6) !important;
}
.gdl-bp-info-cover-img {
	width: 100% !important;
	height: auto !important;
	display: block !important;
	border-radius: 6px !important;
}
.gdl-bp-info-body {
	display: flex !important;
	flex-direction: column !important;
	flex: 1 1 0% !important;
	gap: 16px !important;
	min-width: 0 !important;
}
.gdl-bp-info-description {
	font-size: 14px !important;
	line-height: 1.5 !important;
	color: #dcdedf !important;
}
.gdl-bp-info-stats {
	display: grid !important;
	grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)) !important;
	gap: 12px 20px !important;
	padding-top: 12px !important;
	border-top: 1px solid rgba(255, 255, 255, 0.08) !important;
}
.gdl-bp-info-stat-item {
	display: flex !important;
	flex-direction: column !important;
	gap: 2px !important;
}
.gdl-bp-info-stat-label {
	font-size: 11px !important;
	text-transform: uppercase !important;
	letter-spacing: 0.5px !important;
	color: #8f98a0 !important;
}
.gdl-bp-info-stat-value {
	font-size: 13px !important;
	color: #ffffff !important;
	font-weight: 500 !important;
}
.gdl-bp-info-features {
	display: flex !important;
	flex-wrap: wrap !important;
	gap: 8px !important;
	padding-top: 12px !important;
	border-top: 1px solid rgba(255, 255, 255, 0.08) !important;
}
.gdl-bp-info-quick-links {
	display: flex !important;
	flex-direction: row !important;
	flex-wrap: wrap !important;
	gap: 10px !important;
	margin-top: 4px !important;
}

/* Hide native Steam non-steam notices and duplicate placeholders */
[data-gdl-bp-hidden-notice="1"] {
	display: none !important;
	visibility: hidden !important;
	height: 0 !important;
	overflow: hidden !important;
}

/* Big Picture Activity Post Entry Bar & Active Composer */
.gdl-bp-post-entry-bar,
.gdl-bp-post-entry-bar.Focusable,
.gdl-bp-post-entry-bar.gpfocus,
.gdl-bp-post-entry-bar.gpfocuswithin,
.gdl-bp-post-entry-bar:focus,
.gdl-bp-post-entry-bar:hover,
.gdl-bp-post-entry-bar[data-focus="true"] {
	background: rgba(255, 255, 255, 0.06) !important;
	border: 2px solid transparent !important;
	border-radius: 4px !important;
	box-shadow: none !important;
	color: #ffffff !important;
	transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease !important;
}

.gdl-bp-post-entry-bar.gpfocus,
.gdl-bp-post-entry-bar:focus,
.gdl-bp-post-entry-bar:hover,
.gdl-bp-post-entry-bar[data-focus="true"] {
	background: rgba(255, 255, 255, 0.12) !important;
	border-color: #ffffff !important;
	box-shadow: 0 0 10px rgba(255, 255, 255, 0.35) !important;
	outline: none !important;
}

.gdl-bp-post-entry-bar div,
.gdl-bp-post-entry-bar span {
	color: #8f98a0 !important;
}

.gdl-bp-post-entry-bar.gpfocus div,
.gdl-bp-post-entry-bar:focus div,
.gdl-bp-post-entry-bar:hover div,
.gdl-bp-post-entry-bar[data-focus="true"] div,
.gdl-bp-post-entry-bar.gpfocus span,
.gdl-bp-post-entry-bar:focus span,
.gdl-bp-post-entry-bar:hover span,
.gdl-bp-post-entry-bar[data-focus="true"] span {
	color: #ffffff !important;
}

.gdl-bp-post-entry-active,
.gdl-bp-post-entry-active.Focusable,
.gdl-bp-post-entry-active.gpfocus,
.gdl-bp-post-entry-active.gpfocuswithin,
.gdl-bp-post-entry-active:focus,
.gdl-bp-post-entry-active:focus-within {
	background: transparent !important;
	border: none !important;
	border-radius: 0 !important;
	box-shadow: none !important;
	outline: none !important;
	padding: 0 !important;
}

#gdl-bp-detail-root textarea,
#gdl-bp-detail-root input,
.gdl-bp-post-entry-bar,
.gdl-bp-post-entry-active {
	outline: none !important;
	box-sizing: border-box !important;
	resize: none !important;
}

.gdl-bp-post-entry-bar {
	background: rgba(255, 255, 255, 0.12) !important;
	border: 1px solid rgba(255, 255, 255, 0.2) !important;
	color: #ffffff !important;
	border-radius: 4px !important;
}

.gdl-bp-post-entry-bar::before,
.gdl-bp-post-entry-bar::after {
	display: none !important;
	content: none !important;
}

.gdl-bp-post-entry-bar.gpfocus,
.gdl-bp-post-entry-bar:focus,
.gdl-bp-post-entry-bar:focus-within,
.gdl-bp-post-entry-active.gpfocus,
.gdl-bp-post-entry-active:focus,
.gdl-bp-post-entry-active:focus-within {
	background: rgba(255, 255, 255, 0.12) !important;
	border-color: #ffffff !important;
	border: 1px solid #ffffff !important;
	box-shadow: 0 0 10px rgba(255, 255, 255, 0.35) !important;
	color: #ffffff !important;
}

.gdl-bp-post-entry-bar input,
.gdl-bp-post-entry-bar input:focus,
.gdl-bp-post-entry-bar input.gpfocus,
.gdl-bp-post-entry-active textarea,
.gdl-bp-post-entry-active textarea:focus,
.gdl-bp-post-entry-active textarea.gpfocus {
	background: transparent !important;
	border: none !important;
	outline: none !important;
	box-shadow: none !important;
	color: #ffffff !important;
	resize: none !important;
}

.gdl-bp-post-entry-bar input::placeholder,
.gdl-bp-post-entry-active textarea::placeholder {
	color: rgba(148, 161, 166, 0.65) !important;
	font-style: italic !important;
}

/* Big Picture Playbar Controller Stat - 100% parity with Steam native ControllerSupportInfo */
.gdl-controller-stat {
	display: flex !important;
	flex-direction: column !important;
	height: auto !important;
	min-height: 32px !important;
	margin-top: 0 !important;
	margin-inline: 5px !important;
	align-items: flex-start !important;
	overflow: visible !important;
}
.gdl-controller-support-row {
	display: flex !important;
	flex-direction: row !important;
	align-items: center !important;
	gap: 6px !important;
	overflow: visible !important;
	height: auto !important;
}
.gdl-controller-stat svg,
.gdl-controller-support-row svg {
	color: #ffffff !important;
	fill: #ffffff !important;
	opacity: 1 !important;
	height: 36px !important;
	width: auto !important;
	max-height: 36px !important;
	flex-shrink: 0 !important;
	display: block !important;
	overflow: visible !important;
}
.gdl-controller-stat svg path,
.gdl-controller-support-row svg path,
.gdl-controller-stat svg g,
.gdl-controller-support-row svg g {
	fill: currentColor !important;
	opacity: 1 !important;
}

/* Big Picture Achievements Carousel - Parity with Steam native BoxCarousel & no compression */
[class*="AchievementCarouselItem"],
.gdl-bp-achievement-item {
	flex-shrink: 0 !important;
}

/* Big Picture Activity Post Composer - Parity with native GamepadUI PostTextEntry */
.GamepadUI .gdl-emoticon-btn,
.gamepadui .gdl-emoticon-btn,
.GamepadUI #gdl-status-controls,
.gamepadui #gdl-status-controls,
.GamepadUI .gdl-latest-news-row,
.gamepadui .gdl-latest-news-row {
	display: none !important;
}
`
	doc.head.appendChild(style);
}

