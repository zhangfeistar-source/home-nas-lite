'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const failures = [];

function fail(message) {
  failures.push(message);
}

function readText(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(absolutePath)) {
    fail(`缺少文件：${relativePath}`);
    return '';
  }
  return fs.readFileSync(absolutePath, 'utf8');
}

function requireFile(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    fail(`缺少文件：${relativePath}`);
  }
}

function requirePattern(content, pattern, message) {
  if (!pattern.test(content)) {
    fail(message);
  }
}

function verifyPackageConfiguration() {
  let packageJson;
  try {
    packageJson = JSON.parse(readText('package.json'));
  } catch {
    fail('package.json 不是有效 JSON。');
    return;
  }

  if (packageJson.main !== 'electron/main.js') {
    fail('package.json main 必须指向 electron/main.js。');
  }
  for (const scriptName of ['dev', 'test', 'copy-vendor', 'verify', 'dist']) {
    if (typeof packageJson.scripts?.[scriptName] !== 'string') {
      fail(`package.json 缺少 ${scriptName} 脚本。`);
    }
  }
  if (packageJson.build?.asar !== true) {
    fail('electron-builder 必须启用 asar。');
  }
  if (packageJson.build?.win?.icon !== 'build/icon.ico') {
    fail('Windows 构建图标必须为 build/icon.ico。');
  }
  if (packageJson.build?.nsis?.include !== 'build/installer.nsh') {
    fail('NSIS 必须包含 build/installer.nsh。');
  }
  if (packageJson.build?.nsis?.deleteAppDataOnUninstall !== false) {
    fail('卸载器必须默认保留应用数据。');
  }
  const packagedFiles = packageJson.build?.files || [];
  for (const requiredEntry of ['electron/**/*', 'server/**/*', 'public/**/*']) {
    if (!packagedFiles.includes(requiredEntry)) {
      fail(`electron-builder files 缺少 ${requiredEntry}。`);
    }
  }
}

function verifyElectronSecurity() {
  const mainSource = readText('electron/main.js');
  const preloadSource = readText('electron/preload.js');
  const firewallSource = readText('electron/firewall.js');

  requirePattern(mainSource, /contextIsolation:\s*true/, 'Electron 必须启用 contextIsolation。');
  requirePattern(mainSource, /nodeIntegration:\s*false/, 'Electron 必须禁用 nodeIntegration。');
  requirePattern(mainSource, /sandbox:\s*true/, 'Electron 渲染器必须启用 sandbox。');
  requirePattern(mainSource, /setWindowOpenHandler/, 'Electron 必须拦截新窗口。');
  requirePattern(mainSource, /will-navigate/, 'Electron 必须限制页面导航。');
  requirePattern(mainSource, /will-attach-webview/, 'Electron 必须禁止 webview。');
  requirePattern(mainSource, /requestSingleInstanceLock/, 'Electron 必须使用单实例锁。');
  requirePattern(firewallSource, /LocalSubnet/, '防火墙远端地址必须固定为 LocalSubnet。');
  requirePattern(firewallSource, /protocol=TCP/, '防火墙协议必须固定为 TCP。');

  if (/contextIsolation:\s*false|nodeIntegration:\s*true|sandbox:\s*false/.test(mainSource)) {
    fail('发现削弱 Electron 隔离设置的配置。');
  }

  const allowedChannels = new Set([
    'setup:get-state',
    'setup:choose-share-directory',
    'setup:complete',
    'desktop:get-state',
    'desktop:copy-lan-address',
    'desktop:open-external',
  ]);
  const referencedChannels = [...preloadSource.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)]
    .map((match) => match[1]);
  if (referencedChannels.length === 0) {
    fail('preload 未暴露任何受控 IPC。');
  }
  for (const channel of referencedChannels) {
    if (!allowedChannels.has(channel)) {
      fail(`preload 暴露了未批准的 IPC：${channel}`);
    }
  }
  if (/ipcRenderer\.(send|on|once|sendSync)|\brequire\b\s*:\s*require/.test(preloadSource)) {
    fail('preload 不得暴露通用消息或 Node require 能力。');
  }
}

