export interface Mappings { [gameTitle: string]: string }

export interface GameDataCache { [steamAppId: string]: SteamGameData | null }

export interface FriendPersona {
	steamid: string;
	name: string;
	avatar: string;
}

export interface FriendPlayInfo {
	steamid: string;
	minutes_played: number;
	minutes_played_recently: number;
}

export interface FriendCategories {
	recentlyPlayed: FriendPlayInfo[];
	previouslyPlayed: FriendPlayInfo[];
	wishlisted?: FriendPlayInfo[];
	totalCount: number;
}

export interface CommunityContentItem {
	type: string;
	label?: string;
	image: string;
	title?: string;
	description?: string;
	author_name?: string;
	author_avatar?: string;
	link?: string;
	youtube_id?: string;
}

export interface SteamCommunityCardAsset {
	title: string;
	image: string;
	artwork?: string;
	foil?: boolean;
}

export interface SteamCommunityBadgeAsset {
	title: string;
	image: string;
	foil?: boolean;
	level?: number;
}

export interface SteamCommunityItemsCatalog {
	appid?: number;
	cards: SteamCommunityCardAsset[];
	badges?: SteamCommunityBadgeAsset[];
	foil_badge?: SteamCommunityBadgeAsset | null;
	source?: string;
	error?: string;
	transient_error?: boolean;
}

export interface SteamGameData {
	type?: string;
	name: string;
	steam_appid: number;
	header_image: string;
	short_description: string;
	detailed_description?: string;
	about_the_game?: string;
	developers?: string[];
	publishers?: string[];
	franchises?: string[];
	genres?: { id: string; description: string }[];
	release_date?: { coming_soon: boolean; date: string };
	metacritic?: { score: number; url: string };
	categories?: { id: number; description: string }[];
	dlc?: number[];
	screenshots?: { id: number; path_thumbnail: string; path_full: string }[];
	background?: string;
	background_raw?: string;
	capsule_image?: string;
	capsule_imagev5?: string;
	website?: string;
	movies?: { id: number; name: string; thumbnail: string }[];
	achievements?: { total: number; highlighted?: { name: string; path: string }[] };
	controller_support?: string;
	platforms?: { windows?: boolean; mac?: boolean; linux?: boolean };
	is_delisted?: boolean;
	metadata_sources?: {
		identity?: 'steam_store_api' | 'steam_community_app_hub';
		artwork?: 'steam_store_api' | 'steam_cdn';
		news?: 'steam_news_web_api';
		community?: 'steam_community_app_hub';
		achievements?: 'steam_community_stats' | 'unavailable';
	};
	historical_capabilities?: {
		identity: 'available' | 'unavailable';
		artwork: 'available' | 'unavailable' | 'probe_on_demand';
		news: 'available' | 'unavailable' | 'probe_on_demand';
		community: 'available' | 'unavailable' | 'probe_on_demand';
		achievements: 'available' | 'unavailable' | 'probe_on_demand';
	};
}

export interface ShortcutDetectionCandidate {
	appid: string;
	name: string;
	image?: string;
	score: number;
	confidence: 'exact' | 'high' | 'medium' | 'low';
	reasons?: string[];
	negative_reasons?: string[];
	warnings?: string[];
	executable_match?: boolean;
	direct?: boolean;
	evidence_tier?: 'proof' | 'strong' | 'supporting' | 'hint';
	score_gap?: number;
	ambiguous?: boolean;
	identity_collision?: boolean;
	remembered?: boolean;
	validation_state?: 'pending' | 'partial' | 'confirmed';
	phase?: 'local' | 'remote' | 'all';
	candidate_key?: string;
	edition?: string;
	is_edition?: boolean;
	edition_assets?: { hero?: string; portrait?: string; logo?: string; wide?: string; icon?: string };
	bundle_id?: number;
}

export interface ShortcutDetectionResult {
	candidates: ShortcutDetectionCandidate[];
	launcher_detected?: boolean;
	generic_launcher?: boolean;
	executable?: string;
	source?: string;
	error?: string;
	transient_error?: boolean;
	validation_state?: 'pending' | 'partial' | 'confirmed';
	phase?: 'local' | 'remote' | 'all';
}

export interface ShortcutDetectionContext {
	shortcutAppId: number;
	title: string;
	exePath: string;
	startDir: string;
	launchOptions: string;
	bootstrapDetected?: boolean;
	recommendedExePath?: string;
	recommendedStartDir?: string;
	trackingExecutableAutoApply?: boolean;
}

export interface ShortcutLinkResult {
	ok: boolean;
	data?: SteamGameData;
	shortcutAppId?: number | null;
	aliases?: string[];
	setup?: {
		nameReady: boolean;
		iconApplied: boolean;
		artworkComplete: boolean;
		missingArtwork: string[];
		communityArtwork: string[];
	};
	error?: string;
}

export interface AchievementBasePathResponse {
	ok?: boolean;
	path?: string;
	exists?: boolean;
	configured?: boolean;
	error?: string;
}

export interface NewsItem {
	gid: string;
	title: string;
	url: string;
	contents: string;
	date: number;
	feedlabel?: string;
	feed_type?: number;
	event_type?: number;
	image?: string;
	historical_community?: boolean;
	feedname?: string;
}

export interface LocalAchievementItem {
	name: string;
	display_name: string;
	description: string;
	icon: string;
	icon_gray: string;
	hidden: boolean;
	global_percent: number;
	earned: boolean;
	earned_time: number;
	progress: number;
	max_progress: number;
	is_online?: boolean;
}

export interface LocalAchievementData {
	found: boolean;
	appid: string;
	metadata_appid?: string;
	state_appid?: string;
	root?: string;
	path?: string;
	metadata_source?: string;
	state_source?: string;
	simulation_enabled?: boolean;
	simulate_count?: number;
	simulate_online_count?: number;
	simulate_percent?: number;
	simulate_online_percent?: number;
	unlock_online?: boolean;
	unlocked_names?: string[];
	zero_progress?: boolean;
	unlocked: number;
	total: number;
	achievements: LocalAchievementItem[];
}

export type NativeGameFeatureKind =
	| 'single-player' | 'multiplayer' | 'coop' | 'achievements' | 'cloud'
	| 'controller-full' | 'controller-partial' | 'workshop' | 'remote-play'
	| 'family-sharing' | 'ps4' | 'ps5' | 'steam-input' | 'hdr' | 'vr' | 'generic';

export interface NativeGameFeature {
	key: string;
	label: string;
	kind: NativeGameFeatureKind;
	categoryId?: number;
}

export interface NativeGameInfo {
	key: string;
	isLegacy: boolean;
	title: string;
	portrait: string;
	description: string;
	developer: string;
	publisher: string;
	franchise: string;
	release: string;
	features: NativeGameFeature[];
	hasCloud: boolean;
}
