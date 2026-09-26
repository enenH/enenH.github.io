# DFM 实时地图 · GitHub Pages

网站入口：<http://enenh.com/>。GitHub Pages 从 `main` 的根目录发布纯静态页面，保留现有 HTTP/WS。

## 页面和节点的分工

- HTML、CSS、JavaScript、Worker 和公开节点清单由 GitHub Pages 托管。
- 房间号首位数字选择 `nodes.json` 中的节点，浏览器直连其 WebSocket。
- 2D/3D 模型目录请求发往同一个节点的 `/models/{name}`，不请求 GitHub Pages 的 `/models/`。
- 节点允许 `http://enenh.com` 跨域读取模型元数据；实际地图数据由浏览器从云存储直接分段下载，临时签名链接不会写进仓库。

本仓库不运行 Node/Python 后端，也不包含服务器密码、私有部署记录或完整模型包。

## 更新静态文件

源代码在相邻项目 `../dfm-plus-gongyi/web`。先构建，再同步经过清单和 SHA-256 校验的公开产物：

```powershell
npm --prefix ../dfm-plus-gongyi/web run build
node tools/sync-web.mjs ../dfm-plus-gongyi/web
```

同步器会拒绝过期或被修改的构建，不会复制 `server/`、部署脚本、`node_modules/` 或 `.venv/`；会保留 `CNAME`。确认节点接口和资源验收通过后，再提交并推送 `main`。

## 旧站备份

旧网站代码和提交历史保留在远程分支 `backup/old-site`，备份提交为 `3aad025a62ee681df341fcc5eb36284776a72723`。需要恢复时可从该分支取回文件；不需要重写或强制推送历史。
