# SKILL · 视频动画制作多 Agent 流水线

> 一套「主 AI 统筹 + 多子 Agent 并行生产 + 独立审核 + 逐帧渲染」的动画生产流水线，附带像素风实时控制台。
> 本文件即 SKILL 入口：让任何 AI 读取本文件即可掌握整条流水线的调度方法。

---

## 一、这条流水线解决什么

把一个长动画（MV、短片、宣传片）拆成可并行的镜头生产单元，用「生产 Agent + 审核 Agent」分离的方式保证质量，最后逐帧渲染成片。核心价值：

- **并行生产**：一个子 Agent 一次只做一个镜头，多 Agent 并行，互不阻塞
- **独立审核**：审核 Agent 不参与生产、不共享上下文，五维打分把关
- **确定性渲染**：禁止随机数/时间依赖/网络请求，同一镜头任何机器渲染结果一致
- **实时控制台**：像素风 UI 显示五阶段进度、当前任务、渲染进度、实时日志

## 二、五阶段流水线

```
① 主 AI 确立方向 ──► ② 子 Agent 生产镜头 ──► ③ 审核 Agent 把关 ──► ④ 全绿汇总 ──► ⑤ 主 AI 渲染交付
   产出：简报+分镜表        产出：镜头单元+manifest     产出：审核报告        绿灯信号        成片+音频+源文件
                                     ▲                                    │
                                     └────────── 打回返工 ◄───────────────┘
```

## 三、角色与职责

| 角色 | 职责 | 硬约束 |
|---|---|---|
| 主 AI（总导演） | 定方向、拆镜头、定规范、调度、渲染、交付 | 只决策调度，不逐镜写页面 |
| 子 Agent（生产） | 按任务单生产单个镜头单元，自检后提交 | 一次只做 1 镜，累计调用 ≤ 500 |
| 审核 Agent（质检） | 五维打分审核，输出报告 | 独立于生产链，不共享生产上下文 |
| 用户（甲方） | 确认方向、验收成片 | 仅在 ①⑤ 介入 |

## 四、技术红线（一票否决）

1. 禁止裸 `Math.random()` → 用固定种子伪随机或写死数值
2. 禁止依赖 `Date.now()` / `new Date()` → 统一时间轴 `t` 驱动
3. 禁止网络请求 / 外部资源 → 全部内联（SVG / base64）
4. 禁止无限循环动画 → 动画总长 = 镜头时长
5. 禁止依赖用户交互 → 自动播放，暴露 `window.__duration` 与 `window.__seek(t)`

## 五、审核标准（加权 ≥ 85 且无红线 = approved）

| 维度 | 权重 | 要点 |
|---|---|---|
| 视觉一致性 | 30% | 色值/字体/描边是否符合规范 |
| 内容准确性 | 25% | 分镜画面描述全实现，无缺漏 |
| 技术可渲染 | 25% | 5 条红线 + 暴露 `__duration` |
| 动效质量 | 15% | 动画总长=镜头时长，无跳帧闪烁 |
| 性能体积 | 5% | 单页 ≤ 300KB |

问题等级：`blocker`（不可渲染）/ `major`（必修）/ `minor`（建议修）。

## 六、状态机

```
pending → submitted → approved → render_ready → delivered
                  └─► rejected ─► submitted（返工）
```

## 七、目录结构

```
project/
├─ brief.md           创作简报
├─ shots.csv          分镜表（shot_id, 时长, 画面, 动画, 转场）
├─ pages/             S001.html …（一镜一页，单文件内联）
├─ manifest.json      清单 + 状态机
├─ review/            审核报告 JSON
├─ render/frames/     逐帧中间产物
└─ deliver/           成片 + 音频 + 源文件 + 说明
```

## 八、流水线控制台（pipeline/ 目录，本 SKILL 的可运行实现）

### 8.1 启动

```bash
cd pipeline
node server.js          # http://127.0.0.1:8765
```

浏览器打开 `http://127.0.0.1:8765/dashboard.html`。

> 零依赖：Node 原生 `http`，无需 `npm install`。首次运行若缺 `state.json`，服务会自动按 schema 兜底重建。

### 8.2 架构

