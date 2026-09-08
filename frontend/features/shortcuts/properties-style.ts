export const SHORTCUT_PROPERTIES_STYLE = `<style class="gdl-properties-layout-style">
	.gdl-properties-injected, .gdl-properties-injected * { box-sizing: border-box; }
	.gdl-properties-injected {
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
		padding-top: 24px;
		border-top: 1px solid var(--gdl-border);
	}
	.gdl-properties-injected .gdl-native-section + .gdl-native-section {
		margin-top: 24px;
	}
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
	.gdl-properties-injected .gdl-native-setting-row {
		display: grid;
		grid-template-columns: minmax(160px, .55fr) minmax(280px, 1fr);
		gap: 16px;
		align-items: center;
		min-height: 56px;
		padding: 12px 16px;
		background: var(--gdl-row);
		border: 1px solid rgba(255, 255, 255, .03);
		border-radius: 4px;
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
		position: sticky;
		bottom: 0;
		z-index: 2;
		margin-top: 12px;
		background: #19232e;
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
		height: 38px;
		padding: 8px 12px;
		background: var(--gdl-control);
		border: 1px solid rgba(255, 255, 255, .1);
		border-radius: 3px;
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
		height: 38px;
		min-height: 38px;
		padding: 0 16px;
		border: 0;
		border-radius: 3px;
		background: #3d4450;
		color: var(--gdl-text);
		font: inherit;
		font-size: 13px;
		font-weight: 500;
		letter-spacing: .25px;
		white-space: nowrap;
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
		background: var(--gdl-row);
		border: 1px solid rgba(255, 255, 255, .03);
		border-radius: 4px;
		overflow: hidden;
	}
	.gdl-properties-injected .gdl-auto-detect-header {
		display: flex;
		align-items: center;
		padding: 12px 16px 6px;
		color: var(--gdl-text);
		font-size: 13px;
		font-weight: 500;
	}
	.gdl-properties-injected .gdl-native-disclosure-body {
		padding: 4px 16px 14px;
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
		padding: 10px 12px;
		background: rgba(0, 0, 0, .25);
		border: 1px solid rgba(255, 255, 255, .05);
		border-radius: 3px;
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
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
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
		margin-top: 10px;
		padding: 12px 16px;
		background: var(--gdl-row);
		border: 1px solid rgba(255, 255, 255, .03);
		border-radius: 4px;
		color: #acb2b8;
		font-size: 12px;
		line-height: 1.45;
		cursor: pointer;
	}
	.gdl-properties-injected .gdl-native-option input {
		margin-top: 2px;
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
		padding: 12px 16px;
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
	@media (max-width: 720px) {
		.gdl-properties-injected .gdl-native-setting-row { grid-template-columns: 1fr; gap: 10px; }
		.gdl-properties-injected .gdl-game-achievement-online-row { flex-direction: column; }
		.gdl-properties-injected .gdl-native-controls { justify-content: stretch; flex-wrap: wrap; }
		.gdl-properties-injected .gdl-native-input { flex-basis: 100%; }
		.gdl-properties-injected .gdl-achievement-path-controls { flex-wrap: wrap; }
		.gdl-properties-injected .gdl-achievement-path-controls .gdl-native-input { flex-basis: 100%; }
	}
</style>`;
