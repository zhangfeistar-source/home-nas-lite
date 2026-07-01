'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  session,
  shell,
  Tray,
} = require('electron');
const {
  assertPasswordRules,
  ensureAppDataDirectories,
  hashPassword,
  readConfig,
  validateShareDirectory,
  writeConfig,
} = require('./config');
const { configureFirewall, FIREWALL_RULE_NAME } = require('./firewall');
const { startApplicationServer } = require('./server-runtime');

const APP_NAME = '家庭 NAS';
const APP_DATA_DIR = path.join(app.getPath('appData'), '家庭NAS');
const CONFIG_PATH = path.join(APP_DATA_DIR, 'config.json');
const WIZARD_PATH = path.join(__dirname, 'wizard', 'index.html');
const WIZARD_URL = pathToFileURL(WIZARD_PATH).href;
const SERVER_MODULE_PATH = path.join(app.getAppPath(), 'server', 'app.js');
const ICON_PATH = path.join(__dirname, 'assets', 'icon.ico');
const DIRECTORY_TOKEN_TTL_MS = 10 * 60 * 1000;

app.setPath('userData', APP_DATA_DIR);
app.setName(APP_NAME);

let mainWindow = null;
let tray = null;
let serverRuntime = null;
let currentConfig = null;
let applicationOrigin = null;
let startupError = null;
let setupInProgress = false;
let shutdownInProgress = false;
let shutdownComplete = false;
let closeHintShown = false;
const directoryTokens = new Map();

function messageFromError(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function createFallbackIcon() {
  return nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAK0lEQVR42mNk+M+ABzDhkxyMjIwM/5FhM4QKQRWMuhg1EGowamDUwKiBUAMAiJ8GH+8fXxQAAAAASUVORK5CYII=',
  );
}

function getApplicationIcon() {
  const icon = nativeImage.createFromPath(ICON_PATH);
  return icon.isEmpty() ? createFallbackIcon() : icon;
}

function isPrivateIpv4(address) {
  const parts = address.split('.').map(Number);
  return parts[0] === 10
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

function getLanAddresses(port = serverRuntime?.port) {
  if (!Number.isInteger(port)) {
    return [];
  }
  const addresses = [];
  for (const networkEntries of Object.values(os.networkInterfaces())) {
    for (const entry of networkEntries || []) {
      if (entry.family !== 'IPv4' || entry.internal || entry.address.startsWith('169.254.')) {
        continue;
      }
      addresses.push(entry.address);
    }
  }
  return [...new Set(addresses)]
    .sort((left, right) => Number(isPrivateIpv4(right)) - Number(isPrivateIpv4(left)) || left.localeCompare(right))
    .map((address) => `http://${address}:${port}`);
}

function getLocalUrl() {
  return serverRuntime ? `http://127.0.0.1:${serverRuntime.port}` : null;
}

function getPreferredLanUrl() {
  return getLanAddresses()[0] || getLocalUrl();
}

function isWizardNavigation(url) {
  return url === WIZARD_URL || url.startsWith(`${WIZARD_URL}?`);
}

function isApplicationNavigation(url) {
  if (!applicationOrigin) {
    return false;
  }
  try {
    return new URL(url).origin === applicationOrigin;
  } catch {
    return false;
  }
}

function isTrustedRendererUrl(url) {
  return isWizardNavigation(url) || isApplicationNavigation(url);
}

function openExternalSafely(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    void shell.openExternal(parsed.href);
    return true;
  } catch {
    return false;
  }
}

