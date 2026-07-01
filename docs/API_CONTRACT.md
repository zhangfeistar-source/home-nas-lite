# API 契约

## 通用规则
- JSON 成功响应：`{"ok":true,...}`；错误：`{"ok":false,"message":"中文说明"}`。
- 除登录外，`/api/files/*`、`/api/recycle/*`、`/api/recent`、`/api/system/status`、管理员验证均要求 Session。
- 路径字段统一为共享根目录下 `/` 分隔相对路径，根目录为空字符串。
- 管理员敏感请求在 JSON Body 中传 `adminPassword`。

## 认证
- `POST /api/auth/login` `{accessCode}`。
- `POST /api/auth/logout`。
- `GET /api/auth/me` 返回 `{authenticated}`。
- `POST /api/admin/verify` `{adminPassword}`。

## 文件
- `GET /api/files/list?path=` 返回 `{path,items[]}`。
- `GET /api/files/search?query=&path=` 返回 `{items[]}`。
- `POST /api/files/upload` multipart：`files`、`path`、`conflict=overwrite|rename|cancel`。
- `POST /api/files/folder` `{path,name}`。
- `POST /api/files/rename` `{path,newName,conflict}`。
- `POST /api/files/move` `{paths[],destination,conflict}`。
- `POST /api/files/delete` `{paths[]}`。
- `GET /api/files/download?path=` 返回附件流。
- `POST /api/files/download-zip` `{paths[]}` 返回 ZIP 流。
- `GET /api/files/stream?path=` 返回媒体流并支持单段 Range。
- `GET /api/files/text?path=` 返回 `{content,truncated}`。
- `GET /api/files/meta?path=` 返回元数据；DOCX/表格可包含 `preview`。

## 回收站与系统
- `GET /api/recycle/list` 返回 `{items[]}`。
- `POST /api/recycle/restore` `{ids[],conflict=rename|overwrite}`。
- `POST /api/recycle/purge` `{ids[],adminPassword,confirm:true}`。
- `POST /api/recycle/empty` `{adminPassword,confirm:true}`。
- `GET /api/recent` 返回最多 100 条。
- `GET /api/system/status` 返回共享目录、端口、IP、磁盘、版本和防火墙提示。

## 状态码
- `400` 参数或路径错误；`401` 未登录/凭据错误；`403` 管理员验证失败；`404` 不存在；`409` 冲突；`413` 上传过大；`416` Range 无效；`500` 内部错误。

