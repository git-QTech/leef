import { app, BrowserWindow, session, ipcMain, Menu, MenuItem, clipboard, nativeImage, shell, webContents, screen } from 'electron';
// webContents is explicitly imported for fromId lookups (v0.5.0)

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

// Fix for washed out colors on Windows/HDR (v0.1.3+)
// D3D9 is a "Goldilocks" fix: it avoids washed-out colors but handles fullscreen better than OpenGL.
// Surgical fix for the "alpha bug" fullscreen border (v0.6.0)
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('use-angle', 'd3d9');
  app.commandLine.appendSwitch('disable-features', 'MediaFoundationVideoDecoder,DirectCompositionVideoOverlays');
  app.commandLine.appendSwitch('force-color-profile', 'srgb');
}

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-transparent-visuals');
  app.commandLine.appendSwitch('enable-blink-features', 'MiddleClickAutoscroll');
}

// Suppress noisy internal Chromium logs (e.g. VA-API/GPU decoding failures)
app.commandLine.appendSwitch('log-level', '3');

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
const permissionCallbacks = Object.create(null);
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

  const cachePath = path.normalize(path.join(app.getPath('userData'), 'adblock-engine-v3.bin'));

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
    // IPC Batching: Throttled updates to reduce CPU usage (v0.5.0)
    const pendingBlocks = new Map(); // tabId -> { ads, trackers, lastUrl }
    blocker.on('request-blocked', (request) => {
      const tabId = request.tabId;
      const stats = pendingBlocks.get(tabId) || { ads: 0, trackers: 0, lastUrl: '' };
      const type = request.type || '';
      if (['script', 'xmlhttprequest', 'ping', 'beacon', 'websocket'].includes(type.toLowerCase())) {
        stats.trackers++;
      } else {
        stats.ads++;
      }
      stats.lastUrl = request.url;
      pendingBlocks.set(tabId, stats);
    });

    setInterval(() => {
      if (pendingBlocks.size > 0) {
        pendingBlocks.forEach((stats, tabId) => {
          safeSend('adblock-items-blocked-batch', {
            tabId,
            ads: stats.ads,
            trackers: stats.trackers,
            url: stats.lastUrl
          });
        });
        pendingBlocks.clear();
      }
    }, 1000);

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



ipcMain.on('get-app-version', (event) => {
  event.returnValue = app.getVersion();
});

ipcMain.on('get-repo-slug', (event) => {
  event.returnValue = 'git-QTech/leef';
});

ipcMain.on('exit-app', () => {
  app.quit();
});

ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});

let isCriticalMode = false;
ipcMain.on('set-critical-mode', (event, active) => {
  isCriticalMode = active;
  if (isCriticalMode) {
    console.log('Leef Browser: CRITICAL MODE ACTIVE. DevTools and External Navigation restricted.');
    // Close DevTools if open
    if (mainWindow && mainWindow.webContents.isDevToolsOpened()) {
      mainWindow.webContents.closeDevTools();
    }
  }
});

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

function getOSFriendlyName() {
  if (process.platform === 'linux') {
    try {
      if (fs.existsSync('/etc/os-release')) {
        const content = fs.readFileSync('/etc/os-release', 'utf8');
        const lines = content.split('\n');
        const releaseData = Object.create(null);
        for (const line of lines) {
          const [key, value] = line.split('=');
          if (key && value) {
            releaseData[key] = value.replace(/^"|"$/g, '');
          }
        }
        return releaseData.PRETTY_NAME || releaseData.NAME || 'Linux';
      }
    } catch (e) { }
    return 'Linux';
  } else if (process.platform === 'win32') {
    return `Windows ${os.release()}`;
  } else if (process.platform === 'darwin') {
    return `macOS ${os.release()}`;
  }
  return process.platform;
}

let isRecoveryMode = false;
let startupError = 'None';

