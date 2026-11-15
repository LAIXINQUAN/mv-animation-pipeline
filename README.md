# MV 视频动画制作流水线

一套**主 AI 统筹 + 多子 Agent 并行生产 + 独立审核 + 逐帧渲染**的动画生产流水线，附带像素风实时控制台和从零到成片的四个命令行工具。

> **给 AI 用**：直接读 [SKILL.md](SKILL.md)，即可掌握整条流水线的调度方法。
> 本项目是《Take Me Hand》MV 的实际落地实现，全片 260 秒、105 镜、1920×1080、24fps，纯代码（p5.js 硬像素风格）生成，无任何图像生成模型。

---

## 特性

| 能力 | 说明 |
|---|---|
| **五阶段流水线** | 确立方向 → 生产镜头 → 独立审核 → 汇总放行 → 渲染交付 |
| **可跑的工具链** | `init` 建骨架 → `render` 逐帧渲染 → `compose` 合成混音 → `verify` 自检 |
| **像素风实时控制台** | 五阶段进度、当前任务、场景帧预览、渲染进度条、实时日志流 |
| **SSE 实时推送** | 零轮询，日志/状态/渲染进度毫秒级刷新 |
| **子 Agent 模型可配置** | 生产/审核 Agent 各自选模型，热保存 |
| **零依赖控制台** | Node 原生 `http` 实现，无需 npm install |

## 快速开始

```bash
# 1) 建项目骨架
node init.js my-mv --name="我的 MV" --duration=90 --fps=30

# 2) 改 engine/scene.html 与 engine/shots.js 的时间线
#    页面须暴露 window.__ready / window.__duration / window.__seek(t)

# 3) 逐帧渲染（用本机 Chrome，或 npm i puppeteer 用自带 Chromium）
node render.js my-mv/engine/scene.html --end=90 --fps=30 --out=my-mv/frames

# 4) 合成 + 混音
node compose.js --frames=my-mv/frames --fps=30 --audio=my-mv/audio/bgm.mp3 --out=my-mv/deliver/video.mp4

# 5) 自检（时间线 / 红线 / 帧序列 / 成片参数）
node verify.js --scene=my-mv/engine/scene.html --frames=my-mv/frames \
               --video=my-mv/deliver/video.mp4 --expect-duration=90 --fps=30

# 6) 控制台（可选，看进度）
node server.js          # http://127.0.0.1:8765
```

> `render.js` 需要 `puppeteer`（自带 Chromium）或 `puppeteer-core` + 本机 Chrome。
> 也能通过 `--chrome=<路径>` 或环境变量 `CHROME_PATH` 指定浏览器。

## 命令行工具

### `init.js` — 建项目骨架

```bash
node init.js <目录> [--name="项目名"] [--duration=90] [--fps=30] [--w=1920] [--h=1080]
```

生成 `brief.md`（六项决策）/ `shots.csv` / `manifest.json` / `engine/scene.html`（**纯 Canvas 2D，零外部依赖**）/ `engine/shots.js`（自动铺满时长的占位时间线）/ `review/` / `audio/` / `frames/` / `deliver/`。

### `render.js` — 逐帧渲染

```bash
node render.js <scene.html> [--start=0] [--end=260] [--fps=24] [--out=frames]
                            [--prefix=f_] [--wait=300] [--quality=png|jpeg]
                            [--report=http://127.0.0.1:8765] [--report-every=30]
                            [--chrome=<路径>]
```

- 自动从页面 `<canvas>` 读取尺寸设置视口
- 只调 `__seek(t)`，不点鼠标、不读系统时间 → **同输入必同输出**
- 运行期捕获 `pageerror` 与非本地 `requestfailed`，有异常则退出码 1（红线 3 的运行时佐证）
- `--report` 可把进度实时推给控制台；控制台没开就静默跳过

### `compose.js` — 合成 + 混音

```bash
node compose.js [--frames=frames] [--pattern=f_%05d.png] [--fps=24] [--start=0]
                [--audio=bgm.mp3] [--out=video.mp4] [--crf=18] [--preset=slow]
                [--pix-fmt=yuv444p|yuv420p] [--audio-bitrate=192k]
```

- 硬像素建议 `yuv444p`（色度不抽样，边缘不糊）；要最大兼容改 `yuv420p`
- 已处理两个常见坑：ffmpeg 的 image2 读不了**含中文的绝对路径**（改为在帧目录内用相对模式）；部分发行版把 aac 标为 experimental（自动带 `-strict -2`）

### `verify.js` — 渲染前后自检

