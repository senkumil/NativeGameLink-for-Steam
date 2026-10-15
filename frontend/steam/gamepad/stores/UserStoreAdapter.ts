import { getDocumentSteamStore } from './AppStoreAdapter';

export class UserStoreAdapter {
	public static getStore(doc?: Document): any | null {
		return getDocumentSteamStore(['userStore', 'UserStore'], doc);
	}

	public static getPersonaName(doc?: Document): string {
		const store = this.getStore(doc);
		return String(store?.m_strPersonaName || store?.personaName || '');
	}
}