function secureWebContents(webContents) {
  webContents.setWindowOpenHandler(({ url }) => {
    if (!isApplicationNavigation(url) && !isWizardNavigation(url)) {
      openExternalSafely(url);
    }
    return { action: 'deny' };
  });
  webContents.on('will-navigate', (event, url) => {
    if (isWizardNavigation(url) || isApplicationNavigation(url)) {
      return;
    }
    event.preventDefault();
    openExternalSafely(url);
  });
  webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
}

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 760,
    minHeight: 620,
    show: false,
    title: APP_NAME,
    backgroundColor: '#edf3f8',
    icon: getApplicationIcon(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      devTools: !app.isPackaged,
    },
  });

  secureWebContents(window.webContents);
  window.once('ready-to-show', () => window.show());
  window.on('close', (event) => {
    if (shutdownInProgress || shutdownComplete) {
      return;
    }
    event.preventDefault();
    window.hide();
    if (!closeHintShown && tray) {
      closeHintShown = true;
      tray.displayBalloon({
        title: APP_NAME,
        content: '服务仍在后台运行。可从托盘打开，或选择“停止并退出”。',
        iconType: 'info',
      });
    }
  });
  return window;
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
    void loadCurrentPage().catch((error) => {
      void dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: '页面加载失败',
        message: messageFromError(error, '无法打开家庭 NAS 页面。'),
      });
    });
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function rebuildTrayMenu() {
  if (!tray) {
    return;
  }
  const lanAddresses = getLanAddresses();
  const addressItems = lanAddresses.length > 0
    ? lanAddresses.map((url) => ({ label: `局域网：${url}`, enabled: false }))
    : [{ label: serverRuntime ? '未发现可用的局域网 IPv4 地址' : '服务尚未启动', enabled: false }];

  tray.setToolTip(serverRuntime
    ? `${APP_NAME} - ${getPreferredLanUrl()}`
    : `${APP_NAME} - 等待设置`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开家庭 NAS', click: showMainWindow },
    { type: 'separator' },
    { label: getLocalUrl() ? `本机：${getLocalUrl()}` : '本机服务尚未启动', enabled: false },
    ...addressItems,
    {
      label: '复制局域网地址',
      enabled: Boolean(getPreferredLanUrl()),
      click: () => {
        const url = getPreferredLanUrl();
        if (url) {
          clipboard.writeText(url);
        }
      },
    },
    {
      label: '重新配置 Windows 防火墙…',
      enabled: Boolean(serverRuntime),
      click: () => void reconfigureFirewall(),
    },
    { type: 'separator' },
    { label: '停止并退出', click: () => void requestQuit() },
  ]));
}

function createTray() {
  tray = new Tray(getApplicationIcon());
  tray.on('double-click', showMainWindow);
  rebuildTrayMenu();
}

function senderUrl(event) {
  return event.senderFrame?.url || event.sender.getURL();
}

function assertWizardSender(event) {
  if (!isWizardNavigation(senderUrl(event))) {
    throw new Error('当前页面无权执行首次设置操作。');
  }
}

function assertTrustedSender(event) {
  if (!isTrustedRendererUrl(senderUrl(event))) {
    throw new Error('当前页面无权调用桌面功能。');
  }
}

function getProtectedPaths() {
  return [
    APP_DATA_DIR,
    app.getAppPath(),
    process.resourcesPath,
    process.env.SystemRoot,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.ProgramData,
  ];
}

function pruneDirectoryTokens() {
  const now = Date.now();
  for (const [token, selection] of directoryTokens) {
    if (selection.expiresAt <= now) {
      directoryTokens.delete(token);
    }
  }
}

async function chooseShareDirectory(event) {
  assertWizardSender(event);
  const suggestedPath = fs.existsSync('D:\\')
    ? 'D:\\家庭共享'
    : path.join(app.getPath('documents'), '家庭共享');
  await fs.promises.mkdir(suggestedPath, { recursive: true }).catch(() => {});
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择家庭共享目录',
    buttonLabel: '选择此文件夹',
    defaultPath: suggestedPath,
    properties: ['openDirectory', 'createDirectory'],
    message: '请选择专用文件夹，不要选择整个磁盘或系统目录。',
  });
  if (result.canceled || result.filePaths.length !== 1) {
    return { ok: false, canceled: true };
  }

  try {
    const shareRoot = await validateShareDirectory(result.filePaths[0], getProtectedPaths());
    pruneDirectoryTokens();
    const token = crypto.randomBytes(24).toString('base64url');
    directoryTokens.set(token, {
      path: shareRoot,
      senderId: event.sender.id,
      expiresAt: Date.now() + DIRECTORY_TOKEN_TTL_MS,
    });
    return { ok: true, token, path: shareRoot };
  } catch (error) {
    return { ok: false, message: messageFromError(error, '所选目录不可用。') };
  }
}

async function startServerForConfig(config) {
  const runtime = await startApplicationServer(SERVER_MODULE_PATH, {
    appDataDir: APP_DATA_DIR,
    dataDir: APP_DATA_DIR,
    configPath: CONFIG_PATH,
    config,
    shareRoot: config.shareRoot,
  });
  serverRuntime = runtime;
  applicationOrigin = `http://127.0.0.1:${runtime.port}`;
  rebuildTrayMenu();
  return runtime;
}

async function stopServer() {
  const runtime = serverRuntime;
  serverRuntime = null;
  applicationOrigin = null;
  rebuildTrayMenu();
  if (runtime) {
    await runtime.close();
  }
}

