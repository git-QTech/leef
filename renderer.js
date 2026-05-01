/**
 * Leef Browser 
 * Renderer Process Core Architecture
 */

let APP_VERSION = '0.2.1'; // Fallback

async function initVersion() {
  try {
    const response = await fetch('./package.json');
    const pkg = await response.json();
    APP_VERSION = pkg.version;
    
    // Auto-populate any elements that need the version string
    document.querySelectorAll('.leef-version-val').forEach(el => {
      el.textContent = APP_VERSION;
    });
  } catch (e) {
    console.error('Failed to load version from package.json:', e);
  }
}

initVersion();

// --- UTILITIES ---
class BrowserUtils {
  static parseAddress(str, engineBaseUrl, blockAI = true) {
    str = str.trim();
    const domainPattern = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:\/.*)?$/;
    if (!str.includes(' ') && (domainPattern.test(str) || str.startsWith('http://') || str.startsWith('https://') || str.startsWith('localhost:'))) {
      if (!str.startsWith('http://') && !str.startsWith('https://')) return 'https://' + str;
      return str;
    }

    // Robust AI Overview Blocking for Google
    if (blockAI && engineBaseUrl.includes('google.com/search')) {
      const noaiRegex = /(^|\s)-noai(\s|$)/i;
      if (!noaiRegex.test(str)) {
        str = str.trim() + ' -noai';
      }
    }

