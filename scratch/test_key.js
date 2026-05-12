
const { app, BrowserWindow, ipcMain } = require('electron');

app.whenReady().then(() => {
    const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } });
    win.loadURL('data:text/html,<script>require("electron").ipcRenderer.send("key", navigator.getModifierState("Shift"))</script>');
    ipcMain.on('key', (event, shift) => {
        console.log('Shift held:', shift);
        app.quit();
    });
});
