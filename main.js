import { app, BrowserWindow, session, ipcMain, Menu, MenuItem, clipboard, nativeImage } from 'electron';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { ElectronBlocker } from '@ghostery/adblocker-electron';
import fetch from 'cross-fetch';

// SET IDENTITY AS EARLY AS POSSIBLE (Critical for Windows Taskbar)
app.name = 'Leef Browser';
app.setName('Leef Browser'); // Reinforce name for jump lists
if (process.platform === 'win32') {
  app.setAppUserModelId('com.quinn.leefbrowser');
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Fix "grayness" / color-shift on Windows — caused by GPU overlay planes
// using a different color pipeline than the rest of the compositor.
app.commandLine.appendSwitch('force-color-profile', 'srgb');
// Switch from D3D11 to OpenGL via ANGLE — fixes the color path mismatch
app.commandLine.appendSwitch('use-angle', 'gl');
// Disable overlay planes entirely so video goes through the same path as everything else
app.commandLine.appendSwitch('disable-features', 'DirectComposition,VideoToolboxVideoDecoder,UseSkiaRenderer');
app.commandLine.appendSwitch('disable-direct-composition');
app.commandLine.appendSwitch('disable-gpu-driver-bug-workarounds');

let mainWindow;
let blocker;
const permissionCallbacks = {};
let permReqId = 0;
let globalSettings = {};
let adblockerEnabled = false;
let adblockerLoading = false;

async function initAdBlocker(enabled = false) {
  const sess = session.fromPartition('persist:leef-session');

  if (!enabled) {
    if (blocker && adblockerEnabled) {
      blocker.disableBlockingInSession(sess);
      adblockerEnabled = false;
    }
    return;
  }

  if (adblockerEnabled || adblockerLoading) return; // Already setup or in progress
  adblockerLoading = true;

  const cachePath = path.join(app.getPath('userData'), 'adblock-engine-v3.bin');

  try {
    if (fs.existsSync(cachePath)) {
      blocker = await ElectronBlocker.deserialize(fs.readFileSync(cachePath));
      console.log('AdBlocker loaded from cache.');
    } else {
      if (mainWindow) mainWindow.webContents.send('adblock-status', 'syncing');
      const fetchWithTimeout = (url, timeout = 15000) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
      };

      const lists = [
        'https://easylist.to/easylist/easylist.txt',
        'https://easylist.to/easylist/easyprivacy.txt',
        'https://secure.fanboy.co.nz/fanboy-annoyance.txt',
        'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt',
        'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/annoyances.txt',
        'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/unbreak.txt',
        'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/badware.txt',
      ];

      console.log('AdBlocker: Downloading filter lists...');
      blocker = await ElectronBlocker.fromLists(fetchWithTimeout, lists);
      console.log('AdBlocker: Engine compiled successfully with', lists.length, 'lists.');

      fs.writeFileSync(cachePath, blocker.serialize());
      if (mainWindow) mainWindow.webContents.send('adblock-status', 'updated');
    }

    // Enable cosmetic filtering and IPC handlers (Once)
    blocker.enableBlockingInSession(sess);
    blocker.on('request-blocked', (request) => {
      if (mainWindow) mainWindow.webContents.send('adblock-item-blocked', { tabId: request.tabId, url: request.url });
    });
    adblockerEnabled = true;
  } catch (err) {
    console.error('AdBlocker error:', err);
    if (mainWindow) mainWindow.webContents.send('adblock-status', 'error');
  } finally {
    adblockerLoading = false;
  }
}

async function checkForUpdates(manual = false) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    const currentVersion = pkg.version;

    // Add an artificial delay for manual checks so the user actually sees the UI update
    if (manual) {
      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    const response = await fetch('https://api.github.com/repos/git-QTech/leef/releases', {
      headers: { 'User-Agent': 'Leef-Browser-Update-Checker' }
    });

    if (!response.ok) {
      throw new Error(`GitHub API returned status ${response.status}`);
    }

    const data = await response.json();
    if (!data || data.length === 0) {
      throw new Error('No releases found on GitHub');
    }

    const latestTag = data[0].tag_name; // e.g., "v0.1.6" or "Alpha"
    const releaseName = data[0].name || '';

    // Extract version number like 0.1.6 from either name or tag
    const versionMatch = releaseName.match(/(\d+\.\d+\.\d+)/) || latestTag.match(/(\d+\.\d+\.\d+)/);
    const latestVersion = versionMatch ? versionMatch[1] : latestTag.replace('v', '');

    if (latestVersion !== currentVersion) {
      if (mainWindow) mainWindow.webContents.send('update-available', {
        version: latestVersion,
        tag: latestTag
      });
    } else if (manual) {
      if (mainWindow) mainWindow.webContents.send('update-available', 'none');
    }
  } catch (err) {
    console.error('Update check failed:', err.message || err);
    if (manual && mainWindow) mainWindow.webContents.send('update-available', 'error');
  }
}

