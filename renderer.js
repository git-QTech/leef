/**
 * Leef Browser 
 * Renderer Process Core Architecture
 */

// --- UTILITIES ---
class BrowserUtils {
  static parseAddress(str, engineBaseUrl, blockAI = true) {
    str = str.trim();
    const domainPattern = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:\/.*)?$/;
    if (!str.includes(' ') && (domainPattern.test(str) || str.startsWith('http://') || str.startsWith('https://') || str.startsWith('localhost:'))) {
      if (!str.startsWith('http://') && !str.startsWith('https://')) return 'https://' + str;
      return str;
    }
    
    // AI Overview Blocking for Google (Seamless)
    if (blockAI && engineBaseUrl.includes('google.com/search') && !str.toLowerCase().includes('-noai')) {
      str += ' -noai';
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
      adBlocker: true,
      backgroundLimit: true,
      allowNotifications: true,
      askDownload: false,
      blockAIOverview: true,
      customUa: '',
      dohToggle: false,
      proxyUrl: ''
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
      return { ...this.defaultSettings, ...saved };
    } catch(e) {
      return { ...this.defaultSettings };
    }
  }

  syncUIToSettings() {
    const s = this.currentSettings;
    const el = id => document.getElementById(id);
    if (el('search-engine-select')) el('search-engine-select').value = s.searchEngine;
    if (el('language-select')) el('language-select').value = s.language;
    if (el('zoom-select')) el('zoom-select').value = s.zoom;
    if (el('font-size-select')) el('font-size-select').value = s.fontSize;
    if (el('https-only')) el('https-only').checked = s.httpsOnly;
    if (el('ad-blocker')) el('ad-blocker').checked = s.adBlocker;
    if (el('background-limit')) el('background-limit').checked = s.backgroundLimit;
    if (el('allow-notifications')) el('allow-notifications').checked = s.allowNotifications;
    if (el('ask-download')) el('ask-download').checked = s.askDownload;
    if (el('block-ai')) el('block-ai').checked = s.blockAIOverview;
    if (el('custom-ua')) el('custom-ua').value = s.customUa || '';
    if (el('doh-toggle')) el('doh-toggle').checked = s.dohToggle;
    if (el('proxy-url')) el('proxy-url').value = s.proxyUrl || '';
    document.querySelectorAll(`input[name="startup"]`).forEach(r => { r.checked = r.value === s.startup; });
    document.querySelectorAll(`input[name="tracking"]`).forEach(r => { r.checked = r.value === s.tracking; });
  }

  sendSettingsToMain() {
    // Send current settings to the main process so network rules apply on startup
    try {
      window.require('electron').ipcRenderer.send('apply-settings', this.currentSettings);
    } catch(e) { console.log('IPC not available', e); }
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

    // Auto-save settings on change (debounced to avoid hammering IPC)
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
          if (window.toastManager) window.toastManager.show('🧹 Data Cleared', 'Your browsing history, cache, and cookies have been cleared securely.', 5000);
        } catch(e){}
      });
    }
    if (UI.buttons.defaultBrowser) {
      UI.buttons.defaultBrowser.addEventListener('click', () => {
        try {
          window.require('electron').ipcRenderer.send('set-default-browser');
          if (window.toastManager) window.toastManager.show('✅ Default Browser Set', 'Leef is now your default browser for http and https links.', 5000);
        } catch(e){}
      });
    }
  }

  saveSettings() {
    if(!document.getElementById('search-engine-select')) return; // safety
    this.currentSettings = {
      searchEngine: document.getElementById('search-engine-select').value,
      startup: document.querySelector('input[name="startup"]:checked')?.value || 'newtab',
      language: document.getElementById('language-select').value,
      zoom: document.getElementById('zoom-select').value,
      fontSize: document.getElementById('font-size-select').value,
      tracking: document.querySelector('input[name="tracking"]:checked')?.value || 'standard',
      httpsOnly: document.getElementById('https-only').checked,
      adBlocker: document.getElementById('ad-blocker').checked,
      backgroundLimit: document.getElementById('background-limit').checked,
      allowNotifications: document.getElementById('allow-notifications').checked,
      askDownload: document.getElementById('ask-download').checked,
      blockAIOverview: document.getElementById('block-ai').checked,
      customUa: document.getElementById('custom-ua').value,
      dohToggle: document.getElementById('doh-toggle').checked,
      proxyUrl: document.getElementById('proxy-url').value
    };
    
    this.applyVisualSettings();
    
    try {
      // Persist to localStorage AND send to main process
      localStorage.setItem('leef_settings', JSON.stringify(this.currentSettings));
      window.require('electron').ipcRenderer.send('apply-settings', this.currentSettings);
      if (window.toastManager) window.toastManager.show('⚙️ Settings Saved', 'Your preferences have been applied.', 3000);
    } catch (e) { console.log("IPC not available", e); }
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
    } catch(e) {}
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
      try { faviconUrl = bm.url.includes('http') ? `https://www.google.com/s2/favicons?domain=${new URL(bm.url).hostname}&sz=32` : ''; } catch(e) {}
      
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
    this.render();
  }

  loadTiles() {
    try {
      const saved = JSON.parse(localStorage.getItem('leef_hub_tiles'));
      if (saved && saved.length > 0) return saved;
    } catch(e) {}
    return [...this.defaults];
  }

  saveTiles() {
    localStorage.setItem('leef_hub_tiles', JSON.stringify(this.tiles));
  }

  render() {
    if (!this.gridEl) return;
    this.gridEl.innerHTML = '';
    this.tiles.forEach((tile, i) => {
      const el = document.createElement('div');
      el.className = `hub-tile ${tile.cls || 'hub-tile-custom'}`;
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
    const overlay = document.getElementById('hub-add-modal');
    const nameInput = document.getElementById('hub-add-name');
    const urlInput = document.getElementById('hub-add-url');
    const btnConfirm = document.getElementById('hub-add-confirm');
    const btnCancel = document.getElementById('hub-add-cancel');
    if (!overlay) return;

    // Reset and show
    nameInput.value = '';
    urlInput.value = '';
    overlay.style.display = 'flex';
    nameInput.focus();

    // Clean up old listeners to prevent stacking
    const newConfirm = btnConfirm.cloneNode(true);
    const newCancel = btnCancel.cloneNode(true);
    const newUrlInput = urlInput.cloneNode(true);
    const newOverlay = overlay.cloneNode(true);
    
    btnConfirm.parentNode.replaceChild(newConfirm, btnConfirm);
    btnCancel.parentNode.replaceChild(newCancel, btnCancel);
    urlInput.parentNode.replaceChild(newUrlInput, urlInput);
    overlay.parentNode.replaceChild(newOverlay, overlay);

    const close = () => { newOverlay.style.display = 'none'; };

    newCancel.addEventListener('click', close);
    newConfirm.addEventListener('click', () => {
      const name = nameInput.value.trim();
      const url = newUrlInput.value.trim();
      if (!name || !url) {
        if (window.toastManager) window.toastManager.show('⚠️ Missing Info', 'Please enter both a name and URL.', 3000);
        return;
      }
      const fullUrl = url.startsWith('http') ? url : 'https://' + url;
      this.tiles.push({ name, url: fullUrl, cls: 'hub-tile-custom' });
      this.saveTiles();
      this.render();
      close();
      if (window.toastManager) window.toastManager.show('✅ Tile Added', `"${name}" has been added to your Hub.`, 4000);
    });

    // Allow Enter key to submit
    newUrlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') newConfirm.click();
    });
    // Allow clicking overlay backdrop to cancel
    newOverlay.addEventListener('click', (e) => {
      if (e.target === newOverlay) close();
    });
    
    newOverlay.style.display = 'flex';
    nameInput.focus();
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
          } catch(e) { container.innerHTML = '<p style="opacity: 0.6; padding-left: 10px;">Failed to parse latest news.</p>'; }
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
      // No more items — just remove the card
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
    
    this.bindGlobalEvents();
  }

  getActiveTab() {
    return this.tabs.find(t => t.id === this.activeTabId);
  }

  applyZoomToAll(zoom) {
    this.tabs.forEach(t => {
      if (t.webviewEl && typeof t.webviewEl.setZoomFactor === 'function') {
        try { t.webviewEl.setZoomFactor(zoom); } catch(e){}
      }
    });
  }

  createTab(route = 'home') {
    const tabId = 'tab-' + this.tabCounter++;
    const isInternal = ['home', 'settings', 'changelog', 'credits'].includes(route);
    
    const tabEl = document.createElement('div');
    tabEl.className = 'tab';
    tabEl.id = tabId;
    
    const tabTitle = document.createElement('div');
    tabTitle.className = 'tab-title';
    tabTitle.textContent = route === 'home' ? 'Leef Browser | Home' : (route === 'settings' ? 'Settings' : (route === 'changelog' ? "What's New" : (route === 'credits' ? 'Credits' : 'Loading...')));
    
    const tabClose = document.createElement('button');
    tabClose.className = 'tab-close';
    tabClose.innerHTML = '×';
    
    tabEl.appendChild(tabTitle);
    tabEl.appendChild(tabClose);
    UI.tabsContainer.insertBefore(tabEl, UI.buttons.newTab);
    
    const tabObj = {
      id: tabId,
      url: route, // 'home', 'settings', 'changelog', or 'https://...'
      title: tabTitle.textContent,
      tabEl,
      tabTitle,
      webviewEl: null, // Lazy loaded
      canGoBack: false,
      canGoForward: false,
      isInternal: isInternal
    };
    
    this.tabs.push(tabObj);

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
    tabClose.addEventListener('click', () => this.closeTab(tabId));
    
    this.switchTab(tabId);
  }

  mountWebview(tab) {
    if (tab.webviewEl) return; // Already exists
    tab.webviewEl = document.createElement('webview');
    tab.webviewEl.id = 'webview-' + tab.id;
    UI.views.webviewsContainer.appendChild(tab.webviewEl);
    
    tab.webviewEl.addEventListener('did-start-loading', () => {
      tab.title = 'Loading...';
      tab.url = tab.webviewEl.src;
      this.updateTabUI(tab);
    });
    
    tab.webviewEl.addEventListener('did-stop-loading', () => {
      tab.title = tab.webviewEl.getTitle() || tab.url;
      tab.url = tab.webviewEl.getURL();
      tab.canGoBack = tab.webviewEl.canGoBack();
      tab.canGoForward = tab.webviewEl.canGoForward();
      if (typeof tab.webviewEl.setZoomFactor === 'function') {
         try { tab.webviewEl.setZoomFactor(parseFloat(this.settings.currentSettings.zoom) || 1.0); } catch(e){}
      }
      this.updateTabUI(tab);
      
      // Seamless AI Overview Blocking: Clean up the on-page Google Search UI
      if (this.settings.currentSettings.blockAIOverview && tab.url.includes('google.com')) {
        tab.webviewEl.executeJavaScript(`
          (function() {
            const hookInputs = () => {
              const inputs = document.querySelectorAll('input[name="q"], textarea[name="q"]');
              inputs.forEach(input => {
                if (input.dataset.noaiHooked) return;
                input.dataset.noaiHooked = "true";
                
                const proto = Object.getPrototypeOf(input);
                const descriptor = Object.getOwnPropertyDescriptor(proto, 'value') || 
                                   Object.getOwnPropertyDescriptor(input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value');
                
                if (descriptor) {
                  Object.defineProperty(input, 'value', {
                    get: function() {
                      let val = descriptor.get.call(this);
                      return val ? val.replace(/( ?)-noai/gi, '') : val;
                    },
                    set: function(val) {
                      if (val && typeof val === 'string') val = val.replace(/( ?)-noai/gi, '');
                      descriptor.set.call(this, val);
                    }
                  });
                  // Clean whatever is currently there natively
                  descriptor.set.call(input, descriptor.get.call(input).replace(/( ?)-noai/gi, ''));
                }
              });
            };
            hookInputs();
            // Lightweight check for dynamic element replacements
            setInterval(hookInputs, 1000); 

            // Prevent Google from submitting batched AJAX queries that bypass our Network filter
            const triggerSearch = (query) => {
              if (!query) return;
              if (!query.toLowerCase().includes('-noai')) query += ' -noai';
              window.location.href = '/search?q=' + encodeURIComponent(query);
            };

            // Intercept Enter key
            document.addEventListener('keydown', (e) => {
              if (e.key === 'Enter' && e.target.name === 'q') {
                e.stopPropagation();
                e.preventDefault();
                triggerSearch(e.target.value);
              }
            }, true);
            
            // Intercept Search Button click
            document.addEventListener('click', (e) => {
              const btn = e.target.closest('button[aria-label="Google Search"], input[value="Google Search"]');
              if (btn) {
                const input = document.querySelector('input[name="q"], textarea[name="q"]');
                if (input) {
                  e.stopPropagation();
                  e.preventDefault();
                  triggerSearch(input.value);
                }
              }
            }, true);
          })();
        `);
      }

      // Show YouTube quality warning toast once per session
      if (window.toastManager && tab.url && tab.url.includes('youtube.com')) {
        window.toastManager.showOnce(
          'youtube-4k',
          'YouTube Performance Warning',
          'Streaming above 1440p may slow down Leef. Fullscreen may also show a border due to browser limitations.'
        );
      }
    });

    // Right-Click Context Menu for Webviews
    tab.webviewEl.addEventListener('context-menu', (e) => {
      e.preventDefault();
      try {
        window.require('electron').ipcRenderer.send('show-context-menu', e.params);
      } catch(err) {}
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
    else if (tab.url === 'credits') tab.tabTitle.textContent = "Credits";
    else tab.tabTitle.textContent = tab.title;

    if (this.activeTabId === tab.id) {
      if (!tab.isInternal) {
        // Strip -noai from the address bar for a seamless display
        let displayUrl = tab.url;
        if (this.settings.currentSettings.blockAIOverview && displayUrl.includes('google.com/search')) {
           displayUrl = displayUrl.replace(/(\+|\%20)-noai/g, '');
        }
        UI.inputs.address.value = displayUrl;
      }
      else UI.inputs.address.value = '';
    }
  }

  switchTab(tabId) {
    const prevTabId = this.activeTabId;
    this.activeTabId = tabId;
    const tab = this.getActiveTab();
    if (!tab) return;
    
    // Only suspend the previously active tab (not all tabs — avoids O(n) executeJavaScript calls)
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
        } catch(e) {}
      }
    }

    // Update tab strip UI
    this.tabs.forEach(t => {
      t.tabEl.classList.remove('active');
      if (t.webviewEl) t.webviewEl.classList.remove('active');
    });
    tab.tabEl.classList.add('active');

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
      } catch(e) {}
    }
    
    // Manage Views
    UI.views.home.style.display = tab.url === 'home' ? 'flex' : 'none';
    UI.views.settings.style.display = tab.url === 'settings' ? 'flex' : 'none';
    UI.views.changelog.style.display = tab.url === 'changelog' ? 'flex' : 'none';
    UI.views.credits.style.display = tab.url === 'credits' ? 'flex' : 'none';
    
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
    UI.buttons.newTab.addEventListener('click', () => this.createTab('home'));
    
    if (UI.buttons.settings) UI.buttons.settings.addEventListener('click', () => this.createTab('settings'));
    if (UI.buttons.whatsNew) UI.buttons.whatsNew.addEventListener('click', () => this.createTab('changelog'));
    if (UI.buttons.credits) UI.buttons.credits.addEventListener('click', () => this.createTab('credits'));

    // Handle Context Menu commands from Main Process
    try {
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
        }
      });
    } catch(e) {}

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
      } catch(err) {}
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

// --- BOOTSTRAP ---
window.onload = () => {
  // ToastManager must be first so all other managers can use it
  window.toastManager = new ToastManager();

  const settingsMgr = new SettingsManager();
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

  // Startup behavior
  const startup = settingsMgr.currentSettings.startup || 'newtab';

  if (startup === 'continue') {
    let lastTabs = [];
    try { lastTabs = JSON.parse(localStorage.getItem('leef_last_tabs') || '[]'); } catch(e) {}
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
