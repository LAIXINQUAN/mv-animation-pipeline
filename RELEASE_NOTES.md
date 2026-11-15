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
