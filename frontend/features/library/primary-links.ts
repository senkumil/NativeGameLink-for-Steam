import { gdlText } from '../../steam/localization';
import { steamGameMainPageUrl } from '../../core/steam-links';
import { PLAYBAR_CLASSES } from '../../steam/css';
import { closestWithCssModuleClass, elementsWithCssModuleClass, isRenderedElement } from '../../steam/native-dom';
import type { NativeLibraryLayout } from './layout';
import { ensurePrimaryLinksStyles } from './styles/primary-links';

export interface PrimaryLinksOptions {
	steamAppId: string;
	isDelisted?: boolean;
	hasWorkshop: boolean;
	hasDlc?: boolean;
}

function linkedGameDestinations({ steamAppId, isDelisted, hasWorkshop, hasDlc }: PrimaryLinksOptions): Array<[string, string]> {
	const links: Array<[string, string]> = [
		[gdlText('store_page', 'Store page'), steamGameMainPageUrl(steamAppId, isDelisted)],
	];
	if (hasDlc) {
		links.push([gdlText('dlc_links', 'DLC'), `https://store.steampowered.com/dlc/${steamAppId}/`]);
	}
	links.push(
		[gdlText('community_hub', 'Community hub'), `https://steamcommunity.com/app/${steamAppId}`],
		[gdlText('points_shop', 'Points shop'), `https://store.steampowered.com/points/shop/app/${steamAppId}`],
		[gdlText('discussions', 'Discussions'), `https://steamcommunity.com/app/${steamAppId}/discussions/`],
		[gdlText('guides', 'Guides'), `https://steamcommunity.com/app/${steamAppId}/guides/`],
	);
	if (hasWorkshop) {
		links.push([gdlText('workshop', 'Workshop'), `https://steamcommunity.com/app/${steamAppId}/workshop/`]);
	}
	links.push([gdlText('support', 'Support'), `https://help.steampowered.com/wizard/HelpWithGame/?appid=${steamAppId}`]);
	return links;
}


function installPrimaryLinksResponsiveLayout(inner: HTMLElement): void {
	const primaryLinks = Array.from(inner.querySelectorAll<HTMLElement>('.gdl-primary-link'));
	const overflowLinks = Array.from(inner.querySelectorAll<HTMLElement>('.gdl-primary-overflow-link'));
	const more = inner.querySelector<HTMLElement>('.gdl-primary-more');
	if (!primaryLinks.length || !more) return;

	let frame = 0;
	const win = inner.ownerDocument.defaultView;
	const update = (): void => {
		frame = 0;
		if (!inner.isConnected || !win) return;

		// Measure every link at its natural width first. The ellipsis button is
		// intentionally excluded unless something actually needs to overflow.
		for (const link of primaryLinks) link.style.removeProperty('display');
		more.style.setProperty('display', 'none', 'important');
		for (const item of overflowLinks) item.style.setProperty('display', 'none', 'important');

		const computed = win.getComputedStyle(inner);
		const paddingLeft = Number.parseFloat(computed.paddingLeft) || 0;
		const paddingRight = Number.parseFloat(computed.paddingRight) || 0;
		const gap = Number.parseFloat(computed.columnGap || computed.gap) || 0;
		const available = Math.max(0, inner.clientWidth - paddingLeft - paddingRight);
		const widths = primaryLinks.map(link => link.getBoundingClientRect().width);
		const allWidth = widths.reduce((sum, width) => sum + width, 0)
			+ Math.max(0, widths.length - 1) * gap;

		if (allWidth <= available) return;

		const moreWidth = 34;
		let visibleCount = Math.max(1, primaryLinks.length - 1);
		while (visibleCount > 1) {
			const linksWidth = widths.slice(0, visibleCount).reduce((sum, width) => sum + width, 0);
			// Gaps exist between all visible links and once more before the ellipsis.
			const needed = linksWidth + visibleCount * gap + moreWidth;
			if (needed <= available) break;
			visibleCount -= 1;
		}

		primaryLinks.forEach((link, index) => {
			if (index >= visibleCount) link.style.setProperty('display', 'none', 'important');
		});
		overflowLinks.forEach((item, index) => {
			item.style.setProperty('display', index >= visibleCount ? 'block' : 'none', 'important');
		});
		more.style.setProperty('display', 'block', 'important');
	};

	const queueUpdate = (): void => {
		if (frame || !win) return;
		frame = win.requestAnimationFrame(update);
	};

	(inner as any).__gdlResizeObserver?.disconnect();
	const ResizeObserverCtor = win?.ResizeObserver;
	if (typeof ResizeObserverCtor === 'function') {
		const observer = new ResizeObserverCtor(queueUpdate);
		observer.observe(inner);
		(inner as any).__gdlResizeObserver = observer;
	} else {
		win?.addEventListener('resize', queueUpdate, { passive: true });
	}
	queueUpdate();
	win?.setTimeout(queueUpdate, 0);
}

