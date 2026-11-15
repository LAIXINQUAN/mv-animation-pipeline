#!/usr/bin/env node
/**
 * init.js — 一键初始化一个动画项目骨架（对应《交接说明》3.6 目录结构）
 *
 * 用法：
 *   node init.js <目标目录> [--name="项目名"] [--duration=90] [--fps=30] [--w=1920] [--h=1080]
 *
 * 产出：
 *   <目标>/
 *   ├─ brief.md            创作简报（六项决策占位）
 *   ├─ shots.csv           分镜表（表头 + 示例行）
 *   ├─ manifest.json       清单骨架
 *   ├─ engine/
 *   │  ├─ scene.html       可运行的最小时间线模板（零外部依赖，跑通即能渲染）
 *   │  └─ shots.js         时间线源清单（scene.html 用 <script src> 加载它）
 *   ├─ review/             审核报告目录
 *   ├─ audio/              音轨目录
 *   ├─ frames/             帧输出
 *   └─ deliver/            交付包
 */
'use strict';

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const flags = {};
for (const a of args) {
  const m = /^--([^=]+)=(.*)$/.exec(a);
  if (m) flags[m[1]] = m[2];
}

if (!positional[0]) {
  console.error('用法: node init.js <目标目录> [--name="项目名"] [--duration=90] [--fps=30]');
  process.exit(2);
}

const ROOT = path.resolve(positional[0]);
const NAME = flags.name || path.basename(ROOT);
const DURATION = parseFloat(flags.duration || '90');
const FPS = parseFloat(flags.fps || '30');
const W = parseInt(flags.w || '1920', 10);
const H = parseInt(flags.h || '1080', 10);

for (const d of ['engine', 'review', 'audio', 'frames', 'deliver']) {
  fs.mkdirSync(path.join(ROOT, d), { recursive: true });
}

const w = (rel, content) => {
  const p = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
  console.log('  + ' + rel);
};

console.log(`[init] ${ROOT}`);

// ---- brief.md ----
w('brief.md', `# 创作简报 · ${NAME}

> 本文件是整条流水线的唯一契约。以下字段一经确认，**不得口头变更**；要改就走阶段①变更流程。

| 项目 | 内容 |
|---|---|
| 项目名称 | ${NAME} |
| 总时长 | ${DURATION} 秒 |
| 画幅 | ${W} × ${H} |
| 帧率 | ${FPS} fps |
| 镜头总数 | （填：分镜表行数） |
| 主色 | #______ |
| 辅色 | #______ |
| 强调色 | #______ |
| 字体族 | ______ |
| 叙事主线 | （一句话） |
| 情绪关键词 | （3 个以内） |

## 禁用元素

- （写清楚不要什么，例：不使用图像生成模型 / 不用深色背景配霓虹光 / 不堆文字）

## 视觉与动效规范

- 入场方式：
- 缓动曲线：
- 单镜头时长上限：
- 循环节奏：

## 输出规格

- 分辨率：${W} × ${H}
- 帧率：${FPS} fps
- 编码：H.264 / yuv444p（硬像素锐利）或 yuv420p（最大兼容）
- 质量控制：CRF 18–20
- 音频：AAC 192 kbps
`);

// ---- shots.csv ----
w('shots.csv', `shot_id,duration,start,visual,animation,transition,note
S001,3.0,0.0,示例：斜月挂右上，两只方块小生物立于楼顶,月亮淡入 0.6s，灯泡呼吸循环,淡出 0.4s,与 S002 构图呼应
`);

// ---- manifest.json ----
w('manifest.json', JSON.stringify({
  project: NAME,
  version: 'v0.1',
  fps: FPS,
  resolution: { w: W, h: H },
  total_duration: DURATION,
  shot_count: 1,
  shots: [{ shot_id: 'S001', file: 'engine/scene.html', start: 0, duration: 3.0, status: 'pending' }],
}, null, 2) + '\n');

// ---- engine/shots.js ----
// 默认时间线铺满整段时长（每镜 3s，最后一镜收尾），保证 verify 的时长校验通过
const SHOT_LEN = 3.0;
const shotLines = [];
let acc = 0;
let idx = 1;
while (acc < DURATION - 1e-6) {
  const e = Math.min(acc + SHOT_LEN, DURATION);
  shotLines.push(`addShot(${+acc.toFixed(2)}, ${+e.toFixed(2)}, (t, lf) => shotExample(t, lf));  // S${String(idx).padStart(3, '0')}`);
  acc = e;
  idx++;
}

w('engine/shots.js', `/* 时间线源清单 —— 每个 addShot(s, e, fn) 是一个镜头。
   铁律：0 → ${DURATION}s 连续，无断档、无重叠；单镜 ≤ 3.5s（副歌可更短）。
   下列为 init 生成的占位时间线（每镜 ${SHOT_LEN}s），按分镜表替换即可。 */
${shotLines.join('\n')}
`);

