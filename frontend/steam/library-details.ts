import { PLAYBAR_CLASSES } from './css';
import { elementsWithCssModuleClass, hasCssModuleClass, isRenderedElement } from './native-dom';

function appId(value: unknown): number | null {
	const number = Number(value);
	return Number.isInteger(number) && number !== 0 && number >= -2147483648 && number <= 4294967295
		? number < 0 ? number >>> 0 : number : null;
}

export function isPaintedLibraryElement(doc: Document, element: HTMLElement): boolean {
	if (!element.isConnected || !isRenderedElement(doc, element)) return false;
	for (let current: HTMLElement | null = element; current; current = current.parentElement) {
		const style = doc.defaultView?.getComputedStyle(current);
		if (style && (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse'
			|| (style.opacity !== '' && Number(style.opacity) === 0))) return false;
	}
	return true;
}

/** React can share a bailed-out subtree between both roots, so a host's return
 * chain alone does not identify its current branch. Follow React's mounted
 * fiber and child-membership rules, with bounds for foreign/malformed trees. */
function currentFiber(fiber: any): any | null {
	let remaining = 4096;
	const mounted = (value: any): any | null => {
		let node = value;
		let nearest = value;
		while (node && remaining-- > 0) {
			if (!value.alternate && (node.flags & 4098)) nearest = node.return;
			if (!node.return) return node.tag === 3 && node.stateNode?.current ? nearest : null;
			node = node.return;
		}
		return null;
	};
	const alternate = fiber?.alternate;
	if (!alternate) return mounted(fiber) === fiber ? fiber : null;
	let a = fiber;
	let b = alternate;
	for (let depth = 0; depth < 256 && remaining-- > 0; depth += 1) {
		const parentA = a?.return;
		if (!parentA) {
			if (a?.tag !== 3) return null;
			const root = a.stateNode?.current;
			return root === a ? fiber : root === a.alternate ? alternate : null;
		}
		const parentB = parentA.alternate;
		if (!parentB) {
			if (!parentA.return) return null;
			a = b = parentA.return;
			continue;
		}
		if (parentA.child === parentB.child) {
			for (let child = parentA.child; child && remaining-- > 0; child = child.sibling) {
				if (child === a || child === b) {
					return mounted(parentA) === parentA ? child === a ? fiber : alternate : null;
				}
			}
			return null;
		}
		if (a.return !== b.return) {
			a = parentA;
			b = parentB;
		} else {
			let found = false;
			for (const parent of [parentA, parentB]) {
				for (let child = parent.child; child && remaining-- > 0; child = child.sibling) {
					if (child !== a && child !== b) continue;
					const other = parent === parentA ? parentB : parentA;
					if (child === a) { a = parent; b = other; }
					else { b = parent; a = other; }
					found = true;
					break;
				}
				if (found) break;
			}
			if (!found) return null;
		}
		if (a.alternate !== b) return null;
	}
	return null;
}

/** Read committed native ownership; pending props are not displayed yet. */
export function committedHeaderAppId(element: HTMLElement): number | null {
	try {
		const key = Object.getOwnPropertyNames(element).find(value =>
			value.startsWith('__reactFiber$') || value.startsWith('__reactInternalInstance$'));
		if (!key) return null;
		let fiber = (element as any)[key];
		const seen = new Set<any>();
		for (let depth = 0; fiber && depth < 128; depth += 1) {
			fiber = currentFiber(fiber);
			if (!fiber || seen.has(fiber)) return null;
			seen.add(fiber);
			const props = fiber.memoizedProps;
			for (const value of [props?.overview?.appid, props?.appOverview?.appid, props?.details?.unAppID, props?.appid, props?.appId, props?.nAppID]) {
				const id = appId(value);
				if (id !== null) return id;
			}
			fiber = fiber.return;
		}
	} catch {}
	return null;
}

export function paintedNativePlaybar(doc: Document, expectedAppId: number): HTMLElement | null {
	return elementsWithCssModuleClass(doc, PLAYBAR_CLASSES().Container).find(element =>
		!element.closest('[id^="gdl-"]') && isPaintedLibraryElement(doc, element)
		&& committedHeaderAppId(element) === expectedAppId) || null;
}

/** Includes an owned Cloud fallback only under this game's painted native bar. */
export function paintedNativeStats(doc: Document, expectedAppId: number): HTMLElement[] {
	const classes = PLAYBAR_CLASSES();
	return elementsWithCssModuleClass(doc, classes.GameStatsSection).filter(section => {
		if (!isPaintedLibraryElement(doc, section)) return false;
		if (section.hasAttribute('data-gdl-cloud-stats')) {
			for (let parent = section.parentElement; parent; parent = parent.parentElement) {
				if (hasCssModuleClass(parent, classes.Container)) {
					return isPaintedLibraryElement(doc, parent) && committedHeaderAppId(parent) === expectedAppId;
				}
			}
			return false;
		}
		return !section.closest('[id^="gdl-"]') && committedHeaderAppId(section) === expectedAppId;
	});
}
