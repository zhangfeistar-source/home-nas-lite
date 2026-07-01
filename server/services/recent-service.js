'use strict';

const JsonStore = require('./json-store');

class RecentService {
  constructor(filePath, pathSecurity) {
    this.store = new JsonStore(filePath, []);
    this.pathSecurity = pathSecurity;
  }

  async add(items) {
    const normalizedItems = items.map((item) => ({
      path: item.path,
      name: item.name,
      size: item.size,
      uploadedAt: item.uploadedAt || new Date().toISOString()
    }));

    await this.store.update((current) => {
      const existing = Array.isArray(current) ? current : [];
      const uploadedPaths = new Set(
        normalizedItems.map((item) => item.path.toLocaleLowerCase('en-US'))
      );
      return [
        ...normalizedItems,
        ...existing.filter(
          (item) => !uploadedPaths.has(String(item.path).toLocaleLowerCase('en-US'))
        )
      ].slice(0, 100);
    });
  }

  async list() {
    const current = await this.store.read();
    const valid = [];

    for (const item of Array.isArray(current) ? current.slice(0, 100) : []) {
      try {
        const resolved = await this.pathSecurity.resolveExisting(item.path, { type: 'file' });
        valid.push({
          ...item,
          size: resolved.stat.size,
          modifiedAt: resolved.stat.mtime.toISOString()
        });
      } catch (error) {
        if (![403, 404].includes(error.status)) {
          throw error;
        }
      }
    }

    if (valid.length !== (Array.isArray(current) ? current.slice(0, 100).length : 0)) {
      await this.store.write(valid);
    }
    return valid;
  }
}

module.exports = RecentService;
