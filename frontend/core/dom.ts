/** Find an element containing visible text (case-insensitive partial match). */
export function findElementByText(root: Element | Document, text: string): Element | null {
	const ownerDoc = root instanceof Document ? root : (root.ownerDocument || document);
	const startNode = root instanceof Document ? (root.body || root.documentElement) : root;
	if (!startNode) return null;
	const walker = ownerDoc.createTreeWalker(startNode, NodeFilter.SHOW_TEXT, null);
	const lowerText = text.toLocaleLowerCase();
	let node: Text | null;
	while ((node = walker.nextNode() as Text | null)) {
		if (node.textContent && node.textContent.trim().toLocaleLowerCase().includes(lowerText)) return node.parentElement;
	}
	return null;
}

/** Find an element whose text exactly matches after trimming. */
export function findElementByExactText(root: Element | Document, text: string): Element | null {
	const ownerDoc = root instanceof Document ? root : (root.ownerDocument || document);
	const startNode = root instanceof Document ? (root.body || root.documentElement) : root;
	if (!startNode) return null;
	const walker = ownerDoc.createTreeWalker(startNode, NodeFilter.SHOW_TEXT, null);
	let node: Text | null;
	while ((node = walker.nextNode() as Text | null)) {
		if (node.textContent && node.textContent.trim() === text) return node.parentElement;
	}
	return null;
}

/** A host can receive an owned child without being owned itself. Classify the
 * complete record, including detached removed nodes, before scheduling work. */
export function mutationIsWithinSelector(record: MutationRecord, selector: string): boolean {
	const matches = (node: Node): boolean => {
		const element = node.nodeType === 1 ? node as Element : node.parentElement;
		return Boolean(element?.closest(selector));
	};
	if (matches(record.target)) return true;
	const changed = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
	return changed.length > 0 && changed.every(matches);
}
