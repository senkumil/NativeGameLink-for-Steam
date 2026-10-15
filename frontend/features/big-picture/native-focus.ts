/** A parent context alone does not prove that our separate React root mounted. */
export function getMountedBigPictureNavNode(doc: Document, root: HTMLElement, parent: any, handle: any): any | null {
	try {
		const node = handle?.Node?.(), tree = parent?.Tree, view = doc.defaultView;
		if (!view || view.closed || view.document !== doc || !root.isConnected || root.ownerDocument !== doc
			|| !node || node === parent || node.Parent !== parent || node.Tree !== tree || handle.NavTree?.() !== tree
			|| !node.Element?.isConnected || node.Element.ownerDocument !== doc || !root.contains(node.Element)
			|| typeof node.BTakeFocus !== 'function' || !tree.Root?.Element?.isConnected
			|| tree.Root.Element.ownerDocument !== doc || (tree.Window && tree.Window !== view)
			|| (tree.WindowContext?.RootWindow && tree.WindowContext.RootWindow !== view)
			|| tree.SubscribableIsMounted?.Value === false) return null;
		return node;
	} catch { return null; }
}

/** Let Steam's mounted Focusable handle focus; DOM focus alone misses its tree. */
export function focusBigPictureNativeElement(doc: Document, target: HTMLElement, direction = 9): boolean {
	const view = doc.defaultView;
	if (!view || view.closed || view.document !== doc || !target.isConnected || target.ownerDocument !== doc) return false;
	try {
		const request = new view.CustomEvent('vgp_requestfocus', {
			bubbles: true, cancelable: true, detail: { button: direction, source: 0, is_repeat: false },
		});
		return !target.dispatchEvent(request);
	} catch { return false; }
}
