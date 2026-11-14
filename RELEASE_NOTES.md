# v1.0.0 · MV 视频动画制作流水线

首个正式版本。一套「主 AI 统筹 + 多子 Agent 并行生产 + 独立审核 + 逐帧渲染」的动画生产流水线，附带像素风实时控制台。

## 核心能力

- **五阶段流水线**：确立方向 → 生产镜头 → 独立审核 → 汇总放行 → 渲染交付
- **像素风实时控制台**：SSE 毫秒级推送，五阶段进度 + 当前任务 + 场景帧预览 + 渲染进度条 + 实时日志流
- **子 Agent 模型可配置**：生产/审核 Agent 各自选模型，热保存
- **零依赖**：Node 原生 http 实现，无需 npm install
- **schema 兜底**：state.json 被破坏也不会崩溃，自动补全默认结构

## 给 AI 使用

直接读仓库根目录的 **`SKILL.md`**，即可掌握整条流水线的调度方法。

## 快速开始

```bash
cd pipeline
node server.js          # http://127.0.0.1:8765
```

## 已验证的 CI

| 工作流 | 结果 |
|---|---|
| Render Demo Frame | ✅ 渲染链路验证 |
| Pipeline CI | ✅ 服务 5 端点冒烟测试 |

## 文件清单

- `SKILL.md` — AI 导入入口（调度指引）
- `server.js` — 零依赖 HTTP 服务（SSE + 状态机 + schema 兜底）
- `dashboard.html` — 像素风仪表盘
- `config.json` — 子 Agent 模型配置
- `state.json.example` — 状态模板
- `README.md` / `LICENSE`（MIT）
- `.github/workflows/` — 两个 CI 工作流

## 落地案例

《Take Me Hand》MV：260 秒、105 镜、1920×1080、24fps，纯代码（p5.js 硬像素）生成，无图像生成模型。审核流程：生产 100 镜 → round1 84 分打回 → 修复 → round2 93 分通过。
