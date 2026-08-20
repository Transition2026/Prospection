const { app, BrowserWindow, shell, dialog, ipcMain, safeStorage } = require('electron');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

app.setName('Prospection B2B');

const BACKEND_PORT = 3001;
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;
const REQUIRED_KEYS = ['DROPCONTACT_API_KEY', 'BRAVE_API_KEY', 'GOOGLE_PLACES_API_KEY'];
const CONFIG_KEYS = [...REQUIRED_KEYS, 'GPT_API_KEY', 'DATABASE_URL', 'DIRECT_URL'];
let backendProcess = null;
let mainWindow = null;
let isQuitting = false;

function backendDirectory() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'backend')
    : path.join(__dirname, '..', 'backend');
}

function secureConfigPath() {
  return path.join(app.getPath('userData'), 'secure-config.json');
}

function readSecureConfig() {
  const configPath = secureConfigPath();
  if (!fs.existsSync(configPath)) return {};
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Le coffre-fort Windows n’est pas disponible.');
  try {
    const payload = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return Object.fromEntries(CONFIG_KEYS.flatMap((key) => {
      const encrypted = payload?.secrets?.[key];
      if (!encrypted) return [];
      try {
        return [[key, safeStorage.decryptString(Buffer.from(encrypted, 'base64'))]];
      } catch {
        return [];
      }
    }));
  } catch {
    return {};
  }
}

function secureConfigStatus() {
  const values = readSecureConfig();
  const configured = Object.fromEntries(CONFIG_KEYS.map((key) => [key, Boolean(values[key])]));
  return {
    available: safeStorage.isEncryptionAvailable(),
    configured,
    ready: REQUIRED_KEYS.every((key) => configured[key]),
  };
}

function saveSecureConfig(input) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Le coffre-fort Windows n’est pas disponible.');
  const previous = readSecureConfig();
  const values = { ...previous };
  for (const key of CONFIG_KEYS) {
    const value = input?.[key];
    if (value === undefined || value === '') continue;
    if (typeof value !== 'string' || value.length > 8192) throw new Error('Valeur de configuration invalide.');
    values[key] = value.trim();
  }
  const secrets = Object.fromEntries(Object.entries(values)
    .filter(([key, value]) => CONFIG_KEYS.includes(key) && value)
    .map(([key, value]) => [key, safeStorage.encryptString(value).toString('base64')]));
  fs.mkdirSync(path.dirname(secureConfigPath()), { recursive: true });
  fs.writeFileSync(secureConfigPath(), JSON.stringify({ version: 1, secrets }), { encoding: 'utf8', mode: 0o600 });
}

function pingBackend() {
  return new Promise((resolve) => {
    const request = http.get(`${BACKEND_URL}/api/status`, (response) => {
      response.resume();
      resolve(true);
    });
    request.setTimeout(500, () => {
      request.destroy();
      resolve(false);
    });
    request.on('error', () => resolve(false));
  });
}

async function waitForBackend() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await pingBackend()) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

function startBackend() {
  const cwd = backendDirectory();
  backendProcess = spawn(process.execPath, [path.join(cwd, 'server.js')], {
    cwd,
    windowsHide: true,
    env: {
      ...process.env,
      ...readSecureConfig(),
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      PORT: String(BACKEND_PORT),
    },
    stdio: 'ignore',
  });
  backendProcess.on('exit', (code) => {
    if (!isQuitting && code !== 0) console.error(`Le backend local s'est arrêté (code ${code}).`);
  });
}

function stopBackend() {
  if (!backendProcess || backendProcess.killed) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(backendProcess.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  } else {
    backendProcess.kill();
  }
  backendProcess = null;
}

async function restartBackend() {
  stopBackend();
  await new Promise((resolve) => setTimeout(resolve, 300));
  startBackend();
  if (!await waitForBackend()) throw new Error('Le serveur local ne redémarre pas.');
}

ipcMain.handle('secure-config:status', () => secureConfigStatus());
ipcMain.handle('secure-config:save', async (_event, values) => {
  saveSecureConfig(values);
  await restartBackend();
  return secureConfigStatus();
});

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1050,
    minHeight: 700,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (!await waitForBackend()) {
    await dialog.showMessageBox({
      type: 'error',
      title: 'Prospection B2B',
      message: 'Le serveur local ne démarre pas.',
      detail: 'Vérifie les fichiers de l’application puis relance-la.',
    });
    app.quit();
    return;
  }
  await mainWindow.loadURL(BACKEND_URL);
  mainWindow.show();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(() => {
    startBackend();
    return createWindow();
  });
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  isQuitting = true;
  stopBackend();
});
