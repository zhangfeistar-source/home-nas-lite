'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const JsonStore = require('./json-store');
const { ApiError, assertApi } = require('../../shared/api-error');
const { isWithinPath } = require('./path-security');

const RETENTION_MILLISECONDS = 30 * 24 * 60 * 60 * 1000;

function normalizeIndex(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item.id === 'string') : [];
}

class RecycleService {
  constructor(pathSecurity, indexPath) {
    this.pathSecurity = pathSecurity;
    this.store = new JsonStore(indexPath, []);
    this.recycleRootPromise = this.pathSecurity.ensureInternalDirectory('.recycle-bin');
  }

  normalizeIds(ids) {
    assertApi(Array.isArray(ids) && ids.length > 0, 400, '请选择回收站项目');
    assertApi(ids.length <= 1000, 400, '一次最多操作 1000 个项目');
    const unique = [...new Set(ids)];
    for (const id of unique) {
      assertApi(
        typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id),
        400,
        '回收站项目编号无效'
      );
    }
    return unique;
  }

  async resolveRecycleItem(id) {
    const recycleRoot = await this.recycleRootPromise;
    const itemPath = path.join(recycleRoot, id);
    if (!isWithinPath(recycleRoot, itemPath)) {
      throw new ApiError(400, '回收站项目路径无效');
    }
    let stat;
    try {
      stat = await fs.promises.lstat(itemPath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new ApiError(404, '回收站项目不存在');
      }
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new ApiError(403, '回收站项目不能是符号链接');
    }
    const realPath = await fs.promises.realpath(itemPath);
    if (!isWithinPath(recycleRoot, realPath)) {
      throw new ApiError(403, '回收站项目超出安全范围');
    }
    return { path: realPath, stat };
  }

  async moveResolvedToRecycle(source) {
    const recycleRoot = await this.recycleRootPromise;
    const id = crypto.randomUUID();
    const targetPath = path.join(recycleRoot, id);
    await fs.promises.rename(source.path, targetPath);
    const item = {
      id,
      originalPath: source.relativePath,
      name: path.posix.basename(source.relativePath),
      type: source.stat.isDirectory() ? 'directory' : 'file',
      size: source.stat.isFile() ? source.stat.size : 0,
      deletedAt: new Date().toISOString()
    };
    await this.store.update((current) => [item, ...normalizeIndex(current)]);
    return item;
  }

  async delete(paths) {
    assertApi(Array.isArray(paths) && paths.length > 0, 400, '请选择要删除的项目');
    const normalizedPaths = [...new Map(paths.map((item) => {
      const normalized = this.pathSecurity.normalize(item, { allowRoot: false });
      return [normalized.toLocaleLowerCase('en-US'), normalized];
    })).values()];
    const topLevelPaths = normalizedPaths.filter((item) => {
      const key = item.toLocaleLowerCase('en-US');
      return !normalizedPaths.some((parent) => {
        const parentKey = parent.toLocaleLowerCase('en-US');
        return parentKey !== key && key.startsWith(`${parentKey}/`);
      });
    });
    const deleted = [];
    for (const relativePath of topLevelPaths) {
      const source = await this.pathSecurity.resolveExisting(relativePath, { allowRoot: false });
      deleted.push(await this.moveResolvedToRecycle(source));
    }
    return deleted;
  }

  async list() {
    const index = normalizeIndex(await this.store.read());
    const items = [];
    let changed = false;
    for (const item of index) {
      try {
        const stored = await this.resolveRecycleItem(item.id);
        items.push({
          ...item,
          size: stored.stat.isFile() ? stored.stat.size : item.size || 0,
          type: stored.stat.isDirectory() ? 'directory' : 'file'
        });
      } catch (error) {
        if (error.status === 404) {
          changed = true;
          continue;
        }
        throw error;
      }
    }
    if (changed) {
      await this.store.write(items);
    }
    return items;
  }

  async findAvailableRestorePath(relativePath) {
    const parsed = path.posix.parse(relativePath);
    for (let index = 1; index <= 9999; index += 1) {
      const candidateName = `${parsed.name} (${index})${parsed.ext}`;
      const candidatePath = parsed.dir ? `${parsed.dir}/${candidateName}` : candidateName;
      const target = await this.pathSecurity.resolveForCreate(candidatePath);
      if (!target.stat) {
        return target;
      }
    }
    throw new ApiError(409, '无法为恢复项目生成不重复的名称');
  }

  async restore(ids, conflictValue) {
    const selectedIds = this.normalizeIds(ids);
    const conflict = conflictValue || 'rename';
    assertApi(['rename', 'overwrite'].includes(conflict), 400, '恢复冲突处理方式无效');
    const index = normalizeIndex(await this.store.read());
    const byId = new Map(index.map((item) => [item.id, item]));
    const restored = [];
    const restoredIds = new Set();

    for (const id of selectedIds) {
      const record = byId.get(id);
      if (!record) {
        throw new ApiError(404, '回收站索引中不存在该项目');
      }
      const stored = await this.resolveRecycleItem(id);
      const originalPath = this.pathSecurity.normalize(record.originalPath, { allowRoot: false });
      const parentPath = path.posix.dirname(originalPath);
      await this.pathSecurity.ensureDirectory(parentPath === '.' ? '' : parentPath);
      let target = await this.pathSecurity.resolveForCreate(originalPath);
      if (target.stat) {
        if (conflict === 'rename') {
          target = await this.findAvailableRestorePath(originalPath);
        } else {
          await this.moveResolvedToRecycle({
            path: target.path,
            relativePath: target.relativePath,
            stat: target.stat
          });
          target = await this.pathSecurity.resolveForCreate(originalPath);
        }
      }
      await fs.promises.rename(stored.path, target.path);
      const stat = await fs.promises.lstat(target.path);
      restoredIds.add(id);
      restored.push({
        id,
        path: target.relativePath,
        name: path.posix.basename(target.relativePath),
        type: stat.isDirectory() ? 'directory' : 'file',
        size: stat.isFile() ? stat.size : 0,
        restoredAt: new Date().toISOString()
      });
    }

    await this.store.update((current) =>
      normalizeIndex(current).filter((item) => !restoredIds.has(item.id))
    );
    return restored;
  }

  async purge(ids) {
    const selectedIds = this.normalizeIds(ids);
    const selected = new Set(selectedIds);
    const index = normalizeIndex(await this.store.read());
    const knownIds = new Set(index.map((item) => item.id));
    for (const id of selectedIds) {
      if (!knownIds.has(id)) {
        throw new ApiError(404, '回收站索引中不存在该项目');
      }
      const stored = await this.resolveRecycleItem(id);
      await fs.promises.rm(stored.path, { recursive: stored.stat.isDirectory(), force: false });
    }
    await this.store.update((current) =>
      normalizeIndex(current).filter((item) => !selected.has(item.id))
    );
    return selectedIds.length;
  }

  async empty() {
    const index = normalizeIndex(await this.store.read());
    let removed = 0;
    for (const item of index) {
      try {
        const stored = await this.resolveRecycleItem(item.id);
        await fs.promises.rm(stored.path, {
          recursive: stored.stat.isDirectory(),
          force: false
        });
        removed += 1;
      } catch (error) {
        if (error.status !== 404) {
          throw error;
        }
      }
    }
    await this.store.write([]);
    return removed;
  }

  async cleanupExpired(now = Date.now()) {
    const index = normalizeIndex(await this.store.read());
    const expiredIds = index
      .filter((item) => {
        const deletedAt = Date.parse(item.deletedAt);
        return Number.isFinite(deletedAt) && now - deletedAt >= RETENTION_MILLISECONDS;
      })
      .map((item) => item.id);
    if (expiredIds.length === 0) {
      return 0;
    }
    return this.purge(expiredIds);
  }
}

module.exports = {
  RecycleService,
  RETENTION_MILLISECONDS
};
