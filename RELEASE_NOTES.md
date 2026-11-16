# v1.3.0 · 把 v1.2.1 的改动实测了一遍，补掉三处漏判

v1.2.1 把时间线挪进 `shots.js`、加了 jpeg 工作流。我逐项实测，发现三个「看着通过、其实没检查」的漏洞，全部修掉并加了回归测试。

## 修复

| 问题 | 现象 | 修复 |
|---|---|---|
| 时间线写成变量就静默通过 | `addShot(A, B, …)` 时正则读不到数字，`verify.js` 打「未检测到时间线，跳过」然后**退出 0 给绿灯**——检查项消失了但没人知道 | 区分三种情况：全是字面量→正常校验；一个数字都读不出→**判失败**；部分变量→判失败并要求改成 `addShot(0, 3.2, …)`。同时排除 `addShot` 自身函数定义与 init 兜底循环，避免误报 |
| 第三方库触发红线误报 | `p5.min.js` 自带 `https://` 和 `Math.random()`，一合并扫描就报「有外部网络地址 / 有随机数」——真实项目（105 镜 + p5）直接红了一片 | 按文件名（p5/three/vendor/lib/…）与体积（>400KB）分流，只对**自写脚本**做红线扫描；时间线检测同样排除第三方库 |
| 看板「最新帧」永远是 `.png` | 用了 `--quality=jpeg` 后帧是 `.jpg`，但 `server.js` 把 `lastFrame` 硬编码成 `f_00000.png`，帧代理 404 | 新增 `detectFrameExt()` 读帧目录实际扩展名；`POST /api/render` 回传值也带上 `frameExt` |

## 加固

- **请求体统一按 UTF-8 解码**：原来 6 处 `body += chunk` 依赖 Node 的隐式转换，换环境/换发送端容易踩编码坑。改为 `readBody()`（Buffer 拼接后 `toString('utf8')`），并加 32MB 上限与「非法 JSON」可读报错。
- **`POST /api/render` 可带 `totalFrames`**：看板不再用旧的 6240 算进度，避免换了时长就显示 >100%。

## 新增回归测试

`test-verify-timeline.js`（自包含，CI 与本地都能跑）：四种写法必须给出正确结论——全字面量通过、全变量失败、混合失败、断档失败。已接入 `pipeline-ci`。

```bash
node test-verify-timeline.js
[PASS] 全部字面量 / [PASS] 全部变量 / [PASS] 部分变量（混合） / [PASS] 有断档
```

## 实测数据

- jpeg 渲染：6s@24fps → 145 帧，**18.6 帧/秒**（同条件 png 13.7 帧/秒）
- `compose.js` 省略 `--pattern` 时正确识别为 `f_%05d.jpg`
- 帧代理：`f_00001.png` → 200 image/png；`f_00002.jpg` → 200 image/jpeg；不存在 → 404
- 真实项目回归：《Take Me Hand》105 镜、260s，`verify.js` 全绿（p5 已分流）

---

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
