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
	width: 44px !important;
	height: 44px !important;
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

/* Hide native Steam non-steam notices and duplicate placeholders */
[data-gdl-bp-hidden-notice="1"] {
	display: none !important;
	visibility: hidden !important;
	height: 0 !important;
	overflow: hidden !important;
}

#gdl-bp-cloud-divider[data-gdl-cloud-divider="1"] {
	width: calc(100% - 48px) !important;
	margin: 0 24px 12px !important;
	box-sizing: border-box !important;
}
#gdl-bp-cloud-divider[data-gdl-cloud-outside-tabs="1"] {
	margin-bottom: 10px !important;
}

/* Big Picture friends/activity parity. The geometry below is measured from
 * Steam GamepadUI reference captures at 1920x1080; Steam-resolved classes still
 * supply typography/focus tokens, while these rules preserve the native layout. */
.gdl-bp-activity-tab-content {
	padding-top: 12px !important;
	box-sizing: border-box !important;
}
.gdl-bp-friends-section-parity {
	margin-top: 0 !important;
	margin-bottom: 24px !important;
}
.gdl-bp-friends-grid-parity {
	display: grid !important;
	grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
	column-gap: 30px !important;
	row-gap: 0 !important;
	width: calc(100% - 96px) !important;
	margin-inline: 48px !important;
	min-width: 0 !important;
	box-sizing: border-box !important;
}
.gdl-bp-friends-column-parity {
	min-width: 0 !important;
	width: 100% !important;
}
.gdl-bp-friends-subheading-parity {
	margin: 0 0 16px 0 !important;
	font-size: 16px !important;
	font-weight: 700 !important;
	line-height: 18px !important;
	letter-spacing: .35px !important;
	text-transform: uppercase !important;
	color: #8f98a0 !important;
}
.gdl-bp-friends-list-parity {
	display: flex !important;
	flex-direction: column !important;
	gap: 6px !important;
	width: 100% !important;
	min-width: 0 !important;
}
.gdl-bp-friend-card-parity {
	display: flex !important;
	align-items: center !important;
	width: 100% !important;
	height: 60px !important;
	min-height: 60px !important;
	min-width: 0 !important;
	padding: 0 !important;
	box-sizing: border-box !important;
	background: rgba(255, 255, 255, 0.07) !important;
	border-radius: 3px !important;
	overflow: hidden !important;
}
.gdl-bp-friend-card-inner-parity {
	display: flex !important;
	align-items: center !important;
	width: 100% !important;
	height: 100% !important;
	min-width: 0 !important;
	padding: 4px 14px !important;
	gap: 18px !important;
	box-sizing: border-box !important;
}
.gdl-bp-friend-avatar-parity {
	width: 44px !important;
	height: 44px !important;
	min-width: 44px !important;
	min-height: 44px !important;
	max-width: 44px !important;
	max-height: 44px !important;
	flex: 0 0 44px !important;
	object-fit: cover !important;
	border-radius: 3px !important;
}
.gdl-bp-friend-name-parity {
	display: flex !important;
	align-items: center !important;
	min-width: 0 !important;
	height: 100% !important;
	overflow: hidden !important;
	text-overflow: ellipsis !important;
	white-space: nowrap !important;
	font-size: 17px !important;
	font-weight: 500 !important;
	line-height: 21px !important;
	color: #f1f1f1 !important;
}

/* Idle activity composer: preserve Steam's vertical rhythm without the current
 * user's avatar (explicit NativeGameLink policy for this surface). */
