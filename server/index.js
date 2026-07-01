'use strict';

const { createApp, startServer } = require('./app');

module.exports = {
  createApp,
  startServer
};

if (require.main === module) {
  startServer()
    .then(({ port }) => {
      process.stdout.write(`家庭 NAS 服务已启动：http://127.0.0.1:${port}\n`);
    })
    .catch((error) => {
      process.stderr.write(`家庭 NAS 启动失败：${error.message}\n`);
      process.exitCode = 1;
    });
}
