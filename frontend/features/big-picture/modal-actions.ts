type ModalCloseAction = { close: () => void; document: Document };
const closeActions = new WeakMap<HTMLElement, ModalCloseAction>();

/** Register the exact owned inner element; selectors alone cannot own a native modal. */
export function registerBigPictureModalClose(element: HTMLElement, close: () => void): () => void {
	const action = { close, document: element.ownerDocument };
	closeActions.set(element, action);
	return () => { if (closeActions.get(element) === action) closeActions.delete(element); };
}

export function closeRegisteredBigPictureModal(element: HTMLElement): boolean {
	const action = closeActions.get(element);
	if (!action || action.document !== element.ownerDocument) return false;
	action.close();
	return true;
}
