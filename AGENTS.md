# 家庭 NAS Lite 协作约定

## 总则
- 产品面向 Windows 10/11 家庭局域网，界面和错误信息使用简体中文。
- 不引入 CDN、云端 API、Docker、Python 运行时或前端框架。
- 所有文件路径由服务端按共享根目录进行校验；禁止把客户端传入路径直接交给文件系统。
- 大文件、下载、ZIP 和媒体响应使用流，不整文件读入内存。
- 配置与索引存入 `%APPDATA%\家庭NAS`；真实共享文件只存入用户选择的共享目录。

## 目录所有权
- `server/`、`shared/`：后端与文件安全。
- `public/`：浏览器前端。
- `electron/`、`build/`、`scripts/`：桌面外壳、安装和构建。
- `tests/`、`docs/QA_REPORT.md`：验收与安全审查。
- 根目录共享配置由主代理维护。

## 质量门槛
- 修改者应运行负责范围内的测试或静态检查。
- 不得削弱 `contextIsolation`、`nodeIntegration`、Session Cookie、路径边界或管理员二次验证。
- 不提交真实共享文件、密码、会话密钥、应用数据、安装产物缓存。