/**
 * Build the primary-link bar aligned with the playbar controls.
 */
export function createPrimaryLinksBar(
	doc: Document,
	_layout: NativeLibraryLayout,
	options: PrimaryLinksOptions,
): HTMLElement {
	ensurePrimaryLinksStyles(doc);
	const existingBar = doc.getElementById('gdl-link-bar');
	if (existingBar && existingBar.isConnected
		&& existingBar.dataset.gdlSteamAppId === options.steamAppId
		&& existingBar.dataset.gdlLinksSettled === '1'
		&& isBarProperlyPositionedBelowPlaybar(doc, existingBar)) {
		doc.querySelectorAll('#gdl-link-bar, .gdl-link-bar-inner').forEach(el => {
			if (el !== existingBar) el.remove();
		});
		const links = linkedGameDestinations(options);
		const primaryLinks = links.map(([label, url], index) =>
			`<a class="gdl-primary-link" data-gdl-primary-index="${index}" href="${url}" data-gdl-open-url="${url}">${label}</a>`,
		).join('');
		const overflowLinks = links.map(([label, url], index) =>
			`<a class="gdl-primary-overflow-link" data-gdl-primary-index="${index}" href="${url}" data-gdl-open-url="${url}">${label}</a>`,
		).join('');
		existingBar.innerHTML = `${primaryLinks}<details class="gdl-primary-more"><summary aria-label="${gdlText('more_links', 'More links')}">•••</summary><div class="gdl-primary-more-menu">${overflowLinks}</div></details>`;
		installPrimaryLinksResponsiveLayout(existingBar);
		return existingBar;
	}
	doc.querySelectorAll('#gdl-link-bar, .gdl-link-bar-inner').forEach(el => el.remove());
	const links = linkedGameDestinations(options);
	const linkBar = doc.createElement('div');
	linkBar.id = 'gdl-link-bar';
	linkBar.className = 'gdl-link-bar-inner';
	linkBar.dataset.gdlSteamAppId = options.steamAppId;
	linkBar.dataset.gdlLinksSettled = '0';
	linkBar.style.setProperty('visibility', 'hidden', 'important');
	linkBar.style.setProperty('opacity', '0', 'important');
	linkBar.style.setProperty('pointer-events', 'none', 'important');
	const primaryLinks = links.map(([label, url], index) =>
		`<a class="gdl-primary-link" data-gdl-primary-index="${index}" href="${url}" data-gdl-open-url="${url}">${label}</a>`,
	).join('');
	const overflowLinks = links.map(([label, url], index) =>
		`<a class="gdl-primary-overflow-link" data-gdl-primary-index="${index}" href="${url}" data-gdl-open-url="${url}">${label}</a>`,
	).join('');
	linkBar.innerHTML = `${primaryLinks}<details class="gdl-primary-more"><summary aria-label="${gdlText('more_links', 'More links')}">•••</summary><div class="gdl-primary-more-menu">${overflowLinks}</div></details>`;
	installPrimaryLinksResponsiveLayout(linkBar);
	return linkBar;
}

