import { PLAYBAR_CLASSES, resolveClassModule } from '../../steam/css';
import { committedHeaderAppId, isPaintedLibraryElement } from '../../steam/library-details';
import { elementsWithCssModuleClass, hasCssModuleClass } from '../../steam/native-dom';
import { restoreLinkedPlaybarVisibility } from '../../steam/playbar-visibility';
import { containsNativeLibraryHeader, findNativeLibraryHeader, isInsideNativeLibraryHeader } from '../../steam/library-header';

export interface NativeLibraryLayout {
	anchorRegion: HTMLElement | null;
	sidebarColumn: HTMLElement | null;
	twoColumnRow: HTMLElement | null;
	contentColumn: HTMLElement | null;
	noticeParent: Element | null;
}

type ManagedStyleProperty = 'display' | 'height' | 'minHeight' | 'alignSelf' | 'alignItems';
type NativeStyleLease = { value: string; priority: string; installedValue: string; installedPriority: string };
type NativeStyleSnapshot = Partial<Record<ManagedStyleProperty, NativeStyleLease>>;

function cssPropertyName(property: ManagedStyleProperty): string {
	return property.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase());
}

// Steam reuses live library nodes while changing routes. Keep the exact inline
// values that existed before GDL touched them, per document, so a linked-game
// cleanup cannot leak geometry into the next native game page.
const nativeStyleSnapshots = new WeakMap<HTMLElement, NativeStyleSnapshot>();
const managedNativeElements = new WeakMap<Document, Set<HTMLElement>>();

function rememberNativeStyle(element: HTMLElement, property: ManagedStyleProperty): NativeStyleLease {
	let snapshot = nativeStyleSnapshots.get(element);
	if (!snapshot) {
		snapshot = {};
		nativeStyleSnapshots.set(element, snapshot);
	}
	const name = cssPropertyName(property);
	const value = element.style.getPropertyValue(name), priority = element.style.getPropertyPriority(name);
	const previous = snapshot[property];
	if (!previous || value !== previous.installedValue || priority !== previous.installedPriority) {
		// Steam can update its reused column while GDL owns another property.
		// A newer native value becomes the restoration base, not the old route's.
		snapshot[property] = { value, priority, installedValue: value, installedPriority: priority };
	}
	const doc = element.ownerDocument;
	let elements = managedNativeElements.get(doc);
	if (!elements) {
		elements = new Set();
		managedNativeElements.set(doc, elements);
	}
	elements.add(element);
	return snapshot[property]!;
}

function setNativeStyle(element: HTMLElement, property: ManagedStyleProperty, value: string): void {
	const lease = rememberNativeStyle(element, property), name = cssPropertyName(property);
	if (element.style.getPropertyValue(name) !== value || element.style.getPropertyPriority(name)) {
		if (value) element.style.setProperty(name, value);
		else element.style.removeProperty(name);
	}
	lease.installedValue = element.style.getPropertyValue(name);
	lease.installedPriority = element.style.getPropertyPriority(name);
}

export function hideNativeLibraryElement(element: HTMLElement): void {
	if (containsNativeLibraryHeader(element) || isInsideNativeLibraryHeader(element)) return;
	setNativeStyle(element, 'display', 'none');
	element.setAttribute('data-gdl-hidden', '1');
}

function applyNativeSurfaceTokens(target: HTMLElement, samples: Array<HTMLElement | null | undefined>): void {
	const view = target.ownerDocument.defaultView;
	if (!view) return;
	for (const sample of samples) {
		if (!sample || !sample.isConnected) continue;
		const style = view.getComputedStyle(sample);
		const painted = style.backgroundImage !== 'none' || !/rgba?\(0,\s*0,\s*0,\s*0\)/i.test(style.backgroundColor);
		if (!painted) continue;
		// Take the live Steam Notes/Media surface rather than guessing a theme.
		target.style.setProperty('--gdl-native-panel-bg', style.background);
		target.style.setProperty('--gdl-native-panel-border', style.borderColor);
		break;
	}
}

