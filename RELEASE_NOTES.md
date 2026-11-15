# v1.2.1 · 第一次实战暴露的问题

拿《Fractures》MV（245.29s / 93 镜 / 5888 帧）跑通整条链路时暴露的问题，全部修掉。

## 修复

| 问题 | 现象 | 修复 |
|---|---|---|
| `init.js` 生成的 `shots.js` 从没被加载 | `scene.html` 里没有 `<script src>`，时间线只存在于页面内置的兜底循环；`verify.js` 又只扫 `scene.html`，于是 `shots.js` 成了摆设 | `scene.html` 改为 `<script src="shots.js">` 显式加载（脚本缺失时仍回退到内置占位时间线）；`verify.js` 会读页面引用的本地脚本 |
| `verify.js` 看不见外部时间线 | 时间线写在 `shots.js` 里时被判「未检测到 addShot」 | 把页面 + 引用的本地脚本合并扫描：脚本缺失直接判失败，红线与 `addShot` 时间线一并检查 |
| `verify.js` 空跑算通过 | 忘了给 `--scene` 时零检查项也退出 0，假通过 | 零检查项直接退出 2 |
| 控制台改不了项目名 | `state.json` 里 `project` 写死成上一位用户的项目名，改它只能停服改文件 | 新增 `POST /api/project`、`POST /api/current`；默认项目名改为「（未命名项目）」 |
| 帧代理只认 PNG、路径写死 | jpeg 工作流下看板的实时帧全 404 | 代理支持 png / jpg，目录可用 `--frames=<dir>` 或 `FRAMES_DIR` 指定 |
| `compose.js` 不给 `--pattern` 就按 PNG | jpeg 帧目录必须手传模式，忘了就报找不到首帧 | 省略时按帧目录里的实际文件名自动识别 png / jpg |
| PNG 渲染长片太慢 | 1080p 单帧约 700KB、约 4.5 帧/秒，245s@24fps 要跑近 40 分钟 | 文档明确长片用 `--quality=jpeg`（实测约 15 帧/秒），并新增 `--jpeg-quality`（默认 92） |

---

# v1.1.0 · 可跑的工具链

v1.0.0 只有控制台（看得见进度），从零到成片还得自己写脚本。v1.1.0 补齐了这条链：**建骨架 → 逐帧渲染 → 合成混音 → 自检**，四步即可出片。

## 新增

| 文件 | 能力 |
|---|---|
| `init.js` | 一键生成项目骨架：`brief.md` / `shots.csv` / `manifest.json` / `engine/scene.html`（**纯 Canvas 2D，零外部依赖**）/ `engine/shots.js`（占位时间线自动铺满时长）/ `review/` `audio/` `frames/` `deliver/` |
| `render.js` | 生产级逐帧渲染：自动读 `<canvas>` 尺寸设视口；只调 `__seek(t)`，不读系统时间；运行期捕获 `pageerror` 与外部 `requestfailed`（红线 3 的运行时佐证）；支持 `--report` 把进度推给控制台、`--start/--end` 只重渲某段 |
| `compose.js` | ffmpeg 封装：帧序列 + 音轨 → 成片；`--pix-fmt yuv444p/yuv420p` 可选 |
| `verify.js` | 自检：页面 / 时间线 / 帧序列 / 成片四组检查，退出码 0 = 可交付 |

## 修复的真实坑

1. **ffmpeg 读不了含中文的绝对路径** —— image2 demuxer 对非 ASCII 路径解析失败（报 `Could find no file with path ... and index in the range 0-4`）。`compose.js` 改为在帧目录内用相对模式调用。
2. **aac 编码器被标为 experimental** —— 部分发行版不加 `-strict -2` 直接报错退出。`compose.js` 自动带上。
3. **`init.js` 模板原本引 CDN 的 p5** —— 直接违反红线 3。改成纯原生 Canvas 2D，模板开箱即合规。
4. **`render.js` 视口按窗口而非画布** —— 1280×720 的画布会被截成 800×600。改为优先读 `document.querySelector('canvas')`。

## CI

两个工作流全部改为此前不可想象的真跑：

- **Render Demo Frame**：`init` → `render`（145 帧）→ `compose`（带音轨）→ `verify`，产物上传 artifact
- **Pipeline CI**：五个文件语法检查 + `init` 冒烟 + `verify` 对页面/时间线自检 + 控制台 5 端点冒烟

本地实测：`init(6s/24fps) → render 145 帧 7.8s → compose 0.11MB → verify 全部通过`。

## 升级建议

若你已有自己的 `scene.html`，只需确认它暴露 `window.__ready` / `window.__duration` / `window.__seek(t)`，即可直接交给 `render.js`。

## 落地案例

《Take Me Hand》MV：260 秒、105 镜、1920×1080、24fps，6241 帧，纯代码生成，无图像生成模型。审核：生产 100 镜 → round1 84 分打回 → 修复 → round2 93 分通过。
