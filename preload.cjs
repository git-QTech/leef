const { contextBridge, ipcRenderer } = require('electron');

// Security: IPC channel allowlists prevent a compromised renderer from
// invoking arbitrary main-process handlers. Every new channel MUST be
// explicitly added here.
const SEND_ALLOWLIST = [
  'apply-settings', 'manual-update-check', 'start-download', 'restart-to-update',
  'refresh-adblock', 'exit-app', 'set-critical-mode', 'permission-response',
  'show-context-menu', 'show-tab-context-menu', 'show-item-in-folder',
  'pause-download', 'resume-download', 'cancel-download', 'retry-download',
  'clear-data', 'clear-site-data', 'generate-bug-log', 'set-cpu-throttle',
  'capture-page', 'set-default-browser', 'recovery-action',
  'update-closed-tabs-count', 'open-downloaded-file'
];

const ON_ALLOWLIST = [
  'update-available', 'update-download-progress', 'update-downloaded',
  'adblock-status', 'adblock-items-blocked-batch', 'download-status',
  'open-new-tab', 'context-menu-command', 'tab-command', 'reopen-closed-tab',
  'permission-request', 'drm-detected', 'trigger-find-in-page',
  'trigger-offline-game', 'apply-url-rules', 'screenshot-captured',
  'bug-log-generated', 'critical-mode-blocked-nav', 'open-external-url',
  'focus-address-bar'
];

const INVOKE_ALLOWLIST = [
  'fetch-autocomplete', 'fetch-rss'
];

const SEND_SYNC_ALLOWLIST = [
  'get-app-version', 'get-repo-slug', 'get-memory-usage', 'get-offline-path',
  'get-initial-url'
];

// Security: Only allow fetching RSS from known-safe domains.
const FETCH_RSS_ALLOWED_HOSTS = [
  'news.yahoo.com'
];

contextBridge.exposeInMainWorld('leefAPI', {
  ipc: {
    send: (channel, ...args) => {
      if (SEND_ALLOWLIST.includes(channel)) {
        ipcRenderer.send(channel, ...args);
      } else {
        console.warn('Leef Security: Blocked IPC send on disallowed channel:', channel);
      }
    },
    on: (channel, callback) => {
      if (!ON_ALLOWLIST.includes(channel)) {
        console.warn('Leef Security: Blocked IPC on for disallowed channel:', channel);
        return () => { };
      }
      // IMPORTANT: We must NOT pass the Electron 'event' object across the
      // context bridge boundary — it is not serializable and will cause
      // contextBridge to throw. Instead, strip the event and pass only args.
      // The renderer code passes (event, data) but never uses the event object,
      // so we pass a dummy empty object in its place.
      const sub = (_event, ...args) => callback({}, ...args);
      ipcRenderer.on(channel, sub);
      // Return an unsubscribe function
      return () => ipcRenderer.removeListener(channel, sub);
    },
    invoke: (channel, ...args) => {
      if (INVOKE_ALLOWLIST.includes(channel)) {
        return ipcRenderer.invoke(channel, ...args);
      }
      console.warn('Leef Security: Blocked IPC invoke on disallowed channel:', channel);
      return Promise.reject(new Error('Disallowed channel'));
    },
    sendSync: (channel, ...args) => {
      if (SEND_SYNC_ALLOWLIST.includes(channel)) {
        return ipcRenderer.sendSync(channel, ...args);
      }
      console.warn('Leef Security: Blocked IPC sendSync on disallowed channel:', channel);
      return undefined;
    }
  },

  // Custom secure endpoints
  getMemoryUsage: () => {
    try {
      return ipcRenderer.sendSync('get-memory-usage');
    } catch (e) {
      return 0;
    }
  },

  getOfflinePath: () => {
    try {
      return ipcRenderer.sendSync('get-offline-path');
    } catch (e) {
      return '';
    }
  },

  fetchRSS: (url, options) => {
    // Security: Restrict to allowed hostnames to prevent SSRF.
    try {
      const parsed = new URL(url);
      const isAllowed = FETCH_RSS_ALLOWED_HOSTS.some(host =>
        parsed.hostname === host || parsed.hostname.endsWith('.' + host)
      );
      if (!isAllowed) {
        return Promise.reject('Blocked: URL host not in RSS allowlist');
      }
    } catch (e) {
      return Promise.reject('Blocked: Invalid URL');
    }

    return ipcRenderer.invoke('fetch-rss', url, options);
  }
});
