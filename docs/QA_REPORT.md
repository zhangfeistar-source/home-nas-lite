# 家庭 NAS Lite 验收与安全审查报告

## 结论

- 审查日期：2026-07-01
- 环境：Windows，Node.js v22.22.2
- 结论：**自动化验收通过，可进入 Windows 安装包验证**。
- 集成测试：13 项全部通过。
- 已修复：无效 Range 的 `416` 响应保持 JSON 错误契约。
- 构建检查：JavaScript 语法检查与 `npm run verify` 均通过，前端 vendor 文件已本地生成。

## 自动化覆盖

测试入口为 `tests/integration.test.js`，使用 Node 内置 `node:test` 与 `supertest`；应用装配集中在 `tests/support/app-harness.js`，兼容 `createApp(options)` 返回 Express app 或 `{app}`。

| 验收项 | 结果 | 说明 |
| --- | --- | --- |
| 未登录访问受保护 API | 通过 | 文件、回收站、最近、状态、管理员 API 均返回中文 `401` JSON |
| 登录错误、正确、注销 | 通过 | 验证 Session 持续性及注销失效 |
| Session Cookie | 通过 | 验证 `HttpOnly`、`SameSite=Strict` |
| 管理员二次验证 | 通过 | 错误密码 `403`；验证成功不产生持久管理员权限 |
| 路径穿越与编码绕过 | 通过 | 覆盖 `../`、空段、`.`、盘符、反斜杠、UNC、绝对路径、NUL、单/双重编码 |
| 回收站保留目录 | 通过 | 普通 API 拒绝并且列表不暴露 `.recycle-bin` |
| 符号链接与 Junction | 通过 | 当前 Windows 环境成功创建入口并验证越界访问返回 `403` |
| 上传限制和临时文件 | 通过 | 超限返回 `413`；非法和超限上传均未遗留临时文件 |
| 中文及特殊字符 | 通过 | 覆盖文件夹、上传名、重命名、移动、下载、删除、恢复 |
| 恢复冲突 | 通过 | `conflict=rename` 保留新旧内容并自动改名 |
| 恢复缺失父目录 | 通过 | 原父目录删除后可自动重建并恢复文件 |
| 搜索、最近、系统状态 | 通过 | 验证搜索结果、最近记录上限和状态基本字段 |
| ZIP 下载 | 通过 | 验证 ZIP 类型、附件头、PK 签名和所选条目 |
| FLV 与 Range `206` | 通过 | 验证 `video/x-flv`、区间、长度、响应头和字节内容 |
| Range `416` | 通过 | 状态、`Content-Range` 与 `application/json` 错误响应均正确 |
| 大文件下载 | 通过 | 8 MiB+ 文件完整返回且观察到多个数据块；代码审查确认使用 `createReadStream` |
| 文本预览 | 通过 | 中文文本正确，2 MiB 截断边界有效 |
| 工作簿预览 | 通过 | 验证最多 500 行、50 列 |

尚未做故障注入验证：磁盘写满、文件被占用、网络中断、索引写入失败、超大 DOCX/压缩炸弹、安装与卸载真机流程。

## API 契约验收

1. 通用成功 JSON、中文错误：通过。
2. 认证接口：登录、注销、当前状态通过。
3. 文件接口：列表、搜索、上传、建夹、重命名、移动、删除、下载、ZIP、媒体流、文本和元数据均已覆盖。
4. 回收站：列表、恢复、冲突自动改名、永久删除通过；清空接口完成未登录拦截和代码审查，未执行破坏性功能流程。
5. 最近与系统状态：通过。
6. 状态码：已验证 `400/401/403/413/416`；`404/409/500` 未做完整故障矩阵。

## 安全规则逐条审查