/** Restore every native inline style GDL changed in this document. */
export function restoreNativeLibraryStyles(doc: Document): void {
	restoreLinkedPlaybarVisibility(doc);
	try {
		doc.getElementById('gdl-library-style-sentinel')?.remove();
		doc.getElementById('gdl-achievement-playbar-style')?.remove();
	} catch {}
	const elements = managedNativeElements.get(doc);
	if (elements) {
		for (const element of elements) {
			const snapshot = nativeStyleSnapshots.get(element);
			if (!snapshot) continue;
			for (const property of Object.keys(snapshot) as ManagedStyleProperty[]) {
				const original = snapshot[property]!;
				const name = cssPropertyName(property);
				// Do not roll back a subsequent Steam/theme update to a live node.
				if (element.style.getPropertyValue(name) !== original.installedValue
					|| element.style.getPropertyPriority(name) !== original.installedPriority) continue;
				if (original.value) element.style.setProperty(name, original.value, original.priority);
				else element.style.removeProperty(name);
			}
			element.removeAttribute('data-gdl-hidden');
			nativeStyleSnapshots.delete(element);
		}
		elements.clear();
		managedNativeElements.delete(doc);
	}
	try {
		doc.querySelectorAll<HTMLElement>('[data-gdl-hidden]').forEach(el => {
			el.removeAttribute('data-gdl-hidden');
			el.style.display = '';
		});
	} catch {}
}

const DESKTOP_DETAILS_CLASSES = {
	Container: '_27RcNu8aXKBpYkHcNNrt-X', ColumnContainer: 'OhSdLYuggDtBcWjYP0j_9',
	LeftColumn: '_1sZgBDTw5NH-yuVDZK1SUU', RightColumn: '_2aor4XVOYzN1PBSREk0UbO',
	SeekTarget: 'vzLedtsu3TtTlKLEKzIhH',
};
const NATIVE_SECTION_CLASSES = {
	AppDetailsSection: '_2r4TK4BAuU-J4FuF_O7v_5',
	AppDetailsSectionContainer: '_31ptFGGMZrSQc5BCX1e5lm', RightColumnSection: '_3KfxIwlXEvum7FCD_AM2_t',
};

function desktopDetailsClasses(doc: Document): typeof DESKTOP_DETAILS_CLASSES {
	return resolveClassModule(module => Boolean(module.ColumnContainer && module.LeftColumn
		&& module.RightColumn && module.SeekTarget), DESKTOP_DETAILS_CLASSES, doc).classes as typeof DESKTOP_DETAILS_CLASSES;
}

function nativeSectionClass(doc: Document): string {
	return resolveClassModule(module => Boolean(module.AppDetailsSection && module.AppDetailsSectionContainer
		&& module.RightColumnSection), NATIVE_SECTION_CLASSES, doc).classes.AppDetailsSection;
}

function nativeRegionWithin(branch: HTMLElement, ownerAppId: number | null): HTMLElement | null {
	const regions = branch.getAttribute('role') === 'region' ? [branch]
		: Array.from(branch.querySelectorAll<HTMLElement>('[role="region"]'));
	return regions.find(region => {
		if (region.closest('[id^="gdl-"], [data-nsp]') || containsNativeLibraryHeader(region)
			|| isInsideNativeLibraryHeader(region)) return false;
		const regionAppId = committedHeaderAppId(region);
		return ownerAppId === null || regionAppId === null || regionAppId === ownerAppId;
	}) || null;
}

/** Resolve only siblings of this live shortcut notice. Notes and Media can be
 * disabled; any native section supplies the common shell without a document-
 * wide text search that could select our own headings or another game's page. */
export function discoverNativeLibraryLayout(doc: Document, noticeElement: Element): NativeLibraryLayout {
	const empty: NativeLibraryLayout = { anchorRegion: null, sidebarColumn: null,
		twoColumnRow: null, contentColumn: null, noticeParent: noticeElement.closest('div') };
	const nativeNotice = noticeElement as HTMLElement;
	if (noticeElement.ownerDocument !== doc || !noticeElement.isConnected
		|| noticeElement.closest('[id^="gdl-"], [data-nsp]')
		|| containsNativeLibraryHeader(nativeNotice) || isInsideNativeLibraryHeader(nativeNotice)) return empty;
	const ownerAppId = committedHeaderAppId(nativeNotice);
	const classes = desktopDetailsClasses(doc);
	const hasClass = (element: HTMLElement, value: string): boolean => value.split(/\s+/).filter(Boolean)
		.every(token => element.classList.contains(token));
	let nativeRow: HTMLElement | null = null;
	for (let node = noticeElement.parentElement, depth = 0; node && depth < 32; node = node.parentElement, depth += 1) {
		if (node === doc.body || node === doc.documentElement || containsNativeLibraryHeader(node)) break;
		if (hasClass(node, classes.ColumnContainer)) { nativeRow = node; break; }
	}
	let content = noticeElement as HTMLElement;
	for (let depth = 0; depth < 32 && content.parentElement; depth += 1) {
		const row = content.parentElement;
		if (row === doc.body || row === doc.documentElement || row.closest('[id^="gdl-"], [data-nsp]')
			|| containsNativeLibraryHeader(row) || isInsideNativeLibraryHeader(row)) break;
		if (nativeRow && row !== nativeRow) { content = row; continue; }
		const siblings = Array.from(row.children).filter(child => child !== content) as HTMLElement[];
		// Use Steam's explicit column contract when available, then the same
		// sibling topology as a compatibility fallback for renamed CSS hashes.
		const candidates = siblings.filter(sibling => hasClass(sibling, classes.RightColumn));
		if (!nativeRow) for (const sibling of siblings) if (!candidates.includes(sibling)) candidates.push(sibling);
		for (const sidebar of candidates) {
			if (sidebar.closest('[id^="gdl-"], [data-nsp]') || containsNativeLibraryHeader(sidebar)) continue;
			const sidebarAppId = committedHeaderAppId(sidebar);
			if (ownerAppId !== null && sidebarAppId !== null && sidebarAppId !== ownerAppId) continue;
			const anchor = nativeRegionWithin(sidebar, ownerAppId);
			if (!anchor) continue;
			return { ...empty, anchorRegion: anchor, sidebarColumn: sidebar,
				twoColumnRow: row, contentColumn: content };
		}
		content = row;
	}
	return empty;
}

