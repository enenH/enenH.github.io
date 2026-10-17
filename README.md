# DFM 实时地图 · GitHub Pages

网站入口：<http://enenh.com/>。输入客户端提供的 4 位房间号，即可查看实时平面地图或 3D 模型。

本仓库维护前端源码，使用 esbuild 构建到 `dist/`，由 GitHub Actions 发布到 GitHub Pages。实时数据由独立中继提供，仓库不包含中继后端或完整模型包。

## 使用方式

1. 在客户端开启共享，获取房间号。
2. 打开网站并输入房间号；进入对局后，页面自动识别地图并显示实时位置。
3. 按需切换平面地图与 3D 模型，可控制人机、物资标记的显示，并在 3D 模式选择友方跟随视角。

3D 模型仅加载当前地图，切回平面地图会取消正在进行的加载。靶场仅提供模型视图。

## 页面、节点与地图资源

- GitHub Pages 托管构建后的 HTML、CSS、JavaScript、Worker 和公开节点清单。
- 线上页面按房间号首位数字匹配 [nodes.json](nodes.json) 中的 `id`，浏览器直连对应节点的 `/ws?room=房间号`。HTTP 页面使用 `ws://`，HTTPS 页面使用 `wss://`，节点需支持相应协议。
- 平面地图使用 `game.gtimg.cn` 提供的 Leaflet 资源和地图瓦片。
- 浏览器直接读取远程 `models.zip` 的 ZIP 目录，并通过 HTTP Range 请求下载当前地图条目，再交由 Worker 解压、校验和构建几何数据。模型地址定义在 [src/model/archive.mjs](src/model/archive.mjs) 的 `MODEL_ARCHIVE_URL`，当前通过 `gh-proxy.org` 访问 GitHub Release。
- 已校验的模型压缩数据缓存在浏览器 IndexedDB 中，最多保留两张地图、合计 48 MiB。模型资源服务需允许跨域分段请求，并向浏览器暴露 `Content-Range` 和 `ETag`。

## 本地开发与预览

需要 Node.js 22 或更高版本及 npm；GitHub Actions 使用 Node.js 24。在本仓库根目录执行：

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm start
```

`npm start` 先构建，再启动预览服务。访问 <http://127.0.0.1:5173/>。修改源码后，停止预览并重新运行该命令。

本地页面通过同源 `/ws` 连接中继，预览服务默认将其代理到 `http://127.0.0.1:9001`。需要另行启动本地中继，并让客户端向该中继共享数据；预览服务只提供静态文件和 WebSocket 转发。本地加入房间时仍会校验房间号与 `nodes.json` 的匹配关系。

可在 PowerShell 中调整预览端口和本地中继地址：

```powershell
$env:PORT = "5174"
$env:DFM_RELAY_URL = "http://127.0.0.1:9002"
npm start
```

预览服务仅监听 `127.0.0.1`；`DFM_RELAY_URL` 仅接受主机为 `127.0.0.1` 或 `localhost` 的 HTTP 源地址。

## 构建与校验

修改 [src/](src/)、[index.html](index.html)、[styles.css](styles.css) 或节点清单后，执行：

```powershell
npm run build
npm run check
```

构建会重新生成 `dist/`，将应用和模型 Worker 打包到 `dist/assets/`，复制静态文件，并生成 `dist/build-manifest.json`。校验会检查源码摘要、产物 SHA-256、文件清单、HTML 资源引用、节点配置和自定义域名，拒绝过期、被修改、缺失或多余的产物。`npm run check` 需要先完成构建。

节点条目仅允许 `id`、`name`、`host`、`port` 四个字段，`id` 为不重复的 1–9，端口范围为 1–65535。

主要文件：

| 路径 | 用途 |
| --- | --- |
| `src/app.mjs`、`src/room-connection.mjs` | 页面交互、房间连接与重连 |
| `src/core.mjs`、`src/flat-map.mjs` | 地图配置、坐标转换与平面视图 |
| `src/view-controller.mjs`、`src/model/` | 视图切换、模型下载、缓存、解码与 3D 渲染 |
| `build.mjs` | esbuild 打包与静态文件复制 |
| `tools/build-manifest.mjs`、`tools/verify-build.mjs` | 构建清单、摘要与产物校验 |
| `tools/preview.mjs` | 本地静态预览与 WebSocket 代理 |
| `.github/workflows/pages.yml` | GitHub Pages 构建与部署 |

## 发布到 GitHub Pages

仓库的 Pages 发布源需设为 **GitHub Actions**。[发布工作流](.github/workflows/pages.yml) 在推送 `main` 时安装依赖、构建并校验，将 `dist/` 上传为 Pages 产物后部署。面向 `main` 的 Pull Request 执行构建与校验；也可手动触发工作流，部署仅在 `main` 分支执行。

提交源码、配置和 `package-lock.json` 即可，`node_modules/` 与 `dist/` 已加入忽略规则。自定义域名由 [CNAME](CNAME) 保持为 `enenh.com`，构建会同时复制 `CNAME` 与 `.nojekyll`。

## 旧站备份

旧网站代码和提交历史保留在远程分支 `backup/old-site`，备份提交为 `3aad025a62ee681df341fcc5eb36284776a72723`。需要恢复时可从该分支取回文件；不需要重写或强制推送历史。