ipcMain.handle('fetch-autocomplete', async (event, query) => {
  try {
    const fetchUrl = 'https://suggestqueries.google.com/complete/search?client=chrome&q=' + encodeURIComponent(query);
    const response = await fetch(fetchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
    });
    if (!response.ok) return [];
    const data = await response.json();
    return data[1] || [];
  } catch (err) {
    console.error('Autocomplete fetch failed:', err);
    return [];
  }
});

function createWindow() {
  // Use pure in-memory partition for privacy
  const sess = session.fromPartition('persist:leef-session');

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true,
      webSecurity: true,
      session: sess
    },
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#5aef7e', // matches --topbar-bg in style.css exactly
      symbolColor: '#000000'
    },
    icon: path.join(__dirname, 'images/icon.png')
  });

  // Force icon update for Windows Taskbar
  if (process.platform === 'win32') {
    mainWindow.setIcon(path.join(__dirname, 'images/icon.png'));
  }

  // Decide if we are in dev or prod
  // For simplicity, we just load Vite's default dev server if running "npm run dev"
  // but if we are just running electron . we should load index.html
  mainWindow.loadFile('index.html');
  mainWindow.webContents.setMaxListeners(30);

  // Handle fullscreen requests from webviews (e.g. YouTube fullscreen button)
  // Using webContents events directly is the most reliable approach
  mainWindow.webContents.on('enter-html-full-screen', () => {
    mainWindow.setFullScreen(true);
  });
  mainWindow.webContents.on('leave-html-full-screen', () => {
    mainWindow.setFullScreen(false);
  });

  // mainWindow.webContents.openDevTools();
}

// Tracking domain lists
const AD_DOMAINS_STANDARD = [
  'doubleclick.net', 'google-analytics.com', 'googlesyndication.com',
  'facebook.net', 'analytics.twitter.com'
];
const AD_DOMAINS_STRICT = [
  ...AD_DOMAINS_STANDARD,
  'scorecardresearch.com', 'quantserve.com', 'taboola.com', 'outbrain.com',
  'adnxs.com', 'rubiconproject.com', 'openx.net', 'pubmatic.com',
  'criteo.com', 'amazon-adsystem.com', 'media.net', 'smartadserver.com',
  'hotjar.com', 'mouseflow.com', 'fullstory.com', 'mixpanel.com',
  'segment.com', 'heap.io', 'amplitude.com', 'intercom.io',
  'moatads.com', 'adsafeprotected.com', 'lijit.com', 'sovrn.com',
  'yimg.com', 'advertising.com', 'yieldmo.com', 'bounceexchange.com',
  'bluekai.com', 'exelator.com', 'tapad.com', 'liveramp.com'
];