.gdl-bp-native-status-entry-idle {
	display: inline-flex !important;
	align-items: center !important;
	width: calc(100% - 56px) !important;
	max-width: none !important;
	min-height: 44px !important;
	margin: 0 28px 8px 28px !important;
	background: rgba(255,255,255,0.09) !important;
	border: 0 !important;
	box-shadow: none !important;
	cursor: text !important;
	padding: 8px 12px !important;
	border-radius: 3px !important;
	box-sizing: border-box !important;
}
.gdl-bp-native-status-entry-idle:hover,
.gdl-bp-native-status-entry-idle:focus,
.gdl-bp-native-status-entry-idle.gpfocus,
.gdl-bp-native-status-entry-idle[data-focus="true"] {
	background: rgba(255,255,255,0.09) !important;
	outline: none !important;
}
.gdl-bp-native-status-placeholder {
	user-select: none !important;
	font-size: 16px !important;
	line-height: 22px !important;
	font-weight: 400 !important;
	color: #8f98a0 !important;
}
.gdl-bp-post-entry-active {
	width: calc(100% - 56px) !important;
	margin: 0 28px 8px 28px !important;
	box-sizing: border-box !important;
}
.gdl-bp-native-status-textarea {
	display: block !important;
	width: 100% !important;
	min-width: 0 !important;
	min-height: 42px !important;
	padding: 8px 12px !important;
	box-sizing: border-box !important;
	resize: none !important;
	font: inherit !important;
	font-size: 16px !important;
	line-height: 22px !important;
	color: #f1f1f1 !important;
	background: rgba(255,255,255,0.09) !important;
	border: 0 !important;
	border-radius: 3px !important;
	box-shadow: none !important;
	appearance: none !important;
}
.gdl-bp-native-status-textarea::placeholder { color: #8f98a0 !important; }
.gdl-bp-native-status-textarea:focus { outline: none !important; }


/* Big Picture news / activity card modal. Keep Steam's ModalRoot and DialogButton,
 * but give the content a GamepadUI-scale reading surface instead of the narrow
 * desktop-like partner-event card that exposes raw BBCode and clips actions. */
.gdl-bp-news-modal-shell {
	width: min(1120px, 82vw) !important;
	max-width: 1120px !important;
	min-width: min(760px, 78vw) !important;
	box-sizing: border-box !important;
}
.gdl-bp-news-modal-window {
	position: relative !important;
	display: flex !important;
	flex-direction: column !important;
	width: 100% !important;
	max-height: calc(100vh - 190px) !important;
	overflow-y: auto !important;
	overflow-x: hidden !important;
	background: #1b222b !important;
	border: 1px solid rgba(255,255,255,0.10) !important;
	border-radius: 6px !important;
	box-shadow: 0 18px 70px rgba(0,0,0,0.58) !important;
	scrollbar-width: thin !important;
	box-sizing: border-box !important;
}
.gdl-bp-news-modal-hero {
	position: relative !important;
	width: 100% !important;
	aspect-ratio: 16 / 5.7 !important;
	min-height: 210px !important;
	max-height: 310px !important;
	overflow: hidden !important;
	background: #0e141b !important;
	flex: 0 0 auto !important;
}
.gdl-bp-news-modal-hero::after {
	content: '' !important;
	position: absolute !important;
	inset: auto 0 0 0 !important;
	height: 42% !important;
	background: linear-gradient(to bottom, rgba(27,34,43,0), #1b222b) !important;
	pointer-events: none !important;
}
.gdl-bp-news-modal-hero img {
	display: block !important;
	width: 100% !important;
	height: 100% !important;
	object-fit: cover !important;
	object-position: center !important;
}
.gdl-bp-news-modal-content {
	padding: 22px 30px 8px !important;
	box-sizing: border-box !important;
}
.gdl-bp-news-modal-meta {
	display: flex !important;
	align-items: center !important;
	gap: 9px !important;
	margin-bottom: 7px !important;
	font-size: 14px !important;
	font-weight: 600 !important;
	line-height: 20px !important;
	letter-spacing: .25px !important;
	text-transform: uppercase !important;
	color: #8f98a0 !important;
}
.gdl-bp-news-modal-title {
	margin: 0 0 18px !important;
	font-size: 26px !important;
	font-weight: 500 !important;
	line-height: 32px !important;
	color: #f1f3f5 !important;
}
.gdl-bp-news-modal-body {
	font-size: 17px !important;
	font-weight: 400 !important;
	line-height: 1.48 !important;
	color: #c6cbd1 !important;
	word-break: break-word !important;
	overflow-wrap: anywhere !important;
}
.gdl-bp-news-modal-body p {
	margin: 0 0 14px !important;
	white-space: pre-line !important;
}
.gdl-bp-news-modal-body p:last-child {
	margin-bottom: 0 !important;
}
.gdl-bp-news-modal-bullet {
	padding-left: 4px !important;
	color: #cfd4da !important;
}
.gdl-bp-news-modal-footer {
	position: sticky !important;
	bottom: 0 !important;
	z-index: 2 !important;
	display: flex !important;
	align-items: center !important;
	justify-content: flex-end !important;
	gap: 12px !important;
	width: 100% !important;
	padding: 16px 24px 18px !important;
	margin-top: 18px !important;
	background: linear-gradient(to bottom, rgba(27,34,43,0.90), #171d25 35%) !important;
	border-top: 1px solid rgba(255,255,255,0.08) !important;
	box-sizing: border-box !important;
}
.gdl-bp-news-modal-footer button,
.gdl-bp-news-modal-footer [role="button"] {
	min-width: 178px !important;
	min-height: 48px !important;
	font-size: 17px !important;
	box-sizing: border-box !important;
}
@media (max-width: 1100px) {
	.gdl-bp-news-modal-shell {
		width: 90vw !important;
		min-width: 0 !important;
	}
	.gdl-bp-news-modal-content {
		padding-inline: 22px !important;
	}
	.gdl-bp-news-modal-title {
		font-size: 23px !important;
		line-height: 29px !important;
	}
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
	align-content: center !important;
	gap: 6px !important;
	overflow: visible !important;
	height: auto !important;
	min-height: 30px !important;
	max-height: none !important;
	line-height: 0 !important;
}
.gdl-controller-support-row > * {
	overflow: visible !important;
	max-height: none !important;
}
/* Keep Steam's controller SVG internals untouched. Native controller glyphs
 * use multiple fills/strokes for buttons, sticks and D-pads; forcing fill on
 * svg/path/g collapses them into white silhouettes. The explicit playbar
 * geometry only normalizes the outer SVG box so inline-baseline/native row
 * clipping cannot cut off the lower grips. */
.gdl-controller-stat svg,
.gdl-controller-support-row svg {
	color: #ffffff;
	flex-shrink: 0;
	display: block !important;
	height: 28px !important;
	width: auto !important;
	max-height: none !important;
	overflow: visible !important;
	vertical-align: middle !important;
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