```bash
node verify.js [--scene=...] [--frames=...] [--video=...] [--expect-duration=90] [--fps=24] [--audio-required=true]
```

检查项对应《交接说明》6.1 / 6.4：

| 分组 | 检查 |
|---|---|
| 页面 | 非 0 字节；无外部网络地址；暴露 `__duration`/`__seek`/`__ready`；无 `Math.random()`/`Date.now()`/`new Date()` |
| 时间线 | `addShot` 无断档无重叠；时长合计等于预期；首镜从 0.0 起 |
| 帧序列 | 无 0 字节帧；编号连续无缺帧；帧数 = 时长×fps+1 |
| 成片 | 含视频流；含音频流（`--audio-required=true` 时强制）；时长误差 ≤ 0.5s |

退出码 0 = 全过，可交付；1 = 有失败项。

## 控制台

```bash
node server.js          # http://127.0.0.1:8765
```

## 架构

```
pipeline/
├─ server.js        # 零依赖 HTTP 服务（SSE + 状态机 + schema 兜底 + 日志环形缓冲）
├─ dashboard.html   # 像素风仪表盘（SSE 实时 + 日志过滤 + 断线重连）
├─ init.js          # 项目骨架生成
├─ render.js        # 逐帧渲染
├─ compose.js       # 合成 + 混音
├─ verify.js        # 自检
├─ state.json       # 唯一数据源（运行时生成，已 gitignore）
└─ config.json      # 子 Agent 模型白名单 + 默认模型
```

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/state` | 全量状态 |
| GET | `/api/stream` | SSE 实时流（`state`/`log`/`render` 事件）|
| GET/POST | `/api/config` | 模型配置读写（合并式，不抹白名单）|
| POST | `/api/log` | 追加日志 `{level, msg}` |
| POST | `/api/stage` | 更新阶段 `{stageId, status, detail, progress}` |
| POST | `/api/render` | 汇报渲染进度 `{doneFrames, totalFrames}` |
| GET | `/frames/xxx.png` | 渲染帧图片代理 |

## 五阶段流水线

```
① 确立方向 ──► ② 生产镜头 ──► ③ 独立审核 ──► ④ 汇总放行 ──► ⑤ 渲染交付
                  (子Agent)      (审核Agent)                  (主AI)
```

## 技术红线（一票否决）

1. 禁止裸 `Math.random()` → 固定种子伪随机
2. 禁止依赖 `Date.now()`/`new Date()` → 统一时间轴 `t`
3. 禁止网络请求/外部资源 → 全部内联
4. 禁止无限循环动画 → 动画总长 = 镜头时长
5. 禁止依赖用户交互 → 自动播放 + `__seek(t)`

## 审核标准（加权 ≥ 85 且无红线 = approved）

| 维度 | 权重 |
|---|---|
| 视觉一致性 | 30% |
| 内容准确性 | 25% |
| 技术可渲染 | 25% |
| 动效质量 | 15% |
| 性能体积 | 5% |

## 项目规范（Take Me Hand MV）

- **主角 Clawd**：陶土橙 `#D97757` + 深棕方眼 `#141413`，严格左右轴对称，无嘴无腮红无描边
- **两套色调**：梦/夜 = 紫罗兰夜景城市（`#3D3668`→`#775384` 渐变 + 三层剪影 + 弯月 + 灯串 + 星芒）；现实 = 暖阳田野（`#f6e3c0`→`#a8c8e8` + 麦浪 + 樱花 + 飞鸟）
- **节奏**：单镜 1.5–3.5s（副歌 ≤2.5s），对齐歌词句点切分

## 目录结构（一个动画项目）

```
project/
├─ brief.md           创作简报
├─ shots.csv          分镜表
├─ engine/            scene.html（时间线引擎）+ shots.js
├─ manifest.json      清单 + 状态机
├─ review/            审核报告 JSON
├─ frames/            逐帧中间产物
├─ audio/             音轨
└─ deliver/           成片 + 音频 + 源文件 + 说明
```

> 单文件时间线引擎（一条 `addShot` 链路）与「一镜一页」都支持；本项目《Take Me Hand》用的是前者。

## CI / 工作流

| 工作流 | 触发 | 说明 |
|---|---|---|
| `render-demo.yml` | 手动 / push | `init` → `render` → `compose` → `verify` 全链路冒烟（无音轨） |
| `pipeline-ci.yml` | push / PR | 四个工具语法检查 + 控制台启动 + 端点冒烟测试 |

> 完整 MV 渲染依赖本机 Chrome 与版权音乐，CI 只验证管线可运行性，不跑全片渲染。

## License

MIT