ipcMain.on('apply-settings', async (event, settings) => {
  globalSettings = settings;
  const sess = session.fromPartition('persist:leef-session');

  let acceptLang = 'en-US,en';
  if (settings.language === 'fr') acceptLang = 'fr-FR,fr,en;q=0.9';
  if (settings.language === 'es') acceptLang = 'es-ES,es,en;q=0.9';
  if (settings.language === 'it') acceptLang = 'it-IT,it,en;q=0.9';

  // Custom User Agent & Language
  const ua = settings.customUa || sess.getUserAgent().replace(/Electron\/[0-9.]+\s/g, '');
  sess.setUserAgent(ua, acceptLang);

  // Initialize Ghostery if Comprehensive mode is selected — await so the handler
  // is installed before we apply the rest of the session rules.
  if (settings.adBlockerMode === 'comprehensive') {
    await initAdBlocker(true);
  } else {
    await initAdBlocker(false);
  }

  // Ad Blocking:
  // - Comprehensive mode: Ghostery owns onBeforeRequest via enableBlockingInSession. Don't touch it.
  // - Basic mode: Install our own domain-based handler.
  const blockList = settings.tracking === 'strict' ? AD_DOMAINS_STRICT : AD_DOMAINS_STANDARD;


  if (!adblockerEnabled) {
    // Only set our own handler if Ghostery isn't running
    sess.webRequest.onBeforeRequest(null);
    sess.webRequest.onBeforeRequest((details, callback) => {
      const url = details.url;
      if (settings.adBlockerMode === 'basic' || settings.tracking === 'strict') {
        try {
          const host = new URL(url).hostname;
          if (blockList.some(domain => host.includes(domain))) {
            return callback({ cancel: true });
          }
        } catch (e) { }
      }
      callback({ cancel: false });
    });
  }

  // HTTPS-Only + AI Blocking via onBeforeSendHeaders — works alongside Ghostery
  // because Ghostery only hooks onBeforeRequest, not onBeforeSendHeaders.
  sess.webRequest.onBeforeSendHeaders(null);
  sess.webRequest.onBeforeSendHeaders((details, callback) => {
    const url = details.url;

    // Strip SafeSearch enforcement headers
    const headers = details.requestHeaders;
    delete headers['X-SafeSearch-Enforced'];
    delete headers['X-Google-SafeSearch'];
    delete headers['X-Youtube-Edu-Filter'];
    delete headers['YouTube-Restrict'];
    delete headers['Accept-Language'];
    headers['Accept-Language'] = acceptLang;

    callback({ requestHeaders: headers });
  });

  // HTTPS-Only redirect + AI blocking via onBeforeRequest complement
  // We use a named filter to only target http:// navigations and google searches
  if (settings.httpsOnly || settings.blockAIOverview || settings.labs?.force_safe_off) {
    // These are handled by Ghostery's pipeline safely by hooking into
    // the webContents will-navigate event on the webview in renderer instead.
    // Signal renderer to apply these via IPC
    if (mainWindow) {
      mainWindow.webContents.send('apply-url-rules', {
        httpsOnly: settings.httpsOnly,
        blockAIOverview: settings.blockAIOverview,
        forceSafeOff: settings.labs?.force_safe_off
      });
    }
  }



  // Unified Permission Request Handler
  sess.setPermissionRequestHandler((webContents, permission, callback, details) => {
    let origin = '';
    try { origin = new URL(details.requestingUrl).origin; } catch (e) { }

    if (permission === 'notifications') {
      if (settings.sitePermissions && settings.sitePermissions[origin] && settings.sitePermissions[origin].notifications !== undefined) {
        return callback(settings.sitePermissions[origin].notifications);
      }
      return callback(settings.allowNotifications === true);
    }

    if (permission === 'media' || permission === 'geolocation') {
      if (settings.sitePermissions && settings.sitePermissions[origin] && settings.sitePermissions[origin][permission] !== undefined) {
        return callback(settings.sitePermissions[origin][permission]);
      }

      // Dynamic Prompt
      const reqId = ++permReqId;
      permissionCallbacks[reqId] = callback;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('permission-request', {
          id: reqId,
          permission,
          origin
        });
      } else {
        callback(false);
      }
    } else {
      callback(true); // allow other benign permissions
    }
  });

  // Proxy Settings
  if (settings.proxyUrl) {
    sess.setProxy({ proxyRules: settings.proxyUrl });
  } else {
    sess.setProxy({ proxyRules: 'direct://' });
  }
});

ipcMain.on('refresh-adblock', async () => {
  // Force re-download by deleting cache and re-initializing
  const cachePath = path.join(app.getPath('userData'), 'adblock-engine-v3.bin');
  if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath);
  adblockerEnabled = false;
  adblockerLoading = false;
  if (blocker) {
    try { blocker.disableBlockingInSession(session.fromPartition('persist:leef-session')); } catch (e) { }
    blocker = null;
  }
  if (mainWindow) mainWindow.webContents.send('adblock-status', 'syncing');
  await initAdBlocker(true);
  if (mainWindow) mainWindow.webContents.send('adblock-status', 'updated');
});

ipcMain.on('manual-update-check', () => {
  checkForUpdates(true);
});

