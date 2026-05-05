import { app, BrowserWindow, session, ipcMain, Menu, MenuItem, clipboard, nativeImage, shell } from 'electron';

import updater from 'electron-updater';
const { autoUpdater } = updater;

import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { ElectronBlocker } from '@ghostery/adblocker-electron';
import fetch from 'cross-fetch';
import { execSync } from 'child_process';


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

const isDev = !app.isPackaged || process.env.NODE_ENV === 'development';
console.log('Leef Browser: isDev =', isDev, '| app.isPackaged =', app.isPackaged);

// DATA ISOLATION: Prevent dev data from mixing with prod data
if (isDev) {
  const devPath = path.join(app.getPath('userData'), '..', 'Leef-Dev');
  app.setPath('userData', devPath);
  console.log('Dev Mode: Data isolated to', devPath);
}




let mainWindow;
let blocker;
const permissionCallbacks = {};
let permReqId = 0;
let globalSettings = {};
let adblockerEnabled = false;
let adblockerLoading = false;
const activeDownloads = new Map();
let closedTabsCount = 0;


function safeSend(channel, ...args) {
  BrowserWindow.getAllWindows().forEach(win => {
    if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, ...args);
    }
  });
}





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
      safeSend('adblock-status', 'syncing');
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
      safeSend('adblock-status', 'updated');
    }

    // Enable cosmetic filtering and IPC handlers (Once)
    blocker.enableBlockingInSession(sess);
    blocker.on('request-blocked', (request) => {
      safeSend('adblock-item-blocked', { tabId: request.tabId, url: request.url });
    });
    adblockerEnabled = true;
  } catch (err) {
    console.error('AdBlocker error:', err);
    safeSend('adblock-status', 'error');
  } finally {
    adblockerLoading = false;
  }
}

// --- AUTO UPDATER CONFIGURATION ---
if (!isDev) {
  autoUpdater.autoDownload = false; // Don't download automatically
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('Checking for update...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('Update available:', info.version);
    safeSend('update-available', {
      version: info.version,
      tag: info.version,
      releaseNotes: info.releaseNotes
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('Update not available.');
    safeSend('update-available', 'none');
  });

  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err);
    safeSend('update-available', 'error');
  });

  autoUpdater.on('download-progress', (progressObj) => {
    safeSend('update-download-progress', progressObj);
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('Update downloaded; will install on quit.');
    safeSend('update-downloaded', info);
  });
}

