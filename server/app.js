'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const archiver = require('archiver');
const asyncHandler = require('../shared/async-handler');
const { ApiError, assertApi } = require('../shared/api-error');
const {
  resolveCredential,
  verifyCredential
} = require('./services/credentials');
const { PathSecurity } = require('./services/path-security');
const RecentService = require('./services/recent-service');
const { FileService } = require('./services/file-service');
const { RecycleService } = require('./services/recycle-service');

const DEFAULT_START_PORT = 8787;
const DEFAULT_END_PORT = 8799;
const DEFAULT_UPLOAD_LIMIT = 20 * 1024 * 1024 * 1024;
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_MAX_FAILURES = 8;

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {};
    }
    throw new ApiError(500, '应用配置文件损坏，无法启动');
  }
}

async function writeJsonFile(filePath, value) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.promises.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
  await fs.promises.rename(temporaryPath, filePath);
}

function resolveRuntimeOptions(options) {
  const defaultDataDir = path.join(
    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    '家庭NAS'
  );
  const dataDir = path.resolve(options.dataDir || process.env.HOME_NAS_DATA_DIR || defaultDataDir);
  const configPath = options.configPath || path.join(dataDir, 'config.json');
  const diskConfig = options.loadConfig === false ? {} : readJsonFile(configPath);
  const config = { ...diskConfig, ...(options.config || {}) };
  const shareRoot = options.shareRoot || process.env.HOME_NAS_SHARE_ROOT || config.shareRoot;
  if (!shareRoot) {
    throw new ApiError(500, '尚未配置共享目录');
  }

  fs.mkdirSync(dataDir, { recursive: true });
  const temporaryDirectory = path.join(dataDir, 'data', 'uploads');
  fs.mkdirSync(temporaryDirectory, { recursive: true });

  return {
    config,
    configPath,
    dataDir,
    temporaryDirectory,
    shareRoot: path.resolve(shareRoot),
    accessCredential: resolveCredential(
      options.accessCodeHash ||
        config.accessCodeHash ||
        config.accessCode ||
        config.auth?.accessCodeHash ||
        config.credentials?.accessCode,
      options.accessCode || process.env.HOME_NAS_TEST_ACCESS_CODE
    ),
    adminCredential: resolveCredential(
      options.adminPasswordHash ||
        config.adminPasswordHash ||
        config.adminPassword ||
        config.auth?.adminPasswordHash ||
        config.credentials?.adminPassword,
      options.adminPassword || process.env.HOME_NAS_TEST_ADMIN_PASSWORD
    ),
    sessionSecret:
      options.sessionSecret ||
      config.sessionSecret ||
      crypto.randomBytes(32).toString('hex'),
    version: options.version || config.version || '1.0.0',
    port: Number(options.port ?? config.port ?? process.env.HOME_NAS_PORT ?? DEFAULT_START_PORT),
    uploadLimitBytes: Number(options.uploadLimitBytes || DEFAULT_UPLOAD_LIMIT),
    persistPort: options.persistPort !== false
  };
}

function requireAuthentication(request, response, next) {
  if (!request.session?.authenticated) {
    next(new ApiError(401, '请先登录'));
    return;
  }
  next();
}

function createLoginLimiter() {
  const failures = new Map();
  return {
    assertAllowed(key) {
      const now = Date.now();
      const state = failures.get(key);
      if (!state || now - state.startedAt >= LOGIN_WINDOW_MS) {
        failures.delete(key);
        return;
      }
      if (state.count >= LOGIN_MAX_FAILURES) {
        throw new ApiError(429, '登录失败次数过多，请稍后再试');
      }
    },
    fail(key) {
      const now = Date.now();
      const state = failures.get(key);
      if (!state || now - state.startedAt >= LOGIN_WINDOW_MS) {
        failures.set(key, { count: 1, startedAt: now });
      } else {
        state.count += 1;
      }
    },
    clear(key) {
      failures.delete(key);
    }
  };
}