/** The native columns can commit before Steam inserts its shortcut notice or
 * finishes loading artwork. Resolve that exact in-page playbar's own details
 * container; a compact/foreign header never authorizes another page's column. */
export function discoverNativeLibraryLayoutForShortcut(doc: Document, shortcutAppId: string | number): NativeLibraryLayout {
	const empty: NativeLibraryLayout = { anchorRegion: null, sidebarColumn: null,
		twoColumnRow: null, contentColumn: null, noticeParent: null };
	const appId = Number(shortcutAppId);
	if (!Number.isInteger(appId) || appId < 2147483648 || appId > 4294967295
		|| doc.hidden || !doc.defaultView || doc.defaultView.closed) return empty;
	const classes = desktopDetailsClasses(doc), playbarClasses = PLAYBAR_CLASSES(doc);
	const matchesOwner = (element: HTMLElement): boolean => {
		const owner = committedHeaderAppId(element);
		return owner === null || owner === appId;
	};
	for (const playbar of elementsWithCssModuleClass(doc, playbarClasses.Container)) {
		if (!hasCssModuleClass(playbar, playbarClasses.InPage) || playbar.closest('[id^="gdl-"], [data-nsp]')
			|| committedHeaderAppId(playbar) !== appId || !isPaintedLibraryElement(doc, playbar)) continue;
		let container = playbar.parentElement;
		for (let depth = 0; container && depth < 32 && container !== doc.body; depth += 1, container = container.parentElement) {
			if (!hasCssModuleClass(container, classes.Container)) continue;
			if (!matchesOwner(container)) break;
			for (const row of elementsWithCssModuleClass(container, classes.ColumnContainer)) {
				if (row.closest('[id^="gdl-"], [data-nsp]') || containsNativeLibraryHeader(row) || !matchesOwner(row)) continue;
				const content = Array.from(row.children).find(child => hasCssModuleClass(child, classes.LeftColumn)) as HTMLElement | undefined;
				const sidebar = Array.from(row.children).find(child => hasCssModuleClass(child, classes.RightColumn)) as HTMLElement | undefined;
				if (!content || !sidebar || !matchesOwner(content) || !matchesOwner(sidebar)) continue;
				const layout = discoverNativeLibraryLayout(doc, content);
				if (layout.twoColumnRow !== row || layout.sidebarColumn !== sidebar || !layout.anchorRegion
					|| !matchesOwner(layout.anchorRegion)) continue;
				return { ...layout, noticeParent: null };
			}
			break;
		}
	}
	return empty;
}

/** Restore only the geometry we intentionally need for the linked-game render. */
export function prepareNativeLibraryLayout(layout: NativeLibraryLayout): void {
	if (layout.contentColumn && !containsNativeLibraryHeader(layout.contentColumn) && !isInsideNativeLibraryHeader(layout.contentColumn)) {
		setNativeStyle(layout.contentColumn, 'display', 'block');
		setNativeStyle(layout.contentColumn, 'height', 'auto');
		setNativeStyle(layout.contentColumn, 'minHeight', '0');
		setNativeStyle(layout.contentColumn, 'alignSelf', 'flex-start');
		layout.contentColumn.removeAttribute('data-gdl-hidden');
	}
	if (layout.twoColumnRow && !containsNativeLibraryHeader(layout.twoColumnRow) && !isInsideNativeLibraryHeader(layout.twoColumnRow)) {
		setNativeStyle(layout.twoColumnRow, 'display', '');
		setNativeStyle(layout.twoColumnRow, 'alignItems', 'flex-start');
		layout.twoColumnRow.removeAttribute('data-gdl-hidden');
	}
}

