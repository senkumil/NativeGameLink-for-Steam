import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { chromium } from 'playwright';
import { browserLaunchOptions } from './helpers/browser-launch.mjs';

const files = {
 properties: 'frontend/features/shortcuts/community-item-properties.ts',
 service: 'frontend/core/community-item-options.ts',
 presentation: 'frontend/features/library/linked-card-presentation.ts',
 cards: 'frontend/features/library/trading-cards.ts',
 help: 'frontend/features/library/trading-card-help.ts',
 styles: 'frontend/features/library/styles/trading-cards.ts',
 disposables: 'frontend/core/disposables.ts',
 preloads: 'frontend/features/library/trading-card-preload.ts',
};
const sources = Object.fromEntries(Object.entries(files).map(([name, file]) => [name, ts.transpileModule(
 name === 'service' ? fs.readFileSync(file, 'utf8').replace('const SETTINGS_READ_TIMEOUT_MS = 8000;', 'const SETTINGS_READ_TIMEOUT_MS = 50;') : fs.readFileSync(file, 'utf8'), {
 compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText]));
const browser = await chromium.launch({ ...browserLaunchOptions(), headless: true });
try {
 const page = await browser.newPage();
 await page.route('**/*', route => route.request().resourceType() === 'document'
  ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' })
  : route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="224" height="261"><rect width="224" height="261" fill="#47a5c2"/></svg>' }));
 await page.goto('https://css-cards.test/');
 const result = await page.evaluate(async sources => {
  let checks = 0;
  const check = (value, message) => { if (!value) throw Error(message); checks++; };
  const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
  const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const waitFor = async predicate => { const deadline = performance.now() + 1500; while (!predicate() && performance.now() < deadline) await frame(); };
  const defaults = () => ({ enabled: false, card_border: 'normal', card_ids: [], badge_id: null });
  const automatic = () => ({ enabled: true, card_border: 'foil', card_ids: [], badge_id: null, auto_foil: true });
  const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
  const persistent = new Map(), writes = [], diagnostics = [];
  let readGate = null, readFailure = false, language = 'english';
  const backend = {
   getGameCommunityItemOptionsBackend: async ({ request_json }) => { const query = JSON.parse(request_json);
    if (readFailure) throw Error('Preferences IPC temporarily unavailable'); if (readGate) return readGate.promise;
    return JSON.stringify({ ok: true, ...(persistent.get(query.shortcut_app_id + ':' + query.steam_app_id) || automatic()) }); },
   setGameCommunityItemOptionsBackend: async ({ request_json }) => { const query = JSON.parse(request_json); writes.push(query); persistent.set(query.shortcut_app_id + ':' + query.steam_app_id, query); return JSON.stringify({ ok: true, ...query }); },
   backendLog: message => diagnostics.push(message),
  };
  const load = (name, dependency) => { const result = {}; new Function('exports', 'require', sources[name])(result, dependency); return result; };
  // Separate module instances model Properties and the desktop CEF runtime.
  const desktopService = load('service', () => backend), propertyService = load('service', () => backend);
  const translation = { steamLanguageSync: () => language, gdlText: (_key, text, values = {}) => text.replace(/\{(\w+)\}/g, (match, key) => String(values[key] ?? match)), loc: (_key, text) => text };
  const text = { escapeHtml: value => String(value).replace(/[&<>"']/g, character => '&#' + character.charCodeAt(0) + ';') };
  const catalogues = new Map(), catalogueListeners = new Map();
  const catalogFor = appid => {
   if (!catalogues.has(appid)) catalogues.set(appid, {
    appid: Number(appid), cards_complete: true, badges_complete: true,
    cards: [0, 1].map(index => ({ title: 'Normal ' + index, image: 'https://community.steamstatic.com/economy/image/' + appid + '-normal-' + index })),
    foil_cards: [0, 1].map(index => ({ title: 'Foil ' + index, foil: true, image: 'https://community.steamstatic.com/economy/image/' + appid + '-foil-' + index })),
    badges: [{ title: 'Bronze badge', level: 1, image: 'https://cdn.steamstatic.com/steamcommunity/public/images/items/' + appid + '/bronze.png' },
     { title: 'Master badge', level: 5, image: 'https://cdn.steamstatic.com/steamcommunity/public/images/items/' + appid + '/master.png' },
     { title: 'Silver badge', level: 1, foil: true, image: 'https://cdn.steamstatic.com/community_assets/images/items/' + appid + '/silver.png' }],
   });
   return catalogues.get(appid);
  };
  const catalogueApi = {
   getImmediateOfficialCommunityItems: (_doc, appid) => catalogFor(appid),
   getOfficialCommunityItems: async (_doc, appid) => catalogFor(appid),
   subscribeOfficialCommunityItems: (_doc, appid, listener) => { let set = catalogueListeners.get(appid); if (!set) catalogueListeners.set(appid, set = new Set()); set.add(listener); return () => set.delete(listener); },
   normalizeCommunityAssetUrl: value => typeof value === 'string' ? value : '',
  };
  const presentation = load('presentation', () => desktopService), disposables = load('disposables'), preloads = load('preloads');
  let shortcut = '3000000091', steam = '880', scopeGeneration = 0;
  // Explicit existing Steam-data records retain the previous preview and are
  // independent of the new missing-preferences automatic foil preset.
  for (const key of ['3000000091:880', '3000000092:880', '3000000091:881']) persistent.set(key, defaults());
  document.body.innerHTML = '<main id="gdl-library-injected"><div id="details" style="display:flex;width:1100px"><div id="activity"></div><aside style="width:420px"></aside></div></main>';
  const column = document.querySelector('aside'), details = document.getElementById('details');
  const layout = { anchorRegion: document.getElementById('activity'), sidebarColumn: column, twoColumnRow: details, contentColumn: null, noticeParent: null };
  const buildSection = (doc, _layout, input) => { const section = doc.createElement('section'); section.id = input.sectionId;
   section.innerHTML = '<h2><div>' + text.escapeHtml(input.headerText) + '</div></h2><div id="' + input.innerId + '">' + input.innerHtml + '</div>'; return section; };
  const orderFor = (_doc, _layout, appid, requestedShortcut) => {
   if (appid !== steam || requestedShortcut && requestedShortcut !== shortcut) return null;
   const generation = scopeGeneration, linkedShortcut = shortcut, linkedSteam = steam;
   const isCurrent = () => generation === scopeGeneration && steam === linkedSteam && shortcut === linkedShortcut;
   return { column, shortcutAppId: linkedShortcut, steamAppId: linkedSteam, isCurrent,
    publish: section => { if (!isCurrent()) return false; const previous = column.querySelector('#' + section.id); if (previous && previous !== section) previous.remove();
     section.dataset.gdlShortcutAppId = linkedShortcut; section.dataset.gdlSteamAppId = linkedSteam; column.append(section); return true; } };
  };
  const dependencies = {
   '../../api/backend': backend, '../../core/text': text, '../../core/disposables': disposables,
   '../../core/community-item-options': desktopService,
   '../../steam/css': { ACH_CLASSES: () => ({ HighlightDiv: 'fixture-highlight' }), resolveClassModule: () => ({ classes: { RightBreakNarrow: '884px', RightBreakWide: '1500px' } }) },
   '../../steam/localization': translation, './community-items': catalogueApi,
   './constants': { GDL_INJECTED: 'gdl-library-injected' }, './layout': { buildNativeSidebarSection: buildSection },
   './trading-card-preload': preloads, './native-card-preview': { disposeNativeCardPreview() {}, tryOpenNativeCardPreview: () => false },
   './sidebar-order': { getLinkedSidebarOrder: orderFor,
    ensureLinkedSidebarOrder: (doc, layout, owner) => orderFor(doc, layout, owner.steamAppId, owner.shortcutAppId) }, './linked-card-presentation': presentation,
  };
  dependencies['./trading-card-help'] = load('help', key => dependencies[key]);
  const cards = load('cards', key => { if (!(key in dependencies)) throw Error('Unexpected card dependency ' + key); return dependencies[key]; });
  const styles = load('styles', () => ({ injectLibraryStyle: (doc, id, css) => { if (!doc.getElementById(id)) { const style = doc.createElement('style'); style.id = id; style.textContent = css; doc.head.append(style); } } }));
  styles.ensureTradingCardStyles(document);
  const properties = load('properties', key => ({ '../../api/backend': backend, '../../core/text': text, '../../steam/localization': translation,
   '../library/community-items': catalogueApi, '../library/linked-card-presentation': presentation, '../../core/community-item-options': propertyService }[key]));
  const iframe = document.createElement('iframe'); iframe.srcdoc = '<!doctype html><body></body>';
  await new Promise(resolve => { iframe.onload = resolve; document.body.append(iframe); });
  const propertyDoc = iframe.contentDocument, propertyView = propertyDoc.defaultView;
  propertyDoc.body.innerHTML = '<section>' + properties.shortcutCommunityItemSettingsHtml() + '</section>';
  const propertyHost = propertyDoc.querySelector('section');
  const binding = properties.bindShortcutCommunityItemSettings({ section: propertyHost, shortcutAppId: () => shortcut, steamAppId: () => steam });
  const render = async () => { const generation = scopeGeneration; await cards.renderOfficialTradingCards(document, layout,
   { steamAppId: steam, shortcutAppId: shortcut, gameName: 'CSS cards fixture', isCurrent: () => generation === scopeGeneration }); await flush(); await frame(); };
  const q = selector => propertyHost.querySelector(selector);
  const change = (selector, value) => { const target = q(selector); target.value = value; target.dispatchEvent(new propertyView.Event('change', { bubbles: true })); };
  const cardNodes = () => Array.from(column.querySelectorAll('.gdl-trading-card'));
  const ownedCount = () => column.querySelectorAll('.gdl-trading-card[data-owned="true"]').length;
  await render();
  check(cardNodes().length === 2 && ownedCount() === 2, 'Disabled local overrides retain the restored colourful CSS card preview');
  check(document.getElementById('gdl-trading-card-styles') && column.querySelector('.gdl-trading-card-surface'), 'The restored CSS card section and surfaces are used');
  const stableSection = column.querySelector('#gdl-trading-cards-section');
  stableSection.remove(); await frame(); await frame();
  check(column.querySelector('#gdl-trading-cards-section') === stableSection && cardNodes().length === 2,
   'A native sidebar child replacement restores the same current owned card section without a route reload');
  stableSection.innerHTML = ''; await frame(); await frame();
  check(column.querySelector('#gdl-trading-cards-section') === stableSection && cardNodes().length === 2,
   'A native subtree replacement rebuilds the current card contents and interactions');
  q('input[data-card-id]').click(); await waitFor(() => ownedCount() === 1);
  check(writes.at(-1).shortcut_app_id === shortcut && writes.at(-1).steam_app_id === steam && ownedCount() === 1,
   'Properties writes the exact committed link and updates the other-document CSS ownership through real storage events');
  check(column.querySelector('#gdl-trading-cards-section') === stableSection, 'Confirmed selections preserve the CSS section owner instead of mounting a new section');
  check(column.querySelector('.gdl-trading-badge-title').textContent === 'Bronze badge' && !column.querySelector('.gdl-trading-badge-image')
   && column.querySelector('.gdl-trading-badge-xp').textContent.trim() === '100 XP'
   && presentation.linkedCardPresentation(catalogFor(steam), desktopService.getCachedCommunityItemOptions(document, shortcut, steam)).xp === 0,
   'An enabled card-only selection previews the next badge and future XP without an earned badge image or earned XP');
  const locked = column.querySelector('.gdl-trading-card[data-owned="false"]');
  check(locked?.classList.contains('gdl-trading-card-unowned') && getComputedStyle(locked.querySelector('img')).filter.includes('saturate(0.1)')
   && getComputedStyle(locked.querySelector('img')).opacity === '0.3', 'Only locally locked cards receive the native low saturation and opacity treatment');
  const completeCatalogue = catalogFor(steam);
  const publishCatalogue = value => { catalogues.set(steam, value); for (const listener of catalogueListeners.get(steam) || []) listener(value); };
  publishCatalogue({ ...completeCatalogue, badges: [], badges_complete: false }); await frame();
  check(column.querySelector('.gdl-trading-badge-title').textContent === 'No local badge' && ownedCount() === 1,
   'A partial badge catalogue retains the card selection and uses an unearned placeholder');
  publishCatalogue(completeCatalogue); await frame();
  check(column.querySelector('.gdl-trading-badge-title').textContent === 'Bronze badge' && ownedCount() === 1,
   'Late badge definitions refresh the next-badge caption even when card ownership, earned badge and XP are unchanged');
  const beforeEmpty = column.querySelector('#gdl-trading-cards-section');
  publishCatalogue({ ...completeCatalogue, cards: [], foil_cards: [], badges: [], foil_badge: null,
   cards_complete: false, badges_complete: false, transient_error: true }); await frame();
  check(column.querySelector('#gdl-trading-cards-section') === beforeEmpty && cardNodes().length === 2 && ownedCount() === 1,
   'An incomplete transient empty publication cannot erase the known same-collection presentation');
  publishCatalogue({ ...completeCatalogue, cards: [], foil_cards: [], badges: [], foil_badge: null }); await frame();
  check(!column.querySelector('#gdl-trading-cards-section'), 'An authoritative complete empty catalogue removes the unavailable card section');
  publishCatalogue(completeCatalogue); await frame();
  change('.gdl-community-badge', propertyService.communityBadgeId(catalogFor(steam).badges[0])); await waitFor(() => column.querySelector('.gdl-trading-badge-image')?.src.endsWith('/bronze.png')
   && column.querySelector('.gdl-trading-badge-xp').textContent.includes('100'));
  check(column.textContent.includes('Bronze badge') && ownedCount() === 1 && column.querySelector('.gdl-trading-badge-xp').textContent.includes('100'), 'An individual badge choice updates CSS title and XP without completing unrelated cards');
  change('.gdl-community-card-border', 'foil'); await waitFor(() => cardNodes().every(node => node.classList.contains('gdl-foil-card')));
  check(cardNodes().length === 2 && ownedCount() === 0 && cardNodes().every(node => node.classList.contains('gdl-foil-card')), 'Switching to foil renders its separate silver collection and clears the previous normal badge');
  q('input[data-card-id]').click(); await waitFor(() => ownedCount() === 1);
  check(ownedCount() === 1 && column.querySelector('[data-owned="true"]').dataset.gdlCommunityCardId === propertyService.communityCardId(catalogFor(steam).foil_cards[0]), 'A Properties foil selection colours only the exact stable foil ID in the CSS section');
  change('.gdl-community-badge', propertyService.communityBadgeId(catalogFor(steam).badges[2])); await waitFor(() => column.textContent.includes('Silver badge') && ownedCount() === 2);
  check(column.textContent.includes('Silver badge') && ownedCount() === 2, 'A selected foil badge completes and displays its foil CSS collection');
  const savedA = JSON.stringify(persistent.get(shortcut + ':' + steam));
  cards.disposeTradingCardUI(document); shortcut = '3000000092'; scopeGeneration++; binding.sync(); await render();
  check(cardNodes().length === 2 && cardNodes().every(node => !node.classList.contains('gdl-foil-card')) && !desktopService.getCachedCommunityItemOptions(document, shortcut, steam).enabled,
   'Another linked shortcut with the same Steam AppID restores its own normal defaults without inheriting foil choices');
  cards.disposeTradingCardUI(document); shortcut = '3000000091'; scopeGeneration++; binding.sync(); await render();
  check(cardNodes().every(node => node.classList.contains('gdl-foil-card')) && ownedCount() === 2 && JSON.stringify(persistent.get(shortcut + ':' + steam)) === savedA,
   'Returning to the original pair restores its persisted foil cards and badge');
  cards.disposeTradingCardUI(document); steam = '881'; scopeGeneration++; binding.sync(); await render();
  check(cardNodes().length === 2 && cardNodes().every(node => node.dataset.gdlCommunityCardId.includes('881-normal-')) && !desktopService.getCachedCommunityItemOptions(document, shortcut, steam).enabled,
   'Relinking to another Steam AppID retires the old CSS scope and loads independent settings');
  q('input[data-card-id]').click(); await waitFor(() => ownedCount() === 1);
  q('.gdl-community-real').click(); await waitFor(() => ownedCount() === 2);
  check(!persistent.get(shortcut + ':' + steam).enabled && cardNodes().every(node => !node.classList.contains('gdl-trading-card-unowned')), 'Use Steam data removes local grayscale and restores the previous CSS preview');

  // A missing scope is automatic foil, while its first explicit edit becomes
  // a concrete manual selection shared with the independent desktop runtime.
  cards.disposeTradingCardUI(document); steam = '882'; scopeGeneration++; binding.sync(); const beforeAutomatic = writes.length; await render();
  check(cardNodes().length === 2 && cardNodes().every(node => node.classList.contains('gdl-foil-card')) && ownedCount() === 2
   && q('.gdl-community-card-summary').textContent.startsWith('2 of 2') && column.querySelector('.gdl-trading-badge-image')?.src.endsWith('/silver.png'),
   'Missing preferences select all foil cards and the foil badge consistently in Properties and the CSS section');
  check(!persistent.has(shortcut + ':' + steam) && writes.length === beforeAutomatic && desktopService.getCachedCommunityItemOptions(document, shortcut, steam).auto_foil === true,
   'The automatic default is derived from catalogue data without persisting a generated selection');
  q('input[data-card-id]').click(); await waitFor(() => ownedCount() === 1);
  check(ownedCount() === 1 && writes.at(-1).auto_foil === undefined && writes.at(-1).badge_id === null && writes.at(-1).card_ids.length === 1,
   'The first foil lock materializes exact owned IDs, removes the foil badge and disables automatic changes across documents');
  const enriched = { ...catalogFor(steam), foil_cards: [...catalogFor(steam).foil_cards,
   { title: 'Foil late', foil: true, image: 'https://community.steamstatic.com/economy/image/882-foil-late' }] };
  catalogues.set(steam, enriched); const beforeEnrichment = writes.length;
  for (const listener of catalogueListeners.get(steam) || []) listener(enriched); await waitFor(() => cardNodes().length === 3);
  check(cardNodes().length === 3 && ownedCount() === 1 && writes.length === beforeEnrichment && q('.gdl-community-card-summary').textContent.startsWith('1 of 3'),
   'Late foil definitions preserve a manual first edit and never restore the automatic preset');

  cards.disposeTradingCardUI(document); steam = '883'; scopeGeneration++; binding.sync(); await render();
  q('.gdl-community-real').click(); await waitFor(() => cardNodes().every(node => !node.classList.contains('gdl-foil-card')));
  check(persistent.get(shortcut + ':' + steam).enabled === false && persistent.get(shortcut + ':' + steam).auto_foil === undefined
   && cardNodes().length === 2 && cardNodes().every(node => !node.classList.contains('gdl-foil-card')),
   'Use Steam data explicitly opts out of a missing-scope automatic foil preset');

  cards.disposeTradingCardUI(document); steam = '884'; scopeGeneration++;
  const eventual = catalogFor(steam), partial = { ...eventual, foil_cards: [], badges: [], cards_complete: false, badges_complete: false, loading: true };
  catalogues.set(steam, partial); binding.sync(); const beforePending = writes.length; await render();
  check(!cardNodes().length && q('.gdl-community-card-border').value === 'foil' && q('.gdl-community-badge').value === '__gdl-auto-foil__'
   && writes.length === beforePending, 'A partial normal-only catalogue keeps automatic foil pending without painting normal cards or saving empty definitions');
  catalogues.set(steam, eventual); for (const listener of catalogueListeners.get(steam) || []) listener(eventual);
  await waitFor(() => cardNodes().length === 2 && ownedCount() === 2);
  check(cardNodes().every(node => node.classList.contains('gdl-foil-card')) && q('.gdl-community-card-summary').textContent.startsWith('2 of 2')
   && writes.length === beforePending, 'An untouched pending automatic preset renders all arriving foil cards without writing preferences');

  // A cold PC has no browser cache. Its backend-confirmed custom selection
  // must arrive before any automatic or normal preview is painted.
  cards.disposeTradingCardUI(document); steam = '885'; scopeGeneration++;
  const coldCatalog = catalogFor(steam), coldSaved = { enabled: true, card_border: 'normal', card_ids: [propertyService.communityCardId(coldCatalog.cards[1])], badge_id: null };
  persistent.set(shortcut + ':' + steam, coldSaved); readGate = deferred(); binding.sync();
  await cards.renderOfficialTradingCards(document, layout, { steamAppId: steam, shortcutAppId: shortcut, gameName: 'Cold custom fixture', isCurrent: () => true }); await flush();
  check(!cardNodes().length, 'A deferred authoritative settings read never paints the new automatic default over a cold saved normal selection');
  const gate = readGate; readGate = null; gate.resolve(JSON.stringify({ ok: true, ...coldSaved })); await waitFor(() => cardNodes().length === 2);
  check(cardNodes().every(node => !node.classList.contains('gdl-foil-card')) && ownedCount() === 1
   && column.querySelector('[data-owned="true"]').dataset.gdlCommunityCardId === coldSaved.card_ids[0],
   'The cold custom normal selection paints its exact ownership after the deferred backend confirmation');

  cards.disposeTradingCardUI(document); steam = '886'; scopeGeneration++;
  const retrySaved = { ...coldSaved, card_ids: [propertyService.communityCardId(catalogFor(steam).cards[1])] };
  persistent.set(shortcut + ':' + steam, retrySaved); readFailure = true; binding.sync(); await render();
  check(!cardNodes().length, 'An initial settings IPC failure leaves the CSS preview pending instead of inventing automatic ownership');
  readFailure = false; await render(); await waitFor(() => cardNodes().length === 2);
  check(cardNodes().length === 2 && cardNodes().every(node => !node.classList.contains('gdl-foil-card')) && ownedCount() === 1
   && column.querySelector('[data-owned="true"]').dataset.gdlCommunityCardId === retrySaved.card_ids[0],
   'A foreground CSS render retries a failed settings read and recovers the confirmed custom collection');
  cards.disposeTradingCardUI(document); steam = '887'; scopeGeneration++;
  const hungSaved = { ...coldSaved, card_ids: [propertyService.communityCardId(catalogFor(steam).cards[1])] };
  persistent.set(shortcut + ':' + steam, hungSaved); readGate = deferred(); binding.sync(); await render();
  await waitFor(() => column.querySelector('.gdl-trading-cards-retry'));
  check(!cardNodes().length && column.querySelector('.gdl-trading-cards-status')?.textContent.includes('Could not load the saved selection'),
   'A hung authoritative IPC becomes a visible recoverable selection error without inventing foil ownership');
  const timedOutRead = readGate; readGate = null;
  column.querySelector('.gdl-trading-cards-retry').click(); await waitFor(() => cardNodes().length === 2);
  check(cardNodes().every(node => !node.classList.contains('gdl-foil-card')) && ownedCount() === 1,
   'The sidebar Retry starts a fresh settings read after its deadline and restores the saved manual collection');
  timedOutRead.resolve(JSON.stringify({ ok: true, ...automatic() })); await flush(); await frame();
  check(cardNodes().every(node => !node.classList.contains('gdl-foil-card')) && ownedCount() === 1,
   'The expired IPC response cannot replace the successful retry with automatic ownership');
  const foregroundCatalog = catalogFor(steam);
  catalogues.set(steam, { ...foregroundCatalog, cards: foregroundCatalog.cards.map(card => ({ ...card, title: 'Foreground recovery ' + card.title })) });
  await render();
  check(cardNodes().every(node => node.getAttribute('aria-label').startsWith('Foreground recovery')) && ownedCount() === 1,
   'A same-game foreground visit probes sources that initialized after the first request without losing saved ownership');
  const beforeLanguage = column.querySelector('#gdl-trading-cards-section');
  const beforeLanguageListeners = [...catalogueListeners.values()].reduce((sum, set) => sum + set.size, 0);
  language = 'spanish'; check(cards.refreshTradingCardUI(document), 'A mounted sidebar can refresh its language without rebuilding the activity feed'); await flush(); await frame();
  check(column.querySelector('#gdl-trading-cards-section') !== beforeLanguage && cardNodes().length === 2
   && [...catalogueListeners.values()].reduce((sum, set) => sum + set.size, 0) === beforeLanguageListeners,
   'A language change renews the catalogue subscription and releases the previous binding');
  const beforeRenewal = column.querySelector('#gdl-trading-cards-section'); scopeGeneration++;
  const renewal = scopeGeneration;
  check(cards.refreshTradingCardUI(document, { steamAppId: steam, shortcutAppId: shortcut, generation: renewal,
   isCurrent: () => scopeGeneration === renewal }), 'A fresh same-route owner renews a retired sidebar lease'); await flush(); await frame();
  check(column.querySelector('#gdl-trading-cards-section') === beforeRenewal && cardNodes().length === 2,
   'A same-game route generation renewal preserves the current card section and ownership');
  const retiredSection = column.querySelector('#gdl-trading-cards-section'); scopeGeneration++; retiredSection.remove(); await frame(); await frame();
  check(!column.querySelector('#gdl-trading-cards-section'), 'A retired route or unlinked owner cannot resurrect a removed card section');
  column.remove();
  check(!cards.refreshTradingCardUI(document, { steamAppId: steam, shortcutAppId: shortcut, generation: scopeGeneration,
   isCurrent: () => true }), 'A replaced native column requests full layout discovery instead of refreshing the detached sidebar');
  binding.dispose(); iframe.remove(); cards.disposeTradingCardUI(document);
  check(!column.querySelector('#gdl-trading-cards-section') && [...catalogueListeners.values()].every(set => set.size === 0), 'Properties and CSS disposal release their catalogues and remove the owned card section');
  return { checks, writes: writes.length };
 }, sources);
 assert(result.checks >= 28);
 console.log(`CSS card selection browser passed: ${result.checks} checks; automatic foil, first edits, cold settings recovery, Properties, cross-CEF CSS updates, badges, scopes and cleanup.`);
} finally { await browser.close(); }