ipcMain.on('permission-response', (event, data) => {
  if (permissionCallbacks[data.id]) {
    permissionCallbacks[data.id](data.granted);
    delete permissionCallbacks[data.id];
  }
});

ipcMain.on('show-context-menu', (event, params) => {
  const menu = new Menu();

  // Navigation Group
  menu.append(new MenuItem({
    label: 'Back',
    enabled: params.editFlags.canGoBack || params.canGoBack,
    click: () => event.sender.send('context-menu-command', { command: 'go-back' })
  }));
  menu.append(new MenuItem({
    label: 'Forward',
    enabled: params.editFlags.canGoForward || params.canGoForward,
    click: () => event.sender.send('context-menu-command', { command: 'go-forward' })
  }));
  menu.append(new MenuItem({
    label: 'Reload',
    click: () => event.sender.send('context-menu-command', { command: 'reload' })
  }));
  menu.append(new MenuItem({ type: 'separator' }));

  // Link actions
  if (params.linkURL) {
    menu.append(new MenuItem({
      label: 'Open Link in New Tab',
      click: () => event.sender.send('context-menu-command', { command: 'create-tab', url: params.linkURL })
    }));
    menu.append(new MenuItem({
      label: 'Copy Link Address',
      click: () => clipboard.writeText(params.linkURL)
    }));
    menu.append(new MenuItem({ type: 'separator' }));
  }

  // Image actions
  if (params.hasImageContents || params.mediaType === 'image') {
    menu.append(new MenuItem({
      label: 'Open Image in New Tab',
      click: () => event.sender.send('context-menu-command', { command: 'create-tab', url: params.srcURL })
    }));
    menu.append(new MenuItem({
      label: 'Copy Image',
      click: () => event.sender.send('context-menu-command', { command: 'copy-image', x: params.x, y: params.y })
    }));
    menu.append(new MenuItem({
      label: 'Copy Image Address',
      click: () => clipboard.writeText(params.srcURL)
    }));
    menu.append(new MenuItem({ type: 'separator' }));
  }

  // Text selection actions
  if (params.selectionText) {
    const cleanText = params.selectionText.trim();
    const displaySelection = cleanText.length > 15 ? cleanText.substring(0, 15) + '...' : cleanText;

    menu.append(new MenuItem({
      label: `Search Google for "${displaySelection}"`,
      click: () => event.sender.send('context-menu-command', { command: 'search-google', text: cleanText })
    }));
    menu.append(new MenuItem({ type: 'separator' }));

    menu.append(new MenuItem({ label: 'Copy', role: 'copy' }));
    menu.append(new MenuItem({
      label: 'Raw Copy (No formatting)',
      click: () => clipboard.writeText(cleanText)
    }));
    menu.append(new MenuItem({ type: 'separator' }));
  }

  // Input actions (if editable)
  if (params.isEditable) {
    menu.append(new MenuItem({ label: 'Cut', role: 'cut' }));
    menu.append(new MenuItem({ label: 'Copy', role: 'copy' }));
    menu.append(new MenuItem({ label: 'Paste', role: 'paste' }));
    menu.append(new MenuItem({ type: 'separator' }));
    menu.append(new MenuItem({ label: 'Select All', role: 'selectAll' }));
    menu.append(new MenuItem({ type: 'separator' }));
  }

  // Page Global Actions
  if (!params.selectionText && !params.linkURL && !params.mediaType) {
    menu.append(new MenuItem({
      label: 'Save Page As...',
      click: () => event.sender.send('context-menu-command', { command: 'save-page' })
    }));
    menu.append(new MenuItem({
      label: 'Print...',
      click: () => event.sender.send('context-menu-command', { command: 'print' })
    }));
    menu.append(new MenuItem({ type: 'separator' }));
    menu.append(new MenuItem({
      label: 'View Page Source',
      click: () => event.sender.send('context-menu-command', { command: 'view-source' })
    }));
  }

  menu.append(new MenuItem({
    label: 'Inspect Element',
    click: () => {
      event.sender.inspectElement(params.x, params.y);
      if (event.sender.isDevToolsOpened()) {
        event.sender.devToolsWebContents.focus();
      }
    }
  }));

  const win = BrowserWindow.fromWebContents(event.sender);
  menu.popup({ window: win });
});

