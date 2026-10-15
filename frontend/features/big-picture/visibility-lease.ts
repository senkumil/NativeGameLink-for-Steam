type AttributeLease = { original: string | null; installed: string };
interface VisibilityLease {
	owner: HTMLElement;
	hidden: boolean;
	hiddenAttribute: string | null;
	installedHiddenAttribute: string | null;
	display: string;
	displayPriority: string;
	attributes: Map<string, AttributeLease>;
}
function attribute(element: HTMLElement, name: string, value: string | null): void {
	if (value === null) element.removeAttribute(name); else element.setAttribute(name, value);
}

/** A marker alone never grants ownership. Restore each property only while it
 * still contains the value installed by this lease, preserving newer Steam writes. */
export class NativeVisibilityLeases {
	private documents = new WeakMap<Document, Map<HTMLElement, VisibilityLease>>();
	hide(element: HTMLElement, owner: HTMLElement, markers: Record<string, string>): void {
		const doc = owner.ownerDocument;
		if (element.ownerDocument !== doc || !element.isConnected || !owner.isConnected) return;
		let leases = this.documents.get(doc);
		if (!leases) this.documents.set(doc, leases = new Map());
		let lease = leases.get(element);
		if (!lease) {
			lease = { owner, hidden: element.hidden, hiddenAttribute: element.getAttribute('hidden'), installedHiddenAttribute: null,
				display: element.style.getPropertyValue('display'), displayPriority: element.style.getPropertyPriority('display'), attributes: new Map() };
			leases.set(element, lease);
		} else {
			lease.owner = owner;
			if (element.hidden !== true || element.getAttribute('hidden') !== lease.installedHiddenAttribute) {
				lease.hidden = element.hidden; lease.hiddenAttribute = element.getAttribute('hidden');
			}
			if (element.style.getPropertyValue('display') !== 'none' || element.style.getPropertyPriority('display') !== 'important') {
				lease.display = element.style.getPropertyValue('display'); lease.displayPriority = element.style.getPropertyPriority('display');
			}
		}
		for (const [name, installed] of Object.entries({ ...markers, 'aria-hidden': 'true' })) {
			const previous = lease.attributes.get(name), value = element.getAttribute(name);
			lease.attributes.set(name, { original: previous && value === previous.installed ? previous.original : value, installed });
			element.setAttribute(name, installed);
		}
		element.hidden = true;
		lease.installedHiddenAttribute = element.getAttribute('hidden');
		element.style.setProperty('display', 'none', 'important');
	}
	retain(doc: Document, owner: HTMLElement, targets: ReadonlySet<HTMLElement>): void {
		const leases = this.documents.get(doc);
		if (!leases) return;
		for (const [element, lease] of leases) if (lease.owner !== owner || !targets.has(element) || !element.isConnected) {
			this.restoreElement(element, lease); leases.delete(element);
		}
		if (!leases.size) this.documents.delete(doc);
	}
	restore(doc: Document): void {
		const leases = this.documents.get(doc);
		if (!leases) return;
		for (const [element, lease] of leases) this.restoreElement(element, lease);
		this.documents.delete(doc);
	}
	private restoreElement(element: HTMLElement, lease: VisibilityLease): void {
		if (element.hidden === true && element.getAttribute('hidden') === lease.installedHiddenAttribute) {
			element.hidden = lease.hidden; attribute(element, 'hidden', lease.hiddenAttribute);
		}
		if (element.style.getPropertyValue('display') === 'none' && element.style.getPropertyPriority('display') === 'important') {
			if (lease.display) element.style.setProperty('display', lease.display, lease.displayPriority); else element.style.removeProperty('display');
		}
		for (const [name, state] of lease.attributes) if (element.getAttribute(name) === state.installed) attribute(element, name, state.original);
	}
}
