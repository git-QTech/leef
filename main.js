import { app, BrowserWindow, session, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

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
    }
  });

  // Decide if we are in dev or prod
  // For simplicity, we just load Vite's default dev server if running "npm run dev"
  // but if we are just running electron . we should load index.html
  mainWindow.loadFile('index.html');

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
  'moatads.com', 'adsafeprotected.com', 'lijit.com', 'sovrn.com'
];

ipcMain.on('apply-settings', (event, settings) => {
  const sess = session.fromPartition('persist:leef-session');
  
  let acceptLang = 'en-US,en';
  if (settings.language === 'fr') acceptLang = 'fr-FR,fr,en;q=0.9';
  if (settings.language === 'es') acceptLang = 'es-ES,es,en;q=0.9';
  if (settings.language === 'it') acceptLang = 'it-IT,it,en;q=0.9';

  // Custom User Agent & Language
  const ua = settings.customUa || sess.getUserAgent().replace(/Electron\/[0-9.]+\s/g, '');
  sess.setUserAgent(ua, acceptLang);

  // Language headers — remove old handler first to prevent stacking
  sess.webRequest.onBeforeSendHeaders(null);
  sess.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['Accept-Language'] = acceptLang;
    callback({ requestHeaders: details.requestHeaders });
  });

  // Ad & Tracker Blocking + HTTPS-Only upgrade — remove old handler first to prevent stacking
  const blockList = settings.tracking === 'strict' ? AD_DOMAINS_STRICT : AD_DOMAINS_STANDARD;
  sess.webRequest.onBeforeRequest(null);
  sess.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;

    // HTTPS-Only: upgrade http:// to https:// for main frame navigations
    if (settings.httpsOnly && url.startsWith('http://') && !url.startsWith('http://localhost')) {
      return callback({ redirectURL: url.replace(/^http:\/\//, 'https://') });
    }

    // Ad / tracker blocking
    if (settings.adBlocker || settings.tracking === 'strict') {
      try {
        const host = new URL(url).hostname;
        if (blockList.some(domain => host.includes(domain))) {
          return callback({ cancel: true });
        }
      } catch (e) {}
    }

    callback({ cancel: false });
  });

  // Notification Permissions
  sess.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'notifications') {
      callback(settings.allowNotifications === true);
    } else {
      callback(true); // allow other permissions
    }
  });

  // Downloads — "Ask where to save" prompt
  sess.removeAllListeners('will-download');
  sess.on('will-download', (event, item) => {
    if (settings.askDownload) {
      item.setSaveDialogOptions({
        title: 'Save File',
        defaultPath: item.getFilename(),
        buttonLabel: 'Save'
      });
    }
  });

  // Proxy Settings
  if (settings.proxyUrl) {
    sess.setProxy({ proxyRules: settings.proxyUrl });
  } else {
    sess.setProxy({ proxyRules: 'direct://' });
  }
});

ipcMain.on('clear-data', async () => {
  const sess = session.fromPartition('persist:leef-session');
  await sess.clearStorageData();
  await sess.clearCache();
});

ipcMain.on('set-default-browser', () => {
  app.setAsDefaultProtocolClient('http');
  app.setAsDefaultProtocolClient('https');
});


app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
