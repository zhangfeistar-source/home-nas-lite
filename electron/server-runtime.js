'use strict';

const http = require('node:http');

const HOST = '0.0.0.0';
const PORT_START = 8787;
const PORT_END = 8799;

function isPortConflict(error) {
  return error && (error.code === 'EADDRINUSE' || error.code === 'EACCES');
}

function listen(requestListener, port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(requestListener);
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
    server.listen({ host: HOST, port, exclusive: true });
  });
}

function closeHttpServer(server) {
  return new Promise((resolve, reject) => {
    if (!server || !server.listening) {
      resolve();
      return;
    }
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
    setTimeout(() => {
      server.closeAllConnections?.();
    }, 5000).unref();
  });
}

function getListeningPort(server) {
  const address = server?.address?.();
  return address && typeof address === 'object' ? address.port : null;
}

async function normalizeStartedServer(result) {
  const server = result?.server || (typeof result?.address === 'function' ? result : null);
  const port = Number(result?.port || getListeningPort(server));
  if (!Number.isInteger(port) || port < PORT_START || port > PORT_END) {
    throw new Error('服务端未返回 8787-8799 范围内的实际监听端口。');
  }

  let close;
  if (typeof result?.close === 'function' && result !== server) {
    close = () => new Promise((resolve, reject) => {
      let settled = false;
      const forceCloseTimer = setTimeout(() => {
        server?.closeAllConnections?.();
      }, 5000);
      forceCloseTimer.unref();
      const done = (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(forceCloseTimer);
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      try {
        const returnValue = result.close.length > 0 ? result.close(done) : result.close();
        if (returnValue && typeof returnValue.then === 'function') {
          returnValue.then(() => done(), done);
        } else if (result.close.length === 0) {
          done();
        }
      } catch (error) {
        done(error);
      }
    });
  } else {
    close = () => closeHttpServer(server);
  }

  return { port, server, close };
}

async function startWithCreateApp(createApp, options) {
  const created = await createApp(options);
  const alreadyStarted = created?.server?.listening
    || (created?.listening && typeof created?.address === 'function');
  if (alreadyStarted) {
    return normalizeStartedServer(created);
  }

  const requestListener = typeof created === 'function' ? created : created?.app;
  if (typeof requestListener !== 'function') {
    throw new Error('createApp() 必须返回 Express 应用或包含 app 的对象。');
  }

  let lastError;
  for (let port = PORT_START; port <= PORT_END; port += 1) {
    try {
      const server = await listen(requestListener, port);
      if (requestListener.locals?.runtime) {
        requestListener.locals.runtime.port = port;
      }
      return {
        port,
        server,
        close: async () => {
          requestListener.locals?.dispose?.();
          await closeHttpServer(server);
        },
      };
    } catch (error) {
      if (!isPortConflict(error)) {
        throw error;
      }
      lastError = error;
    }
  }
  throw new Error('端口 8787-8799 均被占用或不可用。', { cause: lastError });
}

async function startWithStartServer(startServer, options) {
  let lastError;
  for (let port = PORT_START; port <= PORT_END; port += 1) {
    try {
      const result = await startServer({
        ...options,
        host: HOST,
        port,
        portStart: port,
        portEnd: PORT_END,
        endPort: PORT_END,
      });
      return normalizeStartedServer(result);
    } catch (error) {
      if (!isPortConflict(error)) {
        throw error;
      }
      lastError = error;
    }
  }
  throw new Error('端口 8787-8799 均被占用或不可用。', { cause: lastError });
}

async function startApplicationServer(serverModulePath, options) {
  let serverModule;
  try {
    serverModule = require(serverModulePath);
  } catch (error) {
    throw new Error('无法加载服务端模块 server/app.js。', { cause: error });
  }

  const createApp = serverModule.createApp || serverModule.default?.createApp;
  const startServer = serverModule.startServer || serverModule.default?.startServer;
  if (typeof createApp === 'function' && typeof startServer === 'function') {
    const application = await createApp({
      ...options,
      host: HOST,
      portStart: PORT_START,
      portEnd: PORT_END,
    });
    return startWithStartServer(startServer, { ...options, app: application });
  }
  if (typeof createApp === 'function') {
    return startWithCreateApp(createApp, {
      ...options,
      host: HOST,
      portStart: PORT_START,
      portEnd: PORT_END,
    });
  }
  if (typeof startServer === 'function') {
    return startWithStartServer(startServer, options);
  }
  throw new Error('server/app.js 未导出 createApp 或 startServer。');
}

module.exports = {
  HOST,
  PORT_END,
  PORT_START,
  startApplicationServer,
};
