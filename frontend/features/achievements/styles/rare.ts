import { STEAM_RARE_ACHIEVEMENT_MASK_DATA_URI } from './mask';

/**
 * Official Steam 1:1 rare achievement animations and styles extracted directly
 * from Steam client bundle chunk~2dcc5aaf7.css.
 *
 * Implements:
 * 1. Clockwise conic gradient rotation (6s) + overlay blend mode (_1Z2eJs9-zNTKcWKy4M-oDE).
 * 2. Counter-clockwise mask rotation (18s) (_2D_EJk8-jCnfqiwoKkOMVh).
 * 3. Static root mask container (_2HUbCbZUn27MliiC8gRxGB).
 * 4. Dual-radius gold image box-shadow (_3s4Rq3jnntBVP7HbJj1RMQ).
 * 5. Reduced-motion / LowPerfMode pausing support.
 */
export function steamRareAchievementStyles(): string {
	return `
		/* Official Steam rare achievement animation keyframe (to { transform: rotate(1turn); }) */
		@keyframes gdl-rare-rotate {
			to { transform: rotate(1turn); }
		}
		@keyframes _2liIQspBwdpNtEmYw2bU9j {
			to { transform: rotate(1turn); }
		}

		/* Static root mask container */
		.gdl-rare-glow-root,
		._2HUbCbZUn27MliiC8gRxGB {
			position: absolute;
			top: -20%;
			right: -20%;
			bottom: -20%;
			left: -20%;
			-webkit-mask-image: url("${STEAM_RARE_ACHIEVEMENT_MASK_DATA_URI}");
			mask-image: url("${STEAM_RARE_ACHIEVEMENT_MASK_DATA_URI}");
			-webkit-mask-repeat: repeat;
			mask-repeat: repeat;
			-webkit-mask-size: 100%;
			mask-size: 100%;
			overflow: hidden;
			pointer-events: none;
			z-index: 1;
		}

		/* Counter-clockwise rotating inner mask container */
		.gdl-rare-glow-container,
		._2D_EJk8-jCnfqiwoKkOMVh {
			position: absolute;
			top: -20%;
			right: -20%;
			bottom: -20%;
			left: -20%;
			-webkit-mask-image: url("${STEAM_RARE_ACHIEVEMENT_MASK_DATA_URI}");
			mask-image: url("${STEAM_RARE_ACHIEVEMENT_MASK_DATA_URI}");
			-webkit-mask-repeat: repeat;
			mask-repeat: repeat;
			-webkit-mask-size: 100%;
			mask-size: 100%;
			overflow: hidden;
			animation-name: gdl-rare-rotate;
			animation-duration: 18s;
			animation-timing-function: linear;
			animation-iteration-count: infinite;
			animation-direction: reverse;
			animation-play-state: running;
		}

		/* Clockwise rotating conic-gradient glow layer with overlay blend mode */
		.gdl-rare-glow,
		._1Z2eJs9-zNTKcWKy4M-oDE {
			position: absolute;
			top: -10px;
			right: -10px;
			bottom: -10px;
			left: -10px;
			animation-name: gdl-rare-rotate;
			animation-duration: 6s;
			animation-timing-function: linear;
			animation-iteration-count: infinite;
			animation-play-state: running;
			mix-blend-mode: overlay;
			background: repeating-conic-gradient(
				rgba(255, 217, 0, 0.178) 0%,
				rgba(255, 184, 78, 0) 6%,
				rgba(255, 217, 0, 0.178) 10%,
				rgb(255, 184, 78) 26%,
				rgba(255, 217, 0, 0.178) 35%,
				rgb(255, 184, 78) 40%,
				rgba(255, 217, 0, 0.178) 60%,
				rgb(255, 184, 78) 82%,
				rgba(255, 217, 0, 0.178) 100%
			);
			overflow: hidden;
		}

		/* Official Steam gold aura box-shadow on the icon */
		.is-rare-glow,
		._3s4Rq3jnntBVP7HbJj1RMQ {
			box-shadow: 0px 0px 2px 1px rgba(255, 184, 78, .6), 0px 0px 16px 1px rgba(255, 184, 78, .4) !important;
		}

		/* Low perf mode / paused animation */
		.gdl-rare-no-animation .gdl-rare-glow-container,
		.gdl-rare-no-animation .gdl-rare-glow,
		._1a4bwiE4yUR3XXBKI6mKqt ._2D_EJk8-jCnfqiwoKkOMVh,
		._1a4bwiE4yUR3XXBKI6mKqt ._1Z2eJs9-zNTKcWKy4M-oDE,
		.LowPerfMode .gdl-rare-glow-container,
		.LowPerfMode .gdl-rare-glow,
		.LowPerfMode ._2D_EJk8-jCnfqiwoKkOMVh,
		.LowPerfMode ._1Z2eJs9-zNTKcWKy4M-oDE {
			animation-play-state: paused !important;
		}

		@media (prefers-reduced-motion: reduce) {
			.gdl-rare-glow-container,
			.gdl-rare-glow,
			._2D_EJk8-jCnfqiwoKkOMVh,
			._1Z2eJs9-zNTKcWKy4M-oDE {
				animation-play-state: paused !important;
			}
		}
	`;
}
