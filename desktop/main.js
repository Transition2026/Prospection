const { app, BrowserWindow, shell, dialog, ipcMain, safeStorage } = require('electron');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');

app.setName('Prospection B2B');

const BACKEND_PORT = 3001;
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;
const REQUIRED_KEYS = ['DROPCONTACT_API_KEY', 'BRAVE_API_KEY', 'GOOGLE_PLACES_API_KEY'];
const CONFIG_KEYS = [...REQUIRED_KEYS, 'GPT_API_KEY', 'DATABASE_URL', 'DIRECT_URL'];
const DIAGNOSTIC_LOG_FILE = 'diagnostic.log';
const BACKEND_RESTART_MAX_ATTEMPTS = 3;
const BACKEND_RESTART_WINDOW_MS = 60_000;
let backendProcess = null;
let mainWindow = null;
let isQuitting = false;
let updatePromptShown = false;
let backendHealthTimer = null;
let backendRestartTimer = null;
let backendCheckInFlight = false;
let backendRestartAttempts = [];
const expectedBackendStops = new Set();
const backendState = {
  startedAt: null,
  lastExit: null,
  lastError: null,
  lastRestartReason: null,
};

function backendDirectory() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'backend')
    : path.join(__dirname, '..', 'backend');
}

function secureConfigPath() {
  return path.join(app.getPath('userData'), 'secure-config.json');
}

function diagnosticLogPath() {
  return path.join(app.getPath('userData'), DIAGNOSTIC_LOG_FILE);
}

function redactDiagnosticText(value) {
  return String(value || '')
    .replace(/(api[_-]?key|authorization|token|password)\s*[:=]\s*[^,\s]+/gi, '$1=[masqué]')
    .replace(/(bearer\s+)[^\s]+/gi, '$1[masqué]')
    .replace(/[?&](key|api_key|token|password)=([^&\s]+)/gi, '&$1=[masqué]')
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, '[email masqué]')
    .slice(0, 500);
}

function diagnosticError(error) {
  if (!error) return null;
  return {
    name: redactDiagnosticText(error.name || 'Error'),
    code: redactDiagnosticText(error.code || ''),
    message: redactDiagnosticText(error.message || error),
  };
}

function appendDiagnosticLog(event, details = {}) {
  try {
    const entry = {
      at: new Date().toISOString(),
      event,
      ...details,
    };
    fs.mkdirSync(path.dirname(diagnosticLogPath()), { recursive: true });
    fs.appendFileSync(diagnosticLogPath(), `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // Le diagnostic ne doit jamais empêcher l'application de fonctionner.
  }
}

function recentDiagnosticEvents(limit = 80) {
  try {
    return fs.readFileSync(diagnosticLogPath(), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .slice(-limit)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
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

function probeUrl(url, { method = 'GET', timeoutMs = 4_000 } = {}) {
  return new Promise((resolve) => {
    const target = new URL(url);
    const transport = target.protocol === 'https:' ? https : http;
    const startedAt = Date.now();
    const request = transport.request(target, {
      method,
      headers: { 'User-Agent': 'Prospection-B2B-Diagnostic' },
    }, (response) => {
      response.resume();
      resolve({
        reachable: true,
        status: response.statusCode || null,
        duration_ms: Date.now() - startedAt,
      });
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy();
      resolve({
        reachable: false,
        duration_ms: Date.now() - startedAt,
        error: { name: 'TimeoutError', code: 'ETIMEDOUT', message: `Aucune réponse après ${timeoutMs} ms.` },
      });
    });
    request.on('error', (error) => resolve({
      reachable: false,
      duration_ms: Date.now() - startedAt,
      error: diagnosticError(error),
    }));
    request.end();
  });
}

async function probeBackend() {
  return probeUrl(`${BACKEND_URL}/api/status`, { timeoutMs: 800 });
}

async function pingBackend() {
  const probe = await probeBackend();
  return probe.reachable && probe.status >= 200 && probe.status < 300;
}

async function waitForBackend() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await pingBackend()) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

function logBackendOutput(stream, source) {
  if (!stream) return;
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    lines.filter(Boolean).forEach((line) => {
      appendDiagnosticLog(`backend.${source}`, { message: redactDiagnosticText(line) });
    });
  });
}

function scheduleBackendRestart(reason) {
  if (isQuitting || backendRestartTimer) return;
  const now = Date.now();
  backendRestartAttempts = backendRestartAttempts.filter((time) => now - time < BACKEND_RESTART_WINDOW_MS);
  if (backendRestartAttempts.length >= BACKEND_RESTART_MAX_ATTEMPTS) {
    appendDiagnosticLog('backend.restart_abandoned', { reason, attempts: backendRestartAttempts.length });
    return;
  }

  backendRestartTimer = setTimeout(async () => {
    backendRestartTimer = null;
    if (isQuitting || await pingBackend()) return;

    backendRestartAttempts.push(Date.now());
    backendState.lastRestartReason = reason;
    appendDiagnosticLog('backend.restart_attempt', { reason, attempt: backendRestartAttempts.length });
    startBackend();
    const healthy = await waitForBackend();
    appendDiagnosticLog('backend.restart_result', { healthy });
    if (!healthy) scheduleBackendRestart('backend indisponible après relance');
  }, 1_000);
}

function startBackend() {
  const cwd = backendDirectory();
  const child = spawn(process.execPath, [path.join(cwd, 'server.js')], {
    cwd,
    windowsHide: true,
    env: {
      ...process.env,
      ...readSecureConfig(),
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      PORT: String(BACKEND_PORT),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  backendProcess = child;
  backendState.startedAt = new Date().toISOString();
  backendState.lastError = null;
  appendDiagnosticLog('backend.start', { pid: child.pid || null });
  logBackendOutput(child.stdout, 'stdout');
  logBackendOutput(child.stderr, 'stderr');
  child.on('error', (error) => {
    backendState.lastError = diagnosticError(error);
    appendDiagnosticLog('backend.process_error', { error: backendState.lastError });
  });
  child.on('exit', (code, signal) => {
    const expectedStop = expectedBackendStops.delete(child.pid);
    if (backendProcess === child) backendProcess = null;
    backendState.lastExit = { at: new Date().toISOString(), code, signal: signal || null, expected: expectedStop };
    appendDiagnosticLog('backend.exit', backendState.lastExit);
    if (!isQuitting && !expectedStop) {
      console.error(`Le backend local s'est arrêté (code ${code}, signal ${signal || 'aucun'}).`);
      scheduleBackendRestart('arrêt inattendu du backend');
    }
  });
}

