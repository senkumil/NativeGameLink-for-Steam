import { loc } from '../../steam/localization';
import { APP_DETAILS_ROUTE_PATTERN, collectActiveRouteValues } from '../../steam/gamepad/GamepadContext';
import type { BigPictureTab } from './types';

export const TAB_TEXT: Record<BigPictureTab, string[]> = {
	activity: [
		'activity', 'actividad', 'activite', 'activité', 'aktivitat', 'aktivität', 'attivita', 'attività', 'atividade',
		'активность', 'активність', 'активност', 'aktywnosc', 'aktywność', 'aktivita', 'tevekenyseg', 'tevékenység',
		'activitate', 'aktivite', 'activiteit', 'toiminta', 'δραστηριότητα', '动态', '動態', 'アクティビティ', '활동',
		'กิจกรรม', 'hoat dong', 'hoạt động', 'aktivitas', 'النشاط',
	],
	stuff: [
		'your stuff', 'your content', 'tus cosas', 'tu contenido', 'vos trucs', 'votre contenu',
		'deine sachen', 'deine inhalte', 'le tue cose', 'i tuoi contenuti', 'suas coisas', 'seu conteudo', 'seu conteúdo', 'seus itens',
		'ваши вещи', 'ваш контент', 'ваші речі', 'ваш вміст', 'вашите неща', 'вашето съдържание',
		'twoje rzeczy', 'twoja zawartosc', 'twoja zawartość', 'vase veci', 'vaše věci', 'váš obsah',
		'a te dolgaid', 'sajat dolgok', 'saját dolgok', 'lucrurile tale', 'continutul tau', 'conținutul tău',
		'ogeleriniz', 'öğeleriniz', 'iceriginiz', 'içeriğiniz', 'je spullen', 'jouw inhoud',
		'dina saker', 'ditt innehall', 'ditt innehåll', 'dine ting', 'dit indhold', 'omat tavarat', 'oma sisalto', 'oma sisältö',
		'τα πράγματά σας', 'το περιεχόμενό σας', '您的内容', '你的内容', '您的內容', '你的內容', '您的物品',
		'マイコンテンツ', 'あなたのコンテンツ', '내 보관함', '내 콘텐츠', '내 아이템', 'เนื้อหาของคุณ',
		'do cua ban', 'đồ của bạn', 'noi dung cua ban', 'nội dung của bạn', 'konten anda', 'barang anda', 'أغراضك', 'محتواك',
	],
	community: [
		'community', 'comunidad', 'communaute', 'communauté', 'gemeinschaft', 'comunita', 'comunità', 'comunidade',
		'сообщество', 'спільнота', 'общност', 'spolecznosc', 'społeczność', 'komunita', 'kozosseg', 'közösség',
		'comunitate', 'topluluk', 'gemenskap', 'faellesskab', 'fællesskab', 'yhteiso', 'yhteisö', 'fellesskap',
		'κοινότητα', '社区', '社群', 'コミュニティ', '커뮤니ティ', 'ชุมชน', 'cong dong', 'cộng đồng', 'komunitas', 'المجتمع',
	],
	info: [
		'game information', 'game info', 'about game', 'about the game',
		'informacion del juego', 'información del juego', 'informacion', 'información', 'acerca del juego',
		'informations sur le jeu', 'infos sur le jeu', 'a propos du jeu', 'à propos du jeu',
		'spielinformationen', 'spielinfo', 'uber das spiel', 'über das spiel',
		'informazioni sul gioco', 'info sul gioco', 'sul gioco',
		'informacoes do jogo', 'informações do jogo', 'sobre o jogo',
		'об игре', 'информация об игре', 'сведения об игре', 'про гру', 'відомості про гру', 'інформація про гру',
		'за играта', 'информация за играта', 'informacje o grze', 'o grze', 'informace o hre', 'informace o hře', 'o hre', 'o hře',
		'jatekadatok', 'játékadatok', 'jatekinfo', 'játékinfó', 'a jatekrol', 'a játékról',
		'informatii despre joc', 'informații despre joc', 'despre joc', 'oyun bilgisi', 'oyun hakkinda', 'oyun hakkında',
		'spelinfo', 'speldetails', 'over het spel', 'spelinformation', 'om spelet', 'spiloplysninger', 'om spillet',
		'pelin tiedot', 'tietoja pelista', 'tietoja pelistä', 'spillinformasjon', 'om spillet',
		'πληροφορίες παιχνιδιού', 'σχετικά με το παιχνίδι', '游戏信息', '关于游戏', '遊戲資訊', '關於遊戲', '遊戲信息',
		'ゲーム情報', 'ゲームについて', '게임 정보', '게임 소개', 'ข้อมูลเกม', 'เกี่ยวกับเกม',
		'thong tin tro choi', 'thông tin trò chơi', 've tro choi', 'về trò chơi', 'info game', 'tentang game', 'معلومات اللعبة', 'حول اللعبة',
	],
};

