'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const appPath = path.resolve(__dirname, '..', 'server', 'app.js');
let missingDependency = null;
try {
  require.resolve('supertest');
} catch {
  missingDependency = '尚未安装 supertest，请先执行 npm install';
}

if (!fs.existsSync(appPath) || missingDependency) {
  const reason = !fs.existsSync(appPath) ? 'server/app.js 尚未出现' : missingDependency;
  test('集成测试前置条件', { skip: reason }, () => {});
} else {
  const {
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
  } = require('./support/app-harness');

  async function withFixture(run) {
    const fixture = await createFixture();
    try {
      await run(fixture);
    } finally {
      await fixture.close();
    }
  }

  async function authenticate(fixture) {
    const response = await login(fixture);
    assertSuccess(response, [200]);
  }

  async function list(fixture, relativePath = '') {
    const response = await fixture.agent.get('/api/files/list').query({ path: relativePath });
    assertSuccess(response, [200]);
    return responseItems(response);
  }

  test('未登录时拒绝全部受保护 API', async () => {
    await withFixture(async (fixture) => {
      const requests = [
        () => fixture.agent.get('/api/files/list').query({ path: '' }),
        () => fixture.agent.get('/api/files/search').query({ query: 'a', path: '' }),
        () => fixture.agent.post('/api/files/upload'),
        () => fixture.agent.post('/api/files/folder').send({ path: '', name: 'x' }),
        () => fixture.agent.post('/api/files/rename').send({ path: 'x', newName: 'y', conflict: 'cancel' }),
        () => fixture.agent.post('/api/files/move').send({ paths: ['x'], destination: '', conflict: 'cancel' }),
        () => fixture.agent.post('/api/files/delete').send({ paths: ['x'] }),
        () => fixture.agent.get('/api/files/download').query({ path: 'x' }),
        () => fixture.agent.post('/api/files/download-zip').send({ paths: ['x'] }),
        () => fixture.agent.get('/api/files/stream').query({ path: 'x' }),
        () => fixture.agent.get('/api/files/text').query({ path: 'x' }),
        () => fixture.agent.get('/api/files/meta').query({ path: 'x' }),
        () => fixture.agent.get('/api/recycle/list'),
        () => fixture.agent.post('/api/recycle/restore').send({ ids: ['x'], conflict: 'rename' }),
        () => fixture.agent
          .post('/api/recycle/purge')
          .send({ ids: ['x'], adminPassword: ADMIN_PASSWORD, confirm: true }),
        () => fixture.agent
          .post('/api/recycle/empty')
          .send({ adminPassword: ADMIN_PASSWORD, confirm: true }),
        () => fixture.agent.get('/api/recent'),
        () => fixture.agent.get('/api/system/status'),
        () => fixture.agent.post('/api/admin/verify').send({ adminPassword: ADMIN_PASSWORD }),
      ];

      for (const createRequest of requests) {
        assertChineseError(await createRequest(), 401);
      }
    });
  });

  test('登录正误、Session Cookie 与注销行为符合契约', async () => {
    await withFixture(async (fixture) => {
      assertChineseError(await login(fixture, `${ACCESS_CODE}-错误`), 401);

      const loginResponse = await login(fixture);
      assertSuccess(loginResponse, [200]);
      const cookies = loginResponse.headers['set-cookie'] || [];
      assert.ok(cookies.some((cookie) => /HttpOnly/i.test(cookie)), 'Session Cookie 必须为 HttpOnly');
      assert.ok(cookies.some((cookie) => /SameSite=Strict/i.test(cookie)), 'Session Cookie 必须为 SameSite=Strict');

      const meResponse = await fixture.agent.get('/api/auth/me');
      assertSuccess(meResponse, [200]);
      assert.equal(meResponse.body.authenticated, true);

      assertSuccess(await fixture.agent.post('/api/auth/logout'), [200]);
      const loggedOutResponse = await fixture.agent.get('/api/auth/me');
      assertSuccess(loggedOutResponse, [200]);
      assert.equal(loggedOutResponse.body.authenticated, false);
      assertChineseError(await fixture.agent.get('/api/files/list').query({ path: '' }), 401);
    });
  });

  test('管理员验证仅对当次敏感操作生效', async () => {
    await withFixture(async (fixture) => {
      await authenticate(fixture);
      assertChineseError(
        await fixture.agent.post('/api/admin/verify').send({ adminPassword: `${ADMIN_PASSWORD}-错误` }),
        403,
      );
      assertSuccess(
        await fixture.agent.post('/api/admin/verify').send({ adminPassword: ADMIN_PASSWORD }),
        [200],
      );

      assertSuccess(await upload(fixture, '', 'purge-me.txt', 'secret'), [200, 201]);
      assertSuccess(await fixture.agent.post('/api/files/delete').send({ paths: ['purge-me.txt'] }), [200]);
      const recycleResponse = await fixture.agent.get('/api/recycle/list');
      assertSuccess(recycleResponse, [200]);
      const id = recycleId(responseItems(recycleResponse)[0]);
      assert.ok(id, '回收站条目必须包含稳定 ID');

      assertChineseError(
        await fixture.agent.post('/api/recycle/purge').send({ ids: [id], confirm: true }),
        403,
      );
      assertSuccess(
        await fixture.agent
          .post('/api/recycle/purge')
          .send({ ids: [id], adminPassword: ADMIN_PASSWORD, confirm: true }),
        [200],
      );
    });
  });

  test('拒绝 ../、Windows 路径、保留目录与编码绕过', async () => {
    await withFixture(async (fixture) => {
      await authenticate(fixture);
      const maliciousPaths = [
        '../outside',
        'safe/../outside',
        './outside',
        'safe//outside',
        '..\\outside',
        'C:\\Windows\\win.ini',
        '\\\\server\\share\\file',
        '/etc/passwd',
        '%2e%2e%2foutside',
        '%252e%252e%252foutside',
        '%2e%2e%5coutside',
        'nul\u0000byte',
      ];

      for (const maliciousPath of maliciousPaths) {
        assertChineseError(
          await fixture.agent.get('/api/files/list').query({ path: maliciousPath }),
          400,
        );
      }
      assertChineseError(
        await fixture.agent.get('/api/files/list').query({ path: '.recycle-bin/item' }),
        403,
      );
      assert.ok(
        !(await list(fixture)).some((item) => itemName(item).toLocaleLowerCase('en-US') === '.recycle-bin'),
        '普通文件列表不得暴露回收站内部目录',
      );
      await fsp.writeFile(path.join(fixture.shareRoot, 'safe.txt'), 'safe');

      const mutationRequests = [
        () => fixture.agent.post('/api/files/folder').send({ path: '../outside', name: 'x' }),
        () => fixture.agent.post('/api/files/folder').send({ path: '', name: '../x' }),
        () => fixture.agent
          .post('/api/files/rename')
          .send({ path: 'safe.txt', newName: '..\\outside.txt', conflict: 'cancel' }),
        () => fixture.agent
          .post('/api/files/move')
          .send({ paths: ['../outside'], destination: '', conflict: 'cancel' }),
        () => fixture.agent
          .post('/api/files/move')
          .send({ paths: ['safe.txt'], destination: 'C:\\Temp', conflict: 'cancel' }),
        () => fixture.agent.post('/api/files/delete').send({ paths: ['%2e%2e%2foutside'] }),
        () => fixture.agent.get('/api/files/download').query({ path: '../outside' }),
        () => fixture.agent.get('/api/files/text').query({ path: '%2e%2e%2foutside' }),
      ];
      for (const createRequest of mutationRequests) {
        assertChineseError(await createRequest(), 400);
      }

      assertChineseError(await upload(fixture, '../outside', 'x.txt', 'x'), 400);
      assert.deepEqual(
        await fsp.readdir(path.join(fixture.dataDir, 'data', 'uploads')),
        [],
        '上传路径校验失败后必须清理临时文件',
      );
    });
  });

  test('超限上传返回 413 并清理临时文件', async () => {
    const fixture = await createFixture({ uploadLimitBytes: 16 });
    try {
      await authenticate(fixture);
      assertChineseError(await upload(fixture, '', 'too-large.bin', Buffer.alloc(17)), 413);
      assert.deepEqual(
        await fsp.readdir(path.join(fixture.dataDir, 'data', 'uploads')),
        [],
        '超限上传后必须清理临时文件',
      );
      await assert.rejects(
        fsp.access(path.join(fixture.shareRoot, 'too-large.bin')),
        { code: 'ENOENT' },
      );
    } finally {
      await fixture.close();
    }
  });

  test('符号链接或 Junction 不能越过共享根目录', async (t) => {
    await withFixture(async (fixture) => {
      await authenticate(fixture);
      const outsideFile = path.join(fixture.fixtureRoot, 'outside-secret.txt');
      const outsideDirectory = path.join(fixture.fixtureRoot, 'outside-directory');
      await fsp.writeFile(outsideFile, '不得读取');
      await fsp.mkdir(outsideDirectory);
      await fsp.writeFile(path.join(outsideDirectory, 'secret.txt'), '不得读取');

      const candidates = [
        {
          linkPath: path.join(fixture.shareRoot, 'file-link.txt'),
          target: outsideFile,
          type: 'file',
          request: () => fixture.agent.get('/api/files/download').query({ path: 'file-link.txt' }),
        },
        {
          linkPath: path.join(fixture.shareRoot, 'directory-junction'),
          target: outsideDirectory,
          type: 'junction',
          request: () => fixture.agent.get('/api/files/list').query({ path: 'directory-junction' }),
        },
      ];
      let createdLinks = 0;
      for (const candidate of candidates) {
        try {
          await fsp.symlink(candidate.target, candidate.linkPath, candidate.type);
        } catch (error) {
          if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) continue;
          throw error;
        }
        createdLinks += 1;
        assertChineseError(await candidate.request(), 403);
      }
      if (createdLinks === 0) t.skip('当前 Windows 权限不允许创建符号链接或 Junction');
    });
  });

  test('中文及特殊字符文件可上传、重命名、移动、删除和恢复', async () => {
    await withFixture(async (fixture) => {
      await authenticate(fixture);
      const sourceFolder = '资料 & 相册';
      const destinationFolder = '目标 文件夹';
      const uploadName = '原始 #1.txt';
      const renamedName = '重命名 + 空格.txt';
      const contents = '你好，家庭 NAS！\n特殊字符：# & +';

      assertSuccess(
        await fixture.agent.post('/api/files/folder').send({ path: '', name: sourceFolder }),
        [200, 201],
      );
      assertSuccess(
        await fixture.agent.post('/api/files/folder').send({ path: '', name: destinationFolder }),
        [200, 201],
      );
      assertSuccess(await upload(fixture, sourceFolder, uploadName, contents), [200, 201]);
      assert.ok((await list(fixture, sourceFolder)).some((item) => itemName(item) === uploadName));

      assertSuccess(
        await fixture.agent.post('/api/files/rename').send({
          path: `${sourceFolder}/${uploadName}`,
          newName: renamedName,
          conflict: 'cancel',
        }),
        [200],
      );
      assertSuccess(
        await fixture.agent.post('/api/files/move').send({
          paths: [`${sourceFolder}/${renamedName}`],
          destination: destinationFolder,
          conflict: 'cancel',
        }),
        [200],
      );

      const downloadResponse = await fixture.agent
        .get('/api/files/download')
        .query({ path: `${destinationFolder}/${renamedName}` })
        .buffer(true)
        .parse(binaryParser);
      assert.equal(downloadResponse.status, 200);
      assert.deepEqual(downloadResponse.body, Buffer.from(contents));
      assert.match(downloadResponse.headers['content-disposition'] || '', /attachment/i);

      assertSuccess(
        await fixture.agent
          .post('/api/files/delete')
          .send({ paths: [`${destinationFolder}/${renamedName}`] }),
        [200],
      );
      assert.ok(!(await list(fixture, destinationFolder)).some((item) => itemName(item) === renamedName));

      const recycleResponse = await fixture.agent.get('/api/recycle/list');
      assertSuccess(recycleResponse, [200]);
      const recycled = responseItems(recycleResponse).find((item) =>
        itemPath(item).replaceAll('\\', '/').endsWith(`${destinationFolder}/${renamedName}`),
      );
      assert.ok(recycled, '删除后的文件应出现在回收站');
      assertSuccess(
        await fixture.agent
          .post('/api/recycle/restore')
          .send({ ids: [recycleId(recycled)], conflict: 'rename' }),
        [200],
      );
      assert.ok((await list(fixture, destinationFolder)).some((item) => itemName(item) === renamedName));
    });
  });

  test('恢复冲突使用自动改名且不覆盖任一文件', async () => {
    await withFixture(async (fixture) => {
      await authenticate(fixture);
      const originalName = 'conflict-file.txt';
      assertSuccess(await upload(fixture, '', originalName, '旧内容'), [200, 201]);
      assertSuccess(await fixture.agent.post('/api/files/delete').send({ paths: [originalName] }), [200]);
      assertSuccess(await upload(fixture, '', originalName, '新内容'), [200, 201]);

      const recycleResponse = await fixture.agent.get('/api/recycle/list');
      assertSuccess(recycleResponse, [200]);
      const recycled = responseItems(recycleResponse).find((item) =>
        itemPath(item).replaceAll('\\', '/').endsWith(originalName),
      );
      assert.ok(recycled);
      assertSuccess(
        await fixture.agent
          .post('/api/recycle/restore')
          .send({ ids: [recycleId(recycled)], conflict: 'rename' }),
        [200],
      );

      const names = (await list(fixture)).map(itemName);
      const conflictNames = names.filter(
        (name) => name === originalName || (name.startsWith('conflict-file') && name.endsWith('.txt')),
      );
      assert.equal(conflictNames.length, 2, `预期保留两个冲突文件，实际：${names.join(', ')}`);
      assert.ok(conflictNames.some((name) => name !== originalName), '恢复文件必须自动改名');

      const bodies = [];
      for (const name of conflictNames) {
        const response = await fixture.agent
          .get('/api/files/download')
          .query({ path: name })
          .buffer(true)
          .parse(binaryParser);
        assert.equal(response.status, 200);
        bodies.push(response.body.toString('utf8'));
      }
      assert.deepEqual(new Set(bodies), new Set(['旧内容', '新内容']));
    });
  });

  test('恢复文件时自动重建已不存在的原父目录', async () => {
    await withFixture(async (fixture) => {
      await authenticate(fixture);
      assertSuccess(
        await fixture.agent.post('/api/files/folder').send({ path: '', name: 'removed-parent' }),
        [200, 201],
      );
      assertSuccess(await upload(fixture, 'removed-parent', 'child.txt', 'child'), [200, 201]);
      assertSuccess(
        await fixture.agent.post('/api/files/delete').send({ paths: ['removed-parent/child.txt'] }),
        [200],
      );
      assertSuccess(
        await fixture.agent.post('/api/files/delete').send({ paths: ['removed-parent'] }),
        [200],
      );

      const recycleResponse = await fixture.agent.get('/api/recycle/list');
      assertSuccess(recycleResponse, [200]);
      const child = responseItems(recycleResponse).find(
        (item) => itemPath(item).replaceAll('\\', '/') === 'removed-parent/child.txt',
      );
      assert.ok(child);
      assertSuccess(
        await fixture.agent
          .post('/api/recycle/restore')
          .send({ ids: [recycleId(child)], conflict: 'rename' }),
        [200],
      );
      assert.equal(
        await fsp.readFile(path.join(fixture.shareRoot, 'removed-parent', 'child.txt'), 'utf8'),
        'child',
      );
    });
  });

  test('搜索、最近记录、系统状态与 ZIP 下载可用', async () => {
    await withFixture(async (fixture) => {
      await authenticate(fixture);
      assertSuccess(await upload(fixture, '', 'search-target.txt', 'target contents'), [200, 201]);
      await fsp.writeFile(path.join(fixture.shareRoot, 'second.txt'), 'second contents');

      const searchResponse = await fixture.agent
        .get('/api/files/search')
        .query({ query: 'target', path: '' });
      assertSuccess(searchResponse, [200]);
      assert.ok(responseItems(searchResponse).some((item) => itemName(item) === 'search-target.txt'));

      const recentResponse = await fixture.agent.get('/api/recent');
      assertSuccess(recentResponse, [200]);
      assert.ok(responseItems(recentResponse).some((item) => itemName(item) === 'search-target.txt'));
      assert.ok(responseItems(recentResponse).length <= 100);

      const statusResponse = await fixture.agent.get('/api/system/status');
      assertSuccess(statusResponse, [200]);
      assert.equal(path.resolve(statusResponse.body.shareRoot), path.resolve(fixture.shareRoot));
      assert.ok(Number.isInteger(statusResponse.body.port));
      assert.equal(typeof statusResponse.body.version, 'string');
      assert.match(statusResponse.body.firewallHint, /LocalSubnet/);

      const zipResponse = await fixture.agent
        .post('/api/files/download-zip')
        .send({ paths: ['search-target.txt', 'second.txt'] })
        .buffer(true)
        .parse(binaryParser);
      assert.equal(zipResponse.status, 200);
      assert.match(zipResponse.headers['content-type'] || '', /application\/zip/i);
      assert.match(zipResponse.headers['content-disposition'] || '', /attachment/i);
      assert.ok(Buffer.isBuffer(zipResponse.body));
      assert.deepEqual(zipResponse.body.subarray(0, 2), Buffer.from('PK'));
      assert.ok(zipResponse.body.includes(Buffer.from('search-target.txt')));
      assert.ok(zipResponse.body.includes(Buffer.from('second.txt')));
    });
  });

  test('媒体单段 Range 返回 206，无效或多段 Range 返回 416', async () => {
    await withFixture(async (fixture) => {
      await authenticate(fixture);
      await fsp.writeFile(path.join(fixture.shareRoot, 'range.flv'), Buffer.from('0123456789'));

      const partial = await fixture.agent
        .get('/api/files/stream')
        .query({ path: 'range.flv' })
        .set('Range', 'bytes=2-5')
        .buffer(true)
        .parse(binaryParser);
      assert.equal(partial.status, 206);
      assert.match(partial.headers['content-type'] || '', /^video\/x-flv\b/i);
      assert.equal(partial.headers['content-range'], 'bytes 2-5/10');
      assert.equal(partial.headers['accept-ranges'], 'bytes');
      assert.equal(Number(partial.headers['content-length']), 4);
      assert.deepEqual(partial.body, Buffer.from('2345'));

      for (const range of ['bytes=100-200', 'bytes=0-1,4-5']) {
        const invalid = await fixture.agent
          .get('/api/files/stream')
          .query({ path: 'range.flv' })
          .set('Range', range);
        assert.match(
          invalid.headers['content-type'] || '',
          /^application\/json\b/i,
          '416 错误必须使用 application/json 响应',
        );
        assertChineseError(invalid, 416);
        assert.equal(invalid.headers['content-range'], 'bytes */10');
      }
    });
  });

  test('大文件下载保持分块传输并完整返回内容', async () => {
    await withFixture(async (fixture) => {
      await authenticate(fixture);
      const size = 8 * 1024 * 1024 + 123;
      const largePath = path.join(fixture.shareRoot, 'large.bin');
      const fileHandle = await fsp.open(largePath, 'w');
      try {
        const block = Buffer.alloc(64 * 1024, 0x5a);
        let written = 0;
        while (written < size) {
          const length = Math.min(block.length, size - written);
          await fileHandle.write(block, 0, length);
          written += length;
        }
      } finally {
        await fileHandle.close();
      }

      let bytes = 0;
      let chunks = 0;
      const countChunks = (response, callback) => {
        response.on('data', (chunk) => {
          bytes += chunk.length;
          chunks += 1;
        });
        response.on('end', () => callback(null, { bytes, chunks }));
      };
      const response = await fixture.agent
        .get('/api/files/download')
        .query({ path: 'large.bin' })
        .buffer(true)
        .parse(countChunks);

      assert.equal(response.status, 200);
      assert.equal(response.body.bytes, size);
      assert.ok(response.body.chunks > 1, '大文件响应应分多个数据块输出');
      assert.equal(Number(response.headers['content-length']), size);
    });
  });

  test('文本与工作簿预览接口正确且执行大小边界', async () => {
    await withFixture(async (fixture) => {
      await authenticate(fixture);
      const text = '第一行\n第二行：# & +\n';
      await fsp.writeFile(path.join(fixture.shareRoot, '预览.txt'), text, 'utf8');
      await fsp.writeFile(
        path.join(fixture.shareRoot, '超大文本.txt'),
        'x'.repeat(2 * 1024 * 1024 + 1),
        'utf8',
      );

      const textResponse = await fixture.agent.get('/api/files/text').query({ path: '预览.txt' });
      assertSuccess(textResponse, [200]);
      assert.equal(textResponse.body.content, text);
      assert.equal(textResponse.body.truncated, false);

      const largeTextResponse = await fixture.agent
        .get('/api/files/text')
        .query({ path: '超大文本.txt' });
      assertSuccess(largeTextResponse, [200]);
      assert.equal(largeTextResponse.body.truncated, true);
      assert.ok(
        Buffer.byteLength(largeTextResponse.body.content, 'utf8') <= 2 * 1024 * 1024,
        '文本预览不得读取超过 2MiB',
      );

      const XLSX = require('xlsx');
      const rows = Array.from({ length: 505 }, (_, rowIndex) =>
        Array.from({ length: 52 }, (_, columnIndex) => `R${rowIndex}C${columnIndex}`),
      );
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), '数据');
      XLSX.writeFile(workbook, path.join(fixture.shareRoot, '表格.xlsx'));

      const metaResponse = await fixture.agent.get('/api/files/meta').query({ path: '表格.xlsx' });
      assertSuccess(metaResponse, [200]);
      assert.ok(metaResponse.body.preview, '工作簿 meta 响应应包含 preview');

      const findTable = (value) => {
        if (Array.isArray(value) && value.length > 0 && value.every(Array.isArray)) return value;
        if (!value || typeof value !== 'object') return null;
        for (const child of Object.values(value)) {
          const found = findTable(child);
          if (found) return found;
        }
        return null;
      };
      const table = findTable(metaResponse.body.preview);
      assert.ok(table, '工作簿 preview 应包含二维数组');
      assert.ok(table.length <= 500, `工作簿预览最多 500 行，实际 ${table.length}`);
      assert.ok(table.every((row) => row.length <= 50), '工作簿预览最多 50 列');
    });
  });
}
