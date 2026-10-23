export const SHORTCUT_PROPERTIES_STYLE = `<style class="gdl-properties-layout-style">
	.gdl-properties-injected, .gdl-properties-injected * { box-sizing: border-box; }
	.gdl-properties-injected {
		container-type: inline-size;
		--gdl-text: #dfe3e6;
		--gdl-muted: #8f98a0;
		--gdl-faint: #6f7882;
		--gdl-blue: #1a9fff;
		--gdl-blue-text: #66c0f4;
		--gdl-control: rgba(0, 0, 0, .25);
		--gdl-row: rgba(0, 0, 0, .2);
		--gdl-border: rgba(255, 255, 255, .08);
		color: var(--gdl-text);
		font-family: inherit;
	}
	.gdl-properties-injected .gdl-native-section {
		border-top: 1px solid var(--gdl-border);
	}
	.gdl-properties-injected .gdl-native-section + .gdl-native-section {
		margin-top: 0;
	}
	.gdl-properties-injected [hidden] { display: none !important; }
	.gdl-properties-injected .gdl-properties-category-summary {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 72px;
		padding: 16px 0;
		list-style: none;
		cursor: pointer;
		user-select: none;
	}
	.gdl-properties-injected summary::-webkit-details-marker { display: none; }
	.gdl-properties-injected summary::marker { content: ''; }
	.gdl-properties-injected .gdl-properties-category-summary:hover .gdl-properties-category-title { color: #fff; }
	.gdl-properties-injected summary:focus-visible,
	.gdl-properties-injected button:focus-visible,
	.gdl-properties-injected input:focus-visible {
		outline: 2px solid var(--gdl-blue-text);
		outline-offset: 3px;
	}
	.gdl-properties-injected .gdl-properties-category-copy { display: block; flex: 1; min-width: 0; }
	.gdl-properties-injected .gdl-properties-category-title {
		display: block;
		margin: 0;
		font-size: 14px;
		font-weight: 500;
		line-height: 1.4;
		letter-spacing: 0;
		text-transform: none;
	}
	.gdl-properties-injected .gdl-properties-category-description {
		display: block;
		margin: 4px 0 0;
		font-size: 12px;
		line-height: 1.45;
		color: var(--gdl-muted);
	}
	.gdl-properties-injected .gdl-properties-category-chevron {
		flex: 0 0 16px;
		color: var(--gdl-muted);
		font-size: 24px;
		line-height: 1;
		text-align: center;
		transition: transform .15s ease;
	}
	.gdl-properties-injected .gdl-properties-category[open] > summary .gdl-properties-category-chevron { transform: rotate(90deg); }
	.gdl-properties-injected .gdl-properties-category-body { padding: 0 0 20px; }
	.gdl-properties-injected .gdl-linked-game-image { width: 72px; height: 34px; object-fit: cover; flex: 0 0 72px; }
	.gdl-properties-injected .gdl-linked-game-state { font-size: 12px; color: var(--gdl-muted); }
	.gdl-properties-injected .gdl-link-section[data-linked="true"] .gdl-linked-game-state { color: var(--gdl-blue-text); }
	.gdl-properties-injected .gdl-link-section > summary .gdl-properties-category-description { overflow-wrap: anywhere; }
	.gdl-properties-injected .gdl-native-section:last-child { border-bottom: 1px solid var(--gdl-border); }
	.gdl-properties-injected .gdl-native-section-heading {
		font-family: inherit;
		font-size: 13px;
		font-weight: 700;
		line-height: 1.4;
		letter-spacing: 1.5px;
		text-transform: uppercase;
		color: #dfe3e6;
		margin: 0 0 10px 0;
	}
	.gdl-properties-injected .gdl-native-section-description {
		max-width: 720px;
		margin: 0 0 14px 0;
		font-size: 13px;
		line-height: 1.5;
		color: var(--gdl-muted);
	}
	.gdl-properties-injected .gdl-properties-category-summary .gdl-properties-category-title {
		margin: 0;
		font-size: 14px;
		font-weight: 500;
		letter-spacing: 0;
		text-transform: none;
	}
	.gdl-properties-injected .gdl-properties-category-summary .gdl-properties-category-description {
		margin: 4px 0 0;
		font-size: 12px;
		line-height: 1.45;
	}
	.gdl-properties-injected .gdl-native-setting-row {
		display: grid;
		grid-template-columns: minmax(140px, .7fr) minmax(0, 1fr);
		gap: 16px;
		align-items: center;
		min-height: 48px;
		padding: 10px 0;
		background: transparent;
		border: 0;
	}
	.gdl-properties-injected .gdl-native-setting-copy {
		min-width: 0;
	}
	.gdl-properties-injected .gdl-native-setting-title {
		font-size: 14px;
		font-weight: 500;
		line-height: 1.4;
		color: var(--gdl-text);
	}
	.gdl-properties-injected .gdl-native-setting-description {
		margin-top: 4px;
		font-size: 12px;
		line-height: 1.4;
		color: var(--gdl-muted);
	}
	.gdl-properties-injected .gdl-native-controls {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
		min-width: 0;
	}
	.gdl-properties-injected .gdl-link-actions {
		position: relative;
		margin-top: 0;
		grid-template-columns: minmax(0, 1fr);
	}
	.gdl-properties-injected .gdl-link-actions .gdl-native-controls {
		flex-wrap: wrap;
	}
	.gdl-properties-injected .gdl-link-actions .gdl-native-button {
		flex: 0 0 auto;
	}
	.gdl-properties-injected .gdl-native-input, .gdl-properties-injected .gdl-native-select {
		min-width: 0;
		height: 36px;
		padding: 8px 12px;
		background: var(--gdl-control);
		border: 1px solid rgba(255, 255, 255, .1);
		border-radius: 2px;
		outline: none;
		color: var(--gdl-text);
		font: inherit;
		font-size: 13px;
		transition: border-color .15s ease, box-shadow .15s ease;
	}
	.gdl-properties-injected .gdl-native-input {
		flex: 1 1 200px;
	}
	.gdl-properties-injected .gdl-native-select {
		width: 100%;
		cursor: pointer;
		color-scheme: dark;
		background-color: var(--gdl-control);
	}
	.gdl-properties-injected .gdl-native-select option {
		background: #1b2838;
		color: #dcdedf;
	}
	.gdl-properties-injected .gdl-native-select option:disabled {
		color: #8f98a0;
	}
	.gdl-properties-injected .gdl-native-input:focus, .gdl-properties-injected .gdl-native-select:focus {
		border-color: rgba(102, 192, 244, .9);
		box-shadow: 0 0 0 1px rgba(102, 192, 244, .4);
	}
	.gdl-properties-injected .gdl-native-button {
		min-height: 32px;
		padding: 7px 14px;
		border: 0;
		border-radius: 2px;
		background: #3d4450;
		color: var(--gdl-text);
		font: inherit;
		font-size: 13px;
		font-weight: 500;
		max-width: 100%;
		white-space: normal;
		line-height: 1.4;
		cursor: pointer;
		transition: background .15s ease, color .15s ease, filter .15s ease;
	}
	.gdl-properties-injected .gdl-native-button:hover:not(:disabled) {
		background: #47505d;
		color: #fff;
	}
	.gdl-properties-injected .gdl-native-button:disabled {
		cursor: default;
	}
	.gdl-properties-injected .gdl-native-button-primary {
		background: var(--gdl-blue);
		color: #fff;
	}
	.gdl-properties-injected .gdl-native-button-primary:hover:not(:disabled) {
		background: #28a5ff;
	}
	.gdl-properties-injected .gdl-native-status {
		min-height: 16px;
		margin-top: 8px;
		padding: 0 2px;
		font-size: 12px;
		line-height: 1.4;
		color: var(--gdl-muted);
	}
	.gdl-properties-injected .gdl-native-status:empty {
		display: none;
	}
	.gdl-properties-injected .gdl-native-disclosure {
		margin-top: 12px;
		background: transparent;
		border: 0;
		border-top: 1px solid var(--gdl-border);
	}
	.gdl-properties-injected .gdl-auto-detect-header {
		display: flex;
		align-items: center;
		padding: 14px 0 6px;
		color: var(--gdl-text);
		font-size: 13px;
		font-weight: 500;
	}
	.gdl-properties-injected .gdl-native-disclosure-body {
		padding: 4px 0 0;
	}
	.gdl-properties-injected .gdl-auto-detect-title {
		margin-bottom: 8px;
		font-size: 12px;
		line-height: 1.4;
		color: var(--gdl-muted);
	}
	.gdl-properties-injected .gdl-candidate-primary {
		display: flex;
		align-items: center;
		gap: 12px;
		min-width: 0;
		margin-top: 10px;
		padding: 8px 0;
		background: transparent;
	}
	.gdl-properties-injected .gdl-candidate-primary img {
		width: 104px;
		height: 48px;
		flex: 0 0 104px;
		object-fit: cover;
		border: 1px solid rgba(255, 255, 255, .1);
		border-radius: 2px;
	}
	.gdl-properties-injected .gdl-candidate-name {
		overflow-wrap: anywhere;
		font-size: 13px;
		font-weight: 500;
		color: var(--gdl-text);
	}
	.gdl-properties-injected .gdl-candidate-meta {
		margin-top: 3px;
		font-size: 12px;
		color: var(--gdl-blue-text);
	}
	.gdl-properties-injected .gdl-auto-candidate-strip {
		display: flex;
		gap: 6px;
		margin-top: 8px;
		padding: 1px 1px 4px;
		overflow-x: auto;
	}
	.gdl-properties-injected .gdl-native-option {
		display: none;
		align-items: flex-start;
		gap: 10px;
		margin-top: 0;
		padding: 10px 0;
		background: transparent;
		border: 0;
		color: #acb2b8;
		font-size: 12px;
		line-height: 1.45;
		cursor: pointer;
	}
	.gdl-properties-injected .gdl-playtime-tracking {
		display: flex;
	}
	.gdl-properties-injected .gdl-native-option input {
		margin-top: 2px;
		flex-shrink: 0;
		accent-color: var(--gdl-blue);
	}
	.gdl-properties-injected .gdl-native-option strong {
		font-weight: 500;
		color: var(--gdl-text);
	}
	.gdl-properties-injected .gdl-game-achievement-options {
		display: grid;
		gap: 10px;
	}
	.gdl-properties-injected .gdl-achievement-setting-row {
		align-items: start;
	}
	.gdl-properties-injected .gdl-game-achievement-online-row > .gdl-native-setting-copy {
		flex: .55 1 160px;
	}
	.gdl-properties-injected .gdl-game-achievement-online-row > .gdl-achievement-control {
		flex: 1 1 280px;
	}
	.gdl-properties-injected .gdl-achievement-control {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 8px 14px;
		align-items: center;
		min-width: 0;
	}
	.gdl-properties-injected .gdl-achievement-count {
		grid-column: 2;
		font-size: 13px;
		font-weight: 600;
		color: var(--gdl-blue-text);
		white-space: nowrap;
	}
	.gdl-properties-injected .gdl-game-achievement-slider {
		grid-column: 1 / -1;
		-webkit-appearance: none;
		appearance: none;
		accent-color: transparent !important;
		width: 100%;
		height: 6px;
		margin: 8px 0 4px;
		background-color: var(--gdl-control);
		background-repeat: no-repeat !important;
		border: 1px solid rgba(255, 255, 255, .08);
		border-radius: 3px;
		outline: none;
		cursor: pointer;
	}
	.gdl-properties-injected .gdl-game-achievement-slider::-webkit-slider-runnable-track {
		-webkit-appearance: none;
		height: 6px;
		background: transparent !important;
		border-radius: 3px;
	}
	.gdl-properties-injected .gdl-game-achievement-slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		box-sizing: border-box;
		width: 16px;
		height: 16px;
		margin-top: -5px;
		background: var(--gdl-blue);
		border: 2px solid #fff;
		border-radius: 50%;
		box-shadow: 0 1px 4px rgba(0, 0, 0, .6);
		cursor: pointer;
		transition: transform .08s ease, background .12s ease;
	}
	.gdl-properties-injected .gdl-game-achievement-slider::-webkit-slider-thumb:hover {
		background: #47b2ff;
		transform: scale(1.12);
	}
	.gdl-properties-injected .gdl-game-achievement-slider::-webkit-slider-thumb:active {
		background: #0d82d4;
		transform: scale(1.2);
	}
	.gdl-properties-injected .gdl-achievement-actions {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 10px;
		margin-top: 12px;
	}
	.gdl-properties-injected .gdl-achievement-actions .gdl-native-status {
		flex: 1 1 180px;
		margin: 0;
		padding: 0;
	}
	.gdl-properties-injected .gdl-game-achievement-picker-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.gdl-properties-injected .gdl-achievement-path-controls {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.gdl-properties-injected .gdl-achievement-hint {
		margin-top: 8px;
		font-size: 12px;
		line-height: 1.45;
		color: var(--gdl-muted);
	}
	.gdl-properties-injected .gdl-achievement-path-disclosure {
		margin-top: 12px;
	}
	.gdl-properties-injected .gdl-achievement-path-disclosure summary {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		padding: 14px 0;
		font-size: 13px;
		font-weight: 500;
		color: var(--gdl-text);
		cursor: pointer;
		user-select: none;
	}
	.gdl-properties-injected .gdl-native-disclosure-chevron {
		font-size: 14px;
		transition: transform .15s ease;
	}
	.gdl-properties-injected .gdl-achievement-path-disclosure[open] .gdl-native-disclosure-chevron {
		transform: rotate(180deg);
	}

	.gdl-properties-injected .gdl-community-item-options[hidden],
	.gdl-properties-injected .gdl-community-item-options [hidden] { display: none !important; }
	.gdl-properties-injected .gdl-community-card-summary { margin: 8px 0; }
	.gdl-properties-injected .gdl-community-card-list { display: grid; grid-template-columns: repeat(auto-fill,minmax(100px,1fr)); gap: 10px; }
	.gdl-properties-injected .gdl-community-card-choice { display: flex; flex-direction: column; align-items: center; gap: 6px; position: relative; min-width: 0; padding: 8px; background: transparent; border: 1px solid var(--gdl-border); cursor: pointer; }
	.gdl-properties-injected .gdl-community-card-choice:has(input:checked) { border-color: rgba(102,192,244,.5); background: rgba(102,192,244,.04); }
	.gdl-properties-injected .gdl-community-card-choice input { align-self: flex-start; accent-color: var(--gdl-blue); }
	.gdl-properties-injected .gdl-community-card-choice img { display: block; width: 72px; height: 84px; object-fit: contain; }
	.gdl-properties-injected .gdl-community-card-choice span { width: 100%; overflow-wrap: anywhere; text-align: center; font-size: 12px; line-height: 1.4; }
	.gdl-properties-injected .gdl-community-actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 12px 0; }
	.gdl-properties-injected .gdl-community-badge-controls { display: flex; align-items: center; gap: 10px; min-width: 0; }
	.gdl-properties-injected .gdl-community-badge-preview { width: 48px; height: 48px; object-fit: contain; flex: 0 0 48px; }
	.gdl-properties-injected .gdl-community-options-status[data-error="true"] { color: #ff6b6b; }
	.gdl-properties-injected .gdl-auto-detect-retry { margin-top: 8px; }
	@container (max-width: 520px) {
		.gdl-properties-injected .gdl-native-setting-row { grid-template-columns: 1fr; gap: 10px; }
		.gdl-properties-injected .gdl-native-controls { justify-content: stretch; flex-wrap: wrap; }
		.gdl-properties-injected .gdl-native-input { flex-basis: 100%; }
		.gdl-properties-injected .gdl-achievement-path-controls { flex-wrap: wrap; }
		.gdl-properties-injected .gdl-achievement-path-controls .gdl-native-input { flex-basis: 100%; }
		.gdl-properties-injected .gdl-game-achievement-online-row { flex-direction: column; }
		.gdl-properties-injected .gdl-game-achievement-online-row > .gdl-native-setting-copy,
		.gdl-properties-injected .gdl-game-achievement-online-row > .gdl-achievement-control { flex: 0 0 auto; width: 100%; }
		.gdl-properties-injected .gdl-linked-game-state { display: none; }
	}
	@media (max-width: 720px) {
		.gdl-properties-injected .gdl-native-setting-row { grid-template-columns: 1fr; gap: 10px; }
		.gdl-properties-injected .gdl-game-achievement-online-row { flex-direction: column; }
		.gdl-properties-injected .gdl-game-achievement-online-row > .gdl-native-setting-copy,
		.gdl-properties-injected .gdl-game-achievement-online-row > .gdl-achievement-control { flex: 0 0 auto; width: 100%; }
		.gdl-properties-injected .gdl-native-controls { justify-content: stretch; flex-wrap: wrap; }
		.gdl-properties-injected .gdl-native-input { flex-basis: 100%; }
		.gdl-properties-injected .gdl-achievement-path-controls { flex-wrap: wrap; }
		.gdl-properties-injected .gdl-achievement-path-controls .gdl-native-input { flex-basis: 100%; }
	}
</style>`;
