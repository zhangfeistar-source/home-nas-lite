'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const VENDOR_DIRECTORY = path.join(ROOT, 'public', 'vendor');
const ASSETS = Object.freeze([
  {
    source: path.join(ROOT, 'node_modules', 'mammoth', 'mammoth.browser.min.js'),
    destination: path.join(VENDOR_DIRECTORY, 'mammoth.browser.min.js'),
  },
  {
    source: path.join(ROOT, 'node_modules', 'xlsx', 'dist', 'xlsx.full.min.js'),
    destination: path.join(VENDOR_DIRECTORY, 'xlsx.full.min.js'),
  },
]);

async function copyFileAtomically(source, destination) {
  const sourceStats = await fs.stat(source).catch((error) => {
    if (error.code === 'ENOENT') {
      throw new Error(`缺少离线依赖文件：${path.relative(ROOT, source)}。请先运行 npm install。`);
    }
    throw error;
  });
  if (!sourceStats.isFile() || sourceStats.size === 0) {
    throw new Error(`离线依赖文件无效：${path.relative(ROOT, source)}`);
  }

  const temporaryPath = `${destination}.${process.pid}.tmp`;
  await fs.copyFile(source, temporaryPath);
  try {
    await fs.rename(temporaryPath, destination);
  } catch (error) {
    if (error.code !== 'EEXIST' && error.code !== 'EPERM') {
      throw error;
    }
    await fs.rm(destination, { force: true });
    await fs.rename(temporaryPath, destination);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
}

async function main() {
  await fs.mkdir(VENDOR_DIRECTORY, { recursive: true });
  for (const asset of ASSETS) {
    await copyFileAtomically(asset.source, asset.destination);
    console.log(`已复制 ${path.relative(ROOT, asset.destination)}`);
  }
}

main().catch((error) => {
  console.error(`复制离线资源失败：${error.message}`);
  process.exitCode = 1;
});