export function normalizeUiText(value: unknown): string {
	return String(value ?? '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.toLocaleLowerCase();
}

export function tabAliases(tab: BigPictureTab): string[] {
	let dynamic: string[] = [];
	if (tab === 'activity') {
		dynamic = [
			loc('AppDetails_SectionTitle_Activity', ''),
			loc('AppDetails_Tab_Activity', ''),
			loc('AppActivity_Activity', ''),
			loc('AppActivity_Title', ''),
		];
	} else if (tab === 'stuff') {
		dynamic = [
			loc('AppDetails_SectionTitle_YourStuff', ''),
			loc('AppDetails_Tab_YourStuff', ''),
			loc('AppDetails_YourStuff', ''),
			loc('AppDetails_YourContent', ''),
		];
	} else if (tab === 'community') {
		dynamic = [
			loc('AppDetails_SectionTitle_Community', ''),
			loc('AppDetails_Tab_Community', ''),
			loc('AppDetails_Community', ''),
			loc('AppDetails_Links_Community', ''),
			loc('AppDetails_CommunityHub', ''),
		];
	} else if (tab === 'info') {
		dynamic = [
			loc('AppDetails_GameInfo', ''),
			loc('AppDetails_SectionTitle_GameInfo', ''),
			loc('AppDetails_Tab_GameInfo', ''),
			loc('AppDetails_AboutGame', ''),
			loc('AppDetails_AboutTheGame', ''),
		];
	}
	return [...dynamic.filter(Boolean), ...TAB_TEXT[tab]].map(normalizeUiText).filter(Boolean);
}

export function findTabTextElement(doc: Document, tab: BigPictureTab): HTMLElement | null {
	const aliases = tabAliases(tab);
	const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null);
	let node: Text | null;
	while ((node = walker.nextNode() as Text | null)) {
		const text = normalizeUiText(node.textContent || '');
		if (!aliases.includes(text) || !node.parentElement) continue;
		const el = node.parentElement;
		if (el.closest('#gdl-bp-detail-root')) continue;
		const rect = el.getBoundingClientRect();
		if (rect.width > 0 && rect.height > 0) return el;
	}
	return null;
}

export function clickableTabElement(element: HTMLElement): HTMLElement {
	let current: HTMLElement | null = element;
	for (let depth = 0; current && depth < 5; depth++, current = current.parentElement) {
		if (current.matches('button, [role="button"], [role="tab"], [tabindex], [class*="Tab_"], [class*="tab_"], [class*="TabItem"], [class*="tabItem"]')) return current;
	}
	return element;
}

export function commonAncestor(elements: HTMLElement[]): HTMLElement | null {
	if (elements.length === 0) return null;
	let current: HTMLElement | null = elements[0];
	while (current) {
		if (elements.every(element => current === element || current!.contains(element))) return current;
		current = current.parentElement;
	}
	return null;
}

const LIBRARY_COLLECTION_KEYWORDS = [
	'todos los juegos', 'all games', 'instalados', 'installed', 'no de steam',
	'non-steam', 'compatible con controles', 'great on deck', 'controller',
	'colecciones', 'collections', 'favoritos', 'favorites',
];