/**
 * Hide Steam's non-Steam explanation and wrapper padding without touching the
 * actual content/two-column containers or surfaces owned by another plugin.
 */
export function hideLinkedShortcutNotice(noticeElement: Element, layout: NativeLibraryLayout): void {
	let element: HTMLElement | null = noticeElement as HTMLElement;
	for (let depth = 0; depth < 4 && element; depth += 1) {
		if (element.id?.startsWith('gdl-') || element === layout.contentColumn || element === layout.twoColumnRow) break;
		if (depth > 0 && element.querySelector('[data-nsp]')) break;
		hideNativeLibraryElement(element);
		const parent = element.parentElement;
		if (!parent || parent.childElementCount > 1) break;
		element = parent;
	}
}

export interface NativeSidebarSectionOptions {
	sectionId: string;
	headerText: string;
	innerId: string;
	innerHtml: string;
	cloneInnerClass?: boolean;
}

/**
 * Build one sidebar/content region using the live classes and wrapper topology
 * of Steam's own Notes/Media section. Only the small section shell is cloned;
 * the complete native page tree is never copied or persisted.
 */
export function buildNativeSidebarSection(
	doc: Document,
	layout: NativeLibraryLayout,
	options: NativeSidebarSectionOptions,
): HTMLElement | null {
	const { anchorRegion, sidebarColumn } = layout;
	if (!anchorRegion) return null;

	const regionChildren = Array.from(anchorRegion.children);
	const sourceHeading = regionChildren.find(child => child.tagName === 'H2') as HTMLElement | undefined;
	const sourceBody = regionChildren.find(child => child.tagName === 'DIV') as HTMLElement | undefined;
	const sourceInner = sourceBody?.firstElementChild as HTMLElement | null | undefined;

	const region = doc.createElement('div');
	// The fallback anchor can be Controller, DLC or Friends. Component-specific
	// classes must not turn every injected section into that native component.
	region.className = nativeSectionClass(doc);
	region.setAttribute('role', 'region');

	if (sourceHeading) {
		const heading = sourceHeading.cloneNode(true) as HTMLElement;
		const textElement = heading.querySelector('div div') || heading.querySelector('div') || heading;
		textElement.textContent = options.headerText;
		region.appendChild(heading);
	}

	if (sourceBody) {
		const body = doc.createElement('div');
		body.className = sourceBody.className;
		const inner = doc.createElement('div');
		inner.id = options.innerId;
		if ((options.cloneInnerClass ?? true) && sourceInner) inner.className = sourceInner.className;
		inner.innerHTML = options.innerHtml;
		body.appendChild(inner);
		region.appendChild(body);
	}

	const anchorWrapper = anchorRegion.parentElement;
	let outer: HTMLElement = region;
	if (anchorWrapper && anchorWrapper.parentElement === sidebarColumn) {
		const wrapper = doc.createElement('div');
		wrapper.className = anchorWrapper.className;
		wrapper.appendChild(region);
		outer = wrapper;
	}
	outer.id = options.sectionId;
	applyNativeSurfaceTokens(outer, [sourceInner, sourceBody, anchorRegion]);
	return outer;
}

export function insertMainContent(
	wrapper: HTMLElement,
	layout: NativeLibraryLayout,
	protectedIds: ReadonlySet<string>,
): void {
	const { contentColumn, noticeParent } = layout;
	if (contentColumn) {
		// A partial Steam route commit can expose a common ancestor before the
		// real content column exists. Wait for that column instead of hiding art.
		if (containsNativeLibraryHeader(contentColumn) || isInsideNativeLibraryHeader(contentColumn)) return;
		for (const child of Array.from(contentColumn.children)) {
			const element = child as HTMLElement;
			if (child === wrapper || protectedIds.has(element.id)) continue;
			hideNativeLibraryElement(element);
		}
		contentColumn.insertBefore(wrapper, contentColumn.firstChild);
		return;
	}
	const doc = wrapper.ownerDocument;
	const header = findNativeLibraryHeader(doc);
	if (header && header.parentElement && ((noticeParent && header.contains(noticeParent)) || !noticeParent)) {
		if (header.nextElementSibling) {
			header.parentElement.insertBefore(wrapper, header.nextElementSibling);
		} else {
			header.parentElement.appendChild(wrapper);
		}
		return;
	}
	if (noticeParent?.parentElement) noticeParent.parentElement.insertBefore(wrapper, noticeParent.nextSibling);
}