async function applyFirewall(config, showResultDialog) {
  if (!serverRuntime) {
    return '服务尚未启动，无法配置防火墙。';
  }
  try {
    await configureFirewall(serverRuntime.port);
    config.firewall = {
      enabled: true,
      configured: true,
      port: serverRuntime.port,
      ruleName: FIREWALL_RULE_NAME,
      remoteAddress: 'LocalSubnet',
      protocol: 'TCP',
      configuredAt: new Date().toISOString(),
    };
    await writeConfig(CONFIG_PATH, config);
    currentConfig = config;
    if (showResultDialog) {
      await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: '防火墙已配置',
        message: `已允许 LocalSubnet 通过 TCP 端口 ${serverRuntime.port} 访问。`,
      });
    }
    return null;
  } catch (error) {
    const warning = messageFromError(error, 'Windows 防火墙配置失败。');
    config.firewall = {
      enabled: true,
      configured: false,
      port: serverRuntime.port,
      ruleName: FIREWALL_RULE_NAME,
      remoteAddress: 'LocalSubnet',
      protocol: 'TCP',
      lastError: warning,
    };
    await writeConfig(CONFIG_PATH, config).catch(() => {});
    currentConfig = config;
    if (showResultDialog) {
      await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: '防火墙未配置',
        message: warning,
        detail: '本机仍可访问。若家庭设备无法连接，请从托盘重新配置并同意管理员授权。',
      });
    }
    return warning;
  }
}

async function reconfigureFirewall() {
  if (!currentConfig || !serverRuntime) {
    return;
  }
  await applyFirewall(currentConfig, true);
}

async function completeSetup(event, payload) {
  assertWizardSender(event);
  if (setupInProgress) {
    return { ok: false, message: '设置正在进行，请稍候。' };
  }
  setupInProgress = true;

  try {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('首次设置参数无效。');
    }
    const selection = directoryTokens.get(payload.directoryToken);
    if (!selection || selection.senderId !== event.sender.id || selection.expiresAt <= Date.now()) {
      throw new Error('目录选择已失效，请重新选择共享目录。');
    }
    assertPasswordRules(payload.accessCode, payload.adminPassword);
    const shareRoot = await validateShareDirectory(selection.path, getProtectedPaths());
    const [accessCodeHash, adminPasswordHash] = await Promise.all([
      hashPassword(payload.accessCode),
      hashPassword(payload.adminPassword),
    ]);
    const previousConfig = await readConfig(CONFIG_PATH);
    const configureWindowsFirewall = payload.configureFirewall === true;
    const nextConfig = {
      configVersion: 1,
      setupComplete: true,
      shareRoot,
      listenHost: '0.0.0.0',
      portRange: { start: 8787, end: 8799 },
      port: null,
      accessCodeHash,
      adminPasswordHash,
      sessionSecret: previousConfig?.sessionSecret || crypto.randomBytes(32).toString('hex'),
      version: app.getVersion(),
      firewall: {
        enabled: configureWindowsFirewall,
        configured: false,
        port: null,
        ruleName: FIREWALL_RULE_NAME,
        remoteAddress: 'LocalSubnet',
        protocol: 'TCP',
      },
      createdAt: previousConfig?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await writeConfig(CONFIG_PATH, nextConfig);
    try {
      if (serverRuntime) {
        await stopServer();
      }
      await startServerForConfig(nextConfig);
      nextConfig.port = serverRuntime.port;
      await writeConfig(CONFIG_PATH, nextConfig);
    } catch (error) {
      await stopServer().catch(() => {});
      if (previousConfig?.setupComplete) {
        await writeConfig(CONFIG_PATH, previousConfig).catch(() => {});
      } else {
        nextConfig.setupComplete = false;
        nextConfig.lastStartError = messageFromError(error, '服务启动失败。');
        await writeConfig(CONFIG_PATH, nextConfig).catch(() => {});
      }
      throw error;
    }

    currentConfig = nextConfig;
    directoryTokens.delete(payload.directoryToken);
    const warning = configureWindowsFirewall ? await applyFirewall(nextConfig, false) : null;
    const localUrl = getLocalUrl();
    const lanUrls = getLanAddresses();
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        void loadApplicationPage().catch((error) => {
          void dialog.showMessageBox(mainWindow, {
            type: 'error',
            title: '页面加载失败',
            message: messageFromError(error, '无法打开家庭 NAS 页面。'),
          });
        });
      }
    }, warning ? 2200 : 900);
    return { ok: true, localUrl, lanUrls, warning };
  } catch (error) {
    return { ok: false, message: messageFromError(error, '首次设置失败，请重试。') };
  } finally {
    setupInProgress = false;
  }
}