ipcMain.on('show-tab-context-menu', (event, data) => {
  const menu = new Menu();

  menu.append(new MenuItem({
    label: 'Duplicate Tab',
    click: () => event.sender.send('tab-command', { command: 'duplicate', tabId: data.tabId })
  }));

  menu.append(new MenuItem({ type: 'separator' }));

  menu.append(new MenuItem({
    label: data.isPinned ? 'Unpin Tab' : 'Pin Tab',
    click: () => event.sender.send('tab-command', { command: 'toggle-pin', tabId: data.tabId })
  }));

  menu.append(new MenuItem({
    label: data.isMuted ? 'Unmute Tab' : 'Mute Tab',
    click: () => event.sender.send('tab-command', { command: 'toggle-mute', tabId: data.tabId })
  }));

  menu.append(new MenuItem({ type: 'separator' }));

  menu.append(new MenuItem({
    label: 'Close Tab',
    click: () => event.sender.send('tab-command', { command: 'close', tabId: data.tabId })
  }));

  menu.append(new MenuItem({
    label: 'Close Other Tabs',
    click: () => event.sender.send('tab-command', { command: 'close-others', tabId: data.tabId })
  }));

  const win = BrowserWindow.fromWebContents(event.sender);
  menu.popup({ window: win });
});

ipcMain.on('show-item-in-folder', (event, path) => {
  if (path) require('electron').shell.showItemInFolder(path);
});

ipcMain.on('clear-data', async () => {
  const sess = session.fromPartition('persist:leef-session');
  await sess.clearStorageData();
  await sess.clearCache();
});

ipcMain.on('clear-site-data', async (event, domain) => {
  if (!domain) return;
  const sess = session.fromPartition('persist:leef-session');
  try {
    const cookies = await sess.cookies.get({ domain });
    for (const cookie of cookies) {
      let url = (cookie.secure ? 'https://' : 'http://') + cookie.domain + cookie.path;
      // Strip leading dot from domain for the URL if present
      url = url.replace(/:\/\/\./, '://');
      await sess.cookies.remove(url, cookie.name);
    }
  } catch(e) {
    console.error('Failed to clear site cookies:', e);
  }
});

ipcMain.on('generate-bug-log', (event, data = {}) => {
  const settings = data.settings || {};
  const labs = data.labs || {};
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `leef-diagnostics-${timestamp}.txt`;
    const downloadsPath = app.getPath('downloads');
    const filePath = path.join(downloadsPath, filename);

    const cpuInfo = os.cpus();
    const cpuModel = cpuInfo.length > 0 ? cpuInfo[0].model : 'Unknown CPU';
    const cpuCores = cpuInfo.length;

    const logContent = `--------------------------------------------------
LEEF BROWSER DIAGNOSTICS LOG
Generated: ${new Date().toLocaleString()}
--------------------------------------------------

IMPORTANT SECURITY WARNING:
Do not share this file with anyone except the official bug report form:
https://forms.gle/upGc1dvPYaoBw4o96
or email it directly to: contact.qtech@proton.me

This file contains your browser settings and system configuration.
It DOES NOT contain your history, passwords, or personal data.

--------------------------------------------------
APPLICATION INFO
--------------------------------------------------
Leef Version: ${app.getVersion()}
Chrome: ${process.versions.chrome}
Electron: ${process.versions.electron}
Node: ${process.versions.node}
Platform: ${process.platform} (${process.arch})

--------------------------------------------------
SYSTEM INFO
--------------------------------------------------
OS: ${os.type()} ${os.release()}
Total Memory: ${(os.totalmem() / (1024 * 1024 * 1024)).toFixed(2)} GB
Free Memory: ${(os.freemem() / (1024 * 1024 * 1024)).toFixed(2)} GB
CPU: ${cpuModel} (${cpuCores} cores)

--------------------------------------------------
BROWSER SETTINGS
--------------------------------------------------
${JSON.stringify(settings, null, 2)}

--------------------------------------------------
LABS / EXPERIMENTAL FLAGS
--------------------------------------------------
${JSON.stringify(labs, null, 2)}

--------------------------------------------------
END OF LOG
--------------------------------------------------`;

    fs.writeFileSync(filePath, logContent, 'utf8');
    event.sender.send('bug-log-generated', { success: true, filename });
  } catch (error) {
    console.error('Failed to generate bug log:', error);
    event.sender.send('bug-log-generated', { success: false, error: error.message });
  }
});