function verifyInstaller() {
  const installer = readText('build/installer.nsh');
  requirePattern(installer, /MB_DEFBUTTON2/, '卸载器删除应用数据的选项必须默认为“否”。');
  requirePattern(installer, /家庭共享目录始终保留|不会删除您选择的家庭共享目录/, '卸载器必须用中文说明共享目录会保留。');
  requirePattern(installer, /RMDir \/r "\$APPDATA\\家庭NAS"/, '卸载器仅可按明确选择删除应用数据目录。');
}

function verifyIcon() {
  const iconPath = path.join(ROOT, 'build', 'icon.ico');
  if (!fs.existsSync(iconPath)) {
    fail('缺少 build/icon.ico。');
    return;
  }
  const icon = fs.readFileSync(iconPath);
  if (icon.length < 22 || icon.readUInt16LE(0) !== 0 || icon.readUInt16LE(2) !== 1 || icon.readUInt16LE(4) < 1) {
    fail('build/icon.ico 不是有效的 ICO 文件。');
  }
}

function verifyOfflineAssets() {
  for (const relativePath of [
    'public/vendor/mammoth.browser.min.js',
    'public/vendor/xlsx.full.min.js',
    'public/vendor/flv.min.js',
    'public/vendor/pdfjs/pdf.min.mjs',
    'public/vendor/pdfjs/pdf.worker.min.mjs',
    'public/vendor/pdfjs/cmaps/Adobe-CNS1-UCS2.bcmap',
    'public/vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf',
    'public/vendor/pdfjs/wasm/openjpeg.wasm',
  ]) {
    requireFile(relativePath);
  }

  const appSource = readText('public/app.js');
  requirePattern(
    appSource,
    /import\("\.\/vendor\/pdfjs\/pdf\.min\.mjs"\)/,
    '前端必须从本地加载 PDF.js。',
  );
  requirePattern(
    appSource,
    /pdfjs\.getDocument\(/,
    '前端必须使用 PDF.js 渲染 PDF。',
  );
  requirePattern(
    appSource,
    /mammoth|preview\.html|sanitizePreviewHtml/,
    '前端必须支持经过清洗的 Word HTML 预览。',
  );

  const scanRoots = ['electron', 'public'];
  const externalAssetPattern = /<(?:script|link|img)\b[^>]*(?:src|href)=["']https?:\/\//i;
  for (const scanRoot of scanRoots) {
    const absoluteRoot = path.join(ROOT, scanRoot);
    if (!fs.existsSync(absoluteRoot)) {
      continue;
    }
    const pending = [absoluteRoot];
    while (pending.length > 0) {
      const current = pending.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const entryPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          pending.push(entryPath);
        } else if (/\.(?:html|css|js)$/i.test(entry.name)) {
          const content = fs.readFileSync(entryPath, 'utf8');
          if (externalAssetPattern.test(content)) {
            fail(`发现外部静态资源引用：${path.relative(ROOT, entryPath)}`);
          }
        }
      }
    }
  }
}

for (const requiredFile of [
  'electron/main.js',
  'electron/preload.js',
  'electron/wizard/index.html',
  'electron/wizard/wizard.css',
  'electron/wizard/wizard.js',
  'electron/assets/icon.ico',
  'server/app.js',
  'public/index.html',
  'build/installer.nsh',
  'scripts/copy-vendor-assets.js',
]) {
  requireFile(requiredFile);
}

verifyPackageConfiguration();
verifyElectronSecurity();
verifyInstaller();
verifyIcon();
verifyOfflineAssets();

if (failures.length > 0) {
  console.error('安装包检查失败：');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log('安装包检查通过：静态资源、Electron 安全配置、图标和卸载策略均符合要求。');
}
