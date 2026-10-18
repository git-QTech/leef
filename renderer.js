const ipcRenderer = window.require ? window.require('electron').ipcRenderer : null;
if (typeof window.leefAPI === 'undefined' && ipcRenderer) {
  window.leefAPI = {
    ipc: {
      send: (channel, ...args) => ipcRenderer.send(channel, ...args),
      on: (channel, callback) => {
        const sub = (event, ...args) => callback(event, ...args);
        ipcRenderer.on(channel, sub);
        return () => ipcRenderer.removeListener(channel, sub);
      },
      invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
      sendSync: (channel, ...args) => ipcRenderer.sendSync(channel, ...args)
    }
  };
}

let TRANSLATIONS = {};

// Perf: Cache language at module level — avoids localStorage read + JSON.parse on every t() call.
let _cachedLang = 'en';
window.refreshLang = function () {
  try {
    const s = localStorage.getItem('leef_settings');
    if (s) _cachedLang = JSON.parse(s).language || 'en';
  } catch (e) { }
  if (window.i18n && window.i18n.refreshLang) {
    window.i18n.refreshLang();
  }
  return _cachedLang;
};
window.refreshLang();

window.t = function (key, params, lang) {
  if (window.i18n && window.i18n.t) {
    return window.i18n.t(key, params, lang || _cachedLang);
  }
  const curLang = lang || _cachedLang || 'en';
  if (curLang !== 'en' && TRANSLATIONS && TRANSLATIONS[curLang] && TRANSLATIONS[curLang][key]) {
    let res = TRANSLATIONS[curLang][key];
    if (params && typeof params === 'object') {
      for (const [k, v] of Object.entries(params)) {
        res = res.replaceAll('{' + k + '}', v);
      }
    }
    return res;
  }
  if (TRANSLATIONS && TRANSLATIONS.en && TRANSLATIONS.en[key]) {
    let res = TRANSLATIONS.en[key];
    if (params && typeof params === 'object') {
      for (const [k, v] of Object.entries(params)) {
        res = res.replaceAll('{' + k + '}', v);
      }
    }
    return res;
  }
  return key;
};

async function loadTranslations() {
  try {
    const module = await import('./translations.js');
    TRANSLATIONS = module.TRANSLATIONS || {};
    if (module.default) {
      window.i18n = module.default;
      window.t = (key, params, lang) => module.default.t(key, params, lang);
    }
  } catch (e) {
    console.error("Failed to load translations dynamically", e);
  }
}
loadTranslations();

function relaunchBrowser() {
  try {
    const ipc = window.require('electron').ipcRenderer;
    ipc.send('relaunch-app');
  } catch (e) {
    console.warn('IPC relaunch-app failed, falling back to reload', e);
    window.location.reload();
  }
}
window.relaunchBrowser = relaunchBrowser;

let APP_VERSION = '1.0.0'; // Fallback

function initVersion() {
  // Use already-running main process instead of re-fetching package.json from disk
  try {
    const ver = window.require('electron').ipcRenderer.sendSync('get-app-version');
    if (ver) APP_VERSION = ver;
  } catch (e) {
    console.warn('Failed to get version via IPC:', e);
  }
  window.APP_VERSION = APP_VERSION;
  document.querySelectorAll('.leef-version-val').forEach(el => {
    el.textContent = APP_VERSION;
  });
}

initVersion();

// Inject OS-specific class for CSS styling (e.g., macOS traffic lights)
if (process.platform === 'darwin') {
  document.body.classList.add('mac-os');
} else if (process.platform === 'linux') {
  document.body.classList.add('linux-os');
} else if (process.platform === 'win32') {
  document.body.classList.add('win-os');
}

// --- UTILITIES ---
class BrowserUtils {
  static parseAddress(str, engineBaseUrl, blockAI = 'deep') {
    str = str.trim();
    const domainPattern = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:\/.*)?$/;
    if (!str.includes(' ') && (domainPattern.test(str) || str.startsWith('http://') || str.startsWith('https://') || str.startsWith('localhost:'))) {
      if (!str.startsWith('http://') && !str.startsWith('https://')) return 'https://' + str;
      return str;
    }

    let url = engineBaseUrl + encodeURIComponent(str);
    const isGoogle = engineBaseUrl.includes('google.com/search') || engineBaseUrl.includes('google.co.');
    const isDeep = blockAI === 'deep' || blockAI === true;
    if (isGoogle && isDeep && !url.includes('udm=14')) {
      url += '&udm=14';
    }
    return url;
  }

  // Sanitize untrusted strings before inserting into the DOM
  static sanitize(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
}

// --- DOM REFERENCES ---
const UI = {
  views: {
    home: document.getElementById('home-view'),
    settings: document.getElementById('settings-view'),
    changelog: document.getElementById('changelog-view'),
    credits: document.getElementById('credits-view'),
    webviewsContainer: document.getElementById('webviews-container')
  },
  tabsContainer: document.getElementById('tabs-container'),
  inputs: {
    address: document.getElementById('address-input'),
    searchEngine: document.getElementById('search-engine-select')
  },
  buttons: {
    newTab: document.getElementById('btn-new-tab'),
    back: document.getElementById('btn-back'),
    forward: document.getElementById('btn-forward'),
    refresh: document.getElementById('btn-refresh'),
    settings: document.getElementById('btn-settings'),
    clearData: document.getElementById('btn-clear-data'),
    defaultBrowser: document.getElementById('btn-default-browser'),
    whatsNew: document.getElementById('btn-whats-new'),
    credits: document.getElementById('btn-credits')
  }
};

// --- MANAGERS ---

class SettingsManager {
  constructor() {
    this.defaultSettings = {
      searchEngine: 'https://www.google.com/search?q=',
      startup: 'newtab',
      language: 'en',
      zoom: '1.0',
      fontSize: 'medium',
      tracking: 'standard',
      httpsOnly: true,
      adBlockerMode: 'none', // none, basic, comprehensive
      backgroundLimit: false,
      allowNotifications: true,
      askDownload: false,
      blockAIOverview: 'deep', // 'deep', 'hide', 'off'
      nativeDictionary: true,
      autoCheckUpdates: true,
      customUa: '',
      dohToggle: true,
      proxyUrl: '',
      liveAutocomplete: false,
      enableVolumeBoost: false,
      gpc: true,
      newsProvider: 'bbc',
      newsManualRefresh: false,
      hideSportsUntilNearStart: false,
      efficiencyMode: false,
      cpuLimit: 100,
      ramLimit: 0,
      customNewTab: 'home',
      greetingName: '',
      timezone: 'auto',
      sitePermissions: {},
      newsWordFilters: [],
      followedTeams: [],
      quickLinksStr: "youtube.com\ngoogle.com\nwikipedia.org\ntwitter.com\nreddit.com\namazon.com\nnetflix.com\ndiscord.com\nfacebook.com\ntwitch.tv\ngithub.com"
    };
    // Load previously saved settings and merge with defaults
    this.currentSettings = this.loadSavedSettings();
    this.sessionInitialLanguage = this.currentSettings.language || 'en';
    this.bindEvents();
    // Sync form elements to loaded values once DOM is ready
    this.syncUIToSettings();
    // Apply to main process immediately on startup
    this.sendSettingsToMain();
  }

  loadSavedSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem('leef_settings') || '{}');

      // Normalize legacy boolean blockAIOverview to tiered mode
      if (saved.blockAIOverview === true || saved.blockAIOverview === 'true') {
        saved.blockAIOverview = 'deep';
      } else if (saved.blockAIOverview === false || saved.blockAIOverview === 'false') {
        saved.blockAIOverview = 'off';
      } else if (saved.blockAIOverview && saved.blockAIOverview !== 'deep' && saved.blockAIOverview !== 'hide' && saved.blockAIOverview !== 'off') {
        saved.blockAIOverview = 'deep';
      }

      // Fallback: If saved language is not supported anymore, default to en
      const supported = ['en', 'en-gb', 'en-ca', 'fr', 'es', 'nl', 'de'];
      if (saved.language && !supported.includes(saved.language)) {
        saved.language = 'en';
      }

      return { ...this.defaultSettings, ...saved };
    } catch (e) {
      return { ...this.defaultSettings };
    }
  }

  applyLocalization() {
    const lang = this.currentSettings.language || 'en';

    if (window.i18n && window.i18n.applyLocalization) {
      window.i18n.applyLocalization(document, lang);
    } else {
      // First translate any elements with data-i18n attributes
      const i18nElements = document.querySelectorAll('[data-i18n]');
      i18nElements.forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (!el.hasAttribute('data-original-html')) {
          el.setAttribute('data-original-html', el.innerHTML.trim());
        }
        el.innerHTML = window.t ? window.t(key, null, lang) : (el.getAttribute('data-original-html') || key);
      });
    }

    // Re-inject dynamic version string
    document.querySelectorAll('.leef-version-val').forEach(el => {
      el.textContent = APP_VERSION;
    });

    // Translate dynamic placeholders
    const addressInput = document.getElementById('address-input');
    if (addressInput) addressInput.placeholder = window.t("Search or enter web address");

    const homeSearchInput = document.getElementById('home-search');
    if (homeSearchInput) homeSearchInput.placeholder = window.t("Search or enter a URL...");

    const settingsSearchInput = document.getElementById('settings-search');
    if (settingsSearchInput) settingsSearchInput.placeholder = window.t("Search settings...");

    const findInput = document.getElementById('find-input');
    if (findInput) findInput.placeholder = window.t("Find in page...");

    const qlInput = document.getElementById('quick-links-input');
    if (qlInput) qlInput.placeholder = window.t('e.g. "youtube.com"');

    const newsFilterInput = document.getElementById('news-word-filter-input');
    if (newsFilterInput) newsFilterInput.placeholder = window.t('e.g. "trump", "crypto"…');
  }

  syncLanguageDropdowns() {
    const supported = (typeof SUPPORTED_LANGUAGES !== 'undefined' ? SUPPORTED_LANGUAGES : (window.SUPPORTED_LANGUAGES || []));
    if (!Array.isArray(supported) || supported.length === 0) return;

    ['language-select', 'onboard-language'].forEach(id => {
      const select = document.getElementById(id);
      if (!select) return;
      const existingValues = new Set(Array.from(select.options).map(o => o.value));
      supported.forEach(item => {
        if (item.code && item.code !== 'common' && !existingValues.has(item.code)) {
          const opt = document.createElement('option');
          opt.value = item.code;
          opt.textContent = item.name || item.code;
          select.appendChild(opt);
          existingValues.add(item.code);
        }
      });
    });
  }

  syncUIToSettings() {
    this.syncLanguageDropdowns();
    const s = this.currentSettings;
    const el = id => document.getElementById(id);
    if (el('search-engine-select')) el('search-engine-select').value = s.searchEngine;
    if (el('search-engine-select-browsing')) el('search-engine-select-browsing').value = s.searchEngine;
    if (el('language-select')) {
      el('language-select').value = s.language || 'en';
      // If still empty (e.g. value not in list), force to 'en'
      if (!el('language-select').value) el('language-select').value = 'en';
    }
    if (el('zoom-select')) el('zoom-select').value = s.zoom;
    if (el('font-size-select')) el('font-size-select').value = s.fontSize;
    if (el('https-only')) el('https-only').checked = s.httpsOnly;
    if (el('auto-check-updates')) el('auto-check-updates').checked = s.autoCheckUpdates;
    document.querySelectorAll(`input[name="adblock-tier"]`).forEach(r => { r.checked = r.value === (s.adBlockerMode || 'none'); });
    if (el('background-limit')) el('background-limit').checked = s.backgroundLimit;
    if (document.getElementById('enable-volume-boost')) document.getElementById('enable-volume-boost').checked = s.enableVolumeBoost;
    if (document.getElementById('news-manual-refresh')) document.getElementById('news-manual-refresh').checked = s.newsManualRefresh;
    if (document.getElementById('news-provider-select')) document.getElementById('news-provider-select').value = s.newsProvider || 'bbc';
    if (document.getElementById('hide-sports-until-near-start')) document.getElementById('hide-sports-until-near-start').checked = !!s.hideSportsUntilNearStart;
    if (el('custom-greeting-name')) el('custom-greeting-name').value = s.greetingName || '';
    if (el('hub-timezone-select')) {
      const tzSelect = el('hub-timezone-select');
      // Populate timezones once if needed
      if (tzSelect.options.length <= 1) {
        let zones = [];
        if (typeof Intl !== 'undefined' && Intl.supportedValuesOf) {
          try {
            zones = Intl.supportedValuesOf('timeZone');
          } catch (e) { }
        }
        if (!zones || zones.length === 0) {
          zones = [
            'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
            'America/Anchorage', 'America/Honolulu', 'America/Toronto', 'America/Vancouver',
            'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Rome', 'Europe/Madrid',
            'Europe/Amsterdam', 'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Singapore', 'Asia/Kolkata',
            'Asia/Dubai', 'Australia/Sydney', 'Australia/Melbourne', 'Pacific/Auckland'
          ];
        }
        zones.forEach(tz => {
          const opt = document.createElement('option');
          opt.value = tz;
          opt.textContent = tz.replace(/_/g, ' ');
          tzSelect.appendChild(opt);
        });
      }
      tzSelect.value = s.timezone || 'auto';
    }

    if (el('allow-notifications')) el('allow-notifications').checked = s.allowNotifications;
    if (el('ask-download')) el('ask-download').checked = s.askDownload;

    let aiMode = s.blockAIOverview;
    if (aiMode === true) aiMode = 'deep';
    else if (aiMode === false) aiMode = 'off';
    else if (aiMode !== 'deep' && aiMode !== 'hide' && aiMode !== 'off') aiMode = 'deep';

    document.querySelectorAll('input[name="block-ai-tier"]').forEach(r => { r.checked = r.value === aiMode; });
    document.querySelectorAll('input[name="block-ai-tier-browsing"]').forEach(r => { r.checked = r.value === aiMode; });
    document.querySelectorAll('input[name="onboard-ai-tier"]').forEach(r => { r.checked = r.value === aiMode; });

    if (el('native-dictionary')) el('native-dictionary').checked = s.nativeDictionary !== false;
    if (el('native-dictionary-browsing')) el('native-dictionary-browsing').checked = s.nativeDictionary !== false;

    if (el('custom-ua')) el('custom-ua').value = s.customUa || '';
    if (el('doh-toggle')) el('doh-toggle').checked = s.dohToggle;
    if (el('proxy-url')) el('proxy-url').value = s.proxyUrl || '';

    if (el('live-autocomplete')) el('live-autocomplete').checked = s.liveAutocomplete;
    if (el('live-autocomplete-browsing')) el('live-autocomplete-browsing').checked = s.liveAutocomplete;

    if (el('flag-gpc')) el('flag-gpc').checked = s.gpc !== false; // Default to true
    document.querySelectorAll(`input[name="startup"]`).forEach(r => { r.checked = r.value === s.startup; });
    document.querySelectorAll(`input[name="tracking"]`).forEach(r => { r.checked = r.value === s.tracking; });
    if (el('custom-new-tab')) el('custom-new-tab').value = s.customNewTab || '';
    const homepageContainer = el('startup-homepage-container');
    if (homepageContainer) {
      homepageContainer.style.display = s.startup === 'homepage' ? 'block' : 'none';
    }

    if (el('efficiency-mode')) el('efficiency-mode').checked = !!s.efficiencyMode;
    if (el('cpu-limit-slider')) {
      el('cpu-limit-slider').value = s.cpuLimit || 100;
      el('cpu-limit-value').textContent = (s.cpuLimit || 100) + '%';
    }
    if (el('ram-limit-slider')) {
      el('ram-limit-slider').value = s.ramLimit || 0;
      el('ram-limit-value').textContent = s.ramLimit > 0 ? s.ramLimit + ' MB' : (window.t ? window.t('Off') : 'Off');
    }

    // Show adblock badge based on saved setting
    this.updateAdblockBadge(s.adBlockerMode || 'none');

    // Populate About Leef build info
    try {
      const ipc = window.require('electron').ipcRenderer;
      const appVersion = ipc.sendSync('get-app-version') || '0.1.5';
      if (el('build-leef-version')) el('build-leef-version').textContent = 'v' + appVersion;
    } catch (e) {
      if (el('build-leef-version')) el('build-leef-version').textContent = 'v0.1.5';
    }
    if (el('build-chrome-version')) el('build-chrome-version').textContent = process.versions.chrome || '—';
    if (el('build-electron-version')) el('build-electron-version').textContent = process.versions.electron || '—';
    if (el('build-platform-os')) {
      const platformNames = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
      const osName = platformNames[process.platform] || process.platform;
      el('build-platform-os').textContent = `${osName} (${process.arch})`;
    }

    // Apply regional spelling (Color vs Colour)
    this.applyLocalization();
  }

  sendSettingsToMain() {
    // Send current settings to the main process so network rules apply on startup
    try {
      const labs = JSON.parse(localStorage.getItem('leef_labs_flags') || '{}');
      const settingsWithLabs = { ...this.currentSettings, labs };
      window.require('electron').ipcRenderer.send('apply-settings', settingsWithLabs);
    } catch (e) { console.log('IPC not available', e); }
  }

  bindEvents() {
    // Language restart banner actions
    const btnLangRestartNow = document.getElementById('btn-language-restart-now');
    if (btnLangRestartNow) {
      btnLangRestartNow.addEventListener('click', () => {
        relaunchBrowser();
      });
    }

    const btnLangRestartLater = document.getElementById('btn-language-restart-later');
    if (btnLangRestartLater) {
      btnLangRestartLater.addEventListener('click', () => {
        const banner = document.getElementById('language-restart-banner');
        if (banner) banner.style.display = 'none';
      });
    }

    const langSelect = document.getElementById('language-select');
    if (langSelect) {
      langSelect.addEventListener('change', () => {
        const banner = document.getElementById('language-restart-banner');
        if (banner) {
          if (langSelect.value !== this.sessionInitialLanguage) {
            banner.style.display = 'block';
          } else {
            banner.style.display = 'none';
          }
        }
      });
    }

    // Nav sidebar logic
    const settingsNavItems = document.querySelectorAll('.settings-nav li');
    const settingsSections = document.querySelectorAll('.settings-section');

    settingsNavItems.forEach(item => {
      item.addEventListener('click', () => {
        settingsSections.forEach(s => s.classList.remove('active'));
        settingsNavItems.forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        document.getElementById(item.getAttribute('data-section')).classList.add('active');
      });
    });

    // Settings search filter logic
    const settingsSearch = document.getElementById('settings-search');
    if (settingsSearch) {
      settingsSearch.addEventListener('input', () => {
        const query = settingsSearch.value.trim().toLowerCase();

        if (query.length > 0) {
          // Temporarily disable/fade normal sidebar nav item selection
          settingsNavItems.forEach(item => {
            item.style.pointerEvents = 'none';
            item.style.opacity = '0.4';
          });

          settingsSections.forEach(sec => {
            let sectionHasMatch = false;
            const groups = sec.querySelectorAll('.setting-group');

            groups.forEach(group => {
              // Extract all user-facing text from headers, paragraphs, labels, spans, options
              const textContent = Array.from(group.querySelectorAll('h3, p, label, span, strong, option'))
                .map(node => node.textContent.trim())
                .join(' ')
                .toLowerCase();

              if (textContent.includes(query) || group.textContent.toLowerCase().includes(query)) {
                group.classList.remove('search-hidden');
                sectionHasMatch = true;
              } else {
                group.classList.add('search-hidden');
              }
            });

            if (sectionHasMatch) {
              sec.classList.add('active');
              sec.classList.remove('search-hidden');
            } else {
              sec.classList.remove('active');
              sec.classList.add('search-hidden');
            }
          });
        } else {
          // Restore normal tab navigation and clickability
          settingsNavItems.forEach(item => {
            item.style.pointerEvents = '';
            item.style.opacity = '';
          });

          const activeNav = document.querySelector('.settings-nav li.active');
          const activeSectionId = activeNav ? activeNav.getAttribute('data-section') : 'sec-general';

          settingsSections.forEach(sec => {
            sec.classList.remove('search-hidden');
            sec.querySelectorAll('.setting-group').forEach(group => {
              group.classList.remove('search-hidden');
            });
            if (sec.id === activeSectionId) {
              sec.classList.add('active');
            } else {
              sec.classList.remove('active');
            }
          });
        }
      });
    }

    // Sync custom homepage visibility on radio change
    const startupRadios = document.querySelectorAll('input[name="startup"]');
    const homepageContainer = document.getElementById('startup-homepage-container');
    const updateHomepageVisibility = () => {
      const selected = document.querySelector('input[name="startup"]:checked')?.value;
      if (homepageContainer) {
        homepageContainer.style.display = selected === 'homepage' ? 'block' : 'none';
      }
    };
    startupRadios.forEach(radio => {
      radio.addEventListener('change', updateHomepageVisibility);
    });

    // Sync duplicate UI elements between tabs & show Brave Search AI warning modal
    const checkBraveWarning = (val) => {
      if (val.includes('search.brave.com')) {
        if (window.toastManager) {
          window.toastManager.show(
            '🦁 Brave Search Notice',
            'Brave Search includes an AI Overview summary. You can easily turn it off yourself by clicking the settings gear in the top right of the Brave search results page.',
            8000
          );
        }
      }
    };

    ['search-engine-select', 'native-dictionary', 'live-autocomplete'].forEach(baseId => {
      const el1 = document.getElementById(baseId);
      const el2 = document.getElementById(baseId + '-browsing');
      if (el1 && el2) {
        if (el1.tagName === 'SELECT') {
          el1.addEventListener('change', () => {
            el2.value = el1.value;
            checkBraveWarning(el1.value);
          });
          el2.addEventListener('change', () => {
            el1.value = el2.value;
            checkBraveWarning(el2.value);
          });
        } else {
          el1.addEventListener('change', () => el2.checked = el1.checked);
          el2.addEventListener('change', () => el1.checked = el2.checked);
        }
      }
    });

    document.querySelectorAll('input[name="block-ai-tier"]').forEach(r => {
      r.addEventListener('change', () => {
        if (r.checked) {
          document.querySelectorAll('input[name="block-ai-tier-browsing"]').forEach(b => {
            b.checked = b.value === r.value;
          });
          this.saveSettings();
        }
      });
    });

    document.querySelectorAll('input[name="block-ai-tier-browsing"]').forEach(r => {
      r.addEventListener('change', () => {
        if (r.checked) {
          document.querySelectorAll('input[name="block-ai-tier"]').forEach(b => {
            b.checked = b.value === r.value;
          });
          this.saveSettings();
        }
      });
    });

    // Auto-save settings on change because i fucked up the first 3 times
    let saveDebounce = null;
    document.querySelectorAll('.settings-layout input, .settings-layout select').forEach(el => {
      el.addEventListener('input', () => {
        // Live feedback for sliders
        if (el.id === 'cpu-limit-slider') document.getElementById('cpu-limit-value').textContent = el.value + '%';
        if (el.id === 'ram-limit-slider') document.getElementById('ram-limit-value').textContent = el.value > 0 ? el.value + ' MB' : (window.t ? window.t('Off') : 'Off');
      });

      el.addEventListener('change', () => {
        clearTimeout(saveDebounce);
        saveDebounce = setTimeout(() => this.saveSettings(), 500);
      });
    });

    const hideSportsEl = document.getElementById('hide-sports-until-near-start');
    if (hideSportsEl) {
      hideSportsEl.addEventListener('change', (e) => {
        this.currentSettings.hideSportsUntilNearStart = e.target.checked;
        this.saveSettings();
        if (window.sportsSvc) {
          window.sportsSvc.refresh();
        }
      });
    }

    const btnOpenPrivacySettings = document.getElementById('btn-open-privacy-settings');
    if (btnOpenPrivacySettings) {
      btnOpenPrivacySettings.addEventListener('click', () => {
        const privacyTab = document.querySelector('[data-section="sec-privacy"]');
        if (privacyTab) privacyTab.click();
      });
    }

    if (document.getElementById('dict-info-close')) {
      document.getElementById('dict-info-close').addEventListener('click', () => {
        const modal = document.getElementById('dict-info-modal');
        if (modal) {
          modal.style.opacity = '0';
          setTimeout(() => { modal.style.display = 'none'; }, 200);
        }
      });
    }

    // IPC Buttons
    if (UI.buttons.clearData) {
      UI.buttons.clearData.addEventListener('click', () => {
        try {
          const resetMsg = window.t ? window.t('⚠️ FACTORY RESET: This will clear all settings, labs, history, and bookmarks. The browser will then relaunch. Proceed?') : '⚠️ FACTORY RESET: This will clear all settings, labs, history, and bookmarks. The browser will then relaunch. Proceed?';
          if (confirm(resetMsg)) {
            localStorage.clear();
            window.require('electron').ipcRenderer.send('recovery-action', 'rebuild-appdata');
          }
        } catch (e) { }
      });
    }

    const btnRedoSetup = document.getElementById('btn-redo-setup');
    if (btnRedoSetup) {
      btnRedoSetup.addEventListener('click', () => {
        localStorage.removeItem('leef_onboarding_done');
        location.reload();
      });
    }

    const btnGenerateLog = document.getElementById('btn-generate-log');
    if (btnGenerateLog) {
      btnGenerateLog.addEventListener('click', () => {
        try {
          console.log('Generating bug log...');
          btnGenerateLog.textContent = window.t ? window.t('Generating...') : 'Generating...';
          btnGenerateLog.disabled = true;

          const payload = {
            settings: JSON.parse(localStorage.getItem('leef_settings') || '{}'),
            labs: JSON.parse(localStorage.getItem('leef_labs_flags') || '{}')
          };
          window.require('electron').ipcRenderer.send('generate-bug-log', payload);
        } catch (e) {
          console.error('Renderer error in generate-bug-log:', e);
          btnGenerateLog.textContent = window.t ? window.t('Generate Diagnostics Log') : 'Generate Diagnostics Log';
          btnGenerateLog.disabled = false;
        }
      });
    }
    if (UI.buttons.defaultBrowser) {
      UI.buttons.defaultBrowser.addEventListener('click', () => {
        try {
          window.require('electron').ipcRenderer.send('set-default-browser');
          if (window.toastManager) window.toastManager.show('✅ Default Browser Set', 'Leef is now your default browser for http and https links.', 5000);
        } catch (e) { }
      });
    }

    // v0.1.5 Update/AdBlock Buttons
    const btnCheck = document.getElementById('btn-check-updates');
    if (btnCheck) {
      btnCheck.addEventListener('click', () => {
        try {
          const action = btnCheck.dataset.action;
          if (action === 'download') {
            window.require('electron').ipcRenderer.send('start-download');
            btnCheck.textContent = window.t ? window.t('Starting Download...') : 'Starting Download...';
            btnCheck.disabled = true;
          } else if (action === 'restart') {
            window.require('electron').ipcRenderer.send('restart-to-update');
          } else {
            window.require('electron').ipcRenderer.send('manual-update-check');
            btnCheck.textContent = window.t ? window.t('Checking...') : 'Checking...';
            btnCheck.disabled = true;
          }
        } catch (e) { }
      });
    }

    const btnRefreshAd = document.getElementById('btn-refresh-adblock');
    if (btnRefreshAd) {
      btnRefreshAd.addEventListener('click', () => {
        try {
          window.require('electron').ipcRenderer.send('refresh-adblock');
        } catch (e) { }
      });
    }

    // IPC Listeners for v0.1.5 Transparency
    const ipc = window.require('electron').ipcRenderer;

    ipc.on('bug-log-generated', (event, response) => {
      console.log('Diagnostics response:', response);
      const btnLog = document.getElementById('btn-generate-log');
      if (btnLog) {
        btnLog.textContent = window.t ? window.t('Generate Diagnostics Log') : 'Generate Diagnostics Log';
        btnLog.disabled = false;
      }

      if (response.success) {
        if (window.toastManager) {
          window.toastManager.show('📄 Diagnostics Saved',
            `Log saved to Downloads. It contains settings and system info, but <b>NO history or passwords</b>.<br><br><b>WARNING:</b> Only share this file with the <a href="https://forms.gle/upGc1dvPYaoBw4o96" target="_blank">bug report form</a> or <b>contact.qtech@proton.me</b>.`,
            15000);
        }

        // Ask to open the form
        setTimeout(() => {
          const formConfirm = window.t ? window.t('Diagnostics log generated! This file contains your settings and system info, but NO history or passwords. \n\nWould you like to open the bug report form now to upload it?') : 'Diagnostics log generated! This file contains your settings and system info, but NO history or passwords. \n\nWould you like to open the bug report form now to upload it?';
          if (confirm(formConfirm)) {
            if (window.tabManager) window.tabManager.createTab('https://forms.gle/upGc1dvPYaoBw4o96');
          }
        }, 500);
      } else {
        if (window.toastManager) {
          window.toastManager.show('❌ Generation Failed', `Could not create the log file: ${response.error}`, 5000);
        }
      }
    });
    ipc.on('adblock-status', (event, status) => {
      const badge = document.getElementById('adblock-status-badge');
      const btn = document.getElementById('btn-refresh-adblock');
      if (badge) {
        badge.style.display = 'inline-block';
        if (status === 'syncing') {
          badge.className = 'status-badge syncing';
          badge.textContent = '[UPDATING...]';
        } else if (status === 'error') {
          badge.className = 'status-badge syncing';
          badge.textContent = '[ERROR]';
        } else {
          badge.className = 'status-badge active';
          badge.textContent = '[READY]';
        }
      }
      if (btn) btn.style.display = 'block';
    });

    ipc.on('update-available', (event, data) => {
      const badge = document.getElementById('update-status-badge');
      const btn = document.getElementById('btn-check-updates');
      const toastAction = document.getElementById('leef-toast-action');
      const primaryBtn = document.getElementById('btn-toast-primary');
      const secondaryBtn = document.getElementById('btn-toast-secondary');

      if (btn) {
        btn.textContent = window.t ? window.t('Check for Updates Now') : 'Check for Updates Now';
        btn.disabled = false;
        delete btn.dataset.action;
        btn.style.background = '';
        btn.style.color = '';
      }

      if (data === 'none') {
        if (window.toastManager) window.toastManager.show('✅ Up To Date', 'You are running the latest version of Leef.', 4000);
        if (badge) badge.textContent = '[UP TO DATE]';
      } else if (data === 'error') {
        if (window.toastManager) window.toastManager.show('⚠️ Check Failed', 'Could not reach the update server. Try again later.', 5000);
      } else {
        const displayVersion = BrowserUtils.sanitize(data.version);
        const tag = data.tag;

        if (badge) {
          badge.textContent = '[UPDATE AVAILABLE]';
          badge.className = 'status-badge syncing';
        }

        if (btn) {
          btn.textContent = window.t ? window.t('Download & Install {version}', { version: displayVersion }) : `Download & Install ${displayVersion}`;
          btn.dataset.action = 'download';
          btn.style.background = 'var(--primary-color)';
          btn.style.color = 'white';
        }

        if (window.toastManager) {
          window.toastManager.show('✨ Update Found', `${displayVersion} is available. Do you want to download and install it?`, 20000);

          if (toastAction && primaryBtn && secondaryBtn) {
            toastAction.style.display = 'flex';
            primaryBtn.style.display = 'block';
            primaryBtn.textContent = window.t ? window.t('Download & Install') : 'Download & Install';
            primaryBtn.onclick = () => {
              ipc.send('start-download');
              if (window.toastManager) window.toastManager.show('⏳ Starting Download', 'The update will download in the background.', 4000);
            };

            secondaryBtn.style.display = 'block';
            secondaryBtn.textContent = window.t ? window.t('View on GitHub') : 'View on GitHub';
            secondaryBtn.onclick = () => {
              window.tabManager.createTab(`https://github.com/git-QTech/leef/releases/tag/${tag}`);
            };
          }
        }
      }
    });

    ipc.on('update-download-progress', (event, progress) => {
      const badge = document.getElementById('update-status-badge');
      const btn = document.getElementById('btn-check-updates');
      if (badge) {
        badge.textContent = `[DOWNLOADING ${Math.floor(progress.percent)}%]`;
      }
      if (btn) {
        const pct = Math.floor(progress.percent);
        btn.textContent = window.t ? window.t('Downloading ({percent}%)...', { percent: pct }) : `Downloading (${pct}%)...`;
        btn.disabled = true;
      }
    });

    ipc.on('update-downloaded', (event, info) => {
      const badge = document.getElementById('update-status-badge');
      const btn = document.getElementById('btn-check-updates');
      const toastAction = document.getElementById('leef-toast-action');
      const primaryBtn = document.getElementById('btn-toast-primary');
      const secondaryBtn = document.getElementById('btn-toast-secondary');

      if (badge) {
        badge.textContent = '[RESTART READY]';
        badge.className = 'status-badge active';
      }

      if (btn) {
        btn.textContent = window.t ? window.t('Restart & Apply Update') : 'Restart & Apply Update';
        btn.dataset.action = 'restart';
        btn.disabled = false;
        btn.style.background = '#17b340';
        btn.style.color = 'white';
      }

      if (window.toastManager) {
        window.toastManager.show('🚀 Update Ready', 'The update has been downloaded and is ready to install.', 20000);

        if (toastAction && primaryBtn && secondaryBtn) {
          toastAction.style.display = 'flex';
          primaryBtn.textContent = window.t ? window.t('Restart Now') : 'Restart Now';
          primaryBtn.onclick = () => {
            ipc.send('restart-to-update');
          };
          secondaryBtn.style.display = 'none'; // Hide GitHub button on the final step
        }
      }
    });



    const btnFlags = document.getElementById('btn-flags');
    if (btnFlags) {
      btnFlags.addEventListener('click', () => {
        if (window.toastManager) {
          window.toastManager.show('🛠️ Experimental Flags', 'Individual feature-flags are coming soon in future updates as part of our advanced auditing suite.', 6000);
        }
      });
    }
  }

  saveSettings() {
    if (!document.getElementById('search-engine-select')) return; // safety

    const existingPermissions = this.currentSettings.sitePermissions || {};
    const oldLanguage = this.currentSettings.language || 'en';

    this.currentSettings = {
      sitePermissions: existingPermissions,
      searchEngine: document.getElementById('search-engine-select').value,
      startup: document.querySelector('input[name="startup"]:checked')?.value || 'newtab',
      language: document.getElementById('language-select').value,
      zoom: document.getElementById('zoom-select').value,
      fontSize: document.getElementById('font-size-select').value,
      tracking: document.querySelector('input[name="tracking"]:checked')?.value || 'standard',
      httpsOnly: document.getElementById('https-only').checked,
      adBlockerMode: document.querySelector('input[name="adblock-tier"]:checked')?.value || 'none',
      autoCheckUpdates: document.getElementById('auto-check-updates').checked,
      backgroundLimit: document.getElementById('background-limit').checked,
      enableVolumeBoost: document.getElementById('enable-volume-boost').checked,
      allowNotifications: document.getElementById('allow-notifications').checked,
      askDownload: document.getElementById('ask-download').checked,
      blockAIOverview: document.querySelector('input[name="block-ai-tier"]:checked')?.value
        || document.querySelector('input[name="block-ai-tier-browsing"]:checked')?.value
        || 'deep',
      nativeDictionary: document.getElementById('native-dictionary') ? document.getElementById('native-dictionary').checked : true,
      customUa: document.getElementById('custom-ua').value,
      dohToggle: document.getElementById('doh-toggle').checked,
      proxyUrl: document.getElementById('proxy-url').value,
      liveAutocomplete: document.getElementById('live-autocomplete').checked,
      gpc: document.getElementById('flag-gpc').checked,
      newsManualRefresh: document.getElementById('news-manual-refresh').checked,
      newsProvider: document.getElementById('news-provider-select')?.value || this.currentSettings.newsProvider || 'bbc',
      hideSportsUntilNearStart: document.getElementById('hide-sports-until-near-start') ? document.getElementById('hide-sports-until-near-start').checked : false,
      efficiencyMode: document.getElementById('efficiency-mode').checked,
      cpuLimit: parseInt(document.getElementById('cpu-limit-slider').value),
      ramLimit: parseInt(document.getElementById('ram-limit-slider').value),
      customNewTab: document.getElementById('custom-new-tab')?.value || '',
      greetingName: document.getElementById('custom-greeting-name')?.value?.trim() || '',
      timezone: document.getElementById('hub-timezone-select')?.value || 'auto',
      newsWordFilters: this.currentSettings.newsWordFilters || [],
      followedTeams: this.currentSettings.followedTeams || [],
      quickLinksStr: this.currentSettings.quickLinksStr
    };

    this.applyVisualSettings();
    this.applyLocalization();

    try {
      // Include Labs flags in the primary settings object
      const labs = JSON.parse(localStorage.getItem('leef_labs_flags') || '{}');
      const settingsWithLabs = { ...this.currentSettings, labs };

      // Persist to localStorage AND send to main process
      localStorage.setItem('leef_settings', JSON.stringify(this.currentSettings));
      window.require('electron').ipcRenderer.send('apply-settings', settingsWithLabs);

      // Show/update restart banner if language differs from initial session language
      const banner = document.getElementById('language-restart-banner');
      if (banner) {
        if (this.currentSettings.language !== this.sessionInitialLanguage) {
          banner.style.display = 'block';
        } else {
          banner.style.display = 'none';
        }
      }

      if (window.toastManager) {
        if (oldLanguage !== this.currentSettings.language) {
          window.toastManager.show(
            '🌐 Language Changed',
            'Please restart the browser to complete the language change across all menus and shortcuts.',
            15000,
            {
              primaryText: 'Restart Now',
              secondaryText: 'Later',
              onPrimary: () => relaunchBrowser()
            }
          );
        } else if (window.toastManager.activeTitle !== '🦁 Brave Search Notice') {
          window.toastManager.show('⚙️ Settings Saved', 'Your preferences have been applied.', 3000);
        }
      }

      // Perf fix: Refresh cached language so window.t() picks up the new language without a page reload
      if (window.refreshLang) window.refreshLang();

      // Update adblock badge immediately based on current mode
      this.updateAdblockBadge(this.currentSettings.adBlockerMode);

      // Sync Privacy Manager UI (v0.3.3)
      if (window.privacyManager) window.privacyManager.updateUI();

      // Immediately update all existing tabs when blockAIOverview is toggled
      if (window.tabManager && Array.isArray(window.tabManager.tabs)) {
        window.tabManager.tabs.forEach(tab => {
          if (tab.webviewEl && tab.url && (tab.url.includes('google.com') || tab.url.includes('google.co.'))) {
            const aiMode = this.currentSettings.blockAIOverview;
            const isBlocked = aiMode === 'deep' || aiMode === 'hide' || aiMode === true;
            if (isBlocked) {
              const aiCSS = `
                [data-attnms],
                .Kevs9.SLPe5b:has([data-attnms]),
                div[data-attrid="AIOverview"],
                [data-attrid="VisualDigestGeneratedDescription"],
                [jsname="YrZdPb"][data-evn],
                [jscontroller="Elkdbc"],
                .oGdvd {
                  display: none !important;
                  visibility: hidden !important;
                  height: 0 !important;
                  opacity: 0 !important;
                  pointer-events: none !important;
                }
              `;
              tab.webviewEl.insertCSS(aiCSS).catch(() => { });
              tab.webviewEl.executeJavaScript(`
                window.__leefBlockAIEnabled = true;
                window.__leefBlockAIMode = '${aiMode === 'hide' ? 'hide' : 'deep'}';
                if (window.blockAIBox && typeof window.blockAIBox === 'function') {
                  window.blockAIBox();
                }
              `).catch(() => { });
            } else {
              const restoreCSS = `
                [data-attnms],
                .Kevs9.SLPe5b:has([data-attnms]),
                div[data-attrid="AIOverview"],
                [data-attrid="VisualDigestGeneratedDescription"],
                [jsname="YrZdPb"][data-evn],
                [jscontroller="Elkdbc"],
                .oGdvd {
                  display: revert !important;
                  visibility: visible !important;
                  height: auto !important;
                  opacity: 1 !important;
                  pointer-events: auto !important;
                }
              `;
              tab.webviewEl.insertCSS(restoreCSS).catch(() => { });
              tab.webviewEl.executeJavaScript(`
                window.__leefBlockAIEnabled = false;
                const selectors = [
                  '[data-attnms]', '.Kevs9.SLPe5b:has([data-attnms])', 'div[data-attrid="AIOverview"]', 
                  '[data-attrid="VisualDigestGeneratedDescription"]', '[jsname="YrZdPb"][data-evn]', 
                  '[jscontroller="Elkdbc"]', '.oGdvd'
                ];
                selectors.forEach(sel => {
                  document.querySelectorAll(sel).forEach(el => {
                    el.style.removeProperty('display');
                    el.style.removeProperty('visibility');
                    el.style.removeProperty('height');
                  });
                });
              `).catch(() => { });
            }
          }
        });
      }

      // Update hero clock and greeting immediately
      if (window.heroManager && typeof window.heroManager.update === 'function') {
        window.heroManager.update();
      }
    } catch (e) { console.log("IPC not available", e); }
  }

  updateAdblockBadge(mode) {
    const badge = document.getElementById('adblock-status-badge');
    const btn = document.getElementById('btn-refresh-adblock');
    if (mode === 'comprehensive') {
      if (badge) { badge.style.display = 'inline-block'; badge.className = 'status-badge active'; badge.textContent = '[READY]'; }
      if (btn) btn.style.display = 'block';
    } else if (mode === 'basic') {
      if (badge) { badge.style.display = 'inline-block'; badge.className = 'status-badge active'; badge.textContent = '[OFFLINE]'; }
      if (btn) btn.style.display = 'none';
    } else {
      if (badge) badge.style.display = 'none';
      if (btn) btn.style.display = 'none';
    }
  }

  applyVisualSettings() {
    // Font
    let px = '16px';
    if (this.currentSettings.fontSize === 'small') px = '12px';
    if (this.currentSettings.fontSize === 'large') px = '20px';
    if (this.currentSettings.fontSize === 'very-large') px = '24px';
    document.body.style.fontSize = px;

    // Zoom propagates via TabManager later
    if (window.tabManager) {
      window.tabManager.applyZoomToAll(parseFloat(this.currentSettings.zoom) || 1.0);
    }

    // Efficiency Class
    if (this.currentSettings.efficiencyMode) {
      document.body.classList.add('efficiency-mode');
    } else {
      document.body.classList.remove('efficiency-mode');
    }
  }
}

// --- DROPDOWN TRANSITION UTILS (v0.5.2) ---
const DropdownUtils = {
  show(el, displayType = 'block') {
    if (!el) return;
    el.style.pointerEvents = '';
    el.style.display = displayType;
    // Force browser reflow to register display change before adding class
    el.offsetHeight;
    el.classList.add('visible');
  },
  hide(el) {
    if (!el) return;
    // Immediately block pointer events so hidden/animating dropdowns
    // never intercept clicks on inputs or other elements beneath them
    el.style.pointerEvents = 'none';
    if (!el.classList.contains('visible')) {
      el.style.display = 'none';
      return;
    }
    el.classList.remove('visible');

    let cleaned = false;
    const onTransitionEnd = (e) => {
      if (e.propertyName === 'opacity' || e.propertyName === 'transform') {
        if (!cleaned) {
          cleaned = true;
          el.removeEventListener('transitionend', onTransitionEnd);
          el.style.display = 'none';
        }
      }
    };
    el.addEventListener('transitionend', onTransitionEnd);

    // Fallback timeout to ensure display is set to none if transition doesn't fire
    setTimeout(() => {
      if (!cleaned) {
        cleaned = true;
        el.removeEventListener('transitionend', onTransitionEnd);
        el.style.display = 'none';
      }
    }, 220);
  }
};
window.DropdownUtils = DropdownUtils;


class BookmarksManager {
  constructor() {
    this.btnBookmarks = document.getElementById('btn-bookmarks');
    this.dropdown = document.getElementById('bookmarks-dropdown');
    this.btnAdd = document.getElementById('btn-add-bookmark');
    this.list = document.getElementById('bookmarks-list');
    this.saved = [];

    this.bindEvents();
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem('leef_bookmarks');
      if (raw) this.saved = JSON.parse(raw);
    } catch (e) { }
    this.render();
  }

  save() {
    localStorage.setItem('leef_bookmarks', JSON.stringify(this.saved));
  }

  render() {
    if (!this.list) return;
    this.list.innerHTML = '';
    if (this.saved.length === 0) {
      this.list.innerHTML = '<p style="opacity: 0.6; padding: 10px; font-size: 0.9rem;">No bookmarks saved yet.</p>';
      return;
    }

    this.saved.forEach((bm, i) => {
      const item = document.createElement('div');
      item.className = 'bookmark-item';
      let faviconUrl = '';
      try { faviconUrl = bm.url.includes('http') ? `https://www.google.com/s2/favicons?domain=${new URL(bm.url).hostname}&sz=32` : ''; } catch (e) { }

      item.innerHTML = `
        <img class="bookmark-favicon" src="${faviconUrl}" onerror="this.style.display='none'">
        <div class="bookmark-title">${BrowserUtils.sanitize(bm.title)}</div>
        <button class="bookmark-delete" data-index="${i}">×</button>
      `;

      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('bookmark-delete')) return;
        if (window.tabManager) {
          window.tabManager.navigateToUrl(bm.url);
          DropdownUtils.hide(this.dropdown);
        }
      });

      item.querySelector('.bookmark-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        const removedTitle = this.saved[i].title;
        this.saved.splice(i, 1);
        this.save();
        this.render();
        if (window.toastManager) window.toastManager.show('🗑️ Bookmark Removed', `"${removedTitle}" was removed from your bookmarks.`, 4000);
      });

      this.list.appendChild(item);
    });
  }

  bindEvents() {
    if (!this.btnBookmarks || !this.dropdown) return;

    this.btnBookmarks.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = this.dropdown.classList.contains('visible');
      if (!isVisible) {
        this.render();
        DropdownUtils.show(this.dropdown, 'flex');
        // Close other dropdowns
        const d = document.getElementById('downloads-dropdown');
        if (d) DropdownUtils.hide(d);
        const q = document.getElementById('quick-settings-dropdown');
        if (q) DropdownUtils.hide(q);
        const s = document.getElementById('site-identity-dropdown');
        if (s) DropdownUtils.hide(s);
        const p = document.getElementById('plugins-dropdown');
        if (p) DropdownUtils.hide(p);
      } else {
        DropdownUtils.hide(this.dropdown);
      }
    });

    this.btnAdd.addEventListener('click', () => {
      if (!window.tabManager || !window.tabManager.activeTabId) return;
      const tab = window.tabManager.getActiveTab();
      if (!tab || tab.isInternal) {
        if (window.toastManager) window.toastManager.show('❌ Can\'t Bookmark', 'Internal Leef pages cannot be bookmarked.', 4000);
        return;
      }
      if (!this.saved.find(b => b.url === tab.url)) {
        this.saved.push({ title: tab.title, url: tab.url });
        this.save();
        this.render();
        if (window.toastManager) window.toastManager.show('⭐ Bookmark Added', `"${tab.title}" has been saved to your bookmarks.`, 4000);
      } else {
        if (window.toastManager) window.toastManager.show('⭐ Already Bookmarked', 'This page is already in your bookmarks.', 4000);
      }
    });

    document.addEventListener('click', (e) => {
      if (this.dropdown.classList.contains('visible') && !this.dropdown.contains(e.target) && e.target !== this.btnBookmarks && !this.btnBookmarks.contains(e.target)) {
        DropdownUtils.hide(this.dropdown);
      }
    });
  }
}

class HubManager {
  constructor() {
    this.gridEl = document.querySelector('.hub-grid');
    this.defaults = [
      { name: 'Amazon', url: 'https://amazon.com', cls: 'hub-tile-amazon' },
      { name: 'Netflix', url: 'https://netflix.com', cls: 'hub-tile-netflix' },
      { name: 'X', url: 'https://twitter.com', cls: 'hub-tile-x', subtitle: 'Formerly Twitter' },
      { name: 'Facebook', url: 'https://facebook.com', cls: 'hub-tile-facebook' },
      { name: 'Youtube', url: 'https://youtube.com', cls: 'hub-tile-youtube' },
      { name: 'Wikipedia', url: 'https://wikipedia.org', cls: 'hub-tile-wikipedia' },
      { name: 'Reddit', url: 'https://reddit.com', cls: 'hub-tile-reddit' },
    ];
    this.tiles = this.loadTiles();
    this.bindModalEvents();
    this.render();
  }

  loadTiles() {
    try {
      let saved = JSON.parse(localStorage.getItem('leef_hub_tiles'));
      if (saved && saved.length > 0) {
        // Migrate Discord -> Wikipedia and Disney+ -> Reddit if found in saved tiles
        let migrated = false;
        saved = saved.map(tile => {
          if (tile.name === 'Discord' && tile.url === 'https://discord.com') {
            migrated = true;
            return { name: 'Wikipedia', url: 'https://wikipedia.org', cls: 'hub-tile-wikipedia' };
          }
          if ((tile.name === 'Disney +' || tile.name === 'Disney+') && tile.url === 'https://disneyplus.com') {
            migrated = true;
            return { name: 'Reddit', url: 'https://reddit.com', cls: 'hub-tile-reddit' };
          }
          return tile;
        });
        if (migrated) {
          localStorage.setItem('leef_hub_tiles', JSON.stringify(saved));
        }
        return saved;
      }
    } catch (e) { }
    return [...this.defaults];
  }

  saveTiles() {
    localStorage.setItem('leef_hub_tiles', JSON.stringify(this.tiles));
  }

  bindModalEvents() {
    this.modal = document.getElementById('hub-add-modal');
    this.nameInput = document.getElementById('hub-add-name');
    this.urlInput = document.getElementById('hub-add-url');
    this.btnConfirm = document.getElementById('hub-add-confirm');
    this.btnCancel = document.getElementById('hub-add-cancel');

    // HSL slider elements
    this.pickerHue = document.getElementById('picker-hue');
    this.pickerHueVal = document.getElementById('picker-hue-val');
    this.pickerSat = document.getElementById('picker-saturation');
    this.pickerSatVal = document.getElementById('picker-sat-val');
    this.pickerLight = document.getElementById('picker-lightness');
    this.pickerLightVal = document.getElementById('picker-light-val');
    this.tilePreview = document.getElementById('hub-tile-preview');
    this.tilePreviewName = document.getElementById('hub-tile-preview-name');

    if (!this.modal) return;

    this.btnCancel.addEventListener('click', () => this.closeModal());

    this.btnConfirm.addEventListener('click', () => {
      const name = this.nameInput.value.trim();
      const url = this.urlInput.value.trim();

      const activeColor = this.pickerHue && this.pickerSat && this.pickerLight
        ? `hsl(${this.pickerHue.value}, ${this.pickerSat.value}%, ${this.pickerLight.value}%)`
        : '#92ff78';

      if (!name || !url) {
        if (window.toastManager) window.toastManager.show('⚠️ Missing Info', 'Please enter both a name and URL.', 3000);
        return;
      }

      const fullUrl = url.startsWith('http') ? url : 'https://' + url;
      this.tiles.push({ name, url: fullUrl, cls: 'hub-tile-custom', color: activeColor });
      this.saveTiles();
      this.render();
      this.closeModal();
      if (window.toastManager) window.toastManager.show('✅ Tile Added', `"${name}" has been added to your Hub.`, 4000);
    });

    this.urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.btnConfirm.click();
    });

    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.closeModal();
    });

    // Real-time site name preview sync
    this.nameInput.addEventListener('input', () => {
      if (this.tilePreviewName) {
        this.tilePreviewName.textContent = this.nameInput.value.trim() || (window.t ? window.t('Site Name') : 'Site Name');
      }
    });

    // Color slider listeners
    const sliderHandler = () => this.updateTileColorPreview();
    if (this.pickerHue) this.pickerHue.addEventListener('input', sliderHandler);
    if (this.pickerSat) this.pickerSat.addEventListener('input', sliderHandler);
    if (this.pickerLight) this.pickerLight.addEventListener('input', sliderHandler);

    this.updateTileColorPreview();
  }

  updateTileColorPreview() {
    if (!this.pickerHue || !this.pickerSat || !this.pickerLight || !this.tilePreview) return;
    const h = this.pickerHue.value;
    const s = this.pickerSat.value;
    const l = this.pickerLight.value;

    // Update text labels
    if (this.pickerHueVal) this.pickerHueVal.textContent = h + '°';
    if (this.pickerSatVal) this.pickerSatVal.textContent = s + '%';
    if (this.pickerLightVal) this.pickerLightVal.textContent = l + '%';

    // Dynamic slider backgrounds for premium feedback
    this.pickerSat.style.background = `linear-gradient(to right, hsl(${h}, 0%, ${l}%), hsl(${h}, 100%, ${l}%))`;
    this.pickerLight.style.background = `linear-gradient(to right, #000, hsl(${h}, ${s}%, 50%), #fff)`;

    // Update preview tile color
    const colorStr = `hsl(${h}, ${s}%, ${l}%)`;
    this.tilePreview.style.backgroundColor = colorStr;
    this.tilePreview.style.backgroundImage = 'none';

    // Adjust text color dynamically based on lightness
    const isDark = l < 60;
    this.tilePreview.style.color = isDark ? '#fff' : '#111';
  }

  render() {
    if (!this.gridEl) return;
    this.gridEl.innerHTML = '';
    this.tiles.forEach((tile, i) => {
      const el = document.createElement('div');
      el.className = `hub-tile ${tile.cls || 'hub-tile-custom'}`;

      // Apply custom color if present
      if (tile.color) {
        el.style.backgroundColor = tile.color;
        el.style.backgroundImage = 'none';

        // Auto-calculate text color based on lightness
        let isDark = false;
        if (tile.color.startsWith('hsl')) {
          const match = tile.color.match(/,\s*([\d.]+)%\s*\)/);
          if (match) {
            const lightness = parseFloat(match[1]);
            isDark = lightness < 60;
          }
        } else if (tile.color.startsWith('#')) {
          const hex = tile.color.replace('#', '');
          const r = parseInt(hex.substring(0, 2), 16);
          const g = parseInt(hex.substring(2, 4), 16);
          const b = parseInt(hex.substring(4, 6), 16);
          const brightness = (r * 299 + g * 587 + b * 114) / 1000;
          isDark = brightness < 150;
        } else {
          if (tile.color === '#555555' || tile.color === '#333333') isDark = true;
        }
        el.style.color = isDark ? '#fff' : '#111';
      }

      const subtitleText = tile.subtitle ? (window.t ? window.t(tile.subtitle) : tile.subtitle) : '';
      const removeTitle = window.t ? window.t('Remove') : 'Remove';
      el.innerHTML = `
        ${tile.subtitle ? `<div>${BrowserUtils.sanitize(tile.name)}</div><div class="small-text" data-i18n="${BrowserUtils.sanitize(tile.subtitle)}">${BrowserUtils.sanitize(subtitleText)}</div>` : BrowserUtils.sanitize(tile.name)}
        <button class="hub-tile-remove" data-idx="${i}" title="${BrowserUtils.sanitize(removeTitle)}">&times;</button>
      `;
      el.addEventListener('click', (e) => {
        if (e.target.closest('.hub-tile-remove')) return;
        if (window.tabManager) window.tabManager.navigateToUrl(tile.url);
      });
      el.querySelector('.hub-tile-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        const name = this.tiles[i].name;
        this.tiles.splice(i, 1);
        this.saveTiles();
        this.render();
        if (window.toastManager) window.toastManager.show('🗑️ Tile Removed', `"${name}" has been removed from your Hub.`, 4000);
      });
      this.gridEl.appendChild(el);
    });

    // "Add More" tile
    const addTile = document.createElement('div');
    addTile.className = 'hub-tile hub-tile-add';
    const addMoreLabel = window.t ? window.t('Add More') : 'Add More';
    addTile.innerHTML = `<b>+</b> <span data-i18n="Add More">${addMoreLabel}</span>`;
    addTile.addEventListener('click', () => this.promptAddTile());
    this.gridEl.appendChild(addTile);
  }

  promptAddTile() {
    if (!this.modal) return;
    this.nameInput.value = '';
    this.urlInput.value = '';
    if (this.tilePreviewName) {
      this.tilePreviewName.textContent = window.t ? window.t('Site Name') : 'Site Name';
    }

    // Reset colors to default brand green HSL (109, 100%, 74%)
    if (this.pickerHue) this.pickerHue.value = 109;
    if (this.pickerSat) this.pickerSat.value = 100;
    if (this.pickerLight) this.pickerLight.value = 74;
    this.updateTileColorPreview();

    this.modal.style.display = 'flex';
    document.body.classList.add('modal-open');
    this.nameInput.focus();
  }

  closeModal() {
    this.modal.style.display = 'none';
    document.body.classList.remove('modal-open');
  }
}

// --- NEWS PROVIDERS ---
const NEWS_PROVIDERS = {
  bbc: {
    id: 'bbc',
    name: 'BBC News',
    shortName: 'BBC News',
    brandTag: 'BBC',
    sub: 'World & UK',
    color: '#bb1919',
    bgColor: 'rgba(187, 25, 25, 0.07)',
    glowColor: 'rgba(187, 25, 25, 0.15)',
    borderColor: 'rgba(187, 25, 25, 0.3)',
    url: 'https://feeds.bbci.co.uk/news/world/rss.xml',
    badge: 'BBC News'
  },
  yahoo: {
    id: 'yahoo',
    name: 'Yahoo News',
    shortName: 'Yahoo News',
    brandTag: 'Yahoo!',
    sub: 'US & Global',
    color: '#6001d2',
    bgColor: 'rgba(96, 1, 210, 0.07)',
    glowColor: 'rgba(96, 1, 210, 0.15)',
    borderColor: 'rgba(96, 1, 210, 0.3)',
    url: 'https://news.yahoo.com/rss/',
    badge: 'Yahoo News'
  },
  npr: {
    id: 'npr',
    name: 'NPR News',
    shortName: 'NPR News',
    brandTag: 'NPR',
    sub: 'Public Radio',
    color: '#0077c8',
    bgColor: 'rgba(0, 119, 200, 0.07)',
    glowColor: 'rgba(0, 119, 200, 0.15)',
    borderColor: 'rgba(0, 119, 200, 0.3)',
    url: 'https://feeds.npr.org/1001/rss.xml',
    badge: 'NPR News'
  },
  dw: {
    id: 'dw',
    name: 'Deutsche Welle',
    shortName: 'DW News',
    brandTag: 'DW',
    sub: 'Europe & Global',
    color: '#008ac9',
    bgColor: 'rgba(0, 138, 201, 0.07)',
    glowColor: 'rgba(0, 138, 201, 0.15)',
    borderColor: 'rgba(0, 138, 201, 0.3)',
    url: 'https://rss.dw.com/rdf/rss-en-all',
    badge: 'DW News'
  },
  nos: {
    id: 'nos',
    name: 'NOS Nieuws',
    shortName: 'NOS Nieuws',
    brandTag: 'NOS',
    sub: 'Netherlands',
    color: '#d3131a',
    bgColor: 'rgba(211, 19, 26, 0.07)',
    glowColor: 'rgba(211, 19, 26, 0.15)',
    borderColor: 'rgba(211, 19, 26, 0.3)',
    url: 'https://feeds.nos.nl/nosnieuwsalgemeen',
    badge: 'NOS Nieuws'
  },
  france24: {
    id: 'france24',
    name: 'France 24',
    shortName: 'France 24',
    brandTag: 'France 24',
    sub: 'International',
    color: '#0055a5',
    bgColor: 'rgba(0, 85, 165, 0.07)',
    glowColor: 'rgba(0, 85, 165, 0.15)',
    borderColor: 'rgba(0, 85, 165, 0.3)',
    url: 'https://www.france24.com/en/rss',
    badge: 'France 24'
  }
};

const DEFAULT_FEED_THEME = {
  color: '#2e7d32',
  bgColor: 'rgba(46, 125, 50, 0.12)',
  borderColor: 'rgba(46, 125, 50, 0.3)'
};

const FALLBACK_NEWS_IMG = "data:image/svg+xml;base64," + (typeof btoa !== 'undefined' ? btoa('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#2e7d32" stop-opacity="0.15"/><stop offset="100%" stop-color="#1b5e20" stop-opacity="0.35"/></linearGradient></defs><rect width="300" height="200" fill="url(#g)"/><circle cx="150" cy="100" r="38" fill="#1b5e20" opacity="0.15"/><path d="M150 76 C134 94, 126 116, 150 134 C174 116, 166 94, 150 76 Z" fill="#2e7d32" opacity="0.8"/></svg>') : '');

const NEWS_STOP_WORDS = new Set([
  // English common & auxiliaries
  'the','be','to','of','and','a','in','that','have','i','it','for','not','on','with','he','as','you','do','at',
  'this','but','his','by','from','they','we','say','her','she','or','an','will','my','one','all','would','there',
  'their','what','so','up','out','if','about','who','get','which','go','me','when','make','can','like','time','no',
  'just','him','know','take','people','into','year','your','good','some','could','them','see','other','than','then',
  'now','look','only','come','its','over','think','also','back','after','use','two','how','our','work','first','well',
  'way','even','new','want','because','any','these','give','day','most','us','says','amid','amidst','told','breaking',
  'read','full','story','latest','view','watch','live','update','video','photos','report','reports','news',
  'was','were','been','being','are','has','had','did','does','done','must','should','shall','may','might','much',
  'many','more','less','better','best','worse','worst','very','deeply','really','still','too','further','both',
  'several','trying','tried','tries','under','doing','described','named','accused','alleged','allegations','accuser',
  'several','since','before','while','during','between','through','down','off','again','further','thence','here',
  'where','why','how','such','own','same','why','whose','whom','whilst','towards','toward','upon','within','without',
  // Dutch
  'de','het','een','en','van','ik','te','dat','die','in','is','op','voor','met','als','zijn','er','niet','om',
  'naar','maar','door','over','aan','uit','bij','ook','tot','je','we','hij','ze','zou','meer','worden','nieuws','werd',
  'was','waren','zijn','heeft','hadden','hebben','kunnen','moeten','moest','al','nog','heel','veel','weer',
  // German
  'der','die','das','und','in','den','von','zu','mit','ist','im','für','auf','nicht','eine','des','ein','dem',
  'sich','auch','nach','wie','über','aus','bei','um','durch','vom','unter','wird','haben','werden','neue','nachrichten',
  'war','waren','hatte','hatten','kann','können','muss','müssen','soll','sehr','mehr','schon','wieder',
  // French & Spanish
  'le','la','les','un','une','des','du','de','et','en','dans','pour','sur','qui','que','avec','pas','plus',
  'est','sont','fait','faire','ete','ont','aussi','tres','dans','vers','sous','par',
  'el','los','las','un','una','unos','unas','y','de','en','por','con','para','como','pero','sobre','este',
  'del','fue','eran','esta','estos','estas','mas','muy','hacer','hacia','desde'
]);

class NewsService {
  constructor() {
    this.container = document.getElementById('dynamic-news-container');
    this.isLoading = false;
    this.isManualTrigger = false;
    this.allItems = [];     // All parsed RSS items
    this.shownIndices = []; // Indices of the 3 currently shown items

    // Persistent Dismissed Headlines (Link -> Timestamp)
    this.dismissedHeadlines = this.loadDismissed();
    this.pruneOldDismissals();

    // 100% On-Device Smart Model
    this.smartModel = this.loadSmartModel();

    if (localStorage.getItem('leef_onboarding_done')) {
      this.loadNews();
    }

    // Bind Privacy Info Modal
    const infoTrigger = document.querySelector('.news-info-trigger');
    const privacyModal = document.getElementById('news-privacy-modal');
    const privacyClose = document.getElementById('news-privacy-close');
    const privacyX = document.getElementById('news-privacy-x');

    if (infoTrigger && privacyModal) {
      infoTrigger.style.cursor = 'pointer';
      infoTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        privacyModal.style.display = 'flex';
      });
    }

    if (privacyClose && privacyModal) {
      privacyClose.addEventListener('click', () => {
        privacyModal.style.display = 'none';
      });
    }
    if (privacyX && privacyModal) {
      privacyX.addEventListener('click', () => {
        privacyModal.style.display = 'none';
      });
    }
    if (privacyModal) {
      privacyModal.addEventListener('click', (e) => {
        if (e.target === privacyModal) privacyModal.style.display = 'none';
      });
    }
  }

  loadDismissed() {
    try {
      return JSON.parse(localStorage.getItem('leef_dismissed_news') || '{}');
    } catch (e) { return {}; }
  }

  saveDismissed() {
    localStorage.setItem('leef_dismissed_news', JSON.stringify(this.dismissedHeadlines));
  }

  pruneOldDismissals() {
    const now = Date.now();
    const ONE_DAY = 24 * 60 * 60 * 1000;
    let changed = false;
    for (const link in this.dismissedHeadlines) {
      if (now - this.dismissedHeadlines[link] > ONE_DAY) {
        delete this.dismissedHeadlines[link];
        changed = true;
      }
    }
    if (changed) this.saveDismissed();
  }

  loadSmartModel() {
    try {
      const data = JSON.parse(localStorage.getItem('leef_news_smart_model') || '{}');
      return {
        topics: data.topics || {},
        likedUrls: data.likedUrls || {},
        dislikedUrls: data.dislikedUrls || {}
      };
    } catch {
      return { topics: {}, likedUrls: {}, dislikedUrls: {} };
    }
  }

  saveSmartModel() {
    try {
      localStorage.setItem('leef_news_smart_model', JSON.stringify(this.smartModel));
      window.dispatchEvent(new CustomEvent('leef-news-smart-updated', { detail: this.smartModel }));
    } catch (e) {}
  }

  resetSmartPreferences() {
    this.smartModel = { topics: {}, likedUrls: {}, dislikedUrls: {} };
    this.saveSmartModel();
    this.refresh();
  }

  extractKeywords(title, description = '', categories = []) {
    // Only extract keywords from headline title and explicit RSS categories.
    // Article descriptions contain dozens of filler words and sentence fragments.
    const selected = [];
    const seen = new Set();

    // 1. First add explicit RSS category tags if present (e.g. "US", "Education", "Technology")
    categories.forEach(cat => {
      if (selected.length >= 4) return;
      const clean = cat.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
      if (clean.length >= 3 && !NEWS_STOP_WORDS.has(clean) && !seen.has(clean)) {
        seen.add(clean);
        selected.push(clean);
      }
    });

    // 2. Identify capitalized words in title (excluding the first word if just sentence case)
    // and salient words >= 4 chars.
    const titleClean = (title || '').replace(/https?:\/\/\S+/g, ' ');
    const rawWords = titleClean.split(/\s+/);

    // Prioritize capitalized proper nouns (e.g. Cornell, University, NASA, Boeing)
    for (let i = 0; i < rawWords.length && selected.length < 4; i++) {
      const rw = rawWords[i];
      const stripped = rw.replace(/[^\p{L}\p{N}]/gu, '');
      const lower = stripped.toLowerCase();
      if (stripped.length >= 4 && !NEWS_STOP_WORDS.has(lower) && isNaN(stripped)) {
        // Check if capitalized term (and not merely first word unless length >= 5)
        const isCapitalized = /^[A-Z\xC0-\xDF]/.test(stripped);
        if (isCapitalized && (i > 0 || stripped.length >= 5)) {
          if (!seen.has(lower)) {
            seen.add(lower);
            selected.push(lower);
          }
        }
      }
    }

    // 3. If we still have fewer than 3 keywords, extract remaining meaningful title nouns
    const remainingTokens = titleClean.toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/);

    for (const t of remainingTokens) {
      if (selected.length >= 4) break;
      if (t.length >= 4 && !NEWS_STOP_WORDS.has(t) && isNaN(t) && !seen.has(t)) {
        seen.add(t);
        selected.push(t);
      }
    }

    return selected;
  }

  scoreItem(item) {
    let score = 0;
    const topics = this.smartModel.topics || {};
    for (const kw of item.keywords) {
      if (topics[kw]) score += topics[kw];
    }
    return score;
  }

  rateItem(slotIdx, delta) {
    const itemIdx = this.shownIndices[slotIdx];
    const item = this.allItems[itemIdx];
    if (!item) return;

    const topics = this.smartModel.topics;
    item.keywords.forEach(kw => {
      const current = topics[kw] || 0;
      const next = current + delta;
      topics[kw] = Math.max(-10, Math.min(10, next));
    });

    if (delta > 0) {
      this.openTopicFeedbackModal(item, slotIdx);
    } else {
      this.smartModel.dislikedUrls[item.link] = Date.now();
      delete this.smartModel.likedUrls[item.link];
      this.saveSmartModel();

      if (window.toastManager) {
        window.toastManager.show('👎 Preference Saved', 'Tuned for fewer stories like this on your device.', 3000);
      }
      // Immediately replace this slot
      this.dismissCard(slotIdx);
    }
  }

  extractSalientTopics(title, categories = []) {
    const result = [];
    const seen = new Set();

    const addTopic = (str) => {
      if (!str) return;
      const clean = str.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').trim();
      const lower = clean.toLowerCase();
      if (clean.length < 3 || NEWS_STOP_WORDS.has(lower) || !isNaN(clean) || seen.has(lower)) {
        return;
      }
      seen.add(lower);
      let formatted = clean;
      if (!/^[A-Z0-9]{2,}$/.test(clean)) {
        formatted = clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
      }
      result.push(formatted);
    };

    // 1. RSS category tags if present
    (categories || []).forEach(cat => addTopic(cat));

    // 2. Capitalized words & proper nouns from headline
    const titleClean = (title || '').replace(/https?:\/\/\S+/g, ' ');
    const rawTokens = titleClean.split(/\s+/);

    rawTokens.forEach(t => {
      const stripped = t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      if (stripped.length >= 3 && /^[A-Z\xC0-\xDF]/.test(stripped)) {
        addTopic(stripped);
      }
    });

    // 3. Other salient words (>= 4 chars)
    rawTokens.forEach(t => {
      const stripped = t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      if (stripped.length >= 4) {
        addTopic(stripped);
      }
    });

    return result.slice(0, 8);
  }

  openTopicFeedbackModal(item, slotIdx) {
    const modal = document.getElementById('news-topic-feedback-modal');
    if (!modal) {
      // Fallback if modal DOM element not found
      this.applyLikedTopics(item, item.keywords || []);
      return;
    }

    const headlineEl = document.getElementById('news-feedback-headline');
    const chipsContainer = document.getElementById('news-feedback-chips');
    const customInput = document.getElementById('news-feedback-custom-input');
    const addBtn = document.getElementById('news-feedback-add-btn');
    const closeBtn = document.getElementById('news-topic-feedback-close');
    const cancelBtn = document.getElementById('news-feedback-cancel');
    const saveBtn = document.getElementById('news-feedback-save');

    if (headlineEl) {
      headlineEl.textContent = `"${item.title || ''}"`;
    }
    if (customInput) customInput.value = '';

    const topics = this.extractSalientTopics(item.title, item.categories);
    const selectedTopics = new Set(topics.map(t => t.toLowerCase()));

    const renderChips = () => {
      if (!chipsContainer) return;
      chipsContainer.innerHTML = '';

      topics.forEach(topic => {
        const lower = topic.toLowerCase();
        const isSelected = selectedTopics.has(lower);

        const chip = document.createElement('div');
        chip.className = `news-topic-chip ${isSelected ? 'selected' : ''}`;
        chip.innerHTML = `
          <span class="chip-check">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
          </span>
          <span class="chip-label">${BrowserUtils.sanitize(topic)}</span>
        `;

        chip.addEventListener('click', () => {
          if (selectedTopics.has(lower)) {
            selectedTopics.delete(lower);
          } else {
            selectedTopics.add(lower);
          }
          renderChips();
        });

        chipsContainer.appendChild(chip);
      });
    };

    renderChips();

    const handleAddCustom = () => {
      if (!customInput) return;
      const val = customInput.value.trim();
      if (!val) return;
      const lower = val.toLowerCase();
      if (!selectedTopics.has(lower)) {
        const display = val.charAt(0).toUpperCase() + val.slice(1);
        topics.push(display);
        selectedTopics.add(lower);
        renderChips();
      }
      customInput.value = '';
    };

    const cleanup = () => {
      modal.style.display = 'none';
      document.body.classList.remove('modal-open');
    };

    if (closeBtn) closeBtn.onclick = cleanup;
    if (cancelBtn) cancelBtn.onclick = cleanup;
    modal.onclick = (e) => {
      if (e.target === modal) cleanup();
    };

    if (addBtn) addBtn.onclick = handleAddCustom;
    if (customInput) {
      customInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleAddCustom();
        }
      };
    }

    if (saveBtn) {
      saveBtn.onclick = () => {
        const chosen = Array.from(selectedTopics);
        this.applyLikedTopics(item, chosen);
        cleanup();
      };
    }

    modal.style.display = 'flex';
    document.body.classList.add('modal-open');
  }

  applyLikedTopics(item, chosenTopics) {
    const topics = this.smartModel.topics;

    // Boost only user-approved topics
    chosenTopics.forEach(kw => {
      const current = topics[kw] || 0;
      topics[kw] = Math.max(-10, Math.min(10, current + 2));
    });

    this.smartModel.likedUrls[item.link] = Date.now();
    delete this.smartModel.dislikedUrls[item.link];
    this.saveSmartModel();

    if (window.toastManager) {
      if (chosenTopics.length > 0) {
        const displayList = chosenTopics.slice(0, 3).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(', ');
        const suffix = chosenTopics.length > 3 ? ` +${chosenTopics.length - 3} more` : '';
        const pattern = window.t ? window.t('Tuned feed for: {topics}') : 'Tuned feed for: {topics}';
        const msg = pattern.replace('{topics}', displayList + suffix);
        window.toastManager.show('👍 Preference Saved', msg, 3500);
      } else {
        const msg = window.t ? window.t('Story saved to preferences.') : 'Story saved to preferences.';
        window.toastManager.show('👍 Preference Saved', msg, 3000);
      }
    }

    this.renderCards();
  }

  refresh() {
    if (this.isLoading) return;
    this.allItems = [];
    this.shownIndices = [];
    this.isManualTrigger = true;
    if (this.container) {
      const loadingText = window.t ? window.t('Refreshing...') : 'Refreshing...';
      this.container.innerHTML = `<p style="opacity: 0.6; padding-left: 10px;">${loadingText}</p>`;
    }
    this.loadNews();
  }

  fetchFeedUrl(url, maxRedirects = 3) {
    return new Promise((resolve, reject) => {
      if (maxRedirects <= 0) return reject(new Error('Too many redirects'));
      try {
        const parsed = new URL(url);
        const mod = parsed.protocol === 'http:' ? window.require('http') : window.require('https');
        const options = {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 LeefBrowser/1.0',
            'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
            'Cache-Control': 'no-cache'
          }
        };
        const req = mod.get(url, options, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            let next = res.headers.location;
            if (!next.startsWith('http')) next = new URL(next, url).toString();
            res.resume();
            return this.fetchFeedUrl(next, maxRedirects - 1).then(resolve).catch(reject);
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            res.resume();
            return reject(new Error(`HTTP status ${res.statusCode}`));
          }
          const chunks = [];
          let size = 0;
          const MAX_BYTES = 1024 * 1024;
          res.on('data', chunk => {
            size += chunk.length;
            if (size < MAX_BYTES) chunks.push(chunk);
          });
          res.on('end', () => {
            resolve(Buffer.concat(chunks).toString('utf8'));
          });
        });
        req.on('error', reject);
        req.setTimeout(8000, () => {
          req.destroy();
          reject(new Error('Feed timeout'));
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  parseFeedXml(data, feedMeta = {}) {
    const xml = new DOMParser().parseFromString(data, 'text/xml');
    const items = [];

    // For preloaded sources, ALWAYS use the official shortName!
    // For custom feeds, if the name is a URL or empty, use clean domain.
    let resolvedSource = feedMeta.shortName || feedMeta.name;
    if (!resolvedSource) {
      const channelTitle = xml.querySelector('channel > title')?.textContent?.trim();
      resolvedSource = channelTitle || 'News';
    }
    if (resolvedSource.startsWith('http://') || resolvedSource.startsWith('https://')) {
      try {
        resolvedSource = new URL(resolvedSource).hostname.replace(/^www\./, '');
      } catch (e) {
        resolvedSource = 'News';
      }
    }

    const sourceColor = feedMeta.color || DEFAULT_FEED_THEME.color;
    const sourceBg = feedMeta.bgColor || DEFAULT_FEED_THEME.bgColor;
    const sourceBorder = feedMeta.borderColor || DEFAULT_FEED_THEME.borderColor;
    const sourceId = feedMeta.id || 'custom';

    // Channel-level logo fallback (e.g. DW provides <image><url>...</url></image>)
    const channelImg = xml.querySelector('channel > image > url')?.textContent?.trim() ||
                       xml.querySelector('image > url')?.textContent?.trim() ||
                       xml.querySelector('image')?.getAttribute('rdf:about') || '';

    // Check RSS / RDF items
    const rawItems = xml.querySelectorAll('item');
    if (rawItems && rawItems.length > 0) {
      rawItems.forEach(item => {
        const title = item.querySelector('title')?.textContent?.trim() || 'News Headline';
        const rawLink = item.querySelector('link')?.textContent?.trim() ||
                        item.getAttribute('rdf:about') ||
                        item.querySelector('guid')?.textContent?.trim() || '';
        let link = '';
        if (rawLink.startsWith('http://') || rawLink.startsWith('https://')) {
          link = rawLink;
        }
        const desc = item.querySelector('description')?.textContent?.trim() || '';
        const cats = Array.from(item.querySelectorAll('category')).map(c => c.textContent?.trim()).filter(Boolean);

        // Find image
        let imgSrc = '';
        const mediaCont = item.getElementsByTagName('media:content');
        if (mediaCont && mediaCont.length > 0 && mediaCont[0].getAttribute('url')) {
          imgSrc = mediaCont[0].getAttribute('url');
        } else {
          const mediaThumb = item.getElementsByTagName('media:thumbnail');
          if (mediaThumb && mediaThumb.length > 0 && mediaThumb[0].getAttribute('url')) {
            imgSrc = mediaThumb[0].getAttribute('url');
          } else {
            const enclosure = item.querySelector('enclosure');
            if (enclosure && enclosure.getAttribute('url')) {
              imgSrc = enclosure.getAttribute('url');
            } else {
              // Search <content:encoded> (used by NPR) and <description>
              const contentEncoded = item.getElementsByTagName('content:encoded');
              const searchStr = (contentEncoded.length > 0 ? contentEncoded[0].textContent : '') + ' ' + desc;
              const imgMatch = searchStr.match(/<img[^>]+src=["']([^"']+)["']/i);
              if (imgMatch) imgSrc = imgMatch[1];
            }
          }
        }

        if (!imgSrc && channelImg && (channelImg.startsWith('http://') || channelImg.startsWith('https://'))) {
          imgSrc = channelImg;
        }

        if (!imgSrc) {
          imgSrc = FALLBACK_NEWS_IMG;
        }

        const pubDateStr = item.querySelector('pubDate')?.textContent?.trim() ||
                           item.querySelector('dc\\:date, date')?.textContent?.trim() || '';
        const pubTimestamp = pubDateStr ? Date.parse(pubDateStr) : 0;

        if (title && link) {
          items.push({
            title,
            link,
            imgSrc,
            description: desc,
            categories: cats,
            sourceId,
            sourceName: resolvedSource,
            sourceColor,
            sourceBg,
            sourceBorder,
            pubDate: isNaN(pubTimestamp) ? 0 : pubTimestamp,
            isCustom: !!feedMeta.isCustom
          });
        }
      });
      return items;
    }

    // Check Atom entries
    const entries = xml.querySelectorAll('entry');
    if (entries && entries.length > 0) {
      entries.forEach(entry => {
        const title = entry.querySelector('title')?.textContent?.trim() || 'News Headline';
        const linkEl = entry.querySelector('link[rel="alternate"]') || entry.querySelector('link');
        const link = linkEl?.getAttribute('href') || linkEl?.textContent?.trim() || '';
        const summary = entry.querySelector('summary')?.textContent || entry.querySelector('content')?.textContent || '';
        const cats = Array.from(entry.querySelectorAll('category')).map(c => c.getAttribute('term') || c.textContent?.trim()).filter(Boolean);

        let imgSrc = '';
        const mediaThumb = entry.getElementsByTagName('media:thumbnail');
        if (mediaThumb && mediaThumb.length > 0 && mediaThumb[0].getAttribute('url')) {
          imgSrc = mediaThumb[0].getAttribute('url');
        } else {
          const enclosure = entry.querySelector('link[rel="enclosure"]');
          if (enclosure && enclosure.getAttribute('href')) {
            imgSrc = enclosure.getAttribute('href');
          } else {
            const imgMatch = summary.match(/<img[^>]+src=["']([^"']+)["']/i);
            if (imgMatch) imgSrc = imgMatch[1];
          }
        }

        if (!imgSrc && channelImg && (channelImg.startsWith('http://') || channelImg.startsWith('https://'))) {
          imgSrc = channelImg;
        }

        if (!imgSrc) {
          imgSrc = FALLBACK_NEWS_IMG;
        }

        const pubDateStr = entry.querySelector('published')?.textContent?.trim() ||
                           entry.querySelector('updated')?.textContent?.trim() || '';
        const pubTimestamp = pubDateStr ? Date.parse(pubDateStr) : 0;

        if (title && link) {
          items.push({
            title,
            link,
            imgSrc,
            description: summary,
            categories: cats,
            sourceId,
            sourceName: resolvedSource,
            sourceColor,
            sourceBg,
            sourceBorder,
            pubDate: isNaN(pubTimestamp) ? 0 : pubTimestamp,
            isCustom: !!feedMeta.isCustom
          });
        }
      });
    }

    return items;
  }

  async loadNews() {
    const container = this.container;
    if (!container) return;
    if (this.isLoading) return;

    const settings = window.settingsManager?.currentSettings || {};
    if (settings.newsManualRefresh && this.allItems.length === 0 && !this.isManualTrigger) {
      container.innerHTML = `
        <div style="padding: 20px; text-align: center; border: 1px dashed rgba(0,0,0,0.1); border-radius: 12px;">
          <p style="font-size: 0.85rem; opacity: 0.7; margin-bottom: 12px;" data-i18n="Manual Refresh is enabled for privacy.">Manual Refresh is enabled for privacy.</p>
          <button id="btn-load-news-now" class="settings-btn" style="width: auto; background: var(--primary-color); color: white; border: none; padding: 6px 15px;" data-i18n="Load News Now">Load News Now</button>
        </div>
      `;
      document.getElementById('btn-load-news-now')?.addEventListener('click', () => {
        this.isManualTrigger = true;
        this.loadNews();
      });
      return;
    }

    this.isLoading = true;
    const providerSetting = settings.newsProvider || ['bbc'];
    const selectedProviders = Array.isArray(providerSetting) ? providerSetting : [providerSetting];
    const customFeeds = JSON.parse(localStorage.getItem('leef_custom_rss_feeds') || '[]');

    const feedsToFetch = [];

    // Prioritize Custom Feeds first so user's hand-picked sources lead the mix!
    customFeeds.forEach(f => {
      if (f.enabled !== false && f.url) {
        let cleanName = f.name?.trim();
        if (!cleanName || cleanName.startsWith('http://') || cleanName.startsWith('https://')) {
          try {
            cleanName = new URL(f.url).hostname.replace(/^www\./, '');
          } catch (e) {
            cleanName = 'Custom RSS';
          }
        }
        feedsToFetch.push({
          url: f.url,
          id: 'custom',
          isCustom: true,
          name: cleanName,
          shortName: cleanName,
          color: DEFAULT_FEED_THEME.color,
          bgColor: DEFAULT_FEED_THEME.bgColor,
          borderColor: DEFAULT_FEED_THEME.borderColor
        });
      }
    });

    // Add selected built-in providers
    selectedProviders.forEach(pId => {
      if (pId !== 'custom' && NEWS_PROVIDERS[pId]) {
        const prov = NEWS_PROVIDERS[pId];
        feedsToFetch.push({
          url: prov.url,
          id: prov.id,
          isCustom: false,
          name: prov.name,
          shortName: prov.shortName,
          color: prov.color,
          bgColor: prov.bgColor,
          borderColor: prov.borderColor
        });
      }
    });

    if (feedsToFetch.length === 0) {
      this.isLoading = false;
      container.innerHTML = `
        <div style="padding: 24px; text-align: center; border: 1px dashed rgba(0,0,0,0.12); border-radius: 12px; background: rgba(0,0,0,0.01);">
          <p style="font-size: 0.9rem; opacity: 0.8; margin-bottom: 8px;" data-i18n="No custom RSS feeds added yet.">No news sources selected.</p>
          <button id="btn-goto-custom-rss" class="settings-btn" style="width: auto; padding: 6px 14px; background: var(--primary-color); color: #fff; font-size: 0.85rem;" data-i18n="News Settings">News Settings</button>
        </div>
      `;
      document.getElementById('btn-goto-custom-rss')?.addEventListener('click', () => {
        document.getElementById('btn-news-settings')?.click();
      });
      return;
    }

    try {
      const results = await Promise.allSettled(feedsToFetch.map(feed => this.fetchFeedUrl(feed.url)));
      const feedBuckets = [];

      results.forEach((res, i) => {
        if (res.status === 'fulfilled' && res.value) {
          const feedInfo = feedsToFetch[i];
          const parsed = this.parseFeedXml(res.value, feedInfo);
          if (parsed && parsed.length > 0) {
            // Sort each source's items by date (newest first)
            parsed.sort((a, b) => (b.pubDate || 0) - (a.pubDate || 0));
            feedBuckets.push(parsed);
          }
        }
      });

      this.isLoading = false;
      if (feedBuckets.length === 0) {
        const failMsg = window.t ? window.t('Failed to load latest news.') : 'Failed to load latest news.';
        container.innerHTML = `<p style="opacity: 0.6; padding-left: 10px;">${failMsg}</p>`;
        return;
      }

      // Round-robin interleave across all sources so every provider and custom feed is fairly mixed!
      const rawParsedItems = [];
      const maxItemsInAnyFeed = Math.max(0, ...feedBuckets.map(b => b.length));

      for (let round = 0; round < maxItemsInAnyFeed; round++) {
        feedBuckets.forEach(bucket => {
          if (bucket[round]) {
            bucket[round]._feedRound = round;
            rawParsedItems.push(bucket[round]);
          }
        });
      }

      const filters = (window.settingsManager?.currentSettings?.newsWordFilters || []).map(w => w.toLowerCase());
      this.allItems = [];

      for (const item of rawParsedItems) {
        if (this.dismissedHeadlines[item.link]) continue;

        if (filters.length > 0) {
          const lowerTitle = item.title.toLowerCase();
          if (filters.some(f => lowerTitle.includes(f))) continue;
        }

        item.keywords = this.extractKeywords(item.title, item.description, item.categories);
        item.score = this.scoreItem(item);
        this.allItems.push(item);
      }

      // Calculate final score:
      // 1. Base round tier: Round 0 headlines from each source get 100, Round 1 gets 88, etc.
      // 2. Custom RSS bonus (+12): Curated user feeds get top prominence!
      // 3. Topic boost (+20 per liked topic level): Liked topics rise to the top from ANY source!
      this.allItems.forEach((item, idx) => {
        const round = item._feedRound !== undefined ? item._feedRound : Math.floor(idx / Math.max(1, feedBuckets.length));
        const baseRank = Math.max(10, 100 - (round * 12));
        const customBonus = item.isCustom ? 12 : 0;
        const topicBoost = (item.score || 0) * 10;

        item.finalScore = baseRank + customBonus + topicBoost;
      });

      // Sort by finalScore descending (shows user curated feeds + fresh mixed headlines + liked topics)
      this.allItems.sort((a, b) => b.finalScore - a.finalScore);

      this.shownIndices = [];
      for (let i = 0; i < Math.min(this.allItems.length, 3); i++) {
        this.shownIndices.push(i);
      }
      this.renderCards();
    } catch (e) {
      this.isLoading = false;
      const failMsg = window.t ? window.t('Failed to load latest news.') : 'Failed to load latest news.';
      container.innerHTML = `<p style="opacity: 0.6; padding-left: 10px;">${failMsg}</p>`;
    }
  }

  renderCards() {
    if (!this.container) return;
    this.container.innerHTML = '';

    const moreText = window.t ? window.t('More') : 'More';
    const lessText = window.t ? window.t('Less') : 'Less';
    const moreTitle = window.t ? window.t('Show more stories like this') : 'Show more stories like this';
    const lessTitle = window.t ? window.t('Show fewer stories like this') : 'Show fewer stories like this';
    const dismissTitle = window.t ? window.t('Dismiss story') : 'Dismiss story';

    const isClassic = !!(window.labsManager?.flags?.classic_news_dismiss || JSON.parse(localStorage.getItem('leef_labs_flags') || '{}').classic_news_dismiss);
    const dontCareText = window.t ? window.t("I Don't Care") : "I Don't Care";

    const privacyBadge = document.querySelector('.news-privacy-badge');
    if (privacyBadge) {
      privacyBadge.style.display = isClassic ? 'none' : 'inline-flex';
    }

    this.shownIndices.forEach((itemIdx, slotIdx) => {
      const item = this.allItems[itemIdx];
      if (!item) return;

      const isLiked = !!this.smartModel.likedUrls[item.link];
      const card = document.createElement('div');
      card.className = 'news-card';
      card.setAttribute('data-url', item.link);

      const actionsHtml = isClassic
        ? `<button class="news-action-btn btn-news-dismiss-classic" data-slot="${slotIdx}" title="${dontCareText}" data-i18n="I Don't Care">${dontCareText}</button>`
        : `
          <button class="news-action-btn btn-news-more ${isLiked ? 'active-liked' : ''}" data-slot="${slotIdx}" title="${moreTitle}" data-i18n-title="Show more stories like this">👍 <span data-i18n="More">${moreText}</span></button>
          <button class="news-action-btn btn-news-less" data-slot="${slotIdx}" title="${lessTitle}" data-i18n-title="Show fewer stories like this">👎 <span data-i18n="Less">${lessText}</span></button>
          <button class="news-dismiss-btn" data-slot="${slotIdx}" title="${dismissTitle}" data-i18n-title="Dismiss story">✕</button>
        `;

      card.innerHTML = `
        <img src="${item.imgSrc}" alt="News" class="news-img" loading="lazy" onerror="this.onerror=null; this.src='${FALLBACK_NEWS_IMG}';">
        <div class="news-content">
          <p class="news-title">${BrowserUtils.sanitize(item.title)}</p>
          <div class="news-bottom">
            <div class="news-source">
              <span class="news-source-pill" style="color: ${item.sourceColor}; background: ${item.sourceBg}; border: 1px solid ${item.sourceBorder};">
                <span class="news-source-dot" style="background-color: ${item.sourceColor};"></span>
                ${BrowserUtils.sanitize(item.sourceName || 'News')}
              </span>
              <svg class="external-icon" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-left: 5px; opacity: 0.65;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
            </div>
            <div class="news-actions">
              ${actionsHtml}
            </div>
          </div>
        </div>
      `;

      card.addEventListener('click', (e) => {
        if (e.target.closest('.news-actions') || e.target.closest('.news-action-btn') || e.target.closest('.news-dismiss-btn')) return;
        if (window.tabManager) window.tabManager.navigateToUrl(item.link);
      });

      card.querySelector('.btn-news-dismiss-classic')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.dismissCard(slotIdx);
      });

      card.querySelector('.btn-news-more')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.rateItem(slotIdx, 2);
      });

      card.querySelector('.btn-news-less')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.rateItem(slotIdx, -2);
      });

      card.querySelector('.news-dismiss-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.dismissCard(slotIdx);
      });

      this.container.appendChild(card);
    });

    if (window.sportsSvc && window.sportsSvc.lastChips && window.sportsSvc.lastChips.length > 0) {
      window.sportsSvc._render(window.sportsSvc.lastChips);
    }
  }

  dismissCard(slotIdx) {
    const itemIdx = this.shownIndices[slotIdx];
    const item = this.allItems[itemIdx];
    if (item) {
      this.dismissedHeadlines[item.link] = Date.now();
      this.saveDismissed();
    }

    const currentShown = new Set(this.shownIndices);
    let replacement = -1;
    for (let i = 0; i < this.allItems.length; i++) {
      if (!currentShown.has(i) && !this.dismissedHeadlines[this.allItems[i].link]) {
        replacement = i;
        break;
      }
    }

    if (replacement !== -1) {
      this.shownIndices[slotIdx] = replacement;
      this.renderCards();
    } else {
      this.shownIndices.splice(slotIdx, 1);
      this.renderCards();
      if (window.toastManager) {
        window.toastManager.show('📰 No More Headlines', 'You\'ve seen all available stories. Try refreshing later!', 4000);
      }
    }
  }

  reloadWithFilters() {
    this.allItems = [];
    this.shownIndices = [];
    this.isManualTrigger = true;
    this.loadNews();
  }
}

// --- LEAGUE METADATA CACHE ---
// Slugs are ESPN's stable permanent identifiers and never change.
// Display names (e.g. "FIFA World Cup 2026" → "FIFA World Cup 2030") are fetched
// from ESPN and cached locally for 24 hours so they update automatically each season.
class LeagueMetaCache {
  static CACHE_KEY = 'leef_league_meta_cache';
  static TTL = 24 * 60 * 60 * 1000; // 24 hours

  static load() {
    try { return JSON.parse(localStorage.getItem(LeagueMetaCache.CACHE_KEY) || '{}'); }
    catch { return {}; }
  }

  static save(cache) {
    localStorage.setItem(LeagueMetaCache.CACHE_KEY, JSON.stringify(cache));
  }

  // Returns cached display name if fresh, otherwise null
  static get(slug) {
    const cache = LeagueMetaCache.load();
    const entry = cache[slug];
    if (entry && (Date.now() - entry.ts < LeagueMetaCache.TTL) && ('isCurrentlyHappening' in entry)) return entry;
    return null;
  }

  // Fetch live from ESPN scoreboard (already called during refresh), cache & return
  static async fetch(sport, slug) {
    const cached = LeagueMetaCache.get(slug);
    if (cached) return cached;

    const https = window.require('https');
    const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${slug}/scoreboard`;
    const data = await new Promise(resolve => {
      https.get(url, { headers: { 'User-Agent': 'LeefBrowser/1.0', Accept: 'application/json' } }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { resolve(null); } });
      }).on('error', () => resolve(null));
    });

    if (!data) return null;
    const league = data.leagues?.[0];
    if (!league) return null;

    let isCurrentlyHappening = true;
    if (slug === 'fifa.world') {
      const now = new Date();
      const start = league.season?.startDate ? new Date(league.season.startDate) : null;
      const end = league.season?.endDate ? new Date(league.season.endDate) : null;
      if (!start || !end || now < start || now > end) {
        isCurrentlyHappening = false;
      } else if (Array.isArray(data.events)) {
        isCurrentlyHappening = data.events.some(e => {
          const isCompleted = e.competitions?.[0]?.status?.type?.completed;
          const eventDate = new Date(e.date);
          if (!isCompleted) return true;
          const ageMs = now - eventDate;
          return ageMs >= 0 && ageMs < 24 * 60 * 60 * 1000;
        });
      } else {
        isCurrentlyHappening = false;
      }
    }

    const entry = {
      ts: Date.now(),
      name: league.name,
      season: league.season?.displayName || league.season?.year?.toString() || '',
      // Whether the season is currently active (has events today)
      hasEvents: Array.isArray(data.events) && data.events.length > 0,
      startDate: league.season?.startDate || '',
      endDate: league.season?.endDate || '',
      isCurrentlyHappening,
    };
    const cache = LeagueMetaCache.load();
    cache[slug] = entry;
    LeagueMetaCache.save(cache);
    return entry;
  }
}

// --- SPORTS SERVICE ---
class SportsService {
  constructor() {
    this._refreshTimer = null;
    this.lastChips = []; // cache to avoid unnecessary redraws
  }

  // Stable ESPN sport/league identifiers. Slugs never change between seasons.
  // Display names are fetched live from ESPN via LeagueMetaCache.
  static get LEAGUES() {
    return [
      { emoji: '⚽', sport: 'soccer', slug: 'fifa.world' },
      { emoji: '⚽', sport: 'soccer', slug: 'uefa.champions' },
      { emoji: '⚽', sport: 'soccer', slug: 'eng.1' },
      { emoji: '⚽', sport: 'soccer', slug: 'esp.1' },
      { emoji: '⚽', sport: 'soccer', slug: 'ger.1' },
      { emoji: '⚽', sport: 'soccer', slug: 'ita.1' },
      { emoji: '⚽', sport: 'soccer', slug: 'fra.1' },
      { emoji: '⚽', sport: 'soccer', slug: 'usa.1' },
      { emoji: '🏀', sport: 'basketball', slug: 'nba' },
      { emoji: '🏀', sport: 'basketball', slug: 'wnba' },
      { emoji: '🏀', sport: 'basketball', slug: 'mens-college-basketball' },
      { emoji: '🏈', sport: 'football', slug: 'nfl' },
      { emoji: '🏈', sport: 'football', slug: 'college-football' },
      { emoji: '⚾', sport: 'baseball', slug: 'mlb' },
      { emoji: '🏒', sport: 'hockey', slug: 'nhl' },
    ];
  }

  // Resolve a human-readable name for a slug, using cache if available
  static getLeagueName(slug) {
    const cached = LeagueMetaCache.get(slug);
    let name = cached ? cached.name : slug.replace(/[._]/g, ' ').toUpperCase();
    if (name) {
      name = name.replace(/Football/g, 'American Football').replace(/football/g, 'american football');
      name = name.replace(/Soccer/g, 'Football').replace(/soccer/g, 'football');
      name = name.replace(/\bFIFA\b/g, 'FIFA®');
    }
    return name;
  }

  start() {
    this.refresh();
    // Auto-refresh every 60 seconds
    this._refreshTimer = setInterval(() => this.refresh(), 60 * 1000);
  }

  stop() {
    if (this._refreshTimer) { clearInterval(this._refreshTimer); this._refreshTimer = null; }
  }

  async refresh() {
    const followedTeams = window.settingsManager?.currentSettings?.followedTeams || [];
    if (followedTeams.length === 0) { this._hide(); return; }

    // Prune game-over times older than 24 hours to prevent localStorage bloating
    try {
      const now = Date.now();
      const ONE_DAY = 24 * 60 * 60 * 1000;
      const gameOverTimes = JSON.parse(localStorage.getItem('leef_game_over_times') || '{}');
      let changedGov = false;
      for (const key in gameOverTimes) {
        if (now - gameOverTimes[key] > ONE_DAY) {
          delete gameOverTimes[key];
          changedGov = true;
        }
      }
      if (changedGov) localStorage.setItem('leef_game_over_times', JSON.stringify(gameOverTimes));
    } catch (e) { }

    // Group followed teams by leagueSlug so we only fire one request per league
    const byLeague = {};
    followedTeams.forEach(t => {
      if (!byLeague[t.leagueSlug]) byLeague[t.leagueSlug] = { sport: t.sport, teams: [] };
      byLeague[t.leagueSlug].teams.push(t);
    });

    const chips = [];
    const https = window.require('https');

    const fetchJSON = (url) => new Promise((resolve) => {
      https.get(url, { headers: { 'User-Agent': 'LeefBrowser/1.0', Accept: 'application/json' } }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { resolve(null); } });
      }).on('error', () => resolve(null));
    });

    for (const [slug, { sport, teams }] of Object.entries(byLeague)) {
      const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${slug}/scoreboard?_t=${Date.now()}`;
      const data = await fetchJSON(url);
      if (!data || !data.events) continue;

      const followedIds = new Set(teams.map(t => String(t.teamId)));

      for (const event of data.events) {
        // Skip games that are too far in the past or future (e.g. ESPN off-season scoreboard fallback)
        if (event.date) {
          const eventDate = new Date(event.date);
          const diffMs = Math.abs(eventDate - Date.now());
          const MAX_DIFF = 3 * 24 * 60 * 60 * 1000; // 3 days window
          if (diffMs > MAX_DIFF) continue;
        }

        const comps = event.competitions?.[0];
        if (!comps) continue;
        const competitors = comps.competitors || [];
        // Only include if one of our followed teams is playing
        const myTeam = competitors.find(c => followedIds.has(String(c.id)));
        if (!myTeam) continue;

        const status = comps.status?.type;
        const isLive = status?.state === 'in';
        const isOver = status?.completed;
        const isUpcoming = !isLive && !isOver;

        const hideUntilNearStart = window.settingsManager?.currentSettings?.hideSportsUntilNearStart;
        if (hideUntilNearStart && isUpcoming && event.date) {
          const startTime = new Date(event.date);
          const diffMs = startTime - Date.now();
          if (diffMs > 10 * 60 * 1000) {
            continue;
          }
        }

        const [home, away] = competitors[0].homeAway === 'home'
          ? [competitors[0], competitors[1]]
          : [competitors[1], competitors[0]];

        const matchKey = `${home.team.abbreviation}-${away.team.abbreviation}`;

        // Filter out explicitly closed games
        try {
          const closedGames = JSON.parse(localStorage.getItem('leef_closed_games') || '[]');
          if (closedGames.includes(matchKey)) continue;
        } catch (e) { }

        const clock = status?.shortDetail || status?.detail || '';

        // Auto-remove 30 minutes after game is over
        if (!isOver) {
          try {
            const gameOverTimes = JSON.parse(localStorage.getItem('leef_game_over_times') || '{}');
            if (gameOverTimes[matchKey]) {
              delete gameOverTimes[matchKey];
              localStorage.setItem('leef_game_over_times', JSON.stringify(gameOverTimes));
            }
          } catch (e) { }
        } else {
          try {
            const gameOverTimes = JSON.parse(localStorage.getItem('leef_game_over_times') || '{}');
            if (!gameOverTimes[matchKey]) {
              gameOverTimes[matchKey] = Date.now();
              localStorage.setItem('leef_game_over_times', JSON.stringify(gameOverTimes));
            } else if (Date.now() - gameOverTimes[matchKey] > 30 * 60 * 1000) {
              continue; // Skip rendering this game
            }
          } catch (e) { }
        }

        // Calculate countdown timer for upcoming/scheduled games
        let displayClock = clock;
        if (isUpcoming && event.date) {
          const startTime = new Date(event.date);
          const diffMs = startTime - Date.now();
          if (diffMs > 0) {
            const diffMins = Math.floor(diffMs / 60000);
            if (diffMins < 60) {
              displayClock = `Starts in ${diffMins}m`;
            } else {
              const diffHours = Math.floor(diffMins / 60);
              const remainingMins = diffMins % 60;
              displayClock = `Starts in ${diffHours}h ${remainingMins}m`;
            }
          }
        }

        // For soccer, include group note if available
        const groupNote = comps.altGameNote ? ` · ${comps.altGameNote}` : '';

        chips.push({
          homeAbbr: home.team.abbreviation,
          awayAbbr: away.team.abbreviation,
          homeLogo: home.team.logo,
          awayLogo: away.team.logo,
          homeScore: isLive || isOver ? home.score : null,
          awayScore: isLive || isOver ? away.score : null,
          homeShootoutScore: home.shootoutScore,
          awayShootoutScore: away.shootoutScore,
          homeWinner: home.winner,
          awayWinner: away.winner,
          homeColor: '#' + (home.team.color || '17b340'),
          awayColor: '#' + (away.team.color || '17b340'),
          clock: displayClock,
          isLive,
          isOver,
          groupNote,
          leagueName: SportsService.getLeagueName(slug),
          leagueEmoji: SportsService.LEAGUES.find(l => l.slug === slug)?.emoji || '🏅',
        });
      }
    }

    if (chips.length === 0) { this._hide(); return; }
    this._render(chips);
  }

  _render(chips) {
    const oldChips = this.lastChips || [];
    this.lastChips = chips;
    const container = document.getElementById('dynamic-news-container');
    if (!container) return;

    const currentMatchKeys = chips.map(c => `${c.homeAbbr}-${c.awayAbbr}`);
    container.querySelectorAll('.news-card-score').forEach(el => {
      if (!currentMatchKeys.includes(el.dataset.matchKey)) el.remove();
    });

    let minimizedList = [];
    let maximizedList = [];
    let pinnedList = [];
    try {
      minimizedList = JSON.parse(localStorage.getItem('leef_minimized_games') || '[]');
      maximizedList = JSON.parse(localStorage.getItem('leef_maximized_games') || '[]');
      pinnedList = JSON.parse(localStorage.getItem('leef_pinned_games') || '[]');
    } catch (e) { }

    // Render pinned scores in the tab bar
    this._renderPinnedScores(chips, pinnedList, oldChips);

    // Inject one score card per chip at the top of the container
    chips.slice().reverse().forEach(chip => {
      const matchKey = `${chip.homeAbbr}-${chip.awayAbbr}`;
      const isNotStarted = !chip.isLive && !chip.isOver;
      const isMinimized = isNotStarted ? !maximizedList.includes(matchKey) : minimizedList.includes(matchKey);
      const isPinned = pinnedList.includes(matchKey);

      // Check for goals (score increased since last render)
      const oldChip = oldChips.find(c => c.homeAbbr === chip.homeAbbr && c.awayAbbr === chip.awayAbbr);
      const isHomeGoal = oldChip && oldChip.homeScore !== null && chip.homeScore !== null && parseInt(chip.homeScore) > parseInt(oldChip.homeScore);
      const isAwayGoal = oldChip && oldChip.awayScore !== null && chip.awayScore !== null && parseInt(chip.awayScore) > parseInt(oldChip.awayScore);

      let card = container.querySelector(`.news-card-score[data-match-key="${matchKey}"]`);
      if (!card) {
        card = document.createElement('div');
        card.dataset.matchKey = matchKey;
      }
      const isHT = chip.clock === 'HT' || chip.clock === 'Halftime';
      card.className = 'news-card news-card-score' + (chip.isLive ? ' score-live' : '') + (isHT ? ' score-ht' : '') + (chip.isOver ? ' score-over' : '') + (isMinimized ? ' minimized' : '');

      let homeWinner = false, awayWinner = false, homeLoser = false, awayLoser = false;
      if (chip.isOver) {
        if (chip.homeWinner === true) homeWinner = true;
        if (chip.awayWinner === true) awayWinner = true;

        if (!homeWinner && !awayWinner && chip.homeScore !== null && chip.awayScore !== null) {
          let h = parseInt(chip.homeScore), a = parseInt(chip.awayScore);
          if (chip.homeShootoutScore !== undefined && chip.awayShootoutScore !== undefined && h === a) {
            h = parseInt(chip.homeShootoutScore);
            a = parseInt(chip.awayShootoutScore);
          }
          if (h > a) { homeWinner = true; }
          else if (a > h) { awayWinner = true; }
        }

        if (homeWinner) awayLoser = true;
        if (awayWinner) homeLoser = true;
      }

      card.innerHTML = `
        <div class="score-card-actions" style="position: absolute; top: 10px; right: 15px; display: flex; gap: 8px; z-index: 10;">
          <button class="score-action-btn btn-score-pin ${isPinned ? 'pinned' : ''}" title="${isPinned ? 'Unpin from tab bar' : 'Pin to tab bar'}">
            📌
          </button>
          <button class="score-action-btn btn-score-minimize" title="${isMinimized ? 'Expand' : 'Minimize'}" style="background: transparent; border: none; cursor: pointer; opacity: 0.5; padding: 4px; display: flex; align-items: center; justify-content: center; color: inherit;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              ${isMinimized ? '<line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>' : '<line x1="5" y1="12" x2="19" y2="12"></line>'}
            </svg>
          </button>
          ${chip.isOver ? `
            <button class="score-action-btn btn-score-close" title="Close" style="background: transparent; border: none; cursor: pointer; opacity: 0.5; padding: 4px; display: flex; align-items: center; justify-content: center; color: inherit;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          ` : ''}
        </div>
        <div class="news-content" style="padding: 20px; align-items: center; justify-content: center; text-align: center;">
          <div class="score-card-league" style="margin-bottom: 12px;">${chip.leagueEmoji} ${chip.leagueName}${chip.groupNote}</div>
          <div class="score-card-matchup">
            <div class="score-card-team away ${awayWinner ? 'winner-team' : ''} ${awayLoser ? 'loser-team' : ''}">
              <img class="score-card-team-logo" src="${chip.awayLogo || ''}" onerror="this.style.display='none'" loading="lazy">
              <span class="score-card-team-name">${chip.awayAbbr}</span>
              ${awayWinner ? '<span class="winner-crown">👑</span>' : ''}
              ${chip.awayScore !== null ? `<span class="score-card-score-val ${isAwayGoal ? 'score-goal-anim' : ''}">${chip.awayScore}${chip.awayShootoutScore !== undefined ? `<span style="font-size: 0.6em; opacity: 0.8; margin-left: 3px;">(${chip.awayShootoutScore})</span>` : ''}</span>` : ''}
            </div>
            
            <div class="score-card-divider" style="display: flex; flex-direction: column; align-items: center; min-width: 60px;">
              <div class="score-card-status ${chip.isLive ? 'status-live' : chip.isOver ? 'status-over' : 'status-upcoming'}" style="font-size: 0.9rem; white-space: nowrap;">
                ${(isHomeGoal || isAwayGoal) ? `
                  <span class="score-goal-badge" style="background: #ffbc00; color: #000; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 0.75rem; animation: pulse 1.5s infinite;">⚽ GOAL!</span>
                ` : (chip.clock === 'HT' || chip.clock === 'Halftime') ? `
                  <span class="score-halftime-badge" style="background: #e65100; color: #fff; padding: 2px 8px; border-radius: 10px; font-weight: bold; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; display: inline-flex; align-items: center; gap: 4px; box-shadow: 0 2px 4px rgba(230,81,0,0.2);">⏸️ HT</span>
                ` : `
                  ${chip.isLive ? `<span class="status-live-dot" style="display: inline-block; margin-right: 4px;"></span>` : ''}
                  ${chip.isLive ? chip.clock : chip.isOver ? 'FT' : chip.clock}
                `}
              </div>
            </div>

            <div class="score-card-team home ${homeWinner ? 'winner-team' : ''} ${homeLoser ? 'loser-team' : ''}">
              ${homeWinner ? '<span class="winner-crown">👑</span>' : ''}
              <img class="score-card-team-logo" src="${chip.homeLogo || ''}" onerror="this.style.display='none'" loading="lazy">
              <span class="score-card-team-name">${chip.homeAbbr}</span>
              ${chip.homeScore !== null ? `<span class="score-card-score-val ${isHomeGoal ? 'score-goal-anim' : ''}">${chip.homeScore}${chip.homeShootoutScore !== undefined ? `<span style="font-size: 0.6em; opacity: 0.8; margin-left: 3px;">(${chip.homeShootoutScore})</span>` : ''}</span>` : ''}
            </div>
          </div>
        </div>
      `;
      if (!card.parentNode) {
        container.insertBefore(card, container.firstChild);
      }

      // Event listeners for actions
      const pinBtn = card.querySelector('.btn-score-pin');
      if (pinBtn) {
        pinBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          try {
            const list = JSON.parse(localStorage.getItem('leef_pinned_games') || '[]');
            const idx = list.indexOf(matchKey);
            if (idx !== -1) {
              list.splice(idx, 1);
            } else {
              list.push(matchKey);
            }
            localStorage.setItem('leef_pinned_games', JSON.stringify(list));
          } catch (err) { }
          this._render(this.lastChips);
        });
      }

      const minimizeBtn = card.querySelector('.btn-score-minimize');
      if (minimizeBtn) {
        minimizeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          try {
            const isNotStarted = !chip.isLive && !chip.isOver;
            if (isNotStarted) {
              const list = JSON.parse(localStorage.getItem('leef_maximized_games') || '[]');
              const idx = list.indexOf(matchKey);
              if (idx !== -1) {
                list.splice(idx, 1);
              } else {
                list.push(matchKey);
              }
              localStorage.setItem('leef_maximized_games', JSON.stringify(list));
            } else {
              const list = JSON.parse(localStorage.getItem('leef_minimized_games') || '[]');
              const idx = list.indexOf(matchKey);
              if (idx !== -1) {
                list.splice(idx, 1);
              } else {
                list.push(matchKey);
              }
              localStorage.setItem('leef_minimized_games', JSON.stringify(list));
            }
          } catch (err) { }
          this._render(this.lastChips);
        });
      }

      const closeBtn = card.querySelector('.btn-score-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          try {
            const list = JSON.parse(localStorage.getItem('leef_closed_games') || '[]');
            if (!list.includes(matchKey)) {
              list.push(matchKey);
              localStorage.setItem('leef_closed_games', JSON.stringify(list));
            }
          } catch (err) { }
          card.remove();
          this.refresh();
        });
      }

      if (isHomeGoal || isAwayGoal) {
        setTimeout(() => {
          const badge = card.querySelector('.score-goal-badge');
          if (badge) {
            badge.outerHTML = `
              ${chip.isLive ? `<span class="status-live-dot" style="display: inline-block; margin-right: 4px;"></span>` : ''}
              ${chip.isLive ? chip.clock : chip.isOver ? 'FT' : chip.clock}
            `;
          }
        }, 5000);
      }

      // Remove a regular news article to maintain the 3-item grid layout
      const allCards = container.querySelectorAll('.news-card');
      if (allCards.length > 3) {
        allCards[allCards.length - 1].remove();
      }
    });
  }

  _renderPinnedScores(chips, pinnedList, oldChips) {
    const container = document.getElementById('pinned-scores-container');
    if (!container) return;
    container.innerHTML = '';

    chips.forEach(chip => {
      const matchKey = `${chip.homeAbbr}-${chip.awayAbbr}`;
      if (!pinnedList.includes(matchKey)) return;

      const oldChip = (oldChips || []).find(c => c.homeAbbr === chip.homeAbbr && c.awayAbbr === chip.awayAbbr);
      const isHomeGoal = oldChip && oldChip.homeScore !== null && chip.homeScore !== null && parseInt(chip.homeScore) > parseInt(oldChip.homeScore);
      const isAwayGoal = oldChip && oldChip.awayScore !== null && chip.awayScore !== null && parseInt(chip.awayScore) > parseInt(oldChip.awayScore);
      const isGoal = isHomeGoal || isAwayGoal;

      const pill = document.createElement('div');
      const isHT = chip.clock === 'HT' || chip.clock === 'Halftime';
      pill.className = 'pinned-score-pill' + (chip.isLive ? ' score-live' : '') + (isHT ? ' score-ht' : '') + (isGoal ? ' goal-active' : '');
      const awayScStr = chip.awayScore !== null ? `${chip.awayScore}${chip.awayShootoutScore !== undefined ? `(${chip.awayShootoutScore})` : ''}` : '';
      const homeScStr = chip.homeScore !== null ? `${chip.homeScore}${chip.homeShootoutScore !== undefined ? `(${chip.homeShootoutScore})` : ''}` : '';
      const scoreStr = isGoal ? '⚽ GOAL!' : `${chip.awayAbbr} ${awayScStr} - ${homeScStr} ${chip.homeAbbr}${isHT ? ' (HT)' : ''}`;

      pill.innerHTML = `
        <div class="pill-content">
          ${isGoal ? '' : `<img src="${chip.awayLogo}" onerror="this.style.display='none'">`}
          <span>${scoreStr}</span>
          ${isGoal ? '' : `<img src="${chip.homeLogo}" onerror="this.style.display='none'">`}
        </div>
        <div class="unpin-overlay">Click to Unpin</div>
      `;
      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        try {
          let list = JSON.parse(localStorage.getItem('leef_pinned_games') || '[]');
          list = list.filter(k => k !== matchKey);
          localStorage.setItem('leef_pinned_games', JSON.stringify(list));
        } catch (err) { }
        this._render(this.lastChips);
      });
      if (isGoal) {
        setTimeout(() => {
          pill.classList.remove('goal-active');
          const content = pill.querySelector('.pill-content');
          if (content) {
            content.innerHTML = `
              <img src="${chip.awayLogo}" onerror="this.style.display='none'">
              <span>${chip.awayAbbr} ${chip.awayScore !== null ? `${chip.awayScore}${chip.awayShootoutScore !== undefined ? `(${chip.awayShootoutScore})` : ''}` : ''} - ${chip.homeScore !== null ? `${chip.homeScore}${chip.homeShootoutScore !== undefined ? `(${chip.homeShootoutScore})` : ''}` : ''} ${chip.homeAbbr}</span>
              <img src="${chip.homeLogo}" onerror="this.style.display='none'">
            `;
          }
        }, 5000);
      }

      container.appendChild(pill);
    });
  }

  _hide() {
    this.lastChips = [];
    document.getElementById('dynamic-news-container')
      ?.querySelectorAll('.news-card-score')
      .forEach(el => el.remove());
    const pinnedContainer = document.getElementById('pinned-scores-container');
    if (pinnedContainer) pinnedContainer.innerHTML = '';
  }
}

// --- SPORTS TEAM PICKER (used in settings UI) ---
class SportsTeamPicker {
  constructor(settingsManager) {
    this.settingsManager = settingsManager;
    this.container = document.getElementById('sports-team-picker');
    if (!this.container) return;
    this._renderLeagues();
    this._bindFollowedTagsRender();
  }

  _renderLeagues() {
    this.container.innerHTML = '';

    const sportMeta = {
      football: { name: 'American Football', emoji: '🏈' },
      basketball: { name: 'Basketball', emoji: '🏀' },
      baseball: { name: 'Baseball', emoji: '⚾' },
      hockey: { name: 'Hockey', emoji: '🏒' },
      soccer: { name: 'Football / Soccer', emoji: '⚽' }
    };

    // Group leagues by sport
    const grouped = {};
    SportsService.LEAGUES.forEach(league => {
      if (!grouped[league.sport]) grouped[league.sport] = [];
      grouped[league.sport].push(league);
    });

    // Render each sport group
    Object.entries(grouped).forEach(([sportId, leagues]) => {
      const meta = sportMeta[sportId] || { name: sportId.toUpperCase(), emoji: '🏅' };

      const sportGroup = document.createElement('div');
      sportGroup.className = 'sport-group';
      sportGroup.innerHTML = `
        <button class="sport-toggle" data-sport-id="${sportId}">
          <span>${meta.emoji} ${meta.name}</span>
          <svg class="sport-league-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="sport-leagues-container" id="leagues-${sportId}" style="display:none;"></div>
      `;

      const toggleBtn = sportGroup.querySelector('.sport-toggle');
      const leaguesDiv = sportGroup.querySelector('.sport-leagues-container');
      const chevron = sportGroup.querySelector('.sport-league-chevron');

      toggleBtn.addEventListener('click', () => {
        if (leaguesDiv.style.display === 'none') {
          leaguesDiv.style.display = 'flex';
          chevron.style.transform = 'rotate(180deg)';
        } else {
          leaguesDiv.style.display = 'none';
          chevron.style.transform = '';
        }
      });

      // Render leagues inside this sport
      leagues.forEach(league => {
        const leagueGroup = document.createElement('div');
        leagueGroup.className = 'sport-league-group';
        const placeholderName = SportsService.getLeagueName(league.slug);
        leagueGroup.innerHTML = `
          <button class="sport-league-toggle" data-slug="${league.slug}" data-sport="${league.sport}">
            <span class="sport-league-label">${league.emoji} <span class="league-name-text">${placeholderName}</span></span>
            <svg class="sport-league-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <div class="sport-league-teams" id="teams-${league.slug}" style="display:none;"></div>
        `;
        leagueGroup.querySelector('.sport-league-toggle').addEventListener('click', () => {
          this._toggleLeague(league);
        });

        leaguesDiv.appendChild(leagueGroup);

        LeagueMetaCache.fetch(league.sport, league.slug).then(meta => {
          if (!meta) return;
          const nameEl = leagueGroup.querySelector('.league-name-text');

          if (meta.isCurrentlyHappening === false) {
            leagueGroup.classList.add('inactive-league');
            if (nameEl) nameEl.textContent = SportsService.getLeagueName(league.slug) + ' (Off-season)';
          } else {
            leagueGroup.classList.remove('inactive-league');
            if (nameEl) nameEl.textContent = SportsService.getLeagueName(league.slug);
          }
        });
      });

      this.container.appendChild(sportGroup);
    });
  }

  async _toggleLeague(league) {
    const teamsDiv = document.getElementById(`teams-${league.slug}`);
    const chevron = this.container.querySelector(`[data-slug="${league.slug}"] .sport-league-chevron`);
    if (!teamsDiv) return;

    if (teamsDiv.style.display !== 'none') {
      teamsDiv.style.display = 'none';
      chevron.style.transform = '';
      return;
    }

    // Show loading state
    teamsDiv.style.display = 'block';
    chevron.style.transform = 'rotate(180deg)';
    teamsDiv.innerHTML = '<p class="sport-loading">Loading teams...</p>';

    const https = window.require('https');
    const url = `https://site.api.espn.com/apis/site/v2/sports/${league.sport}/${league.slug}/teams`;
    const data = await new Promise(resolve => {
      https.get(url, { headers: { 'User-Agent': 'LeefBrowser/1.0', Accept: 'application/json' } }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { resolve(null); } });
      }).on('error', () => resolve(null));
    });

    if (!data) { teamsDiv.innerHTML = '<p class="sport-loading">Failed to load teams.</p>'; return; }

    const teams = (data.sports?.[0]?.leagues?.[0]?.teams || []).map(t => t.team);
    if (!teams.length) { teamsDiv.innerHTML = '<p class="sport-loading">No teams found.</p>'; return; }

    const followed = this.settingsManager.currentSettings.followedTeams || [];
    teamsDiv.innerHTML = '';

    // Search box
    const searchWrap = document.createElement('div');
    searchWrap.className = 'sport-team-search-wrap';
    searchWrap.innerHTML = `<input type="text" class="sport-team-search" placeholder="Filter teams..." autocomplete="off">`;
    teamsDiv.appendChild(searchWrap);

    const listDiv = document.createElement('div');
    listDiv.className = 'sport-team-list';
    teamsDiv.appendChild(listDiv);

    const renderList = (filter = '') => {
      const lower = filter.toLowerCase();
      listDiv.innerHTML = '';
      teams
        .filter(t => !filter || t.displayName.toLowerCase().includes(lower))
        .forEach(team => {
          const isChecked = followed.some(f => f.teamId === team.id && f.leagueSlug === league.slug);
          const row = document.createElement('label');
          row.className = 'sport-team-row' + (isChecked ? ' checked' : '');
          const logoUrl = team.logos?.[0]?.href || '';
          row.innerHTML = `
            <img class="sport-team-logo" src="${logoUrl}" loading="lazy" onerror="this.style.display='none'">
            <span>${team.displayName}</span>
            <input type="checkbox" class="sport-team-check" ${isChecked ? 'checked' : ''} style="margin-left:auto;">
          `;
          row.querySelector('input').addEventListener('change', e => {
            const current = this.settingsManager.currentSettings.followedTeams || [];
            if (e.target.checked) {
              if (!current.some(f => f.teamId === team.id && f.leagueSlug === league.slug)) {
                current.push({ teamId: team.id, teamName: team.displayName, leagueSlug: league.slug, sport: league.sport, leagueName: SportsService.getLeagueName(league.slug) });
              }
              row.classList.add('checked');
            } else {
              const idx = current.findIndex(f => f.teamId === team.id && f.leagueSlug === league.slug);
              if (idx !== -1) current.splice(idx, 1);
              row.classList.remove('checked');
            }
            this.settingsManager.currentSettings.followedTeams = current;
            localStorage.setItem('leef_settings', JSON.stringify(this.settingsManager.currentSettings));
            this._bindFollowedTagsRender();
            if (window.sportsSvc) window.sportsSvc.refresh();
          });
          listDiv.appendChild(row);
        });
    };

    renderList();
    searchWrap.querySelector('input').addEventListener('input', e => renderList(e.target.value));
  }

  _bindFollowedTagsRender() {
    const tagContainer = document.getElementById('followed-teams-tags');
    if (!tagContainer) return;
    const followed = this.settingsManager.currentSettings.followedTeams || [];
    tagContainer.innerHTML = '';
    if (followed.length === 0) {
      tagContainer.innerHTML = '<span class="news-filter-empty">No teams followed yet.</span>';
      return;
    }
    followed.forEach((t, i) => {
      const tag = document.createElement('span');
      tag.className = 'news-filter-tag';
      tag.textContent = t.teamName + ' ';

      const hint = document.createElement('span');
      hint.className = 'tag-league-hint';
      hint.textContent = t.leagueName;
      tag.appendChild(hint);

      tag.appendChild(document.createTextNode(' '));

      const btn = document.createElement('button');
      btn.className = 'tag-remove';
      btn.title = 'Unfollow';
      btn.textContent = '✕';
      tag.appendChild(btn);

      btn.addEventListener('click', () => {
        const current = this.settingsManager.currentSettings.followedTeams || [];
        current.splice(i, 1);
        this.settingsManager.currentSettings.followedTeams = current;
        localStorage.setItem('leef_settings', JSON.stringify(this.settingsManager.currentSettings));
        this._bindFollowedTagsRender();
        if (window.sportsSvc) window.sportsSvc.refresh();
      });
      tagContainer.appendChild(tag);
    });
  }
}

// --- NEWS WORD FILTER UI (used in settings) ---
class NewsWordFilterUI {
  constructor(settingsManager) {
    this.settingsManager = settingsManager;
    this.input = document.getElementById('news-word-filter-input');
    this.addBtn = document.getElementById('news-word-filter-add');
    this.tagContainer = document.getElementById('news-word-filter-tags');
    if (!this.input || !this.addBtn) return;
    this.addBtn.addEventListener('click', () => this._addWord());
    this.input.addEventListener('keydown', e => { if (e.key === 'Enter') this._addWord(); });
    this._render();
  }

  _addWord() {
    const word = this.input.value.trim().toLowerCase();
    if (!word) return;
    const filters = this.settingsManager.currentSettings.newsWordFilters || [];
    if (!filters.includes(word)) {
      filters.push(word);
      this.settingsManager.currentSettings.newsWordFilters = filters;
      localStorage.setItem('leef_settings', JSON.stringify(this.settingsManager.currentSettings));
      if (window.newsSvc) window.newsSvc.reloadWithFilters();
    }
    this.input.value = '';
    this._render();
  }

  _render() {
    if (!this.tagContainer) return;
    const filters = this.settingsManager.currentSettings.newsWordFilters || [];
    this.tagContainer.innerHTML = '';
    if (filters.length === 0) {
      this.tagContainer.innerHTML = '<span class="news-filter-empty">No filters added.</span>';
      return;
    }
    filters.forEach((word, i) => {
      const tag = document.createElement('span');
      tag.className = 'news-filter-tag';
      tag.textContent = word + ' ';

      const btn = document.createElement('button');
      btn.className = 'tag-remove';
      btn.title = 'Remove';
      btn.textContent = '✕';
      tag.appendChild(btn);

      btn.addEventListener('click', () => {
        filters.splice(i, 1);
        this.settingsManager.currentSettings.newsWordFilters = filters;
        localStorage.setItem('leef_settings', JSON.stringify(this.settingsManager.currentSettings));
        if (window.newsSvc) window.newsSvc.reloadWithFilters();
        this._render();
      });
      this.tagContainer.appendChild(tag);
    });
  }
}

// --- SMART NEWS & RSS FEEDS UI (in Hub settings) ---
class SmartNewsUI {
  constructor(settingsManager) {
    this.settingsManager = settingsManager;
    this.providerGrid = document.getElementById('news-provider-grid');
    this.onboardProviderGrid = document.getElementById('onboard-news-provider-grid');
    this.rssNameInput = document.getElementById('custom-rss-name-input');
    this.rssUrlInput = document.getElementById('custom-rss-url-input');
    this.addRssBtn = document.getElementById('btn-add-custom-rss');
    this.rssTagsContainer = document.getElementById('custom-rss-tags');
    this.smartTopicsContainer = document.getElementById('smart-news-topic-tags');
    this.resetSmartBtn = document.getElementById('btn-reset-smart-news');

    this.bindEvents();
    this.topicsExpanded = false;
    this.render();
  }

  bindEvents() {
    if (this.addRssBtn) {
      this.addRssBtn.addEventListener('click', () => this.addCustomRss());
    }
    if (this.rssUrlInput) {
      this.rssUrlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.addCustomRss();
      });
    }

    if (this.resetSmartBtn) {
      this.resetSmartBtn.addEventListener('click', () => {
        if (window.newsSvc) {
          window.newsSvc.resetSmartPreferences();
          if (window.toastManager) {
            window.toastManager.show('⚙️ Settings Saved', 'Smart preferences reset. Your news feed is back to neutral.', 3000);
          }
        }
        this.renderSmartTopics();
      });
    }

    const toggleBtn = document.getElementById('btn-toggle-smart-topics');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        this.topicsExpanded = !this.topicsExpanded;
        this.renderSmartTopics();
      });
    }

    window.addEventListener('leef-news-smart-updated', () => {
      this.renderSmartTopics();
    });
  }

  getSelectedProviders() {
    const setting = this.settingsManager.currentSettings.newsProvider;
    if (Array.isArray(setting)) return setting;
    if (typeof setting === 'string' && setting) return [setting];
    return ['bbc'];
  }

  saveSelectedProviders(selectedArray) {
    this.settingsManager.currentSettings.newsProvider = selectedArray;
    localStorage.setItem('leef_settings', JSON.stringify(this.settingsManager.currentSettings));
    if (window.newsSvc) window.newsSvc.refresh();
    this.renderProviderGrids();
  }

  renderProviderGrids() {
    const selected = this.getSelectedProviders();
    const providersList = [
      { id: 'bbc', label: 'BBC News' },
      { id: 'yahoo', label: 'Yahoo News' },
      { id: 'npr', label: 'NPR News' },
      { id: 'dw', label: 'Deutsche Welle' },
      { id: 'france24', label: 'France 24' },
      { id: 'nos', label: 'NOS Nieuws' }
    ];

    const createGridContent = (targetContainer) => {
      if (!targetContainer) return;
      targetContainer.innerHTML = '';

      providersList.forEach(prov => {
        const provMeta = NEWS_PROVIDERS[prov.id] || {};
        const isChecked = selected.includes(prov.id);
        const card = document.createElement('label');
        card.className = `news-provider-checkbox-card ${isChecked ? 'selected' : ''}`;
        if (provMeta.color) {
          card.style.setProperty('--provider-color', provMeta.color);
        }
        if (provMeta.bgColor) {
          card.style.setProperty('--provider-bg', provMeta.bgColor);
        }
        if (provMeta.glowColor) {
          card.style.setProperty('--provider-glow', provMeta.glowColor);
        }

        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.value = prov.id;
        chk.checked = isChecked;

        chk.addEventListener('change', () => {
          let current = [...this.getSelectedProviders()];
          if (chk.checked) {
            if (!current.includes(prov.id)) current.push(prov.id);
          } else {
            current = current.filter(id => id !== prov.id);
          }
          if (current.length === 0) {
            current = ['bbc']; // fallback if user unchecks all
          }
          this.saveSelectedProviders(current);
        });

        // Top Row: Brand Badge and Circular Custom Checkmark
        const topRow = document.createElement('div');
        topRow.className = 'news-provider-card-top';

        const badgeIcon = document.createElement('span');
        badgeIcon.className = 'news-provider-badge-icon';
        badgeIcon.textContent = provMeta.brandTag || provMeta.shortName || prov.label;

        const customChk = document.createElement('span');
        customChk.className = 'news-provider-custom-chk';
        customChk.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

        topRow.appendChild(badgeIcon);
        topRow.appendChild(customChk);

        // Bottom Info: Title & Subtitle
        const info = document.createElement('div');
        info.className = 'news-provider-info';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'news-provider-name';
        nameSpan.textContent = prov.label;

        const subSpan = document.createElement('span');
        subSpan.className = 'news-provider-sub';
        subSpan.textContent = provMeta.sub || 'Headlines';

        info.appendChild(nameSpan);
        info.appendChild(subSpan);

        card.appendChild(chk);
        card.appendChild(topRow);
        card.appendChild(info);
        targetContainer.appendChild(card);
      });
    };

    createGridContent(this.providerGrid);
    createGridContent(this.onboardProviderGrid);
  }

  getCustomFeeds() {
    try {
      return JSON.parse(localStorage.getItem('leef_custom_rss_feeds') || '[]');
    } catch {
      return [];
    }
  }

  saveCustomFeeds(feeds) {
    localStorage.setItem('leef_custom_rss_feeds', JSON.stringify(feeds));
    this.renderCustomFeeds();
    if (window.newsSvc) window.newsSvc.refresh();
  }

  addCustomRss() {
    if (!this.rssUrlInput) return;
    let url = this.rssUrlInput.value.trim();
    if (!url) return;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    let name = this.rssNameInput?.value?.trim() || '';
    if (!name) {
      try {
        name = new URL(url).hostname.replace(/^www\./, '');
      } catch {
        name = 'Custom Feed';
      }
    }

    const feeds = this.getCustomFeeds();
    feeds.push({
      id: 'feed_' + Date.now(),
      name,
      url,
      enabled: true
    });

    this.saveCustomFeeds(feeds);

    if (this.rssNameInput) this.rssNameInput.value = '';
    if (this.rssUrlInput) this.rssUrlInput.value = '';

    if (window.toastManager) {
      window.toastManager.show('✅ Tile Added', 'Feed added successfully!', 3000);
    }
  }

  render() {
    this.renderProviderGrids();
    this.renderCustomFeeds();
    this.renderSmartTopics();
  }

  renderCustomFeeds() {
    if (!this.rssTagsContainer) return;
    const feeds = this.getCustomFeeds();
    this.rssTagsContainer.innerHTML = '';

    if (feeds.length === 0) {
      const emptyMsg = window.t ? window.t('No custom RSS feeds added yet.') : 'No custom RSS feeds added yet.';
      this.rssTagsContainer.innerHTML = `<span class="news-filter-empty">${emptyMsg}</span>`;
      return;
    }

    feeds.forEach((feed, idx) => {
      const tag = document.createElement('span');
      tag.className = 'news-filter-tag';
      tag.title = feed.url;
      let host = '';
      try { host = new URL(feed.url).hostname; } catch {}
      tag.innerHTML = `<span>${BrowserUtils.sanitize(feed.name)}</span> <span class="tag-league-hint">${BrowserUtils.sanitize(host)}</span>`;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'tag-remove';
      removeBtn.title = 'Remove Feed';
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', () => {
        feeds.splice(idx, 1);
        this.saveCustomFeeds(feeds);
      });

      tag.appendChild(removeBtn);
      this.rssTagsContainer.appendChild(tag);
    });
  }

  renderSmartTopics() {
    if (!this.smartTopicsContainer) return;
    const model = window.newsSvc?.smartModel || { topics: {} };
    const topics = model.topics || {};
    this.smartTopicsContainer.innerHTML = '';

    const toggleBtn = document.getElementById('btn-toggle-smart-topics');
    const activeEntries = Object.entries(topics).filter(([_, weight]) => weight !== 0);

    if (activeEntries.length === 0) {
      if (toggleBtn) toggleBtn.style.display = 'none';
      const emptyMsg = window.t ? window.t('No tuned topics yet. Use 👍 and 👎 on news cards to train your feed.') : 'No tuned topics yet. Use 👍 and 👎 on news cards to train your feed.';
      this.smartTopicsContainer.innerHTML = `<span class="news-filter-empty">${emptyMsg}</span>`;
      return;
    }

    // Sort by absolute score descending
    activeEntries.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));

    const INITIAL_LIMIT = 8;
    const needsToggle = activeEntries.length > INITIAL_LIMIT;

    if (toggleBtn) {
      if (needsToggle) {
        toggleBtn.style.display = 'inline-flex';
        const showAllText = window.t ? window.t('Show all {count} topics ▾', { count: activeEntries.length }) : `Show all ${activeEntries.length} topics ▾`;
        const showLessText = window.t ? window.t('Show less ▴') : 'Show less ▴';
        toggleBtn.textContent = this.topicsExpanded ? showLessText : showAllText;
      } else {
        toggleBtn.style.display = 'none';
      }
    }

    const visibleEntries = (needsToggle && !this.topicsExpanded)
      ? activeEntries.slice(0, INITIAL_LIMIT)
      : activeEntries;

    visibleEntries.forEach(([topic, weight]) => {
      const tag = document.createElement('span');
      const isPositive = weight > 0;
      tag.className = `news-filter-tag ${isPositive ? 'smart-tag-pos' : 'smart-tag-neg'}`;
      tag.textContent = `${topic} (${isPositive ? '+' : ''}${weight}) `;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'tag-remove';
      removeBtn.title = 'Reset Topic';
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', () => {
        delete topics[topic];
        window.newsSvc?.saveSmartModel();
        this.renderSmartTopics();
        if (window.newsSvc) window.newsSvc.refresh();
      });

      tag.appendChild(removeBtn);
      this.smartTopicsContainer.appendChild(tag);
    });
  }
}

class QuickLinksUI {
  constructor(settingsManager) {
    this.settingsManager = settingsManager;
    this.input = document.getElementById('quick-links-input');
    this.addBtn = document.getElementById('quick-links-add');
    this.tagContainer = document.getElementById('quick-links-tags');
    if (!this.input || !this.addBtn) return;
    this.addBtn.addEventListener('click', () => this._addDomain());
    this.input.addEventListener('keydown', e => { if (e.key === 'Enter') this._addDomain(); });
    this._render();
  }

  _addDomain() {
    let domain = this.input.value.trim().toLowerCase();
    if (!domain) return;
    domain = domain.replace(/^(https?:\/\/)?(www\.)?/, ''); // Cleanup
    const linksStr = this.settingsManager.currentSettings.quickLinksStr || "";
    let links = linksStr.split('\n').map(l => l.trim().toLowerCase()).filter(l => l.length > 0);

    if (!links.includes(domain)) {
      links.push(domain);
      this.settingsManager.currentSettings.quickLinksStr = links.join('\n');
      localStorage.setItem('leef_settings', JSON.stringify(this.settingsManager.currentSettings));
    }
    this.input.value = '';
    this._render();
  }

  _render() {
    if (!this.tagContainer) return;
    const linksStr = this.settingsManager.currentSettings.quickLinksStr || "";
    let links = linksStr.split('\n').map(l => l.trim().toLowerCase()).filter(l => l.length > 0);

    this.tagContainer.innerHTML = '';
    if (links.length === 0) {
      this.tagContainer.innerHTML = '<span class="news-filter-empty">No quick links added.</span>';
      return;
    }
    links.forEach((domain, i) => {
      const tag = document.createElement('span');
      tag.className = 'news-filter-tag';
      tag.textContent = domain + ' ';

      const btn = document.createElement('button');
      btn.className = 'tag-remove';
      btn.title = 'Remove';
      btn.textContent = '✕';
      tag.appendChild(btn);

      btn.addEventListener('click', () => {
        links.splice(i, 1);
        this.settingsManager.currentSettings.quickLinksStr = links.join('\n');
        localStorage.setItem('leef_settings', JSON.stringify(this.settingsManager.currentSettings));
        this._render();
      });
      this.tagContainer.appendChild(tag);
    });
  }
}

// --- NATIVE DICTIONARY HELPERS ---
const LEEF_DICT_CSS = `
  #leef-dict-card *{box-sizing:border-box;}
  #leef-dict-card{
    font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    border-radius:16px;
    padding:20px 24px 18px;
    margin-bottom:24px;
    position:relative;
    background:#f8fcf8;
    border:2px solid #82efa2;
    color:#111;
    box-shadow:0 4px 15px rgba(23,179,64,0.08);
  }
  @media(prefers-color-scheme:dark){
    #leef-dict-card{background:#111b13;color:#e2f5e4;border:2px solid #17b340;box-shadow:0 4px 18px rgba(0,0,0,0.4);}
    #leef-dict-card .ld-phonetic span{color:#999;}
  }
  #leef-dict-badge{
    position:absolute;top:14px;right:16px;
    background:#17b340;
    color:#fff;font-size:0.65rem;font-weight:700;letter-spacing:0.06em;
    text-transform:uppercase;padding:3px 10px;border-radius:20px;
  }
  #leef-dict-word{font-size:2rem;font-weight:700;margin:0 0 6px;line-height:1.1;}
  .ld-phonetic{font-size:1rem;color:#555;margin-bottom:16px;display:flex;align-items:center;gap:12px;}
  #leef-audio-btn{background:none;border:none;cursor:pointer;
    color:#17b340;padding:6px;border-radius:50%;display:flex;align-items:center;
    transition:background 0.2s;margin-left:-6px;}
  #leef-audio-btn:hover{background:rgba(23,179,64,0.12);}
  #leef-audio-btn.playing{opacity:0.5;cursor:default;}
  .ld-pos{font-style:italic;font-size:0.9rem;font-weight:600;color:#17b340;margin:14px 0 6px;text-transform:lowercase;}
  .ld-def-ol{margin:0 0 0 24px;padding:0;list-style-type:decimal;}
  .ld-def-li{margin-bottom:10px;font-size:0.95rem;line-height:1.5;}
  .ld-example{font-style:italic;font-size:0.85rem;color:#777;margin-top:3px;}
  .ld-footer{
    position:absolute;bottom:14px;right:16px;
    background:transparent;border:none;cursor:pointer;
    color:#17b340;opacity:0.6;padding:4px;border-radius:50%;
    transition:opacity 0.2s,background 0.2s;display:flex;
  }
  .ld-footer:hover{opacity:1;background:rgba(23,179,64,0.1);}

  /* Skeleton animation styles */
  @keyframes ld-pulse {
    0%, 100% { opacity: 0.3; }
    50%       { opacity: 0.65; }
  }
  .ld-skel {
    border-radius: 7px;
    background: rgba(23, 179, 64, 0.25);
    animation: ld-pulse 1.4s ease-in-out infinite;
    margin-bottom: 7px;
  }
  @media(prefers-color-scheme:light){
    .ld-skel {
      background: rgba(23, 179, 64, 0.15);
    }
  }


  .ld-fetching {
    margin-top: 14px;
    font-size: 0.75rem;
    color: #17b340;
    opacity: 0.7;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .ld-fetching::before {
    content: '';
    width: 8px; height: 8px;
    border-radius: 50%;
    background: #17b340;
    animation: ld-pulse 1s ease-in-out infinite;
    display: inline-block;
    flex-shrink: 0;
  }
`;

function getInjectSkeletonJS() {
  return `
    (() => {
      if (document.getElementById('leef-dict-card')) return;
      window.__leefDictFetched = false;

      if (!document.getElementById('leef-dict-styles')) {
        const s = document.createElement('style');
        s.id = 'leef-dict-styles';
        s.textContent = ${JSON.stringify(LEEF_DICT_CSS)};
        document.head.appendChild(s);
      }

      function getCol() {
        return document.getElementById('center_col') ||
               document.getElementById('rso') ||
               document.getElementById('search') ||
               document.querySelector('div[role="main"]') ||
               document.getElementById('main') ||
               document.querySelector('#rcnt');
      }

      function inject(colEl) {
        if (document.getElementById('leef-dict-card')) return;
        const card = document.createElement('div');
        card.id = 'leef-dict-card';
        card.innerHTML = \`
          <div id="leef-dict-badge">Leef Dictionary <span style="font-size: 0.52rem; font-weight: 800; background: rgba(255,255,255,0.22); color: #fff; padding: 1px 4px; border-radius: 4px; margin-left: 4px; vertical-align: middle; display: inline-block;">BETA</span></div>
          <div class="ld-skel" style="width:42%;height:28px;margin-bottom:8px;"></div>
          <div class="ld-skel" style="width:22%;height:13px;margin-bottom:18px;"></div>
          <div class="ld-skel" style="width:10%;height:11px;margin-bottom:6px;"></div>
          <div class="ld-skel" style="width:82%;height:12px;"></div>
          <div class="ld-skel" style="width:65%;height:12px;"></div>
          <div class="ld-skel" style="width:10%;height:11px;margin-top:12px;margin-bottom:6px;"></div>
          <div class="ld-skel" style="width:88%;height:12px;"></div>
          <div class="ld-skel" style="width:52%;height:12px;"></div>
          <div class="ld-fetching">Fetching definition\u2026</div>
        \`;
        colEl.insertBefore(card, colEl.firstChild);
        console.log('LEEF_DICT_HIDE_LOADER');
      }

      function start() {
        const col = getCol();
        if (col) {
          inject(col);
          setupObserver(col);
        } else {
          const docObserver = new MutationObserver(() => {
            const colEl = getCol();
            if (colEl) {
              docObserver.disconnect();
              inject(colEl);
              setupObserver(colEl);
            }
          });
          docObserver.observe(document.documentElement, { childList: true, subtree: true });
          window.__leefDictDocObserver = docObserver;
        }
      }

      function setupObserver(colEl) {
        if (window.__leefDictObserver) {
          window.__leefDictObserver.disconnect();
        }
        if (window.__leefDictDocObserver) {
          window.__leefDictDocObserver.disconnect();
          delete window.__leefDictDocObserver;
        }
        const observer = new MutationObserver(() => {
          if (!document.getElementById('leef-dict-card') && !window.__leefDictFetched) {
            // colEl may have been replaced by Google; re-resolve
            const freshCol = getCol();
            inject(freshCol || colEl);
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        window.__leefDictObserver = observer;
      }

      start();
    })();
  `;
}

async function fetchWordDefinition(word) {
  const cleanWord = word.trim().toLowerCase();
  
  // 1. Try Free Dictionary API with a 3.5s timeout
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3500);
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(cleanWord)}`, {
      signal: ctrl.signal
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      if (data && data.length) return data[0];
    }
  } catch (e) {
    // Timeout or network error, proceed to fallback
  }

  // 2. Fallback to Wikimedia Wiktionary REST API (fast, reliable, global CDN)
  try {
    const wCtrl = new AbortController();
    const wTimer = setTimeout(() => wCtrl.abort(), 4000);
    const wRes = await fetch(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(cleanWord)}`, {
      signal: wCtrl.signal
    });
    clearTimeout(wTimer);
    if (wRes.ok) {
      const wData = await wRes.json();
      if (wData && wData.en && wData.en.length) {
        const stripHtml = (html) => (html || '').replace(/<[^>]+>/g, '').trim();
        const meanings = wData.en.slice(0, 3).map(section => ({
          partOfSpeech: (section.partOfSpeech || '').toLowerCase(),
          definitions: (section.definitions || []).slice(0, 2).map(d => ({
            definition: stripHtml(d.definition || ''),
            example: stripHtml(d.examples && d.examples[0] ? d.examples[0] : (d.parsedExamples && d.parsedExamples[0] ? d.parsedExamples[0].example : ''))
          })).filter(d => d.definition)
        })).filter(m => m.definitions.length > 0);

        if (meanings.length > 0) {
          return {
            word: word,
            phonetic: '',
            audio: '',
            meanings: meanings
          };
        }
      }
    }
  } catch (e) {
    // Wiktionary failed or timed out
  }

  throw new Error('Definition not found');
}

function getInjectSuccessJS(entry) {
  const phoneticText = entry.phonetic ||
    (entry.phonetics && entry.phonetics.find(p => p.text)?.text) || '';
  const audioUrl = (entry.phonetics &&
    entry.phonetics.find(p => p.audio && p.audio.startsWith('https'))?.audio) || '';

  const meaningsData = entry.meanings.slice(0, 3).map(m => ({
    pos: m.partOfSpeech,
    defs: m.definitions.slice(0, 2).map(d => ({
      def: d.definition || '',
      example: d.example || ''
    }))
  }));

  const payload = JSON.stringify({
    word: entry.word,
    phonetic: phoneticText,
    audio: audioUrl,
    meanings: meaningsData
  });

  return `
    (() => {
      window.__leefDictFetched = true;
      if (window.__leefDictObserver) {
        window.__leefDictObserver.disconnect();
        delete window.__leefDictObserver;
      }
      if (window.__leefDictDocObserver) {
        window.__leefDictDocObserver.disconnect();
        delete window.__leefDictDocObserver;
      }

      function getCol() {
        return document.getElementById('center_col') ||
               document.getElementById('rso') ||
               document.getElementById('search') ||
               document.querySelector('div[role="main"]') ||
               document.getElementById('main') ||
               document.querySelector('#rcnt');
      }

      const d = ${payload};

      function render(col) {
        let card = document.getElementById('leef-dict-card');
        if (!card) {
          card = document.createElement('div');
          card.id = 'leef-dict-card';
          col.insertBefore(card, col.firstChild);
        }

        if (!document.getElementById('leef-dict-styles')) {
          const s = document.createElement('style');
          s.id = 'leef-dict-styles';
          s.textContent = ${JSON.stringify(LEEF_DICT_CSS)};
          document.head.appendChild(s);
        }

        let meanHtml = '<div style="margin-top:10px;border-top:1px solid rgba(23,179,64,0.2);padding-top:10px;">';
        d.meanings.forEach(function(m) {
          meanHtml += '<div class="ld-pos">' + m.pos + '</div><ol class="ld-def-ol">';
          m.defs.forEach(function(def) {
            meanHtml += '<li class="ld-def-li"><div>' + def.def + '</div>';
            if (def.example) meanHtml += '<div class="ld-example">' + def.example + '</div>';
            meanHtml += '</li>';
          });
          meanHtml += '</ol>';
        });
        meanHtml += '</div>';

        const audioBtn = d.audio
          ? '<button id="leef-audio-btn" title="Hear pronunciation"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg></button>'
          : '';

        card.innerHTML =
          '<div id="leef-dict-badge">Leef Dictionary <span style="font-size: 0.52rem; font-weight: 800; background: rgba(255,255,255,0.22); color: #fff; padding: 1px 4px; border-radius: 4px; margin-left: 4px; vertical-align: middle; display: inline-block;">BETA</span></div>' +
          '<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">' +
            '<h2 id="leef-dict-word">' + d.word + '</h2>' +
            '<div class="ld-phonetic">' + (d.phonetic ? '<span>' + d.phonetic + '</span>' : '') + audioBtn + '</div>' +
          '</div>' +
          meanHtml +
          '<button class="ld-footer" id="leef-dict-why" title="Why is this here?"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg></button>';

        if (d.audio) {
          const btn = card.querySelector('#leef-audio-btn');
          if (btn) {
            btn.addEventListener('click', function() {
              if (btn.classList.contains('playing')) return;
              const audio = new Audio(d.audio);
              btn.classList.add('playing');
              audio.play()
                .then(function() { audio.onended = function() { btn.classList.remove('playing'); }; })
                .catch(function() { btn.classList.remove('playing'); });
            });
          }
        }

        const why = card.querySelector('#leef-dict-why');
        if (why) {
          why.addEventListener('click', function() {
            console.log('LEEF_DICT_MODAL');
          });
        }

        console.log('LEEF_DICT_HIDE_LOADER');
      }

      const col = getCol();
      if (col) {
        render(col);
      } else {
        const successDocObserver = new MutationObserver(() => {
          const colEl = getCol();
          if (colEl) {
            successDocObserver.disconnect();
            render(colEl);
          }
        });
        successDocObserver.observe(document.documentElement, { childList: true, subtree: true });
      }
    })();
  `;
}

function getRemoveSkeletonJS() {
  return `
    (() => {
      window.__leefDictFetched = true;
      if (window.__leefDictObserver) {
        window.__leefDictObserver.disconnect();
        delete window.__leefDictObserver;
      }
      const card = document.getElementById('leef-dict-card');
      if (card && card.querySelector('.ld-skel')) {
        card.remove();
      }
      console.log('LEEF_DICT_HIDE_LOADER');
    })();
  `;
}

function handleAutocorrectFallback(tab) {
  if (!tab._dictWord) return;

  const currentTitle = tab.webviewEl.getTitle() || '';
  let titleQuery = currentTitle
    .replace(/\s+-\s+Google\s+Search$/i, '')
    .replace(/\s+—\s+Google\s+Search$/i, '')
    .trim();

  if (!titleQuery) return;

  const defineRegex = /^(?:define\s+|meaning\s+of\s+)(.+)$/i;
  const meaningRegex = /^(.+?)(?:\s+meaning|\s+definition)$/i;
  let correctedWord = '';

  const m1 = titleQuery.match(defineRegex);
  if (m1) {
    correctedWord = m1[1].trim();
  } else {
    const m2 = titleQuery.match(meaningRegex);
    if (m2) correctedWord = m2[1].trim();
  }

  if (correctedWord &&
    correctedWord.toLowerCase() !== tab._dictWord.toLowerCase() &&
    /^[a-zA-Z][a-zA-Z\s'-]*$/.test(correctedWord) &&
    correctedWord.length < 40) {

    console.log('[Dict Autocorrect] Correcting', tab._dictWord, '->', correctedWord);
    tab._dictWord = correctedWord;
    tab._dictLoading = true;
    tab._dictResolvedJS = null;

    if (window.toastManager) window.toastManager.show('📖 Leef Dictionary (Beta)', `Looking up "${correctedWord}"…`, 15000);
    tab.webviewEl.executeJavaScript(getInjectSkeletonJS()).catch(() => { });

    tab._dictFetch = fetchWordDefinition(correctedWord)
      .then(data => {
        tab._dictLoading = false;
        const successJS = getInjectSuccessJS(data);
        tab._dictResolvedJS = successJS;
        tab.webviewEl.executeJavaScript(successJS).catch(() => { });
        return successJS;
      })
      .catch(() => {
        tab._dictLoading = false;
        tab._dictResolvedJS = getRemoveSkeletonJS();
        tab.webviewEl.executeJavaScript(getRemoveSkeletonJS()).catch(() => { });
        return null;
      });
  }
}


class TabManager {
  constructor(settingsInstance) {
    this.settings = settingsInstance;
    this.tabs = [];
    this.activeTabId = null;
    this.tabCounter = 0;
    this.lastTabOpen = { url: '', time: 0 };

    // Create the global loading bar
    this.loadingBar = document.createElement('div');
    this.loadingBar.className = 'loading-bar';
    document.querySelector('.main-content').appendChild(this.loadingBar);

    this.bindGlobalEvents();

    // DRM Detection Listener — fires when DRM is allowed
    window.require('electron').ipcRenderer.on('drm-detected', (event, data) => {
      this.tabs.forEach(tab => {
        if (tab.webviewEl) {
          try {
            if (tab.webviewEl.getWebContentsId() === data.webContentsId) {
              tab.hasDRM = true;
              if (tab.id === this.activeTabId) {
                const drmIndicator = document.getElementById('drm-indicator');
                if (drmIndicator) drmIndicator.style.display = 'flex';
              }
            }
          } catch (e) { }
        }
      });
    });

    // DRM Blocked Listener — fires when Block DRM lab flag is ON
    window.require('electron').ipcRenderer.on('drm-blocked', (event, data) => {
      if (window.toastManager) {
        window.toastManager.show(
          '🔒 DRM Content Blocked',
          'This site requires DRM (Widevine) to play content, but "Block DRM Content" is enabled in Leef Labs. Disable it to watch Netflix, Disney+, and similar services.',
          10000
        );
        // Show the action buttons to let user jump to Labs
        const toastAction = document.getElementById('leef-toast-action');
        const primaryBtn = document.getElementById('btn-toast-primary');
        const secondaryBtn = document.getElementById('btn-toast-secondary');
        if (toastAction && primaryBtn && secondaryBtn) {
          toastAction.style.display = 'flex';
          primaryBtn.textContent = window.t ? window.t('Open Labs') : 'Open Labs';
          secondaryBtn.textContent = window.t ? window.t('Dismiss') : 'Dismiss';
          const openLabsHandler = () => {
            if (window.tabManager) window.tabManager.createTab('flags');
            window.toastManager.hide();
            primaryBtn.removeEventListener('click', openLabsHandler);
          };
          const dismissHandler = () => {
            window.toastManager.hide();
            secondaryBtn.removeEventListener('click', dismissHandler);
          };
          primaryBtn.addEventListener('click', openLabsHandler);
          secondaryBtn.addEventListener('click', dismissHandler);
        }
      }
    });
  }

  getActiveTab() {
    return this.tabs.find(t => t.id === this.activeTabId);
  }

  applyZoomToAll(zoom) {
    this.tabs.forEach(t => {
      if (t.webviewEl && typeof t.webviewEl.setZoomFactor === 'function') {
        try { t.webviewEl.setZoomFactor(zoom); } catch (e) { }
      }
    });
  }

  createTab(route = 'home') {
    // If opening a new tab ('home') and a custom homepage URL is configured, use it instead
    if (route === 'home') {
      const s = this.settings.currentSettings;
      if (s.startup === 'homepage' && s.customNewTab) {
        route = s.customNewTab;
      }
    }

    // URL Debounce: Prevent the exact same URL from opening twice within 500ms
    // Fixes "double tabs" caused by click interceptors fighting with native handlers.
    const now = Date.now();
    if (route !== 'home' && route === this.lastTabOpen.url && (now - this.lastTabOpen.time) < 500) {
      return;
    }
    this.lastTabOpen = { url: route, time: now };

    const isInternal = ['home', 'settings', 'changelog', 'credits', 'flags', 'privacy', 'plugins'].includes(route);

    if (window.isCriticalMode && !isInternal) {
      const isGithub = route.includes('github.com');
      if (!isGithub) {
        if (window.toastManager) window.toastManager.show('🔒 Navigation Locked', 'You are currently in Critical Mode. Please update Leef Browser to resume normal browsing.', 6000);
        return;
      }
    }

    const tabId = 'tab-' + this.tabCounter++;
    const tabEl = document.createElement('div');
    tabEl.id = tabId;
    tabEl.dataset.tabId = tabId;
    tabEl.className = 'tab';
    tabEl.draggable = true;

    tabEl.addEventListener('dragstart', (e) => {
      e.target.classList.add('tab-dragging');
      e.dataTransfer.setData('text/plain', tabId);
      e.dataTransfer.effectAllowed = 'move';
    });

    tabEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      const draggingTab = document.querySelector('.tab-dragging');
      if (!draggingTab || draggingTab === tabEl) return;

      const rect = tabEl.getBoundingClientRect();
      const midPoint = rect.left + rect.width / 2;

      if (e.clientX < midPoint) {
        tabEl.parentNode.insertBefore(draggingTab, tabEl);
      } else {
        tabEl.parentNode.insertBefore(draggingTab, tabEl.nextSibling);
      }
    });

    tabEl.addEventListener('dragend', (e) => {
      e.target.classList.remove('tab-dragging');
      // Sync internal array with new DOM order
      this.syncInternalOrder();
    });

    tabEl.addEventListener('drop', (e) => {
      e.preventDefault();
    });

    const tabFavicon = document.createElement('div');
    tabFavicon.className = 'tab-favicon';

    const tabTitle = document.createElement('span');
    tabTitle.className = 'tab-title';
    tabTitle.textContent = route === 'home' ? window.t('Leef Browser | Home') : (route === 'settings' ? window.t('Settings') : (route === 'changelog' ? window.t("What's New") : (route === 'credits' ? window.t('Credits') : (route === 'flags' ? window.t('Leef Labs') : (route === 'privacy' ? window.t('Privacy Center') : (route === 'plugins' ? window.t('Plugin Store') : window.t('Loading...')))))));

    const tabClose = document.createElement('button');
    tabClose.className = 'tab-close';
    tabClose.innerHTML = '×';

    tabEl.appendChild(tabFavicon);
    tabEl.appendChild(tabTitle);
    tabEl.appendChild(tabClose);
    UI.tabsContainer.insertBefore(tabEl, UI.buttons.newTab);

    const tabObj = {
      id: tabId,
      url: route, // 'home', 'settings', 'changelog', or 'https://...'
      title: tabTitle.textContent,
      tabEl,
      tabTitle,
      webviewEl: null,
      canGoBack: false,
      canGoForward: false,
      isInternal: isInternal,
      isPinned: false,
      isMuted: false,
      isAudioPlaying: false,
      faviconUrl: null,
      faviconEl: tabFavicon,
      lastActiveTime: Date.now(),
      isLoading: false,
      loadingProgress: 0,
      loadingInterval: null
    };

    this.tabs.push(tabObj);

    // Audio Indicator Element
    const tabAudioIcon = document.createElement('div');
    tabAudioIcon.className = 'tab-audio-icon';
    tabAudioIcon.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>';
    tabAudioIcon.style.display = 'none';
    tabEl.appendChild(tabAudioIcon);
    tabObj.audioIconEl = tabAudioIcon;

    // Pin Indicator Element
    const tabPinIcon = document.createElement('div');
    tabPinIcon.className = 'tab-pin-icon';
    tabPinIcon.innerHTML = '📌';
    tabPinIcon.style.display = 'none';
    tabEl.appendChild(tabPinIcon);
    tabObj.pinIconEl = tabPinIcon;



    // Initial Routing setup
    if (!isInternal) {
      this.mountWebview(tabObj);
      tabObj.url = BrowserUtils.parseAddress(route, this.settings.currentSettings.searchEngine, this.settings.currentSettings.blockAIOverview);
      tabObj.webviewEl.src = tabObj.url;
    }

    // Events
    tabEl.addEventListener('click', (e) => {
      if (e.target !== tabClose) {
        if (this.activeTabId === tabId) return;
        this.switchTab(tabId);
      }
    });

    tabEl.addEventListener('mousedown', (e) => {
      if (e.button === 1) {
        e.preventDefault(); // Prevent native autoscroll on middle-click
      }
    });

    tabEl.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        e.stopPropagation();
        this.closeTab(tabId);
      }
    });

    tabEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        const lang = window.getLanguage ? window.getLanguage() : (window.settingsManager?.currentSettings?.language || 'en');
        window.require('electron').ipcRenderer.send('show-tab-context-menu', {
          tabId: tabId,
          isPinned: tabObj.isPinned,
          isMuted: tabObj.isMuted,
          lang
        });
      } catch (err) { }
    });

    tabClose.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeTab(tabId);
    });

    this.switchTab(tabId);
    this.updateTabScrollButtons();

    // Auto-focus search box for new tabs (v0.4.2)
    setTimeout(() => {
      if (route === 'home') {
        const homeSearch = document.getElementById('home-search');
        if (homeSearch) {
          homeSearch.focus({ preventScroll: true });
          // Clear any text that Linux primary-selection may have auto-pasted on focus
          homeSearch.value = '';
        } else {
          UI.inputs.address.focus({ preventScroll: true });
          // Clear any text that Linux primary-selection may have auto-pasted on focus
          UI.inputs.address.value = '';
        }
      } else if (isInternal) {
        // Focus address bar for other internal pages if they don't have their own focus logic
        UI.inputs.address.focus({ preventScroll: true });
        // Clear any text that Linux primary-selection may have auto-pasted on focus
        UI.inputs.address.value = '';
      }
    }, 50);

    // Resource Freezer Loop (Leef Limiter v0.5.0)
    if (!this._freezerInited) {
      this._freezerInited = true;
      setInterval(() => {
        const limiter = this.settings.currentSettings;
        const labs = window.labsManager;
        const isEfficiencyOn = limiter.efficiencyMode;

        if (!isEfficiencyOn && limiter.ramLimit <= 0) return;

        const now = Date.now();

        // RAM Limiter Check: Get total memory usage if limit is set
        let currentRssMb = 0;
        if (limiter.ramLimit > 0) {
          try {
            // Electron process.memoryUsage() returns bytes
            currentRssMb = Math.round(process.memoryUsage().rss / (1024 * 1024));
          } catch (e) { }
        }

        this.tabs.forEach(t => {
          if (t.id !== this.activeTabId && !t.isInternal && !t.isPinned && !t.isHibernated) {
            const idleTime = t.lastActiveTime ? now - t.lastActiveTime : 0;

            // Hibernation conditions:
            // 1. Efficiency Mode + 5 minutes idle
            // 2. RAM Limit Exceeded

            let shouldFreeze = false;
            if (isEfficiencyOn && idleTime > 5 * 60 * 1000) shouldFreeze = true;
            if (limiter.ramLimit > 0 && currentRssMb > limiter.ramLimit) shouldFreeze = true;

            if (shouldFreeze && t.webviewEl) {
              console.log(`Leef Limiter: Hibernating tab ${t.id} (${t.title})`);
              t.isHibernated = true;
              t.hibernateUrl = t.webviewEl.getURL();
              t.webviewEl.stop();
              t.webviewEl.src = 'about:blank';
              if (window.toastManager) window.toastManager.show('🧊 Efficiency Freeze', `"${t.title}" was frozen to save system resources.`, 3000);
            }
          }
        });
      }, 30000); // Check every 30s
    }
  }

  startLoadingBar(tab) {
    if (tab.hideLoadingTimeout) clearTimeout(tab.hideLoadingTimeout);
    if (tab.resetWidthTimeout) clearTimeout(tab.resetWidthTimeout);

    tab.isLoading = true;
    tab.loadingProgress = 5;
    if (tab.loadingInterval) clearInterval(tab.loadingInterval);

    tab.loadingInterval = setInterval(() => {
      // Asymptotic progress approach
      tab.loadingProgress += (95 - tab.loadingProgress) * 0.05;
      if (tab.loadingProgress > 95) tab.loadingProgress = 95;
      this.updateLoadingBar();
    }, 100);

    this.updateLoadingBar();
  }

  completeLoadingBar(tab) {
    tab.loadingProgress = 100;
    if (tab.loadingInterval) {
      clearInterval(tab.loadingInterval);
      tab.loadingInterval = null;
    }
    this.updateLoadingBar();

    if (tab.hideLoadingTimeout) clearTimeout(tab.hideLoadingTimeout);

    tab.hideLoadingTimeout = setTimeout(() => {
      if (tab.loadingProgress === 100) {
        tab.isLoading = false;
        tab.loadingProgress = 0;
        this.updateLoadingBar();
      }
    }, 200); // Wait for the transition to finish before hiding
  }

  updateLoadingBar() {
    if (!this.loadingBar) return;
    const activeTab = this.getActiveTab();
    if (!activeTab) return;

    if (activeTab.isLoading) {
      this.loadingBar.style.width = `${activeTab.loadingProgress}%`;
      this.loadingBar.classList.add('active');
    } else {
      this.loadingBar.style.width = '100%';
      this.loadingBar.classList.remove('active');
      // Reset width to 0 without transition after fade out
      if (activeTab.loadingProgress === 0) {
        if (activeTab.resetWidthTimeout) clearTimeout(activeTab.resetWidthTimeout);
        activeTab.resetWidthTimeout = setTimeout(() => {
          if (!activeTab.isLoading) {
            const oldTransition = this.loadingBar.style.transition;
            this.loadingBar.style.transition = 'none';
            this.loadingBar.style.width = '0%';
            // Force reflow
            void this.loadingBar.offsetWidth;
            this.loadingBar.style.transition = oldTransition;
          }
        }, 750); // Must be slightly longer than the total transition timeline (700ms)
      }
    }
  }

  mountWebview(tab) {
    if (tab.webviewEl) return; // this shit already exists
    tab.webviewEl = document.createElement('webview');
    tab.webviewEl.id = 'webview-' + tab.id;
    tab.webviewEl.setAttribute('allowpopups', '');
    tab.webviewEl.setAttribute('allowfullscreen', '');
    tab.webviewEl.setAttribute('partition', 'persist:leef-session'); // CRITICAL: must match session in main.js

    // Background Tab Performance (v0.4.0)
    // Prevent throttling unless the user explicitly enabled the background limiter.
    tab.webviewEl.setAttribute('webpreferences', 'contextIsolation=yes, sandbox=no, nodeIntegration=no, backgroundThrottling=no, plugins=yes');

    UI.views.webviewsContainer.appendChild(tab.webviewEl);

    // Find-in-page support
    if (window.findManager) window.findManager.attachToWebview(tab.webviewEl);

    tab.webviewEl.addEventListener('did-start-loading', () => {
      if (tab.isHibernated) return;
      tab.url = tab.webviewEl.src;
      tab.gpcStartTime = Date.now(); // START TIMER: from when navigation begins
      tab.volumeBoost = 1; // Reset volume on moving to a new tab
      tab.blockedAds = 0; // Reset adblock stats on moving to a new tab
      tab.blockedTrackers = 0; // Reset trackers stats on moving to a new tab
      tab.blockedDomains = []; // Reset tracked domains
      tab.hasDRM = false; // Reset DRM status
      if (this.activeTabId === tab.id) {
        const drmIndicator = document.getElementById('drm-indicator');
        if (drmIndicator) drmIndicator.style.display = 'none';

        if (window.quickSettingsManager && window.quickSettingsManager.sliderVolume) {
          window.quickSettingsManager.sliderVolume.value = 1;
        }
        if (window.siteIdentityManager) window.siteIdentityManager.updateUI();
      }
      this.updateTabUI(tab);
    });

    tab.webviewEl.addEventListener('page-title-updated', (e) => {
      if (tab.isHibernated) return;
      tab.title = e.title;
      this.updateTabUI(tab);
    });

    tab.webviewEl.addEventListener('page-favicon-updated', (e) => {
      if (tab.isHibernated) return;
      if (e.favicons && e.favicons.length > 0) {
        tab.faviconUrl = e.favicons[0];
        this.updateTabUI(tab);
      }
    });

    // Crash detection and Safe Mode recovery
    const handleCrash = (e) => {
      console.warn('Webview crashed or render process gone!', tab.url, e);
      if (tab._isCrashRecovering) return; // Prevent infinite crash loops
      tab._isCrashRecovering = true;

      let redirectUrl = tab.url;
      let usingFallback = false;
      if (tab.url && (tab.url.includes('google.com/search') || (tab.url.includes('google.co.') && tab.url.includes('/search')))) {
        try {
          const urlObj = new URL(tab.url);
          const q = urlObj.searchParams.get('q');
          if (q) {
            redirectUrl = `https://duckduckgo.com/?q=${encodeURIComponent(q)}`;
            usingFallback = true;
          }
        } catch (err) { }
      }

      if (window.toastManager) {
        if (usingFallback) {
          window.toastManager.show('⚠️ Page Crashed', 'Recovering search page in Safe Mode using DuckDuckGo.', 10000);
          const toastAction = document.getElementById('leef-toast-action');
          const primaryBtn = document.getElementById('btn-toast-primary');
          const secondaryBtn = document.getElementById('btn-toast-secondary');
          if (toastAction && primaryBtn && secondaryBtn) {
            toastAction.style.display = 'flex';
            primaryBtn.textContent = window.t ? window.t('Learn Why') : 'Learn Why';
            primaryBtn.onclick = () => {
              // Display a professional explanation modal
              const modal = document.getElementById('crash-explanation-modal');
              const closeBtn = document.getElementById('crash-explanation-close');
              if (modal && closeBtn) {
                closeBtn.onclick = () => {
                  modal.style.display = 'none';
                };
                modal.style.display = 'flex';
              }
              window.toastManager.hide();
            };
            secondaryBtn.textContent = window.t ? window.t('Dismiss') : 'Dismiss';
            secondaryBtn.onclick = () => {
              window.toastManager.hide();
            };
          }
        } else {
          window.toastManager.show('⚠️ Page Crashed', 'Recovering page without special features (Safe Mode).', 6000);
        }
      }
      setTimeout(() => {
        if (tab.webviewEl) {
          try {
            tab.webviewEl.loadURL(redirectUrl);
          } catch (err) {
            tab.webviewEl.src = redirectUrl;
          }
        }
      }, 500);
    };
    tab.webviewEl.addEventListener('render-process-gone', handleCrash);
    tab.webviewEl.addEventListener('plugin-crashed', handleCrash);
    tab.webviewEl.addEventListener('crashed', handleCrash);

    // Catch the manual tab interceptor messages
    tab.webviewEl.addEventListener('console-message', (e) => {
      if (!e.message) return;

      if (e.message.startsWith('LEEF_NEW_TAB:')) {
        const url = e.message.replace('LEEF_NEW_TAB:', '');
        this.createTab(url);
      }

      if (e.message.startsWith('LEEF_WEBAUTHN_PROMPT:')) {
        try {
          const data = JSON.parse(e.message.substring('LEEF_WEBAUTHN_PROMPT:'.length));
          if (window.permissionManager) {
            window.permissionManager.requestWebAuthnConsent(tab, data);
          }
        } catch (err) {
          console.error('Failed to parse WebAuthn prompt data:', err);
        }
      }

      if (e.message === 'LEEF_DICT_MODAL') {
        const modal = document.getElementById('dict-info-modal');
        if (modal) {
          modal.style.display = 'flex';
          modal.style.opacity = '1';
        }
      }

      if (e.message === 'LEEF_DICT_HIDE_LOADER') {
        if (window.toastManager) window.toastManager.hide();
      }
    });

    tab.webviewEl.addEventListener('did-start-navigation', (e) => {
      if (tab.isHibernated) return;
      if (e.isMainFrame) {
        if (!e.isSameDocument && !e.isInPlace) {
          tab.isMainFrameLoading = true;
          this.startLoadingBar(tab);
        }
        tab.title = 'Loading...';
        tab.url = e.url; // Update URL identity immediately to prevent state leaks
        tab.isInternal = e.url.startsWith('leef:') || (e.url.startsWith('file:') && !e.url.includes('offline.html')) || e.url.startsWith('chrome:');
        tab.gpcVerified = undefined; // CLEAR verification state for the new domain
        tab.gpcVerifiedTime = null;
        tab.gpcManuallyVerified = false; // CLEAR manual whitelisting state for the new domain
        tab.gpcAlertCollapsed = false; // CLEAR collapsed state
        this.updateTabUI(tab);
        if (window.siteIdentityManager && window.siteIdentityManager.dropdown && window.siteIdentityManager.dropdown.style.display !== 'none') {
          window.siteIdentityManager.updateUI();
        }
        if (window.privacyManager) {
          window.privacyManager.recordRequest(e.url.startsWith('https:'));
        }
      }
    });

    tab.webviewEl.addEventListener('did-navigate', (e) => {
      if (tab.isHibernated) return;
      tab.url = tab.webviewEl.getURL();
      tab.canGoBack = tab.webviewEl.canGoBack();
      tab.canGoForward = tab.webviewEl.canGoForward();
      this.updateTabUI(tab);

      // Force scroll reset to top of page on cross-page navigation
      try {
        tab.webviewEl.executeJavaScript('window.scrollTo(0, 0);').catch(() => { });
      } catch (err) { }

      const s = this.settings.currentSettings;
      const tabUrl = e.url || '';
      const isGoogle = tabUrl.includes('google.com') || tabUrl.includes('google.co.');
      if (isGoogle && !tab._isCrashRecovering) {
        const isBlocked = s.blockAIOverview === 'deep' || s.blockAIOverview === 'hide' || s.blockAIOverview === true;
        if (isBlocked) {
          const aiCSS = `
            [data-attnms],
            .Kevs9.SLPe5b:has([data-attnms]),
            div[data-attrid="AIOverview"],
            [data-attrid="VisualDigestGeneratedDescription"],
            [jsname="YrZdPb"][data-evn],
            [jscontroller="Elkdbc"],
            .oGdvd {
              display: none !important;
              visibility: hidden !important;
              height: 0 !important;
              opacity: 0 !important;
              pointer-events: none !important;
            }
          `;
          tab.webviewEl.insertCSS(aiCSS).catch(() => { });
        } else {
          const restoreCSS = `
            [data-attnms],
            .Kevs9.SLPe5b:has([data-attnms]),
            div[data-attrid="AIOverview"],
            [data-attrid="VisualDigestGeneratedDescription"],
            [jsname="YrZdPb"][data-evn],
            [jscontroller="Elkdbc"],
            .oGdvd {
              display: revert !important;
              visibility: visible !important;
              height: auto !important;
              opacity: 1 !important;
              pointer-events: auto !important;
            }
          `;
          tab.webviewEl.insertCSS(restoreCSS).catch(() => { });
        }
      }
    });

    tab.webviewEl.addEventListener('did-navigate-in-page', (e) => {
      if (tab.isHibernated) return;
      tab.url = tab.webviewEl.getURL();
      tab.canGoBack = tab.webviewEl.canGoBack();
      tab.canGoForward = tab.webviewEl.canGoForward();
      this.updateTabUI(tab);
    });

    tab.webviewEl.addEventListener('did-stop-loading', () => {
      if (tab.isHibernated) return;
      if (tab.isMainFrameLoading) {
        tab.isMainFrameLoading = false;
        this.completeLoadingBar(tab);
      }
      // Final title sync once everything is done
      const currentTitle = tab.webviewEl.getTitle();
      if (currentTitle && currentTitle !== 'Loading...') {
        tab.title = currentTitle;
        this.updateTabUI(tab);
      }

      tab._didStopLoadingFired = true;

      // ── Native Dictionary (injected after page is fully hydrated) ────
      if (this.settings.currentSettings.nativeDictionary !== false && !tab._isCrashRecovering) {
        const stopUrl = tab.webviewEl.getURL ? tab.webviewEl.getURL() : tab.url;
        const isGoogleSearch = stopUrl.includes('google.com/search') ||
          (stopUrl.includes('google.co.') && stopUrl.includes('/search'));

        if (isGoogleSearch) {
          if (tab._dictResolvedJS) {
            tab.webviewEl.executeJavaScript(tab._dictResolvedJS).catch(() => { });
          } else if (tab._dictLoading) {
            tab.webviewEl.executeJavaScript(getInjectSkeletonJS()).catch(() => { });
          } else {
            handleAutocorrectFallback(tab);
          }
        }
      }
    });

    tab.webviewEl.addEventListener('dom-ready', () => {
      if (tab.isHibernated) return;
      tab.title = tab.webviewEl.getTitle() || tab.url;
      tab.url = tab.webviewEl.getURL();
      tab.isInternal = tab.url.startsWith('leef:') || (tab.url.startsWith('file:') && !tab.url.includes('offline.html')) || tab.url.startsWith('chrome:');
      tab.canGoBack = tab.webviewEl.canGoBack();
      tab.canGoForward = tab.webviewEl.canGoForward();
      if (typeof tab.webviewEl.setZoomFactor === 'function') {
        try { tab.webviewEl.setZoomFactor(parseFloat(this.settings.currentSettings.zoom) || 1.0); } catch (e) { }
      }

      // Inject Global Plugin Styles and Scripts
      if (window.leefPluginGlobalCSS) {
        Object.values(window.leefPluginGlobalCSS).forEach(css => {
          tab.webviewEl.insertCSS(css).catch(()=>{});
        });
      }
      if (window.leefPluginGlobalJS) {
        Object.values(window.leefPluginGlobalJS).forEach(code => {
          tab.webviewEl.executeJavaScript(code).catch(()=>{});
        });
      }
      this.updateTabUI(tab);

      // Inject custom premium scrollbar styles to match the brand's green theme inside the guest webview page
      const scrollbarCSS = `
        ::-webkit-scrollbar {
          width: 8px !important;
          height: 8px !important;
        }
        ::-webkit-scrollbar-track {
          background: transparent !important;
        }
        ::-webkit-scrollbar-thumb {
          background: rgba(23, 179, 64, 0.3) !important;
          border-radius: 10px !important;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: rgba(23, 179, 64, 0.55) !important;
        }
      `;
      tab.webviewEl.insertCSS(scrollbarCSS).catch(() => { });

      if (window.labsManager && window.labsManager.isFlagEnabled('opendyslexic')) {
        const dysCSS = `
          @import url('https://cdn.jsdelivr.net/npm/@fontsource/opendyslexic/index.css');
          * {
            font-family: 'OpenDyslexic', sans-serif !important;
          }
        `;
        tab.webviewEl.insertCSS(dysCSS).catch(() => { });
      }

      // Inject Twemoji to fix flag emojis on Windows (which lacks native country flag support)
      if (process.platform === 'win32') {
        const twemojiJS = `
          (function() {
            if (window.__leefTwemojiInjected) return;
            window.__leefTwemojiInjected = true;

            // Size flag images to match surrounding text
            var style = document.createElement('style');
            style.textContent = 'img.emoji { height: 1em; width: 1em; margin: 0 0.05em 0 0.1em; vertical-align: -0.1em; display: inline; }';
            document.head.appendChild(style);

            var s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/twemoji@14.0.2/dist/twemoji.min.js';
            s.crossOrigin = 'anonymous';
            s.onload = function() {
              if (typeof twemoji !== 'undefined') {
                twemoji.parse(document.body, {
                  folder: 'svg',
                  ext: '.svg',
                  base: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/',
                  callback: function(icon, options) {
                    // Only replace flag emojis (regional indicator pairs start with 1f1e_)
                    var cp = parseInt(icon, 16);
                    if (cp >= 0x1F1E6 && cp <= 0x1F1FF) return options.base + options.size + '/' + icon + options.ext;
                    return false; // skip non-flags, let browser handle them
                  }
                });
              }
            };
            document.head.appendChild(s);
          })();
        `;
        tab.webviewEl.executeJavaScript(twemojiJS).catch(() => { });
      }
      const currentTabUrl = tab.url || '';
      const isGoogleSearch = currentTabUrl.includes('google.com/search') ||
        (currentTabUrl.includes('google.co.') && currentTabUrl.includes('/search'));

      // ── Native Dictionary: kick off fetch early during dom-ready ──
      tab._dictFetch = null;
      tab._dictLoading = false;
      tab._dictResolvedJS = null;
      tab._dictWord = '';
      tab._didStopLoadingFired = false;

      if (this.settings.currentSettings.nativeDictionary !== false && isGoogleSearch && !tab._isCrashRecovering) {
        let searchQuery = '';
        try {
          const urlObj = new URL(currentTabUrl);
          searchQuery = urlObj.searchParams.get('q') || '';
        } catch (e) { }

        // Fallback: check webview's actual live URL if currentTabUrl was missing query params
        if (!searchQuery && tab.webviewEl && typeof tab.webviewEl.getURL === 'function') {
          try {
            const liveUrl = new URL(tab.webviewEl.getURL());
            searchQuery = liveUrl.searchParams.get('q') || '';
          } catch (e) { }
        }

        const rawQuery = searchQuery.trim();
        if (rawQuery) {
          const defineRegex = /^(?:define|meaning\s+of|what\s+is\s+the\s+meaning\s+of|definition\s+of)\s+(.+)$/i;
          const meaningRegex = /^(.+?)\s+(?:meaning|definition)$/i;
          let searchWord = '';
          const m1 = rawQuery.match(defineRegex);
          if (m1) {
            searchWord = m1[1].trim();
          } else {
            const m2 = rawQuery.match(meaningRegex);
            if (m2) searchWord = m2[1].trim();
          }

          // Strip optional quotation marks around the search term (e.g., define "serendipity")
          searchWord = searchWord.replace(/^["']|["']$/g, '').trim();

          if (searchWord && /^[a-zA-Z][a-zA-Z\s'-]*$/.test(searchWord) && searchWord.length < 40) {
            tab._dictWord = searchWord;
            tab._dictLoading = true;

            // Show a toast spinner immediately — runs in Leef's own UI, no webview injection needed.
            if (window.toastManager) window.toastManager.show('📖 Leef Dictionary (Beta)', `Looking up "${searchWord}"…`, 15000);

            // Also try skeleton in the webview (best-effort).
            tab.webviewEl.executeJavaScript(getInjectSkeletonJS()).catch(() => { });

            tab._dictFetch = fetchWordDefinition(searchWord)
              .then(data => {
                tab._dictLoading = false;
                const successJS = getInjectSuccessJS(data);
                tab._dictResolvedJS = successJS;
                if (tab._didStopLoadingFired) {
                  tab.webviewEl.executeJavaScript(successJS).catch(() => { });
                }
                return successJS;
              })
              .catch(() => {
                tab._dictLoading = false;
                tab._dictResolvedJS = getRemoveSkeletonJS();
                if (tab._didStopLoadingFired) {
                  handleAutocorrectFallback(tab);
                }
                return null;
              });
          }
        }
      }


      // BATCHED JS INJECTION (Performance: single IPC round-trip per page load)
      // All per-page scripts are assembled here and fired in ONE executeJavaScript call.
      const s = { ...this.settings.currentSettings };
      if (tab._isCrashRecovering) {
        s.blockAIOverview = 'off';
        s.adBlockerMode = 'none';
      }
      const labs = window.labsManager;
      const tabUrl = tab.url || '';
      const isGoogle = tabUrl.includes('google.com') || tabUrl.includes('google.co.');
      const isYouTube = tabUrl.includes('youtube.com');
      const isWarpEnabled = !!(labs && labs.isFlagEnabled('yt_warp_speed'));

      // Apply robust CSS injection to Google Search via webview.insertCSS (immune to guest CSP)
      if (isGoogle) {
        const isBlocked = s.blockAIOverview === 'deep' || s.blockAIOverview === 'hide' || s.blockAIOverview === true;
        if (isBlocked) {
          const aiCSS = `
            [data-attnms],
            .Kevs9.SLPe5b:has([data-attnms]),
            div[data-attrid="AIOverview"],
            [data-attrid="VisualDigestGeneratedDescription"],
            [jsname="YrZdPb"][data-evn],
            [jscontroller="Elkdbc"],
            .oGdvd {
              display: none !important;
              visibility: hidden !important;
              height: 0 !important;
              opacity: 0 !important;
              pointer-events: none !important;
            }
          `;
          tab.webviewEl.insertCSS(aiCSS).catch(() => { });
        } else {
          const restoreCSS = `
            [data-attnms],
            .Kevs9.SLPe5b:has([data-attnms]),
            div[data-attrid="AIOverview"],
            [data-attrid="VisualDigestGeneratedDescription"],
            [jsname="YrZdPb"][data-evn],
            [jscontroller="Elkdbc"],
            .oGdvd {
              display: revert !important;
              visibility: visible !important;
              height: auto !important;
              opacity: 1 !important;
              pointer-events: auto !important;
            }
          `;
          tab.webviewEl.insertCSS(restoreCSS).catch(() => { });
        }
      }

      // Build the injection payload conditionally
      const chunks = [];

      // WebAuthn / Windows Hello interceptor
      chunks.push(`
        (function() {
          if (!navigator.credentials) return;
          if (window.__leefWebAuthnHooked) return;
          window.__leefWebAuthnHooked = true;

          const originalCreate = navigator.credentials.create;
          const originalGet = navigator.credentials.get;

          let requestCounter = 0;
          window.__leefWebAuthnRequests = new Map();

          function promptUser(type, options) {
            return new Promise((resolve, reject) => {
              const id = ++requestCounter;
              window.__leefWebAuthnRequests.set(id, { resolve, reject, type, options });
              console.log('LEEF_WEBAUTHN_PROMPT:' + JSON.stringify({
                id: id,
                type: type,
                origin: window.location.origin,
                host: window.location.host
              }));
            });
          }

          window.__resolveLeefWebAuthn = function(id, allowed) {
            const request = window.__leefWebAuthnRequests.get(id);
            if (!request) return;
            window.__leefWebAuthnRequests.delete(id);

            if (!allowed) {
              request.reject(new DOMException("User denied permission to use Windows Hello / Platform Authenticator.", "NotAllowedError"));
              return;
            }

            const origFn = request.type === 'create' ? originalCreate : originalGet;
            origFn.call(navigator.credentials, request.options)
              .then(res => request.resolve(res))
              .catch(err => request.reject(err));
          };

          navigator.credentials.create = function(options) {
            if (options && options.publicKey) {
              return promptUser('create', options);
            }
            return originalCreate.call(navigator.credentials, options);
          };

          navigator.credentials.get = function(options) {
            if (options && options.publicKey) {
              return promptUser('get', options);
            }
            return originalGet.call(navigator.credentials, options);
          };
        })();
      `);

      // Scroll-reset (always on DOM ready to fix scrolling carryover bug)
      chunks.push(`
        (function() {
          window.scrollTo(0, 0);
          if (document.documentElement) document.documentElement.scrollTop = 0;
          if (document.body) document.body.scrollTop = 0;
        })();
      `);

      // 1. New-tab interceptor (always)
      chunks.push(`
        (function() {
          if (window.__leefHooked) return;
          window.__leefHooked = true;
          document.addEventListener('click', (e) => {
            const a = e.target.closest('a');
            if (a && a.href && a.target === '_blank') {
              e.preventDefault(); e.stopPropagation();
              console.log('LEEF_NEW_TAB:' + a.href);
            }
          }, true);
          document.addEventListener('auxclick', (e) => {
            if (e.button === 1) {
              const a = e.target.closest('a');
              if (a && a.href) {
                e.preventDefault(); e.stopPropagation();
                console.log('LEEF_NEW_TAB:' + a.href);
              }
            }
          }, true);
        })();
      `);

      // 2. AI Overview Blocker (Google only, dynamic toggle aware)
      if (isGoogle) {
        const isBlocked = s.blockAIOverview === 'deep' || s.blockAIOverview === 'hide' || s.blockAIOverview === true;
        if (isBlocked) {
          const aiMode = s.blockAIOverview === 'hide' ? 'hide' : 'deep';
          chunks.push(`
            (function() {
              window.__leefBlockAIEnabled = true;
              window.__leefBlockAIMode = '${aiMode}';
              if (window.__leefAIHooked) return;
              window.__leefAIHooked = true;

              // 1. Text-based & selector-based fallback hiding function (attached to window)
              window.blockAIBox = () => {
                if (!window.__leefBlockAIEnabled) return;
                const selectors = [
                  '[data-attnms]', '.Kevs9.SLPe5b:has([data-attnms])', 'div[data-attrid="AIOverview"]', 
                  '[data-attrid="VisualDigestGeneratedDescription"]', '[jsname="YrZdPb"][data-evn]', 
                  '[jscontroller="Elkdbc"]', '.oGdvd'
                ];
                selectors.forEach(sel => {
                  document.querySelectorAll(sel).forEach(el => {
                    el.style.setProperty('display', 'none', 'important');
                    el.style.setProperty('visibility', 'hidden', 'important');
                    el.style.setProperty('height', '0', 'important');
                  });
                });

                // Search for header text containing exactly "AI Overview" or "Generative AI"
                document.querySelectorAll('h1, h2, h3, h4, h5, h6, span, div[role="heading"]').forEach(el => {
                  const text = el.textContent.trim().toLowerCase();
                  if (text === 'ai overview' || text === 'generative ai' || text === 'experimental ai') {
                    const container = el.closest('[data-attnms], div[data-attrid="AIOverview"], [jsname="YrZdPb"][data-evn]');
                    if (container) {
                      container.style.setProperty('display', 'none', 'important');
                      container.style.setProperty('visibility', 'hidden', 'important');
                      container.style.setProperty('height', '0', 'important');
                    }
                  }
                });
              };

              const NOAI_REGEX = /( ?)-noai/gi;
              const hookInput = (input) => {
                if (input.dataset.leefHooked) return;
                input.dataset.leefHooked = "true";
                const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value');
                if (!descriptor) return;
                Object.defineProperty(input, 'value', {
                  get: function() { const v = descriptor.get.call(this); return (v && window.__leefBlockAIEnabled) ? v.replace(NOAI_REGEX, '') : v; },
                  set: function(val) { descriptor.set.call(this, (val && typeof val === 'string' && window.__leefBlockAIEnabled) ? val.replace(NOAI_REGEX, '') : val); }
                });
                const initial = descriptor.get.call(input);
                if (initial && window.__leefBlockAIEnabled) descriptor.set.call(input, initial.replace(NOAI_REGEX, ''));
              };

              const interceptSearch = (query) => {
                if (!query || !window.__leefBlockAIEnabled) return;
                const cleanQuery = query.replace(NOAI_REGEX, '').trim();
                let targetUrl = '/search?q=' + encodeURIComponent(cleanQuery);
                if (window.__leefBlockAIMode === 'deep') {
                  targetUrl += '&udm=14';
                }
                window.location.href = targetUrl;
              };

              document.addEventListener('submit', (e) => {
                if (!window.__leefBlockAIEnabled) return;
                const q = e.target.querySelector('input[name="q"], textarea[name="q"]');
                if (q) { e.preventDefault(); e.stopPropagation(); interceptSearch(q.value); }
              }, true);

              document.addEventListener('keydown', (e) => {
                if (!window.__leefBlockAIEnabled) return;
                if (e.key === 'Enter' && e.target.name === 'q') { e.preventDefault(); e.stopPropagation(); interceptSearch(e.target.value); }
              }, true);

              let aiTimer;
              const observer = new MutationObserver(() => {
                clearTimeout(aiTimer);
                aiTimer = setTimeout(() => {
                  if (!window.__leefBlockAIEnabled) return;
                  document.querySelectorAll('input[name="q"], textarea[name="q"]').forEach(hookInput);
                  window.blockAIBox();
                }, 100);
              });
              observer.observe(document.body, { childList: true, subtree: true });

              document.querySelectorAll('input[name="q"], textarea[name="q"]').forEach(hookInput);
              window.blockAIBox();
            })();
          `);
        } else {
          chunks.push(`
            (function() {
              window.__leefBlockAIEnabled = false;
              const selectors = [
                '[data-attnms]', '.Kevs9.SLPe5b:has([data-attnms])', 'div[data-attrid="AIOverview"]', 
                '[data-attrid="VisualDigestGeneratedDescription"]', '[jsname="YrZdPb"][data-evn]', 
                '[jscontroller="Elkdbc"]', '.oGdvd'
              ];
              selectors.forEach(sel => {
                document.querySelectorAll(sel).forEach(el => {
                  el.style.removeProperty('display');
                  el.style.removeProperty('visibility');
                  el.style.removeProperty('height');
                });
              });
            })();
          `);
        }
      }

      if (s.gpc !== false) {
        chunks.push(`
          (function() {
            if (window.__leefGPCHooked) return;
            window.__leefGPCHooked = true;
            if (typeof navigator !== 'undefined') {
              Object.defineProperty(navigator, 'globalPrivacyControl', {
                get: () => {
                  window.__leefGPCRead = true;
                  return true;
                },
                configurable: true,
                enumerable: true
              });
            }
          })();
        `);
      }

      // 4. Labs: Ghost Mode
      if (labs && labs.isFlagEnabled('ghost_mode')) {
        chunks.push(`
          (function() {
            if (window.__leefGhostHooked) return;
            window.__leefGhostHooked = true;
            const orig = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = function(type, attrs) {
              const ctx = orig.apply(this, arguments);
              if (type === '2d' && ctx) {
                const origGID = ctx.getImageData;
                ctx.getImageData = function(x, y, w, h) {
                  const d = origGID.apply(this, arguments);
                  const i = Math.floor(Math.random() * (d.data.length / 4)) * 4;
                  d.data[i] = (d.data[i] + (Math.random() > 0.5 ? 1 : -1)) % 256;
                  return d;
                };
              }
              return ctx;
            };
          })();
        `);
      }

      // 5. Labs: Audio Scrambler
      if (labs && labs.isFlagEnabled('audio_scrambler')) {
        chunks.push(`
          (function() {
            if (window.__leefAudioHooked) return;
            window.__leefAudioHooked = true;
            const orig = AudioBuffer.prototype.getChannelData;
            AudioBuffer.prototype.getChannelData = function() {
              const d = orig.apply(this, arguments);
              d[Math.floor(Math.random() * d.length)] += (Math.random() - 0.5) * 1e-7;
              return d;
            };
          })();
        `);
      }

      // 6. Labs: Hardware Cloak
      if (labs && labs.isFlagEnabled('hardware_cloak')) {
        chunks.push(`
          (function() {
            if (window.__leefHardwareHooked) return;
            window.__leefHardwareHooked = true;
            Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 });
            Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
            const sc = window.screen;
            Object.defineProperty(sc, 'width', { get: () => 1920 });
            Object.defineProperty(sc, 'height', { get: () => 1080 });
            Object.defineProperty(sc, 'availWidth', { get: () => 1920 });
            Object.defineProperty(sc, 'availHeight', { get: () => 1040 });
            const maskWGL = (p) => {
              const og = p.getParameter;
              p.getParameter = function(param) {
                if (param === 0x9245) return 'Intel Inc.';
                if (param === 0x9246) return 'Intel(R) UHD Graphics 620';
                return og.apply(this, arguments);
              };
            };
            if (window.WebGLRenderingContext) maskWGL(WebGLRenderingContext.prototype);
            if (window.WebGL2RenderingContext) maskWGL(WebGL2RenderingContext.prototype);
          })();
        `);
      }

      // 7. Labs: Timezone Spoof
      if (labs && labs.isFlagEnabled('timezone_spoof')) {
        chunks.push(`
          (function() {
            if (window.__leefTimezoneHooked) return;
            window.__leefTimezoneHooked = true;
            const orig = Intl.DateTimeFormat.prototype.resolvedOptions;
            Intl.DateTimeFormat.prototype.resolvedOptions = function() {
              const o = orig.apply(this, arguments); o.timeZone = 'UTC'; return o;
            };
            Date.prototype.toString = function() { return this.toUTCString(); };
          })();
        `);
      }

      // 8. Labs: Font Masking
      if (labs && labs.isFlagEnabled('font_mask')) {
        chunks.push(`
          (function() {
            if (window.__leefFontHooked) return;
            window.__leefFontHooked = true;
            if (window.FontFaceSet) FontFaceSet.prototype.check = function() { return true; };
          })();
        `);
      }

      // 9. YouTube Ad-Protection (YouTube only)
      if (isYouTube && s.adBlockerMode !== 'none') {
        chunks.push(`
          (function() {
            if (window.__leefYTAdBlock) return;
            window.__leefYTAdBlock = true;
            const WARP = ${isWarpEnabled};
            function skipAd() {
              const video = document.querySelector('video');
              const skipBtn = document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern');
              if (skipBtn) skipBtn.click();
              const isAd = document.querySelector('.ad-showing, .ad-interrupting');
              if (isAd && video) {
                if (WARP) {
                  if (video.playbackRate !== 16) { video.dataset.leefPrevRate = video.playbackRate; video.muted = true; video.playbackRate = 16; }
                } else {
                  if (video.duration > 0 && isFinite(video.duration) && video.currentTime < video.duration - 0.2) { video.muted = true; video.currentTime = video.duration; }
                }
              } else if (video && video.playbackRate === 16) {
                video.playbackRate = parseFloat(video.dataset.leefPrevRate || 1);
                video.muted = false;
                delete video.dataset.leefPrevRate;
              }
              const enforceBtn = document.querySelector('ytd-enforcement-message-view-model button[class*="dismiss"], tp-yt-paper-dialog .style-scope ytd-button-renderer:last-child button');
              if (enforceBtn) enforceBtn.click();
              if (!document.getElementById('__leef_yt_css')) {
                const s = document.createElement('style');
                s.id = '__leef_yt_css';
                s.textContent = '.ytp-ad-overlay-container,.ytp-ad-text-overlay,.ytp-ad-image-overlay,.ytp-ce-element,#masthead-ad,ytd-banner-promo-renderer,ytd-statement-banner-renderer,ytd-ad-slot-renderer,ytd-in-feed-ad-layout-renderer,ytd-promoted-sparkles-web-renderer,ytd-search-pyv-renderer,#player-ads{display:none!important}';
                document.head.appendChild(s);
              }
            }
            // Perf fix: Store handle so each re-injection clears the previous loop (prevents orphaned timers)
            if (window.__leefYTTimer) clearTimeout(window.__leefYTTimer);
            (function loop() { skipAd(); window.__leefYTTimer = setTimeout(loop, document.hidden ? 2000 : 1000); })();
          })();
        `);
      }

      // Fire all chunks in a single IPC call
      if (chunks.length > 0) {
        tab.webviewEl.executeJavaScript(chunks.join('\n')).catch(() => { });
      }

      // YouTube SPA re-injection hook (event listener, not a JS injection)
      if (isYouTube && s.adBlockerMode !== 'none' && !tab._ytNavHooked) {
        tab._ytNavHooked = true;
        tab._ytNavTimer = null; // Stored on tab so closeTab() can clear it
        tab.webviewEl.addEventListener('did-navigate-in-page', (e) => {
          if (!e.isMainFrame) return; // Prevent iframe navigation IPC floods!
          if (tab.webviewEl.getURL().includes('youtube.com')) {
            clearTimeout(tab._ytNavTimer);
            tab._ytNavTimer = setTimeout(() => {
              const s2 = this.settings.currentSettings;
              if (s2.adBlockerMode === 'none' || tab._isCrashRecovering) return;
              const labs2 = window.labsManager;
              const isWarp2 = !!(labs2 && labs2.isFlagEnabled('yt_warp_speed'));
              tab.webviewEl.executeJavaScript(`
                (function() {
                  if (window.__leefYTAdBlock) return;
                  window.__leefYTAdBlock = true;
                  const WARP = ${isWarp2};
                  function skipAd() {
                    const video = document.querySelector('video');
                    const skipBtn = document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern');
                    if (skipBtn) skipBtn.click();
                    const isAd = document.querySelector('.ad-showing, .ad-interrupting');
                    if (isAd && video) {
                      if (WARP) { if (video.playbackRate !== 16) { video.muted = true; video.playbackRate = 16; } }
                      else if (video.duration > 0 && isFinite(video.duration) && video.currentTime < video.duration - 0.2) { video.muted = true; video.currentTime = video.duration; }
                    } else if (video && video.playbackRate === 16) { video.playbackRate = 1; video.muted = false; }
                  }
                  if (window.__leefYTTimer) clearTimeout(window.__leefYTTimer);
                  (function loop() { skipAd(); window.__leefYTTimer = setTimeout(loop, document.hidden ? 2000 : 1000); })();
                })();
              `).catch(() => { });
            }, 500);
          }
        });
      }

      // Google SPA AI Blocker hook
      if (isGoogle && !tab._googleNavHooked) {
        tab._googleNavHooked = true;
        tab.webviewEl.addEventListener('did-navigate-in-page', (e) => {
          if (!e.isMainFrame) return;
          if (tab.webviewEl.getURL().includes('google.')) {
            if (tab._isCrashRecovering) return;
            const currentS = this.settings.currentSettings;
            const isBlocked = currentS.blockAIOverview === 'deep' || currentS.blockAIOverview === 'hide' || currentS.blockAIOverview === true;
            if (isBlocked) {
              const aiMode = currentS.blockAIOverview === 'hide' ? 'hide' : 'deep';
              // 1. Re-apply elevated CSS injection
              const aiCSS = `
                [data-attnms],
                .Kevs9.SLPe5b:has([data-attnms]),
                div[data-attrid="AIOverview"],
                [data-attrid="VisualDigestGeneratedDescription"],
                [jsname="YrZdPb"][data-evn],
                [jscontroller="Elkdbc"],
                .oGdvd {
                  display: none !important;
                  visibility: hidden !important;
                  height: 0 !important;
                  opacity: 0 !important;
                  pointer-events: none !important;
                }
              `;
              tab.webviewEl.insertCSS(aiCSS).catch(() => { });

              // 2. Re-trigger dynamic JS blocker
              tab.webviewEl.executeJavaScript(`
                window.__leefBlockAIEnabled = true;
                window.__leefBlockAIMode = '${aiMode}';
                if (window.blockAIBox && typeof window.blockAIBox === 'function') {
                  window.blockAIBox();
                }
              `).catch(() => { });
            } else {
              const restoreCSS = `
                [data-attnms],
                .Kevs9.SLPe5b:has([data-attnms]),
                div[data-attrid="AIOverview"],
                [data-attrid="VisualDigestGeneratedDescription"],
                [jsname="YrZdPb"][data-evn],
                [jscontroller="Elkdbc"],
                .oGdvd {
                  display: revert !important;
                  visibility: visible !important;
                  height: auto !important;
                  opacity: 1 !important;
                  pointer-events: auto !important;
                }
              `;
              tab.webviewEl.insertCSS(restoreCSS).catch(() => { });
              tab.webviewEl.executeJavaScript(`
                window.__leefBlockAIEnabled = false;
                const selectors = [
                  '[data-attnms]', '.Kevs9.SLPe5b:has([data-attnms])', 'div[data-attrid="AIOverview"]', 
                  '[data-attrid="VisualDigestGeneratedDescription"]', '[jsname="YrZdPb"][data-evn]', 
                  '[jscontroller="Elkdbc"]', '.oGdvd'
                ];
                selectors.forEach(sel => {
                  document.querySelectorAll(sel).forEach(el => {
                    el.style.removeProperty('display');
                    el.style.removeProperty('visibility');
                    el.style.removeProperty('height');
                  });
                });
              `).catch(() => { });
            }
          }
        });
      }
    });

    // Audio status monitoring
    tab.webviewEl.addEventListener('media-paused', () => { tab.isAudioPlaying = false; this.updateTabUI(tab); });
    tab.webviewEl.addEventListener('media-started-playing', () => { tab.isAudioPlaying = true; this.updateTabUI(tab); });

    // Offline Error Handling (v0.2.1) + Wayback Machine Suggest (Labs)
    const handleNavigationFailure = (e) => {
      // Ignore code -3 (ABORTED) which happens on normal navigation/refresh
      if (e.errorCode === -3) return;

      // CRITICAL: Prevent infinite loop if offline.html itself fails to load
      if (e.validatedURL.includes('offline.html')) {
        console.error('CRITICAL: offline.html failed to load. Stopping recursion.');
        return;
      }

      console.warn('Navigation failed:', e.validatedURL, e.errorDescription);

      // Wayback Machine Suggest (Leef Labs)
      if (window.labsManager && window.labsManager.isFlagEnabled('wayback_suggest') && (e.errorCode === -105 || e.errorCode === -106 || e.errorCode === -102)) {
        if (window.toastManager) {
          window.toastManager.show('📜 Site Offline?', `Page failed to load. Would you like to check for a version on the Wayback Machine?`, 10000);
          const toastAction = document.getElementById('leef-toast-action');
          const primaryBtn = document.getElementById('btn-toast-primary');
          const secondaryBtn = document.getElementById('btn-toast-secondary');
          if (toastAction && primaryBtn && secondaryBtn) {
            toastAction.style.display = 'flex';
            primaryBtn.textContent = window.t ? window.t('Check Archive') : 'Check Archive';
            primaryBtn.onclick = () => {
              this.createTab('https://web.archive.org/web/*/' + e.validatedURL);
              window.toastManager.hide();
            };
            secondaryBtn.textContent = window.t ? window.t('Dismiss') : 'Dismiss';
            secondaryBtn.onclick = () => {
              window.toastManager.hide();
            };
          }
        }
      }

      // Only show offline page for main frame failures that aren't about-blank
      if (e.isMainFrame && e.validatedURL !== 'about:blank') {
        const path = window.require('path');
        const offlineFile = path.join(window.require('electron').remote ? window.require('electron').remote.app.getAppPath() : __dirname, 'offline.html');
        const offlinePath = `file:///${offlineFile.replace(/\\/g, '/')}?url=${encodeURIComponent(e.validatedURL)}&code=${e.errorCode}&desc=${encodeURIComponent(e.errorDescription)}`;

        // Defer the redirection slightly to let Chromium completely clean up the failed provisional load state in the event loop.
        // Also load about:blank first to guarantee a clean slate and avoid same-document query navigation bugs.
        try {
          tab.webviewEl.loadURL('about:blank');
        } catch (err) {
          tab.webviewEl.src = 'about:blank';
        }

        setTimeout(() => {
          try {
            tab.webviewEl.loadURL(offlinePath);
          } catch (err) {
            tab.webviewEl.src = offlinePath;
          }
        }, 50);
      }
    };

    tab.webviewEl.addEventListener('did-fail-load', handleNavigationFailure);
    tab.webviewEl.addEventListener('did-fail-provisional-load', handleNavigationFailure);

    // Right-Click Context Menu for Webviews
    tab.webviewEl.addEventListener('context-menu', (e) => {
      e.preventDefault();
      try {
        const params = e.params || {};
        params.webContentsId = tab.webviewEl.getWebContentsId();
        params.lang = window.getLanguage ? window.getLanguage() : (window.settingsManager?.currentSettings?.language || 'en');
        window.require('electron').ipcRenderer.send('show-context-menu', params);
      } catch (err) { }
    });

    // Fullscreen: hide/show browser chrome when a page requests fullscreen.
    // The main process handles OS-level fullscreen via webContents events directly.
    tab.webviewEl.addEventListener('enter-html-full-screen', () => {
      document.body.classList.add('video-fullscreen');
    });

    tab.webviewEl.addEventListener('leave-html-full-screen', () => {
      document.body.classList.remove('video-fullscreen');
      try {
        window.require('electron').ipcRenderer.send('exit-html-fullscreen');
      } catch (err) {}
    });

    // Close dropdowns when clicking on the webview (registers as focus)
    tab.webviewEl.addEventListener('focus', () => {
      const dropdowns = ['bookmarks-dropdown', 'downloads-dropdown', 'quick-settings-dropdown', 'site-identity-dropdown', 'plugins-dropdown'];
      dropdowns.forEach(id => {
        const d = document.getElementById(id);
        if (d) DropdownUtils.hide(d);
      });
      if (window.siteIdentityManager && window.siteIdentityManager._updateInterval) {
        clearInterval(window.siteIdentityManager._updateInterval);
        window.siteIdentityManager._updateInterval = null;
      }
    });
  }

  navigateToUrl(rawInput) {
    if (window.isCriticalMode) {
      if (window.toastManager) window.toastManager.show('🔒 Navigation Locked', 'You are currently in Critical Mode. Please update Leef Browser to resume normal browsing.', 6000);
      return;
    }
    if (!rawInput || !rawInput.trim()) return; // guard empty input

    // Hide address bar suggestions and remove focus when navigating
    if (window.addressBarManager) {
      window.addressBarManager._hideSuggestions(true);
    }
    if (window.homeSearchManager) {
      window.homeSearchManager._hideSuggestions(true);
    }
    if (UI.inputs.address) UI.inputs.address.blur();

    const tab = this.getActiveTab();
    if (!tab) return;

    tab._isCrashRecovering = false; // Reset crash recovery mode on manual navigation

    const fullUrl = BrowserUtils.parseAddress(rawInput.trim(), this.settings.currentSettings.searchEngine, this.settings.currentSettings.blockAIOverview);

    if (!tab.webviewEl) {
      // Lazy load instantiation
      this.mountWebview(tab);
    }

    tab.isInternal = false;
    tab.url = fullUrl;
    if (typeof tab.webviewEl.loadURL === 'function') {
      try {
        tab.webviewEl.loadURL(fullUrl);
      } catch (err) {
        tab.webviewEl.src = fullUrl;
      }
    } else {
      tab.webviewEl.src = fullUrl;
    }
    this.switchTab(tab.id, true);
  }

  updateTabUI(tab) {
    if (tab.url === 'home') tab.tabTitle.textContent = window.t('Leef Browser | Home');
    else if (tab.url === 'settings') tab.tabTitle.textContent = window.t('Settings');
    else if (tab.url === 'changelog') tab.tabTitle.textContent = window.t("What's New");
    else if (tab.url === 'flags') tab.tabTitle.textContent = window.t("Leef Labs");
    else if (tab.url === 'privacy') tab.tabTitle.textContent = window.t("Privacy Center");
    else if (tab.url === 'plugins') tab.tabTitle.textContent = window.t("Plugin Store");
    else {
      let displayTitle = window.t(tab.title || 'Loading...');
      const aiMode = this.settings.currentSettings.blockAIOverview;
      if (aiMode === 'deep' || aiMode === 'hide' || aiMode === true) {
        displayTitle = displayTitle.replace(/ -noai/gi, '');
      }
      tab.tabTitle.textContent = displayTitle;
    }

    // Set tooltip for everyone (especially important for pinned tabs)
    tab.tabEl.title = tab.tabTitle.textContent;

    if (this.activeTabId === tab.id) {
      if (document.activeElement !== UI.inputs.address) {
        if (!tab.isInternal) {
          // Strip -noai from the address bar for a seamless display
          let displayUrl = tab.url;

          // Handle Offline Page URL Spoofing (v0.2.1)
          if (displayUrl.startsWith('file://') && displayUrl.includes('offline.html')) {
            try {
              const urlObj = new URL(displayUrl);
              const params = new URLSearchParams(urlObj.search);
              const spoofUrl = params.get('url');
              if (spoofUrl) displayUrl = spoofUrl;
            } catch (e) { }
          }

          const currentAiMode = this.settings.currentSettings.blockAIOverview;
          const isDeepMode = currentAiMode === 'deep' || currentAiMode === true;
          if (isDeepMode && displayUrl.includes('google.com/search')) {
            displayUrl = displayUrl.replace(/(\+|\%20)-noai/g, '');
            displayUrl = displayUrl.replace(/([?&])udm=14(&?)/g, (match, p1, p2) => p2 ? p1 : '');
            displayUrl = displayUrl.replace(/[?&]$/, '');
          }
          UI.inputs.address.value = displayUrl;
        }
        else UI.inputs.address.value = '';
      }

      if (window.siteIdentityManager) {
        window.siteIdentityManager.updateUI();
      }

      // Update back/forward buttons disabled states
      if (tab.isInternal) {
        UI.buttons.back.disabled = true;
        UI.buttons.forward.disabled = true;
      } else if (tab.webviewEl) {
        try {
          UI.buttons.back.disabled = !tab.webviewEl.canGoBack();
          UI.buttons.forward.disabled = !tab.webviewEl.canGoForward();
        } catch (e) {
          UI.buttons.back.disabled = true;
          UI.buttons.forward.disabled = true;
        }
      } else {
        UI.buttons.back.disabled = true;
        UI.buttons.forward.disabled = true;
      }
    }

    // Favicon / Internal Icon
    if (tab.faviconEl) {
      if (tab.isInternal) {
        tab.faviconEl.classList.add('is-emoji');
        let icon = '📄';
        if (tab.url === 'home') icon = '🏠';
        else if (tab.url === 'settings') icon = '⚙️';
        else if (tab.url === 'changelog') icon = '📜';
        else if (tab.url === 'credits') icon = '💎';
        else if (tab.url === 'flags') icon = '🧪';
        else if (tab.url === 'privacy') icon = '🛡️';
        else if (tab.url === 'plugins') icon = '🧩';
        tab.faviconEl.textContent = icon;
        tab.faviconEl.style.backgroundImage = 'none';
      } else {
        if (tab.faviconUrl) {
          tab.faviconEl.classList.remove('is-emoji');
          tab.faviconEl.textContent = '';
          tab.faviconEl.style.backgroundImage = `url(${tab.faviconUrl})`;
          tab.faviconEl.style.backgroundSize = 'contain';
          tab.faviconEl.style.backgroundRepeat = 'no-repeat';
          tab.faviconEl.style.backgroundPosition = 'center';
        } else {
          tab.faviconEl.classList.add('is-emoji');
          tab.faviconEl.textContent = '🌐';
          tab.faviconEl.style.backgroundImage = 'none';
        }
      }
    }

    // Audio Indicator
    if (tab.audioIconEl) {
      tab.audioIconEl.style.display = tab.isAudioPlaying ? 'block' : 'none';
      tab.audioIconEl.style.color = tab.isMuted ? 'rgba(0,0,0,0.3)' : 'var(--primary-color)';
    }

    // Resource Indicator (Labs)
    if (tab.resourceIconEl) {
      tab.resourceIconEl.style.display = tab.isHighMemory ? 'block' : 'none';
    }

    // Panic Indicator (Labs)
    if (tab.panicIconEl) {
      tab.panicIconEl.style.display = this.isPanicActive ? 'block' : 'none';
    }
  }

  switchTab(tabId, force = false) {
    if (window.addressBarManager) {
      window.addressBarManager._hideSuggestions();
    }

    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;

    if (this.activeTabId === tabId && !force) {
      return;
    }

    if (window.isCriticalMode) {
      const isGithub = tab.url && tab.url.includes('github.com');
      if (!tab.isInternal && !isGithub) {
        if (window.toastManager) window.toastManager.show('🔒 Navigation Locked', 'This tab is locked in Critical Mode.', 3000);
        return;
      }
    }

    const prevTabId = this.activeTabId;
    this.activeTabId = tabId;

    // Wake up from hibernation (Labs)
    if (tab.isHibernated && tab.hibernateUrl) {
      console.log(`Leef Labs: Waking up tab ${tab.id}`);
      tab.isHibernated = false;
      if (typeof tab.webviewEl.loadURL === 'function') {
        try {
          tab.webviewEl.loadURL(tab.hibernateUrl);
        } catch (err) {
          tab.webviewEl.src = tab.hibernateUrl;
        }
      } else {
        tab.webviewEl.src = tab.hibernateUrl;
      }
      tab.hibernateUrl = null;
    }

    // Only suspend the previously active tab
    const limiterSettings = this.settings.currentSettings;
    if (prevTabId && prevTabId !== tabId) {
      const prevTab = this.tabs.find(t => t.id === prevTabId);
      if (prevTab && prevTab.webviewEl) {
        try {
          if (limiterSettings.backgroundLimit) {
            prevTab.webviewEl.setAudioMuted(true);
            prevTab.webviewEl.executeJavaScript(`
              document.querySelectorAll('video, audio').forEach(m => {
                if (!m.paused) { m.pause(); m.dataset.wasPlayingByLeef = "true"; }
              });
            `).catch(() => { });
          }

          // Leef Limiter: CPU Throttling (v0.5.0)
          if (!prevTab.isInternal) {
            const cpuFactor = (limiterSettings.cpuLimit || 100) / 100.0;
            // Background tabs get throttled even more if Efficiency Mode is on
            const finalFactor = limiterSettings.efficiencyMode ? Math.min(cpuFactor, 0.3) : cpuFactor;

            if (finalFactor < 1.0) {
              const wcId = prevTab.webviewEl.getWebContentsId();
              if (wcId) {
                window.require('electron').ipcRenderer.send('set-cpu-throttle', {
                  webContentsId: wcId,
                  factor: finalFactor
                });
              }
            }
          }

          // Resource Freezer (Labs): Record time backgrounded
          prevTab.lastActiveTime = Date.now();
        } catch (e) { }
      }
    }

    // Wake up current tab CPU (v0.5.0)
    if (tab.webviewEl && !tab.isInternal) {
      try {
        const wcId = tab.webviewEl.getWebContentsId();
        if (wcId) {
          window.require('electron').ipcRenderer.send('set-cpu-throttle', {
            webContentsId: wcId,
            factor: 1.0 // Unthrottle active tab
          });
        }
      } catch (e) { }
    }

    // Update tab strip UI
    this.tabs.forEach(t => {
      t.tabEl.classList.remove('active');
      if (t.webviewEl) t.webviewEl.classList.remove('active');
    });
    tab.tabEl.classList.add('active');

    // Scroll the newly activated tab into view smoothly
    tab.tabEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    this.updateTabScrollButtons();

    // Sync UI to tab state (Volume, etc)
    if (window.quickSettingsManager) {
      window.quickSettingsManager.updateUI();
    }

    // Restore active tab audio and resume paused media
    if (tab.webviewEl) {
      try {
        tab.webviewEl.setAudioMuted(false);
        if (this.settings.currentSettings.backgroundLimit) {
          tab.webviewEl.executeJavaScript(`
            document.querySelectorAll('video, audio').forEach(m => {
              if (m.dataset.wasPlayingByLeef === "true") { m.play(); delete m.dataset.wasPlayingByLeef; }
            });
          `).catch(() => { });
        }
      } catch (e) { }
    }

    // Manage Views
    UI.views.home.style.display = tab.url === 'home' ? 'flex' : 'none';
    UI.views.settings.style.display = tab.url === 'settings' ? 'flex' : 'none';
    UI.views.changelog.style.display = tab.url === 'changelog' ? 'flex' : 'none';
    UI.views.credits.style.display = tab.url === 'credits' ? 'flex' : 'none';

    const labsView = document.getElementById('flags-view');
    if (labsView) labsView.style.display = tab.url === 'flags' ? 'flex' : 'none';
    const privacyView = document.getElementById('privacy-view');
    if (privacyView) privacyView.style.display = tab.url === 'privacy' ? 'flex' : 'none';
    const pluginsView = document.getElementById('plugins-view');
    if (pluginsView) pluginsView.style.display = tab.url === 'plugins' ? 'flex' : 'none';

    if (tab.isInternal) {
      UI.views.webviewsContainer.classList.remove('active');
    } else {
      UI.views.webviewsContainer.classList.add('active');
      if (tab.webviewEl) tab.webviewEl.classList.add('active');
    }

    const drmIndicator = document.getElementById('drm-indicator');
    if (drmIndicator) drmIndicator.style.display = tab.hasDRM ? 'flex' : 'none';

    this.updateTabUI(tab);
    this.updateLoadingBar();
  }

  closeTab(tabId) {
    const index = this.tabs.findIndex(t => t.id === tabId);
    if (index === -1) return;

    const tab = this.tabs[index];

    if (tab.loadingInterval) {
      clearInterval(tab.loadingInterval);
      tab.loadingInterval = null;
    }

    // Determine target tab to switch to first if we are closing the active tab
    let targetTabId = null;
    if (this.activeTabId === tabId && this.tabs.length > 1) {
      const nextIndex = index === this.tabs.length - 1 ? index - 1 : index + 1;
      targetTabId = this.tabs[nextIndex].id;
    }

    // Stop and redirect webview immediately to cut off resource/network usage
    if (tab.webviewEl) {
      try { tab.webviewEl.stop(); } catch (e) { }
      try { tab.webviewEl.src = 'about:blank'; } catch (e) { }

      // Hide the webview immediately so it doesn't linger visually
      try {
        const wrapper = tab.webviewEl.closest('.webview-wrapper') || tab.webviewEl;
        if (wrapper) {
          wrapper.style.display = 'none';
        }
      } catch (e) { }
    }

    // Capture tab details for recently closed history before mutating
    const tabUrl = tab.url;
    const tabTitle = tab.title;
    const tabIsInternal = tab.isInternal;

    // Splice tab out of our logical list immediately so logical queries don't find it
    this.tabs.splice(index, 1);

    // Switch or create tabs immediately to maintain snappy user interface response
    if (this.tabs.length === 0) {
      this.createTab('home');
    } else if (targetTabId) {
      this.switchTab(targetTabId);
    }

    // Recently Closed Tabs stack (v0.3.2)
    if (!tabIsInternal && tabUrl && !tabUrl.startsWith('file://')) {
      if (!this.closedTabsStack) this.closedTabsStack = [];
      this.closedTabsStack.push({ url: tabUrl, title: tabTitle });
      if (this.closedTabsStack.length > 20) this.closedTabsStack.shift(); // Limit size

      // Tell main process that we have closed tabs now
      try {
        window.require('electron').ipcRenderer.send('update-closed-tabs-count', this.closedTabsStack.length);
      } catch (e) { }
    }

    // Trigger visual close transition
    const tabEl = tab.tabEl;
    if (tabEl) {
      tabEl.classList.add('closing');

      const cleanup = () => {
        try {
          if (tabEl.parentNode) {
            tabEl.remove();
          }
        } catch (e) { }

        // Final cleanup of the webview element to prevent memory leaks and break closures
        if (tab.webviewEl) {
          try {
            const clone = tab.webviewEl.cloneNode(false);
            if (tab.webviewEl.parentNode) {
              tab.webviewEl.parentNode.replaceChild(clone, tab.webviewEl);
            }
            clone.remove();
          } catch (e) {
            try { tab.webviewEl.remove(); } catch (err) { }
          }
        }

        // Null out references to allow garbage collection
        // Perf fix: clear any pending ytNavTimer to prevent post-close callbacks on destroyed webview
        if (tab._ytNavTimer) { clearTimeout(tab._ytNavTimer); tab._ytNavTimer = null; }
        tab.webviewEl = null;
        tab.tabEl = null;
        tab.tabTitle = null;
        this.updateTabScrollButtons();
      };

      // Listen for transitionend or use a timeout fallback to perform cleanup
      let cleaned = false;
      const onTransitionEnd = (e) => {
        if (e.propertyName === 'max-width' || e.propertyName === 'width' || e.propertyName === 'opacity') {
          if (!cleaned) {
            cleaned = true;
            tabEl.removeEventListener('transitionend', onTransitionEnd);
            cleanup();
          }
        }
      };
      tabEl.addEventListener('transitionend', onTransitionEnd);

      // Fallback timer slightly longer than 0.22s CSS transition
      setTimeout(() => {
        if (!cleaned) {
          cleaned = true;
          tabEl.removeEventListener('transitionend', onTransitionEnd);
          cleanup();
        }
      }, 250);
    } else {
      // If there's no tabEl, perform final webview cleanup immediately
      if (tab.webviewEl) {
        try { tab.webviewEl.remove(); } catch (e) { }
        tab.webviewEl = null;
      }
    }
  }

  reopenLastClosedTab() {
    if (!this.closedTabsStack || this.closedTabsStack.length === 0) return;
    const last = this.closedTabsStack.pop();
    this.createTab(last.url);

    try {
      window.require('electron').ipcRenderer.send('update-closed-tabs-count', this.closedTabsStack.length);
    } catch (e) { }
  }

  updateTabScrollButtons() {
    const container = UI.tabsContainer;
    const btnLeft = document.getElementById('btn-tab-scroll-left');
    const btnRight = document.getElementById('btn-tab-scroll-right');
    if (!container || !btnLeft || !btnRight) return;

    const hasOverflow = container.scrollWidth > container.clientWidth;
    if (hasOverflow) {
      btnLeft.style.display = 'flex';
      btnRight.style.display = 'flex';

      const scrollLeft = container.scrollLeft;
      const maxScrollLeft = container.scrollWidth - container.clientWidth;

      btnLeft.style.opacity = scrollLeft <= 1 ? '0.3' : '0.7';
      btnLeft.style.pointerEvents = scrollLeft <= 1 ? 'none' : 'auto';

      btnRight.style.opacity = scrollLeft >= maxScrollLeft - 1 ? '0.3' : '0.7';
      btnRight.style.pointerEvents = scrollLeft >= maxScrollLeft - 1 ? 'none' : 'auto';
    } else {
      btnLeft.style.display = 'none';
      btnRight.style.display = 'none';
    }
  }

  bindGlobalEvents() {
    // Tab scroll button click event listeners
    const btnLeft = document.getElementById('btn-tab-scroll-left');
    const btnRight = document.getElementById('btn-tab-scroll-right');
    if (btnLeft) {
      btnLeft.addEventListener('click', () => {
        UI.tabsContainer.scrollBy({ left: -200, behavior: 'smooth' });
      });
    }
    if (btnRight) {
      btnRight.addEventListener('click', () => {
        UI.tabsContainer.scrollBy({ left: 200, behavior: 'smooth' });
      });
    }

    // Scroll buttons state update on tab container scroll or window resize
    UI.tabsContainer.addEventListener('scroll', () => {
      this.updateTabScrollButtons();
    });
    window.addEventListener('resize', () => {
      this.updateTabScrollButtons();
    });

    // Translate vertical mouse wheel scrolling to horizontal scrolling for the tab row
    UI.tabsContainer.addEventListener('wheel', (e) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        UI.tabsContainer.scrollLeft += e.deltaY;
      }
    }, { passive: false });

    UI.tabsContainer.parentElement.addEventListener('contextmenu', (e) => {
      if (!e.target.closest('.tab') && !e.target.closest('.new-tab-btn')) {
        e.preventDefault();
        e.stopPropagation();
        try {
          const lang = window.getLanguage ? window.getLanguage() : (window.settingsManager?.currentSettings?.language || 'en');
          window.require('electron').ipcRenderer.send('show-tab-context-menu', { tabId: null, lang });
        } catch (err) { }
      }
    });

    UI.buttons.newTab.addEventListener('click', () => this.createTab('home'));

    // if (UI.buttons.settings) UI.buttons.settings.addEventListener('click', () => this.createTab('settings'));
    if (UI.buttons.whatsNew) UI.buttons.whatsNew.addEventListener('click', () => this.createTab('changelog'));
    if (UI.buttons.credits) UI.buttons.credits.addEventListener('click', () => this.createTab('credits'));

    // Global link interceptor for internal pages (v0.5.1)
    window.addEventListener('click', (e) => {
      const link = e.target.closest('a');
      if (link && link.href && link.href.startsWith('http')) {
        // Only intercept if the link is in the browser UI (not a webview)
        // Webview links are handled by their own 'new-window' listeners.
        e.preventDefault();
        this.createTab(link.href);
      }
    });

    // Handle Context Menu and Popup commands from Main Process
    try {
      window.require('electron').ipcRenderer.on('open-new-tab', (event, url) => {
        this.createTab(url);
      });

      window.require('electron').ipcRenderer.on('context-menu-command', (event, data) => {
        const tab = this.getActiveTab();
        if (!tab) return;

        switch (data.command) {
          case 'go-back':
            if (tab.webviewEl && tab.webviewEl.canGoBack()) tab.webviewEl.goBack();
            break;
          case 'go-forward':
            if (tab.webviewEl && tab.webviewEl.canGoForward()) tab.webviewEl.goForward();
            break;
          case 'reload':
            if (tab.webviewEl) tab.webviewEl.reload();
            break;
          case 'create-tab':
            this.createTab(data.url);
            break;
          case 'copy-image':
            if (tab.webviewEl) tab.webviewEl.copyImageAt(data.x, data.y);
            break;
          case 'search-google':
            this.createTab('https://www.google.com/search?q=' + encodeURIComponent(data.text));
            break;
          case 'print':
            if (tab.webviewEl) tab.webviewEl.print();
            break;
          case 'view-source':
            if (tab.webviewEl) this.createTab('view-source:' + tab.webviewEl.getURL());
            break;
          case 'save-page':
            if (tab.webviewEl) tab.webviewEl.downloadURL(tab.webviewEl.getURL());
            break;
          case 'check-slop':
            this.analyzeTextForSlop(data.text);
            break;
        }
      });

      window.require('electron').ipcRenderer.on('tab-command', (event, data) => {
        if (data.command === 'new-tab') {
          this.createTab('home');
          return;
        }
        const tab = this.tabs.find(t => t.id === data.tabId);
        if (!tab) return;

        switch (data.command) {
          case 'duplicate':
            this.createTab(tab.url);
            break;
          case 'toggle-pin':
            this.togglePin(tab);
            break;
          case 'toggle-mute':
            this.toggleMute(tab);
            break;
          case 'close':
            this.closeTab(tab.id);
            break;
          case 'close-others':
            this.tabs.filter(t => t.id !== tab.id).forEach(t => this.closeTab(t.id));
            break;
          case 'close-right':
            const index = this.tabs.indexOf(tab);
            if (index !== -1) {
              const toClose = this.tabs.slice(index + 1);
              toClose.forEach(t => this.closeTab(t.id));
            }
            break;
          case 'reload':
            if (tab.webviewEl) tab.webviewEl.reload();
            break;
        }
      });

      window.require('electron').ipcRenderer.on('reopen-closed-tab', () => {
        this.reopenLastClosedTab();
      });


    } catch (e) { }

    // Global context menu for non-webview areas (Home, Settings, etc.)
    window.addEventListener('contextmenu', (e) => {
      if (e.target.tagName === 'WEBVIEW') return;

      // Tab Bar Background Context Menu (v0.3.2)
      if (e.target.closest('.tabs-bar-container')) {
        e.preventDefault();
        const lang = window.getLanguage ? window.getLanguage() : (window.settingsManager?.currentSettings?.language || 'en');
        window.require('electron').ipcRenderer.send('show-tab-context-menu', { tabId: null, lang });
        return;
      }

      const params = {
        x: e.x,
        y: e.y,
        isEditable: e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable,
        selectionText: window.getSelection().toString(),
        canGoBack: false,
        canGoForward: false,
        editFlags: {},
        isBrowserUI: true,
        newsManualRefresh: false,
        lang: window.getLanguage ? window.getLanguage() : (window.settingsManager?.currentSettings?.language || 'en')
      };

      try {
        window.require('electron').ipcRenderer.send('show-context-menu', params);
      } catch (err) { }
    });

    window.addEventListener('keydown', (e) => {
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') || e.key === 'F5') {
        const tab = this.getActiveTab();
        if (tab && !tab.isInternal && tab.webviewEl) {
          e.preventDefault();
          tab.webviewEl.reload();
        }
      }
    });

    // Address Bar
    UI.inputs.address.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.navigateToUrl(UI.inputs.address.value);
    });


    // Browser Controls
    UI.buttons.back.addEventListener('click', () => {
      const tab = this.getActiveTab();
      if (tab && !tab.isInternal && tab.webviewEl && tab.webviewEl.canGoBack()) tab.webviewEl.goBack();
    });

    UI.buttons.forward.addEventListener('click', () => {
      const tab = this.getActiveTab();
      if (tab && !tab.isInternal && tab.webviewEl && tab.webviewEl.canGoForward()) tab.webviewEl.goForward();
    });

    UI.buttons.refresh.addEventListener('click', () => {
      const tab = this.getActiveTab();
      if (tab && !tab.isInternal && tab.webviewEl) tab.webviewEl.reload();
    });

    // Adblock Tracking (Batched v0.5.0)
    try {
      window.require('electron').ipcRenderer.on('adblock-items-blocked-batch', (event, data) => {
        const tab = this.tabs.find(t => t.webviewEl && t.webviewEl.getWebContentsId() === data.tabId);
        if (tab) {
          const ads = data.ads || 0;
          const trackers = data.trackers || 0;
          tab.blockedAds = (tab.blockedAds || 0) + ads;
          tab.blockedTrackers = (tab.blockedTrackers || 0) + trackers;
          if (!tab.blockedDomains) tab.blockedDomains = [];
          if (data.domains) {
            data.domains.forEach(d => {
              if (!tab.blockedDomains.some(b => b.domain === d) && tab.blockedDomains.length < 50) {
                tab.blockedDomains.push({ domain: d, timestamp: Date.now() });
              }
            });
          }
          if (this.activeTabId === tab.id && window.siteIdentityManager) {
            window.siteIdentityManager.updateUI();
            const trackerView = document.getElementById('si-tracker-view');
            if (trackerView && trackerView.style.display === 'block') {
              window.siteIdentityManager.populateTrackerList();
            }
          }
          if (window.privacyManager) {
            try {
              // Record one event per batch to save CPU, but increment the total counter
              const domain = new URL(data.url).hostname;
              window.privacyManager.totalBlocked += (ads + trackers);
              window.privacyManager.recordBlock(domain); // Record last domain for recent list
            } catch (e) { }
          }
        }
      });
    } catch (e) { }

    // Testing Shortcut: Ctrl+Shift+O to force-open the Offline Game (v0.2.1)
    window.require('electron').ipcRenderer.on('trigger-offline-game', () => {
      const tab = this.getActiveTab();
      if (tab) {
        const path = window.require('path');
        const offlineFile = path.join(window.require('electron').remote ? window.require('electron').remote.app.getAppPath() : __dirname, 'offline.html');
        const offlinePath = `file:///${offlineFile.replace(/\\/g, '/')}?url=${encodeURIComponent(tab.url || 'https://google.com')}`;
        if (!tab.webviewEl) this.mountWebview(tab);
        tab.isInternal = false;
        tab.webviewEl.loadURL(offlinePath);
      }
    });
  }

  syncInternalOrder() {
    const tabElements = Array.from(UI.tabsContainer.querySelectorAll('.tab'));
    const newTabsOrder = [];

    tabElements.forEach(el => {
      const tabId = el.dataset.tabId;
      const t = this.tabs.find(tab => tab.id === tabId);
      if (t) newTabsOrder.push(t);
    });

    this.tabs = newTabsOrder;
  }

  togglePin(tab) {
    tab.isPinned = !tab.isPinned;
    tab.tabEl.classList.toggle('pinned', tab.isPinned);
    if (tab.pinIconEl) tab.pinIconEl.style.display = tab.isPinned ? 'block' : 'none';

    // Sort pinned tabs to the front
    if (tab.isPinned) {
      UI.tabsContainer.insertBefore(tab.tabEl, UI.tabsContainer.firstChild);
    } else {
      // Move after last pinned tab or to start of unpinned
      const lastPinned = Array.from(UI.tabsContainer.querySelectorAll('.tab.pinned')).pop();
      if (lastPinned) {
        lastPinned.after(tab.tabEl);
      } else {
        UI.tabsContainer.insertBefore(tab.tabEl, UI.tabsContainer.firstChild);
      }
    }

    this.syncInternalOrder();
    this.updateTabUI(tab);
  }

  toggleMute(tab) {
    if (!tab.webviewEl) return;
    tab.isMuted = !tab.isMuted;
    try {
      tab.webviewEl.setAudioMuted(tab.isMuted);
    } catch (e) { }
    this.updateTabUI(tab);
  }

  analyzeTextForSlop(text) {
    if (!text || !window.toastManager) return;

    const STRONG_MARKERS = [
      'delve', 'tapestry', 'ever-evolving', 'unlock the potential', 'pave the way',
      'demystify', 'in today\'s digital age', 'look no further', 'it is worth noting',
      'important to note', 'paradigm shift', 'multifaceted', 'plethora', 'in the realm of',
      'at its core', 'shines a light', 'shed light', 'testament to'
    ];

    const MODERATE_MARKERS = [
      'meticulous', 'comprehensive', 'embark', 'furthermore', 'in conclusion',
      'seamlessly', 'vital', 'crucial', 'harness', 'leverage', 'beacon',
      'unwavering', 'underscores', 'invaluable', 'notably', 'moreover',
      'ultimately', 'pivotal', 'transformative', 'unparalleled', 'synergy',
      'bespoke', 'robust', 'nuance', 'nuanced', 'navigating', 'foster',
      'catalyst', 'undeniable', 'resonate', 'intricate', 'interplay',
      'symbiotic', 'cornerstone', 'orchestrate', 'empower', 'revolutionize',
      'elevate', 'transcend', 'dynamic', 'integration'
    ];

    let found = [];
    let score = 0;

    STRONG_MARKERS.forEach(word => {
      const regex = new RegExp(`\\b${word}\\b`, 'i');
      if (regex.test(text)) {
        found.push(word);
        score += 2;
      }
    });

    MODERATE_MARKERS.forEach(word => {
      const regex = new RegExp(`\\b${word}\\b`, 'i');
      if (regex.test(text)) {
        found.push(word);
        score += 1;
      }
    });

    // Structural check: Em-dash density (GPT-4 hallmark)
    const emDashes = (text.match(/—/g) || []).length;
    if (emDashes >= 2) {
      found.push(`Structural marker (multiple em-dashes)`);
      score += 2;
    } else if (emDashes === 1) {
      found.push(`Structural marker (em-dash)`);
      score += 1;
    }

    // Structural check: Bullet points
    const bullets = (text.match(/^\\s*[•*-]\\s/gm) || []).length;
    if (bullets >= 3) {
      found.push(`Structural marker (bullet lists)`);
      score += 1;
    }

    // Structural check: Title case colons (e.g. "Concept: ")
    const colons = (text.match(/[A-Z][a-z]+:\\s/g) || []).length;
    if (colons >= 2) {
      found.push(`Structural marker (label colons)`);
      score += 1;
    }

    let confidence = "No Patterns Detected";
    let icon = "✅";
    let titleMsg = "Audit Complete";

    if (score >= 4) {
      titleMsg = "Highly Possible AI";
      confidence = "High Probability Synthesis";
      icon = "🚨";
    } else if (score >= 2) {
      titleMsg = "Likely Synthetic";
      confidence = "Moderate Linguistic Signal";
      icon = "⚠️";
    } else if (score >= 1) {
      titleMsg = "Suspicious Outlier";
      confidence = "Low/Vague Signal";
      icon = "🧐";
    }

    window.toastManager.show("✨ Analyzing...", "Auditing linguistic indicators...", 1000);
    setTimeout(() => {
      let summary = score >= 1 
        ? (window.t ? window.t("Found {count} linguistic markers.", { count: found.length }) : `Found ${found.length} linguistic markers.`)
        : (window.t ? window.t("No synthetic patterns found.") : "No synthetic patterns found.");
      window.toastManager.show(titleMsg, summary, 12000);

      const toastAction = document.getElementById('leef-toast-action');
      const primaryBtn = document.getElementById('btn-toast-primary');
      const secondaryBtn = document.getElementById('btn-toast-secondary');

      if (toastAction && primaryBtn && score >= 1) {
        toastAction.style.display = 'flex';
        primaryBtn.style.display = 'block';
        primaryBtn.textContent = window.t ? window.t('View Diagnostic Report') : 'View Diagnostic Report';
        primaryBtn.onclick = () => {
          window.labsManager.showAuditWindow(confidence, found, icon);
        };
        if (secondaryBtn) secondaryBtn.style.display = 'none';
      }
    }, 800);
  }


}

class ToastManager {
  constructor() {
    this.el = document.getElementById('leef-toast');
    this.closeBtn = document.getElementById('leef-toast-close');
    this.hideTimer = null;
    this.shownThisSession = new Set();

    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', () => this.hide());
    }
  }

  show(title, msg, durationMs = 8000, action = null) {
    if (!this.el) return;
    this.activeTitle = title;

    // Translate title
    const translatedTitle = window.t ? window.t(title) : title;

    // Translate message with dynamic parameters fallback
    let translatedMsg = msg;
    if (window.t) {
      translatedMsg = window.t(msg);
      if (translatedMsg === msg) {
        // Apply regex mappings for dynamic values
        const patterns = [
          {
            regex: /Could not create the log file: (.*)/,
            key: "Could not create the log file: {error}",
            replace: (match, p1) => window.t("Could not create the log file: {error}").replace("{error}", p1)
          },
          {
            regex: /(.*) is available\. Do you want to download and install it\?/,
            key: "{version} is available. Do you want to download and install it?",
            replace: (match, p1) => window.t("{version} is available. Do you want to download and install it?").replace("{version}", p1)
          },
          {
            regex: /"(.*)" was removed from your bookmarks\./,
            key: "\"{title}\" was removed from your bookmarks.",
            replace: (match, p1) => window.t("\"{title}\" was removed from your bookmarks.").replace("{title}", p1)
          },
          {
            regex: /"(.*)" has been saved to your bookmarks\./,
            key: "\"{title}\" has been saved to your bookmarks.",
            replace: (match, p1) => window.t("\"{title}\" has been saved to your bookmarks.").replace("{title}", p1)
          },
          {
            regex: /"(.*)" has been added to your Hub\./,
            key: "\"{title}\" has been added to your Hub.",
            replace: (match, p1) => window.t("\"{title}\" has been added to your Hub.").replace("{title}", p1)
          },
          {
            regex: /"(.*)" has been removed from your Hub\./,
            key: "\"{title}\" has been removed from your Hub.",
            replace: (match, p1) => window.t("\"{title}\" has been removed from your Hub.").replace("{title}", p1)
          },
          {
            regex: /Looking up "(.*)"…/,
            key: "Looking up \"{query}\"…",
            replace: (match, p1) => window.t("Looking up \"{query}\"…").replace("{query}", p1)
          },
          {
            regex: /"(.*)" was frozen to save system resources\./,
            key: "\"{title}\" was frozen to save system resources.",
            replace: (match, p1) => window.t("\"{title}\" was frozen to save system resources.").replace("{title}", p1)
          },
          {
            regex: /Cleared cookies for (.*)\./,
            key: "Cleared cookies for {host}.",
            replace: (match, p1) => window.t("Cleared cookies for {host}.").replace("{host}", p1)
          },
          {
            regex: /Error: (.*)/,
            key: "Error: {error}",
            replace: (match, p1) => window.t("Error: {error}").replace("{error}", p1)
          },
          {
            regex: /Tuned feed for: (.*)/,
            key: "Tuned feed for: {topics}",
            replace: (match, p1) => window.t("Tuned feed for: {topics}").replace("{topics}", p1)
          }
        ];

        for (const p of patterns) {
          const m = msg.match(p.regex);
          if (m) {
            translatedMsg = p.replace(m, m[1]);
            break;
          }
        }
      }
    }

    this.el.querySelector('.leef-toast-title').textContent = translatedTitle;
    const msgEl = this.el.querySelector('.leef-toast-msg');
    if (msgEl) {
      if (translatedMsg && translatedMsg.includes('<') && translatedMsg.includes('>')) {
        msgEl.innerHTML = translatedMsg;
      } else {
        msgEl.textContent = translatedMsg;
      }
    }

    // Handle optional interactive action buttons
    const actionDiv = document.getElementById('leef-toast-action');
    const primaryBtn = document.getElementById('btn-toast-primary');
    const secondaryBtn = document.getElementById('btn-toast-secondary');

    if (action && actionDiv && primaryBtn) {
      actionDiv.style.display = 'flex';
      primaryBtn.style.display = 'block';
      primaryBtn.textContent = window.t ? window.t(action.primaryText || 'Action') : (action.primaryText || 'Action');
      primaryBtn.onclick = (e) => {
        e.stopPropagation();
        this.hide();
        if (action.onPrimary) action.onPrimary();
      };

      if (secondaryBtn) {
        if (action.secondaryText !== null) {
          secondaryBtn.style.display = 'block';
          secondaryBtn.textContent = window.t ? window.t(action.secondaryText || 'Dismiss') : (action.secondaryText || 'Dismiss');
          secondaryBtn.onclick = (e) => {
            e.stopPropagation();
            this.hide();
            if (action.onSecondary) action.onSecondary();
          };
        } else {
          secondaryBtn.style.display = 'none';
        }
      }
    } else if (actionDiv) {
      actionDiv.style.display = 'none';
    }

    this.el.classList.add('visible');
    clearTimeout(this.hideTimer);
    if (durationMs > 0) {
      this.hideTimer = setTimeout(() => this.hide(), durationMs);
    }
  }

  hide() {
    if (!this.el) return;
    this.activeTitle = null;
    this.el.classList.remove('visible');
  }

  showOnce(key, title, msg, durationMs = 8000) {
    if (this.shownThisSession.has(key)) return;
    this.shownThisSession.add(key);
    this.show(title, msg, durationMs);
  }
}

class DownloadManager {
  constructor() {
    this.el = document.getElementById('btn-downloads');
    this.list = document.getElementById('downloads-list');
    this.dropdown = document.getElementById('downloads-dropdown');
    this.toolbarRing = document.getElementById('toolbar-dl-ring');
    this.toolbarSvg = document.querySelector('.dl-progress-ring');
    this.downloads = new Map();
    this.ipc = window.require('electron').ipcRenderer;
    this.bindEvents();
    this.updateEmptyState();
  }

  updateEmptyState() {
    if (!this.list) return;
    if (this.list.children.length === 0 || (this.list.children.length === 1 && this.list.querySelector('.downloads-empty-placeholder'))) {
      if (!this.list.querySelector('.downloads-empty-placeholder')) {
        const placeholder = document.createElement('div');
        placeholder.className = 'downloads-empty-placeholder';
        placeholder.style.cssText = 'padding: 24px; text-align: center; color: var(--text-dark); opacity: 0.6; font-size: 0.85rem; font-style: italic;';
        placeholder.textContent = window.t ? window.t('No downloads yet') : 'No downloads yet';
        placeholder.setAttribute('data-i18n', 'No downloads yet');
        this.list.appendChild(placeholder);
      }
    } else {
      const placeholder = this.list.querySelector('.downloads-empty-placeholder');
      if (placeholder) placeholder.remove();
    }
  }


  bindEvents() {
    if (this.el) {
      this.el.addEventListener('click', (e) => {
        e.stopPropagation();
        const isVisible = this.dropdown.classList.contains('visible');
        if (isVisible) {
          DropdownUtils.hide(this.dropdown);
        } else {
          DropdownUtils.show(this.dropdown, 'block');
          // Close other dropdowns
          const b = document.getElementById('bookmarks-dropdown');
          if (b) DropdownUtils.hide(b);
          const q = document.getElementById('quick-settings-dropdown');
          if (q) DropdownUtils.hide(q);
          const s = document.getElementById('site-identity-dropdown');
          if (s) DropdownUtils.hide(s);
          const p = document.getElementById('plugins-dropdown');
          if (p) DropdownUtils.hide(p);
        }
      });
    }

    // Global close
    document.addEventListener('click', (e) => {
      if (this.dropdown && !this.dropdown.contains(e.target) && e.target !== this.el) {
        DropdownUtils.hide(this.dropdown);
      }
    });

    window.require('electron').ipcRenderer.on('download-status', (event, data) => {
      const id = String(data.id);
      if (data.status === 'started') {
        // Memory Optimization: Prune download history (v0.4.3)
        // Keeps the list from growing indefinitely during long sessions.
        if (this.downloads.size > 50) {
          const oldestId = this.downloads.keys().next().value;
          this.downloads.delete(oldestId);
          const oldestEl = document.getElementById(`dl-${oldestId}`);
          if (oldestEl) oldestEl.remove();
        }

        this.downloads.set(id, { ...data, id, received: 0, startTime: Date.now() });
        this.renderItem(id);
        // Show dropdown when download starts
        DropdownUtils.show(this.dropdown, 'block');
      } else if (data.status === 'progressing') {
        const dl = this.downloads.get(id);
        if (dl) {
          dl.received = data.received;
          if (data.total) dl.total = data.total;
          if (data.state) dl.state = data.state;

          if (dl.status === 'paused') {
            dl.status = 'progressing';
            this.renderItem(id);
          } else {
            dl.status = 'progressing';
            this.updateItemProgress(id);
          }
        }
      } else if (data.status === 'completed') {
        const dl = this.downloads.get(data.id);
        if (dl) {
          dl.status = 'completed';
          dl.path = data.path;
          this.renderItem(data.id);
          this.updateToolbarProgress();
        }
      } else if (data.status === 'failed' || data.status === 'interrupted' || data.status === 'cancelled') {
        const id = String(data.id);
        const dl = this.downloads.get(id);
        if (dl) {
          dl.status = data.status;
          this.renderItem(id);
          this.updateToolbarProgress();
        }
      } else if (data.status === 'paused') {
        const id = String(data.id);
        const dl = this.downloads.get(id);
        if (dl) {
          dl.status = 'paused';
          this.renderItem(id);
        }
      }
    });
  }

  formatBytes(bytes, decimals = 1) {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  renderItem(id) {
    const dl = this.downloads.get(id);
    if (!dl) return;

    let itemEl = document.getElementById(`dl-${id}`);
    if (!itemEl) {
      itemEl = document.createElement('div');
      itemEl.id = `dl-${id}`;
      itemEl.className = 'download-item';
      this.list.insertBefore(itemEl, this.list.firstChild);
    }

    const isDone = dl.status === 'completed';
    const isCancelled = dl.status === 'cancelled';
    const isFailed = dl.status === 'failed' || dl.status === 'interrupted' || isCancelled;
    const isPaused = dl.status === 'paused';
    const progress = dl.total > 0 ? Math.round((dl.received / dl.total) * 100) : 0;
    const displayName = BrowserUtils.sanitize(dl.name || 'Downloading...');

    let statusText = isDone ? 'Finished' : (isCancelled ? 'Cancelled' : (isFailed ? 'Failed' : (isPaused ? 'Paused' : progress + '%')));

    let errorHTML = '';
    if (isFailed && !isCancelled) {
      errorHTML = `<div style="color: #d32f2f; font-size: 0.75rem; text-align: center; margin-bottom: 4px;">Download failed. Check storage or network.</div>`;
    }

    itemEl.innerHTML = `
      <div class="download-info" style="display: flex; justify-content: space-between; margin-bottom: 4px;">
        <span class="download-name" title="${displayName}" style="font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px;">${displayName}</span>
        <span class="download-percent" style="font-size: 0.8rem; opacity: 0.7;">${statusText}</span>
      </div>

      <div class="download-details" style="display: ${isDone || isFailed ? 'none' : 'flex'}; justify-content: space-between; font-size: 0.75rem; opacity: 0.6; margin-bottom: 6px;">
        <span class="dl-size-info">${this.formatBytes(dl.received)} / ${this.formatBytes(dl.total)}</span>
        <span class="dl-speed-info">0 KB/s</span>
      </div>

      <div class="download-progress-container" style="height: 6px; background: rgba(0,0,0,0.06); border-radius: 3px; overflow: hidden; margin-bottom: 8px; display: ${isDone || isFailed ? 'none' : 'block'}">
        <div class="download-progress-bar" id="pb-${id}" style="width: ${progress}%; height: 100%; background: var(--primary-color); transition: width 0.3s; opacity: ${isPaused ? 0.5 : 1};"></div>
      </div>
      
      <div class="download-actions" style="display: ${isDone ? 'flex' : 'none'}; gap: 8px;">
        <button class="settings-btn btn-open-folder" style="padding: 4px 10px; font-size: 0.75rem; width: 100%;">Open in Folder</button>
      </div>

      <div class="download-actions-active" style="display: ${!isDone && !isFailed ? 'flex' : 'none'}; gap: 8px;">
        <button class="settings-btn btn-pause-resume" style="padding: 4px 10px; font-size: 0.75rem; flex: 1;">${isPaused ? 'Resume' : 'Pause'}</button>
        <button class="settings-btn btn-cancel" style="padding: 4px 10px; font-size: 0.75rem; flex: 1;">Cancel</button>
      </div>

      <div class="download-actions-failed" style="display: ${isFailed ? 'flex' : 'none'}; gap: 8px; flex-direction: column;">
        ${errorHTML}
        <button class="settings-btn btn-retry" style="padding: 4px 10px; font-size: 0.75rem; width: 100%;">Retry Download</button>
      </div>
    `;

    if (isDone) {
      const openBtn = itemEl.querySelector('.btn-open-folder');
      if (openBtn) {
        openBtn.onclick = () => {
          this.ipc.send('show-item-in-folder', dl.path);
        };
      }
    }

    if (!isDone && !isFailed) {
      const prBtn = itemEl.querySelector('.btn-pause-resume');
      const cancelBtn = itemEl.querySelector('.btn-cancel');
      if (prBtn) prBtn.onclick = () => this.ipc.send(isPaused ? 'resume-download' : 'pause-download', id);
      if (cancelBtn) cancelBtn.onclick = () => this.ipc.send('cancel-download', id);
    }

    if (isFailed) {
      const retryBtn = itemEl.querySelector('.btn-retry');
      if (retryBtn) {
        retryBtn.onclick = () => {
          this.ipc.send('retry-download', dl.url);
        }
      }
    }

    this.updateEmptyState();
  }

  updateItemProgress(id) {
    const dl = this.downloads.get(id);
    if (!dl) return;

    const now = Date.now();
    const lastTime = dl.lastTime || dl.startTime || now;
    const lastReceived = dl.lastReceived || 0;

    // Calculate speed (bytes per second)
    const timeDiff = (now - lastTime) / 1000; // seconds
    if (timeDiff >= 0.5) { // Update speed every 0.5s
      const bytesDiff = dl.received - lastReceived;
      const bps = bytesDiff / timeDiff;

      const itemNode = document.getElementById(`dl-${id}`);
      const speedEl = itemNode ? itemNode.querySelector('.dl-speed-info') : null;
      if (speedEl) speedEl.textContent = this.formatBytes(bps) + '/s';


      dl.lastTime = now;
      dl.lastReceived = dl.received;
    }

    const progress = dl.total > 0 ? Math.round((dl.received / dl.total) * 100) : 0;
    const pb = document.getElementById(`pb-${id}`);
    const itemNode = document.getElementById(`dl-${id}`);
    const percent = itemNode ? itemNode.querySelector('.download-percent') : null;
    const sizeEl = itemNode ? itemNode.querySelector('.dl-size-info') : null;

    if (pb) pb.style.width = progress + '%';
    if (percent) percent.textContent = progress + '%';
    if (sizeEl) sizeEl.textContent = `${this.formatBytes(dl.received)} / ${this.formatBytes(dl.total)}`;

    this.updateToolbarProgress();
  }

  updateToolbarProgress() {
    if (!this.toolbarRing || !this.toolbarSvg) return;

    const active = Array.from(this.downloads.values()).filter(d => d.status === 'started' || d.status === 'progressing');

    if (active.length === 0) {
      this.toolbarSvg.style.display = 'none';
      return;
    }

    this.toolbarSvg.style.display = 'block';

    let totalBytes = 0;
    let receivedBytes = 0;
    active.forEach(d => {
      if (d.total > 0) {
        totalBytes += d.total;
        receivedBytes += d.received;
      }
    });

    if (totalBytes > 0) {
      const progress = receivedBytes / totalBytes;
      const offset = 62.8 - (62.8 * progress);
      this.toolbarRing.style.strokeDashoffset = offset;
    }
  }
}


class QuickSettingsManager {
  constructor() {
    this.el = document.getElementById('btn-settings');
    this.dropdown = document.getElementById('quick-settings-dropdown');

    // Tiles
    this.btnChangelog = document.getElementById('btn-qs-changelog');
    this.btnScreenshot = document.getElementById('btn-qs-screenshot');
    this.btnBug = document.getElementById('btn-qs-bug');
    this.btnTroubleshooter = document.getElementById('btn-qs-troubleshooter');
    this.sliderVolume = document.getElementById('qs-volume-slider');
    this.btnSettings = document.getElementById('btn-qs-settings');
    this.volumeTile = document.getElementById('qs-tile-volume');
    this.volumePercent = document.getElementById('qs-volume-percent');

    this.bindEvents();
  }

  updateUI() {
    // Sync Volume Tile state
    let settings = {};
    try { settings = JSON.parse(localStorage.getItem('leef_settings') || '{}'); } catch (err) { }

    if (this.volumeTile) {
      if (!settings.enableVolumeBoost) {
        this.volumeTile.classList.add('disabled');
        this.dropdown.classList.add('no-volume');
      } else {
        this.volumeTile.classList.remove('disabled');
        this.dropdown.classList.remove('no-volume');
      }
    }

    // Sync Slider to Active Tab
    if (window.tabManager) {
      const tab = window.tabManager.getActiveTab();
      if (tab) {
        const val = tab.volumeBoost || 1;
        if (this.sliderVolume) {
          this.sliderVolume.value = val;
          if (this.volumePercent) this.volumePercent.textContent = Math.round(val * 100) + '%';

          // Disable slider for internal pages
          if (tab.isInternal) {
            this.sliderVolume.disabled = true;
            this.volumeTile.style.opacity = '0.5';
          } else {
            this.sliderVolume.disabled = false;
            this.volumeTile.style.opacity = '1';
          }
        }
      }
    }
  }

  bindEvents() {
    if (this.el) {
      this.el.addEventListener('click', (e) => {
        e.stopPropagation();
        const isVisible = this.dropdown.classList.contains('visible');
        if (isVisible) {
          DropdownUtils.hide(this.dropdown);
        } else {
          DropdownUtils.show(this.dropdown, 'grid');
          this.updateUI();

          // Close other dropdowns
          const b = document.getElementById('bookmarks-dropdown');
          if (b) DropdownUtils.hide(b);
          const d = document.getElementById('downloads-dropdown');
          if (d) DropdownUtils.hide(d);
          const s = document.getElementById('site-identity-dropdown');
          if (s) DropdownUtils.hide(s);
          const p = document.getElementById('plugins-dropdown');
          if (p) DropdownUtils.hide(p);
        }
      });
    }

    // Global close
    document.addEventListener('click', (e) => {
      if (this.dropdown && !this.dropdown.contains(e.target) && e.target !== this.el) {
        DropdownUtils.hide(this.dropdown);
      }
    });

    if (this.btnChangelog) {
      this.btnChangelog.addEventListener('click', () => {
        if (window.tabManager) window.tabManager.createTab('changelog');
        DropdownUtils.hide(this.dropdown);
      });
    }

    if (this.btnSettings) {
      this.btnSettings.addEventListener('click', () => {
        if (window.tabManager) window.tabManager.createTab('settings');
        DropdownUtils.hide(this.dropdown);
      });
    }

    if (this.sliderVolume) {
      this.sliderVolume.addEventListener('input', (e) => {
        if (!window.tabManager) return;
        const activeTab = window.tabManager.getActiveTab();
        if (!activeTab || activeTab.isInternal || !activeTab.webviewEl) return;

        let settings = {};
        try { settings = JSON.parse(localStorage.getItem('leef_settings') || '{}'); } catch (err) { }

        if (!settings.enableVolumeBoost) {
          if (window.toastManager) window.toastManager.show('🔊 Volume Booster Disabled', 'Enable this feature in Settings > Performance first.', 3000);
          this.sliderVolume.value = 1;
          return;
        }

        const gainValue = e.target.value;
        if (this.volumePercent) this.volumePercent.textContent = Math.round(gainValue * 100) + '%';
        activeTab.volumeBoost = gainValue;

        const injectScript = `
          if (!window.__leef_volume_ctx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) {
              window.__leef_volume_ctx = new AudioCtx();
              window.__leef_volume_gain = window.__leef_volume_ctx.createGain();
              window.__leef_volume_gain.connect(window.__leef_volume_ctx.destination);
              
              const routeMedia = (media) => {
                if (!media.__leef_routed) {
                  media.__leef_routed = true;
                  try {
                    const source = window.__leef_volume_ctx.createMediaElementSource(media);
                    source.connect(window.__leef_volume_gain);
                  } catch(err) { console.error('Leef Audio Routing error', err); }
                }
              };

              document.querySelectorAll('video, audio').forEach(routeMedia);

              let volTimer;
              const observer = new MutationObserver(() => {
                clearTimeout(volTimer);
                volTimer = setTimeout(() => {
                  document.querySelectorAll('video, audio').forEach(routeMedia);
                }, 500);
              });
              observer.observe(document.body, { childList: true, subtree: true });
            }
          }
          if (window.__leef_volume_gain) {
            window.__leef_volume_gain.gain.value = ${gainValue};
          }
        `;
        activeTab.webviewEl.executeJavaScript(injectScript);
      });
    }

    if (this.btnScreenshot) {
      this.btnScreenshot.addEventListener('click', () => {
        // Close menu first and wait for browser to repaint before capturing
        DropdownUtils.hide(this.dropdown);
        setTimeout(() => {
          if (window.toastManager) window.toastManager.show('📸 Screenshot', 'Capturing and copying to clipboard...', 2000);
          window.require('electron').ipcRenderer.send('capture-page');
        }, 400);
      });
    }

    window.require('electron').ipcRenderer.on('screenshot-captured', (event, data) => {
      if (data.success) {
        if (window.toastManager) window.toastManager.show('✅ Screenshot Copied', 'Copied to clipboard and saved to Downloads.', 5000);
      } else {
        if (window.toastManager) window.toastManager.show('❌ Capture Failed', `Error: ${data.error}`, 5000);
      }
    });

    if (this.btnBug) {
      this.btnBug.addEventListener('click', () => {
        DropdownUtils.hide(this.dropdown);
        const confirmMsg = "Generating a bug report will save a diagnostics file to your PC.\n\n" +
          "This file contains system specs and configurations to help with bug reports. " +
          "It will NEVER leave your PC unless you manually choose to share it.\n\n" +
          "Do you want to proceed and generate the Bug Report log?";
        const confirmed = window.confirm(window.t ? window.t(confirmMsg) : confirmMsg);
        if (confirmed) {
          const payload = {
            settings: JSON.parse(localStorage.getItem('leef_settings') || '{}'),
            labs: JSON.parse(localStorage.getItem('leef_labs_flags') || '{}')
          };
          window.require('electron').ipcRenderer.send('generate-bug-log', payload);
          if (window.toastManager) window.toastManager.show('⚙️ Generating...', 'Compiling system diagnostics. Please wait...', 3000);
        }
      });
    }

    if (this.btnTroubleshooter) {
      this.btnTroubleshooter.addEventListener('click', () => {
        DropdownUtils.hide(this.dropdown);
        if (window.tabManager) {
          window.tabManager.createTab('https://leefbrowser.site/troubleshooter');
        }
      });
    }
  }
}

class SiteIdentityManager {
  constructor() {
    this.btnGlobe = document.getElementById('btn-site-identity');
    this.dropdown = document.getElementById('site-identity-dropdown');
    this.domainEl = document.getElementById('si-domain');
    this.statusEl = document.getElementById('si-status');
    this.adblockCountEl = document.getElementById('si-adblock-count');
    this.trackerCountEl = document.getElementById('si-tracker-count');
    this.gpcStatusEl = document.getElementById('si-gpc-status');
    this.gpcTimerEl = document.getElementById('si-gpc-timer');
    this.gpcRowEl = document.getElementById('si-gpc-row');
    this.btnClearCookies = document.getElementById('btn-clear-site-cookies');
    this.gpcAlertEl = document.getElementById('gpc-alert-indicator');
    this.gpcBadgeDot = document.getElementById('gpc-badge-dot');
    this._gpcCache = new Map(); // domain -> { verified: bool, fetchedAt: ts }

    // Remote GPC Non-Compliant Gist Configuration (v0.6.1)
    const storedBlacklistUrl = localStorage.getItem('leef_gpc_blacklist_url') || 'https://gist.githubusercontent.com/Zexerif/cff8fb4f9cebc0bec205b2b2a37f73dc/raw/gistfile1.txt';
    this.gpcGistUrl = this.cleanGistRawUrl(storedBlacklistUrl);
    this.gpcBlacklist = this.loadGPCCache();
    this.fetchGPCBlacklist();

    // Remote GPC Manually Approved Whitelist Gist Configuration (v0.6.3)
    const storedManualUrl = localStorage.getItem('leef_gpc_manual_approved_url') || 'https://gist.githubusercontent.com/Zexerif/b45362241d75f03e84900719470bc961/raw/manualapproval';
    this.gpcManualApprovedUrl = this.cleanGistRawUrl(storedManualUrl);
    this.gpcManualApproved = this.loadGPCManualCache();
    this.fetchGPCManualApproved();

    this.bindEvents();
  }

  cleanGistRawUrl(url) {
    if (!url) return url;
    // Strip GitHub raw commit SHA to always track the latest version dynamically
    return url.replace(/\/raw\/[a-f0-9]{40}\//i, '/raw/');
  }

  cacheGpcResult(domain, verified) {
    if (this._gpcCache.size >= 1000) {
      this._gpcCache.clear();
      console.log('SiteIdentityManager: GPC domain cache cleared to prevent memory growth.');
    }
    this._gpcCache.set(domain, { verified, fetchedAt: Date.now() });
  }

  loadGPCCache() {
    try {
      const cached = localStorage.getItem('leef_gpc_blacklist');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map(d => String(d).trim().toLowerCase());
        }
      }
    } catch (e) {
      console.error('Error loading GPC blacklist cache:', e);
    }
    return [];
  }

  async fetchGPCBlacklist() {
    try {
      // Append a cache-buster timestamp to bypass GitHub raw CDN caching and load the fresh Gist instantly
      const freshUrl = this.gpcGistUrl + '?t=' + Date.now();
      const res = await fetch(freshUrl, { method: 'GET', cache: 'no-store' });
      if (res.ok) {
        const text = await res.text();
        let list = [];
        try {
          list = JSON.parse(text);
        } catch (err) {
          // Fallback: Robust regex extraction of quoted strings (immune to missing commas/JSON syntax errors)
          const matches = [...text.matchAll(/"([^"]+)"/g)].map(m => m[1].trim());
          if (matches.length > 0) {
            list = matches;
          } else {
            list = text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#'));
          }
        }
        if (Array.isArray(list)) {
          this.gpcBlacklist = list.map(d => String(d).trim().toLowerCase());
          localStorage.setItem('leef_gpc_blacklist', JSON.stringify(this.gpcBlacklist));
          console.log('SiteIdentityManager: GPC blacklist successfully synced from remote Gist.');
        }
      }
    } catch (e) {
      console.log('SiteIdentityManager: Remote Gist offline or pending (using cached/fallback blacklist).');
    }
  }

  parseCaveats(raw) {
    if (Array.isArray(raw)) {
      return raw.map(c => parseInt(c) || 0).filter(c => c > 0).slice(0, 3);
    }
    if (typeof raw === 'number') {
      return raw > 0 ? [raw] : [];
    }
    if (typeof raw === 'string') {
      return raw.split(';').map(c => parseInt(c.trim()) || 0).filter(c => c > 0).slice(0, 3);
    }
    return [];
  }

  loadGPCManualCache() {
    try {
      const cached = localStorage.getItem('leef_gpc_manual_approved');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map(d => {
            if (typeof d === 'string') {
              const parts = d.split(',');
              const caveatStr = parts.slice(2).join(';');
              return {
                rule: parts[0].trim().toLowerCase(),
                reason: parseInt(parts[1]) || 0,
                caveat: parseInt(parts[2]) || 0,
                caveats: this.parseCaveats(caveatStr || parts[2])
              };
            }
            if (typeof d === 'object' && d !== null && d.rule) {
              const caveats = this.parseCaveats(d.caveats || d.caveat);
              return {
                rule: String(d.rule).trim().toLowerCase(),
                reason: parseInt(d.reason) || 0,
                caveat: caveats[0] || parseInt(d.caveat) || 0,
                caveats
              };
            }
            return { rule: String(d).trim().toLowerCase(), reason: 0, caveat: 0, caveats: [] };
          });
        }
      }
    } catch (e) {
      console.error('Error loading GPC manual approved cache:', e);
    }
    return [];
  }

  async fetchGPCManualApproved() {
    try {
      const freshUrl = this.gpcManualApprovedUrl + '?t=' + Date.now();
      const res = await fetch(freshUrl, { method: 'GET', cache: 'no-store' });
      if (res.ok) {
        const text = await res.text();
        let list = [];
        try {
          list = JSON.parse(text);
        } catch (err) {
          // Fallback: Robust regex extraction of quoted strings (immune to missing commas/JSON syntax errors)
          const matches = [...text.matchAll(/"([^"]+)"/g)].map(m => m[1].trim());
          if (matches.length > 0) {
            list = matches;
          } else {
            list = text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#'));
          }
        }
        if (Array.isArray(list)) {
          this.gpcManualApproved = list.map(d => {
            if (typeof d === 'object' && d !== null && d.rule) {
              const caveats = this.parseCaveats(d.caveats || d.caveat);
              return {
                rule: String(d.rule).trim().toLowerCase(),
                reason: parseInt(d.reason) || 0,
                caveat: caveats[0] || parseInt(d.caveat) || 0,
                caveats
              };
            }
            const str = String(d).trim().toLowerCase();
            const parts = str.split(',');
            const caveats = parts.slice(2).map(p => parseInt(p.trim()) || 0).filter(c => c > 0).slice(0, 3);
            return {
              rule: parts[0].trim(),
              reason: parseInt(parts[1]) || 0,
              caveat: caveats[0] || 0,
              caveats
            };
          });
          localStorage.setItem('leef_gpc_manual_approved', JSON.stringify(this.gpcManualApproved));
          console.log('SiteIdentityManager: GPC manually approved list successfully synced from remote Gist.');
        }
      }
    } catch (e) {
      console.log('SiteIdentityManager: Remote manual approved Gist offline or pending (using cached/fallback).');
    }
  }

  bindEvents() {
    if (this.btnGlobe) {
      this.btnGlobe.addEventListener('click', (e) => {
        e.stopPropagation();
        const isVisible = this.dropdown.classList.contains('visible');
        if (isVisible) {
          DropdownUtils.hide(this.dropdown);
        } else {
          const mainView = document.getElementById('si-main-view');
          const trackerView = document.getElementById('si-tracker-view');
          if (mainView && trackerView) {
            mainView.style.display = 'block';
            trackerView.style.display = 'none';
          }
          DropdownUtils.show(this.dropdown, 'block');
          // Close others
          const d1 = document.getElementById('bookmarks-dropdown');
          const d2 = document.getElementById('downloads-dropdown');
          const d3 = document.getElementById('quick-settings-dropdown');
          const d4 = document.getElementById('plugins-dropdown');
          if (d1) DropdownUtils.hide(d1);
          if (d2) DropdownUtils.hide(d2);
          if (d3) DropdownUtils.hide(d3);
          if (d4) DropdownUtils.hide(d4);

          this.updateUI();
        }

        // Real-time updates while open, but only while the answer is still pending
        if (this.dropdown.classList.contains('visible')) {
          if (this._updateInterval) clearInterval(this._updateInterval);
          this._updateInterval = setInterval(() => {
            // Stop if closed
            if (!this.dropdown.classList.contains('visible')) {
              clearInterval(this._updateInterval);
              this._updateInterval = null;
              return;
            }
            const t = window.tabManager?.getActiveTab();
            // Stop polling once we have a definitive answer (true or false)
            if (t && (t.gpcVerified !== undefined || (Date.now() - (t.gpcStartTime || 0)) > 10000)) {
              clearInterval(this._updateInterval);
              this._updateInterval = null;
            }
            this.updateUI();
          }, 1000);
        } else {
          if (this._updateInterval) { clearInterval(this._updateInterval); this._updateInterval = null; }
        }
      });
    }

    const btnShowTrackers = document.getElementById('btn-show-trackers');
    const btnHideTrackers = document.getElementById('btn-hide-trackers');
    const mainView = document.getElementById('si-main-view');
    const trackerView = document.getElementById('si-tracker-view');

    if (btnShowTrackers) {
      btnShowTrackers.addEventListener('click', (e) => {
        e.stopPropagation();
        if (mainView && trackerView) {
          mainView.style.display = 'none';
          trackerView.style.display = 'block';
          this.populateTrackerList();
          if (this.dropdown) {
            this.dropdown.style.display = 'none';
            void this.dropdown.offsetHeight;
            this.dropdown.style.display = 'block';
          }
        }
      });
    }

    if (btnHideTrackers) {
      btnHideTrackers.addEventListener('click', (e) => {
        e.stopPropagation();
        if (mainView && trackerView) {
          trackerView.style.display = 'none';
          mainView.style.display = 'block';
          if (this.dropdown) {
            this.dropdown.style.display = 'none';
            void this.dropdown.offsetHeight;
            this.dropdown.style.display = 'block';
          }
        }
      });
    }

    document.addEventListener('click', (e) => {
      if (this.dropdown && !this.dropdown.contains(e.target) && e.target !== this.btnGlobe && !this.btnGlobe.contains(e.target)) {
        DropdownUtils.hide(this.dropdown);
        if (this._updateInterval) { clearInterval(this._updateInterval); this._updateInterval = null; }
      }
    });

    if (this.btnClearCookies) {
      this.btnClearCookies.addEventListener('click', () => {
        if (!window.tabManager) return;
        const tab = window.tabManager.getActiveTab();
        if (!tab || tab.isInternal) return;

        try {
          const url = new URL(tab.url);
          window.require('electron').ipcRenderer.send('clear-site-data', url.hostname);
          if (window.toastManager) window.toastManager.show('🍪 Cookies Cleared', `Cleared cookies for ${url.hostname}.`, 3000);
          DropdownUtils.hide(this.dropdown);
        } catch (e) { }
      });
    }

    const btnDashboard = document.getElementById('btn-si-dashboard');
    if (btnDashboard) {
      btnDashboard.addEventListener('click', () => {
        DropdownUtils.hide(this.dropdown);
        if (window.tabManager) {
          window.tabManager.createTab('privacy');
        }
      });
    }

    const btnWhois = document.getElementById('btn-si-whois');
    if (btnWhois) {
      btnWhois.addEventListener('click', () => {
        DropdownUtils.hide(this.dropdown);
        const tab = window.tabManager.getActiveTab();
        if (tab && !tab.isInternal) {
          try {
            const domain = new URL(tab.url).hostname;
            window.tabManager.createTab(`https://who.is/whois/${domain}`);
          } catch (e) { }
        }
      });
    }

    // Bind Click to GPC Row/Card for info modal (v0.6.2)
    if (this.gpcRowEl) {
      this.gpcRowEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const tab = window.tabManager?.getActiveTab();
        if (!tab) return;

        // Close the Site Identity dropdown first
        DropdownUtils.hide(this.dropdown);
        if (this._updateInterval) {
          clearInterval(this._updateInterval);
          this._updateInterval = null;
        }

        this.showGpcInfoModal(tab);
      });
    }

    // Bind Click to GPC Alert Indicator in address bar (v0.6.2)
    if (this.gpcAlertEl) {
      this.gpcAlertEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const tab = window.tabManager?.getActiveTab();
        if (!tab) return;
        this.showGpcInfoModal(tab);
      });
    }

    // Bind Close for GPC Info Modal
    const gpcInfoModal = document.getElementById('gpc-info-modal');
    const gpcInfoClose = document.getElementById('gpc-info-close');
    if (gpcInfoClose && gpcInfoModal) {
      gpcInfoClose.addEventListener('click', () => {
        gpcInfoModal.style.display = 'none';
      });
      gpcInfoModal.addEventListener('click', (e) => {
        if (e.target === gpcInfoModal) gpcInfoModal.style.display = 'none';
      });
    }
  }

  populateTrackerList() {
    const listEl = document.getElementById('si-tracker-list');
    const emptyEl = document.getElementById('si-tracker-empty');
    if (!listEl || !emptyEl) return;
    listEl.innerHTML = '';

    const tab = window.tabManager?.getActiveTab();
    if (!tab || !tab.blockedDomains || tab.blockedDomains.length === 0) {
      listEl.style.display = 'none';
      emptyEl.style.display = 'block';
      return;
    }

    listEl.style.display = 'block';
    emptyEl.style.display = 'none';

    const now = Date.now();
    const twelveHours = 12 * 60 * 60 * 1000;

    // Filter and sort domains
    const activeDomains = tab.blockedDomains.filter(d => (now - d.timestamp) < twelveHours);

    if (activeDomains.length === 0) {
      listEl.style.display = 'none';
      emptyEl.style.display = 'block';
      return;
    }

    activeDomains.forEach(d => {
      const li = document.createElement('li');
      li.className = 'si-tracker-item';
      li.innerHTML = `<span class="si-tracker-domain">${d.domain}</span><span class="si-tracker-blocked-badge">Blocked</span>`;
      listEl.appendChild(li);
    });
  }

  updateUI() {
    if (!window.tabManager) return;
    const tab = window.tabManager.getActiveTab();
    if (!tab) return;

    const isInternal = tab.isInternal || tab.url.startsWith('leef:') || tab.url.startsWith('file:') || tab.url.startsWith('chrome:');
    const headerIcon = document.getElementById('si-header-icon');

    // Helper to set status pill state
    const setStatus = (text, state) => {
      if (this.statusEl) {
        this.statusEl.textContent = text;
        this.statusEl.className = 'si-status-pill' + (state ? ` ${state}` : '');
        this.statusEl.style.color = '';
      }
      if (headerIcon) {
        headerIcon.className = 'si-header-icon' + (state ? ` ${state}` : '');
      }
    };

    if (isInternal) {
      if (this.domainEl) this.domainEl.textContent = 'Leef Browser';
      setStatus('Local Application Page', 'info');
      if (this.adblockCountEl) this.adblockCountEl.textContent = '0';
      if (this.trackerCountEl) this.trackerCountEl.textContent = '0';
      this._updateGPCStatus(tab);
    } else {
      try {
        const urlObj = new URL(tab.url);
        if (this.domainEl) this.domainEl.textContent = urlObj.hostname;

        if (urlObj.protocol === 'https:') {
          const statusText = tab.gpcVerified
            ? 'Secure & privacy-protected'
            : 'Connection is secure';
          setStatus(statusText, null); // default = green pill
        } else {
          setStatus('Connection is NOT secure', 'insecure');
        }

        // Adblock stats
        if (this.adblockCountEl) this.adblockCountEl.textContent = tab.blockedAds || '0';
        if (this.trackerCountEl) this.trackerCountEl.textContent = tab.blockedTrackers || '0';

        // GPC indicator
        this._updateGPCStatus(tab);

      } catch (e) {
        if (this.domainEl) this.domainEl.textContent = 'Unknown';
      }
    }
  }

  _updateGPCStatus(tab) {
    const el = this.gpcStatusEl;
    const timer = this.gpcTimerEl;
    const row = this.gpcRowEl;
    if (!el || !row) return;

    if (tab) {
      tab.gpcManuallyVerified = false;
    }

    // Always reset the absolute-positioned GPC badge dot
    if (this.gpcBadgeDot) {
      this.gpcBadgeDot.className = 'gpc-badge-dot';
      this.gpcBadgeDot.innerHTML = '';
    }

    // Hide the alert indicator and reset its collapsed class on actual tab switches
    const tabChanged = tab && tab.id !== this.lastActiveTabId;
    if (tabChanged) {
      this.lastActiveTabId = tab.id;
      if (this.gpcAlertEl) {
        this.gpcAlertEl.style.display = 'none';
        this.gpcAlertEl.className = 'gpc-alert-indicator';
        void this.gpcAlertEl.offsetWidth; // Force reflow
      }
    }

    const gpcEnabled = window.settingsManager?.currentSettings?.gpc !== false;
    if (!gpcEnabled || !tab || tab.isInternal) {
      el.textContent = window.t ? window.t('Disabled') : 'Disabled';
      el.className = 'gpc-badge gpc-disabled';
      if (timer) timer.textContent = '';
      if (row) row.style.opacity = '0.5';
      if (this.gpcAlertEl) this.gpcAlertEl.style.display = 'none';
      return;
    }

    if (row) row.style.opacity = '1';

    let domain;
    try { domain = new URL(tab.url).hostname.toLowerCase(); } catch { return; }

    // 0. Check for GPC Manually Approved/Verified Whitelist (v0.6.3)
    let manualReason = 0;
    let manualCaveat = 0;
    let manualCaveats = [];
    const isManuallyApproved = (this.gpcManualApproved || []).some(entry => {
      let rule = '';
      let reason = 0;
      let caveat = 0;
      let caveats = [];
      if (typeof entry === 'object' && entry !== null) {
        rule = entry.rule;
        reason = entry.reason;
        caveat = entry.caveat;
        caveats = entry.caveats || (caveat > 0 ? [caveat] : []);
      } else {
        rule = String(entry);
      }

      let matches = false;
      if (rule.endsWith('.*')) {
        const brand = rule.slice(0, -2);
        const regex = new RegExp('(^|\\.)' + brand + '\\.[a-z]{2,}(\\.[a-z]{2})?$', 'i');
        matches = regex.test(domain);
      } else {
        matches = domain === rule || domain.endsWith('.' + rule);
      }

      if (matches) {
        manualReason = reason;
        manualCaveat = caveat;
        manualCaveats = caveats;
      }
      return matches;
    });

    if (isManuallyApproved) {
      el.textContent = window.t ? window.t('Manually Verified') : 'Manually Verified';
      el.className = 'gpc-badge gpc-verified';
      if (timer) timer.textContent = '(Approved)';
      tab.gpcManuallyVerified = true;
      tab.gpcManualReason = manualReason;
      tab.gpcManualCaveat = manualCaveat;
      tab.gpcManualCaveats = manualCaveats;
      tab.gpcVerified = true;
      if (this.gpcBadgeDot) {
        this.gpcBadgeDot.className = 'gpc-badge-dot manual show';
      }
      if (this.gpcAlertEl) this.gpcAlertEl.style.display = 'none';
      return;
    }

    // 1. Check for Known Non-Compliant Domains (dynamically fetched from remote Gist, supporting wildcard .* domains)
    const isNonCompliant = (this.gpcBlacklist || []).some(rule => {
      if (rule.endsWith('.*')) {
        const brand = rule.slice(0, -2); // Extract e.g. "amazon" from "amazon.*"
        // Matches "brand.tld", "brand.co.uk", "subdomain.brand.tld"
        const regex = new RegExp('(^|\\.)' + brand + '\\.[a-z]{2,}(\\.[a-z]{2})?$', 'i');
        return regex.test(domain);
      }
      return domain === rule || domain.endsWith('.' + rule);
    });
    if (isNonCompliant) {
      el.textContent = window.t ? window.t('No GPC support') : 'No GPC support';
      el.className = 'gpc-badge gpc-unsupported';
      if (timer) timer.textContent = '(Known)';
      tab.gpcVerified = false;
      if (this.gpcAlertEl) {
        this.gpcAlertEl.style.display = 'flex';
        // Ensure default class structure is kept
        this.gpcAlertEl.className = 'gpc-alert-indicator';
        this.gpcAlertEl.innerHTML = `
          <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <span>${window.t ? window.t('No GPC Support') : 'No GPC Support'}</span>
        `;
        if (!tab.gpcAlertCollapsed) {
          this.gpcAlertEl.classList.remove('collapsed');
          if (this.gpcBadgeDot) this.gpcBadgeDot.className = 'gpc-badge-dot';
          if (this._gpcCollapseTimeout) clearTimeout(this._gpcCollapseTimeout);
          this._gpcCollapseTimeout = setTimeout(() => {
            tab.gpcAlertCollapsed = true;
            if (window.tabManager && window.tabManager.getActiveTab() === tab) {
              if (this.gpcAlertEl) this.gpcAlertEl.classList.add('collapsed');
              if (this.gpcBadgeDot) this.gpcBadgeDot.className = 'gpc-badge-dot unsupported show';
            }
          }, 3500);
        } else {
          this.gpcAlertEl.classList.add('collapsed');
          if (this.gpcBadgeDot) this.gpcBadgeDot.className = 'gpc-badge-dot unsupported show';
        }
      }
      return;
    }

    // Already settled this navigation — update DOM unconditionally
    if (tab.gpcVerified !== undefined) {
      if (tab.gpcVerified) {
        el.textContent = window.t ? window.t('Verified ✓') : 'Verified ✓';
        el.className = 'gpc-badge gpc-verified';
        if (timer) {
          const diff = tab.gpcVerifiedTime
            ? (tab.gpcVerifiedTime - (tab.gpcStartTime || tab.gpcVerifiedTime)) / 1000
            : null;
          timer.textContent = diff === null ? '' : diff > 10 ? '(>10s)' : '(' + Math.max(0.1, diff).toFixed(1) + 's)';
        }
        if (this.gpcBadgeDot) {
          this.gpcBadgeDot.className = 'gpc-badge-dot verified show';
          this.gpcBadgeDot.innerHTML = `
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="#000000" stroke-width="4.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          `;
        }
        if (this.gpcAlertEl) this.gpcAlertEl.style.display = 'none';
        return;
      } else {
        el.textContent = window.t ? window.t('Unverified') : 'Unverified';
        el.className = 'gpc-badge gpc-unverified';
        if (timer) timer.textContent = '(no response)';
        if (this.gpcAlertEl) this.gpcAlertEl.style.display = 'none';
        return;
      }
    }

    // Show pending state while we look it up
    el.textContent = window.t ? window.t('Sent') : 'Sent';
    el.className = 'gpc-badge gpc-sent';
    if (timer) timer.textContent = '(checking...)';
    if (this.gpcAlertEl) this.gpcAlertEl.style.display = 'none';

    // Check /.well-known/gpc.json — the GPC spec's official compliance declaration

    const cached = this._gpcCache.get(domain);
    if (cached) {
      tab.gpcVerified = cached.verified;
      tab.gpcVerifiedTime = cached.fetchedAt;
      this._updateGPCStatus(tab);
      return;
    }

    // Use the webview to fetch to avoid CORS issues from the renderer process
    if (tab.webviewEl) {
      tab.webviewEl.executeJavaScript(`
        (function() {
          if (window.location.hostname !== '${domain}') return { error: 'wrong origin' };
          return fetch('/.well-known/gpc.json', { method: 'GET', cache: 'no-store' })
            .then(res => res.ok ? res.json() : null)
            .catch(() => null);
        })();
      `).then(json => {
        if (json && json.error === 'wrong origin') return; // Webview hasn't navigated yet, wait for next poll

        const respected = json && json.gpc === true;
        const now = Date.now();
        this.cacheGpcResult(domain, respected);

        if (respected) {
          tab.gpcVerified = true;
          tab.gpcVerifiedTime = now;
        } else if (tab.gpcVerified === undefined) {
          tab.gpcVerified = false;
        }

        // Trigger a full UI update to refresh the top status text too
        if (this.dropdown && this.dropdown.style.display !== 'none') {
          this.updateUI();
        }
      }).catch(() => {
        if (tab.gpcVerified === undefined) {
          const now = Date.now();
          this.cacheGpcResult(domain, false);
          tab.gpcVerified = false;
          if (this.dropdown && this.dropdown.style.display !== 'none') {
            this.updateUI();
          }
        }
      });
    }
  }

  showGpcInfoModal(tab) {
    const modal = document.getElementById('gpc-info-modal');
    const iconEl = document.getElementById('gpc-modal-icon');
    const titleEl = document.getElementById('gpc-modal-title');
    const subtitleEl = document.getElementById('gpc-modal-subtitle');
    const detailEl = document.getElementById('gpc-modal-detail');

    if (!modal || !iconEl || !titleEl || !subtitleEl || !detailEl) return;

    const gpcEnabled = window.settingsManager?.currentSettings?.gpc !== false;

    // Check if GPC is disabled globally
    if (!gpcEnabled) {
      iconEl.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#999999" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>`;
      iconEl.style.backgroundColor = 'rgba(0, 0, 0, 0.05)';
      subtitleEl.textContent = window.t ? window.t('GPC Signal Disabled') : 'GPC Signal Disabled';
      subtitleEl.style.background = 'rgba(0, 0, 0, 0.05)';
      subtitleEl.style.color = '#999';

      detailEl.innerHTML = `
        <p style="margin-bottom: 12px;">
          <strong>Why is GPC disabled?</strong><br>
          You have turned off the Global Privacy Control signal in your settings. Leef is not broadcasting your privacy preferences to websites.
        </p>
        <p style="margin-bottom: 0;">
          <strong>How to enable it:</strong><br>
          To automatically tell websites not to sell or share your data, go to the <strong>Privacy & Security</strong> settings page and turn on the <strong>Global Privacy Control (GPC)</strong> toggle.
        </p>
      `;
      modal.style.display = 'flex';
      return;
    }

    if (!tab || tab.isInternal) {
      iconEl.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#666666" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
      iconEl.style.backgroundColor = 'rgba(0, 0, 0, 0.05)';
      subtitleEl.textContent = window.t ? window.t('Local Application Page') : 'Local Application Page';
      subtitleEl.style.background = 'rgba(0, 0, 0, 0.05)';
      subtitleEl.style.color = '#666';

      detailEl.innerHTML = `
        <p style="margin-bottom: 0;">
          This is an internal browser page. Leef does not broadcast tracking or privacy signals on internal offline pages.
        </p>
      `;
      modal.style.display = 'flex';
      return;
    }

    let domain;
    try { domain = new URL(tab.url).hostname.toLowerCase(); } catch { return; }

    // Check if manually approved/verified (Gist-backed) (v0.6.3)
    let manualReason = tab.gpcManualReason || 0;
    let manualCaveats = tab.gpcManualCaveats || (tab.gpcManualCaveat ? [tab.gpcManualCaveat] : []);
    const isManuallyApproved = (this.gpcManualApproved || []).some(entry => {
      let rule = '';
      let reason = 0;
      let caveats = [];
      if (typeof entry === 'object' && entry !== null) {
        rule = entry.rule;
        reason = entry.reason;
        caveats = entry.caveats || (entry.caveat > 0 ? [entry.caveat] : []);
      } else {
        rule = String(entry);
      }

      let matches = false;
      if (rule.endsWith('.*')) {
        const brand = rule.slice(0, -2);
        const regex = new RegExp('(^|\\.)' + brand + '\\.[a-z]{2,}(\\.[a-z]{2})?$', 'i');
        matches = regex.test(domain);
      } else {
        matches = domain === rule || domain.endsWith('.' + rule);
      }
      if (matches && manualReason === 0) {
        manualReason = reason;
        manualCaveats = caveats;
      }
      return matches;
    });

    if (isManuallyApproved || tab.gpcManuallyVerified) {
      iconEl.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#2196f3" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><path d="m9 11 2 2 4-4"></path></svg>`;
      iconEl.style.backgroundColor = 'rgba(33, 150, 243, 0.1)';
      subtitleEl.textContent = window.t ? window.t('Manually Verified') : 'Manually Verified';
      subtitleEl.style.background = 'rgba(33, 150, 243, 0.1)';
      subtitleEl.style.color = '#2196f3';

      let reasonHtml = `
          This website was manually verified because of one of these reasons:
          <ul style="margin: 8px 0 0 20px; padding: 0; list-style-type: disc;">
            <li style="margin-bottom: 6px;">Its privacy policy states that they comply with GPC.</li>
            <li style="margin-bottom: 6px;">They are known to comply with GPC but don't have a header installed.</li>
            <li style="margin-bottom: 0;">It has been audited by Leef and is confirmed to comply with the GPC standards.</li>
          </ul>
      `;

      if (manualReason === 1) {
        reasonHtml = `<strong>Reason for Verification:</strong><br>This website's privacy policy states that it will respect GPC as an opt-out request.`;
      } else if (manualReason === 2) {
        reasonHtml = `<strong>Reason for Verification:</strong><br>This website has stated publicly, or in private correspondence with the Leef team or journalists, that it respects the GPC signal.`;
      } else if (manualReason === 3) {
        reasonHtml = `<strong>Reason for Verification:</strong><br>This website has been technically audited by Leef and is confirmed to comply with the GPC standards.`;
      } else if (manualReason === 4) {
        reasonHtml = `<strong>Reason for Verification:</strong><br>This website utilizes a known privacy-respecting framework that honors GPC globally.`;
      } else if (manualReason === 5) {
        reasonHtml = `<strong>Reason for Verification:</strong><br>This website is part of a verified network of privacy-first domains.`;
      }

      const getCaveatMessage = (caveatNum) => {
        if (caveatNum === 1) return `Even though they have stated that they respect GPC signals, this website may still use your data internally for analytics, data retention, internal research, and more. Read the privacy policy of this site for more info.`;
        if (caveatNum === 2) {
          let reasonSummary = "of their privacy policy";
          if (manualReason === 2) reasonSummary = "of statements made to journalists or the Leef team";
          if (manualReason === 3) reasonSummary = "it passed a technical audit";
          if (manualReason === 4) reasonSummary = "of its privacy-respecting framework";
          if (manualReason === 5) reasonSummary = "it is in a verified network";
          return `This website technically has GPC compliance because ${reasonSummary}. However, there is no hard evidence that they strictly comply, or they may not legally have to comply depending on where the company is based.`;
        }
        if (caveatNum === 3) return `This site says they support GPC, but some elements or sub-services on the site may not support it.`;
        if (caveatNum === 4) return `This site states they support GPC, but some parts of this company require you to download something to your computer (e.g., software, launchers) which are not audited by Leef.`;
        if (caveatNum === 5) return `This site is owned by an outside investor (e.g., Tencent, Blackrock, Amazon, Google, Microsoft) which may not follow the same privacy rules as this company. Read the site privacy policy for more info.`;
        if (caveatNum === 6) return `This site is able to use your data even when you have the GPC header using a legal gray area. For example, AI chatbots can still see and use your chat info even when you have the GPC header. Read the site privacy policy for more info.`;
        if (caveatNum === 7) return `While this website states they support GPC, their compliance is geographically limited to certain regions or states and may not be honored globally. Please review their privacy policy for details.`;
        if (caveatNum === 8) return `This website is owned by an organization with a history of meeting only the bare minimum regulatory requirements for user privacy. We recommend exercising caution when sharing sensitive data.`;
        if (caveatNum === 9) return `This site is operated by a parent company that restricts GPC compliance to specific regions or states. Your privacy signal may not be respected depending on your location.`;
        if (caveatNum === 10) return `This website requires identity verification through a third-party vendor. This vendor may operate under different privacy standards and could potentially sell your information to outside entities.`;
        if (caveatNum === 11) return `This organization publicly supports the DNT (Do Not Track) header but has not made explicit statements regarding their support for the Global Privacy Control (GPC) signal.`;
        if (caveatNum === 12) return `If you explicitly opt-in to data sharing or selling on this website, those settings will override your browser's GPC preferences, and your signal will not be respected.`;
        return '';
      };

      const activeCaveats = manualCaveats.slice(0, 3).filter(c => c > 0);
      let caveatItems = activeCaveats.map(cNum => {
        const msg = getCaveatMessage(cNum);
        if (!msg) return '';
        const translatedMsg = window.t ? window.t(msg) : msg;
        return `<div style="padding: 10px; background: rgba(255, 152, 0, 0.1); border-left: 4px solid #ff9800; color: #e65100; font-size: 0.88rem; line-height: 1.45; border-radius: 0 6px 6px 0;">
            <strong>Heads Up:</strong> ${translatedMsg}
          </div>`;
      }).filter(Boolean);

      let caveatHtml = '';
      if (caveatItems.length > 0) {
        caveatHtml = `
          <div style="margin-top: 14px; max-height: 135px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding-right: 4px;" class="custom-scroll">
            ${caveatItems.join('')}
          </div>
        `;
      }

      detailEl.innerHTML = `
        <p style="margin-bottom: 12px;">
          <strong>What does "Manually Verified" mean?</strong><br>
          This website (<code>${domain}</code>) has been manually checked and added to the Leef GPC trustlist. Even though it might not host a standard technical declaration (<code>/.well-known/gpc.json</code>), it is officially verified to respect privacy signals and user opt-out options.
        </p>
        <p style="margin-bottom: 0;">
          ${reasonHtml}
        </p>
        ${caveatHtml}
      `;
      modal.style.display = 'flex';
      return;
    }

    // Check if known non-compliant domain
    const isNonCompliant = (this.gpcBlacklist || []).some(rule => {
      if (rule.endsWith('.*')) {
        const brand = rule.slice(0, -2);
        const regex = new RegExp('(^|\\.)' + brand + '\\.[a-z]{2,}(\\.[a-z]{2})?$', 'i');
        return regex.test(domain);
      }
      return domain === rule || domain.endsWith('.' + rule);
    });

    if (isNonCompliant) {
      iconEl.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#f44336" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
      iconEl.style.backgroundColor = 'rgba(244, 67, 54, 0.1)';
      subtitleEl.textContent = window.t ? window.t('No GPC Support') : 'No GPC Support';
      subtitleEl.style.background = 'rgba(244, 67, 54, 0.1)';
      subtitleEl.style.color = '#f44336';

      detailEl.innerHTML = `
        <p style="margin-bottom: 12px;">
          <strong>What does "No GPC Support" mean?</strong><br>
          This website (<code>${domain}</code>) does not recognize or support the GPC signal, or has been manually identified as non-compliant. It is on a blacklist of sites that actively ignore browser privacy signals.
        </p>
        <p style="margin-bottom: 0;">
          <strong>What may this site do?</strong><br>
          Without GPC compliance, this website may:
          <ul style="margin: 6px 0 0 20px; padding: 0; list-style-type: disc;">
            <li>Sell or share your browsing habits, location, and device details with advertising networks and data brokers.</li>
            <li>Track your visits across other websites using tracking scripts and tracking cookies.</li>
            <li>Build a detailed digital profile of your personal interests to target you with ads.</li>
            <li>Ignore your explicit request to opt-out of personal data collection.</li>
          </ul>
        </p>
      `;
      modal.style.display = 'flex';
      return;
    }

    if (tab.gpcVerified !== undefined) {
      if (tab.gpcVerified) {
        iconEl.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#17b340" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><polyline points="9 11 11 13 15 9"></polyline></svg>`;
        iconEl.style.backgroundColor = 'rgba(23, 179, 64, 0.1)';
        subtitleEl.textContent = window.t ? window.t('Verified Compliant ✓') : 'Verified Compliant ✓';
        subtitleEl.style.background = 'rgba(23, 179, 64, 0.1)';
        subtitleEl.style.color = '#17b340';

        detailEl.innerHTML = `
          <p style="margin-bottom: 12px;">
            <strong>What does "Verified ✓" mean?</strong><br>
            Great news! Leef successfully verified this site's GPC compliance declaration. The site officially respects the GPC signal.
          </p>
          <p style="margin-bottom: 0;">
            <strong>What does this mean for your privacy?</strong><br>
            Under GPC specifications, this website is legally bound to:
            <ul style="margin: 6px 0 0 20px; padding: 0; list-style-type: disc;">
              <li><strong>Not</strong> sell your personal information to third parties.</li>
              <li><strong>Not</strong> share your data for cross-context behavioral advertising.</li>
              <li>Treat your visit as an active opt-out request under privacy regulations (like GDPR and CCPA).</li>
            </ul>
          </p>
        `;
      } else {
        iconEl.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#ff9800" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
        iconEl.style.backgroundColor = 'rgba(255, 152, 0, 0.1)';
        subtitleEl.textContent = window.t ? window.t('Unverified Response') : 'Unverified Response';
        subtitleEl.style.background = 'rgba(255, 152, 0, 0.1)';
        subtitleEl.style.color = '#ff9800';

        detailEl.innerHTML = `
          <p style="margin-bottom: 12px;">
            <strong>What does "Unverified" mean?</strong><br>
            Leef sent the GPC signal to this site, but the site did not respond with a valid compliance document (<code>/.well-known/gpc.json</code>). It is highly likely the site does not recognize or support the GPC signal.
          </p>
          <p style="margin-bottom: 0;">
            <strong>What may this site do?</strong><br>
            Since the site does not declare GPC compliance, it may continue to collect, share, or sell your personal information, search history, and browser settings without respect to your opt-out preference.
          </p>
        `;
      }
      modal.style.display = 'flex';
      return;
    }

    // Checking / Sent state
    iconEl.textContent = '⏳';
    subtitleEl.textContent = window.t ? window.t('Signal Sent (Verifying)') : 'Signal Sent (Verifying)';
    subtitleEl.style.background = 'rgba(0, 0, 0, 0.05)';
    subtitleEl.style.color = '#888';

    detailEl.innerHTML = `
      <p style="margin-bottom: 0;">
        <strong>What does "Sent" mean?</strong><br>
        Leef has transmitted your Global Privacy Control preference to this site. We are currently checking the site's official compliance declaration (<code>/.well-known/gpc.json</code>) to verify if they respect the signal.
      </p>
    `;
    modal.style.display = 'flex';
  }
}

class LabsManager {
  constructor() {
    this.flags = this.loadFlags();
    this.view = document.getElementById('flags-view');
    this.btnOpenFooter = document.getElementById('btn-open-flags');
    this.btnOpenAdvanced = document.getElementById('btn-open-flags-advanced');
    this.btnApply = document.getElementById('btn-flags-relaunch');
    this.bindEvents();
    this.syncUI();
  }

  loadFlags() {
    try {
      return JSON.parse(localStorage.getItem('leef_labs_flags') || '{}');
    } catch (e) { return {}; }
  }

  saveFlags() {
    localStorage.setItem('leef_labs_flags', JSON.stringify(this.flags));
    if (this.btnApply) this.btnApply.style.display = 'inline-block';
  }

  bindEvents() {
    const openFlags = () => { if (window.tabManager) window.tabManager.createTab('flags'); };
    if (this.btnOpenFooter) this.btnOpenFooter.addEventListener('click', openFlags);
    if (this.btnOpenAdvanced) this.btnOpenAdvanced.addEventListener('click', openFlags);

    if (this.btnApply) {
      this.btnApply.addEventListener('click', () => {
        window.location.reload();
      });
    }

    const btnOpenPrivacy = document.getElementById('btn-open-privacy-lab');
    if (btnOpenPrivacy) {
      btnOpenPrivacy.addEventListener('click', () => {
        if (window.tabManager) window.tabManager.createTab('privacy');
      });
    }

    // Bind individual flags
    const bindFlag = (id, key) => {
      const el = document.getElementById(id);
      if (el) {
        el.checked = !!this.flags[key];
        
        if (key === 'opendyslexic') {
          document.body.classList.toggle('opendyslexic-mode', !!this.flags[key]);
        }
        
        el.addEventListener('change', (e) => {
          this.flags[key] = e.target.checked;
          
          if (key === 'opendyslexic') {
            document.body.classList.toggle('opendyslexic-mode', e.target.checked);
            // Re-inject CSS dynamically without reloading webview
            if (window.tabManager && window.tabManager.tabs) {
              window.tabManager.tabs.forEach(tab => {
                if (tab.webviewEl) {
                  if (e.target.checked) {
                    const dysCSS = `
                      @import url('https://cdn.jsdelivr.net/npm/@fontsource/opendyslexic/index.css');
                      * { font-family: 'OpenDyslexic', sans-serif !important; }
                    `;
                    tab.webviewEl.insertCSS(dysCSS).catch(() => {});
                  } else {
                    // Quick reload to remove the injected CSS since there's no removeCSS in webview API easily accessible here
                    tab.webviewEl.reload();
                  }
                }
              });
            }
          }
          
          this.saveFlags();
          // Force apply settings so main process sees the change (e.g. for Stealth UA)
          if (window.settingsManager) window.settingsManager.saveSettings();
        });
      }
    };

    const chkMaster = document.getElementById('flag-fingerprint-master');
    const subContainer = document.getElementById('fingerprint-sub-options');
    if (chkMaster) {
      chkMaster.checked = !!this.flags.fingerprint_master;
      if (subContainer) subContainer.style.display = chkMaster.checked ? 'block' : 'none';

      chkMaster.addEventListener('change', (e) => {
        this.flags.fingerprint_master = e.target.checked;
        if (subContainer) subContainer.style.display = e.target.checked ? 'block' : 'none';
        this.saveFlags();
        if (window.settingsManager) window.settingsManager.saveSettings();
      });
    }

    bindFlag('flag-fingerprint-master', 'fingerprint_master');
    bindFlag('flag-ghost-mode', 'ghost_mode');
    bindFlag('flag-wayback-suggest', 'wayback_suggest');
    bindFlag('flag-stealth-ua', 'stealth_ua');
    bindFlag('flag-audio-scrambler', 'audio_scrambler');
    bindFlag('flag-hardware-cloak', 'hardware_cloak');
    bindFlag('flag-timezone-spoof', 'timezone_spoof');
    bindFlag('flag-font-mask', 'font_mask');
    bindFlag('flag-dnt-header', 'dnt_header');
    bindFlag('flag-yt-warp-speed', 'yt_warp_speed');

    // New Lab Flags
    bindFlag('flag-css-exorcist', 'css_exorcist');

    bindFlag('flag-slop-scanner', 'slop_scanner');

    bindFlag('flag-block-drm', 'block_drm');

    bindFlag('flag-opendyslexic', 'opendyslexic');

    bindFlag('flag-classic-news-dismiss', 'classic_news_dismiss');
    const chkClassicDismiss = document.getElementById('flag-classic-news-dismiss');
    if (chkClassicDismiss) {
      chkClassicDismiss.addEventListener('change', () => {
        if (window.newsSvc) window.newsSvc.renderCards();
      });
    }
  }

  syncUI() {
    // Handled by bindFlag in current implementation
  }

  isFlagEnabled(key) {
    const fingerprintFlags = ['ghost_mode', 'stealth_ua', 'audio_scrambler', 'hardware_cloak', 'timezone_spoof', 'font_mask', 'dnt_header', 'css_exorcist'];
    if (fingerprintFlags.includes(key)) {
      return !!(this.flags.fingerprint_master && this.flags[key]);
    }
    return !!this.flags[key];
  }

  showAuditWindow(confidence, foundMarkers, icon) {
    const modal = document.getElementById('audit-modal');
    const summaryEl = document.getElementById('audit-confidence-summary');
    const tableBody = document.getElementById('audit-table-body');
    const iconEl = document.getElementById('audit-icon');
    const dotEl = document.getElementById('audit-indicator-dot');

    if (modal && summaryEl && tableBody && iconEl) {
      const confText = window.t ? window.t('Confidence: {level}', { level: confidence }) : `Confidence: ${confidence}`;
      summaryEl.innerHTML = `<div id="audit-indicator-dot" style="width: 12px; height: 12px; border-radius: 50%; background: ${icon === '🚨' ? '#d32f2f' : (icon === '⚠️' ? '#ff9800' : '#17b340')};"></div> ${confText}`;
      iconEl.textContent = icon;

      tableBody.innerHTML = '';
      foundMarkers.forEach(m => {
        const row = document.createElement('tr');
        row.style.borderBottom = '1px solid #eee';

        let category = "Linguistic Marker";
        if (m.includes('Structural')) category = "Structural Pattern";
        if (m.includes('Formatting')) category = "Formatting Signature";
        const catTranslated = window.t ? window.t(category) : category;

        row.innerHTML = `
          <td style="padding: 12px; font-family: monospace; font-size: 0.85rem; color: #111;">"${m}"</td>
          <td style="padding: 12px; font-size: 0.85rem; color: #666;">${catTranslated}</td>
        `;
        tableBody.appendChild(row);
      });

      modal.style.display = 'flex';
    }
  }
}

class HeroManager {
  constructor() {
    this.clockEl = document.getElementById('home-clock');
    this.greetingEl = document.getElementById('home-greeting');
    if (this.clockEl && this.greetingEl) {
      this.start();
    }
  }

  start() {
    this.update();
    // Perf fix: Store handle to allow future cancellation and prevent double-registration
    this._interval = setInterval(() => this.update(), 1000);
  }

  update() {
    // Efficiency: Slow down or skip clock updates if not visible (v0.5.0)
    const limiter = window.settingsManager?.currentSettings;
    const isEfficiency = limiter?.efficiencyMode;
    const homeView = document.getElementById('home-view');
    const isHomeVisible = homeView && homeView.style.display === 'flex';

    if (isEfficiency && !isHomeVisible) return;

    const settings = window.settingsManager?.currentSettings;
    const now = new Date();
    let hours = now.getHours();
    let minutes = String(now.getMinutes()).padStart(2, '0');

    // Timezone conversion if specified
    if (settings && settings.timezone && settings.timezone !== 'auto') {
      try {
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: settings.timezone,
          hour: 'numeric',
          minute: 'numeric',
          hourCycle: 'h23'
        }).formatToParts(now);

        const hPart = parts.find(p => p.type === 'hour');
        const mPart = parts.find(p => p.type === 'minute');
        if (hPart) hours = parseInt(hPart.value, 10);
        if (mPart) minutes = mPart.value.padStart(2, '0');
      } catch (e) {
        // Fallback to local time if timezone string is invalid
      }
    }

    if (this.clockEl) this.clockEl.textContent = `${hours % 12 || 12}:${minutes}`;

    if (this.greetingEl) {
      let greet = 'Good Evening';
      if (hours < 12) greet = 'Good Morning';
      else if (hours < 17) greet = 'Good Afternoon';
      else if (hours > 21) greet = 'Good Night';

      const lang = settings?.language || 'en';
      let localizedGreet = greet;
      if (lang !== 'en' && TRANSLATIONS[lang] && TRANSLATIONS[lang][greet]) {
        localizedGreet = TRANSLATIONS[lang][greet];
      }

      const customName = (settings?.greetingName || '').trim();
      if (customName) {
        this.greetingEl.textContent = `${localizedGreet}, ${customName}`;
      } else {
        this.greetingEl.textContent = localizedGreet;
      }
    }
  }
}

class EmergencyAnnouncer {
  constructor() {
    this.announcementUrl = 'https://gist.githubusercontent.com/Zexerif/f2481fb446ae22d2e21cfc266a8d24c4/raw/gistfile1.txt';
    try {
      this.appRepo = window.require('electron').ipcRenderer.sendSync('get-repo-slug') || 'git-QTech/leef';
    } catch (e) {
      this.appRepo = 'git-QTech/leef';
    }

    setTimeout(() => this.check(), 5000);

    // Show warning when navigation is blocked in critical mode
    window.require('electron').ipcRenderer.on('critical-mode-blocked-nav', () => {
      if (window.toastManager) {
        window.toastManager.show('🔒 Navigation Locked', 'You are currently in Critical Mode. Please update Leef Browser to resume normal browsing.', 6000);
      }
    });
  }

  isVersionMatch(target, current) {
    if (!target || target === 'all') return true;

    // Support multiple targets (comma separated)
    if (target.includes(',')) {
      return target.split(',').map(s => s.trim()).some(t => this.isVersionMatch(t, current));
    }

    // Support ranges (hyphen separated)
    if (target.includes(' - ')) {
      const parts = target.split(' - ').map(s => s.trim());
      if (parts.length === 2) {
        return this.isVersionMatch(`>=${parts[0]}`, current) && this.isVersionMatch(`<=${parts[1]}`, current);
      }
    }

    if (target === current) return true;

    let op = null;
    let ver = target;

    if (target.endsWith('>')) {
      op = '<';
      ver = target.slice(0, -1);
    } else if (target.endsWith('<')) {
      op = '>';
      ver = target.slice(0, -1);
    } else {
      const operators = ['>=', '<=', '>', '<'];
      for (const o of operators) {
        if (target.startsWith(o)) {
          op = o;
          ver = target.substring(o.length);
          break;
        }
      }
    }

    if (!op) return false;

    const parts1 = current.split('.').map(Number);
    const parts2 = ver.trim().split('.').map(Number);
    const maxLen = Math.max(parts1.length, parts2.length);

    let result = 0;
    for (let i = 0; i < maxLen; i++) {
      const n1 = parts1[i] || 0;
      const n2 = parts2[i] || 0;
      if (n1 > n2) { result = 1; break; }
      if (n1 < n2) { result = -1; break; }
    }

    if (op === '>') return result === 1;
    if (op === '<') return result === -1;
    if (op === '>=') return result >= 0;
    if (op === '<=') return result <= 0;

    return false;
  }

  async check() {
    try {
      const cacheBuster = this.announcementUrl.includes('?') ? '&t=' : '?t=';
      const res = await fetch(this.announcementUrl + cacheBuster + Date.now(), { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();

      // Support both single object (legacy) and array of announcements
      const announcements = Array.isArray(data) ? data : [data];
      const currentVersion = window.require('electron').ipcRenderer.sendSync('get-app-version') || '0.0.0';

      for (const item of announcements) {
        if (!item.active) continue;

        // Repository Filtering (Fork Protection)
        const targetRepo = item.repo || 'git-QTech/leef';
        if (targetRepo !== this.appRepo) {
          console.log(`Leef: Ignoring announcement for repository ${targetRepo}`);
          continue;
        }

        // 24h Dismissal Check
        const dismissUntil = parseInt(localStorage.getItem('leef_emergency_dismiss_until') || '0');
        const lastTitle = localStorage.getItem('leef_emergency_last_title') || '';
        if (Date.now() < dismissUntil && lastTitle === item.title) continue;

        // Version Targeting
        if (!this.isVersionMatch(item.targetVersion, currentVersion)) continue;

        // Match found! Show the modal and stop searching.
        this.showModal(item);
        break;
      }
    } catch (e) {
      console.warn("EmergencyAnnouncer failed to check for updates:", e);
    }
  }

  showModal(data) {
    const modal = document.getElementById('emergency-modal');
    const titleEl = document.getElementById('emergency-title');
    const msgEl = document.getElementById('emergency-msg');
    const actionsEl = document.getElementById('emergency-actions');

    if (modal && titleEl && msgEl && actionsEl) {
      titleEl.textContent = data.title || 'Announcement';
      msgEl.textContent = data.message || '';
      actionsEl.innerHTML = ''; // Clear previous buttons

      const isCritical = data.buttons && data.buttons.some(b => b.action === 'exit');
      if (isCritical) {
        window.isCriticalMode = true;
        window.require('electron').ipcRenderer.send('set-critical-mode', true);

        // Force close all non-essential tabs immediately
        if (window.tabManager) {
          const tabsToClose = window.tabManager.tabs.filter(t => {
            const isGithub = t.url && t.url.includes('github.com');
            return !t.isInternal && !isGithub;
          });
          tabsToClose.forEach(t => window.tabManager.closeTab(t.id));

          // If no tabs left, open home
          if (window.tabManager.tabs.length === 0) {
            window.tabManager.createTab('home');
          }
        }
      }

      if (data.buttons && Array.isArray(data.buttons)) {
        data.buttons.forEach((btn, index) => {
          const button = document.createElement('button');
          button.className = index === 0 ? 'hub-modal-btn hub-modal-confirm' : 'hub-modal-btn hub-modal-cancel';
          button.style.flex = '1';
          button.textContent = btn.text;
          button.onclick = () => {
            if (btn.action === 'url' && btn.value) {
              if (window.tabManager) window.tabManager.createTab(btn.value);
              modal.style.display = 'none';
            } else if (btn.action === 'exit') {
              window.require('electron').ipcRenderer.send('exit-app');
            } else if (btn.action === 'dismiss_24h') {
              if (isCritical) return;
              localStorage.setItem('leef_emergency_dismiss_until', Date.now() + 86400000);
              localStorage.setItem('leef_emergency_last_title', data.title || '');
              modal.style.display = 'none';
            } else if (btn.action === 'dismiss') {
              if (isCritical) return;
              modal.style.display = 'none';
            }
          };
          actionsEl.appendChild(button);
        });
      }

      modal.style.display = 'flex';

      // Critical Mode UI Lock
      if (isCritical) {
        window.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
          }
        }, { capture: true });

        window.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
        }, { capture: true });

        modal.onclick = (e) => {
          e.stopPropagation();
        };
      }
    }
  }
}

class AddressBarManager {
  constructor(bookmarksManager, inputEl) {
    this.bookmarksManager = bookmarksManager;
    this.input = inputEl;

    // Create a body-level suggestions container to completely bypass CSS clipping/stacking issues
    this.suggestionsEl = document.createElement('div');
    this.suggestionsEl.id = 'suggestions-' + (this.input.id || 'unknown');
    this.suggestionsEl.className = 'address-suggestions';
    this.suggestionsEl.style.display = 'none';
    this.suggestionsEl.style.position = 'absolute';
    this.suggestionsEl.style.zIndex = '999999';
    document.body.appendChild(this.suggestionsEl);

    // Prevent input blur when clicking anywhere inside the suggestions popup
    this.suggestionsEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
    });

    this.selectedIndex = -1;
    this.currentFetchId = 0; // Track requests to ignore stale results
    this.lastWebSuggestions = []; // Cache to prevent layout jumping/flashing
    this.bindEvents();

    // Re-position on resize
    window.addEventListener('resize', () => {
      if (this.suggestionsEl.style.display !== 'none') this.updatePosition();
    });
  }

  updatePosition() {
    if (!this.input) return;
    const rect = this.input.getBoundingClientRect();
    // Use the viewport coordinates to position the suggestions absolutely on the body
    this.suggestionsEl.style.top = (rect.bottom + window.scrollY + 5) + 'px';
    this.suggestionsEl.style.left = (rect.left + window.scrollX) + 'px';
    this.suggestionsEl.style.width = rect.width + 'px';
  }

  bindEvents() {
    if (!this.input) return;

    // Debounce input to limit suggestion updates and avoid flicker
    this.input.addEventListener('input', () => {
      if (this._suggestTimer) clearTimeout(this._suggestTimer);
      this._suggestTimer = setTimeout(() => this.showSuggestions(), 100);
    });
    this.input.addEventListener('keydown', (e) => this.handleKeydown(e), true);
    this.input.addEventListener('blur', () => {
      // Delay hide to allow click on a suggestion
      setTimeout(() => { this._hideSuggestions(true); }, 150);
    });
    this.input.addEventListener('focus', () => this.showSuggestions());
  }

  _hideSuggestions(immediate = false) {
    if (immediate) {
      this.suggestionsEl.classList.remove('visible');
      this.suggestionsEl.style.display = 'none';
      this.lastWebSuggestions = [];
      return;
    }
    this.suggestionsEl.classList.remove('visible');
    this.lastWebSuggestions = []; // Clear cached suggestions on hide
    setTimeout(() => {
      if (!this.suggestionsEl.classList.contains('visible')) {
        this.suggestionsEl.style.display = 'none';
      }
    }, 160);
  }

  async showSuggestions() {
    const val = this.input.value.trim();
    if (!val) {
      this._hideSuggestions();
      return;
    }

    // If not yet visible, position and show the dropdown
    if (!this.suggestionsEl.classList.contains('visible')) {
      this.updatePosition();
      this.suggestionsEl.style.display = 'block';
      requestAnimationFrame(() => this.suggestionsEl.classList.add('visible'));
    }

    // When already visible, we skip repositioning – the dropdown stays where it is

    // 1. Local Bookmarks (Fast)
    const lowerVal = val.toLowerCase();
    const bookmarkMatches = this.bookmarksManager.saved.filter(b =>
      b.title.toLowerCase().includes(lowerVal) || b.url.toLowerCase().includes(lowerVal)
    ).slice(0, 3);

    const settings = window.tabManager ? window.tabManager.settings : null;
    const isLiveEnabled = settings ? settings.currentSettings.liveAutocomplete : false;
    if (!isLiveEnabled) {
      this.lastWebSuggestions = [];
      this.renderSuggestions(val, bookmarkMatches, []);
      return;
    }

    // Keep the previous web suggestions temporarily to prevent layout jumping/flashing
    this.renderSuggestions(val, bookmarkMatches, this.lastWebSuggestions || []);

    // 2. Fetch Live Autocomplete from Main Process (Bypass CORS)
    const requestId = ++this.currentFetchId;
    try {
      const webSuggestions = await window.require('electron').ipcRenderer.invoke('fetch-autocomplete', val);
      if (this.currentFetchId === requestId && this.input.value.trim() === val) {
        const sliced = webSuggestions.slice(0, 6);
        this.lastWebSuggestions = sliced;
        this.renderSuggestions(val, bookmarkMatches, sliced);
      }
    } catch (e) { }
  }

  renderSuggestions(val, bookmarkMatches, webSuggestions) {
    this.selectedIndex = -1;

    const searchForText = window.t ? window.t('Search for "{query}"').replace('{query}', val) : 'Search for "' + val + '"';
    const searchIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:10px;opacity:0.6;flex-shrink:0"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';
    const calcIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:10px;opacity:0.6;flex-shrink:0"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect><line x1="8" y1="6" x2="16" y2="6"></line><line x1="16" y1="14" x2="16" y2="14.01"></line><line x1="12" y1="14" x2="12" y2="14.01"></line><line x1="8" y1="14" x2="8" y2="14.01"></line><line x1="16" y1="18" x2="16" y2="18.01"></line><line x1="12" y1="18" x2="12" y2="18.01"></line><line x1="8" y1="18" x2="8" y2="18.01"></line><line x1="16" y1="10" x2="16" y2="10.01"></line><line x1="12" y1="10" x2="12" y2="10.01"></line><line x1="8" y1="10" x2="8" y2="10.01"></line></svg>';
    const linkIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:10px;opacity:0.6;flex-shrink:0"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>';

    const itemData = [];

    // Safe Math Evaluator
    const evalMath = (str) => {
      let pos = -1, ch;
      const nextChar = () => { ch = (++pos < str.length) ? str.charAt(pos) : -1; };
      const eat = (c) => {
        while (ch === ' ') nextChar();
        if (ch === c) { nextChar(); return true; }
        return false;
      };
      const parse = () => { nextChar(); const x = parseExpression(); if (pos < str.length) throw new Error(); return x; };
      const parseExpression = () => {
        let x = parseTerm();
        for (; ;) { if (eat('+')) x += parseTerm(); else if (eat('-')) x -= parseTerm(); else return x; }
      };
      const parseTerm = () => {
        let x = parseFactor();
        for (; ;) { if (eat('*')) x *= parseTerm(); /* wait, should be parseFactor for left-assoc, but it's fine for simple math */ else if (eat('/')) x /= parseFactor(); else return x; }
      };
      // Fix associativity in parseTerm
      const parseTermCorrected = () => {
        let x = parseFactor();
        for (; ;) { if (eat('*')) x *= parseFactor(); else if (eat('/')) x /= parseFactor(); else return x; }
      };
      const parseFactor = () => {
        if (eat('+')) return parseFactor();
        if (eat('-')) return -parseFactor();
        let x, startPos = pos;
        if (eat('(')) { x = parseExpression(); eat(')'); }
        else if ((ch >= '0' && ch <= '9') || ch === '.') {
          while ((ch >= '0' && ch <= '9') || ch === '.') nextChar();
          x = parseFloat(str.substring(startPos, pos));
        } else { throw new Error(); }
        return x;
      };
      // Overwrite parseTerm to use the corrected one
      const parseTermActual = () => {
        let x = parseFactor();
        for (; ;) { if (eat('*')) x *= parseFactor(); else if (eat('/')) x /= parseFactor(); else return x; }
      };
      // Let's just cleanly define it
      return (function () {
        let pos = -1, ch;
        function nextChar() { ch = (++pos < str.length) ? str.charAt(pos) : -1; }
        function eat(c) { while (ch === ' ') nextChar(); if (ch === c) { nextChar(); return true; } return false; }
        function parseExpr() {
          let x = parseTerm();
          for (; ;) { if (eat('+')) x += parseTerm(); else if (eat('-')) x -= parseTerm(); else return x; }
        }
        function parseTerm() {
          let x = parseFactor();
          for (; ;) { if (eat('*')) x *= parseFactor(); else if (eat('/')) x /= parseFactor(); else return x; }
        }
        function parseFactor() {
          if (eat('+')) return parseFactor();
          if (eat('-')) return -parseFactor();
          let x, startPos = pos;
          if (eat('(')) { x = parseExpr(); eat(')'); }
          else if ((ch >= '0' && ch <= '9') || ch === '.') {
            while ((ch >= '0' && ch <= '9') || ch === '.') nextChar();
            x = parseFloat(str.substring(startPos, pos));
          } else { throw new Error(); }
          return x;
        }
        nextChar();
        let result = parseExpr();
        while (ch === ' ') nextChar();
        if (pos < str.length) throw new Error();
        return result;
      })();
    };

    let mathResult = null;
    if (/^[\d\+\-\*\/\(\)\.\s]+$/.test(val) && /[+\-*/]/.test(val)) {
      try {
        const res = evalMath(val);
        if (Number.isFinite(res) && res.toString() !== val.trim()) {
          mathResult = res.toString();
        }
      } catch (e) { }
    }

    // Quick Links
    const settingsObj = window.tabManager ? window.tabManager.settings : null;
    const qlStr = settingsObj ? (settingsObj.currentSettings.quickLinksStr || "") : "youtube.com\ngoogle.com\nwikipedia.org\ntwitter.com\nreddit.com\namazon.com\nnetflix.com\ndiscord.com\nfacebook.com\ntwitch.tv\ngithub.com";
    const quickLinks = qlStr.split('\n').map(l => l.trim().toLowerCase()).filter(l => l.length > 0);

    let quickLinkMatch = null;
    const lowerVal = val.trim().toLowerCase();

    // Find the first domain that starts with what the user typed
    for (const domain of quickLinks) {
      if (domain.startsWith(lowerVal)) {
        quickLinkMatch = domain;
        break;
      }
    }

    // PUSH IN CORRECT ORDER:
    if (mathResult !== null) {
      itemData.push({ title: '= ' + mathResult, url: mathResult, iconHtml: calcIcon, isWeb: true, queryVal: null });
    }

    if (quickLinkMatch) {
      itemData.push({ title: quickLinkMatch, url: 'https://' + quickLinkMatch, iconHtml: linkIcon, isWeb: false, queryVal: null });
    }

    itemData.push({ title: searchForText, url: val, iconHtml: searchIcon, isWeb: true, queryVal: val });

    bookmarkMatches.forEach(match => {
      let faviconUrl = '';
      try { faviconUrl = 'https://www.google.com/s2/favicons?domain=' + new URL(match.url).hostname + '&sz=32'; } catch (e) { }
      const icon = '<img class="suggestion-favicon" src="' + faviconUrl + '" onerror="this.style.display=\'none\'">';
      itemData.push({ title: match.title, url: match.url, iconHtml: icon, isWeb: false, queryVal: null });
    });

    webSuggestions.forEach(suggestion => {
      if (suggestion.toLowerCase() === val.toLowerCase()) return;
      // Filter out if it exactly matches the math result so we don't show duplicates
      if (mathResult !== null && suggestion === ('= ' + mathResult)) return;

      itemData.push({ title: suggestion, url: suggestion, iconHtml: searchIcon, isWeb: true, queryVal: null });
    });

    const existing = Array.from(this.suggestionsEl.querySelectorAll('.suggestion-item'));

    itemData.forEach((data, i) => {
      let item = existing[i];

      if (!item) {
        // Build item DOM structure once — never replace it later
        item = document.createElement('div');
        item.className = 'suggestion-item';
        const iconSlot = document.createElement('span');
        iconSlot.className = 'item-icon-slot';
        const info = document.createElement('div');
        info.className = 'suggestion-info';
        const titleEl = document.createElement('div');
        titleEl.className = 'suggestion-title';
        const urlEl = document.createElement('div');
        urlEl.className = 'suggestion-url';
        info.appendChild(titleEl);
        info.appendChild(urlEl);
        item.appendChild(iconSlot);
        item.appendChild(info);
        item.onclick = () => {
          if (window.tabManager) window.tabManager.navigateToUrl(item._navUrl);
          if (this.input.id === 'home-search') this.input.value = '';
          this._hideSuggestions();
        };
        this.suggestionsEl.appendChild(item);
      }

      // Update only what changed — no full innerHTML replacement
      const iconSlot = item.querySelector('.item-icon-slot');
      const titleEl = item.querySelector('.suggestion-title');
      const urlEl = item.querySelector('.suggestion-url');

      if (iconSlot && item._iconHtml !== data.iconHtml) {
        iconSlot.innerHTML = data.iconHtml;
        item._iconHtml = data.iconHtml;
      }
      if (titleEl && titleEl.textContent !== data.title) titleEl.textContent = data.title;
      if (urlEl) {
        if (urlEl.textContent !== data.url) urlEl.textContent = data.url;
        urlEl.style.display = data.isWeb ? 'none' : '';
      }

      item._navUrl = data.url || data.title;

      if (data.queryVal !== null && data.queryVal !== undefined) {
        item.setAttribute('data-query', data.queryVal);
      } else {
        item.removeAttribute('data-query');
      }
    });

    // Remove surplus nodes
    for (let i = itemData.length; i < existing.length; i++) {
      existing[i].remove();
    }

    // Keep selectedIndex at -1 by default so pressing Enter submits whatever the user actually typed in the input
    this.selectedIndex = -1;
    this.updateSelection(Array.from(this.suggestionsEl.querySelectorAll('.suggestion-item')), false);
  }

  handleKeydown(e) {
    const items = this.suggestionsEl.querySelectorAll('.suggestion-item');
    if (!this.suggestionsEl.classList.contains('visible') || items.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      this.selectedIndex = (this.selectedIndex + 1) % items.length;
      this.updateSelection(items, true);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      this.selectedIndex = (this.selectedIndex - 1 + items.length) % items.length;
      this.updateSelection(items, true);
    } else if (e.key === 'Enter' && this.selectedIndex !== -1) {
      e.preventDefault();
      e.stopPropagation();
      items[this.selectedIndex].click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this._hideSuggestions(true);
      this.input.blur();
    }
  }

  updateSelection(items, fromArrowKey = true) {
    items.forEach((item, i) => {
      item.classList.toggle('selected', i === this.selectedIndex);
    });
    if (this.selectedIndex !== -1 && fromArrowKey) {
      const urlEl = items[this.selectedIndex].querySelector('.suggestion-url');
      const titleEl = items[this.selectedIndex].querySelector('.suggestion-title');
      const queryVal = items[this.selectedIndex].getAttribute('data-query');
      if (queryVal !== null) {
        this.input.value = queryVal;
      } else {
        // If it's a web suggestion, fill input with the title (query). If bookmark, fill with URL.
        this.input.value = urlEl.style.display === 'none' ? titleEl.textContent : urlEl.textContent;
      }
    }
  }
}

class PermissionManager {
  constructor(settingsManager) {
    this.settingsManager = settingsManager;
    this.promptOverlay = document.getElementById('permission-prompt-overlay');
    this.modalTitle = document.getElementById('permission-prompt-title');
    this.modalMsg = document.getElementById('permission-prompt-msg');
    this.originEl = document.getElementById('permission-prompt-origin');
    this.typeEl = document.getElementById('permission-prompt-type');
    this.btnAllow = document.getElementById('permission-prompt-allow');
    this.btnDeny = document.getElementById('permission-prompt-deny');

    this.managerModal = document.getElementById('site-permissions-modal');
    this.managerList = document.getElementById('site-permissions-list');
    this.btnManagerClose = document.getElementById('site-permissions-close');
    this.btnAddSite = document.getElementById('btn-add-site-permission');

    this.currentReqId = null;
    this.currentOrigin = null;
    this.currentPermission = null;
    this.currentWebAuthnReq = null;
    this.currentWebAuthnTab = null;

    this.bindEvents();
  }

  bindEvents() {
    const ipc = window.require('electron').ipcRenderer;
    ipc.on('permission-request', (e, data) => {
      this.currentReqId = data.id;
      this.currentOrigin = data.origin;
      this.currentPermission = data.permission;

      this.originEl.textContent = data.origin;
      this.typeEl.textContent = window.t ? window.t(data.permission) : data.permission;
      this.promptOverlay.style.display = 'flex';
      document.body.classList.add('modal-open');

      // Hide dynamic address bar suggestions so they don't overlap the modal
      if (window.addressBarManager) {
        window.addressBarManager._hideSuggestions();
      }
    });

    if (this.btnAllow) this.btnAllow.addEventListener('click', () => this.handleResponse(true));
    if (this.btnDeny) this.btnDeny.addEventListener('click', () => this.handleResponse(false));

    // Manager bindings
    document.getElementById('enable-volume-boost')?.addEventListener('change', (e) => this.updateSetting('enableVolumeBoost', e.target.checked));
    document.getElementById('news-manual-refresh')?.addEventListener('change', (e) => this.updateSetting('newsManualRefresh', e.target.checked));
    document.getElementById('btn-camera-mic')?.addEventListener('click', () => this.openManager());
    document.getElementById('btn-location')?.addEventListener('click', () => this.openManager());
    document.getElementById('btn-allowed-sites')?.addEventListener('click', () => this.openManager());

    if (this.btnManagerClose) {
      this.btnManagerClose.addEventListener('click', () => {
        this.managerModal.style.display = 'none';
        document.body.classList.remove('modal-open');
      });
    }

    if (this.btnAddSite) {
      this.btnAddSite.addEventListener('click', () => {
        const promptText = window.t ? window.t("Enter the origin URL (e.g., https://discord.com):") : "Enter the origin URL (e.g., https://discord.com):";
        const url = prompt(promptText);
        if (url) {
          try {
            const origin = new URL(url).origin;
            this.updateSetting(origin, 'media', true);
            this.renderManagerList();
          } catch (e) {
            if (window.toastManager) window.toastManager.show('Error', 'Invalid URL format.', 3000);
          }
        }
      });
    }
  }

  handleResponse(granted) {
    this.promptOverlay.style.display = 'none';
    document.body.classList.remove('modal-open');

    if (this.currentWebAuthnReq !== null) {
      const tab = this.currentWebAuthnTab;
      const reqId = this.currentWebAuthnReq.id;
      if (tab && tab.webviewEl) {
        tab.webviewEl.executeJavaScript(`if (typeof window.__resolveLeefWebAuthn === 'function') window.__resolveLeefWebAuthn(${reqId}, ${granted});`).catch(() => { });
      }
      this.currentWebAuthnReq = null;
      this.currentWebAuthnTab = null;
      return;
    }

    if (this.currentReqId !== null) {
      window.require('electron').ipcRenderer.send('permission-response', {
        id: this.currentReqId,
        granted
      });
      this.updateSetting(this.currentOrigin, this.currentPermission, granted);
      this.currentReqId = null;
    }
  }

  requestWebAuthnConsent(tab, req) {
    if (window.addressBarManager) {
      window.addressBarManager._hideSuggestions();
    }

    this.currentWebAuthnReq = req;
    this.currentWebAuthnTab = tab;
    this.currentOrigin = req.origin;
    this.currentPermission = "Windows Hello / Security Key";

    this.originEl.textContent = req.host;
    this.typeEl.textContent = window.t ? window.t("Windows Hello / Security Key") : "Windows Hello / Security Key";
    this.promptOverlay.style.display = 'flex';
    document.body.classList.add('modal-open');
  }

  updateSetting(origin, permission, granted) {
    const s = this.settingsManager.currentSettings;
    if (!s.sitePermissions) s.sitePermissions = {};
    if (!s.sitePermissions[origin]) s.sitePermissions[origin] = {};
    s.sitePermissions[origin][permission] = granted;
    this.settingsManager.saveSettings();
  }

  openManager() {
    this.renderManagerList();
    this.managerModal.style.display = 'flex';
    document.body.classList.add('modal-open');
    if (window.addressBarManager) {
      window.addressBarManager._hideSuggestions();
    }
  }

  renderManagerList() {
    this.managerList.innerHTML = '';
    const perms = this.settingsManager.currentSettings.sitePermissions || {};
    const origins = Object.keys(perms);

    if (origins.length === 0) {
      this.managerList.innerHTML = '<p style="padding: 10px; opacity: 0.6; font-size: 0.85rem;">No site permissions saved.</p>';
      return;
    }

    origins.forEach(origin => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.alignItems = 'center';
      row.style.padding = '8px';
      row.style.borderBottom = '1px solid rgba(0,0,0,0.05)';

      let checks = [];
      const allowStr = window.t ? window.t('Allow') : 'Allow';
      const blockStr = window.t ? window.t('Block') : 'Block';
      if (perms[origin].media !== undefined) checks.push(`${window.t ? window.t('Media') : 'Media'}: ${perms[origin].media ? allowStr : blockStr}`);
      if (perms[origin].geolocation !== undefined) checks.push(`${window.t ? window.t('Location') : 'Location'}: ${perms[origin].geolocation ? allowStr : blockStr}`);
      if (perms[origin].notifications !== undefined) checks.push(`${window.t ? window.t('Notifications') : 'Notifs'}: ${perms[origin].notifications ? allowStr : blockStr}`);

      const removeTitle = window.t ? window.t('Remove') : 'Remove';
      row.innerHTML = `
        <div style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          <strong style="font-size: 0.9rem;">${origin}</strong>
          <div style="font-size: 0.75rem; color: #666;">${checks.join(', ')}</div>
        </div>
        <button class="bookmark-delete" style="opacity: 1; font-size: 1.2rem; cursor: pointer; border: none; background: transparent; padding: 5px;" title="${BrowserUtils.sanitize(removeTitle)}">×</button>
      `;

      row.querySelector('button').addEventListener('click', () => {
        delete perms[origin];
        this.settingsManager.saveSettings();
        this.renderManagerList();
      });

      this.managerList.appendChild(row);
    });
  }
}

class PrivacyManager {
  constructor(settingsManager) {
    this.settingsManager = settingsManager;
    this.totalBlocked = parseInt(localStorage.getItem('leef_privacy_total_blocked') || '0');
    this.totalRequests = parseInt(localStorage.getItem('leef_privacy_total_requests') || '0');
    this.secureRequests = parseInt(localStorage.getItem('leef_privacy_secure_requests') || '0');
    this.sessionBlocked = 0; // resets each browser open
    this.recentBlocks = []; // { domain: string, time: number }

    this.view = document.getElementById('privacy-view');
    this.disabledState = document.getElementById('privacy-disabled-state');
    this.enabledState = document.getElementById('privacy-enabled-state');

    this.elTotal = document.getElementById('stat-total-blocked');
    this.elSecure = document.getElementById('stat-secure-percent');
    this.elSession = document.getElementById('stat-session-blocked');
    this.elRecentList = document.getElementById('privacy-recent-list');
    this.elHttpsBar = document.getElementById('https-bar-fill');

    this.btnBack = document.getElementById('btn-privacy-back');
    this.btnEnableBlocker = document.getElementById('btn-privacy-enable-blocker');

    this.bindEvents();
    this.updateUI();
  }

  bindEvents() {
    if (this.btnBack) {
      this.btnBack.addEventListener('click', () => {
        if (window.tabManager) window.tabManager.createTab('flags');
      });
    }

    if (this.btnEnableBlocker) {
      this.btnEnableBlocker.addEventListener('click', () => {
        if (window.tabManager) {
          window.tabManager.createTab('settings');
          const item = document.querySelector('.settings-nav li[data-section="sec-privacy"]');
          if (item) item.click();
        }
      });
    }
  }

  recordBlock(domain) {
    this.totalBlocked++;
    this.sessionBlocked++;
    this.recentBlocks.unshift({ domain, time: Date.now() });
    if (this.recentBlocks.length > 30) this.recentBlocks.pop();

    // Perf fix: Only flush to localStorage every 10 blocks instead of every block.
    // On pages with 50+ blocked requests this prevents 50 synchronous disk writes.
    if (this.totalBlocked % 10 === 0) {
      localStorage.setItem('leef_privacy_total_blocked', this.totalBlocked);
    }

    // Debounce the UI re-render so rapid-fire blocks don't thrash the DOM
    clearTimeout(this._blockUITimer);
    this._blockUITimer = setTimeout(() => this.updateUI(), 150);
  }

  recordRequest(isSecure) {
    this.totalRequests++;
    if (isSecure) this.secureRequests++;

    // Perf fix: Write every 50 requests instead of every 5 — cuts localStorage calls by 90%
    if (this.totalRequests % 50 === 0) {
      localStorage.setItem('leef_privacy_total_requests', this.totalRequests);
      localStorage.setItem('leef_privacy_secure_requests', this.secureRequests);
      this.updateUI();
    }
  }

  updateUI() {
    const isBlockerEnabled = this.settingsManager.currentSettings.adBlockerMode !== 'none';

    if (this.disabledState && this.enabledState) {
      this.disabledState.style.display = isBlockerEnabled ? 'none' : 'block';
      this.enabledState.style.display = isBlockerEnabled ? 'block' : 'none';
    }

    if (this.elTotal) this.elTotal.textContent = this.totalBlocked.toLocaleString();
    if (this.elSession) this.elSession.textContent = this.sessionBlocked.toLocaleString();

    if (this.elSecure) {
      const pct = this.totalRequests > 0 ? Math.round((this.secureRequests / this.totalRequests) * 100) : 100;
      this.elSecure.textContent = pct + '%';
      if (this.elHttpsBar) this.elHttpsBar.style.width = pct + '%';
    }

    if (this.elRecentList && isBlockerEnabled) {
      if (this.recentBlocks.length === 0) {
        this.elRecentList.innerHTML = `<div class="privacy-empty-state">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          <p>Start browsing to see protection in action.</p>
        </div>`;
      } else {
        this.elRecentList.innerHTML = this.recentBlocks.slice(0, 15).map(b => `
          <div class="privacy-recent-item">
            <span class="privacy-recent-domain">${BrowserUtils.sanitize(b.domain)}</span>
            <span class="privacy-recent-badge">🚫 Blocked</span>
            <span class="privacy-recent-time">${new Date(b.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
          </div>
        `).join('');
      }
    }
  }
}

class FindManager {
  constructor() {
    this.el = document.getElementById('find-bar');
    this.input = document.getElementById('find-input');
    this.resultsEl = document.getElementById('find-results');
    this.btnPrev = document.getElementById('btn-find-prev');
    this.btnNext = document.getElementById('btn-find-next');
    this.btnClose = document.getElementById('btn-find-close');

    this.activeRequestId = null;
    this.bindEvents();
  }

  bindEvents() {
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey && e.key.toLowerCase() === 'f') || e.key.toLowerCase() === 'f3') {
        e.preventDefault();
        this.show();
      }
      if (e.key === 'Escape' && this.el.style.display !== 'none') {
        this.hide();
      }
    });

    this.input.addEventListener('input', () => {
      this.startFind(this.input.value, true, false); // New search session
    });

    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (e.shiftKey) this.findPrev();
        else this.findNext();
      }
    });

    this.btnPrev.addEventListener('click', () => this.findPrev());
    this.btnNext.addEventListener('click', () => this.findNext());
    this.btnClose.addEventListener('click', () => this.hide());

    window.require('electron').ipcRenderer.on('trigger-find-in-page', () => {
      this.show();
    });

    const btnFindPage = document.getElementById('btn-find-page');
    if (btnFindPage) {
      btnFindPage.addEventListener('click', () => {
        if (this.el.style.display === 'none' || !this.el.style.display) {
          this.show();
        } else {
          this.hide();
        }
      });
    }

    // found-in-page event is fired on the webview itself.
    // We need to listen to all webviews or the active one.
  }

  // This will be called by TabManager when a webview is mounted
  attachToWebview(webview) {
    webview.addEventListener('found-in-page', (e) => {
      const result = e.result;
      this.resultsEl.textContent = `${result.activeMatchOrdinal}/${result.matches}`;
      if (result.matches === 0) this.resultsEl.style.color = '#f44336';
      else this.resultsEl.style.color = 'var(--primary-color)';
    });
  }

  show() {
    this.el.style.display = 'block';
    this.input.focus();
    this.input.select();
    if (this.input.value) this.startFind(this.input.value, true);
  }

  hide() {
    this.el.style.display = 'none';
    const tab = window.tabManager.getActiveTab();
    if (tab && tab.webviewEl) {
      tab.webviewEl.stopFindInPage('clearSelection');
    }
    this.resultsEl.textContent = '0/0';
  }

  startFind(text, forward, findNext = false) {
    if (!text) {
      const tab = window.tabManager?.getActiveTab();
      if (tab && tab.webviewEl) tab.webviewEl.stopFindInPage('clearSelection');
      this.resultsEl.textContent = '0/0';
      return;
    }
    const tab = window.tabManager.getActiveTab();
    if (tab && tab.webviewEl) {
      this.activeRequestId = tab.webviewEl.findInPage(text, { forward, findNext });
    } else {
      // Internal page fallback
      const found = window.find(text, false, !forward, true);
      this.resultsEl.textContent = found ? 'Found' : '0/0';
      this.resultsEl.style.color = found ? 'var(--primary-color)' : '#f44336';
    }
  }

  findNext() {
    if (this.input.value) this.startFind(this.input.value, true, true);
  }

  findPrev() {
    if (this.input.value) this.startFind(this.input.value, false, true);
  }
}

// --- BOOTSTRAP ---
window.onload = async () => {
  // Load translations first so SettingsManager has access to them
  await loadTranslations();

  // ToastManager must be first so all other managers can use it
  window.toastManager = new ToastManager();

  const settingsMgr = new SettingsManager();
  window.settingsManager = settingsMgr;

  // First-Time Startup Onboarding
  if (!localStorage.getItem('leef_onboarding_done')) {
    // FACTORY RESET: Ensure settings are defaults for new users
    localStorage.removeItem('leef_settings');
    localStorage.removeItem('leef_labs_flags');

    const overlay = document.getElementById('onboarding-overlay');
    const bg = document.getElementById('onboarding-bg');
    if (overlay) {
      overlay.style.display = 'flex';
      if (bg) bg.style.display = 'block';

      const steps = document.querySelectorAll('.onboarding-step');
      const dots = document.querySelectorAll('.onboarding-dot');
      const nextBtn = document.getElementById('btn-onboarding-next');
      const backBtn = document.getElementById('btn-onboarding-back');
      const finishBtn = document.getElementById('btn-onboarding-finish');
      let currentStep = 0;

      function showStep(index, direction = 'forward') {
        steps.forEach((step, i) => {
          step.classList.remove('active', 'slide-forward', 'slide-backward');
          if (i === index) {
            step.classList.add('active');
            if (direction === 'forward') {
              step.classList.add('slide-forward');
            } else {
              step.classList.add('slide-backward');
            }
          }
        });

        dots.forEach((dot, i) => {
          dot.classList.toggle('active', i === index);
        });

        if (backBtn) {
          backBtn.style.visibility = (index === 0) ? 'hidden' : 'visible';
        }

        if (nextBtn && finishBtn) {
          if (index === steps.length - 1) {
            nextBtn.style.display = 'none';
            finishBtn.style.display = 'flex';
          } else {
            nextBtn.style.display = 'flex';
            finishBtn.style.display = 'none';
          }
        }
      }

      showStep(0);

      if (nextBtn) {
        nextBtn.addEventListener('click', () => {
          if (currentStep < steps.length - 1) {
            currentStep++;
            showStep(currentStep, 'forward');
          }
        });
      }

      if (backBtn) {
        backBtn.addEventListener('click', () => {
          if (currentStep > 0) {
            currentStep--;
            showStep(currentStep, 'backward');
          }
        });
      }

      dots.forEach((dot, idx) => {
        dot.addEventListener('click', () => {
          const direction = idx > currentStep ? 'forward' : 'backward';
          currentStep = idx;
          showStep(currentStep, direction);
        });
      });

      const onboardLangSelect = document.getElementById('onboard-language');
      if (onboardLangSelect) {
        onboardLangSelect.addEventListener('change', () => {
          settingsMgr.currentSettings.language = onboardLangSelect.value;
          settingsMgr.applyLocalization();
        });
      }

      const onboardNewsCheckbox = document.getElementById('onboard-news');
      const onboardNewsRow = document.getElementById('onboard-news-provider-row');
      if (onboardNewsCheckbox && onboardNewsRow) {
        onboardNewsCheckbox.addEventListener('change', () => {
          onboardNewsRow.style.opacity = onboardNewsCheckbox.checked ? '1' : '0.4';
          onboardNewsRow.style.pointerEvents = onboardNewsCheckbox.checked ? 'auto' : 'none';
        });
      }

      document.getElementById('btn-onboarding-finish').addEventListener('click', () => {
        const aiVal = document.querySelector('input[name="onboard-ai-tier"]:checked')?.value
          || (document.getElementById('onboard-ai')?.checked ? 'deep' : 'off')
          || 'deep';
        const autoChecked = document.getElementById('onboard-autocomplete').checked;
        const dictChecked = document.getElementById('onboard-dictionary').checked;
        const adblockVal = document.querySelector('input[name="onboard-adblock-tier"]:checked')?.value || 'none';
        const langVal = document.getElementById('onboard-language').value;
        const volumeChecked = document.getElementById('onboard-volumeboost').checked;
        const updatesChecked = document.getElementById('onboard-updates').checked;

        // Sync to actual settings DOM
        document.querySelectorAll('input[name="block-ai-tier"]').forEach(r => { r.checked = r.value === aiVal; });
        document.querySelectorAll('input[name="block-ai-tier-browsing"]').forEach(r => { r.checked = r.value === aiVal; });

        const autoEl = document.getElementById('live-autocomplete');
        if (autoEl) autoEl.checked = autoChecked;

        const dictEl = document.getElementById('native-dictionary');
        if (dictEl) dictEl.checked = dictChecked;

        const langEl = document.getElementById('language-select');
        if (langEl) langEl.value = langVal;

        const newsChecked = document.getElementById('onboard-news').checked;
        const newsEl = document.getElementById('news-manual-refresh');
        if (newsEl) newsEl.checked = !newsChecked;

        const volumeEl = document.getElementById('enable-volume-boost');
        if (volumeEl) volumeEl.checked = volumeChecked;

        const updatesEl = document.getElementById('auto-check-updates');
        if (updatesEl) updatesEl.checked = updatesChecked;

        // Adblock is radio buttons ('none', 'basic', 'comprehensive')
        document.querySelectorAll('input[name="adblock-tier"]').forEach(r => {
          r.checked = r.value === adblockVal;
        });

        settingsMgr.saveSettings();

        localStorage.setItem('leef_onboarding_done', 'true');
        overlay.style.display = 'none';
        if (bg) bg.style.display = 'none';

        // Start loading news now that we have consent/settings
        if (window.newsSvc) window.newsSvc.refresh();
      });
    }
  }

  window.permissionManager = new PermissionManager(settingsMgr);
  window.tabManager = new TabManager(settingsMgr);
  const bookmarksMgr = new BookmarksManager();
  const hubMgr = new HubManager();
  window.newsSvc = new NewsService();
  window.sportsSvc = new SportsService();
  window.sportsSvc.start();
  window.sportsTeamPicker = new SportsTeamPicker(settingsMgr);
  window.newsWordFilterUI = new NewsWordFilterUI(settingsMgr);
  window.smartNewsUI = new SmartNewsUI(settingsMgr);
  window.quickLinksUI = new QuickLinksUI(settingsMgr);

  // Push loaded settings to main process immediately so rules are active on startup
  settingsMgr.sendSettingsToMain();

  // Wire home page search bar
  const homeSearch = document.getElementById('home-search');
  if (homeSearch) {
    homeSearch.addEventListener('keydown', e => {
      if (e.key === 'Enter' && homeSearch.value.trim()) {
        window.tabManager.navigateToUrl(homeSearch.value.trim());
        homeSearch.value = '';
      }
    });
  }

  // Wire news refresh button
  const btnRefreshNews = document.getElementById('btn-refresh-news');
  if (btnRefreshNews) {
    btnRefreshNews.addEventListener('click', () => {
      window.newsSvc.refresh();
      if (window.toastManager) window.toastManager.show('🔄 Refreshing News', 'Fetching the latest headlines...', 2500);
    });
  }

  // Wire news settings button
  const btnNewsSettings = document.getElementById('btn-news-settings');
  if (btnNewsSettings) {
    btnNewsSettings.addEventListener('click', () => {
      window.tabManager.createTab('settings');
      // Switch to Hub tab
      const hubTab = document.querySelector('[data-section="sec-hub"]');
      if (hubTab) hubTab.click();
      // Scroll to news word filter input
      setTimeout(() => {
        const filterInput = document.getElementById('news-word-filter-input');
        if (filterInput) {
          filterInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
          filterInput.focus();
        }
      }, 100);
    });
  }

  // Labs/Experimental
  window.labsManager = new LabsManager();

  // Emergency Announcements
  window.emergencyAnnouncer = new EmergencyAnnouncer();

  // Downloads
  window.downloadManager = new DownloadManager();

  // Address Bar & Home Search Suggestions
  const addressInput = document.getElementById('address-input');
  if (addressInput) window.addressBarManager = new AddressBarManager(bookmarksMgr, addressInput);
  if (homeSearch) window.homeSearchManager = new AddressBarManager(bookmarksMgr, homeSearch);

  // Hero Section (Clock/Greeting)
  window.heroManager = new HeroManager();

  // Find in Page
  window.findManager = new FindManager();

  // Privacy Manager
  window.privacyManager = new PrivacyManager(settingsMgr);

  // Quick Settings Menu
  window.quickSettingsManager = new QuickSettingsManager();

  // Site Identity Menu
  window.siteIdentityManager = new SiteIdentityManager();

  // Startup behavior
  const startup = settingsMgr.currentSettings.startup || 'newtab';

  if (startup === 'homepage') {
    const homepage = settingsMgr.currentSettings.customNewTab || 'home';
    window.tabManager.createTab(homepage);
  } else {
    window.tabManager.createTab('home');
  }

  // Window controls and fullscreen state management across all platforms
  try {
    const ipc = window.require('electron').ipcRenderer;

    if (process.platform === 'linux') {
      const btnMin = document.getElementById('btn-linux-minimize');
      const btnMax = document.getElementById('btn-linux-maximize');
      const btnClose = document.getElementById('btn-linux-close');

      if (btnMin) btnMin.addEventListener('click', () => ipc.send('window-minimize'));
      if (btnMax) btnMax.addEventListener('click', () => ipc.send('window-maximize'));
      if (btnClose) btnClose.addEventListener('click', () => ipc.send('window-close'));
    }

    const cleanupFullscreen = () => {
      document.body.classList.remove('fullscreen');
      document.body.classList.remove('video-fullscreen');

      // Force any webviews currently holding HTML fullscreen to exit cleanly
      if (window.tabManager && Array.isArray(window.tabManager.tabs)) {
        window.tabManager.tabs.forEach(tab => {
          if (tab.webviewEl) {
            tab.webviewEl.executeJavaScript('if (document.fullscreenElement) document.exitFullscreen();').catch(() => {});
          }
        });
      }
    };

    ipc.on('window-state-changed', (e, state) => {
      if (state === 'maximized') {
        document.body.classList.add('maximized');
        document.body.classList.remove('fullscreen');
        document.body.classList.remove('video-fullscreen');
      } else if (state === 'fullscreen') {
        document.body.classList.add('fullscreen');
        document.body.classList.remove('maximized');
      } else {
        document.body.classList.remove('maximized');
        cleanupFullscreen();
      }
    });

    ipc.on('leave-fullscreen-force', () => {
      cleanupFullscreen();
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.body.classList.contains('video-fullscreen')) {
        cleanupFullscreen();
        try {
          ipc.send('exit-html-fullscreen');
        } catch (err) {}
      }
    });
  } catch (e) {
    console.warn('IPC / Electron not available for window controls', e);
  }

  // Set up MutationObserver to shift webviews down when dropdown menus are open (Linux only)
  if (process.platform === 'linux') {
    try {
      const observer = new MutationObserver(() => {
        const qs = document.getElementById('quick-settings-dropdown');
        const bm = document.getElementById('bookmarks-dropdown');
        const dl = document.getElementById('downloads-dropdown');
        const si = document.getElementById('site-identity-dropdown');
        const webviewsContainer = document.getElementById('webviews-container');

        let activeDropdown = null;
        if (qs && qs.style.display !== 'none') activeDropdown = qs;
        else if (bm && bm.style.display !== 'none') activeDropdown = bm;
        else if (dl && dl.style.display !== 'none') activeDropdown = dl;
        else if (si && si.style.display !== 'none') activeDropdown = si;

        if (webviewsContainer) {
          if (activeDropdown) {
            const rect = activeDropdown.getBoundingClientRect();
            const mainContent = document.querySelector('.main-content');
            if (mainContent) {
              const mainRect = mainContent.getBoundingClientRect();
              const L = Math.max(0, rect.left - mainRect.left + 2); // overlap under dropdown border
              const R = Math.min(mainRect.width, rect.right - mainRect.left - 2); // overlap under dropdown border
              const H = Math.max(0, rect.bottom - mainRect.top - 2); // overlap under dropdown border
              webviewsContainer.style.clipPath = `polygon(0 0, ${L}px 0, ${L}px ${H}px, ${R}px ${H}px, ${R}px 0, 100% 0, 100% 100%, 0 100%)`;
            }
            webviewsContainer.style.marginTop = '0px';
          } else {
            webviewsContainer.style.clipPath = 'none';
            webviewsContainer.style.marginTop = '0px';
          }
        }
      });
      const config = { attributes: true, attributeFilter: ['style'] };
      const qsEl = document.getElementById('quick-settings-dropdown');
      const bmEl = document.getElementById('bookmarks-dropdown');
      const dlEl = document.getElementById('downloads-dropdown');
      const siEl = document.getElementById('site-identity-dropdown');
      if (qsEl) observer.observe(qsEl, config);
      if (bmEl) observer.observe(bmEl, config);
      if (dlEl) observer.observe(dlEl, config);
      if (siEl) observer.observe(siEl, config);
    } catch (e) {
      console.error('Failed to initialize dropdown mutation observer:', e);
    }
  }

  // Plugin Store Placeholder
  const btnPlugins = document.getElementById('btn-plugin-store');
  if (btnPlugins) {
    btnPlugins.addEventListener('click', () => {
      if (window.tabManager) window.tabManager.createTab('plugins');
    });
  }

  // Popup Blocker Manager
  function syncPopupRules() {
    try {
      const allowed = JSON.parse(localStorage.getItem('leef_allowed_popups') || '[]');
      const blocked = JSON.parse(localStorage.getItem('leef_blocked_popups') || '[]');
      window.leefAPI.ipc.send('update-popup-rules', { allowed, blocked });
    } catch (e) {
      console.error('Failed to sync popup rules:', e);
    }
  }

  // Sync rules on boot
  syncPopupRules();

  // Listen to blocked popup attempts
  window.leefAPI.ipc.on('popup-blocked', (event, { url, requester }) => {
    const toast = document.getElementById('popup-blocker-toast');
    const domainSpan = document.getElementById('popup-requester-domain');
    const mainContent = document.getElementById('popup-blocker-main-content');
    const confirmContent = document.getElementById('popup-blocker-confirm-content');

    if (!toast || !domainSpan || !mainContent || !confirmContent) return;

    domainSpan.textContent = requester || 'Unknown Site';
    mainContent.style.display = 'flex';
    confirmContent.style.display = 'none';
    toast.style.display = 'block';

    // Clear and clone buttons to avoid multiple event listeners accumulating
    const clearListeners = (id) => {
      const el = document.getElementById(id);
      if (el) {
        const clone = el.cloneNode(true);
        el.parentNode.replaceChild(clone, el);
        return clone;
      }
      return null;
    };

    const btnClose = clearListeners('btn-popup-close');
    const btnAllowOnce = clearListeners('btn-popup-allow-once');
    const btnAlwaysAllow = clearListeners('btn-popup-always-allow');
    const btnNeverAllow = clearListeners('btn-popup-never-allow');
    const btnConfirmYes = clearListeners('btn-popup-confirm-yes');
    const btnConfirmNo = clearListeners('btn-popup-confirm-no');

    btnClose?.addEventListener('click', () => {
      toast.style.display = 'none';
    });

    btnAllowOnce?.addEventListener('click', () => {
      window.leefAPI.ipc.send('open-popup-window', url);
      toast.style.display = 'none';
    });

    btnAlwaysAllow?.addEventListener('click', () => {
      try {
        const allowed = JSON.parse(localStorage.getItem('leef_allowed_popups') || '[]');
        if (!allowed.includes(requester)) {
          allowed.push(requester);
          localStorage.setItem('leef_allowed_popups', JSON.stringify(allowed));
        }
      } catch (e) { }
      syncPopupRules();
      window.leefAPI.ipc.send('open-popup-window', url);
      toast.style.display = 'none';
    });

    btnNeverAllow?.addEventListener('click', () => {
      mainContent.style.display = 'none';
      confirmContent.style.display = 'flex';
    });

    btnConfirmYes?.addEventListener('click', () => {
      try {
        const blocked = JSON.parse(localStorage.getItem('leef_blocked_popups') || '[]');
        if (!blocked.includes(requester)) {
          blocked.push(requester);
          localStorage.setItem('leef_blocked_popups', JSON.stringify(blocked));
        }
      } catch (e) { }
      syncPopupRules();
      toast.style.display = 'none';
    });

    btnConfirmNo?.addEventListener('click', () => {
      confirmContent.style.display = 'none';
      mainContent.style.display = 'flex';
    });
  });
};

class PluginManager {
  constructor() {
    this.plugins = JSON.parse(localStorage.getItem('leef_plugins') || '[]');
    this.containerInstalled = document.getElementById('installed-plugins-list');
    this.containerDiscover = document.getElementById('discover-plugins-grid');
    this.inputUrl = document.getElementById('plugin-install-url');
    this.btnInstall = document.getElementById('btn-install-plugin');
    this.btnTopBar = document.getElementById('btn-plugin-store-top');
    this.dropdown = document.getElementById('plugins-dropdown');
    this.dropdownList = document.getElementById('plugins-dropdown-list');
    this.btnManage = document.getElementById('btn-manage-plugins');
    this.loadedPlugins = {};
    
    // Central Repository URL (Uses GitHub API to dynamically scan the plugins folder)
    this.repositoryUrl = 'https://api.github.com/repos/git-QTech/leef-plugins/contents/plugins';
    
    if (this.btnInstall) {
      this.btnInstall.addEventListener('click', () => this.installPlugin(this.inputUrl.value));
    }
    
    if (this.btnTopBar && this.dropdown) {
      this.btnTopBar.addEventListener('click', (e) => {
        e.stopPropagation();
        const isVisible = this.dropdown.classList.contains('visible');
        if (!isVisible) {
          this.renderDropdown();
          DropdownUtils.show(this.dropdown, 'flex');
          // Close others
          const others = ['bookmarks-dropdown', 'downloads-dropdown', 'quick-settings-dropdown', 'site-identity-dropdown'];
          others.forEach(id => {
            const el = document.getElementById(id);
            if (el) DropdownUtils.hide(el);
          });
        } else {
          DropdownUtils.hide(this.dropdown);
        }
      });

      // Global close when clicking outside
      document.addEventListener('click', (e) => {
        if (this.dropdown.classList.contains('visible') && !this.dropdown.contains(e.target) && e.target !== this.btnTopBar && !this.btnTopBar.contains(e.target)) {
          DropdownUtils.hide(this.dropdown);
        }
      });
    }

    if (this.btnManage) {
      this.btnManage.addEventListener('click', () => {
        if (this.dropdown) DropdownUtils.hide(this.dropdown);
        if (window.tabManager) window.tabManager.createTab('plugins');
      });
    }
    
    this.setupTabs();
    this.renderInstalledPlugins();
    this.loadAllPlugins();
    this.checkForUpdates();
    this.loadDiscoverPlugins(true);
    this.updateTopBarVisibility();
    
    const sortSelect = document.getElementById('plugin-sort-select');
    if (sortSelect) {
      sortSelect.addEventListener('change', () => {
         this.loadDiscoverPlugins(false);
      });
    }
  }

  updateTopBarVisibility() {
    if (this.btnTopBar) {
      this.btnTopBar.style.display = this.plugins.length > 0 ? '' : 'none';
      if (this.plugins.length === 0 && this.dropdown) {
        DropdownUtils.hide(this.dropdown);
      }
    }
  }

  setupTabs() {
    const tabDiscover = document.getElementById('tab-plugins-discover');
    const tabInstalled = document.getElementById('tab-plugins-installed');
    const viewDiscover = document.getElementById('plugin-view-discover');
    const viewInstalled = document.getElementById('plugin-view-installed');

    if (!tabDiscover || !tabInstalled) return;

    tabDiscover.addEventListener('click', () => {
      tabDiscover.style.borderBottom = '2px solid var(--primary-color)';
      tabDiscover.style.color = 'var(--text-color)';
      tabInstalled.style.borderBottom = 'none';
      tabInstalled.style.color = '#888';
      viewDiscover.style.display = 'block';
      viewInstalled.style.display = 'none';
    });

    tabInstalled.addEventListener('click', () => {
      tabInstalled.style.borderBottom = '2px solid var(--primary-color)';
      tabInstalled.style.color = 'var(--text-color)';
      tabDiscover.style.borderBottom = 'none';
      tabDiscover.style.color = '#888';
      viewInstalled.style.display = 'block';
      viewDiscover.style.display = 'none';
    });
  }

  isVersionMatch(minVersion, currentVersion) {
    if (!minVersion) return true;
    const cleanCurrent = (currentVersion || '0.0.0').replace(/[^0-9.]/g, '').split('.');
    const cleanMin = minVersion.replace(/[^0-9.]/g, '').split('.');
    for (let i = 0; i < 3; i++) {
      const cur = parseInt(cleanCurrent[i] || 0);
      const min = parseInt(cleanMin[i] || 0);
      if (cur > min) return true;
      if (cur < min) return false;
    }
    return true;
  }
  
  async fetchGitHubFile(url) {
    try {
      if (url.includes('raw.githubusercontent.com') || url.includes('github.com')) {
        let rawPath = url;
        if (url.includes('raw.githubusercontent.com/')) {
          rawPath = url.split('raw.githubusercontent.com/')[1];
        } else if (url.includes('github.com/')) {
          rawPath = url.split('github.com/')[1];
        }
        const parts = rawPath.split('/');
        if (parts.length >= 3) {
          const owner = parts[0];
          const repo = parts[1];
          const isBlobOrTree = parts[2] === 'tree' || parts[2] === 'blob';
          const branch = isBlobOrTree ? parts[3] : parts[2];
          const pathIndex = isBlobOrTree ? 4 : 3;
          const filePath = parts.slice(pathIndex).join('/');
          
          if (filePath) {
            const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}&t=${Date.now()}`;
            const res = await fetch(apiUrl, {
              headers: { 'Accept': 'application/vnd.github.v3+json' },
              cache: 'no-cache'
            });
            if (res.ok) {
              const data = await res.json();
              if (data.content) {
                const decoded = decodeURIComponent(escape(atob(data.content.replace(/\s/g, ''))));
                return decoded;
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn('GitHub API fetch failed, falling back to raw HTTP:', e);
    }
    const fetchUrl = `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;
    const res = await fetch(fetchUrl, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  }

  async loadDiscoverPlugins(forceFetch = true) {
    if (!this.containerDiscover) return;
    
    if (forceFetch || !this.discoverManifests) {
      this.containerDiscover.innerHTML = `<div style="padding: 20px; color: #888; grid-column: 1 / -1;">Loading plugins from repository...</div>`;
      try {
        const repoUrl = `${this.repositoryUrl}?t=${Date.now()}`;
        const res = await fetch(repoUrl, { cache: 'no-cache' });
        if (!res.ok) {
          this.containerDiscover.innerHTML = `<div style="padding: 20px; color: #888; grid-column: 1 / -1;">
            No plugins found yet. Just add folders to your <code>plugins</code> directory!
          </div>`;
          return;
        }
        
        const repoContents = await res.json();
        const repoPlugins = repoContents
          .filter(item => item.type === 'dir')
          .map(item => ({
            manifestUrl: `https://raw.githubusercontent.com/git-QTech/leef-plugins/main/plugins/${item.name}/manifest.json`
          }));
          
        this.discoverManifests = [];
        for (const item of repoPlugins) {
          try {
            const manifestText = await this.fetchGitHubFile(item.manifestUrl);
            const manifest = JSON.parse(manifestText);
            manifest.manifestUrl = item.manifestUrl;
            this.discoverManifests.push(manifest);
          } catch (e) {
            console.warn('Failed to load plugin manifest from repository:', e);
          }
        }
      } catch (e) {
        this.containerDiscover.innerHTML = `<div style="padding: 20px; color: #888; grid-column: 1 / -1;">
          Could not connect to the plugin repository.
        </div>`;
        return;
      }
    }
    
    const sortSelect = document.getElementById('plugin-sort-select');
    if (sortSelect && this.discoverManifests) {
      const sortValue = sortSelect.value;
      if (sortValue === 'newest') {
        this.discoverManifests.sort((a, b) => (b.created_at || '1970').localeCompare(a.created_at || '1970'));
      } else if (sortValue === 'updated') {
        this.discoverManifests.sort((a, b) => (b.updated_at || '1970').localeCompare(a.updated_at || '1970'));
      } else if (sortValue === 'alphabetical') {
        this.discoverManifests.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      }
    }

    this.containerDiscover.innerHTML = '';
    
    for (const manifest of (this.discoverManifests || [])) {
      const isInstalled = this.plugins.some(p => p.id === manifest.id);
      const isCompatible = !manifest.min_leef_version || this.isVersionMatch(manifest.min_leef_version, window.APP_VERSION);
      
      const card = document.createElement('div');
      card.className = 'flag-card';
      card.style.display = 'flex';
      card.style.flexDirection = 'column';
      card.style.alignItems = 'flex-start';
      card.style.justifyContent = 'space-between';
      card.style.padding = '15px';
      card.style.gap = '15px';
      
      let actionButton = '';
      if (isInstalled) {
        actionButton = `<button class="settings-btn" disabled style="background: #555; width: 100%;">Installed</button>`;
      } else if (!isCompatible) {
        actionButton = `<button class="settings-btn" disabled style="background: #aa3333; width: 100%;">Requires Update</button>`;
      } else {
        actionButton = `<button class="settings-btn btn-discover-install" data-url="${manifest.manifestUrl}" style="background: var(--primary-color); color: white; width: 100%;">Install</button>`;
      }
      
      card.innerHTML = `
        <div style="width: 100%;">
          <h3 style="margin: 0 0 5px 0;">${manifest.name} <span class="beta-tag" style="background:#555;">v${manifest.version}</span></h3>
          <p style="font-size: 0.8rem; color: #888; margin: 0 0 10px 0;">By ${manifest.author}</p>
          <p style="margin: 0; font-size: 0.9rem;">${manifest.description}</p>
        </div>
        ${actionButton}
      `;
      
      if (!isInstalled && isCompatible) {
        const btnInstall = card.querySelector('.btn-discover-install');
        btnInstall.addEventListener('click', async () => {
          btnInstall.textContent = 'Installing...';
          btnInstall.disabled = true;
          await this.installPlugin(btnInstall.dataset.url);
          btnInstall.textContent = 'Installed';
          btnInstall.style.background = '#555';
        });
      }
      
      this.containerDiscover.appendChild(card);
    }
    
    if (this.containerDiscover.children.length === 0) {
      this.containerDiscover.innerHTML = `<div style="padding: 20px; color: #888; grid-column: 1 / -1;">No plugins available.</div>`;
    }
  }

  async installPlugin(url) {
    if (!url) return;
    try {
      let manifestUrl = url;
      if (url.includes('github.com')) {
        const parts = url.split('github.com/')[1].split('/');
        if (parts.length >= 2) {
          manifestUrl = `https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/main/manifest.json`;
        }
      }
      
      const manifestText = await this.fetchGitHubFile(manifestUrl);
      const manifest = JSON.parse(manifestText);
      
      if (manifest.min_leef_version && !this.isVersionMatch(manifest.min_leef_version, window.APP_VERSION)) {
        throw new Error(`${manifest.name} requires a newer version of Leef Browser (>= ${manifest.min_leef_version}).`);
      }
      
      const basePath = manifestUrl.replace('/manifest.json', '');
      const pluginJS = `${basePath}/${manifest.main || 'plugin.js'}`;
      
      const jsCode = await this.fetchGitHubFile(pluginJS);
      
      const existingPlugin = this.plugins.find(p => p.id === manifest.id);
      const settings = existingPlugin ? existingPlugin.settings : (manifest.config ? manifest.config.reduce((acc, curr) => ({ ...acc, [curr.id]: curr.default }), {}) : {});

      const plugin = {
        id: manifest.id,
        name: manifest.name,
        description: manifest.description,
        version: manifest.version,
        author: manifest.author,
        url: url,
        jsUrl: pluginJS,
        jsCode: jsCode,
        configSchema: manifest.config || null,
        settings: settings,
        enabled: true
      };
      
      this.plugins = this.plugins.filter(p => p.id !== plugin.id);
      this.plugins.push(plugin);
      this.savePlugins();
      this.updateTopBarVisibility();
      this.renderInstalledPlugins();
      this.renderDropdown();
      this.loadPlugin(plugin);
      if (window.toastManager) window.toastManager.show(`Plugin ${plugin.name} installed successfully!`, 'success');
      if (this.inputUrl) this.inputUrl.value = '';
    } catch (e) {
      if (window.toastManager) window.toastManager.show(`Failed to install plugin: ${e.message}`, 'error');
    }
  }

  async updatePlugin(plugin) {
    try {
      let manifestUrl = plugin.url;
      if (plugin.url.includes('github.com')) {
        const parts = plugin.url.split('github.com/')[1].split('/');
        if (parts.length >= 2) manifestUrl = `https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/main/manifest.json`;
      }
      
      const manifestText = await this.fetchGitHubFile(manifestUrl);
      const manifest = JSON.parse(manifestText);
      
      if (manifest.version !== plugin.version) {
        if (manifest.min_leef_version && !this.isVersionMatch(manifest.min_leef_version, window.APP_VERSION)) {
          if (window.toastManager) window.toastManager.show(`Plugin Update Blocked`, `${plugin.name} v${manifest.version} requires a newer version of Leef Browser.`, 'error');
          return;
        }
        
        plugin.version = manifest.version;
        plugin.name = manifest.name;
        plugin.description = manifest.description;
        const basePath = manifestUrl.replace('/manifest.json', '');
        plugin.jsUrl = `${basePath}/${manifest.main || 'plugin.js'}`;
        
        plugin.configSchema = manifest.config || null;
        if (manifest.config) {
          if (!plugin.settings) plugin.settings = {};
          manifest.config.forEach(c => {
             if (plugin.settings[c.id] === undefined) plugin.settings[c.id] = c.default;
          });
        }
        
        plugin.jsCode = await this.fetchGitHubFile(plugin.jsUrl);
        
        this.savePlugins();
        this.renderInstalledPlugins();
        this.renderDropdown();
        if (plugin.enabled) {
          this.unloadPlugin(plugin);
          this.loadPlugin(plugin);
        }
        if (window.toastManager) window.toastManager.show(`Plugin Updated`, `${plugin.name} was updated to v${plugin.version}`, 'success');
      }
    } catch (e) {
      console.warn(`Failed to check update for ${plugin.name}:`, e);
    }
  }

  async checkForUpdates() {
    for (const p of this.plugins) {
      await this.updatePlugin(p);
    }
  }

  savePlugins() {
    localStorage.setItem('leef_plugins', JSON.stringify(this.plugins));
  }

  renderInstalledPlugins() {
    if (!this.containerInstalled) return;
    this.containerInstalled.innerHTML = '';
    
    if (this.plugins.length > 0) {
      const updateBar = document.createElement('div');
      updateBar.style.display = 'flex';
      updateBar.style.justifyContent = 'flex-end';
      updateBar.style.marginBottom = '15px';
      updateBar.innerHTML = `<button class="settings-btn" id="btn-update-all-plugins" style="width:auto; margin:0; font-size:0.85rem;" data-i18n="Check for Updates">Check for Updates</button>`;
      this.containerInstalled.appendChild(updateBar);
      
      const btnUpdate = updateBar.querySelector('#btn-update-all-plugins');
      btnUpdate.addEventListener('click', () => {
        btnUpdate.textContent = window.t ? window.t('Checking...') : 'Checking...';
        this.checkForUpdates().then(() => {
          btnUpdate.textContent = window.t ? window.t('Check for Updates') : 'Check for Updates';
        });
      });
    }

    this.plugins.forEach(p => {
      const card = document.createElement('div');
      card.className = 'flag-card';
      card.style.flexDirection = 'column';
      card.style.alignItems = 'stretch';
      
      const hasConfig = p.configSchema && p.configSchema.length > 0;
      const hasOnSettings = this.loadedPlugins[p.id] && typeof this.loadedPlugins[p.id].onSettings === 'function';
      const showSettingsBtn = hasConfig || hasOnSettings;
      
      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
          <div class="flag-info" style="flex: 1;">
            <h3>${p.name} <span class="beta-tag" style="background:#555;">v${p.version}</span></h3>
            <p>${p.description}</p>
            <p style="font-size: 0.8rem; color: #888;">By ${p.author}</p>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            ${showSettingsBtn ? `<button class="settings-btn btn-plugin-settings" style="width: auto; padding: 5px 10px; margin: 0; background: none; border: 1px solid #555;">⚙️</button>` : ''}
            <label class="switch"><input type="checkbox" class="plugin-enable-toggle" ${p.enabled ? 'checked' : ''}><span class="slider"></span></label>
            <button class="settings-btn btn-remove-plugin" style="background: #ff4444; margin-left: 10px;">Remove</button>
          </div>
        </div>
        <div class="plugin-config-container" style="display: none; width: 100%; margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(0,0,0,0.1); flex-direction: column; gap: 10px;"></div>
      `;
      
      const configContainer = card.querySelector('.plugin-config-container');
      const settingsBtn = card.querySelector('.btn-plugin-settings');
      
      if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
          if (hasConfig) {
            const isVisible = configContainer.style.display !== 'none';
            configContainer.style.display = isVisible ? 'none' : 'flex';
            if (!isVisible) this.renderPluginConfig(p, configContainer);
          } else if (hasOnSettings) {
            const instance = this.loadedPlugins[p.id];
            if (instance && instance.onSettings) instance.onSettings();
          }
        });
      }
      
      const toggle = card.querySelector('.plugin-enable-toggle');
      toggle.addEventListener('change', (e) => {
        p.enabled = e.target.checked;
        this.savePlugins();
        if (p.enabled) this.loadPlugin(p);
        else this.unloadPlugin(p);
      });
      
      const removeBtn = card.querySelector('.btn-remove-plugin');
      removeBtn.addEventListener('click', () => {
        this.unloadPlugin(p);
        this.plugins = this.plugins.filter(x => x.id !== p.id);
        this.savePlugins();
        this.updateTopBarVisibility();
        this.renderInstalledPlugins();
        this.renderDropdown();
        
        // Re-render discover tab to update button states
        this.loadDiscoverPlugins();
      });
      
      this.containerInstalled.appendChild(card);
    });
  }

  renderPluginConfig(plugin, container) {
    container.innerHTML = `<h4 style="margin: 0 0 10px 0; color: var(--primary-color);">Plugin Settings</h4>`;
    if (!plugin.settings) plugin.settings = {};
    
    plugin.configSchema.forEach(c => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.alignItems = 'center';
      
      const label = document.createElement('label');
      label.textContent = c.label || c.id;
      label.style.fontSize = '0.9rem';
      label.style.color = 'var(--text-color)';
      
      row.appendChild(label);
      
      if (c.type === 'boolean') {
        const wrap = document.createElement('label');
        wrap.className = 'switch';
        wrap.style.margin = '0';
        wrap.style.transform = 'scale(0.8)';
        
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = plugin.settings[c.id] !== undefined ? plugin.settings[c.id] : c.default;
        
        input.addEventListener('change', (e) => {
          plugin.settings[c.id] = e.target.checked;
          this.savePlugins();
          if (plugin.enabled) { this.unloadPlugin(plugin); this.loadPlugin(plugin); }
        });
        
        const slider = document.createElement('span');
        slider.className = 'slider';
        wrap.appendChild(input);
        wrap.appendChild(slider);
        row.appendChild(wrap);
      } else if (c.type === 'number' || c.type === 'string') {
        const input = document.createElement('input');
        input.type = c.type === 'number' ? 'number' : 'text';
        input.value = plugin.settings[c.id] !== undefined ? plugin.settings[c.id] : c.default;
        input.style.padding = '5px 8px';
        input.style.border = '1px solid rgba(0,0,0,0.2)';
        input.style.borderRadius = '4px';
        input.style.background = 'var(--bg-primary)';
        input.style.color = 'var(--text-color)';
        input.style.width = '150px';
        
        input.addEventListener('change', (e) => {
          plugin.settings[c.id] = c.type === 'number' ? parseFloat(e.target.value) : e.target.value;
          this.savePlugins();
          if (plugin.enabled) { this.unloadPlugin(plugin); this.loadPlugin(plugin); }
        });
        row.appendChild(input);
      } else if (c.type === 'select' && Array.isArray(c.options)) {
        const select = document.createElement('select');
        select.style.padding = '5px 8px';
        select.style.border = '1px solid rgba(0,0,0,0.2)';
        select.style.borderRadius = '4px';
        select.style.background = 'var(--bg-primary)';
        select.style.color = 'var(--text-color)';
        
        c.options.forEach(opt => {
           const optionEl = document.createElement('option');
           const val = typeof opt === 'object' ? opt.value : opt;
           const txt = typeof opt === 'object' ? opt.label : opt;
           optionEl.value = val;
           optionEl.textContent = txt;
           select.appendChild(optionEl);
        });
        
        select.value = plugin.settings[c.id] !== undefined ? plugin.settings[c.id] : c.default;
        
        select.addEventListener('change', (e) => {
          plugin.settings[c.id] = e.target.value;
          this.savePlugins();
          if (plugin.enabled) { this.unloadPlugin(plugin); this.loadPlugin(plugin); }
        });
        row.appendChild(select);
      }
      
      container.appendChild(row);
    });
  }

  renderDropdown() {
    if (!this.dropdownList) return;
    this.dropdownList.innerHTML = '';
    
    if (this.plugins.length === 0) {
      this.dropdownList.innerHTML = '<p style="opacity: 0.6; padding: 10px; font-size: 0.9rem;">No plugins installed.</p>';
      return;
    }
    
    this.plugins.forEach(p => {
      const item = document.createElement('div');
      item.style.padding = '10px 15px';
      item.style.display = 'flex';
      item.style.justifyContent = 'space-between';
      item.style.alignItems = 'center';
      item.style.borderBottom = '1px solid rgba(128,128,128,0.1)';
      
      item.innerHTML = `
        <div style="display: flex; flex-direction: column;">
          <span style="font-weight: 500; font-size: 0.95rem;">${p.name}</span>
          <span style="font-size: 0.75rem; color: #888;">v${p.version}</span>
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          ${this.loadedPlugins[p.id] && typeof this.loadedPlugins[p.id].onSettings === 'function' ? `<button class="btn-plugin-settings" style="background: none; border: none; cursor: pointer; padding: 4px; border-radius: 4px;" title="Settings">⚙️</button>` : ''}
          <label class="switch" style="transform: scale(0.8); margin: 0;"><input type="checkbox" ${p.enabled ? 'checked' : ''}><span class="slider"></span></label>
        </div>
      `;
      
      const settingsBtn = item.querySelector('.btn-plugin-settings');
      if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
          DropdownUtils.hide(this.dropdown);
          const instance = this.loadedPlugins[p.id];
          if (instance && instance.onSettings) instance.onSettings();
        });
      }
      
      const toggle = item.querySelector('input[type="checkbox"]');
      toggle.addEventListener('change', (e) => {
        p.enabled = e.target.checked;
        this.savePlugins();
        if (p.enabled) this.loadPlugin(p);
        else this.unloadPlugin(p);
        this.renderInstalledPlugins();
      });
      
      this.dropdownList.appendChild(item);
    });
  }

  async loadPlugin(plugin) {
    if (!plugin.enabled) return;
    try {
      if (this.loadedPlugins[plugin.id]) return;
      
      let code = plugin.jsCode;
      if (!code) {
        const res = await fetch(plugin.jsUrl);
        code = await res.text();
      }
      
      const blob = new Blob([code], { type: 'application/javascript' });
      const moduleUrl = URL.createObjectURL(blob);
      const { default: PluginClass } = await import(moduleUrl);
      URL.revokeObjectURL(moduleUrl);
      
      if (!window.leefPluginGlobalCSS) window.leefPluginGlobalCSS = {};
      if (!window.leefPluginGlobalJS) window.leefPluginGlobalJS = {};
      
      const api = {
        addBrowserClass: (cls) => document.body.classList.add(cls),
        removeBrowserClass: (cls) => document.body.classList.remove(cls),
        injectCSS: (css) => {
          if (window.tabManager && window.tabManager.tabs) {
            window.tabManager.tabs.forEach(tab => {
              if (tab.webviewEl) tab.webviewEl.insertCSS(css).catch(()=>{});
            });
          }
          window.leefPluginGlobalCSS[plugin.id] = css;
        },
        removeCSS: () => {
          if (window.leefPluginGlobalCSS) delete window.leefPluginGlobalCSS[plugin.id];
          if (window.tabManager && window.tabManager.tabs) {
            window.tabManager.tabs.forEach(tab => {
              if (tab.webviewEl) tab.webviewEl.reload();
            });
          }
        },
        executeJavaScript: (code) => {
          if (window.tabManager && window.tabManager.tabs) {
            window.tabManager.tabs.forEach(tab => {
              if (tab.webviewEl) tab.webviewEl.executeJavaScript(code).catch(()=>{});
            });
          }
          window.leefPluginGlobalJS[plugin.id] = code;
        },
        removeJS: () => {
          if (window.leefPluginGlobalJS) delete window.leefPluginGlobalJS[plugin.id];
          if (window.tabManager && window.tabManager.tabs) {
            window.tabManager.tabs.forEach(tab => {
              if (tab.webviewEl) tab.webviewEl.reload();
            });
          }
        },
        setDNS: (url) => {
          if (window.leefAPI && window.leefAPI.ipc) {
            window.leefAPI.ipc.send('set-dns', url);
          }
        },
        settings: plugin.settings || {}
      };
      
      const instance = new PluginClass(api);
      instance.onEnable();
      this.loadedPlugins[plugin.id] = instance;
    } catch (e) {
      console.error(`Failed to load plugin ${plugin.id}:`, e);
    }
  }

  unloadPlugin(plugin) {
    const instance = this.loadedPlugins[plugin.id];
    if (instance) {
      try {
        if (instance.onDisable) instance.onDisable();
      } catch (e) {
        console.warn(`Plugin ${plugin.id} threw error during onDisable:`, e);
      }
      delete this.loadedPlugins[plugin.id];
    }
    
    // Force cleanup to ensure uninstall/disable is 100% effective
    let needsReload = false;
    if (window.leefPluginGlobalCSS && window.leefPluginGlobalCSS[plugin.id]) {
      delete window.leefPluginGlobalCSS[plugin.id];
      needsReload = true;
    }
    if (window.leefPluginGlobalJS && window.leefPluginGlobalJS[plugin.id]) {
      delete window.leefPluginGlobalJS[plugin.id];
      needsReload = true;
    }
    
    if (needsReload && window.tabManager && window.tabManager.tabs) {
      window.tabManager.tabs.forEach(tab => {
        if (tab.webviewEl) tab.webviewEl.reload();
      });
    }
  }

  loadAllPlugins() {
    this.plugins.forEach(p => this.loadPlugin(p));
  }
}

window.pluginManager = new PluginManager();
