import { getDocumentSteamStore } from './AppStoreAdapter';

export class LibraryStoreAdapter {
	public static getStore(doc?: Document): any | null {
		return getDocumentSteamStore(['libraryStore', 'LibraryStore'], doc);
	}
}
