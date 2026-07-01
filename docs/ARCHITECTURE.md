# 架构设计

## 进程与边界
- Electron 主进程负责生命周期、首次启动、窗口、托盘、目录选择、网络地址和防火墙提权。
- Express 与 Electron 同进程启动，但通过返回的 `close()` 进行受控关闭；测试可独立创建应用。
- 浏览器和 Electron 渲染器只访问 HTTP API；preload 仅暴露白名单 IPC。
- `server/services` 负责认证配置、路径解析、文件、回收站、预览和元数据。

## 数据位置
- 应用数据：`%APPDATA%\家庭NAS\config.json`、`data/`、`logs/`、`recycle-bin-index.json`、`recent-files.json`。
- 用户数据：配置指定的 `shareRoot`。
- 回收站内容：`<shareRoot>/.recycle-bin/<uuid>`，索引保存原相对路径和元数据。

## 安全模型
- 所有 API 路径为 `/` 分隔的相对路径；拒绝绝对路径、盘符、UNC、NUL、`.`、`..` 和编码绕过。
- 对现存路径逐级解析真实路径，确保不经过 symlink/junction；创建目标验证最近现存父目录。
- Session Cookie 为 HttpOnly、SameSite=Strict，内存会话适用于单机家庭场景，重启失效。
- 密码使用 `scrypt` 随机盐哈希；管理员敏感 API 每次提交密码验证。
- 服务监听 `0.0.0.0` 以支持局域网，不提供公网发现、映射或 UPnP；防火墙规则限定 `LocalSubnet`。

## 流与资源
- 下载使用 `createReadStream`；视频按 Range 分段；ZIP 由 archiver 流式输出。
- 上传由 multer 写入应用数据临时目录，再安全移动到共享目录。
- 文本最多读取 2MiB；工作簿预览限制 500 行、50 列；DOCX 转换在服务端执行。

## 端口与启动
- 顺序探测 `8787-8799`，成功端口写回配置。
- 首次配置完成前只在主窗口显示本地向导；完成后启动服务器并加载本机网页。
- 关闭窗口最小化到托盘；“停止并退出”关闭 HTTP 服务后退出。