| # | 结果 | 审查意见 |
| --- | --- | --- |
| 1 | 通过 | 路径输入矩阵通过，编码后再标准化，拒绝 Windows/UNC/绝对路径和危险片段 |
| 2 | 通过 | 文件操作集中使用路径安全服务，逐级 `lstat`、`realpath` 并检查根边界 |
| 3 | 部分通过 | symlink/Junction 实测通过，回收站隔离通过；其他 Windows reparse-point 类型缺少明确识别 |
| 4 | 通过 | multer 临时目录位于应用数据目录，失败和超限清理测试通过 |
| 5 | 通过 | 下载/ZIP/Range 均流式且先校验普通文件，附件名编码安全；`416` 使用 JSON |
| 6 | 通过 | 访问码和管理员密码使用随机盐 scrypt，配置保存哈希对象，无明文落盘路径 |
| 7 | 通过 | Session ID 由会话库生成，Cookie 属性通过；登录失败限速存在，未做时间窗口压力测试 |
| 8 | 通过 | 永久删除每次校验管理员密码，管理员验证不提升 Session 权限 |
| 9 | 通过 | Electron 使用 `contextIsolation:true`、`nodeIntegration:false`、`sandbox:true`，限制导航、新窗口、webview 和权限 |
| 10 | 通过 | 防火墙规则名、TCP、端口范围和 `LocalSubnet` 固定，无未校验 IPC 字符串拼接 |
| 11 | 通过 | 卸载默认保留应用数据，只有用户明确选择才删除 `%APPDATA%\\家庭NAS`，不触碰共享目录 |
| 12 | 通过 | 未发现记录密码、Session Cookie 或文件正文的日志代码 |

## 风险与修复建议

### P2：DOCX/工作簿解析库存在上游资源风险

- 位置：`server/services/file-service.js:416` 和 `server/services/file-service.js:425`。
- 影响：`mammoth` 与 `XLSX.readFile` 会解析整个容器；当前已增加 25MB 输入上限，但高压缩比或恶意构造文件仍可能短时占用较多 CPU/内存。`xlsx` 的 npm 安全公告暂无上游修复版本。
- 后续：把预览放入有超时及资源限制的 Worker，并评估迁移到有维护修复的兼容解析器；超限当前返回中文 `413`。
- 回归：增加超大文件、超高压缩比、超多 ZIP 条目和解析超时测试。

### P2：覆盖冲突先删除目标，失败时可能丢失数据

- 位置：`server/services/file-service.js:224`。
- 影响：覆盖上传、移动或重命名时，目标先被删除；后续移动失败会同时失去旧目标，且操作不可恢复。
- 修复：将旧目标先原子改名到同目录回滚名，再移动新目标；成功后删除回滚项，失败则恢复。跨卷上传应先完整写入同目录临时文件再替换。
- 回归：注入 `rename/stream` 失败，验证旧文件内容仍存在且无临时残留。

### P2：其他 Windows reparse-point 缺少显式拒绝证据

- 位置：`server/services/path-security.js:140` 等仅检查 `isSymbolicLink()`，随后依赖 `realpath` 边界。
- 影响：symlink/Junction 已覆盖，但云占位符、挂载点等其他 reparse-point 是否全部拒绝尚未证明，不完全满足安全规则第 3 条的严格表述。
- 修复：增加 Windows 文件属性/reparse tag 检查并默认拒绝未知类型；至少在 NTFS 真机加入 mount point、云占位符测试。

## 执行记录

- `node --check`：`server/`、`shared/`、`electron/`、`scripts/`、`tests/` 全部通过。
- `npm test`：13 通过，0 失败。
- `npm run copy-vendor`：通过，Mammoth 与 XLSX 浏览器资产已复制。
- `npm run verify`：通过。
- `npm run dist`：通过，生成包含本地 FLV 播放器的 `dist/家庭NAS-Setup-1.0.0.exe`（96,541,932 字节）。
- 安装包 SHA-256：`5A2CAFEB3B089A0BA988216620F28B9734A304357DE57DE3B862543BF7D4BA6E`。
- ASAR 内容检查：未包含 `tests/`、`docs/`、真实共享文件、回收站索引或最近文件索引。
- 尚未在第二台 Windows 电脑上执行安装、UAC 防火墙授权和真实卸载交互。
