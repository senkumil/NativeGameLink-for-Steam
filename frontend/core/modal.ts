/** The browser top layer escapes Steam's clipped and transformed popup roots. */
export function mountModalDialog(dialog: HTMLDialogElement): void {
	dialog.ownerDocument.body.appendChild(dialog);
	// The caller's Escape handler owns dismissal and its in-progress guard.
	dialog.addEventListener('cancel', event => event.preventDefault());
	if (typeof dialog.showModal === 'function') dialog.showModal();
	else dialog.setAttribute('open', '');
}

/** Keep selection intact and paste through the browser that owns the input. */
export function wirePasteButton(input: HTMLInputElement, button: HTMLButtonElement): void {
	button.addEventListener('mousedown', event => event.preventDefault());
	button.addEventListener('click', event => {
		event.preventDefault();
		input.focus();
		const doc = input.ownerDocument;
		const browser = (doc.defaultView as any)?.SteamClient?.Browser;
		if (typeof browser?.Paste === 'function') browser.Paste();
		else doc.execCommand('paste');
	});
}