async function checkForUpdates(manual = false) {
  if (isDev) {
    console.log('Leef Browser: Bypassing real update check (Dev Mode).');
    if (manual) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      safeSend('update-available', 'none');
    }
    return;
  }

  try {
    if (manual) {
      await autoUpdater.checkForUpdates();
    } else {
      await autoUpdater.checkForUpdatesAndNotify();
    }
  } catch (err) {
    console.error('Update check failed:', err);
    if (manual) safeSend('update-available', 'error');
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

let isRecoveryMode = false;
let startupError = 'None';

async function generateDiagnosticLog(error = 'None') {
  const userData = app.getPath('userData');
  const logPath = path.join(userData, 'leef-diagnostic.txt');

  const scrub = (str) => {
    if (!str) return '';
    const home = os.homedir().replace(/\\/g, '\\\\');
    return str.replace(new RegExp(home, 'g'), '<User>');
  };

  let gpuInfo = {};
  try { gpuInfo = await app.getGPUInfo('basic'); } catch (e) { gpuInfo = { error: 'Failed to fetch' }; }

  const fileChecks = {
    'index.html': fs.existsSync(path.join(__dirname, 'index.html')),
    'renderer.js': fs.existsSync(path.join(__dirname, 'renderer.js')),
    'style.css': fs.existsSync(path.join(__dirname, 'style.css')),
    'package.json': fs.existsSync(path.join(__dirname, 'package.json')),
    'Recovery UI': fs.existsSync(path.join(__dirname, 'recovery.html'))
  };

  const logContent = [
    `Leef Browser Diagnostic Log - ${new Date().toISOString()}`,
    `----------------------------------------------------`,
    `PRIVACY DISCLAIMER: This log does NOT contain any PII`,
    `(Personally Identifiable Information). IP addresses,`,
    `user credentials, and browsing history are NOT stored.`,
    `All local system paths have been anonymized.`,
    `----------------------------------------------------`,
    `App Version: ${app.isPackaged ? app.getVersion() : '0.3.0 (Beta)'}`,


    `Electron Version: ${process.versions.electron}`,
    `Chrome Version: ${process.versions.chrome}`,
    `Node Version: ${process.versions.node}`,
    `Platform: ${process.platform} (${os.release()})`,
    `Arch: ${process.arch}`,
    `Process Memory: ${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
    `----------------------------------------------------`,
    `Integrity Check:`,
    Object.entries(fileChecks).map(([f, exists]) => ` - ${f}: ${exists ? 'OK' : 'MISSING'}`).join('\n'),
    `----------------------------------------------------`,
    `GPU Information:`,
    JSON.stringify(gpuInfo, null, 2),
    `----------------------------------------------------`,
    `Recovery Triggered: ${isRecoveryMode ? 'Yes' : 'No'}`,
    `Last Error Stack:`,
    scrub(error),
    `----------------------------------------------------`,
    `Arguments: ${scrub(process.argv.join(' '))}`
  ].join('\n');

  fs.writeFileSync(logPath, logContent);
}



function runKeyCheck() {
  // Recovery Mode: Triggered via --recovery flag or Shift key detection
  if (process.argv.includes('--recovery')) {
    isRecoveryMode = true;
    return;
  }

  if (process.platform === 'win32') {
    try {
      const { execSync } = require('child_process');
      const cmd = 'powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Control]::ModifierKeys"';
      const output = execSync(cmd, { timeout: 4000, encoding: 'utf8' });
      if (output && (output.includes('Shift') || output.includes('Control') || output.includes('Alt'))) {
        isRecoveryMode = true;
      }
    } catch (e) {
      isRecoveryMode = false;
    }
  }
}

function createWindow() {

  // Use pure in-memory partition for privacy
  const sess = session.fromPartition('persist:leef-session');

  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: isRecoveryMode ? 900 : 1200,
    height: isRecoveryMode ? 550 : 800,
    minWidth: 800,
    minHeight: 500,
    resizable: !isRecoveryMode,
    center: true,
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

  // Explicitly force size and centering to override any OS-level window persistence
  if (isRecoveryMode) {
    mainWindow.setSize(900, 550);
  } else {
    mainWindow.setSize(1200, 800);
  }
  mainWindow.center();

  // Force icon update for Windows Taskbar
  if (process.platform === 'win32') {
    mainWindow.setIcon(path.join(__dirname, 'images/icon.png'));
  }

  // Decide if we are in dev or prod
  // For simplicity, we just load Vite's default dev server if running "npm run dev"
  // but if we are just running electron . we should load index.html
  if (isRecoveryMode) {
    mainWindow.loadFile('recovery.html');
  } else {
    mainWindow.loadFile('index.html');
  }

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

  // Consolidated global shortcut handler for all webContents (v0.3.5)
  app.on('web-contents-created', (event, contents) => {
    contents.setMaxListeners(100);
    contents.on('before-input-event', (e, input) => {
      // Find in Page: Ctrl + F
      if (input.control && !input.shift && input.key.toLowerCase() === 'f' && input.type === 'keyDown') {
        safeSend('trigger-find-in-page');
        e.preventDefault();
      }

      // Offline Game: Ctrl + Shift + O
      if (input.control && input.shift && input.key.toLowerCase() === 'o' && input.type === 'keyDown') {
        safeSend('trigger-offline-game');
        e.preventDefault();
      }


    });

    // CSS Exorcist (Labs): Strip tracking pixels
    contents.on('did-stop-loading', () => {
      if (globalSettings.labs?.css_exorcist) {
        const exorcistCSS = `
          img[width="1"][height="1"], 
          img[style*="width: 1px"][style*="height: 1px"],
          img[style*="width:1px"][style*="height:1px"],
          iframe[width="1"][height="1"],
          iframe[style*="display: none"],
          [style*="opacity: 0"][style*="pointer-events: none"],
          [style*="opacity:0"][style*="pointer-events:none"] {
            display: none !important;
            visibility: hidden !important;
            width: 0 !important;
            height: 0 !important;
          }
        `;
        contents.insertCSS(exorcistCSS).catch(() => {});
      }
    });

    // DRM Detection: Triggered when Widevine/CDM is requested
    contents.on('select-key-system', (e, keySystem) => {
      safeSend('drm-detected', { webContentsId: contents.id });
    });
  });
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
  if (isRecoveryMode) return;
  globalSettings = settings;

  const sess = session.fromPartition('persist:leef-session');

  let acceptLang = 'en-US,en';
  if (settings.language === 'fr') acceptLang = 'fr-FR,fr,en;q=0.9';
  if (settings.language === 'es') acceptLang = 'es-ES,es,en;q=0.9';
  if (settings.language === 'it') acceptLang = 'it-IT,it,en;q=0.9';

  // Custom User Agent & Language
  // We explicitly regenerate the UA to ensure that turning off "Stealth UA" actually
  // restores the "Leef Browser" identifier, as sess.getUserAgent() might have been 
  // modified in a previous apply-settings call.
  const DEFAULT_UA = sess.getUserAgent().replace(/Leef\s?Browser\/[0-9.]+\s?/gi, '').replace(/Electron\/[0-9.]+\s/g, '');
  let ua = settings.customUa || DEFAULT_UA;

  // Stealth User Agent (Labs): Remove "Leef Browser/vX.X.X" if flag is enabled
  // Default behavior is to INCLUDE Leef Browser if stealth is OFF and no custom UA is set.
  if (!settings.customUa && !(settings.labs?.fingerprint_master && settings.labs?.stealth_ua)) {
    ua = `${DEFAULT_UA} Leef Browser/${app.getVersion()}`;
  }

  console.log('Applying User Agent:', ua);
  sess.setUserAgent(ua, acceptLang);

  // Initialize Ghostery if Comprehensive mode is selected
  // We no longer 'await' this so that the browser can finish applying other settings 
  // and become interactive while the adblocker engine loads in the background.
  if (settings.adBlockerMode === 'comprehensive') {
    initAdBlocker(true).catch(err => console.error('Background AdBlocker init failed:', err));
  } else {
    initAdBlocker(false).catch(err => console.error('Background AdBlocker disable failed:', err));
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

    // Stealth User Agent (Header Fallback)
    if (settings.labs?.fingerprint_master && settings.labs?.stealth_ua && headers['User-Agent']) {
      headers['User-Agent'] = headers['User-Agent'].replace(/Leef\s?Browser\/[0-9.]+\s?/gi, '');
    }

    // DNT Header (Labs)
    if (settings.labs?.fingerprint_master && settings.labs?.dnt_header) {
      headers['DNT'] = '1';
    }

    // Global Privacy Control (GPC)
    if (settings.gpc !== false) {
      headers['Sec-GPC'] = '1';
    }

    callback({ requestHeaders: headers });
  });

  // HTTPS-Only redirect + AI blocking via onBeforeRequest complement
  // We use a named filter to only target http:// navigations and google searches
  if (settings.httpsOnly || settings.blockAIOverview || settings.labs?.force_safe_off) {
    // These are handled by Ghostery's pipeline safely by hooking into
    // the webContents will-navigate event on the webview in renderer instead.
    // Signal renderer to apply these via IPC
    if (mainWindow) {
      safeSend('apply-url-rules', {
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
        // Dynamic Prompt with 30s expiry to prevent memory leaks
        const reqId = ++permReqId;
        const timeout = setTimeout(() => {
          if (permissionCallbacks[reqId]) {
            permissionCallbacks[reqId](false);
            delete permissionCallbacks[reqId];
            console.log(`Permission request ${reqId} timed out.`);
          }
        }, 30000);

        permissionCallbacks[reqId] = (granted) => {
          clearTimeout(timeout);
          callback(granted);
        };

        if (mainWindow && !mainWindow.isDestroyed()) {
          safeSend('permission-request', {
            id: reqId,
            permission,
            origin
          });
        } else {
          permissionCallbacks[reqId](false);
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
  safeSend('adblock-status', 'syncing');
  await initAdBlocker(true);
  safeSend('adblock-status', 'updated');
});

ipcMain.on('manual-update-check', () => {
  checkForUpdates(true);
});

ipcMain.on('restart-to-update', () => {
  autoUpdater.quitAndInstall();
});

ipcMain.on('start-download', () => {
  autoUpdater.downloadUpdate();
});

ipcMain.on('permission-response', (event, data) => {
  if (permissionCallbacks[data.id]) {
    permissionCallbacks[data.id](data.granted);
    delete permissionCallbacks[data.id];
  }
});

ipcMain.on('update-closed-tabs-count', (event, count) => {
  closedTabsCount = count;
});

ipcMain.on('recovery-action', async (event, action) => {
  if (!mainWindow) return;

  switch (action) {
    case 'reset-config':
      // Clear Local Storage ( хирургически)
      const sess = session.fromPartition('persist:leef-session');
      await sess.clearStorageData({ storages: ['localstorage'] });
      app.relaunch();
      app.exit();
      break;

    case 'rebuild-appdata':
      // Nuclear option
      const fullSess = session.fromPartition('persist:leef-session');
      await fullSess.clearStorageData();
      await fullSess.clearCache();
      app.relaunch();
      app.exit();
      break;

    case 'reset-window':
      // Browser window defaults to 1200x800 on next relaunch. 
      // For now, just re-center the recovery menu if it got moved.
      mainWindow.center();
      break;

    case 'open-appdata':
      shell.openPath(app.getPath('userData'));
      break;

    case 'save-diagnostic-log':
      await generateDiagnosticLog(startupError);
      break;

    case 'show-diagnostic-log':
      const logFile = path.join(app.getPath('userData'), 'leef-diagnostic.txt');
      if (fs.existsSync(logFile)) {
        shell.showItemInFolder(logFile);
      }
      break;

    case 'open-github':

      const githubUrl = 'https://github.com/git-QTech/leef/issues';
      if (process.platform === 'win32') {
        try {
          // Force open in Edge to avoid looping back to a broken Leef
          execSync(`powershell -Command "Start-Process 'msedge.exe' -ArgumentList '${githubUrl}'"`);
        } catch (e) {
          shell.openExternal(githubUrl);
        }
      } else {
        shell.openExternal(githubUrl);
      }
      break;

    case 'continue':

      app.relaunch();
      app.exit();
      break;

  }
});

ipcMain.on('show-context-menu', (event, params) => {

  const menu = new Menu();

  // Navigation Group
  if (!params.isBrowserUI) {
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
  }


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
    
    // AI Analysis (Labs)
    if (globalSettings.labs?.slop_scanner) {
      menu.append(new MenuItem({
        label: '✨ Analyze AI Heuristics',
        click: () => event.sender.send('context-menu-command', { command: 'check-slop', text: cleanText })
      }));
    }
    
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
  if (!params.selectionText && !params.linkURL && !params.mediaType && !params.isBrowserUI) {
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

  if (data.tabId) {
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

    menu.append(new MenuItem({ type: 'separator' }));
  } else {
    menu.append(new MenuItem({
      label: 'New Tab',
      accelerator: 'CmdOrCtrl+T',
      click: () => event.sender.send('tab-command', { command: 'new-tab' })
    }));
    menu.append(new MenuItem({ type: 'separator' }));
  }

  menu.append(new MenuItem({
    label: 'Reopen Closed Tab',
    enabled: closedTabsCount > 0,
    accelerator: 'CmdOrCtrl+Shift+T',
    click: () => event.sender.send('reopen-closed-tab')
  }));

  const win = BrowserWindow.fromWebContents(event.sender);
  menu.popup({ window: win });
});

ipcMain.on('show-item-in-folder', (event, path) => {
  if (path) shell.showItemInFolder(path);
});

ipcMain.on('pause-download', (event, id) => {
  const item = activeDownloads.get(id);
  if (item && !item.isPaused()) item.pause();
});

ipcMain.on('resume-download', (event, id) => {
  const item = activeDownloads.get(id);
  if (item && item.canResume()) item.resume();
});

ipcMain.on('cancel-download', (event, id) => {
  const item = activeDownloads.get(id);
  if (item) item.cancel();
});

ipcMain.on('retry-download', (event, url) => {
  if (mainWindow && !mainWindow.isDestroyed() && url) {
    mainWindow.webContents.downloadURL(url);
  }
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
  } catch (e) {
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

    const dlId = 'screenshot-' + Date.now();
    const size = buffer.length;

    safeSend('download-status', {
      id: dlId,
      name: filename,
      url: 'leef://screenshot',
      status: 'started',
      total: size
    });

    fs.writeFileSync(filePath, buffer);

    safeSend('download-status', {
      id: dlId,
      status: 'completed',
      path: filePath,
      received: size,
      total: size
    });

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

  contents.on('before-input-event', (event, input) => {
    const isReload = (input.control && input.key.toLowerCase() === 'r') || input.key === 'F5';
    if (isReload) {
      event.preventDefault();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('context-menu-command', { command: 'reload' });
      }
    }
  });


  // Explicitly enforce tab redirection on Webviews (Electron 30+ strict requirement)
  contents.on('did-attach-webview', (e, webContents) => {
    webContents.setWindowOpenHandler(handleWindowOpen);
  });
});


app.whenReady().then(async () => {
  try {
    // Show splash and check for recovery keys
    const splash = new BrowserWindow({
      width: 300, height: 150, transparent: true, frame: false, alwaysOnTop: true, center: true,
      webPreferences: { nodeIntegration: true, contextIsolation: false }
    });
    splash.loadURL(`data:text/html;charset=utf-8,
      <body style="background:%235aef7e;color:black;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:sans-serif;border-radius:20px;border:2px solid black;margin:0;overflow:hidden;">
        <h2 style="margin:0;">Leef</h2>
        <p style="font-size:12px;opacity:0.8;margin-top:5px;">Checking for Recovery...</p>
      </body>
    `);

    // Brief delay to allow splash to render before blocking key check
    await new Promise(r => setTimeout(r, 200));
    runKeyCheck();
    createWindow();
    splash.close();

    // Unified Download Manager (v0.1.5) - Initialized once on boot

    session.fromPartition('persist:leef-session').on('will-download', (event, item) => {
      const filename = item.getFilename() || 'Downloading file...';
      const totalBytes = item.getTotalBytes();

      if (globalSettings.askDownload) {
        item.setSaveDialogOptions({
          title: 'Save File',
          defaultPath: filename,
          buttonLabel: 'Save'
        });
      }

      const dlId = String(item.getStartTime());
      activeDownloads.set(dlId, item);

      // Send initial "started" event
      safeSend('download-status', {
        id: dlId,
        name: filename,
        url: item.getURL(),
        status: 'started',
        total: totalBytes
      });


      item.on('updated', (event, state) => {
        if (state === 'interrupted') {
          safeSend('download-status', { id: dlId, status: 'interrupted' });
        } else if (state === 'progressing') {
          if (item.isPaused()) {
            safeSend('download-status', { id: dlId, status: 'paused' });
          } else {
            // Send progress update on every chunk received
            safeSend('download-status', {
              id: dlId,
              received: item.getReceivedBytes(),
              total: item.getTotalBytes(),
              status: 'progressing',
              state: state
            });
          }
        }
      });


      item.once('done', (event, state) => {
        activeDownloads.delete(dlId);
        if (state === 'completed') {
          safeSend('download-status', {
            id: dlId,
            status: 'completed',
            path: item.getSavePath()
          });
        } else {
          safeSend('download-status', { id: dlId, status: state === 'cancelled' ? 'cancelled' : 'failed' });
        }

      });


    });

    // Load initial adblocker if enabled in local storage (simplified for main process)
    // We'll wait for the renderer to apply-settings on boot, but we can check for updates
    if (!isRecoveryMode) {
      setTimeout(() => {
        if (globalSettings.autoCheckUpdates !== false) {
          checkForUpdates();
        }
      }, 3000);
    }
  } catch (err) {
    console.error('CRITICAL STARTUP ERROR:', err);
    isRecoveryMode = true;
    startupError = err.stack || err.message;
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
    } else {
      mainWindow.loadFile('recovery.html');
    }
  }

  app.on('activate', function () {

    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