function contentDisposition(disposition, fileName) {
  const cleaned = String(fileName).replace(/[\r\n"]/g, '_');
  const fallback = cleaned.replace(/[^\x20-\x7e]/g, '_') || 'download';
  const encoded = encodeURIComponent(cleaned)
    .replace(/['()]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, '%2A');
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function parseSingleRange(value, size) {
  if (typeof value !== 'string' || !/^bytes=\d*-\d*$/.test(value) || value.includes(',')) {
    const error = new ApiError(416, 'Range 请求格式无效', 'INVALID_RANGE');
    error.fileSize = size;
    throw error;
  }
  const [startText, endText] = value.slice(6).split('-');
  if (!startText && !endText) {
    const error = new ApiError(416, 'Range 请求格式无效', 'INVALID_RANGE');
    error.fileSize = size;
    throw error;
  }

  let start;
  let end;
  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0 || size === 0) {
      const error = new ApiError(416, 'Range 超出文件范围', 'INVALID_RANGE');
      error.fileSize = size;
      throw error;
    }
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : size - 1;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      start >= size
    ) {
      const error = new ApiError(416, 'Range 超出文件范围', 'INVALID_RANGE');
      error.fileSize = size;
      throw error;
    }
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

async function diskStatus(shareRoot) {
  if (typeof fs.promises.statfs !== 'function') {
    return null;
  }
  try {
    const stats = await fs.promises.statfs(shareRoot, { bigint: true });
    const total = stats.bsize * stats.blocks;
    const free = stats.bsize * stats.bavail;
    return {
      total: Number(total),
      free: Number(free),
      used: Number(total - free)
    };
  } catch {
    return null;
  }
}

function localAddresses(port) {
  const addresses = [];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const info of interfaces || []) {
      if (info.family === 'IPv4' && !info.internal) {
        addresses.push({
          address: info.address,
          url: `http://${info.address}:${port}`
        });
      }
    }
  }
  return addresses;
}

function createApp(options = {}) {
  const runtime = resolveRuntimeOptions(options);
  const pathSecurity = new PathSecurity(runtime.shareRoot);
  const recentService = new RecentService(
    path.join(runtime.dataDir, 'recent-files.json'),
    pathSecurity
  );
  const fileService = new FileService(pathSecurity, recentService);
  const recycleService = new RecycleService(
    pathSecurity,
    path.join(runtime.dataDir, 'recycle-bin-index.json')
  );
  const loginLimiter = createLoginLimiter();
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.locals.runtime = runtime;
  app.locals.services = {
    fileService,
    pathSecurity,
    recentService,
    recycleService
  };

  app.use(express.json({ limit: '1mb', strict: true }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use(session({
    name: 'home-nas.sid',
    secret: runtime.sessionSecret,
    store: options.sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'strict',
      secure: false
    }
  }));

  app.post('/api/auth/login', asyncHandler(async (request, response) => {
    const key = request.socket.remoteAddress || request.ip || 'unknown';
    loginLimiter.assertAllowed(key);
    const accessCode = request.body?.accessCode;
    assertApi(typeof accessCode === 'string' && accessCode.length > 0, 400, '请输入家庭访问码');
    if (!runtime.accessCredential || !(await verifyCredential(accessCode, runtime.accessCredential))) {
      loginLimiter.fail(key);
      throw new ApiError(401, '家庭访问码错误');
    }
    loginLimiter.clear(key);
    await new Promise((resolve, reject) => {
      request.session.regenerate((error) => error ? reject(error) : resolve());
    });
    request.session.authenticated = true;
    await new Promise((resolve, reject) => {
      request.session.save((error) => error ? reject(error) : resolve());
    });
    response.json({ ok: true, authenticated: true });
  }));

  app.post('/api/auth/logout', asyncHandler(async (request, response) => {
    if (!request.session) {
      response.json({ ok: true });
      return;
    }
    await new Promise((resolve, reject) => {
      request.session.destroy((error) => error ? reject(error) : resolve());
    });
    response.clearCookie('home-nas.sid', {
      httpOnly: true,
      sameSite: 'strict',
      secure: false
    });
    response.json({ ok: true });
  }));

  app.get('/api/auth/me', (request, response) => {
    response.json({
      ok: true,
      authenticated: Boolean(request.session?.authenticated)
    });
  });

  app.use('/api/files', requireAuthentication);
  app.use('/api/recycle', requireAuthentication);
  app.use('/api/recent', requireAuthentication);
  app.use('/api/system/status', requireAuthentication);
  app.use('/api/admin', requireAuthentication);

  const verifyAdminPassword = async (value) => {
    if (!runtime.adminCredential || !(await verifyCredential(value, runtime.adminCredential))) {
      throw new ApiError(403, '管理员密码错误');
    }
  };

  app.post('/api/admin/verify', asyncHandler(async (request, response) => {
    await verifyAdminPassword(request.body?.adminPassword);
    response.json({ ok: true, verified: true });
  }));

  app.get('/api/files/list', asyncHandler(async (request, response) => {
    const result = await fileService.list(request.query.path ?? '');
    response.json({ ok: true, ...result });
  }));

  app.get('/api/files/search', asyncHandler(async (request, response) => {
    const result = await fileService.search(request.query.query, request.query.path ?? '');
    response.json({ ok: true, ...result });
  }));

  const upload = multer({
    dest: runtime.temporaryDirectory,
    limits: {
      fileSize: runtime.uploadLimitBytes,
      files: 100,
      fields: 20
    }
  });

  app.post('/api/files/upload', upload.array('files', 100), asyncHandler(async (request, response) => {
    const temporaryPaths = (request.files || []).map((file) => file.path);
    try {
      const items = await fileService.upload(
        request.files,
        request.body?.path || '',
        request.body?.conflict
      );
      response.json({ ok: true, items });
    } finally {
      await Promise.allSettled(temporaryPaths.map((filePath) =>
        fs.promises.unlink(filePath).catch((error) => {
          if (error.code !== 'ENOENT') {
            throw error;
          }
        })
      ));
    }
  }));

  app.post('/api/files/folder', asyncHandler(async (request, response) => {
    const item = await fileService.createFolder(request.body?.path || '', request.body?.name);
    response.json({ ok: true, item });
  }));

  app.post('/api/files/rename', asyncHandler(async (request, response) => {
    const item = await fileService.rename(
      request.body?.path,
      request.body?.newName,
      request.body?.conflict
    );
    response.json({ ok: true, item });
  }));

  app.post('/api/files/move', asyncHandler(async (request, response) => {
    const items = await fileService.move(
      request.body?.paths,
      request.body?.destination || '',
      request.body?.conflict
    );
    response.json({ ok: true, items });
  }));

  app.post('/api/files/delete', asyncHandler(async (request, response) => {
    const items = await recycleService.delete(request.body?.paths);
    response.json({ ok: true, items });
  }));

  app.get('/api/files/download', asyncHandler(async (request, response) => {
    const file = await fileService.getDownload(request.query.path);
    response.set({
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(file.stat.size),
      'Content-Disposition': contentDisposition('attachment', file.name),
      'X-Content-Type-Options': 'nosniff'
    });
    fs.createReadStream(file.path).on('error', (error) => response.destroy(error)).pipe(response);
  }));

  app.post('/api/files/download-zip', asyncHandler(async (request, response) => {
    const selectedPaths = fileService.normalizePaths(request.body?.paths);
    for (const selectedPath of selectedPaths) {
      await pathSecurity.resolveExisting(selectedPath, { allowRoot: false });
    }
    response.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': contentDisposition('attachment', '家庭NAS下载.zip'),
      'X-Content-Type-Options': 'nosniff'
    });
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('warning', (error) => {
      if (error.code !== 'ENOENT') {
        response.destroy(error);
      }
    });
    archive.on('error', (error) => response.destroy(error));
    archive.pipe(response);
    await fileService.addPathsToArchive(archive, selectedPaths);
    await archive.finalize();
  }));

  app.get('/api/files/stream', asyncHandler(async (request, response) => {
    const file = await fileService.getDownload(request.query.path);
    const rangeHeader = request.headers.range;
    if (!rangeHeader) {
      response.set({
        'Accept-Ranges': 'bytes',
        'Content-Type': file.mimeType,
        'Content-Length': String(file.stat.size),
        'X-Content-Type-Options': 'nosniff'
      });
      fs.createReadStream(file.path).on('error', (error) => response.destroy(error)).pipe(response);
      return;
    }
    const range = parseSingleRange(rangeHeader, file.stat.size);
    response.status(206);
    response.set({
      'Accept-Ranges': 'bytes',
      'Content-Type': file.mimeType,
      'Content-Range': `bytes ${range.start}-${range.end}/${file.stat.size}`,
      'Content-Length': String(range.end - range.start + 1),
      'X-Content-Type-Options': 'nosniff'
    });
    fs.createReadStream(file.path, range)
      .on('error', (error) => response.destroy(error))
      .pipe(response);
  }));

  app.get('/api/files/text', asyncHandler(async (request, response) => {
    const result = await fileService.readText(request.query.path);
    response.json({ ok: true, ...result });
  }));

  app.get('/api/files/meta', asyncHandler(async (request, response) => {
    const metadata = await fileService.metadata(request.query.path);
    response.json({ ok: true, ...metadata });
  }));

  app.get('/api/recycle/list', asyncHandler(async (request, response) => {
    const items = await recycleService.list();
    response.json({ ok: true, items });
  }));

  app.post('/api/recycle/restore', asyncHandler(async (request, response) => {
    const items = await recycleService.restore(request.body?.ids, request.body?.conflict);
    response.json({ ok: true, items });
  }));

  app.post('/api/recycle/purge', asyncHandler(async (request, response) => {
    assertApi(request.body?.confirm === true, 400, '请确认永久删除');
    await verifyAdminPassword(request.body?.adminPassword);
    const removed = await recycleService.purge(request.body?.ids);
    response.json({ ok: true, removed });
  }));

  app.post('/api/recycle/empty', asyncHandler(async (request, response) => {
    assertApi(request.body?.confirm === true, 400, '请确认清空回收站');
    await verifyAdminPassword(request.body?.adminPassword);
    const removed = await recycleService.empty();
    response.json({ ok: true, removed });
  }));

  app.get('/api/recent', asyncHandler(async (request, response) => {
    const items = await recentService.list();
    response.json({ ok: true, items });
  }));

  app.get('/api/system/status', asyncHandler(async (request, response) => {
    const port = app.locals.runtime.port;
    const addresses = localAddresses(port);
    response.json({
      ok: true,
      shareRoot: pathSecurity.shareRoot,
      port,
      ip: addresses[0]?.address || null,
      addresses,
      disk: await diskStatus(pathSecurity.shareRoot),
      version: runtime.version,
      firewallHint: `仅应允许局域网 LocalSubnet 访问 TCP ${port} 端口`
    });
  }));

  const publicDirectory = options.publicDirectory || path.join(__dirname, '..', 'public');
  if (fs.existsSync(publicDirectory)) {
    app.use(express.static(publicDirectory, {
      dotfiles: 'ignore',
      etag: true,
      fallthrough: true,
      index: 'index.html'
    }));
  }

  app.use('/api', (request, response) => {
    response.status(404).json({ ok: false, message: '接口不存在' });
  });

  app.use((request, response) => {
    response.status(404).type('text/plain; charset=utf-8').send('页面不存在');
  });

  app.use((error, request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }

    let status = error.status || error.statusCode || 500;
    let message = error.message || '服务器内部错误';
    if (error instanceof multer.MulterError) {
      status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      message = error.code === 'LIMIT_FILE_SIZE' ? '上传文件过大' : '上传请求格式错误';
    } else if (error instanceof SyntaxError && error.type === 'entity.parse.failed') {
      status = 400;
      message = 'JSON 请求格式错误';
    } else if (!(error instanceof ApiError) && status >= 500) {
      message = '服务器内部错误';
    }
    if (status === 416 && Number.isFinite(error.fileSize)) {
      response.set('Content-Range', `bytes */${error.fileSize}`);
    }
    response.status(status).json({ ok: false, message });
  });

  const cleanupInterval = setInterval(() => {
    recycleService.cleanupExpired().catch(() => {});
  }, 24 * 60 * 60 * 1000);
  cleanupInterval.unref();
  recycleService.cleanupExpired().catch(() => {});
  app.locals.dispose = () => clearInterval(cleanupInterval);

  return app;
}