// ---- engine/scene.html（纯原生 Canvas 2D，零外部依赖）----
w('engine/scene.html', `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${NAME} · 时间线引擎</title>
<style>
  html,body{margin:0;padding:0;overflow:hidden;background:#101018}
  canvas{display:block}
</style>
</head>
<body>
<canvas id="cv" width="${W}" height="${H}"></canvas>
<script>
/* ============================================================
   时间线引擎模板 · ${NAME}
   ${W}×${H} @ ${FPS}fps · 总长 ${DURATION}s · 纯 Canvas 2D（无 p5、无网络）

   技术红线（违一条即不可渲染）：
     1. 不用裸 Math.random()       → 用 seedRand（固定种子）
     2. 不依赖 Date.now()/new Date → 一切由时间轴 t 驱动
     3. 不发网络请求               → 资源全部内联
     4. 不做无限循环动画           → 动画总长 = 镜头时长
     5. 不依赖用户交互             → 暴露 __duration / __seek(t)
   ============================================================ */

const DUR = ${DURATION};
const FPS = ${FPS};
const W = ${W}, H = ${H};

const cv = document.getElementById('cv');
const ctx = cv.getContext('2d', { alpha: false });
ctx.imageSmoothingEnabled = false;

// ---- 固定种子伪随机（替代 Math.random）----
let _seed = 20260101;
function seedRand() {
  _seed = (_seed * 1664525 + 1013904223) % 4294967296;
  return _seed / 4294967296;
}
function seedReset() { _seed = 20260101; }

// ---- 绘制小工具（像素对齐）----
const R = Math.round;
function bg(c) { ctx.fillStyle = c; ctx.fillRect(0, 0, W, H); }
function rect(x, y, w, h) { ctx.fillRect(R(x), R(y), R(w), R(h)); }
function fill(c) { ctx.fillStyle = c; }

// ---- 镜头注册表 ----
const SHOTS = [];
function addShot(s, e, fn) { SHOTS.push({ s, e, fn }); }

// ---- 示例镜头：紫罗兰夜空 + 方块小生物 ----
function shotExample(t, lf) {
  bg('#3D3668');

  // 星空（固定种子 → 每次渲染完全一致）
  seedReset();
  fill('#FFEBC5');
  for (let i = 0; i < 60; i++) {
    rect(seedRand() * W, seedRand() * H * 0.6, 3, 3);
  }

  // 山坡剪影
  fill('#5A4782');
  rect(0, H * 0.62, W, H * 0.38);

  // 方块小生物（对称：躯干 + 双黑眼 + 左右钳 + 四腿）
  const bx = R(W / 2), by = R(H * 0.66);
  const bw = 108, bh = 56;
  fill('#D97757');
  rect(bx - bw / 2, by - bh / 2, bw, bh);              // 躯干
  rect(bx - bw / 2 - 28, by + 4, 28, 16);              // 左钳
  rect(bx + bw / 2, by + 4, 28, 16);                   // 右钳
  for (const dx of [-32, -12, 12, 32]) rect(bx + dx - 5, by + bh / 2, 10, 32);  // 四腿
  fill('#141413');
  rect(bx - 30, by - 14, 20, 20);                      // 左眼
  rect(bx + 10, by - 14, 20, 20);                      // 右眼
}

// ---- 主绘制：给定 t，画出该时刻的画面（纯函数，无副作用）----
function drawScene(t) {
  const lf = t * FPS;
  for (const sh of SHOTS) {
    if (t >= sh.s - 1e-9 && t < sh.e) { sh.fn(t, lf); return; }
  }
  if (SHOTS.length) SHOTS[SHOTS.length - 1].fn(t, lf);  // 末尾兜底
}

// ---- 渲染器接口（约定，不可改名）----
window.__duration = DUR;
window.__seek = drawScene;
</script>

<!-- 时间线写在外部 shots.js：改分镜只动它，不必碰引擎；
     删掉这一行也能跑（下面有内置占位时间线兜底） -->
<script src="shots.js"></script>

<script>
// ---- 兜底：shots.js 缺失或为空时，自动铺满整段时长（每镜 3s）----
if (!SHOTS.length) {
  for (let s = 0; s < DUR - 1e-6; s += 3.0) {
    addShot(s, Math.min(s + 3.0, DUR), (t, lf) => shotExample(t, lf));
  }
}

// ---- 就绪：先画首帧，再置 ready（避免截图截到空白）----
drawScene(0);
window.__ready = true;
</script>
</body>
</html>
`);

// ---- 目录说明 ----
w('review/README.md', `# 审核报告目录

每个镜头一份 \`<shot_id>.review.json\`，格式见《视频动画制作交接说明》4.5 节。

通过规则：加权得分 **≥ 85** 且**无任何红线违反** → \`approved\`。
问题等级：\`blocker\` / \`major\` / \`minor\`。

复审上限：第 1 次打回→修改；第 2 次打回→换 Agent 重做；第 3 次打回→升级主 AI 简化/拆分。
`);

w('deliver/README.md', `# 交付目录

成片 \`video.mp4\`、音频、封面、字幕、源文件、渲染记录均落在这里。
模板见《视频动画制作交接说明》6.6 节。
`);

console.log(`
下一步：
  1. 填 brief.md 的六项决策，写 shots.csv 分镜表
  2. 改 engine/shots.js 的时间线（scene.html 用 <script src> 自动加载它，不必碰引擎）
  3. node render.js engine/scene.html --end=${DURATION} --fps=${FPS} --out=frames
  4. node compose.js --frames=frames --fps=${FPS} --audio=audio/bgm.mp3 --out=deliver/video.mp4
  5. node verify.js --scene=engine/scene.html --frames=frames --video=deliver/video.mp4 --expect-duration=${DURATION}
`);
