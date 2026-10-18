import './helpers/installed-steam-check.mjs';
import { runBPBrowserScenario } from './check-bp-achievements-workflow-browser.mjs';

await runBPBrowserScenario({}, async fixture => {
  const { load, root, A, frame, check, nativeRequire } = fixture;
  document.documentElement.style.setProperty('--basicui-header-height', '56px');
  document.documentElement.style.setProperty('--gamepadui-current-footer-height', '48px');
  const data = { found: true, appid: '550', metadata_appid: '550', total: 50, unlocked: 5,
    achievements: Array.from({ length: 50 }, (_, index) => ({ name: `ACH_${index}`,
      display_name: `Achievement ${index}`, description: `Description ${index}`, icon: '', icon_gray: '',
      hidden: index === 49, earned: index < 5, earned_time: index < 5 ? 1000 + index : 0,
      progress: 1, max_progress: 5, global_percent: 95 - index, global_percent_known: true })) };
  const shortcut = { id: A, title: 'Linked game', steamAppId: '550' };
  load('cache').cacheLocalAchievements(data, '550', String(A));
  let nativeFocusRequests = 0;
  document.addEventListener('vgp_requestfocus', () => nativeFocusRequests++);
  const before = root.outerHTML;
  check(load('screen').openBigPictureAchievementsScreen(document, shortcut, data, shortcut.title, 'ACH_35'), 'The owned full-screen achievement view opens');
  await frame(); await frame();
  const modal = document.getElementById('gdl-bp-achievements-screen');
  const rect = modal.getBoundingClientRect();
  check(rect.left === 0 && rect.top === 56 && rect.width === innerWidth && rect.bottom === innerHeight - 48,
    'The screen fills exactly the native header/footer safe area, rather than a centered dialog');
  const header = modal.querySelector('.gdl-bp-ach-head');
  const portrait = modal.querySelector('.gdl-bp-ach-portrait'), portraitRect = portrait.getBoundingClientRect();
  check(portrait.src.includes(String(A)) && !portrait.src.includes('/550'), 'The cover belongs to the linked shortcut artwork');
  check(Math.abs(portraitRect.width - 145) < 1 && Math.abs(portraitRect.height / portraitRect.width - 1.5) < .01,
    'The installed native 145px portrait and 2:3 proportions are preserved');
  check(portraitRect.left === 24 && portraitRect.top === 80, 'Native header padding positions the cover below Steam chrome');
  const h = nativeRequire(83097);
  const title = header.querySelector(`.${h.Title}`).getBoundingClientRect();
  check(title.left >= portraitRect.right + 13 && title.right <= rect.right - 24 && title.width > 600,
    'Game title sits beside the portrait at the native gap without overlap');
  const stats = header.querySelector(`.${h.StatsBlock}`), bigStat = stats.querySelector(`.${h.BigStat}`);
  check(bigStat.querySelector(`.${h.StatLabelAndValue} > .${h.ProgressLabel}`)
    && bigStat.querySelector(`.${h.StatLabelAndValue} > .${h.Progress}`), 'Native nested label/progress structure is preserved');
  const times = [...header.querySelectorAll('[data-gdl-achievement-playtime]')];
  check(times.length === 2 && times[0].textContent.includes('34.3 h') && times[1].textContent.includes('1 min'),
    'Total and recent playtime display the real shortcut snapshot');
  const bigRect = bigStat.getBoundingClientRect(), timeRect = times[0].getBoundingClientRect();
  check(bigRect.right <= timeRect.left && bigRect.width > stats.getBoundingClientRect().width / 2,
    'Completion takes remaining native space while playtime statistics stay separate');
  const list = modal.querySelector('.gdl-bp-ach-scroll'), listRect = list.getBoundingClientRect();
  check(listRect.top > header.getBoundingClientRect().bottom && listRect.bottom <= rect.bottom + 1 && listRect.height > 200,
    'Achievement scrolling is confined below the header and tabs');
  const selected = modal.querySelector('[data-gdl-achievement-name="ACH_35"]');
  check(document.activeElement === selected && nativeFocusRequests > 0, 'Opening one achievement requests its exact Steam focus node');
  const selectedRect = selected.getBoundingClientRect();
  check(selectedRect.top >= listRect.top - 1 && selectedRect.bottom <= listRect.bottom + 1, 'The selected achievement is scrolled into view');
  check(Math.abs(selectedRect.height - 80) < 1, 'Personal rows use the installed native 80px height without an extra wrapper height');
  check(getComputedStyle(selected.querySelector('img')).filter === 'grayscale(1)',
    'A locked personal achievement is gray even when its metadata image is not desaturated');
  check(modal.textContent.includes('Locked achievements') && modal.querySelector('[data-gdl-achievements-hidden]')
    && !modal.querySelector('[data-gdl-achievement-name="ACH_49"]'), 'Locked title and concealed aggregate follow native personal grouping');
  const global = modal.querySelector('[data-gdl-achievement-tab="global"]'); global.click(); await frame();
  const globalRow = modal.querySelector('[data-gdl-achievement-name]');
  check(Math.abs(globalRow.getBoundingClientRect().height - 68) < 1, 'Global rows use the installed native 68px height');
  check(!globalRow.hasAttribute('data-gdl-personal-locked') && getComputedStyle(globalRow.querySelector('img')).filter === 'none',
    'Global achievement images keep their native color and are not affected by personal locked styling');
  const hidden = modal.querySelector('[data-gdl-achievement-name="ACH_49"]'); hidden.click(); await frame();
  check(modal.textContent.includes('Achievement 49'), 'A hidden global row reveals individually');
  load('owned').disposeBigPictureModals(document); await frame();
  check(!document.getElementById('gdl-bp-achievements-screen') && root.outerHTML === before,
    'Closing restores the untouched linked-detail mount');
  const runtime = fixture.dependencies['../../steam/modules/SteamWebpackRuntime'].steamWebpackRuntime;
  const relocated = new Map([[90001, 18980], [90002, 83097], [90003, 62645], [90004, 19579], [90005, 36000], [90006, 3270], [90007, 24124]]);
  const unsafeFactory = () => { throw Error('Unrelated factory must never run'); };
  const requested = [];
  const currentRequire = id => { requested.push(Number(id));
    if (!relocated.has(Number(id))) throw Error('Unrelated module was requested');
    return fixture.nativeRequire(relocated.get(Number(id))); };
  currentRequire.m = Object.fromEntries([...relocated].map(([id, old]) => [id, fixture.nativeRegistry[old]]));
  for (const old of relocated.values()) currentRequire.m[old] = unsafeFactory;
  runtime.getRequire = () => currentRequire; runtime.getRuntimeIdentity = () => currentRequire;
  runtime.getModuleFactories = () => Object.entries(currentRequire.m).map(([id, factory]) => ({ id, factory }));
  const resolved = load('achievement-screen-parts').resolveBigPictureAchievementScreenParts(document);
  check(resolved.PersonalRow === nativeRequire(36000).fm && resolved.ComparisonRow === nativeRequire(36000).ui
    && resolved.Search === nativeRequire(24124).zp, 'Presentation exports resolve by their contract after every numeric module ID moves');
  check(resolved.header.Container === h.Container && resolved.row.AchievementListItemBase === nativeRequire(18980).AchievementListItemBase
    && resolved.page.HeaderContainer === nativeRequire(19579).HeaderContainer, 'Pure installed styles resolve semantically without running factories');
  check(requested.length === 3 && requested.every(id => relocated.has(id)), 'Discovery executes only the three proved presentation modules and never stale numeric IDs');
  load('achievement-screen-parts').resolveBigPictureAchievementScreenParts(document);
  check(requested.length === 3, 'The same document/runtime generation reuses its resolved screen parts');
  return { label: 'Big Picture achievement full-screen layout', checks: fixture.checks(), modalMounts: fixture.modalMounts(), react: fixture.React.version };
});
