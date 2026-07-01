'use strict';

const setupForm = document.querySelector('#setupForm');
const chooseDirectoryButton = document.querySelector('#chooseDirectory');
const sharePathOutput = document.querySelector('#sharePath');
const submitButton = document.querySelector('#submitButton');
const statusBox = document.querySelector('#status');
const recoveryNotice = document.querySelector('#recoveryNotice');

let shareDirectoryToken = null;

function showStatus(message, kind = 'error') {
  statusBox.textContent = message;
  statusBox.className = `notice ${kind}`;
}

function clearStatus() {
  statusBox.textContent = '';
  statusBox.className = 'notice hidden';
}

function setBusy(busy) {
  chooseDirectoryButton.disabled = busy;
  submitButton.disabled = busy;
  submitButton.textContent = busy ? '正在安全启动…' : '完成设置并启动';
}

chooseDirectoryButton.addEventListener('click', async () => {
  clearStatus();
  chooseDirectoryButton.disabled = true;
  try {
    const result = await window.nasDesktop.chooseShareDirectory();
    if (!result.ok) {
      if (!result.canceled) {
        showStatus(result.message || '无法选择共享目录。');
      }
      return;
    }
    shareDirectoryToken = result.token;
    sharePathOutput.textContent = result.path;
    sharePathOutput.title = result.path;
  } catch {
    showStatus('目录选择器暂时不可用，请重试。');
  } finally {
    chooseDirectoryButton.disabled = false;
  }
});

setupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearStatus();

  const accessCode = document.querySelector('#accessCode').value;
  const accessCodeConfirm = document.querySelector('#accessCodeConfirm').value;
  const adminPassword = document.querySelector('#adminPassword').value;
  const adminPasswordConfirm = document.querySelector('#adminPasswordConfirm').value;
  if (!shareDirectoryToken) {
    showStatus('请先选择共享目录。');
    return;
  }
  if (accessCode.length < 6) {
    showStatus('家庭访问码至少需要 6 个字符。');
    return;
  }
  if (accessCode !== accessCodeConfirm) {
    showStatus('两次输入的家庭访问码不一致。');
    return;
  }
  if (adminPassword.length < 6) {
    showStatus('管理员密码至少需要 6 个字符。');
    return;
  }
  if (adminPassword !== adminPasswordConfirm) {
    showStatus('两次输入的管理员密码不一致。');
    return;
  }
  if (accessCode === adminPassword) {
    showStatus('管理员密码不能与家庭访问码相同。');
    return;
  }

  setBusy(true);
  try {
    const result = await window.nasDesktop.completeSetup({
      directoryToken: shareDirectoryToken,
      accessCode,
      adminPassword,
      configureFirewall: document.querySelector('#configureFirewall').checked,
    });
    if (!result.ok) {
      showStatus(result.message || '设置未完成，请重试。');
      return;
    }
    showStatus(
      result.warning
        ? `服务已启动，但有一项需要处理：${result.warning}`
        : `设置完成，正在打开 ${result.localUrl}`,
      result.warning ? 'warning' : 'success',
    );
  } catch {
    showStatus('设置过程中发生错误，请重试。');
  } finally {
    setBusy(false);
  }
});

window.nasDesktop.getSetupState().then((state) => {
  if (state?.startupError) {
    recoveryNotice.textContent = `上次配置未能启动：${state.startupError}。你可以重新选择目录并设置凭据。`;
    recoveryNotice.classList.remove('hidden');
  }
}).catch(() => {
  showStatus('无法读取首次启动状态，请重新启动应用。');
});