export function findNativePlayButton(doc: Document): HTMLElement | null {
	const playButtons = Array.from(doc.querySelectorAll<HTMLElement>(
		'button[class*="Play"], [class*="PlayButton"], [class*="playButton"], button[class*="Stop"], [class*="StopButton"]',
	)).filter(el => {
		if (el.closest('#gdl-link-bar, #gdl-library-injected, [id^="gdl-"]')) return false;
		const rect = el.getBoundingClientRect();
		return rect.width > 0 && rect.height > 0 && rect.top > 60 && rect.top < 700;
	});

	if (!playButtons.length) return null;
	// When multiple play buttons exist (sticky header vs in-page), the in-page play button
	// is located lowest down in the page hierarchy (largest rect.top)
	playButtons.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
	return playButtons[0];
}

export function findNativePlaybar(doc: Document): HTMLElement | null {
	const pb = PLAYBAR_CLASSES();
	const btn = findNativePlayButton(doc);
	if (btn) {
		const container = (pb.Container ? closestWithCssModuleClass(btn, pb.Container) : null)
			|| btn.closest<HTMLElement>('[class*="PlayBar"], [class*="playbar"]')
			|| btn.parentElement?.parentElement
			|| btn.parentElement;
		if (container) return container;
	}

	// Check AppButtonsContainer with top > 60
	if (pb.AppButtonsContainer) {
		const buttons = elementsWithCssModuleClass(doc, pb.AppButtonsContainer)
			.filter(c => !c.closest('#gdl-link-bar, #gdl-library-injected, [id^="gdl-"]'))
			.filter(c => {
				const rect = c.getBoundingClientRect();
				return isRenderedElement(doc, c) && rect.top > 60 && rect.width > 0 && rect.height > 0;
			});
		if (buttons.length > 0) {
			buttons.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
			const btnContainer = buttons[0];
			const container = (pb.Container ? closestWithCssModuleClass(btnContainer, pb.Container) : null)
				|| btnContainer.closest<HTMLElement>('[class*="PlayBar"], [class*="playbar"]')
				|| btnContainer.parentElement;
			if (container) return container;
		}
	}

	return null;
}

function findPlaybarTopSection(scrollContainer: HTMLElement, playbar: HTMLElement | null, playBtn: HTMLElement | null): HTMLElement | null {
	const target = playbar || playBtn;
	if (!target) return null;
	if (!scrollContainer.contains(target)) {
		let parent = target.parentElement;
		while (parent && parent !== target.ownerDocument.body) {
			if (parent.parentElement === scrollContainer) return parent;
			parent = parent.parentElement;
		}
		return null;
	}
	let curr: HTMLElement | null = target;
	while (curr && curr.parentElement && curr.parentElement !== scrollContainer && curr.parentElement !== target.ownerDocument.body) {
		curr = curr.parentElement;
	}
	return (curr && curr.parentElement === scrollContainer) ? curr : null;
}

export function isBarProperlyPositionedBelowPlaybar(doc: Document, targetBar: HTMLElement): boolean {
	if (!targetBar.isConnected) return false;
	const currentPlaybar = findNativePlaybar(doc);
	const playBtn = findNativePlayButton(doc);
	if (!currentPlaybar || !currentPlaybar.isConnected) return false;
	if (!playBtn || !playBtn.isConnected) return false;

	const header = currentPlaybar.closest<HTMLElement>(
		'[class*="AppDetailsHeader"], [class*="appdetailsheader"], [class*="HeaderContainer"], [class*="header_Header"]'
	);
	if (header && header.contains(targetBar)) return false;
	if (currentPlaybar.contains(targetBar)) return false;

	const playbarRect = currentPlaybar.getBoundingClientRect();
	const btnRect = playBtn.getBoundingClientRect();
	const barRect = targetBar.getBoundingClientRect();

	// Playbar must be actively rendered with non-zero geometry below Steam's top navbar (> 60)
	if (playbarRect.width <= 0 || playbarRect.height <= 0 || playbarRect.top <= 60) return false;
	if (btnRect.width <= 0 || btnRect.height <= 0 || btnRect.top <= 60) return false;
	// Bar must have non-zero geometry
	if (barRect.width <= 0 || barRect.height <= 0) return false;

	// In the DOM, targetBar MUST NOT precede currentPlaybar or playBtn!
	if (Boolean(targetBar.compareDocumentPosition(currentPlaybar) & Node.DOCUMENT_POSITION_FOLLOWING)) {
		return false;
	}
	if (Boolean(targetBar.compareDocumentPosition(playBtn) & Node.DOCUMENT_POSITION_FOLLOWING)) {
		return false;
	}

	// CRITICAL INVARIANT: The links bar MUST be physically at or below the bottom of BOTH the playbar AND the play button!
	const effectivePlaybarBottom = Math.max(playbarRect.bottom, btnRect.bottom);
	return barRect.top >= effectivePlaybarBottom - 4 && barRect.top >= playbarRect.bottom - 4;
}