function listenOnce(app, port, host) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host);
    const onError = (error) => {
      server.removeListener('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve(server);
    };
    server.once('error', onError);
    server.once('listening', onListening);
  });
}

async function startServer(options = {}) {
  const app = options.app || createApp(options);
  const host = options.host || '0.0.0.0';
  const configuredPort = Number(options.port ?? app.locals.runtime.port ?? DEFAULT_START_PORT);
  const endPort = Number(options.endPort ?? DEFAULT_END_PORT);
  assertApi(
    Number.isInteger(configuredPort) && configuredPort >= 0 && configuredPort <= 65535,
    500,
    '服务端口配置无效'
  );
  const ports = configuredPort === 0
    ? [0]
    : Array.from(
      { length: Math.max(1, endPort - configuredPort + 1) },
      (_, index) => configuredPort + index
    ).filter((port) => port <= 65535);

  let lastError;
  for (const port of ports) {
    try {
      const server = await listenOnce(app, port, host);
      const actualPort = server.address().port;
      app.locals.runtime.port = actualPort;
      if (app.locals.runtime.persistPort) {
        try {
          const config = readJsonFile(app.locals.runtime.configPath);
          await writeJsonFile(app.locals.runtime.configPath, { ...config, port: actualPort });
        } catch (error) {
          await new Promise((resolve) => server.close(resolve));
          app.locals.dispose?.();
          throw error;
        }
      }
      return {
        app,
        server,
        host,
        port: actualPort,
        close: () => new Promise((resolve, reject) => {
          app.locals.dispose?.();
          server.close((error) => error ? reject(error) : resolve());
        })
      };
    } catch (error) {
      lastError = error;
      if (error.code !== 'EADDRINUSE') {
        app.locals.dispose?.();
        throw error;
      }
    }
  }
  app.locals.dispose?.();
  throw new ApiError(500, `端口 ${configuredPort}-${endPort} 均已被占用`, lastError?.code);
}

module.exports = createApp;
module.exports.createApp = createApp;
module.exports.startServer = startServer;
module.exports.contentDisposition = contentDisposition;
module.exports.parseSingleRange = parseSingleRange;
