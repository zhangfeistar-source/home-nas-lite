'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const FIREWALL_RULE_NAME = '家庭 NAS Lite（仅家庭网络）';

function encodePowerShell(command) {
  return Buffer.from(command, 'utf16le').toString('base64');
}

function runPowerShell(encodedCommand) {
  const executable = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      encodedCommand,
    ], {
      windowsHide: true,
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(code === 1223
          ? '已取消 Windows 管理员授权。'
          : `Windows 防火墙配置失败（退出代码 ${code ?? '未知'}）。`));
      }
    });
  });
}

async function configureFirewall(port) {
  if (process.platform !== 'win32') {
    throw new Error('自动配置防火墙仅支持 Windows。');
  }
  if (!Number.isInteger(port) || port < 8787 || port > 8799) {
    throw new Error('拒绝为无效端口配置防火墙。');
  }

  const innerCommand = [
    "$ErrorActionPreference = 'Stop'",
    `$ruleName = '${FIREWALL_RULE_NAME}'`,
    '$netsh = Join-Path $env:SystemRoot "System32\\netsh.exe"',
    '& $netsh advfirewall firewall delete rule name="$ruleName" | Out-Null',
    '& $netsh advfirewall firewall add rule name="$ruleName" dir=in action=allow enable=yes profile=private protocol=TCP localport='
      + String(port) + ' remoteip=LocalSubnet',
    'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }',
  ].join('; ');
  const innerEncoded = encodePowerShell(innerCommand);
  const outerCommand = [
    '$powershell = Join-Path $env:SystemRoot "System32\\WindowsPowerShell\\v1.0\\powershell.exe"',
    `$arguments = @('-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand','${innerEncoded}')`,
    '$process = Start-Process -FilePath $powershell -ArgumentList $arguments -Verb RunAs -Wait -PassThru',
    'exit $process.ExitCode',
  ].join('; ');

  await runPowerShell(encodePowerShell(outerCommand));
}

module.exports = {
  FIREWALL_RULE_NAME,
  configureFirewall,
};
