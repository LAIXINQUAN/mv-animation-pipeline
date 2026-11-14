# MV 视频动画制作流水线

一套**主 AI 统筹 + 多子 Agent 并行生产 + 独立审核 + 逐帧渲染**的动画生产流水线，附带像素风实时控制台。

> 本项目是《Take Me Hand》MV 的实际落地实现，全片 260 秒、105 镜、1920×1080、24fps，纯代码（p5.js 硬像素风格）生成，无任何图像生成模型。

---

## 特性

- **五阶段流水线**：确立方向 → 生产镜头 → 独立审核 → 汇总放行 → 渲染交付
- **像素风实时控制台**：五阶段进度、当前任务、场景帧预览、渲染进度条、实时日志流
- **SSE 实时推送**：零轮询，日志/状态/渲染进度毫秒级刷新
- **子 Agent 模型可配置**：生产/审核 Agent 各自选模型，热保存
- **零依赖**：Node 原生 `http` 实现，无需 npm install

## 快速开始

```bash
cd pipeline
node server.js
# 打开 http://127.0.0.1:8765
```

## 架构

```
pipeline/
├─ server.js        # 零依赖 HTTP 服务（SSE + 状态机 + 日志环形缓冲）
├─ dashboard.html   # 像素风仪表盘（SSE 实时 + 日志过滤 + 断线重连）
├─ state.json       # 唯一数据源：五阶段/当前任务/渲染进度/日志
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
| POST | `/api/render` | 汇报渲染进度 `{doneFrames}` |
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

## 目录结构

```
project/
├─ brief.md           创作简报
├─ shots.csv          分镜表
├─ pages/             S001.html …（一镜一页）
├─ manifest.json      清单 + 状态机
├─ review/            审核报告 JSON
├─ render/frames/     逐帧中间产物
└─ deliver/           成片 + 音频 + 源文件
```

## License

MIT

## CI / 工作流

| 工作流 | 触发 | 说明 |
|---|---|---|
| `render-demo.yml` | 手动 / push 到 server.js·dashboard.html | 用 puppeteer 渲染一帧自包含 demo 场景，验证渲染链路 |
| `pipeline-ci.yml` | push / PR | 语法检查 + 服务启动 + 5 端点冒烟测试 |

> 完整 MV 渲染依赖本机 Chrome 与版权音乐，CI 只验证管线可运行性，不跑全片渲染。

## 文件清单

```
pipeline/
├─ server.js              零依赖 HTTP 服务（SSE + 状态机 + schema 兜底）
├─ dashboard.html         像素风仪表盘
├─ config.json            子 Agent 模型白名单 + 默认模型
├─ state.json.example     状态模板（运行时生成 state.json，已 gitignore）
├─ README.md              本文档
├─ LICENSE                MIT
├─ .gitignore
└─ .github/workflows/
   ├─ render-demo.yml     渲染链路验证
   └─ pipeline-ci.yml     服务冒烟测试
```