function stopBackend() {
  if (!backendProcess || backendProcess.killed) return;
  const child = backendProcess;
  if (child.pid) expectedBackendStops.add(child.pid);
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  } else {
    child.kill();
  }
  backendProcess = null;
}

async function restartBackend() {
  stopBackend();
  await new Promise((resolve) => setTimeout(resolve, 300));
  startBackend();
  if (!await waitForBackend()) throw new Error('Le serveur local ne redémarre pas.');
}

function startBackendHealthMonitor() {
  if (backendHealthTimer) return;
  backendHealthTimer = setInterval(async () => {
    if (isQuitting || backendCheckInFlight) return;
    backendCheckInFlight = true;
    try {
      if (!await pingBackend()) scheduleBackendRestart('surveillance de santé');
    } finally {
      backendCheckInFlight = false;
    }
  }, 15_000);
}

async function collectDiagnostics() {
  const [backend, googlePlaces, dropcontact] = await Promise.all([
    probeBackend(),
    probeUrl('https://places.googleapis.com/', { method: 'HEAD' }),
    probeUrl('https://api.dropcontact.io/', { method: 'HEAD' }),
  ]);
  let configuration;
  try {
    configuration = secureConfigStatus();
  } catch (error) {
    configuration = { available: false, error: diagnosticError(error) };
  }

  const report = {
    format: 'prospection-b2b-diagnostic-v1',
    generated_at: new Date().toISOString(),
    application: {
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      packaged: app.isPackaged,
    },
    backend: {
      url: BACKEND_URL,
      reachable: backend.reachable && backend.status >= 200 && backend.status < 300,
      http_status: backend.status || null,
      probe_error: backend.error || null,
      process_running: Boolean(backendProcess && backendProcess.exitCode === null && !backendProcess.killed),
      started_at: backendState.startedAt,
      last_exit: backendState.lastExit,
      last_error: backendState.lastError,
      last_restart_reason: backendState.lastRestartReason,
    },
    configuration: {
      secure_storage_available: Boolean(configuration.available),
      configured: configuration.configured || {},
      ready: Boolean(configuration.ready),
      error: configuration.error || null,
    },
    network: {
      google_places: googlePlaces,
      dropcontact,
      note: 'Un statut HTTP, même 401/404/405, confirme que le domaine est joignable. Aucune clé API n’est utilisée pour ce test.',
    },
    events: recentDiagnosticEvents(),
  };
  appendDiagnosticLog('diagnostic.collected', {
    backend_reachable: report.backend.reachable,
    google_reachable: googlePlaces.reachable,
    dropcontact_reachable: dropcontact.reachable,
  });
  return report;
}

ipcMain.handle('secure-config:status', () => secureConfigStatus());
ipcMain.handle('secure-config:save', async (_event, values) => {
  saveSecureConfig(values);
  await restartBackend();
  return secureConfigStatus();
});
ipcMain.handle('diagnostics:collect', () => collectDiagnostics());
ipcMain.handle('backend:restart', async () => {
  appendDiagnosticLog('backend.manual_restart');
  await restartBackend();
  return collectDiagnostics();
});

function configureAutoUpdates() {
  if (!app.isPackaged || process.platform !== 'win32') return;

  autoUpdater.on('error', (error) => {
    // Une panne de vérification ne doit jamais empêcher l'application de démarrer.
    console.warn(`Vérification de mise à jour impossible : ${error.message}`);
  });

  autoUpdater.on('update-downloaded', async (update) => {
    if (updatePromptShown || !mainWindow) return;
    updatePromptShown = true;
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Mise à jour prête',
      message: `La version ${update.version} de Prospection B2B est prête.`,
      detail: 'Redémarre maintenant pour l’installer. Tes réglages et données locales sont conservés.',
      buttons: ['Redémarrer et installer', 'Plus tard'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) autoUpdater.quitAndInstall(false, true);
  });

  // Laisse l'interface et le backend local démarrer avant toute requête réseau.
  setTimeout(() => autoUpdater.checkForUpdates(), 5_000);
}

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
  startBackendHealthMonitor();
  configureAutoUpdates();
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
  if (backendHealthTimer) clearInterval(backendHealthTimer);
  if (backendRestartTimer) clearTimeout(backendRestartTimer);
  stopBackend();
});