```
pipeline/
├─ server.js        # 零依赖 HTTP 服务（SSE + 状态机 + schema 兜底 + 日志环形缓冲）
├─ dashboard.html   # 像素风仪表盘（SSE 实时 + 日志过滤 + 断线重连）
├─ config.json      # 子 Agent 模型白名单 + 默认模型
└─ state.json.example  # 状态模板（运行时生成 state.json，已 gitignore）
```

### 8.3 UI 功能清单

| 区块 | 内容 |
|---|---|
| 五阶段流水线 | 确立方向→生产→审核→汇总→渲染，图标+状态色（done绿/running金闪/paused黄/pending灰）+ 进度条 |
| 现在正在干什么 | 当前 agent/角色/任务/场景描述 + 实时场景帧截图 |
| 渲染进度 | doneFrames/totalFrames 像素条纹进度条 + 百分比 |
| 实时日志 | 环形缓冲滚动日志流（info/ok/warn/err 四级着色 + 过滤）|
| 子 Agent 模型 | 生产/审核 Agent 各自下拉选模型，保存写 config.json |
| Agent 团队 | lead/producer/reviewer 状态点 + 当前模型 |

### 8.4 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/state` | 全量状态 |
| GET | `/api/stream` | SSE 实时流（`state`/`log`/`render` 事件）|
| GET/POST | `/api/config` | 模型配置读写（合并式，不抹白名单）|
| POST | `/api/log` | 追加日志 `{level, msg}` |
| POST | `/api/stage` | 更新阶段 `{stageId, status, detail, progress}` |
| POST | `/api/render` | 汇报渲染进度 `{doneFrames}` |
| GET | `/frames/xxx.png` | 渲染帧图片代理 |

### 8.5 子 Agent / 脚本接入约定

任何 agent 或渲染脚本汇报进度，直接 POST 日志 + 汇报进度：

```bash
# 写日志
curl -X POST http://127.0.0.1:8765/api/log -H 'Content-Type: application/json' \
  -d '{"level":"ok","msg":"S035 审核通过"}'

# 更新阶段
curl -X POST http://127.0.0.1:8765/api/stage -H 'Content-Type: application/json' \
  -d '{"stageId":"review","status":"done","detail":"approved 93分","progress":100}'

# 汇报渲染进度
curl -X POST http://127.0.0.1:8765/api/render -H 'Content-Type: application/json' \
  -d '{"doneFrames":3120}'
```

### 8.6 模型切换生效方式

UI 保存后写入 `config.json.defaultModel`。主 AI 下次 spawn/派单时读取该值，传给子 Agent 作为模型选择依据；已在跑的 agent 不受影响（下一次派单生效）。

## 九、参考落地案例（Take Me Hand MV）

本 SKILL 的实际落地：《Take Me Hand》MV —— 260 秒、105 镜、1920×1080、24fps，纯代码（p5.js 硬像素风格）生成，无任何图像生成模型。

| 项 | 值 |
|---|---|
| 主角 Clawd | 陶土橙 `#D97757` + 深棕方眼 `#141413`，严格左右轴对称，无嘴无腮红无描边 |
| 梦/夜色调 | 紫罗兰夜景城市 `#3D3668`→`#775384` + 三层剪影 + 弯月 + 灯串 + 星芒 |
| 现实色调 | 暖阳田野 `#f6e3c0`→`#a8c8e8` + 麦浪 + 樱花 + 飞鸟 |
| 节奏 | 单镜 1.5–3.5s（副歌 ≤2.5s），对齐歌词句点切分 |
| 审核流程 | 生产 100 镜 → round1 84 分打回 → 修复 → round2 93 分通过 |

## 十、给 AI 的调用指引

当用户提出「做一段动画 / MV / 短片」时，按以下步骤调度：

1. **阶段①**：确认主题、时长、画幅、风格，产出 `brief.md` + `shots.csv`
2. **阶段②**：按镜头数 spawn 生产 Agent（一镜一单），下发任务单
3. **阶段③**：独立 spawn 审核 Agent，传「任务单 + 页面代码 + 自检记录」
4. **阶段④**：全绿才放行，否则按问题清单打回返工（同镜 3 轮不过则简化/拆分）
5. **阶段⑤**：逐帧渲染 → ffmpeg 合成 → 混音 → 质检 → 交付

> 渲染管线参考：puppeteer（或 Chrome headless）逐帧截图 + ffmpeg 合成 H.264/yuv444p + AAC 192k。
