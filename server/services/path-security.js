'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ApiError } = require('../../shared/api-error');

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const INVALID_WINDOWS_CHARACTERS = /[<>:"|?*\u0000-\u001f]/;

function pathKey(value) {
  return path.resolve(value).replace(/[\\/]+$/, '').toLocaleLowerCase('en-US');
}

function isWithinPath(rootPath, candidatePath) {
  const root = pathKey(rootPath);
  const candidate = pathKey(candidatePath);
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function decodeClientPath(value) {
  if (typeof value !== 'string') {
    throw new ApiError(400, '路径参数格式错误');
  }

  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new ApiError(400, '路径编码无效');
  }

  if (/%(?:2e|2f|5c|00)/i.test(decoded)) {
    throw new ApiError(400, '路径包含重复编码');
  }
  return decoded.normalize('NFC');
}

function validateSegment(segment, label = '路径') {
  if (!segment || segment === '.' || segment === '..') {
    throw new ApiError(400, `${label}包含无效片段`);
  }
  if (segment.endsWith('.') || segment.endsWith(' ')) {
    throw new ApiError(400, `${label}不能以点或空格结尾`);
  }
  if (INVALID_WINDOWS_CHARACTERS.test(segment) || segment.includes('/') || segment.includes('\\')) {
    throw new ApiError(400, `${label}包含 Windows 不允许的字符`);
  }
  if (WINDOWS_RESERVED_NAME.test(segment)) {
    throw new ApiError(400, `${label}使用了 Windows 保留名称`);
  }
  if (segment.length > 255) {
    throw new ApiError(400, `${label}片段过长`);
  }
  return segment;
}

function normalizeRelativePath(value, options = {}) {
  const decoded = decodeClientPath(value);
  if (decoded === '') {
    if (options.allowRoot === false) {
      throw new ApiError(400, '不能操作共享根目录');
    }
    return '';
  }

  if (
    decoded.startsWith('/') ||
    decoded.startsWith('\\') ||
    decoded.includes('\\') ||
    /^[a-z]:/i.test(decoded) ||
    decoded.includes('\0')
  ) {
    throw new ApiError(400, '仅允许共享目录内的相对路径');
  }

  const segments = decoded.split('/');
  for (const segment of segments) {
    validateSegment(segment);
    if (!options.allowRecycle && segment.toLocaleLowerCase('en-US') === '.recycle-bin') {
      throw new ApiError(403, '不能通过普通文件接口访问回收站');
    }
  }
  return segments.join('/');
}

function validateName(value, label = '名称') {
  const decoded = decodeClientPath(value);
  validateSegment(decoded, label);
  return decoded;
}

class PathSecurity {
  constructor(shareRoot) {
    if (typeof shareRoot !== 'string' || shareRoot.trim() === '') {
      throw new ApiError(500, '尚未配置共享目录');
    }

    fs.mkdirSync(shareRoot, { recursive: true });
    const rootStat = fs.lstatSync(shareRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new ApiError(500, '共享目录无效或属于符号链接');
    }

    this.shareRoot = fs.realpathSync.native(shareRoot);
  }

  normalize(value, options) {
    return normalizeRelativePath(value, options);
  }

  validateName(value, label) {
    return validateName(value, label);
  }

  relativeFromAbsolute(absolutePath) {
    if (!isWithinPath(this.shareRoot, absolutePath)) {
      throw new ApiError(400, '文件路径超出共享目录');
    }
    return path.relative(this.shareRoot, absolutePath).split(path.sep).join('/');
  }

  async resolveExisting(value, options = {}) {
    const relativePath = normalizeRelativePath(value, {
      allowRoot: options.allowRoot !== false,
      allowRecycle: Boolean(options.allowRecycle)
    });
    let currentPath = this.shareRoot;

    for (const segment of relativePath ? relativePath.split('/') : []) {
      currentPath = path.join(currentPath, segment);
      let stat;
      try {
        stat = await fs.promises.lstat(currentPath);
      } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
          throw new ApiError(404, '文件或文件夹不存在');
        }
        throw error;
      }
      if (stat.isSymbolicLink()) {
        throw new ApiError(403, '禁止访问符号链接或 Junction');
      }
    }

    const realPath = await fs.promises.realpath(currentPath);
    if (!isWithinPath(this.shareRoot, realPath)) {
      throw new ApiError(403, '文件路径超出共享目录');
    }
    const stat = await fs.promises.lstat(realPath);
    if (stat.isSymbolicLink()) {
      throw new ApiError(403, '禁止访问符号链接或 Junction');
    }
    if (options.type === 'file' && !stat.isFile()) {
      throw new ApiError(400, '目标不是普通文件');
    }
    if (options.type === 'directory' && !stat.isDirectory()) {
      throw new ApiError(400, '目标不是文件夹');
    }

    return { path: realPath, relativePath, stat };
  }

  async resolveForCreate(value, options = {}) {
    const relativePath = normalizeRelativePath(value, {
      allowRoot: false,
      allowRecycle: Boolean(options.allowRecycle)
    });
    const segments = relativePath.split('/');
    const name = segments.pop();
    const parentRelativePath = segments.join('/');
    const parent = await this.resolveExisting(parentRelativePath, {
      type: 'directory',
      allowRecycle: Boolean(options.allowRecycle)
    });
    const targetPath = path.join(parent.path, name);

    if (!isWithinPath(this.shareRoot, targetPath)) {
      throw new ApiError(403, '目标路径超出共享目录');
    }

    let stat = null;
    try {
      stat = await fs.promises.lstat(targetPath);
      if (stat.isSymbolicLink()) {
        throw new ApiError(403, '禁止操作符号链接或 Junction');
      }
      const realPath = await fs.promises.realpath(targetPath);
      if (!isWithinPath(this.shareRoot, realPath)) {
        throw new ApiError(403, '目标路径超出共享目录');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    return {
      path: targetPath,
      relativePath,
      parentPath: parent.path,
      parentRelativePath,
      name,
      stat
    };
  }

  async ensureDirectory(value) {
    const relativePath = normalizeRelativePath(value || '', { allowRoot: true });
    if (!relativePath) {
      return this.resolveExisting('', { type: 'directory' });
    }

    let currentRelativePath = '';
    for (const segment of relativePath.split('/')) {
      currentRelativePath = currentRelativePath ? `${currentRelativePath}/${segment}` : segment;
      const target = await this.resolveForCreate(currentRelativePath);
      if (target.stat) {
        if (!target.stat.isDirectory()) {
          throw new ApiError(409, '恢复路径中的同名项目不是文件夹');
        }
      } else {
        await fs.promises.mkdir(target.path);
      }
    }
    return this.resolveExisting(relativePath, { type: 'directory' });
  }

  async ensureInternalDirectory(name) {
    validateSegment(name, '内部目录');
    const directoryPath = path.join(this.shareRoot, name);
    if (!isWithinPath(this.shareRoot, directoryPath)) {
      throw new ApiError(500, '内部目录超出共享范围');
    }

    try {
      const stat = await fs.promises.lstat(directoryPath);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new ApiError(500, '内部目录无效或属于符号链接');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      await fs.promises.mkdir(directoryPath, { mode: 0o700 });
    }

    const realPath = await fs.promises.realpath(directoryPath);
    if (!isWithinPath(this.shareRoot, realPath)) {
      throw new ApiError(500, '内部目录超出共享范围');
    }
    return realPath;
  }
}

module.exports = {
  PathSecurity,
  decodeClientPath,
  isWithinPath,
  normalizeRelativePath,
  validateName
};