function registerIpcHandlers() {
  ipcMain.handle('setup:get-state', (event) => {
    assertWizardSender(event);
    return {
      configured: Boolean(currentConfig?.setupComplete),
      startupError,
      appDataDir: APP_DATA_DIR,
    };
  });
  ipcMain.handle('setup:choose-share-directory', chooseShareDirectory);
  ipcMain.handle('setup:complete', completeSetup);
  ipcMain.handle('desktop:get-state', (event) => {
    assertTrustedSender(event);
    return {
      running: Boolean(serverRuntime),
      port: serverRuntime?.port || null,
      localUrl: getLocalUrl(),
      lanUrls: getLanAddresses(),
    };
  });
  ipcMain.handle('desktop:copy-lan-address', (event) => {
    assertTrustedSender(event);
    const url = getPreferredLanUrl();
    if (!url) {
      return { ok: false, message: '当前没有可复制的访问地址。' };
    }
    clipboard.writeText(url);
    return { ok: true, url };
  });
  ipcMain.handle('desktop:open-external', (event, url) => {
    assertTrustedSender(event);
    return { ok: openExternalSafely(url) };
  });
}

async function loadWizardPage() {
  applicationOrigin = null;
  await mainWindow.loadFile(WIZARD_PATH);
}

async function loadApplicationPage() {
  const localUrl = getLocalUrl();
  if (!localUrl) {
    await loadWizardPage();
    return;
  }
  applicationOrigin = new URL(localUrl).origin;
  await mainWindow.loadURL(localUrl);
}

async function loadCurrentPage() {
  if (serverRuntime) {
    await loadApplicationPage();
  } else {
    await loadWizardPage();
  }
}

async function startConfiguredApplication(config) {
  const shareRoot = await validateShareDirectory(config.shareRoot, getProtectedPaths());
  config.shareRoot = shareRoot;
  await startServerForConfig(config);
  config.port = serverRuntime.port;
  config.updatedAt = new Date().toISOString();
  await writeConfig(CONFIG_PATH, config);
  currentConfig = config;
  await loadApplicationPage();
  const firewallNeedsUpdate = config.firewall?.enabled
    && (!config.firewall.configured || config.firewall.port !== serverRuntime.port);
  if (firewallNeedsUpdate) {
    const warning = await applyFirewall(config, false);
    if (warning) {
      await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: '家庭网络访问可能受限',
        message: warning,
        detail: '本机服务已启动。可从托盘重新配置 Windows 防火墙。',
      });
    }
  }
}

async function requestQuit() {
  if (shutdownInProgress || shutdownComplete) {
    return;
  }
  shutdownInProgress = true;
  try {
    await stopServer();
  } catch (error) {
    await dialog.showMessageBox({
      type: 'warning',
      title: '服务关闭提示',
      message: messageFromError(error, 'HTTP 服务未能正常关闭。'),
      detail: '应用将继续退出。',
    }).catch(() => {});
  } finally {
    tray?.destroy();
    tray = null;
    shutdownComplete = true;
    app.quit();
  }
}

async function bootstrap() {
  await ensureAppDataDirectories(APP_DATA_DIR);
  app.setAppLogsPath(path.join(APP_DATA_DIR, 'logs'));
  app.setAppUserModelId('cn.family.nas.lite');

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  registerIpcHandlers();
  mainWindow = createMainWindow();
  createTray();

  try {
    currentConfig = await readConfig(CONFIG_PATH);
    if (currentConfig?.setupComplete) {
      await startConfiguredApplication(currentConfig);
    } else {
      await loadWizardPage();
    }
  } catch (error) {
    startupError = messageFromError(error, '应用启动失败。');
    await stopServer().catch(() => {});
    await loadWizardPage();
    await dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: '家庭 NAS 启动失败',
      message: startupError,
      detail: '请检查共享目录和配置，或在向导中重新设置。',
    });
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());
  app.on('before-quit', (event) => {
    if (shutdownComplete) {
      return;
    }
    event.preventDefault();
    void requestQuit();
  });
  app.on('window-all-closed', () => {});
  app.whenReady().then(bootstrap).catch(async (error) => {
    await dialog.showErrorBox('家庭 NAS 无法启动', messageFromError(error, '初始化失败。'));
    shutdownComplete = true;
    app.quit();
  });
}
