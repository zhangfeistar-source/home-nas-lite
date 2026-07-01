# 家庭 NAS Lite

家庭 NAS Lite 是一个安装在 Windows 10/11 电脑上的家庭局域网文件共享工具。它不依赖公网、云服务、Docker 或目标电脑上的 Node.js。

## 开发环境

- Windows 10/11 x64
- Node.js 20 或更高版本
- npm

```powershell
npm install
npm run dev
```

首次启动按向导选择共享目录并设置家庭访问码、管理员密码。默认尝试端口 `8787`，占用时顺延至 `8799`。

## 检查与测试

```powershell
npm test
npm run verify
```

## 生成安装包

```powershell
npm run dist
```

安装包输出为：

```text
dist\家庭NAS-Setup-1.0.0.exe
```

安装包已包含 Electron 与 Node.js 运行时，目标电脑无需预装开发工具。

## 家庭设备访问

1. 保持安装家庭 NAS 的电脑开机，并避免进入睡眠。
2. 在主窗口或托盘中查看 `http://局域网IP:端口`。
3. 手机、平板和其他电脑连接同一个 Wi-Fi。
4. 用浏览器打开该地址，输入家庭访问码。

## 安全说明

- 不要在路由器上配置端口映射，不要把本软件暴露到公网。
- 防火墙规则只应允许 TCP 实际端口和 `LocalSubnet`。
- 卸载应用不会删除家庭共享文件；应用配置默认也会保留。
- FLV 使用内置 `flv.js` 本地播放，支持以 H.264 视频配合 AAC/MP3 音频编码的常见 FLV 文件。
- HEVC、MOV、MKV、AVI 等能否播放取决于设备浏览器的编解码能力，本软件不转码。

## 数据位置

- 应用配置与索引：`%APPDATA%\家庭NAS\`
- 真实共享文件：首次启动时选择的目录
- 回收站：共享目录内的 `.recycle-bin`
