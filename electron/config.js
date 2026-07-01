'use strict';

const crypto = require('node:crypto');
const { constants } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const SCRYPT_OPTIONS = Object.freeze({
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
});

function normalizeForComparison(value) {
  const normalized = path.resolve(value).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
}

function isSameOrChild(candidate, parent) {
  const normalizedCandidate = normalizeForComparison(candidate);
  const normalizedParent = normalizeForComparison(parent);
  return normalizedCandidate === normalizedParent
    || normalizedCandidate.startsWith(`${normalizedParent}${path.sep}`);
}

async function ensureAppDataDirectories(appDataDir) {
  await Promise.all([
    fs.mkdir(appDataDir, { recursive: true }),
    fs.mkdir(path.join(appDataDir, 'data'), { recursive: true }),
    fs.mkdir(path.join(appDataDir, 'logs'), { recursive: true }),
  ]);
}

async function readConfig(configPath) {
  try {
    const content = await fs.readFile(configPath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw new Error('应用配置无法读取，请检查配置文件是否损坏。', { cause: error });
  }
}

async function writeConfig(configPath, config) {
  const directory = path.dirname(configPath);
  await fs.mkdir(directory, { recursive: true });
  const temporaryPath = `${configPath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const serialized = `${JSON.stringify(config, null, 2)}\n`;

  try {
    await fs.writeFile(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporaryPath, configPath);
    await fs.chmod(configPath, 0o600).catch(() => {});
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derivedKey = await scrypt(password, salt, 64, SCRYPT_OPTIONS);
  return {
    algorithm: 'scrypt',
    salt: salt.toString('hex'),
    hash: derivedKey.toString('hex'),
    keyLength: 64,
    cost: SCRYPT_OPTIONS.N,
    blockSize: SCRYPT_OPTIONS.r,
    parallelization: SCRYPT_OPTIONS.p,
  };
}

function assertPasswordRules(accessCode, adminPassword) {
  if (typeof accessCode !== 'string' || accessCode.length < 6 || accessCode.length > 64) {
    throw new Error('家庭访问码长度应为 6 到 64 个字符。');
  }
  if (typeof adminPassword !== 'string' || adminPassword.length < 6 || adminPassword.length > 128) {
    throw new Error('管理员密码长度应为 6 到 128 个字符。');
  }
  if (!accessCode.trim() || !adminPassword.trim()) {
    throw new Error('访问码和管理员密码不能全为空白字符。');
  }
  if (accessCode === adminPassword) {
    throw new Error('管理员密码不能与家庭访问码相同。');
  }
}

async function validateShareDirectory(selectedPath, protectedPaths) {
  if (typeof selectedPath !== 'string' || selectedPath.length === 0 || selectedPath.length > 1024) {
    throw new Error('请选择有效的共享目录。');
  }
  if (!path.isAbsolute(selectedPath) || selectedPath.startsWith('\\\\') || selectedPath.startsWith('\\\\?\\')) {
    throw new Error('共享目录必须是本机磁盘上的绝对路径，不能使用网络路径。');
  }

  const resolvedPath = path.resolve(selectedPath);
  const rootPath = path.parse(resolvedPath).root;
  if (normalizeForComparison(resolvedPath) === normalizeForComparison(rootPath)) {
    throw new Error('不能把整个磁盘设为共享目录，请选择磁盘内的文件夹。');
  }

  let stats;
  let realPath;
  try {
    stats = await fs.lstat(resolvedPath);
    realPath = await fs.realpath(resolvedPath);
  } catch (error) {
    throw new Error('所选共享目录不存在或无法访问。', { cause: error });
  }

  if (!stats.isDirectory()) {
    throw new Error('所选位置不是文件夹。');
  }
  if (stats.isSymbolicLink() || normalizeForComparison(realPath) !== normalizeForComparison(resolvedPath)) {
    throw new Error('共享目录不能是符号链接、Junction 或位于重解析路径内。');
  }

  for (const protectedPath of protectedPaths.filter(Boolean)) {
    const absoluteProtectedPath = path.resolve(protectedPath);
    if (isSameOrChild(realPath, absoluteProtectedPath) || isSameOrChild(absoluteProtectedPath, realPath)) {
      throw new Error('不能共享系统目录、应用目录或包含应用数据的上级目录。');
    }
  }

  try {
    await fs.access(realPath, constants.R_OK | constants.W_OK);
  } catch (error) {
    throw new Error('共享目录需要当前用户具有读取和写入权限。', { cause: error });
  }

  return realPath;
}

module.exports = {
  assertPasswordRules,
  ensureAppDataDirectories,
  hashPassword,
  readConfig,
  validateShareDirectory,
  writeConfig,
};