export function findBigPictureTabStrip(doc: Document): { strip: HTMLElement; controls: Map<BigPictureTab, HTMLElement> } | null {
	const routeValues = collectActiveRouteValues(doc);
	const hasAppRoute = routeValues.some(v => APP_DETAILS_ROUTE_PATTERN.test(v));
	if (!hasAppRoute && doc.querySelector('[class*="AllGames"], [class*="LibraryHome"], [class*="AllCollections"]')) {
		return null;
	}

	const controls = new Map<BigPictureTab, HTMLElement>();
	for (const tab of ['activity', 'stuff', 'community', 'info'] as BigPictureTab[]) {
		const text = findTabTextElement(doc, tab);
		if (text) {
			if (text.closest('#gdl-bp-detail-root, [class*="AllGames"], [class*="LibraryHome"], [class*="Shelf"], [class*="Grid"]')) {
				continue;
			}
			controls.set(tab, clickableTabElement(text));
		}
	}

	if (controls.size < 2) return null;
	const values = Array.from(controls.values());
	let strip = commonAncestor(values);
	if (!strip || strip === doc.body) {
		strip = (controls.get('activity') || values[0])?.parentElement;
	}
	if (!strip || strip === doc.body) return null;

	if (strip.closest('[class*="AllGames"], [class*="LibraryHome"], [class*="Shelf"], [class*="Grid"]')) {
		return null;
	}

	const isAppDetailsTabs = controls.has('activity') && (controls.has('info') || controls.has('stuff') || controls.has('community'));
	if (!isAppDetailsTabs) {
		const stripText = normalizeUiText(strip.textContent || '');
		if (LIBRARY_COLLECTION_KEYWORDS.some(kw => stripText.includes(kw))) {
			return null;
		}
	}

	while (strip.parentElement && strip.parentElement !== doc.body) {
		const rect = strip.getBoundingClientRect();
		if (rect.width >= 200 && rect.height > 20 && rect.height <= 150) break;
		const parent = strip.parentElement;
		if (!values.every(value => parent.contains(value))) break;
		if (parent.querySelector('#gdl-bp-detail-root, [class*="AppDetailsOverviewPanel"], [class*="ScrollContainer"]')) break;
		strip = parent;
	}
	return { strip, controls };
}

function isNodeSelectedOrActive(node: Element | null): boolean {
	if (!node) return false;
	if (node.getAttribute('aria-selected') === 'true') return true;
	if (node.getAttribute('data-selected') === 'true') return true;
	if (node.getAttribute('aria-current') === 'page' || node.getAttribute('aria-current') === 'true') return true;
	const cls = String((node as HTMLElement).className || '');
	if (/(^|[\s_-])(selected|active|current)([\s_-]|$)/i.test(cls)) return true;
	if (cls.includes('Selected') || cls.includes('selected') || cls.includes('active_') || cls.includes('_active')) return true;
	return false;
}

export function activeTabFromNative(doc: Document, controls: Map<BigPictureTab, HTMLElement>): BigPictureTab | null {
	for (const [tab, el] of controls) {
		if (isNodeSelectedOrActive(el)) return tab;
		let p = el.parentElement;
		for (let depth = 0; p && depth < 4; depth++, p = p.parentElement) {
			if (isNodeSelectedOrActive(p)) return tab;
		}
		if (el.querySelector('[aria-selected="true"], [data-selected="true"], [class*="Selected"], [class*="selected"], [class*="Active"], [class*="active"]')) {
			return tab;
		}
	}

	for (const [tab, el] of controls) {
		if (el.classList.contains('gpfocus') || el.dataset.focus === 'true' || el.matches(':focus, :focus-visible, [class*="gpfocus"]')) {
			return tab;
		}
		if (doc.activeElement && (doc.activeElement === el || el.contains(doc.activeElement))) {
			return tab;
		}
		if (el.querySelector(':focus, [class*="gpfocus"], [data-focus="true"]')) {
			return tab;
		}
	}

	let brightestTab: BigPictureTab | null = null;
	let maxBgBrightness = 0;
	for (const [tab, el] of controls) {
		const target = el.matches('button, [role="tab"], [role="button"]') ? el : (el.parentElement || el);
		const style = doc.defaultView?.getComputedStyle(target);
		const bg = String(style?.backgroundColor || '');
		const rgbMatch = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
		if (rgbMatch) {
			const a = rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) : 1;
			if (a > 0.15) {
				const brightness = (parseInt(rgbMatch[1], 10) + parseInt(rgbMatch[2], 10) + parseInt(rgbMatch[3], 10)) * a;
				if (brightness > maxBgBrightness) {
					maxBgBrightness = brightness;
					brightestTab = tab;
				}
			}
		}
	}
	if (brightestTab && maxBgBrightness > 50) return brightestTab;

	const hasNativeGameInfo = Boolean(
		doc.querySelector('[class*="NonSteamGameNotice"], [class*="GameInfoCollections"], [class*="GameInfoContainer"]')
		|| Array.from(doc.querySelectorAll<HTMLElement>('div, p, [class*="Notice"]')).some(el => {
			if (el.closest('#gdl-bp-detail-root')) return false;
			const t = (el.textContent || '').trim().toLowerCase();
			return t.includes('no es un juego de steam') || t.includes('non-steam game');
		})
	);
	if (hasNativeGameInfo && controls.has('info')) {
		return 'info';
	}

	return null;
}
