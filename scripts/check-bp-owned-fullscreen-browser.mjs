import { runBPBrowserScenario } from './check-bp-achievements-workflow-browser.mjs';

await runBPBrowserScenario({}, async fixture => {
  const { React, load, client, dependencies, root, frame, check } = fixture;
  const query = React.createContext(null), history = React.createContext(null), service = React.createContext(null), account = React.createContext(null);
  const navContext = React.createContext('none');
  const values = [{ kind: 'query-client', context: query, value: { cache: 'owner-query' } },
    { kind: 'router-history', context: history, value: { history: 'owner-history' } },
    { kind: 'service-transport', context: service, value: { transport: 'owner-transport' } },
    { kind: 'active-account', context: account, value: { account: 'owner-account' } },
    { kind: 'active-tree', context: navContext, value: 'details-tree-must-not-cross' }];
  dependencies['../../steam/gamepad/components/AppDetailsNativeComponents'] = {
    ...dependencies['../../steam/gamepad/components/AppDetailsNativeComponents'], resolveSteamNav: () => ({ providers: values }),
  };
  document.documentElement.style.setProperty('--basicui-header-height', '52px');
  document.documentElement.style.setProperty('--gamepadui-current-footer-height', '48px');
  const header = document.createElement('header'), footer = document.createElement('footer');
  header.id = 'native-header'; footer.id = 'native-footer';
  header.style.cssText = 'position:fixed;top:0;height:52px;width:100%';
  footer.style.cssText = 'position:fixed;bottom:0;height:48px;width:100%';
  header.textContent = 'Steam status'; footer.textContent = 'Steam Back'; document.body.append(header, footer);
  const beforeHeader = header.outerHTML, beforeFooter = footer.outerHTML;
  const modalProps = [];
  client.ModalRoot = props => {
    modalProps.push(props);
    return React.createElement(navContext.Provider, { value: 'native-modal-tree' },
      React.createElement('div', { className: `ModalPosition ${props.modalClassName || ''}` },
        React.createElement('div', { className: 'ModalPosition_Content' },
          React.createElement('div', { className: props.className,
            onKeyDown: event => { if (event.key === 'Escape') props.onCancel(); } },
            React.createElement('div', { className: 'DialogContent_InnerWidth' },
              React.createElement('form', { role: 'dialog', 'aria-modal': true }, props.children))))));
  };
  const nav = load('navigation'), owned = load('owned');
  const tabs = document.getElementById('tabs');
  const trigger = document.createElement('button'); trigger.textContent = 'Open achievements'; root.appendChild(trigger);
  nav.installBigPictureGamepadNavigation(document, root, tabs, new Map([['stuff', tabs.firstElementChild]]), { authority: 'fallback', generation: 1 });
  const baseline = fixture.observerCount();
  let actualProviders, closeModal;
  function Contents() {
    actualProviders = { query: React.useContext(query), history: React.useContext(history), service: React.useContext(service),
      account: React.useContext(account), nav: React.useContext(navContext) };
    return React.createElement('button', { onClick: () => closeModal(), style: { width: '100%', height: 40 } }, 'Back');
  }
  const open = fullScreen => owned.showBigPictureModal(document, 'gdl-bp-achievements-screen', 'Achievements', close => {
    closeModal = close; return React.createElement(Contents);
  }, { fullScreen });
  trigger.focus(); check(open(true), 'The full-screen request opens through the existing native modal lifecycle'); await frame();
  const screen = document.getElementById('gdl-bp-achievements-screen'), bounds = screen.getBoundingClientRect();
  check(bounds.left === 0 && bounds.width === innerWidth && bounds.top === 52 && bounds.bottom === innerHeight - 48,
    'Full-screen content fills the viewport between the exact native header and footer variables');
  check(actualProviders.query === values[0].value && actualProviders.history === values[1].value
    && actualProviders.service === values[2].value && actualProviders.account === values[3].value,
    'Native content receives the committed owner query, router, service and account providers by identity');
  check(actualProviders.nav === 'native-modal-tree', 'The modal keeps its own native navigation tree instead of inheriting the background details tree');
  check(modalProps.at(-1).bHideCloseIcon && typeof modalProps.at(-1).onCancel === 'function', 'Full-screen removes only the desktop close icon while retaining native cancel');
  check(header.outerHTML === beforeHeader && footer.outerHTML === beforeFooter, 'Native header and footer markup remain unchanged');
  check(fixture.observerCount() === baseline + 2, 'Full-screen adds no observers beyond the existing owned modal lifecycle');
  screen.querySelector('button').focus();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await frame();
  check(!document.getElementById('gdl-bp-achievements-screen') && document.activeElement === trigger,
    'Back closes the native handle and restores the exact achievement opener');
  check(!document.querySelector('[data-gdl-bp-fullscreen-styles]') && fixture.observerCount() === baseline,
    'Closing removes every instance-specific full-screen rule and modal observer');
  trigger.focus(); check(open(false), 'Ordinary owned dialogs still open without the full-screen option'); await frame();
  check(!document.querySelector('[data-gdl-bp-fullscreen]') && !modalProps.at(-1).modalClassName
    && !modalProps.at(-1).bHideCloseIcon, 'Default media/dialog props and dimensions remain untouched');
  closeModal(); await frame();
  for (let cycle = 0; cycle < 10; cycle++) { trigger.focus(); open(true); closeModal(); }
  await frame(); check(!document.querySelector('.fixture-modal') && !document.querySelector('[data-gdl-bp-fullscreen-styles]')
    && fixture.observerCount() === baseline, 'Repeated full-screen open/close cycles leave no rule, backdrop or observer leaks');
  trigger.focus(); open(true); await frame();
  root.dataset.gdlBpGeneration = '2'; root.appendChild(document.createElement('i')); await frame();
  check(!document.getElementById('gdl-bp-achievements-screen') && fixture.observerCount() === baseline,
    'A retired detail generation closes its full-screen modal and cleans its style rules');
  owned.disposeBigPictureModals(document); nav.disposeBigPictureGamepadNavigation(document);
  return { label: 'Big Picture owned full-screen modal', checks: fixture.checks(), modalMounts: fixture.modalMounts(), react: React.version };
});
