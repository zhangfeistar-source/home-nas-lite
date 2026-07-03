'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { ApiError, assertApi } = require('../../shared/api-error');

const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_SEARCH_RESULTS = 1000;
const MAX_PREVIEW_CHARACTERS = 200000;
const MAX_OFFICE_PREVIEW_BYTES = 25 * 1024 * 1024;

const MIME_TYPES = new Map([
  ['.avi', 'video/x-msvideo'],
  ['.bmp', 'image/bmp'],
  ['.csv', 'text/csv; charset=utf-8'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.flv', 'video/x-flv'],
  ['.gif', 'image/gif'],
  ['.heic', 'image/heic'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.m4v', 'video/x-m4v'],
  ['.mkv', 'video/x-matroska'],
  ['.mov', 'video/quicktime'],
  ['.mp3', 'audio/mpeg'],
  ['.mp4', 'video/mp4'],
  ['.pdf', 'application/pdf'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.wav', 'audio/wav'],
  ['.webm', 'video/webm'],
  ['.webp', 'image/webp'],
  ['.xls', 'application/vnd.ms-excel'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
]);

function mimeTypeFor(filePath) {
  return MIME_TYPES.get(path.extname(filePath).toLocaleLowerCase('en-US')) || 'application/octet-stream';
}

function posixJoin(parent, name) {
  return parent ? `${parent}/${name}` : name;
}

function normalizeMultipartFileName(value) {
  if (typeof value !== 'string' || [...value].some((character) => character.codePointAt(0) > 255)) {
    return value;
  }
  const decoded = Buffer.from(value, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? value : decoded;
}

function itemFromStat(relativePath, stat) {
  const name = path.posix.basename(relativePath);
  return {
    name,
    path: relativePath,
    type: stat.isDirectory() ? 'directory' : 'file',
    size: stat.isFile() ? stat.size : 0,
    extension: stat.isFile() ? path.posix.extname(name).slice(1).toLocaleLowerCase('en-US') : '',
    createdAt: stat.birthtime.toISOString(),
    modifiedAt: stat.mtime.toISOString()
  };
}

async function removePath(absolutePath, stat) {
  if (stat.isDirectory()) {
    await fs.promises.rm(absolutePath, { recursive: true, force: false });
  } else {
    await fs.promises.unlink(absolutePath);
  }
}

async function moveUploadedFile(sourcePath, destinationPath) {
  try {
    await fs.promises.rename(sourcePath, destinationPath);
  } catch (error) {
    if (error.code !== 'EXDEV') {
      throw error;
    }
    await pipeline(
      fs.createReadStream(sourcePath),
      fs.createWriteStream(destinationPath, { flags: 'wx', mode: 0o600 })
    );
    await fs.promises.unlink(sourcePath);
  }
}

class FileService {
  constructor(pathSecurity, recentService) {
    this.pathSecurity = pathSecurity;
    this.recentService = recentService;
  }

  normalizePaths(paths) {
    assertApi(Array.isArray(paths) && paths.length > 0, 400, '请选择至少一个文件或文件夹');
    assertApi(paths.length <= 1000, 400, '一次最多操作 1000 个项目');

    const normalized = paths.map((item) =>
      this.pathSecurity.normalize(item, { allowRoot: false })
    );
    const unique = [...new Map(
      normalized.map((item) => [item.toLocaleLowerCase('en-US'), item])
    ).values()];
    return unique.filter((item) => {
      const key = item.toLocaleLowerCase('en-US');
      return !unique.some((parent) => {
        const parentKey = parent.toLocaleLowerCase('en-US');
        return parentKey !== key && key.startsWith(`${parentKey}/`);
      });
    });
  }

  validateConflict(value, allowed = ['cancel', 'rename', 'overwrite']) {
    const conflict = value || 'cancel';
    assertApi(allowed.includes(conflict), 400, '冲突处理方式无效');
    return conflict;
  }

  async list(relativePath) {
    const directory = await this.pathSecurity.resolveExisting(relativePath, { type: 'directory' });
    const entries = await fs.promises.readdir(directory.path, { withFileTypes: true });
    const items = [];

    for (const entry of entries) {
      if (entry.name.toLocaleLowerCase('en-US') === '.recycle-bin' || entry.isSymbolicLink()) {
        continue;
      }
      const childRelativePath = posixJoin(directory.relativePath, entry.name);
      try {
        const child = await this.pathSecurity.resolveExisting(childRelativePath);
        if (child.stat.isFile() || child.stat.isDirectory()) {
          items.push(itemFromStat(child.relativePath, child.stat));
        }
      } catch (error) {
        if (![403, 404].includes(error.status)) {
          throw error;
        }
      }
    }

    items.sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === 'directory' ? -1 : 1;
      }
      return left.name.localeCompare(right.name, 'zh-CN', { numeric: true, sensitivity: 'base' });
    });
    return { path: directory.relativePath, items };
  }

  async search(query, relativePath) {
    assertApi(typeof query === 'string' && query.trim().length > 0, 400, '请输入搜索内容');
    assertApi(query.trim().length <= 200, 400, '搜索内容过长');
    const base = await this.pathSecurity.resolveExisting(relativePath || '', { type: 'directory' });
    const needle = query.trim().normalize('NFC').toLocaleLowerCase('zh-CN');
    const items = [];
    const pending = [{ absolutePath: base.path, relativePath: base.relativePath }];

    while (pending.length > 0 && items.length < MAX_SEARCH_RESULTS) {
      const current = pending.pop();
      const entries = await fs.promises.readdir(current.absolutePath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.toLocaleLowerCase('en-US') === '.recycle-bin' || entry.isSymbolicLink()) {
          continue;
        }
        const childRelativePath = posixJoin(current.relativePath, entry.name);
        let child;
        try {
          child = await this.pathSecurity.resolveExisting(childRelativePath);
        } catch (error) {
          if ([403, 404].includes(error.status)) {
            continue;
          }
          throw error;
        }
        if (!child.stat.isDirectory() && !child.stat.isFile()) {
          continue;
        }
        if (entry.name.normalize('NFC').toLocaleLowerCase('zh-CN').includes(needle)) {
          items.push(itemFromStat(child.relativePath, child.stat));
          if (items.length >= MAX_SEARCH_RESULTS) {
            break;
          }
        }
        if (child.stat.isDirectory()) {
          pending.push({ absolutePath: child.path, relativePath: child.relativePath });
        }
      }
    }

    return { items, truncated: pending.length > 0 };
  }

  async findAvailablePath(relativePath) {
    const parsed = path.posix.parse(relativePath);
    for (let index = 1; index <= 9999; index += 1) {
      const name = `${parsed.name} (${index})${parsed.ext}`;
      const candidate = posixJoin(parsed.dir, name);
      const target = await this.pathSecurity.resolveForCreate(candidate);
      if (!target.stat) {
        return target;
      }
    }
    throw new ApiError(409, '无法生成不重复的名称');
  }

  async prepareTarget(relativePath, conflict, incomingType) {
    let target = await this.pathSecurity.resolveForCreate(relativePath);
    if (!target.stat) {
      return target;
    }
    if (conflict === 'cancel') {
      throw new ApiError(409, `目标已存在：${target.name}`);
    }
    if (conflict === 'rename') {
      return this.findAvailablePath(relativePath);
    }
    if (
      (incomingType === 'file' && target.stat.isDirectory()) ||
      (incomingType === 'directory' && !target.stat.isDirectory())
    ) {
      throw new ApiError(409, '不能用不同类型的项目覆盖目标');
    }
    await removePath(target.path, target.stat);
    target = await this.pathSecurity.resolveForCreate(relativePath);
    return target;
  }

  async upload(files, relativeDirectoryPath, conflictValue) {
    assertApi(Array.isArray(files) && files.length > 0, 400, '请选择要上传的文件');
    const conflict = this.validateConflict(conflictValue);
    const directory = await this.pathSecurity.resolveExisting(relativeDirectoryPath || '', {
      type: 'directory'
    });
    const uploaded = [];

    for (const file of files) {
      const name = this.pathSecurity.validateName(
        normalizeMultipartFileName(file.originalname),
        '文件名'
      );
      const desiredPath = posixJoin(directory.relativePath, name);
      const target = await this.prepareTarget(desiredPath, conflict, 'file');
      await moveUploadedFile(file.path, target.path);
      const stat = await fs.promises.lstat(target.path);
      uploaded.push(itemFromStat(target.relativePath, stat));
    }

    await this.recentService.add(uploaded.map((item) => ({
      path: item.path,
      name: item.name,
      size: item.size
    })));
    return uploaded;
  }

  async createFolder(relativeDirectoryPath, name) {
    const directory = await this.pathSecurity.resolveExisting(relativeDirectoryPath || '', {
      type: 'directory'
    });
    const safeName = this.pathSecurity.validateName(name, '文件夹名称');
    const target = await this.pathSecurity.resolveForCreate(
      posixJoin(directory.relativePath, safeName)
    );
    if (target.stat) {
      throw new ApiError(409, '同名文件或文件夹已存在');
    }
    await fs.promises.mkdir(target.path);
    const stat = await fs.promises.lstat(target.path);
    return itemFromStat(target.relativePath, stat);
  }

  async rename(relativePath, newName, conflictValue) {
    const source = await this.pathSecurity.resolveExisting(relativePath, { allowRoot: false });
    const safeName = this.pathSecurity.validateName(newName, '新名称');
    const parentRelativePath = path.posix.dirname(source.relativePath);
    const normalizedParent = parentRelativePath === '.' ? '' : parentRelativePath;
    const desiredPath = posixJoin(normalizedParent, safeName);
    const samePathIgnoringCase =
      source.relativePath.toLocaleLowerCase('en-US') === desiredPath.toLocaleLowerCase('en-US');

    if (samePathIgnoringCase) {
      if (source.relativePath === desiredPath) {
        return itemFromStat(source.relativePath, source.stat);
      }
      const target = await this.pathSecurity.resolveForCreate(desiredPath);
      await fs.promises.rename(source.path, target.path);
      const stat = await fs.promises.lstat(target.path);
      return itemFromStat(target.relativePath, stat);
    }

    const conflict = this.validateConflict(conflictValue);
    const target = await this.prepareTarget(
      desiredPath,
      conflict,
      source.stat.isDirectory() ? 'directory' : 'file'
    );
    await fs.promises.rename(source.path, target.path);
    const stat = await fs.promises.lstat(target.path);
    return itemFromStat(target.relativePath, stat);
  }

  async move(paths, destinationPath, conflictValue) {
    const sourcePaths = this.normalizePaths(paths);
    const destination = await this.pathSecurity.resolveExisting(destinationPath || '', {
      type: 'directory'
    });
    const conflict = this.validateConflict(conflictValue);
    const moved = [];

    for (const sourcePath of sourcePaths) {
      const source = await this.pathSecurity.resolveExisting(sourcePath, { allowRoot: false });
      const destinationKey = destination.relativePath.toLocaleLowerCase('en-US');
      const sourceKey = source.relativePath.toLocaleLowerCase('en-US');
      if (
        source.stat.isDirectory() &&
        (destinationKey === sourceKey || destinationKey.startsWith(`${sourceKey}/`))
      ) {
        throw new ApiError(400, '不能把文件夹移动到自身或其子目录');
      }
      const desiredPath = posixJoin(destination.relativePath, path.posix.basename(source.relativePath));
      if (desiredPath.toLocaleLowerCase('en-US') === sourceKey) {
        moved.push(itemFromStat(source.relativePath, source.stat));
        continue;
      }
      const target = await this.prepareTarget(
        desiredPath,
        conflict,
        source.stat.isDirectory() ? 'directory' : 'file'
      );
      await fs.promises.rename(source.path, target.path);
      const stat = await fs.promises.lstat(target.path);
      moved.push(itemFromStat(target.relativePath, stat));
    }
    return moved;
  }

  async getDownload(relativePath) {
    const file = await this.pathSecurity.resolveExisting(relativePath, {
      type: 'file',
      allowRoot: false
    });
    return {
      ...file,
      name: path.posix.basename(file.relativePath),
      mimeType: mimeTypeFor(file.path)
    };
  }

  async addPathsToArchive(archive, paths) {
    const selectedPaths = this.normalizePaths(paths);
    for (const selectedPath of selectedPaths) {
      const item = await this.pathSecurity.resolveExisting(selectedPath, { allowRoot: false });
      await this.addItemToArchive(archive, item, item.relativePath);
    }
  }

  async addItemToArchive(archive, item, archiveName) {
    const safeArchiveName = archiveName.split('/').map((segment) =>
      this.pathSecurity.validateName(segment, '压缩包条目')
    ).join('/');

    if (item.stat.isFile()) {
      archive.append(fs.createReadStream(item.path), {
        name: safeArchiveName,
        date: item.stat.mtime,
        mode: 0o600
      });
      return;
    }
    if (!item.stat.isDirectory()) {
      return;
    }

    archive.append('', { name: `${safeArchiveName}/`, date: item.stat.mtime, mode: 0o700 });
    const entries = await fs.promises.readdir(item.path, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.toLocaleLowerCase('en-US') === '.recycle-bin' || entry.isSymbolicLink()) {
        continue;
      }
      const childRelativePath = posixJoin(item.relativePath, entry.name);
      const child = await this.pathSecurity.resolveExisting(childRelativePath);
      await this.addItemToArchive(archive, child, `${safeArchiveName}/${entry.name}`);
    }
  }

  async readText(relativePath) {
    const file = await this.getDownload(relativePath);
    const handle = await fs.promises.open(file.path, 'r');
    try {
      const buffer = Buffer.allocUnsafe(MAX_TEXT_BYTES + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const contentBuffer = buffer.subarray(0, Math.min(bytesRead, MAX_TEXT_BYTES));
      return {
        content: contentBuffer.toString('utf8').replace(/^\uFEFF/, ''),
        truncated: bytesRead > MAX_TEXT_BYTES
      };
    } finally {
      await handle.close();
    }
  }

  async metadata(relativePath) {
    const file = await this.pathSecurity.resolveExisting(relativePath, { allowRoot: false });
    const metadata = {
      ...itemFromStat(file.relativePath, file.stat),
      mimeType: file.stat.isFile() ? mimeTypeFor(file.path) : null
    };
    if (!file.stat.isFile()) {
      return metadata;
    }

    const extension = path.extname(file.path).toLocaleLowerCase('en-US');
    if (
      ['.docx', '.xlsx', '.xls', '.csv'].includes(extension)
      && file.stat.size > MAX_OFFICE_PREVIEW_BYTES
    ) {
      throw new ApiError(413, '文件过大，在线预览仅支持 25MB 以内的文档，请下载后查看');
    }
    if (extension === '.docx') {
      const mammoth = require('mammoth');
      const result = await mammoth.convertToHtml({ path: file.path }, {
        externalFileAccess: false,
        includeEmbeddedStyleMap: false,
        styleMap: [
          "p[style-name='Title'] => h1:fresh",
          "p[style-name='Subtitle'] => h2:fresh"
        ]
      });
      metadata.preview = {
        type: 'docx',
        html: result.value.slice(0, MAX_PREVIEW_CHARACTERS),
        truncated: result.value.length > MAX_PREVIEW_CHARACTERS,
        messages: result.messages.map((message) => message.message).slice(0, 20)
      };
    } else if (['.xlsx', '.xls', '.csv'].includes(extension)) {
      const XLSX = require('xlsx');
      const workbook = XLSX.readFile(file.path, {
        cellDates: true,
        dense: false
      });
      const sheetNames = workbook.SheetNames.slice(0, 100);
      const activeSheet = sheetNames[0] || null;
      let rows = [];
      let truncated = false;
      if (activeSheet) {
        const sheet = workbook.Sheets[activeSheet];
        const originalRange = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null;
        if (originalRange) {
          const limitedRange = {
            s: originalRange.s,
            e: {
              r: Math.min(originalRange.e.r, originalRange.s.r + 499),
              c: Math.min(originalRange.e.c, originalRange.s.c + 49)
            }
          };
          truncated =
            limitedRange.e.r < originalRange.e.r || limitedRange.e.c < originalRange.e.c;
          rows = XLSX.utils.sheet_to_json(sheet, {
            header: 1,
            raw: false,
            defval: '',
            range: limitedRange
          });
        }
      }
      metadata.preview = {
        type: 'spreadsheet',
        sheetNames,
        activeSheet,
        rows,
        truncated
      };
    }
    return metadata;
  }
}

module.exports = {
  FileService,
  MAX_TEXT_BYTES,
  itemFromStat,
  mimeTypeFor,
  normalizeMultipartFileName
};