ipcMain.on('capture-page', async (event, data) => {
  if (!mainWindow) return;
  try {
    const rect = data && data.rect ? data.rect : undefined;
    const image = await mainWindow.webContents.capturePage(rect);
    
    // Copy to clipboard
    clipboard.writeImage(image);
    
    const buffer = image.toPNG();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `Leef_Screenshot_${timestamp}.png`;
    const filePath = path.join(app.getPath('downloads'), filename);
    
    fs.writeFileSync(filePath, buffer);
    event.sender.send('screenshot-captured', { success: true, filePath, filename });
  } catch (error) {
    console.error('Failed to capture page:', error);
    event.sender.send('screenshot-captured', { success: false, error: error.message });
  }
});

ipcMain.on('set-default-browser', () => {
  app.setAsDefaultProtocolClient('http');
  app.setAsDefaultProtocolClient('https');
});

app.on('web-contents-created', (event, contents) => {
  const handleWindowOpen = ({ url, features, disposition }) => {
    // 1. Detect if this is a legitimate popup (typical for Login/OAuth)
    // - Features present (width/height defined by site)
    // - Specific identity provider domains
    const isPopup = (features && features.length > 0);
    const isAuth = url.includes('accounts.google.com') ||
      url.includes('facebook.com/dialog/oauth') ||
      url.includes('github.com/login/oauth') ||
      url.includes('auth.services.adobe.com');

    if (isPopup || isAuth) {
      console.log('Allowing themed popup for:', url);
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          backgroundColor: '#1c1c1c',
          icon: path.join(__dirname, 'images/icon.png')
          // Note: titleBarOverlay doesn't apply to native popups easily, 
          // but we can set the background to match.
        }
      };
    }

    // 2. Default: Treat as a standard link and open in a Leef Tab
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('open-new-tab', url);
    }
    return { action: 'deny' };
  };

  contents.setWindowOpenHandler(handleWindowOpen);

  // Unified Download Manager (v0.1.5) - Initialized once on boot
  session.fromPartition('persist:leef-session').on('will-download', (event, item) => {
    const filename = item.getFilename();
    const totalBytes = item.getTotalBytes();

    if (globalSettings.askDownload) {
      item.setSaveDialogOptions({
        title: 'Save File',
        defaultPath: filename,
        buttonLabel: 'Save'
      });
    }

    // Send initial "started" event
    if (mainWindow) {
      mainWindow.webContents.send('download-status', {
        id: item.getStartTime(),
        name: filename,
        status: 'started',
        total: totalBytes
      });
    }

    item.on('updated', (event, state) => {
      if (state === 'interrupted') {
        if (mainWindow) mainWindow.webContents.send('download-status', { id: item.getStartTime(), status: 'interrupted' });
      } else if (state === 'progressing') {
        if (item.isPaused()) {
          if (mainWindow) mainWindow.webContents.send('download-status', { id: item.getStartTime(), status: 'paused' });
        } else {
          if (mainWindow) {
            mainWindow.webContents.send('download-status', {
              id: item.getStartTime(),
              received: item.getReceivedBytes(),
              status: 'progressing'
            });
          }
        }
      }
    });

    item.once('done', (event, state) => {
      if (state === 'completed') {
        if (mainWindow) {
          mainWindow.webContents.send('download-status', {
            id: item.getStartTime(),
            status: 'completed',
            path: item.getSavePath()
          });
        }
      } else {
        if (mainWindow) mainWindow.webContents.send('download-status', { id: item.getStartTime(), status: 'failed' });
      }
    });
  });

  // Explicitly enforce tab redirection on Webviews (Electron 30+ strict requirement)
  contents.on('did-attach-webview', (e, webContents) => {
    webContents.setWindowOpenHandler(handleWindowOpen);
  });
});

app.whenReady().then(async () => {
  createWindow();

  // Load initial adblocker if enabled in local storage (simplified for main process)
  // We'll wait for the renderer to apply-settings on boot, but we can check for updates
  setTimeout(() => {
    if (globalSettings.autoCheckUpdates !== false) {
      checkForUpdates();
    }
  }, 3000);

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
