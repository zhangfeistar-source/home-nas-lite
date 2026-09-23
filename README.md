家庭 NAS Lite / Home NAS Lite
中文 | English

中文说明
简介
家庭 NAS Lite 是一款安装在 Windows 10/11 电脑上的家庭局域网文件共享工具。它把电脑上选定的真实文件夹变成家庭共享空间：手机、平板和其他电脑连上同一个 Wi-Fi，用浏览器就能登录、浏览、上传、下载、整理、删除和在线预览文件。

它不依赖公网、云服务、Docker，目标电脑也不需要预装 Node.js。

功能特性
文件管理

文件夹浏览、搜索、上传、下载、打包 ZIP
新建文件夹、重命名、移动、删除、恢复
在线预览

类型	实现方式
图片	浏览器原生渲染
视频	浏览器原生解码支持
FLV	内置 flv.js，基于 Media Source Extensions，支持常见 H.264 + AAC/MP3 组合
PDF	内置 PDF.js 渲染到 Canvas，支持分页与缩放，不依赖设备浏览器的 PDF 阅读器
DOCX	服务端 Mammoth 转为 HTML，浏览器端按白名单清洗后显示
XLSX / XLS / CSV	表格预览
文本	纯文本直接预览
其他能力

回收站：普通删除进入共享目录下隐藏的 .recycle-bin，30 天后自动清理；永久删除需管理员密码
双重身份：家庭访问码（家人日常使用）与管理员密码（敏感操作）分离
最近上传列表、状态页
首次启动向导，端口自动选择（默认尝试 8787，被占用时顺延至 8799）
主窗口与托盘常驻显示本机及局域网访问地址
可选一键放行防火墙规则，且仅限 LocalSubnet
中文界面，接近 Windows 文件资源管理器的操作习惯，触控目标不小于 40px；窄屏自动切换为可横向滚动列表与折叠导航
下载与安装
前往 Releases 下载：

文件	说明
FamilyNAS-Setup-1.0.1.exe	安装版，双击安装。支持自定义安装目录，自动创建桌面与开始菜单快捷方式
win-unpacked-v1.0.1.zip	绿色免安装版。解压后运行 win-unpacked 目录下的「家庭 NAS.exe」
FamilyNAS-Setup-1.0.1.exe.blockmap	增量更新映射，配合 electron-updater 使用，普通用户无需下载
关于文件名：GitHub 会剥离 Release 附件名中的非 ASCII 字符，因此下载文件名统一使用 FamilyNAS 前缀，安装后的应用名称仍为「家庭 NAS」。

安装包已包含 Electron 与 Node.js 运行时，目标电脑无需预装任何开发工具。系统要求：Windows 10/11 x64。

使用步骤
首次启动：选择共享目录 → 设置家庭访问码与管理员密码 →（可选）放行防火墙端口
在主窗口或托盘中查看访问地址，形如 http://局域网IP:端口
手机、平板或其他电脑连接同一个 Wi-Fi，用浏览器打开该地址并输入家庭访问码
保持安装本软件的电脑开机，并避免进入睡眠
开发与构建
环境要求：

Windows 10/11 x64
Node.js 20 或更高版本
npm
npm install          # 安装依赖
npm run dev          # 本地启动
npm test             # 运行测试（认证、路径安全、文件生命周期、回收站冲突、Range、中文路径）
npm run verify       # 检查静态资产、配置、安全关键项与安装脚本
npm run dist         # 生成 Windows x64 安装包
构建产物输出到：

dist\家庭NAS-Setup-1.0.1.exe
数据位置
内容	路径
应用配置与索引	%APPDATA%\家庭NAS\
真实共享文件	首次启动时选择的目录
回收站	共享目录内的 .recycle-bin
安全提示
不要在路由器上配置端口映射，不要把本软件暴露到公网
防火墙规则只应允许 TCP 实际端口，且限定 LocalSubnet
卸载应用不会删除家庭共享文件，应用配置默认也会保留
已知限制
不提供公网访问、云同步、账号体系、自动备份、转码、SMB 与原生移动 App
旧版 .doc 不支持直接预览，请下载后用本地应用打开
HEVC、MOV、MKV、AVI 等能否播放取决于设备浏览器的编解码能力，本软件不做转码，仅在无法播放时提示下载
DOCX 的复杂分页与浮动排版允许与 Word 原稿存在差异
项目文档
产品规格
架构说明
接口约定
安全规则
测试报告
English
Overview
Home NAS Lite is a LAN file-sharing tool that runs on a Windows 10/11 PC. It turns a real folder on that computer into a shared family space: phones, tablets and other computers on the same Wi-Fi can sign in through a browser and browse, upload, download, organise, delete and preview files.

