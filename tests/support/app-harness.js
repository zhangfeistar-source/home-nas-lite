'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const supertest = require('supertest');

const ACCESS_CODE = '家庭访问-2468';
const ADMIN_PASSWORD = '管理员验证-1357';
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function loadCreateApp() {
  const appModule = require(path.join(PROJECT_ROOT, 'server', 'app.js'));
  const factory =
    appModule.createApp ||
    appModule.default?.createApp ||
    appModule.default ||
    (typeof appModule === 'function' ? appModule : null);

  assert.equal(typeof factory, 'function', 'server/app.js 必须导出 createApp(options)');
  return factory;
}

async function findPasswordHash(secret) {
  const moduleCandidates = [
    'server/services/auth.js',
    'server/services/auth-service.js',
    'server/services/credentials.js',
    'server/services/password.js',
    'server/security/password.js',
    'shared/password.js',
  ];
  const functionCandidates = [
    'hashPassword',
    'hashCredentialSync',
    'hashSecret',
    'createPasswordHash',
    'createSecretHash',
    'scryptHash',
  ];

  for (const relativePath of moduleCandidates) {
    const absolutePath = path.join(PROJECT_ROOT, relativePath);
    if (!fs.existsSync(absolutePath)) continue;

    const candidateModule = require(absolutePath);
    for (const functionName of functionCandidates) {
      if (typeof candidateModule[functionName] === 'function') {
        return candidateModule[functionName](secret);
      }
    }
  }

  return undefined;
}

async function createFixture(appOptions = {}) {
  const fixtureRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'home-nas-lite-test-'));
  const dataDir = path.join(fixtureRoot, 'data');
  const shareRoot = path.join(fixtureRoot, 'share');
  const uploadTempDir = path.join(dataDir, 'data', 'uploads');
  await Promise.all([
    fsp.mkdir(dataDir, { recursive: true }),
    fsp.mkdir(shareRoot, { recursive: true }),
    fsp.mkdir(uploadTempDir, { recursive: true }),
  ]);

  const [accessCodeHash, adminPasswordHash] = await Promise.all([
    findPasswordHash(ACCESS_CODE),
    findPasswordHash(ADMIN_PASSWORD),
  ]);
  const config = {
    shareRoot,
    uploadTempDir,
    port: 0,
    sessionSecret: crypto.randomBytes(32).toString('hex'),
    accessCode: ACCESS_CODE,
    adminPassword: ADMIN_PASSWORD,
    accessCodeHash,
    adminPasswordHash,
    credentials: {
      accessCode: ACCESS_CODE,
      adminPassword: ADMIN_PASSWORD,
      accessCodeHash,
      adminPasswordHash,
    },
  };
  const options = {
    config,
    dataDir,
    shareRoot,
    uploadTempDir,
    tempDir: uploadTempDir,
    sessionSecret: config.sessionSecret,
    accessCode: ACCESS_CODE,
    adminPassword: ADMIN_PASSWORD,
    verifyAccessCode: async (value) => value === ACCESS_CODE,
    verifyAdminPassword: async (value) => value === ADMIN_PASSWORD,
    ...appOptions,
  };

  let created;
  try {
    created = await loadCreateApp()(options);
  } catch (error) {
    await fsp.rm(fixtureRoot, { recursive: true, force: true });
    throw error;
  }

  const app = created?.app || created;
  assert.equal(typeof app?.listen, 'function', 'createApp() 应返回 Express app 或 { app }');

  return {
    app,
    agent: supertest.agent(app),
    config,
    dataDir,
    fixtureRoot,
    shareRoot,
    async close() {
      if (typeof created?.close === 'function') await created.close();
      if (typeof created?.dispose === 'function') await created.dispose();
      if (typeof app.locals?.dispose === 'function') app.locals.dispose();
      await fsp.rm(fixtureRoot, { recursive: true, force: true });
    },
  };
}

async function login(fixture, accessCode = ACCESS_CODE) {
  return fixture.agent.post('/api/auth/login').send({ accessCode });
}

function assertSuccess(response, allowedStatuses = [200, 201]) {
  assert.ok(
    allowedStatuses.includes(response.status),
    `预期状态码 ${allowedStatuses.join('/')}，实际 ${response.status}: ${JSON.stringify(response.body)}`,
  );
  assert.equal(response.body?.ok, true, '成功 JSON 必须包含 ok:true');
}

function assertChineseError(response, status) {
  assert.equal(response.status, status, JSON.stringify(response.body));
  assert.equal(response.body?.ok, false, '错误 JSON 必须包含 ok:false');
  assert.equal(typeof response.body?.message, 'string', '错误 JSON 必须包含 message');
  assert.match(response.body.message, /[\u3400-\u9fff]/u, '错误说明必须使用中文');
}

function responseItems(response) {
  assert.ok(Array.isArray(response.body?.items), '响应必须包含 items 数组');
  return response.body.items;
}

function itemName(item) {
  return item.name ?? item.fileName ?? path.posix.basename(item.path ?? item.relativePath ?? '');
}

function itemPath(item) {
  return item.path ?? item.relativePath ?? item.originalPath ?? '';
}

function recycleId(item) {
  return item.id ?? item.recycleId ?? item.uuid;
}

function binaryParser(response, callback) {
  const chunks = [];
  response.on('data', (chunk) => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
}

async function upload(fixture, destination, name, contents, conflict = 'cancel') {
  return fixture.agent
    .post('/api/files/upload')
    .field('path', destination)
    .field('conflict', conflict)
    .attach('files', Buffer.from(contents), { filename: name, contentType: 'application/octet-stream' });
}

module.exports = {
  ACCESS_CODE,
  ADMIN_PASSWORD,
  assertChineseError,
  assertSuccess,
  binaryParser,
  createFixture,
  itemName,
  itemPath,
  login,
  recycleId,
  responseItems,
  upload,
};