    return engineBaseUrl + encodeURIComponent(str);
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
      backgroundLimit: true,
      allowNotifications: true,
      askDownload: false,
      blockAIOverview: true,
      autoCheckUpdates: true,
      customUa: '',
      dohToggle: false,
      proxyUrl: '',
      liveAutocomplete: false,
      enableVolumeBoost: false,
      sitePermissions: {}
    };
    // Load previously saved settings and merge with defaults
    this.currentSettings = this.loadSavedSettings();
    this.bindEvents();
    // Sync form elements to loaded values once DOM is ready
    this.syncUIToSettings();
  }

  loadSavedSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem('leef_settings') || '{}');
      
      // Fallback: If saved language is not supported anymore, default to en
      const supported = ['en', 'en-gb', 'en-ca'];
      if (saved.language && !supported.includes(saved.language)) {
        saved.language = 'en';
      }
      
      return { ...this.defaultSettings, ...saved };
    } catch (e) {
      return { ...this.defaultSettings };
    }
  }

  applyLocalization() {
    const lang = this.currentSettings.language;
    if (lang === 'en-gb' || lang === 'en-ca') {
      // Very simple string replacement for common regional spelling differences
      const targets = document.querySelectorAll('label, h1, h2, h3, p, li, span, strong');
      targets.forEach(el => {
        if (el.children.length === 0 || el.tagName === 'STRONG') {
          // Only replace text in leaf nodes or specific emphasized tags to avoid breaking HTML
          el.innerHTML = el.innerHTML.replace(/Color/g, 'Colour').replace(/color/g, 'colour');
        }
      });
    }
  }

  syncUIToSettings() {
    const s = this.currentSettings;
    const el = id => document.getElementById(id);
    if (el('search-engine-select')) el('search-engine-select').value = s.searchEngine;
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
    if (el('enable-volume-boost')) el('enable-volume-boost').checked = s.enableVolumeBoost;
    if (el('allow-notifications')) el('allow-notifications').checked = s.allowNotifications;
    if (el('ask-download')) el('ask-download').checked = s.askDownload;
    if (el('block-ai')) el('block-ai').checked = s.blockAIOverview;
    if (el('custom-ua')) el('custom-ua').value = s.customUa || '';
    if (el('doh-toggle')) el('doh-toggle').checked = s.dohToggle;
    if (el('proxy-url')) el('proxy-url').value = s.proxyUrl || '';
    if (el('live-autocomplete')) el('live-autocomplete').checked = s.liveAutocomplete;
    document.querySelectorAll(`input[name="startup"]`).forEach(r => { r.checked = r.value === s.startup; });
    document.querySelectorAll(`input[name="tracking"]`).forEach(r => { r.checked = r.value === s.tracking; });

    // Show adblock badge based on saved setting
    this.updateAdblockBadge(s.adBlockerMode || 'none');

    // Apply regional spelling (Color vs Colour)
    this.applyLocalization();
  }

  sendSettingsToMain() {
    // Send current settings to the main process so network rules apply on startup
    try {
      window.require('electron').ipcRenderer.send('apply-settings', this.currentSettings);
    } catch (e) { console.log('IPC not available', e); }
  }

  bindEvents() {
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

    // Auto-save settings on change because i fucked up the first 3 times
    let saveDebounce = null;
    document.querySelectorAll('.settings-layout input, .settings-layout select').forEach(el => {
      el.addEventListener('change', () => {
        clearTimeout(saveDebounce);
        saveDebounce = setTimeout(() => this.saveSettings(), 500);
      });
    });

    // IPC Buttons
    if (UI.buttons.clearData) {
      UI.buttons.clearData.addEventListener('click', () => {
        try {
          window.require('electron').ipcRenderer.send('clear-data');
          localStorage.removeItem('leef_onboarding_done');
          if (window.toastManager) window.toastManager.show('🧹 Data Cleared', 'History, cache, and onboarding status have been cleared.', 5000);
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
          btnGenerateLog.textContent = 'Generating...';
          btnGenerateLog.disabled = true;

          const payload = {
            settings: JSON.parse(localStorage.getItem('leef_settings') || '{}'),
            labs: JSON.parse(localStorage.getItem('leef_labs_flags') || '{}')
          };
          window.require('electron').ipcRenderer.send('generate-bug-log', payload);
        } catch (e) {
          console.error('Renderer error in generate-bug-log:', e);
          btnGenerateLog.textContent = 'Generate Diagnostics Log';
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
          window.require('electron').ipcRenderer.send('manual-update-check');
          btnCheck.textContent = 'Checking...';
          btnCheck.disabled = true;
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
        btnLog.textContent = 'Generate Diagnostics Log';
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
          if (confirm('Diagnostics log generated! This file contains your settings and system info, but NO history or passwords. \n\nWould you like to open the bug report form now to upload it?')) {
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

      if (btn) {
        btn.textContent = 'Check for Updates Now';
        btn.disabled = false;
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

        if (window.toastManager) {
          window.toastManager.show('✨ Update Available', `${displayVersion} is now available for download!`, 12000);

          if (toastAction) {
            toastAction.style.display = 'block';
            const actionBtn = toastAction.querySelector('button');
            actionBtn.textContent = 'View on GitHub';
            actionBtn.onclick = () => {
              window.tabManager.createTab(`https://github.com/git-QTech/leef/releases/tag/${tag}`);
            };
          }
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
      blockAIOverview: document.getElementById('block-ai').checked,
      customUa: document.getElementById('custom-ua').value,
      dohToggle: document.getElementById('doh-toggle').checked,
      proxyUrl: document.getElementById('proxy-url').value,
      liveAutocomplete: document.getElementById('live-autocomplete').checked
    };

    this.applyVisualSettings();

    try {
      // Include Labs flags in the primary settings object
      const labs = JSON.parse(localStorage.getItem('leef_labs_flags') || '{}');
      const settingsWithLabs = { ...this.currentSettings, labs };

      // Persist to localStorage AND send to main process
      localStorage.setItem('leef_settings', JSON.stringify(this.currentSettings));
      window.require('electron').ipcRenderer.send('apply-settings', settingsWithLabs);
      if (window.toastManager) window.toastManager.show('⚙️ Settings Saved', 'Your preferences have been applied.', 3000);

      // Update adblock badge immediately based on current mode
      this.updateAdblockBadge(this.currentSettings.adBlockerMode);
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
  }
}

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
          this.dropdown.style.display = 'none';
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
      if (this.dropdown.style.display === 'none') {
        this.render();
        this.dropdown.style.display = 'flex';
        // Close other dropdowns
        const d = document.getElementById('downloads-dropdown');
        if (d) d.style.display = 'none';
      } else {
        this.dropdown.style.display = 'none';
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
      if (this.dropdown.style.display !== 'none' && !this.dropdown.contains(e.target) && e.target !== this.btnBookmarks && !this.btnBookmarks.contains(e.target)) {
        this.dropdown.style.display = 'none';
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
      { name: 'Discord', url: 'https://discord.com', cls: 'hub-tile-discord' },
      { name: 'Disney +', url: 'https://disneyplus.com', cls: 'hub-tile-disney' },
    ];
    this.tiles = this.loadTiles();
    this.bindModalEvents();
    this.render();
  }

  loadTiles() {
    try {
      const saved = JSON.parse(localStorage.getItem('leef_hub_tiles'));
      if (saved && saved.length > 0) return saved;
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
    this.colorOpts = document.querySelectorAll('.color-opt');

    if (!this.modal) return;

    this.btnCancel.addEventListener('click', () => this.closeModal());

    this.btnConfirm.addEventListener('click', () => {
      const name = this.nameInput.value.trim();
      const url = this.urlInput.value.trim();
      const activeColor = document.querySelector('.color-opt.active')?.dataset.color || '#92ff78';

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

    // Color options
    this.colorOpts.forEach(opt => {
      opt.addEventListener('click', () => {
        this.colorOpts.forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
      });
    });
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
        // Adjust text color for visibility if needed
        if (tile.color === '#555555' || tile.color === '#333333') el.style.color = '#fff';
      }

      el.innerHTML = `
        ${tile.subtitle ? `<div>${BrowserUtils.sanitize(tile.name)}</div><div class="small-text">${BrowserUtils.sanitize(tile.subtitle)}</div>` : BrowserUtils.sanitize(tile.name)}
        <button class="hub-tile-remove" data-idx="${i}" title="Remove">&times;</button>
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
    addTile.innerHTML = '<b>+</b> Add More';
    addTile.addEventListener('click', () => this.promptAddTile());
    this.gridEl.appendChild(addTile);
  }

  promptAddTile() {
    if (!this.modal) return;
    this.nameInput.value = '';
    this.urlInput.value = '';
    // Reset colors
    this.colorOpts.forEach(o => o.classList.remove('active'));
    document.querySelector('.color-opt[data-color="#92ff78"]')?.classList.add('active');

    this.modal.style.display = 'flex';
    document.body.classList.add('modal-open');
    this.nameInput.focus();
  }

  closeModal() {
    this.modal.style.display = 'none';
    document.body.classList.remove('modal-open');
  }
}

class NewsService {
  constructor() {
    this.container = document.getElementById('dynamic-news-container');
    this.isLoading = false;
    this.allItems = [];     // All parsed RSS items
    this.shownIndices = []; // Indices of the 3 currently shown items
    this.skippedSet = new Set(); // Indices dismissed by user
    this.loadNews();
  }

  refresh() {
    if (this.isLoading) return;
    this.allItems = [];
    this.shownIndices = [];
    this.skippedSet.clear();
    if (this.container) this.container.innerHTML = '<p style="opacity: 0.6; padding-left: 10px;">Refreshing...</p>';
    this.loadNews();
  }

  loadNews() {
    const container = this.container;
    if (!container) return;
    if (this.isLoading) return;
    this.isLoading = true;
    try {
      const https = window.require('https');
      // Cache-bust: append timestamp so we don't get stale cached RSS
      const rssUrl = `https://news.yahoo.com/rss/?_t=${Date.now()}`;
      https.get(rssUrl, (res) => {
        let data = '';
        let dataSize = 0;
        const MAX_BYTES = 512 * 1024;
        res.on('data', chunk => {
          dataSize += chunk.length;
          if (dataSize < MAX_BYTES) data += chunk;
        });
        res.on('end', () => {
          this.isLoading = false;
          try {
            const xml = new DOMParser().parseFromString(data, 'text/xml');
            const rawItems = xml.querySelectorAll('item');
            this.allItems = [];
            for (let i = 0; i < rawItems.length; i++) {
              const item = rawItems[i];
              const title = item.querySelector('title')?.textContent || 'Breaking News';
              const rawLink = item.querySelector('link')?.textContent || 'https://news.yahoo.com';
              const link = rawLink.startsWith('http') ? rawLink : 'https://news.yahoo.com';
              let imgSrc = 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=300&h=200&fit=crop';
              const mediaCont = item.getElementsByTagName('media:content');
              if (mediaCont && mediaCont.length > 0 && mediaCont[0].getAttribute('url')) {
                imgSrc = mediaCont[0].getAttribute('url');
              }
              this.allItems.push({ title, link, imgSrc });
            }
            // Show first 3
            this.shownIndices = [];
            for (let i = 0; i < Math.min(this.allItems.length, 3); i++) {
              this.shownIndices.push(i);
            }
            this.renderCards();
          } catch (e) { container.innerHTML = '<p style="opacity: 0.6; padding-left: 10px;">Failed to parse latest news.</p>'; }
        });
      }).on('error', () => { this.isLoading = false; container.innerHTML = '<p style="opacity: 0.6; padding-left: 10px;">Failed to load latest news.</p>'; });
    } catch (e) { this.isLoading = false; container.innerHTML = '<p style="opacity: 0.6; padding-left: 10px;">Offline news mode.</p>'; }
  }

  renderCards() {
    if (!this.container) return;
    this.container.innerHTML = '';
    this.shownIndices.forEach((itemIdx, slotIdx) => {
      const item = this.allItems[itemIdx];
      if (!item) return;
      const card = document.createElement('div');
      card.className = 'news-card';
      card.setAttribute('data-url', item.link);
      card.innerHTML = `
        <img src="${item.imgSrc}" alt="News" class="news-img" loading="lazy">
        <div class="news-content">
          <p>${BrowserUtils.sanitize(item.title)}</p>
          <div class="news-bottom">
            <div class="news-source source-yahoo">Yahoo News <span class="external-icon">&#8599;</span></div>
            <button class="news-dismiss-btn" data-slot="${slotIdx}" title="I don't care">✕ I don't care</button>
          </div>
        </div>
      `;
      // Click card to navigate (but not if dismiss button was clicked)
      card.addEventListener('click', (e) => {
        if (e.target.closest('.news-dismiss-btn')) return;
        if (window.tabManager) window.tabManager.navigateToUrl(item.link);
      });
      // Dismiss button
      card.querySelector('.news-dismiss-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        this.dismissCard(slotIdx);
      });
      this.container.appendChild(card);
    });
  }

  dismissCard(slotIdx) {
    const currentIdx = this.shownIndices[slotIdx];
    this.skippedSet.add(currentIdx);
    // Find the next unused item
    const usedSet = new Set([...this.shownIndices, ...this.skippedSet]);
    let replacement = -1;
    for (let i = 0; i < this.allItems.length; i++) {
      if (!usedSet.has(i)) { replacement = i; break; }
    }
    if (replacement !== -1) {
      this.shownIndices[slotIdx] = replacement;
      this.renderCards();
    } else {
      // if no more items just remove the card
      this.shownIndices.splice(slotIdx, 1);
      this.renderCards();
      if (window.toastManager) window.toastManager.show('📰 No More Headlines', 'You\'ve seen all available stories. Try refreshing later!', 4000);
    }
  }
}


class TabManager {
  constructor(settingsInstance) {
    this.settings = settingsInstance;
    this.tabs = [];
    this.activeTabId = null;
    this.tabCounter = 0;
    this.lastTabOpen = { url: '', time: 0 };

    this.bindGlobalEvents();
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
    // URL Debounce: Prevent the exact same URL from opening twice within 500ms
    // Fixes "double tabs" caused by click interceptors fighting with native handlers.
    const now = Date.now();
    if (route !== 'home' && route === this.lastTabOpen.url && (now - this.lastTabOpen.time) < 500) {
      return;
    }
    this.lastTabOpen = { url: route, time: now };

    const isInternal = ['home', 'settings', 'changelog', 'credits', 'flags'].includes(route);

    // Hide labs view when navigating away
    const labsView = document.getElementById('flags-view');
    if (labsView) labsView.style.display = 'none';

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
    tabTitle.textContent = route === 'home' ? 'Leef Browser | Home' : (route === 'settings' ? 'Settings' : (route === 'changelog' ? "What's New" : (route === 'credits' ? 'Credits' : (route === 'flags' ? 'Leef Labs' : 'Loading...'))));

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
      faviconEl: tabFavicon
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
      if (e.target !== tabClose) this.switchTab(tabId);
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
        window.require('electron').ipcRenderer.send('show-tab-context-menu', {
          tabId: tabId,
          isPinned: tabObj.isPinned,
          isMuted: tabObj.isMuted
        });
      } catch (err) { }
    });

    tabClose.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeTab(tabId);
    });

    this.switchTab(tabId);
  }

  mountWebview(tab) {
    if (tab.webviewEl) return; // this shit already exists
    tab.webviewEl = document.createElement('webview');
    tab.webviewEl.id = 'webview-' + tab.id;
    tab.webviewEl.setAttribute('allowpopups', '');
    tab.webviewEl.setAttribute('partition', 'persist:leef-session'); // CRITICAL: must match session in main.js
    UI.views.webviewsContainer.appendChild(tab.webviewEl);

    tab.webviewEl.addEventListener('did-start-loading', () => {
      tab.title = 'Loading...';
      tab.url = tab.webviewEl.src;
      tab.volumeBoost = 1; // Reset volume on moving to a new tab
      tab.blockedAds = 0; // Reset adblock stats on moving to a new tab
      if (this.activeTabId === tab.id) {
        if (window.quickSettingsManager && window.quickSettingsManager.sliderVolume) {
          window.quickSettingsManager.sliderVolume.value = 1;
        }
        if (window.siteIdentityManager) window.siteIdentityManager.updateUI();
      }
      this.updateTabUI(tab);
    });

    tab.webviewEl.addEventListener('page-title-updated', (e) => {
      tab.title = e.title;
      this.updateTabUI(tab);
    });

    tab.webviewEl.addEventListener('page-favicon-updated', (e) => {
      if (e.favicons && e.favicons.length > 0) {
        tab.faviconUrl = e.favicons[0];
        this.updateTabUI(tab);
      }
    });

    // Catch the manual tab interceptor messages
    tab.webviewEl.addEventListener('console-message', (e) => {
      if (e.message && e.message.startsWith('LEEF_NEW_TAB:')) {
        const url = e.message.replace('LEEF_NEW_TAB:', '');
        this.createTab(url);
      }
    });

    tab.webviewEl.addEventListener('did-stop-loading', () => {
      tab.title = tab.webviewEl.getTitle() || tab.url;
      tab.url = tab.webviewEl.getURL();
      tab.canGoBack = tab.webviewEl.canGoBack();
      tab.canGoForward = tab.webviewEl.canGoForward();
      if (typeof tab.webviewEl.setZoomFactor === 'function') {
        try { tab.webviewEl.setZoomFactor(parseFloat(this.settings.currentSettings.zoom) || 1.0); } catch (e) { }
      }
      this.updateTabUI(tab);

      // GUARANTEED NEW TAB INTERCEPTOR
      // Bypasses Electron's unpredictable native popup handlers.
      tab.webviewEl.executeJavaScript(`
        (function() {
          if (window.__leefHooked) return;
          window.__leefHooked = true;
          document.addEventListener('click', (e) => {
            const a = e.target.closest('a');
            if (!a || !a.href) return;
            // Catch middle clicks and target="_blank"
            if (e.button === 1 || a.target === '_blank') {
              e.preventDefault();
              e.stopPropagation();
              console.log('LEEF_NEW_TAB:' + a.href);
            }
          }, true);
        })();
      `);

      // ROBUST AI OVERVIEW BLOCKER (v2.0)
      if (this.settings.currentSettings.blockAIOverview && tab.url.includes('google.com')) {
        tab.webviewEl.executeJavaScript(`
          (function() {
            if (window.__leefAIHooked) return;
            window.__leefAIHooked = true;

            const NOAI_TAG = ' -noai';
            const NOAI_REGEX = /( ?)-noai/gi;

            // 1. Intercept search inputs to keep the tag hidden from user view
            const hookInput = (input) => {
              if (input.dataset.leefHooked) return;
              input.dataset.leefHooked = "true";
              
              const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value');
              if (!descriptor) return;

              Object.defineProperty(input, 'value', {
                get: function() {
                  const val = descriptor.get.call(this);
                  return val ? val.replace(NOAI_REGEX, '') : val;
                },
                set: function(val) {
                  const cleanVal = (val && typeof val === 'string') ? val.replace(NOAI_REGEX, '') : val;
                  descriptor.set.call(this, cleanVal);
                }
              });
              
              // Clean initial value
              const initial = descriptor.get.call(input);
              if (initial) descriptor.set.call(input, initial.replace(NOAI_REGEX, ''));
            };

            // 2. Intercept Form Submissions (Most robust way to catch dynamic searches)
            const interceptSearch = (query) => {
              if (!query) return;
              const clean = query.replace(NOAI_REGEX, '').trim();
              window.location.href = '/search?q=' + encodeURIComponent(clean + NOAI_TAG);
            };

            document.addEventListener('submit', (e) => {
              const qInput = e.target.querySelector('input[name="q"], textarea[name="q"]');
              if (qInput) {
                e.preventDefault();
                e.stopPropagation();
                interceptSearch(qInput.value);
              }
            }, true);

            // 3. Catch Enter Key as a fallback
            document.addEventListener('keydown', (e) => {
              if (e.key === 'Enter' && e.target.name === 'q') {
                e.preventDefault();
                e.stopPropagation();
                interceptSearch(e.target.value);
              }
            }, true);

            // 4. Watch for dynamic search bars (Google swaps them often)
            const observer = new MutationObserver(() => {
              document.querySelectorAll('input[name="q"], textarea[name="q"]').forEach(hookInput);
            });
            observer.observe(document.body, { childList: true, subtree: true });
            document.querySelectorAll('input[name="q"], textarea[name="q"]').forEach(hookInput);
          })();
        `);
      }

      // YouTube Ad-Skip Script
      if (tab.url && tab.url.includes('youtube.com')) {
        const injectYTAdBlock = () => {
          tab.webviewEl.executeJavaScript(`
            (function() {
              if (window.__leefYTAdBlock) return;
              window.__leefYTAdBlock = true;

              function skipAd() {
                // 1. Click skip button (multiple selectors for different YT versions)
                const skipBtn = document.querySelector(
                  '.ytp-skip-ad-button__text, .ytp-ad-skip-button-modern, .ytp-ad-skip-button, .ytp-skip-ad-button'
                );
                if (skipBtn) { skipBtn.click(); return; }

                // 2. For unskippable ads — mute and seek to end
                const player = document.querySelector('.ad-showing video');
                if (player && player.duration && !isNaN(player.duration) && isFinite(player.duration)) {
                  player.muted = true;
                  player.currentTime = player.duration;
                }

                // 3. Dismiss anti-adblock enforcement modal
                const enforceBtn = document.querySelector(
                  'ytd-enforcement-message-view-model button[class*="dismiss"], ' +
                  'tp-yt-paper-dialog .style-scope ytd-button-renderer:last-child button'
                );
                if (enforceBtn) enforceBtn.click();

                // 4. Hide overlay banner ads (Download Chrome, etc) and feed ads
                if (!document.getElementById('__leef_yt_css')) {
                  const s = document.createElement('style');
                  s.id = '__leef_yt_css';
                  s.textContent = \`
                    .ytp-ad-overlay-container, .ytp-ad-text-overlay,
                    .ytp-ad-image-overlay, .ytp-ce-element,
                    #masthead-ad, ytd-banner-promo-renderer,
                    ytd-statement-banner-renderer, ytd-ad-slot-renderer,
                    ytd-in-feed-ad-layout-renderer, ytd-promoted-sparkles-web-renderer,
                    ytd-search-pyv-renderer, #player-ads { 
                      display: none !important; 
                    }
                  \`;
                  document.head.appendChild(s);
                }
              }

              setInterval(skipAd, 500);
              skipAd();
            })();
          `).catch(() => { });
        };

        // Inject on initial load
        injectYTAdBlock();

        // Re-inject on every SPA navigation (clicking a video within YouTube)
        if (!tab._ytNavHooked) {
          tab._ytNavHooked = true;
          tab.webviewEl.addEventListener('did-navigate-in-page', () => {
            if (tab.webviewEl.getURL().includes('youtube.com')) {
              tab.webviewEl.executeJavaScript('window.__leefYTAdBlock = false;').catch(() => { });
              setTimeout(injectYTAdBlock, 500);
            }
          });
        }
      }
    });

    // Audio status monitoring
    tab.webviewEl.addEventListener('media-paused', () => { tab.isAudioPlaying = false; this.updateTabUI(tab); });
    tab.webviewEl.addEventListener('media-started-playing', () => { tab.isAudioPlaying = true; this.updateTabUI(tab); });

    // Offline Error Handling (v0.2.1)
    tab.webviewEl.addEventListener('did-fail-load', (e) => {
      // Ignore code -3 (ABORTED) which happens on normal navigation/refresh
      if (e.errorCode === -3) return;
      
      console.warn('Navigation failed:', e.validatedURL, e.errorDescription);
      
      // Only show offline page for main frame failures that aren't about-blank
      if (e.isMainFrame && e.validatedURL !== 'about:blank') {
        const offlinePath = `file://${window.require('path').join(__dirname, 'offline.html')}?url=${encodeURIComponent(e.validatedURL)}&code=${e.errorCode}&desc=${encodeURIComponent(e.errorDescription)}`;
        tab.webviewEl.loadURL(offlinePath);
      }
    });

    // Right-Click Context Menu for Webviews
    tab.webviewEl.addEventListener('context-menu', (e) => {
      e.preventDefault();
      try {
        window.require('electron').ipcRenderer.send('show-context-menu', e.params);
      } catch (err) { }
    });

    // Fullscreen: hide/show browser chrome when a page requests fullscreen.
    // The main process handles OS-level fullscreen via webContents events directly.
    tab.webviewEl.addEventListener('enter-full-screen', () => {
      document.body.classList.add('video-fullscreen');
    });

    tab.webviewEl.addEventListener('leave-full-screen', () => {
      document.body.classList.remove('video-fullscreen');
    });
  }

  navigateToUrl(rawInput) {
    if (!rawInput || !rawInput.trim()) return; // guard empty input

    // Hide address bar suggestions and remove focus when navigating
    if (window.addressBarManager && window.addressBarManager.suggestionsEl) {
      window.addressBarManager.suggestionsEl.style.display = 'none';
    }
    if (UI.inputs.address) UI.inputs.address.blur();

    const tab = this.getActiveTab();
    if (!tab) return;
    const fullUrl = BrowserUtils.parseAddress(rawInput.trim(), this.settings.currentSettings.searchEngine, this.settings.currentSettings.blockAIOverview);

    if (!tab.webviewEl) {
      // Lazy load instantiation
      this.mountWebview(tab);
    }

    tab.isInternal = false;
    tab.url = fullUrl;
    tab.webviewEl.src = fullUrl;
    this.switchTab(tab.id);
  }

  updateTabUI(tab) {
    if (tab.url === 'home') tab.tabTitle.textContent = 'Leef Browser | Home';
    else if (tab.url === 'settings') tab.tabTitle.textContent = 'Settings';
    else if (tab.url === 'changelog') tab.tabTitle.textContent = "What's New";
    else if (tab.url === 'flags') tab.tabTitle.textContent = "Leef Labs";
    else {
      let displayTitle = tab.title || 'Loading...';
      if (this.settings.currentSettings.blockAIOverview) {
        displayTitle = displayTitle.replace(/ -noai/gi, '');
      }
      tab.tabTitle.textContent = displayTitle;
    }

    // Set tooltip for everyone (especially important for pinned tabs)
    tab.tabEl.title = tab.tabTitle.textContent;

    if (this.activeTabId === tab.id) {
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

        if (this.settings.currentSettings.blockAIOverview && displayUrl.includes('google.com/search')) {
          displayUrl = displayUrl.replace(/(\+|\%20)-noai/g, '');
        }
        UI.inputs.address.value = displayUrl;
      }
      else UI.inputs.address.value = '';
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
  }

  switchTab(tabId) {
    const prevTabId = this.activeTabId;
    this.activeTabId = tabId;
    const tab = this.getActiveTab();
    if (!tab) return;

    // Only suspend the previously active tab (not all tabs — avoids O(n) executeJavaScript calls because that one tester kept doing it)
    if (prevTabId && prevTabId !== tabId && this.settings.currentSettings.backgroundLimit) {
      const prevTab = this.tabs.find(t => t.id === prevTabId);
      if (prevTab && prevTab.webviewEl) {
        try {
          prevTab.webviewEl.setAudioMuted(true);
          prevTab.webviewEl.executeJavaScript(`
            document.querySelectorAll('video, audio').forEach(m => {
              if (!m.paused) { m.pause(); m.dataset.wasPlayingByLeef = "true"; }
            });
          `);
        } catch (e) { }
      }
    }

    // Update tab strip UI
    this.tabs.forEach(t => {
      t.tabEl.classList.remove('active');
      if (t.webviewEl) t.webviewEl.classList.remove('active');
    });
    tab.tabEl.classList.add('active');

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
          `);
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

    if (tab.isInternal) {
      UI.views.webviewsContainer.classList.remove('active');
    } else {
      UI.views.webviewsContainer.classList.add('active');
      if (tab.webviewEl) tab.webviewEl.classList.add('active');
    }

    this.updateTabUI(tab);
  }

  closeTab(tabId) {
    const index = this.tabs.findIndex(t => t.id === tabId);
    if (index === -1) return;

    const tab = this.tabs[index];
    // Clean up webview to prevent memory leaks
    if (tab.webviewEl) {
      tab.webviewEl.removeAttribute('src');  // Stop any loading
      tab.webviewEl.remove();                // Detach from DOM
    }
    tab.tabEl.remove();
    // Null out references so GC can collect
    tab.webviewEl = null;
    tab.tabEl = null;
    tab.tabTitle = null;
    this.tabs.splice(index, 1);

    if (this.tabs.length === 0) {
      this.createTab('home');
    } else if (this.activeTabId === tabId) {
      this.switchTab(this.tabs[Math.max(0, index - 1)].id);
    }
  }

  bindGlobalEvents() {
    UI.tabsContainer.addEventListener('contextmenu', (e) => {
      if (e.target === UI.tabsContainer) {
        e.preventDefault();
        e.stopPropagation();
      }
    });

    UI.buttons.newTab.addEventListener('click', () => this.createTab('home'));

    // if (UI.buttons.settings) UI.buttons.settings.addEventListener('click', () => this.createTab('settings'));
    if (UI.buttons.whatsNew) UI.buttons.whatsNew.addEventListener('click', () => this.createTab('changelog'));
    if (UI.buttons.credits) UI.buttons.credits.addEventListener('click', () => this.createTab('credits'));

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
        }
      });

      window.require('electron').ipcRenderer.on('tab-command', (event, data) => {
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
        }
      });
    } catch (e) { }

    // Global context menu for non-webview areas (Home, Settings, etc.)
    window.addEventListener('contextmenu', (e) => {
      if (e.target.tagName === 'WEBVIEW') return;

      const params = {
        x: e.x,
        y: e.y,
        isEditable: e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable,
        selectionText: window.getSelection().toString(),
        canGoBack: false,
        canGoForward: false,
        editFlags: {}
      };

      try {
        window.require('electron').ipcRenderer.send('show-context-menu', params);
      } catch (err) { }
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

    // Adblock Tracking
    try {
      window.require('electron').ipcRenderer.on('adblock-item-blocked', (event, data) => {
        const tab = this.tabs.find(t => t.webviewEl && t.webviewEl.getWebContentsId() === data.tabId);
        if (tab) {
          tab.blockedAds = (tab.blockedAds || 0) + 1;
          if (this.activeTabId === tab.id && window.siteIdentityManager) {
            window.siteIdentityManager.updateUI();
          }
        }
      });
    } catch (e) { }

    // Testing Shortcut: Ctrl+Shift+O to force-open the Offline Game (v0.2.1)
    window.require('electron').ipcRenderer.on('trigger-offline-game', () => {
      const tab = this.getActiveTab();
      if (tab) {
        const offlinePath = `file://${window.require('path').join(__dirname, 'offline.html')}?url=${encodeURIComponent(tab.url || 'https://google.com')}`;
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

  show(title, msg, durationMs = 8000) {
    if (!this.el) return;
    this.el.querySelector('.leef-toast-title').textContent = title;
    this.el.querySelector('.leef-toast-msg').textContent = msg;

    // Reset action div visibility so buttons don't leak between toasts
    const actionDiv = document.getElementById('leef-toast-action');
    if (actionDiv) actionDiv.style.display = 'none';

    this.el.classList.add('visible');
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.hide(), durationMs);
  }

  hide() {
    if (!this.el) return;
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
    this.bindEvents();
  }

  bindEvents() {
    if (this.el) {
      this.el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.dropdown.style.display = this.dropdown.style.display === 'none' ? 'block' : 'none';
        // Close other dropdowns
        const b = document.getElementById('bookmarks-dropdown');
        if (b) b.style.display = 'none';
      });
    }

    // Global close
    document.addEventListener('click', (e) => {
      if (this.dropdown && !this.dropdown.contains(e.target) && e.target !== this.el) {
        this.dropdown.style.display = 'none';
      }
    });

    window.require('electron').ipcRenderer.on('download-status', (event, data) => {
      if (data.status === 'started') {
        this.downloads.set(data.id, { ...data, received: 0 });
        this.renderItem(data.id);
        // Show dropdown when download starts
        this.dropdown.style.display = 'block';
      } else if (data.status === 'progressing') {
        const dl = this.downloads.get(data.id);
        if (dl) {
          dl.received = data.received;
          this.updateItemProgress(data.id);
        }
      } else if (data.status === 'completed') {
        const dl = this.downloads.get(data.id);
        if (dl) {
          dl.status = 'completed';
          dl.path = data.path;
          this.renderItem(data.id);
          this.updateToolbarProgress();
        }
      } else if (data.status === 'failed' || data.status === 'interrupted') {
        const dl = this.downloads.get(data.id);
        if (dl) {
          dl.status = 'failed';
          this.renderItem(data.id);
          this.updateToolbarProgress();
        }
      }
    });
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
    const progress = dl.total > 0 ? Math.round((dl.received / dl.total) * 100) : 0;

    itemEl.innerHTML = `
      <div class="download-info">
        <span class="download-name" title="${dl.name}">${dl.name}</span>
        <span class="download-percent">${isDone ? 'Finished' : progress + '%'}</span>
      </div>
      <div class="download-progress-container" style="display: ${isDone ? 'none' : 'block'}">
        <div class="download-progress-bar" id="pb-${id}" style="width: ${progress}%"></div>
      </div>
      <div class="download-actions" style="display: ${isDone ? 'flex' : 'none'}">
        <button class="settings-btn" style="padding: 4px 10px; font-size: 0.75rem;" onclick="window.require('electron').ipcRenderer.send('show-item-in-folder', '${dl.path.replace(/\\/g, '\\\\')}')">Open Folder</button>
      </div>
    `;
  }

  updateItemProgress(id) {
    const dl = this.downloads.get(id);
    const progress = dl.total > 0 ? Math.round((dl.received / dl.total) * 100) : 0;
    const pb = document.getElementById(`pb-${id}`);
    const percent = document.querySelector(`#dl-${id} .download-percent`);
    if (pb) pb.style.width = progress + '%';
    if (percent) percent.textContent = progress + '%';
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
        const isVisible = this.dropdown.style.display === 'grid';
        this.dropdown.style.display = isVisible ? 'none' : 'grid';

        if (!isVisible) this.updateUI();

        // Close other dropdowns
        const b = document.getElementById('bookmarks-dropdown');
        if (b) b.style.display = 'none';
        const d = document.getElementById('downloads-dropdown');
        if (d) d.style.display = 'none';
      });
    }

    // Global close
    document.addEventListener('click', (e) => {
      if (this.dropdown && !this.dropdown.contains(e.target) && e.target !== this.el) {
        this.dropdown.style.display = 'none';
      }
    });

    if (this.btnChangelog) {
      this.btnChangelog.addEventListener('click', () => {
        if (window.tabManager) window.tabManager.createTab('changelog');
        this.dropdown.style.display = 'none';
      });
    }

    if (this.btnSettings) {
      this.btnSettings.addEventListener('click', () => {
        if (window.tabManager) window.tabManager.createTab('settings');
        this.dropdown.style.display = 'none';
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

              const observer = new MutationObserver(mutations => {
                mutations.forEach(m => {
                  m.addedNodes.forEach(n => {
                    if (n.tagName === 'VIDEO' || n.tagName === 'AUDIO') routeMedia(n);
                    if (n.querySelectorAll) n.querySelectorAll('video, audio').forEach(routeMedia);
                  });
                });
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
        this.dropdown.style.display = 'none';
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
        this.dropdown.style.display = 'none';
        const confirmed = window.confirm(
          "Generating a bug report will save a diagnostics file to your PC.\n\n" +
          "This file contains system specs and configurations to help with bug reports. " +
          "It will NEVER leave your PC unless you manually choose to share it.\n\n" +
          "Do you want to proceed and generate the Bug Report log?"
        );
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
  }
}

class SiteIdentityManager {
  constructor() {
    this.btnGlobe = document.getElementById('btn-site-identity');
    this.dropdown = document.getElementById('site-identity-dropdown');
    this.domainEl = document.getElementById('si-domain');
    this.statusEl = document.getElementById('si-status');
    this.adblockCountEl = document.getElementById('si-adblock-count');
    this.btnClearCookies = document.getElementById('btn-clear-site-cookies');

    this.bindEvents();
  }

  bindEvents() {
    if (this.btnGlobe) {
      this.btnGlobe.addEventListener('click', (e) => {
        e.stopPropagation();
        this.dropdown.style.display = this.dropdown.style.display === 'none' ? 'block' : 'none';
        // Close others
        const d1 = document.getElementById('bookmarks-dropdown');
        const d2 = document.getElementById('downloads-dropdown');
        const d3 = document.getElementById('quick-settings-dropdown');
        if (d1) d1.style.display = 'none';
        if (d2) d2.style.display = 'none';
        if (d3) d3.style.display = 'none';

        this.updateUI();
      });
    }

    document.addEventListener('click', (e) => {
      if (this.dropdown && !this.dropdown.contains(e.target) && e.target !== this.btnGlobe && !this.btnGlobe.contains(e.target)) {
        this.dropdown.style.display = 'none';
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
          this.dropdown.style.display = 'none';
        } catch (e) { }
      });
    }
  }

  updateUI() {
    if (!window.tabManager) return;
    const tab = window.tabManager.getActiveTab();
    if (!tab) return;

    if (tab.isInternal) {
      if (this.domainEl) this.domainEl.textContent = 'Leef Browser';
      if (this.statusEl) {
        this.statusEl.textContent = 'Local Application Page';
        this.statusEl.style.color = '#777';
      }
      if (this.adblockCountEl) this.adblockCountEl.textContent = '0';
    } else {
      try {
        const urlObj = new URL(tab.url);
        if (this.domainEl) this.domainEl.textContent = urlObj.hostname;

        if (urlObj.protocol === 'https:') {
          if (this.statusEl) {
            this.statusEl.textContent = 'Connection is secure';
            this.statusEl.style.color = '#4caf50';
          }
        } else {
          if (this.statusEl) {
            this.statusEl.textContent = 'Connection is NOT secure';
            this.statusEl.style.color = '#f44336';
          }
        }

        // Adblock stats logic (using tab.blockedAds array if we had one, but let's mock it for MVP or use 0)
        if (this.adblockCountEl) this.adblockCountEl.textContent = tab.blockedAds || '0';

      } catch (e) {
        if (this.domainEl) this.domainEl.textContent = 'Unknown';
      }
    }
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

    // Bind individual flags
    const chkSafe = document.getElementById('flag-force-safe-off');
    if (chkSafe) {
      chkSafe.addEventListener('change', (e) => {
        this.flags.force_safe_off = e.target.checked;
        this.saveFlags();
      });
    }
  }

  syncUI() {
    const chkSafe = document.getElementById('flag-force-safe-off');
    if (chkSafe) chkSafe.checked = !!this.flags.force_safe_off;
  }

  isFlagEnabled(key) {
    return !!this.flags[key];
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
    setInterval(() => this.update(), 1000);
  }

  update() {
    const now = new Date();
    const hours = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, '0');

    if (this.clockEl) this.clockEl.textContent = `${hours % 12 || 12}:${minutes}`;

    if (this.greetingEl) {
      let greet = 'Good Evening';
      if (hours < 12) greet = 'Good Morning';
      else if (hours < 17) greet = 'Good Afternoon';
      else if (hours > 21) greet = 'Good Night';
      this.greetingEl.textContent = greet;
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

    this.selectedIndex = -1;
    this.currentFetchCtrl = null;
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

    this.input.addEventListener('input', () => this.showSuggestions());
    this.input.addEventListener('keydown', (e) => this.handleKeydown(e));
    this.input.addEventListener('blur', () => {
      setTimeout(() => { this.suggestionsEl.style.display = 'none'; }, 200);
    });
    this.input.addEventListener('focus', () => this.showSuggestions());
  }

  async showSuggestions() {
    const val = this.input.value.trim();
    if (!val) {
      this.suggestionsEl.style.display = 'none';
      return;
    }

    this.updatePosition();

    // 1. Local Bookmarks (Fast)
    const lowerVal = val.toLowerCase();
    const bookmarkMatches = this.bookmarksManager.saved.filter(b =>
      b.title.toLowerCase().includes(lowerVal) || b.url.toLowerCase().includes(lowerVal)
    ).slice(0, 3); // Max 3 bookmarks

    // If autocomplete is disabled, render immediately and stop
    const settings = window.tabManager ? window.tabManager.settings : null;
    const isLiveEnabled = settings ? settings.currentSettings.liveAutocomplete : false;

    if (!isLiveEnabled) {
      this.renderSuggestions(val, bookmarkMatches, []);
      this.suggestionsEl.style.display = 'block';
      return;
    }

    this.renderSuggestions(val, bookmarkMatches, []);
    this.suggestionsEl.style.display = 'block';

    // 2. Fetch Live Autocomplete from Main Process (Bypass CORS)
    try {
      const webSuggestions = await window.require('electron').ipcRenderer.invoke('fetch-autocomplete', val);

      // Re-render with both bookmarks and web suggestions
      if (this.input.value.trim() === val) { // Prevent race conditions
        this.renderSuggestions(val, bookmarkMatches, webSuggestions.slice(0, 6));
      }
    } catch (err) {
      // Ignore abort errors or offline
    }
  }

  renderSuggestions(val, bookmarkMatches, webSuggestions) {
    this.suggestionsEl.innerHTML = '';
    this.selectedIndex = -1;

    // Helper to add items
    const addItem = (title, url, iconHtml, isWeb) => {
      const item = document.createElement('div');
      item.className = 'suggestion-item';
      item.innerHTML = iconHtml + '<div class="suggestion-info"><div class="suggestion-title">' + BrowserUtils.sanitize(title) + '</div><div class="suggestion-url" style="' + (isWeb ? 'display:none;' : '') + '">' + BrowserUtils.sanitize(url) + '</div></div>';

      item.addEventListener('click', () => {
        if (window.tabManager) window.tabManager.navigateToUrl(url || title); // URL for bookmarks, title for queries
        this.suggestionsEl.style.display = 'none';
      });

      this.suggestionsEl.appendChild(item);
    };

    // 1. Fallback / Current Input (Search for...)
    addItem('Search for "' + val + '"', val, '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 10px; opacity: 0.6; flex-shrink: 0;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>', true);

    // 2. Bookmarks
    bookmarkMatches.forEach(match => {
      let faviconUrl = '';
      try { faviconUrl = 'https://www.google.com/s2/favicons?domain=' + new URL(match.url).hostname + '&sz=32'; } catch (e) { }
      const icon = '<img class="suggestion-favicon" src="' + faviconUrl + '" onerror="this.style.display=\'none\'">';
      addItem(match.title, match.url, icon, false);
    });

    // 3. Web Autocomplete
    webSuggestions.forEach(suggestion => {
      if (suggestion.toLowerCase() === val.toLowerCase()) return; // Skip if it's identical to the fallback
      const icon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 10px; opacity: 0.6; flex-shrink: 0;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';
      addItem(suggestion, suggestion, icon, true);
    });
  }

  handleKeydown(e) {
    const items = this.suggestionsEl.querySelectorAll('.suggestion-item');
    if (this.suggestionsEl.style.display === 'none' || items.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.selectedIndex = (this.selectedIndex + 1) % items.length;
      this.updateSelection(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.selectedIndex = (this.selectedIndex - 1 + items.length) % items.length;
      this.updateSelection(items);
    } else if (e.key === 'Enter' && this.selectedIndex !== -1) {
      e.preventDefault();
      items[this.selectedIndex].click();
    }
  }

  updateSelection(items) {
    items.forEach((item, i) => {
      item.classList.toggle('selected', i === this.selectedIndex);
    });
    if (this.selectedIndex !== -1) {
      const urlEl = items[this.selectedIndex].querySelector('.suggestion-url');
      const titleEl = items[this.selectedIndex].querySelector('.suggestion-title');
      // If it's a web suggestion, fill input with the title (query). If bookmark, fill with URL.
      this.input.value = urlEl.style.display === 'none' ? titleEl.textContent.replace(/^Search for "/, '').replace(/"$/, '') : urlEl.textContent;
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

    this.bindEvents();
  }

  bindEvents() {
    const ipc = window.require('electron').ipcRenderer;
    ipc.on('permission-request', (e, data) => {
      this.currentReqId = data.id;
      this.currentOrigin = data.origin;
      this.currentPermission = data.permission;

      this.originEl.textContent = data.origin;
      this.typeEl.textContent = data.permission;
      this.promptOverlay.style.display = 'flex';
      document.body.classList.add('modal-open');

      // Hide dynamic address bar suggestions so they don't overlap the modal
      if (window.addressBarManager && window.addressBarManager.suggestionsEl) {
        window.addressBarManager.suggestionsEl.style.display = 'none';
      }
    });

    if (this.btnAllow) this.btnAllow.addEventListener('click', () => this.handleResponse(true));
    if (this.btnDeny) this.btnDeny.addEventListener('click', () => this.handleResponse(false));

    // Manager bindings
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
        const url = prompt("Enter the origin URL (e.g., https://discord.com):");
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
    if (this.currentReqId !== null) {
      window.require('electron').ipcRenderer.send('permission-response', {
        id: this.currentReqId,
        granted
      });
      this.updateSetting(this.currentOrigin, this.currentPermission, granted);
      this.currentReqId = null;
    }
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
    if (window.addressBarManager && window.addressBarManager.suggestionsEl) {
      window.addressBarManager.suggestionsEl.style.display = 'none';
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
      if (perms[origin].media !== undefined) checks.push(`Media: ${perms[origin].media ? 'Allow' : 'Block'}`);
      if (perms[origin].geolocation !== undefined) checks.push(`Location: ${perms[origin].geolocation ? 'Allow' : 'Block'}`);
      if (perms[origin].notifications !== undefined) checks.push(`Notifs: ${perms[origin].notifications ? 'Allow' : 'Block'}`);

      row.innerHTML = `
        <div style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          <strong style="font-size: 0.9rem;">${origin}</strong>
          <div style="font-size: 0.75rem; color: #666;">${checks.join(', ')}</div>
        </div>
        <button class="bookmark-delete" style="opacity: 1; font-size: 1.2rem; cursor: pointer; border: none; background: transparent; padding: 5px;" title="Remove rules">×</button>
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

// --- BOOTSTRAP ---
window.onload = () => {
  // ToastManager must be first so all other managers can use it
  window.toastManager = new ToastManager();

  const settingsMgr = new SettingsManager();

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

      document.getElementById('btn-onboarding-finish').addEventListener('click', () => {
        const aiChecked = document.getElementById('onboard-ai').checked;
        const autoChecked = document.getElementById('onboard-autocomplete').checked;
        const adblockVal = document.querySelector('input[name="onboard-adblock-tier"]:checked')?.value || 'none';
        const langVal = document.getElementById('onboard-language').value;

        // Sync to actual settings DOM
        const blockAiEl = document.getElementById('block-ai');
        if (blockAiEl) blockAiEl.checked = aiChecked;

        const autoEl = document.getElementById('live-autocomplete');
        if (autoEl) autoEl.checked = autoChecked;

        const langEl = document.getElementById('language-select');
        if (langEl) langEl.value = langVal;

        // Adblock is radio buttons ('none', 'basic', 'comprehensive')
        document.querySelectorAll('input[name="adblock-tier"]').forEach(r => {
          r.checked = r.value === adblockVal;
        });

        settingsMgr.saveSettings();

        localStorage.setItem('leef_onboarding_done', 'true');
        overlay.style.display = 'none';
        if (bg) bg.style.display = 'none';
      });
    }
  }

  window.permissionManager = new PermissionManager(settingsMgr);
  window.tabManager = new TabManager(settingsMgr);
  const bookmarksMgr = new BookmarksManager();
  const hubMgr = new HubManager();
  window.newsSvc = new NewsService();

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

  // Labs/Experimental
  window.labsManager = new LabsManager();

  // Downloads
  window.downloadManager = new DownloadManager();

  // Address Bar & Home Search Suggestions
  const addressInput = document.getElementById('address-input');
  if (addressInput) window.addressBarManager = new AddressBarManager(bookmarksMgr, addressInput);
  if (homeSearch) window.homeSearchManager = new AddressBarManager(bookmarksMgr, homeSearch);

  // Hero Section (Clock/Greeting)
  window.heroManager = new HeroManager();

  // Quick Settings Menu
  window.quickSettingsManager = new QuickSettingsManager();

  // Site Identity Menu
  window.siteIdentityManager = new SiteIdentityManager();

  // Startup behavior
  const startup = settingsMgr.currentSettings.startup || 'newtab';

  if (startup === 'continue') {
    let lastTabs = [];
    try { lastTabs = JSON.parse(localStorage.getItem('leef_last_tabs') || '[]'); } catch (e) { }
    if (lastTabs.length > 0) {
      lastTabs.forEach(url => window.tabManager.createTab(url));
    } else {
      window.tabManager.createTab('home');
    }
  } else if (startup === 'homepage') {
    const homepage = settingsMgr.currentSettings.customNewTab || 'home';
    window.tabManager.createTab(homepage);
  } else {
    window.tabManager.createTab('home');
  }

  // Persist tabs on close for 'continue' mode
  window.addEventListener('beforeunload', () => {
    const urls = window.tabManager.tabs
      .filter(t => !t.isInternal)
      .map(t => t.url);
    localStorage.setItem('leef_last_tabs', JSON.stringify(urls));
  });
};