export function insertPrimaryLinksBar(
	bar: HTMLElement,
	layout: NativeLibraryLayout,
	activityWrapper: HTMLElement,
): void {
	const doc = bar.ownerDocument;
	ensurePrimaryLinksStyles(doc);
	const twoColumnRow = layout.twoColumnRow;
	const playbar = findNativePlaybar(doc);
	const playBtn = findNativePlayButton(doc);
	const header = (playbar ? playbar.closest<HTMLElement>(
		'[class*="AppDetailsHeader"], [class*="appdetailsheader"], [class*="HeaderContainer"], [class*="header_Header"]'
	) : null) || doc.querySelector<HTMLElement>(
		'[class*="AppDetailsHeader"], [class*="appdetailsheader"], [class*="HeaderContainer"]'
	);

	const scrollContainer = twoColumnRow?.parentElement
		|| header?.parentElement
		|| (playbar ? (playbar.closest<HTMLElement>('[class*="AppDetails"], [class*="appdetails"]') || playbar.parentElement) : null);

	const playbarInsideOrAfterTwoColumn = Boolean(
		playbar && twoColumnRow && (
			twoColumnRow === playbar ||
			twoColumnRow.contains(playbar) ||
			Boolean(twoColumnRow.compareDocumentPosition(playbar) & (Node.DOCUMENT_POSITION_CONTAINED_BY | Node.DOCUMENT_POSITION_FOLLOWING))
		)
	);

	const infoPanel = doc.getElementById('gdl-game-info-panel');
	const playbarSection = scrollContainer ? findPlaybarTopSection(scrollContainer, playbar, playBtn) : null;

	if (scrollContainer && playbarSection) {
		let anchor = (infoPanel && infoPanel.parentElement === scrollContainer
			&& (playbarSection.compareDocumentPosition(infoPanel) & Node.DOCUMENT_POSITION_FOLLOWING))
			? infoPanel
			: playbarSection;
		if (playbar && playbar.parentElement === scrollContainer
			&& Boolean(anchor.compareDocumentPosition(playbar) & Node.DOCUMENT_POSITION_FOLLOWING)) {
			anchor = playbar;
		}
		if (anchor.nextElementSibling) {
			scrollContainer.insertBefore(bar, anchor.nextElementSibling);
		} else {
			scrollContainer.appendChild(bar);
		}
	} else if (twoColumnRow && twoColumnRow.parentElement && (!header || !header.contains(twoColumnRow))) {
		const parent = twoColumnRow.parentElement;
		if (playbar && playbarInsideOrAfterTwoColumn && playbar.parentElement && (!header || !header.contains(playbar.parentElement))) {
			if (playbar.nextElementSibling) {
				playbar.parentElement.insertBefore(bar, playbar.nextElementSibling);
			} else {
				playbar.parentElement.appendChild(bar);
			}
		} else if (playbar && playbar.parentElement === parent
			&& (twoColumnRow.compareDocumentPosition(playbar) & Node.DOCUMENT_POSITION_FOLLOWING)) {
			if (playbar.nextElementSibling) {
				parent.insertBefore(bar, playbar.nextElementSibling);
			} else {
				parent.appendChild(bar);
			}
		} else if (playbar && playbar.parentElement === parent) {
			const anchor = (infoPanel && infoPanel.parentElement === parent
				&& (playbar.compareDocumentPosition(infoPanel) & Node.DOCUMENT_POSITION_FOLLOWING))
				? infoPanel
				: playbar;
			if (anchor.nextElementSibling) {
				parent.insertBefore(bar, anchor.nextElementSibling);
			} else {
				parent.appendChild(bar);
			}
		} else if (infoPanel && infoPanel.parentElement === parent
			&& (twoColumnRow.compareDocumentPosition(infoPanel) & Node.DOCUMENT_POSITION_PRECEDING)) {
			if (infoPanel.nextElementSibling) {
				parent.insertBefore(bar, infoPanel.nextElementSibling);
			} else {
				parent.appendChild(bar);
			}
		} else {
			parent.insertBefore(bar, twoColumnRow);
		}
	} else if (playbar && playbar.parentElement && (!header || !header.contains(playbar.parentElement))) {
		const parent = playbar.parentElement;
		const anchor = (infoPanel && infoPanel.parentElement === parent
			&& (playbar.compareDocumentPosition(infoPanel) & Node.DOCUMENT_POSITION_FOLLOWING))
			? infoPanel
			: playbar;
		if (anchor.nextElementSibling) {
			parent.insertBefore(bar, anchor.nextElementSibling);
		} else {
			parent.appendChild(bar);
		}
	} else if (header && header.parentElement) {
		const parent = header.parentElement;
		const anchor = (playbar && playbar.parentElement === parent && (header.compareDocumentPosition(playbar) & Node.DOCUMENT_POSITION_FOLLOWING))
			? ((infoPanel && infoPanel.parentElement === parent && (playbar.compareDocumentPosition(infoPanel) & Node.DOCUMENT_POSITION_FOLLOWING)) ? infoPanel : playbar)
			: null;
		if (anchor) {
			if (anchor.nextElementSibling) parent.insertBefore(bar, anchor.nextElementSibling);
			else parent.appendChild(bar);
		} else if (twoColumnRow && twoColumnRow.parentElement === parent) {
			parent.insertBefore(bar, twoColumnRow);
		} else {
			parent.appendChild(bar);
		}
	} else if (playbar && playbarInsideOrAfterTwoColumn && playbar.parentElement && (!header || !header.contains(playbar.parentElement))) {
		if (playbar.nextElementSibling) {
			playbar.parentElement.insertBefore(bar, playbar.nextElementSibling);
		} else {
			playbar.parentElement.appendChild(bar);
		}
	} else if (activityWrapper.parentElement && (!header || !header.contains(activityWrapper.parentElement))) {
		activityWrapper.parentElement.insertBefore(bar, activityWrapper);
	}

	const revealBar = (targetBar: HTMLElement): void => {
		targetBar.dataset.gdlLinksSettled = '1';
		targetBar.style.removeProperty('visibility');
		targetBar.style.removeProperty('opacity');
		targetBar.style.removeProperty('pointer-events');
		targetBar.style.removeProperty('display');
	};

	const currentAppId = bar.dataset.gdlSteamAppId || '';
	const alreadySettled = bar.isConnected && bar.dataset.gdlLinksSettled === '1'
		&& Boolean(currentAppId)
		&& isBarProperlyPositionedBelowPlaybar(doc, bar);

	// DO NOT reveal synchronously on frame 0: frame 0 layout is transitional when switching games.
	if (!alreadySettled) {
		bar.style.setProperty('visibility', 'hidden', 'important');
		bar.style.setProperty('opacity', '0', 'important');
		bar.style.setProperty('pointer-events', 'none', 'important');
		bar.dataset.gdlLinksSettled = '0';
	}

	const win = doc.defaultView || window;
	let attempts = 0;
	let stableFrames = alreadySettled ? 2 : 0;
	let lastPlaybarBottom = -1;
	let lastBarTop = -1;
	if (alreadySettled) {
		const initPlaybar = findNativePlaybar(doc);
		const initBtn = findNativePlayButton(doc);
		if (initPlaybar && initBtn) {
			lastPlaybarBottom = Math.max(initPlaybar.getBoundingClientRect().bottom, initBtn.getBoundingClientRect().bottom);
			lastBarTop = bar.getBoundingClientRect().top;
		}
	}

	const checkSettled = () => {
		attempts += 1;
		if (!bar.isConnected) return;
		const currentPlaybar = findNativePlaybar(doc);
		const playBtn = findNativePlayButton(doc);
		const targetPlayNode = currentPlaybar || playBtn;
		const infoPanel = doc.getElementById('gdl-game-info-panel');
		const currentHeader = (currentPlaybar ? currentPlaybar.closest<HTMLElement>(
			'[class*="AppDetailsHeader"], [class*="appdetailsheader"], [class*="HeaderContainer"], [class*="header_Header"]'
		) : null) || doc.querySelector<HTMLElement>(
			'[class*="AppDetailsHeader"], [class*="appdetailsheader"], [class*="HeaderContainer"]'
		);

		const scrollContainer = twoColumnRow?.parentElement
			|| currentHeader?.parentElement
			|| (currentPlaybar ? (currentPlaybar.closest<HTMLElement>('[class*="AppDetails"], [class*="appdetails"]') || currentPlaybar.parentElement) : null);
		const playbarSection = scrollContainer ? findPlaybarTopSection(scrollContainer, currentPlaybar, playBtn) : null;

		// Self-healing re-anchoring: bar MUST ALWAYS be positioned after playbar in DOM
		if (scrollContainer && playbarSection) {
			const barPrecedesPlaybar = Boolean(targetPlayNode && (bar.compareDocumentPosition(targetPlayNode) & Node.DOCUMENT_POSITION_FOLLOWING));
			const barInsidePlaybar = Boolean(playbarSection.contains(bar));
			if (barPrecedesPlaybar || barInsidePlaybar || bar.parentElement !== scrollContainer) {
				let anchorNode = (infoPanel && infoPanel.parentElement === scrollContainer
					&& (playbarSection.compareDocumentPosition(infoPanel) & Node.DOCUMENT_POSITION_FOLLOWING))
					? infoPanel
					: playbarSection;
				if (currentPlaybar && currentPlaybar.parentElement === scrollContainer
					&& Boolean(anchorNode.compareDocumentPosition(currentPlaybar) & Node.DOCUMENT_POSITION_FOLLOWING)) {
					anchorNode = currentPlaybar;
				}
				if (anchorNode.nextElementSibling !== bar) {
					if (anchorNode.nextElementSibling) {
						scrollContainer.insertBefore(bar, anchorNode.nextElementSibling);
					} else {
						scrollContainer.appendChild(bar);
					}
				}
			}
		} else if (currentPlaybar && currentPlaybar.isConnected && currentPlaybar.parentElement) {
			const barPrecedesPlaybar = Boolean(bar.compareDocumentPosition(currentPlaybar) & Node.DOCUMENT_POSITION_FOLLOWING);
			const barInsideHeader = Boolean(currentHeader && (currentHeader.contains(bar) || bar.parentElement === currentHeader));
			if (barPrecedesPlaybar || barInsideHeader) {
				const anchorNode = (infoPanel && infoPanel.parentElement === currentPlaybar.parentElement
					&& (currentPlaybar.compareDocumentPosition(infoPanel) & Node.DOCUMENT_POSITION_FOLLOWING))
					? infoPanel
					: currentPlaybar;
				if (anchorNode.nextElementSibling !== bar) {
					if (anchorNode.nextElementSibling) {
						anchorNode.parentElement?.insertBefore(bar, anchorNode.nextElementSibling);
					} else {
						anchorNode.parentElement?.appendChild(bar);
					}
				}
			}
		} else if (currentHeader && currentHeader.parentElement && (currentHeader.contains(bar) || bar.parentElement === currentHeader)) {
			if (twoColumnRow && twoColumnRow.parentElement === currentHeader.parentElement) {
				currentHeader.parentElement.insertBefore(bar, twoColumnRow);
			} else {
				currentHeader.parentElement.appendChild(bar);
			}
		}

		// Ensure infoPanel immediately precedes bar if both are siblings in the same container
		if (infoPanel && bar.parentElement && infoPanel.parentElement === bar.parentElement
			&& infoPanel.nextElementSibling !== bar && Boolean(infoPanel.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING)) {
			bar.parentElement.insertBefore(infoPanel, bar);
		}

		const isProperlyPositioned = isBarProperlyPositionedBelowPlaybar(doc, bar);

		if (currentPlaybar && currentPlaybar.isConnected && currentPlaybar.parentElement && playBtn && playBtn.isConnected) {
			const playbarRect = currentPlaybar.getBoundingClientRect();
			const btnRect = playBtn.getBoundingClientRect();
			const barRect = bar.getBoundingClientRect();

			if (playbarRect.width > 0 && playbarRect.height > 0 && playbarRect.top > 60
				&& btnRect.width > 0 && btnRect.height > 0 && btnRect.top > 60
				&& barRect.width > 0 && barRect.height > 0) {

				const effectivePlaybarBottom = Math.max(playbarRect.bottom, btnRect.bottom);

				// Verify that geometry has settled and stopped shifting (e.g. hero artwork transition)
				const isGeometryStable = Math.abs(effectivePlaybarBottom - lastPlaybarBottom) < 2
					&& Math.abs(barRect.top - lastBarTop) < 2;

				lastPlaybarBottom = effectivePlaybarBottom;
				lastBarTop = barRect.top;

				if (isProperlyPositioned && isGeometryStable) {
					stableFrames += 1;
					// Require at least 2 consecutive settled animation frames to avoid single-frame layout flash during game transitions
					if (stableFrames >= 2) {
						revealBar(bar);
					}
					// Continue validating layout stability through full React hydration / hero load
					if (stableFrames >= 45) {
						return;
					}
				} else {
					stableFrames = 0;
					if (!isProperlyPositioned && bar.dataset.gdlLinksSettled === '1') {
						const effBottom = Math.max(playbarRect.bottom, btnRect.bottom);
						if (barRect.top > 0 && barRect.top < effBottom - 4) {
							bar.dataset.gdlLinksSettled = '0';
							bar.style.setProperty('visibility', 'hidden', 'important');
							bar.style.setProperty('opacity', '0', 'important');
							bar.style.setProperty('pointer-events', 'none', 'important');
						}
					}
				}
			} else {
				stableFrames = 0;
			}
		} else {
			stableFrames = 0;
		}

		if (attempts < 180) {
			win.requestAnimationFrame(checkSettled);
		}
	};
	win.requestAnimationFrame(checkSettled);

	((bar as any).__gdlParentObserver as MutationObserver | undefined)?.disconnect();
	const MutationObserverCtor = (win as any)?.MutationObserver || win?.MutationObserver;
	if (typeof MutationObserverCtor === 'function' && bar.parentElement) {
		const parentObserver = new MutationObserverCtor(() => {
			if (!bar.isConnected) {
				parentObserver.disconnect();
				return;
			}
			const currentPlaybar = findNativePlaybar(doc);
			const playBtn = findNativePlayButton(doc);
			if (currentPlaybar && playBtn && currentPlaybar.isConnected && playBtn.isConnected) {
				const playbarRect = currentPlaybar.getBoundingClientRect();
				const btnRect = playBtn.getBoundingClientRect();
				const barRect = bar.getBoundingClientRect();
				const effBottom = Math.max(playbarRect.bottom, btnRect.bottom);
				if (barRect.top > 0 && barRect.top < effBottom - 4) {
					bar.dataset.gdlLinksSettled = '0';
					bar.style.setProperty('visibility', 'hidden', 'important');
					bar.style.setProperty('opacity', '0', 'important');
					bar.style.setProperty('pointer-events', 'none', 'important');
					attempts = 0;
					stableFrames = 0;
					win.requestAnimationFrame(checkSettled);
					return;
				}
			}
			if (bar.dataset.gdlLinksSettled === '1') return;
			const properlyPositioned = isBarProperlyPositionedBelowPlaybar(doc, bar);
			if (properlyPositioned) {
				revealBar(bar);
			}
		});
		parentObserver.observe(bar.parentElement, { childList: true });
		(bar as any).__gdlParentObserver = parentObserver;
	}
}