It needs no public internet exposure, no cloud service and no Docker, and the target machine does not need Node.js preinstalled.

Features
File management

Folder browsing, search, upload, download, ZIP packaging
Create folder, rename, move, delete, restore
In-browser preview

Type	How it works
Images	Native browser rendering
Video	Whatever the device browser can decode
FLV	Bundled flv.js over Media Source Extensions, covering common H.264 + AAC/MP3 combinations
PDF	Bundled PDF.js rendered to a Canvas with paging and zoom; does not rely on the device browser's PDF reader
DOCX	Server-side Mammoth converts to HTML, then sanitised in the browser against an allow-list
XLSX / XLS / CSV	Spreadsheet preview
Text	Plain text preview
Other capabilities

Recycle bin: an ordinary delete moves files into a hidden .recycle-bin inside the share root, cleaned up after 30 days; permanent deletion requires the admin password
Two roles: a family access code for daily use, kept separate from the admin password for sensitive operations
Recently uploaded list and a status page
First-run wizard, with automatic port selection (tries 8787, falls back up to 8799)
Main window and tray show both the local and LAN addresses at all times
Optional one-click firewall rule, restricted to LocalSubnet
Chinese UI modelled on Windows File Explorer, touch targets of at least 40px, and a narrow-screen layout that switches to a horizontally scrollable list with collapsed navigation
Download and install
Get the files from Releases:

File	Description
FamilyNAS-Setup-1.0.1.exe	Installer. Double-click to install; supports a custom install directory and creates desktop and Start menu shortcuts
win-unpacked-v1.0.1.zip	Portable build. Extract and run 家庭 NAS.exe inside the win-unpacked folder
FamilyNAS-Setup-1.0.1.exe.blockmap	Delta-update map for electron-updater; not needed by regular users
About file names: GitHub strips non-ASCII characters from release asset names, so the downloaded files use the FamilyNAS prefix. The installed application is still named 「家庭 NAS」.

The installer bundles the Electron and Node.js runtimes, so the target machine needs no development tools. Requirements: Windows 10/11 x64.

Getting started
On first launch: choose a shared folder → set the family access code and admin password → optionally allow the firewall port
Note the address shown in the main window or tray, in the form http://LAN-IP:port
Connect your phone, tablet or another computer to the same Wi-Fi, open that address in a browser and enter the family access code
Keep the host computer powered on and prevent it from sleeping
Development and build
Requirements:

Windows 10/11 x64
Node.js 20 or later
npm
npm install          # install dependencies
npm run dev          # start locally
npm test             # tests: auth, path security, file lifecycle, recycle-bin conflicts, Range, non-ASCII paths
npm run verify       # static assets, config, security-critical items, installer script
npm run dist         # build the Windows x64 installer
Build output:

dist\家庭NAS-Setup-1.0.1.exe
Where data lives
Content	Path
App configuration and index	%APPDATA%\家庭NAS\
Actual shared files	The folder chosen on first launch
Recycle bin	.recycle-bin inside the share root
Security notes
Do not add a port forwarding rule on your router and do not expose this software to the public internet
Firewall rules should only allow the actual TCP port and should be limited to LocalSubnet
Uninstalling does not delete your shared files, and the app configuration is kept by default
Known limitations
No public internet access, cloud sync, accounts, automatic backup, transcoding, SMB or native mobile app
Legacy .doc files cannot be previewed; download them and open them in a local application
Whether HEVC, MOV, MKV or AVI files play depends on the device browser's codec support. Nothing is transcoded; the UI only offers a download hint when playback is unsupported
Complex pagination and floating layouts in DOCX files may differ from the original Word document
Documentation
Product spec
Architecture
API contract
Security rules
QA report
技术栈 / Tech stack
Electron 37 · Express 4 · express-session · multer · archiver · flv.js · pdfjs-dist · mammoth · xlsx · electron-builder (NSIS)
