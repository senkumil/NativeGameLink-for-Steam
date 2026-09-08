export const EXIT_TEXT_EDITOR_EVENT = 'gdl:exit-text-editor';

export function isEditableTextTarget(element: Element | null): boolean {
	if (!element) return false;
	const tag = element.tagName?.toLowerCase();
	if (tag === 'textarea') return true;
	if (tag === 'input') {
		const type = (element.getAttribute('type') || 'text').toLowerCase();
		return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'file', 'color', 'image'].includes(type);
	}
	return element.getAttribute('contenteditable') === 'true' || element.getAttribute('role') === 'textbox';
}