async function generateDiagnosticLog(error = 'None') {
  const userData = app.getPath('userData');
  const logPath = path.normalize(path.join(userData, 'leef-diagnostic.txt'));

  const scrub = (str) => {
    if (!str) return '';
    const home = os.homedir();
    const escapedHome = home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return str.replace(new RegExp(escapedHome, 'g'), '<User>');
  };

  let gpuInfo = {};
  try { gpuInfo = await app.getGPUInfo('basic'); } catch (e) { gpuInfo = { error: 'Failed to fetch' }; }

  const fileChecks = {
    'index.html': fs.existsSync(path.normalize(path.join(__dirname, 'index.html'))),
    'renderer.js': fs.existsSync(path.normalize(path.join(__dirname, 'renderer.js'))),
    'style.css': fs.existsSync(path.normalize(path.join(__dirname, 'style.css'))),
    'package.json': fs.existsSync(path.normalize(path.join(__dirname, 'package.json'))),
    'Recovery UI': fs.existsSync(path.normalize(path.join(__dirname, 'recovery.html')))
  };

  const logContent = [
    `Leef Browser Diagnostic Log - ${new Date().toISOString()}`,
    `----------------------------------------------------`,
    `PRIVACY DISCLAIMER: This log does NOT contain any PII`,
    `(Personally Identifiable Information). IP addresses,`,
    `user credentials, and browsing history are NOT stored.`,
    `All local system paths have been anonymized.`,
    `----------------------------------------------------`,
    `App Version: ${app.isPackaged ? app.getVersion() : '1.0.0'}`,


    `Electron Version: ${process.versions.electron}`,
    `Chrome Version: ${process.versions.chrome}`,
    `Node Version: ${process.versions.node}`,
    `Platform: ${getOSFriendlyName()} (${process.arch})`,
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

  fs.writeFileSync(path.normalize(logPath), logContent);
}

async function runKeyCheck() {
  if (process.argv.includes('--recovery')) {
    isRecoveryMode = true;
    return;
  }

  if (process.platform === 'darwin') {
    try {
      const cmd = 'osascript -l JavaScript -e "ObjC.import(\'Cocoa\'); ($.NSEvent.modifierFlags & $.NSEventModifierFlagShift) > 0"';
      const output = execSync(cmd, { timeout: 2000, encoding: 'utf8' }).trim();
      if (output === 'true') {
        isRecoveryMode = true;
        console.log('Leef Browser: Recovery Mode activated via Shift key (macOS).');
      }
    } catch (e) {
      console.error('Leef Browser: Shift key check failed on macOS:', e.message);
      isRecoveryMode = false;
    }
  } else if (process.platform === 'win32') {
    try {
      // Fast check using partial assembly loading
      const cmd = 'powershell -NoProfile -NonInteractive -Command "[Reflection.Assembly]::LoadWithPartialName(\'System.Windows.Forms\') | Out-Null; [System.Windows.Forms.Control]::ModifierKeys"';
      const output = execSync(cmd, { timeout: 2000, encoding: 'utf8' }).trim();
      if (output && output !== 'None' && output.includes('Shift')) {
        isRecoveryMode = true;
        console.log('Leef Browser: Recovery Mode activated via Shift key.');
      }
    } catch (e) {
      console.error('Leef Browser: Shift key check failed:', e.message);
      isRecoveryMode = false;
    }
  } else if (process.platform === 'linux') {
    try {
      const listOutput = execSync('xinput --list', { timeout: 2000, encoding: 'utf8' });
      const ids = [];
      const lines = listOutput.split('\n');
      for (const line of lines) {
        if (/keyboard/i.test(line)) {
          const match = line.match(/id=(\d+)/);
          if (match) {
            ids.push(match[1]);
          }
        }
      }
      for (const id of ids) {
        try {
          const queryOutput = execSync(`xinput query-state ${id}`, { timeout: 1000, encoding: 'utf8' });
          if (queryOutput.includes('key[50]=down') || queryOutput.includes('key[62]=down')) {
            isRecoveryMode = true;
            console.log('Leef Browser: Recovery Mode activated via Shift key (Linux).');
            break;
          }
        } catch (e) {
          // Ignore failures for specific devices and try next
        }
      }
    } catch (e) {
      console.error('Leef Browser: Shift key check failed on Linux:', e.message);
      isRecoveryMode = false;
    }
  }
}



function createWindow() {

  // Use pure in-memory partition for privacy
  const sess = session.fromPartition('persist:leef-session');

  // Hardened Critical Mode Blocker (v0.5.2)
  sess.webRequest.onBeforeRequest((details, callback) => {
    if (isCriticalMode) {
      try {
        const url = new URL(details.url);
        const hostname = url.hostname.toLowerCase();
        const protocol = url.protocol.toLowerCase();

        // Allow internal Leef files and essential protocols
        if (protocol === 'about:' || protocol === 'file:' || protocol === 'data:' || protocol === 'blob:') {
          return callback({ cancel: false });
        }

        // Allow GitHub and all its subdomains/asset servers
        const isGithub = hostname === 'github.com' ||
          hostname.endsWith('.github.com') ||
          hostname.endsWith('.githubusercontent.com') ||
          hostname.endsWith('.githubassets.com') ||
          hostname.endsWith('.github.io');

        if (isGithub) {
          return callback({ cancel: false });
        }

        // Block everything else
        console.warn('Leef Browser: Hard-blocked request in Critical Mode:', details.url);
        return callback({ cancel: true });
      } catch (e) {
        // If it's a protocol URL doesn't understand (like some data: formats), allow it to be safe
        return callback({ cancel: false });
      }
    }
    callback({ cancel: false });
  });

  if (process.platform === 'darwin') {
    const template = [
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' }
        ]
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'pasteAndMatchStyle' },
          { role: 'delete' },
          { role: 'selectAll' }
        ]
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' }
        ]
      },
      {
        label: 'Window',
        submenu: [
          { role: 'minimize' },
          { role: 'zoom' },
          { type: 'separator' },
          { role: 'front' },
          { type: 'separator' },
          { role: 'window' }
        ]
      }
    ];
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  } else {
    Menu.setApplicationMenu(null);
  }

  const isLinux = process.platform === 'linux';
  mainWindow = new BrowserWindow({
    width: isRecoveryMode ? 900 : 1200,
    height: isRecoveryMode ? 550 : 800,
    minWidth: 800,
    minHeight: 500,
    resizable: !isRecoveryMode,
    center: true,
    frame: !isLinux,
    transparent: isLinux,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true,
      webSecurity: true,
      session: sess
    },
    titleBarStyle: isLinux ? undefined : 'hidden',
    titleBarOverlay: process.platform === 'win32' ? {
      color: '#5aef7e', // matches --topbar-bg in style.css exactly
      symbolColor: '#000000'
    } : false,
    ...(process.platform === 'darwin' ? {
      trafficLightPosition: { x: 12, y: 16 }
    } : {}),
    ...(!isLinux ? {
      backgroundColor: '#000000' // Fixes "see-through" gaps in fullscreen (v0.6.0)
    } : {}),
    icon: path.join(__dirname, 'images/icon.png')
  });

  if (isLinux) {
    mainWindow.on('maximize', () => {
      safeSend('window-state-changed', 'maximized');
    });
    mainWindow.on('unmaximize', () => {
      safeSend('window-state-changed', 'normal');
    });
    mainWindow.on('enter-html-full-screen', () => {
      safeSend('window-state-changed', 'fullscreen');
    });
    mainWindow.on('leave-html-full-screen', () => {
      safeSend('window-state-changed', mainWindow.isMaximized() ? 'maximized' : 'normal');
    });
  }

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
    wasMaximized = mainWindow.isMaximized();
    try {
      normalBounds = mainWindow.getNormalBounds();
    } catch (e) {
      normalBounds = mainWindow.getBounds();
    }

    if (process.platform === 'win32') {
      mainWindow.setMenuBarVisibility(false);
      // Kill the "alpha bug" see-through borders by disabling resizing (v0.6.0)
      mainWindow.setResizable(false);
    }
    mainWindow.setFullScreen(true);
  });
  mainWindow.webContents.on('leave-html-full-screen', () => {
    mainWindow.setFullScreen(false);
    if (process.platform === 'win32') {
      mainWindow.setMenuBarVisibility(true);
      mainWindow.setResizable(true);

      if (wasMaximized) {
        mainWindow.maximize();
      } else if (normalBounds) {
        mainWindow.setBounds(normalBounds);
      }
      // Clean up to prevent memory "ghosting" (v0.6.0)
      normalBounds = null;
      wasMaximized = false;
    }
  });

  // mainWindow.webContents.openDevTools();
  let wasMaximized = false;
  let normalBounds = null;

  // Block DevTools in Critical Mode
  mainWindow.webContents.on('devtools-opened', () => {
    if (isCriticalMode) mainWindow.webContents.closeDevTools();
  });

  // Consolidated global shortcut handler for all webContents (v0.3.5)
  app.on('web-contents-created', (event, contents) => {
    contents.setMaxListeners(100);

    contents.on('devtools-opened', () => {
      if (isCriticalMode) contents.closeDevTools();
    });

    contents.on('before-input-event', (e, input) => {
      // Find in Page: Ctrl + F
      if (input.control && !input.shift && input.key.toLowerCase() === 'f' && input.type === 'keyDown') {
        if (isCriticalMode) { e.preventDefault(); return; }
        safeSend('trigger-find-in-page');
        e.preventDefault();
      }

      // Block all shortcuts in Critical Mode (except update-related if needed)
      if (isCriticalMode) {
        // Allow basic window controls if not handled here, but mostly lock down
        const allowedKeys = ['c', 'v', 'a', 'x']; // Copy paste
        if (input.control && !allowedKeys.includes(input.key.toLowerCase())) {
          e.preventDefault();
        }
      }

      // Offline Game: Ctrl + Shift + O
      if (input.control && input.shift && input.key.toLowerCase() === 'o' && input.type === 'keyDown') {
        safeSend('trigger-offline-game');
        e.preventDefault();
      }


    });

    // Navigation Restriction in Critical Mode
    contents.on('will-navigate', (event, navigationUrl) => {
      if (isCriticalMode) {
        try {
          const url = new URL(navigationUrl);
          const isGithubReleases = url.hostname === 'github.com' && url.pathname.startsWith('/git-QTech/leef/releases');
          const isInternal = navigationUrl.startsWith('file://');

          if (!isGithubReleases && !isInternal) {
            console.warn('Leef Browser: will-navigate blocked in Critical Mode:', navigationUrl);
            event.preventDefault();
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('critical-mode-blocked-nav');
          }
        } catch (e) {
          // If URL is invalid (e.g. some internal scheme), just block it in critical mode to be safe
          event.preventDefault();
        }
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
        contents.insertCSS(exorcistCSS).catch(() => { });
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
  if (settings.language === 'en-gb') acceptLang = 'en-GB,en;q=0.9';
  if (settings.language === 'en-ca') acceptLang = 'en-CA,en;q=0.9';
  if (settings.language === 'fr') acceptLang = 'fr-FR,fr,en;q=0.9';
  if (settings.language === 'es') acceptLang = 'es-ES,es,en;q=0.9';
  if (settings.language === 'nl') acceptLang = 'nl-NL,nl,en;q=0.9';
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
  if (settings.adBlockerMode === 'comprehensive') {
    await initAdBlocker(true).catch(err => console.error('Background AdBlocker init failed:', err));
  } else {
    await initAdBlocker(false).catch(err => console.error('Background AdBlocker disable failed:', err));
  }

  // Unified onBeforeRequest Handler (v0.6.1)
  // Consolidates Ad-Blocking, Tracking Protection, and Critical Mode security.
  const blockList = settings.tracking === 'strict' ? AD_DOMAINS_STRICT : AD_DOMAINS_STANDARD;

  if (!adblockerEnabled) {
    // Only set our own handler if Ghostery isn't running to avoid conflict.
    sess.webRequest.onBeforeRequest(null);
    sess.webRequest.onBeforeRequest((details, callback) => {
      // 1. Handle Critical Mode Security First
      if (isCriticalMode) {
        try {
          const url = new URL(details.url);
          const hostname = url.hostname.toLowerCase();
          const protocol = url.protocol.toLowerCase();

          if (protocol !== 'file:' && protocol !== 'data:' && protocol !== 'blob:') {
            const isGithub = hostname === 'github.com' ||
              hostname.endsWith('.github.com') ||
              hostname.endsWith('.githubusercontent.com') ||
              hostname.endsWith('.githubassets.com') ||
              hostname.endsWith('.github.io');

            if (!isGithub) {
              console.warn('Leef Browser: Blocked in Critical Mode:', details.url);
              return callback({ cancel: true });
            }
          }
        } catch (e) { }
      }

      // 2. Handle Basic Ad-Blocking and Strict Tracking
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
    const url = details.url || '';

    if (url.startsWith('about:') || url.startsWith('file:') || url.startsWith('data:') || url.startsWith('blob:')) {
      return callback({ cancel: false });
    }

    const headers = details.requestHeaders || {};
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
    if (settings.gpc !== false && (url.startsWith('http:') || url.startsWith('https:'))) {
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
      const hostPerms = settings.sitePermissions && Object.prototype.hasOwnProperty.call(settings.sitePermissions, origin)
        ? settings.sitePermissions[origin]
        : undefined;
      if (hostPerms && Object.prototype.hasOwnProperty.call(hostPerms, 'notifications') && hostPerms.notifications !== undefined) {
        return callback(hostPerms.notifications);
      }
      return callback(settings.allowNotifications === true);
    }

    if (permission === 'media' || permission === 'geolocation') {
      const hostPerms = settings.sitePermissions && Object.prototype.hasOwnProperty.call(settings.sitePermissions, origin)
        ? settings.sitePermissions[origin]
        : undefined;
      if (hostPerms && Object.prototype.hasOwnProperty.call(hostPerms, permission) && hostPerms[permission] !== undefined) {
        return callback(hostPerms[permission]);
      }

      // Dynamic Prompt
      // Dynamic Prompt with 30s expiry to prevent memory leaks
      const reqId = ++permReqId;
      const timeout = setTimeout(() => {
        if (Object.prototype.hasOwnProperty.call(permissionCallbacks, reqId)) {
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
        if (Object.prototype.hasOwnProperty.call(permissionCallbacks, reqId)) {
          permissionCallbacks[reqId](false);
        }
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

  // DNS over HTTPS (DoH) using Cloudflare (1.1.1.1)
  try {
    if (settings.dohToggle) {
      app.configureHostResolver({
        secureDnsMode: 'secure',
        secureDnsServers: [ 'https://cloudflare-dns.com/dns-query' ]
      });
    } else {
      app.configureHostResolver({
        secureDnsMode: 'automatic'
      });
    }
  } catch (e) {
    console.error('Failed to configure Host Resolver for DoH:', e);
  }
});



ipcMain.on('refresh-adblock', async () => {
  // Force re-download by deleting cache and re-initializing
  const cachePath = path.normalize(path.join(app.getPath('userData'), 'adblock-engine-v3.bin'));
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
  if (data && data.id && Object.prototype.hasOwnProperty.call(permissionCallbacks, data.id)) {
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

    case 'expand-window':
      mainWindow.setSize(900, 750, true);
      break;

    case 'open-appdata':
      shell.openPath(app.getPath('userData'));
      break;

    case 'save-diagnostic-log':
      await generateDiagnosticLog(startupError);
      break;

    case 'show-diagnostic-log':
      const logFile = path.normalize(path.join(app.getPath('userData'), 'leef-diagnostic.txt'));
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
      label: '⬅️ Back',
      accelerator: 'Alt+Left',
      enabled: params.editFlags.canGoBack || params.canGoBack,
      click: () => event.sender.send('context-menu-command', { command: 'go-back' })
    }));
    menu.append(new MenuItem({
      label: '➡️ Forward',
      accelerator: 'Alt+Right',
      enabled: params.editFlags.canGoForward || params.canGoForward,
      click: () => event.sender.send('context-menu-command', { command: 'go-forward' })
    }));
    menu.append(new MenuItem({
      label: '🔄 Reload',
      accelerator: 'CmdOrCtrl+R',
      click: () => event.sender.send('context-menu-command', { command: 'reload' })
    }));
    menu.append(new MenuItem({ type: 'separator' }));
  }

  // Link actions
  if (params.linkURL) {
    menu.append(new MenuItem({
      label: '🔗 Open Link in New Tab',
      click: () => event.sender.send('context-menu-command', { command: 'create-tab', url: params.linkURL })
    }));
    menu.append(new MenuItem({
      label: '📋 Copy Link Address',
      click: () => clipboard.writeText(params.linkURL)
    }));
    menu.append(new MenuItem({ type: 'separator' }));
  }

  // Image actions
  if (params.hasImageContents || params.mediaType === 'image') {
    menu.append(new MenuItem({
      label: '🖼️ Open Image in New Tab',
      click: () => event.sender.send('context-menu-command', { command: 'create-tab', url: params.srcURL })
    }));
    menu.append(new MenuItem({
      label: '💾 Save Image As...',
      click: () => {
        if (mainWindow) mainWindow.webContents.downloadURL(params.srcURL);
      }
    }));
    menu.append(new MenuItem({
      label: '🔍 Search Image on Google',
      click: () => {
        const searchUrl = `https://www.google.com/searchbyimage?image_url=${encodeURIComponent(params.srcURL)}`;
        event.sender.send('context-menu-command', { command: 'create-tab', url: searchUrl });
      }
    }));
    menu.append(new MenuItem({
      label: '📋 Copy Image',
      click: () => event.sender.send('context-menu-command', { command: 'copy-image', x: params.x, y: params.y })
    }));
    menu.append(new MenuItem({
      label: '🔗 Copy Image Address',
      click: () => clipboard.writeText(params.srcURL)
    }));
    menu.append(new MenuItem({ type: 'separator' }));
  }

  // Text selection actions
  if (params.selectionText) {
    const cleanText = params.selectionText.trim();
    const displaySelection = cleanText.length > 15 ? cleanText.substring(0, 15) + '...' : cleanText;

    menu.append(new MenuItem({
      label: `🔍 Search Google for "${displaySelection}"`,
      click: () => event.sender.send('context-menu-command', { command: 'search-google', text: cleanText })
    }));

    menu.append(new MenuItem({
      label: '🌐 Translate to English',
      click: () => {
        const translateUrl = `https://translate.google.com/?sl=auto&tl=en&text=${encodeURIComponent(cleanText)}&op=translate`;
        event.sender.send('context-menu-command', { command: 'create-tab', url: translateUrl });
      }
    }));

    // AI Analysis (Labs)
    if (globalSettings.labs?.slop_scanner) {
      menu.append(new MenuItem({
        label: '✨ Analyze AI Heuristics',
        click: () => event.sender.send('context-menu-command', { command: 'check-slop', text: cleanText })
      }));
    }

    menu.append(new MenuItem({ type: 'separator' }));

    menu.append(new MenuItem({ label: '📋 Copy', role: 'copy' }));
    menu.append(new MenuItem({
      label: '📝 Raw Copy (No formatting)',
      click: () => clipboard.writeText(cleanText)
    }));
    menu.append(new MenuItem({ type: 'separator' }));
  }

  // Input actions (if editable)
  if (params.isEditable) {
    menu.append(new MenuItem({ label: '✂️ Cut', role: 'cut' }));
    menu.append(new MenuItem({ label: '📋 Copy', role: 'copy' }));
    menu.append(new MenuItem({ label: '📥 Paste', role: 'paste' }));
    menu.append(new MenuItem({ type: 'separator' }));
    menu.append(new MenuItem({ label: '✅ Select All', role: 'selectAll' }));
    menu.append(new MenuItem({ type: 'separator' }));
  }

  // Page Global Actions
  if (!params.selectionText && !params.linkURL && !params.mediaType && !params.isBrowserUI) {
    menu.append(new MenuItem({
      label: '💾 Save Page As...',
      accelerator: 'CmdOrCtrl+S',
      click: () => event.sender.send('context-menu-command', { command: 'save-page' })
    }));
    menu.append(new MenuItem({
      label: '🖨️ Print...',
      accelerator: 'CmdOrCtrl+P',
      click: () => event.sender.send('context-menu-command', { command: 'print' })
    }));
    menu.append(new MenuItem({ type: 'separator' }));
    menu.append(new MenuItem({
      label: '📄 View Page Source',
      accelerator: 'CmdOrCtrl+U',
      click: () => event.sender.send('context-menu-command', { command: 'view-source' })
    }));
  }

  if (!isCriticalMode && (!params.isBrowserUI || isDev)) {
    menu.append(new MenuItem({
      label: '🛠️ Inspect Element',
      accelerator: 'F12',
      click: () => {
        const targetContents = params.webContentsId ? webContents.fromId(params.webContentsId) : event.sender;
        if (targetContents) {
          targetContents.inspectElement(params.x, params.y);
          if (targetContents.isDevToolsOpened()) {
            targetContents.devToolsWebContents.focus();
          }
        }
      }
    }));
  }

  const win = BrowserWindow.fromWebContents(event.sender);
  menu.popup({ window: win });
});

ipcMain.on('show-tab-context-menu', (event, data) => {
  const menu = new Menu();

  if (data.tabId) {
    menu.append(new MenuItem({
      label: '🔄 Reload Tab',
      click: () => event.sender.send('tab-command', { command: 'reload', tabId: data.tabId })
    }));

    menu.append(new MenuItem({
      label: '📑 Duplicate Tab',
      click: () => event.sender.send('tab-command', { command: 'duplicate', tabId: data.tabId })
    }));

    menu.append(new MenuItem({ type: 'separator' }));

    menu.append(new MenuItem({
      label: data.isPinned ? '📍 Unpin Tab' : '📌 Pin Tab',
      click: () => event.sender.send('tab-command', { command: 'toggle-pin', tabId: data.tabId })
    }));

    menu.append(new MenuItem({
      label: data.isMuted ? '🔊 Unmute Tab' : '🔇 Mute Tab',
      click: () => event.sender.send('tab-command', { command: 'toggle-mute', tabId: data.tabId })
    }));

    menu.append(new MenuItem({ type: 'separator' }));

    menu.append(new MenuItem({
      label: '❌ Close Tab',
      accelerator: 'CmdOrCtrl+W',
      click: () => event.sender.send('tab-command', { command: 'close', tabId: data.tabId })
    }));

    menu.append(new MenuItem({
      label: '🚫 Close Other Tabs',
      click: () => event.sender.send('tab-command', { command: 'close-others', tabId: data.tabId })
    }));

    menu.append(new MenuItem({
      label: '➡️ Close Tabs to the Right',
      click: () => event.sender.send('tab-command', { command: 'close-right', tabId: data.tabId })
    }));

    menu.append(new MenuItem({ type: 'separator' }));
  } else {
    menu.append(new MenuItem({
      label: '➕ New Tab',
      accelerator: 'CmdOrCtrl+T',
      click: () => event.sender.send('tab-command', { command: 'new-tab' })
    }));
    menu.append(new MenuItem({ type: 'separator' }));
  }

  menu.append(new MenuItem({
    label: '🕒 Reopen Closed Tab',
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
    const baseDomain = domain.startsWith('www.') ? domain.slice(4) : domain;
    
    // Clear modern storage data (LocalStorage, IndexedDB, Cache, ServiceWorkers, etc)
    await sess.clearStorageData({ origin: 'https://' + domain });
    await sess.clearStorageData({ origin: 'http://' + domain });
    if (baseDomain !== domain) {
      await sess.clearStorageData({ origin: 'https://' + baseDomain });
      await sess.clearStorageData({ origin: 'http://' + baseDomain });
    }

    // Force clear all cookies that match the base domain (catches .domain.com subdomains)
    const cookies = await sess.cookies.get({ domain: baseDomain });
    for (const cookie of cookies) {
      let url = (cookie.secure ? 'https://' : 'http://') + cookie.domain + cookie.path;
      url = url.replace(/:\/\/\./, '://');
      await sess.cookies.remove(url, cookie.name);
    }
    
    // Flush the cookie store to disk to ensure immediate deletion
    await sess.cookies.flushStore();
  } catch (e) {
    console.error('Failed to clear site data:', e);
  }
});

ipcMain.on('generate-bug-log', (event, data = {}) => {
  const settings = data.settings || {};
  const labs = data.labs || {};
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `leef-diagnostics-${timestamp}.txt`;
    const downloadsPath = app.getPath('downloads');
    const filePath = path.normalize(path.join(downloadsPath, filename));

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
Platform: ${getOSFriendlyName()} (${process.arch})

--------------------------------------------------
SYSTEM INFO
--------------------------------------------------
OS: ${getOSFriendlyName()} (${os.release()})
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

    fs.writeFileSync(path.normalize(filePath), logContent, 'utf8');
    event.sender.send('bug-log-generated', { success: true, filename });
  } catch (error) {
    console.error('Failed to generate bug log:', error);
    event.sender.send('bug-log-generated', { success: false, error: error.message });
  }
});

ipcMain.on('set-cpu-throttle', (event, data) => {
  const { webContentsId, factor } = data;
  if (factor < 1.0) console.log(`Leef Limiter: Setting CPU throttle for ${webContentsId} to ${factor}`);
  if (webContentsId) {
    const contents = webContents.fromId(webContentsId);
    if (contents) {
      try {
        // factor: 1.0 (no throttling) down to ~0.1 (extreme throttling)
        // NOTE: setCPUThrottling is deprecated in modern Electron. 
        // We now rely on native backgroundThrottling and process priority management.
        if (typeof contents.setBackgroundThrottling === 'function') {
          contents.setBackgroundThrottling(factor < 1.0);
        }
      } catch (e) {
        console.error('Failed to set background throttling:', e);
      }
    }
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
    const filePath = path.normalize(path.join(app.getPath('downloads'), filename));

    const dlId = 'screenshot-' + Date.now();
    const size = buffer.length;

    safeSend('download-status', {
      id: dlId,
      name: filename,
      url: 'leef://screenshot',
      status: 'started',
      total: size
    });

    fs.writeFileSync(path.normalize(filePath), buffer);

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
    await runKeyCheck();
    createWindow();

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
