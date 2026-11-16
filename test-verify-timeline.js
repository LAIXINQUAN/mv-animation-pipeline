#!/usr/bin/env node
/**
 * test-verify-timeline.js — verify.js 时间线检测的回归测试
 *
 * 四种写法必须给出正确结论：
 *   1. 全部字面量        → 通过
 *   2. 全部变量          → 失败（读不出起止时间）
 *   3. 部分变量（混合）  → 失败（并要求改成字面量）
 *   4. 有断档            → 失败
 *
 * 自包含：自己建临时项目，不依赖外部状态。CI 与本地都能直接跑。
 * 用法：node test-verify-timeline.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const REPO = __dirname;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-verify-test-'));
const PROJ = path.join(TMP, 'proj');
const SHOTS = path.join(PROJ, 'engine', 'shots.js');
const SCENE = path.join(PROJ, 'engine', 'scene.html');

// 建最小项目（直接复用 init.js，保证与真实产物同构）
const init = spawnSync('node', [path.join(REPO, 'init.js'), PROJ,
  '--name=Verify Timeline Test', '--duration=6', '--fps=24'],
  { encoding: 'utf8' });
if (init.status !== 0) {
  console.error('init.js 失败：' + (init.stderr || init.stdout));
  process.exit(1);
}

const CASES = [
  {
    name: '全部字面量',
    body: `addShot(0, 3, (t, lf) => shotExample(t, lf));
addShot(3, 6, (t, lf) => shotExample(t, lf));
`,
    expectDur: 6,
    wantCode: 0,
    wantText: '时间线无断档/无重叠',
    forbidText: 'FAIL',
  },
  {
    name: '全部变量',
    body: `const A = 0, B = 3, C = 6;
addShot(A, B, (t, lf) => shotExample(t, lf));
addShot(B, C, (t, lf) => shotExample(t, lf));
`,
    expectDur: 6,
    wantCode: 1,
    wantText: '能读出 addShot 的起止时间',
    forbidText: null,
  },
  {
    name: '部分变量（混合）',
    body: `addShot(0, 3, (t, lf) => shotExample(t, lf));
const D = 3;
addShot(3, 6, (t, lf) => shotExample(t, lf));
addShot(6, 6 + D, (t, lf) => shotExample(t, lf));
`,
    expectDur: 9,
    wantCode: 1,
    wantText: '全部 addShot 都用字面量数字',
    forbidText: null,
  },
  {
    name: '有断档',
    body: `addShot(0, 2, (t, lf) => shotExample(t, lf));
addShot(3, 6, (t, lf) => shotExample(t, lf));
`,
    expectDur: 6,
    wantCode: 1,
    wantText: '时间线无断档/无重叠  — #2 2->3',
    forbidText: null,
  },
  {
    // 注释里常写 addShot(...) 当文档，不能被当成"变量写法"而误报
    name: '注释中含 addShot',
    body: `/* 每个 addShot(s, e, fn) 是一个镜头。
   示例：addShot(0, 3.2, handler) */
// 也支持 addShot(start, end, fn) 这种写法
addShot(0, 3, (t, lf) => shotExample(t, lf));
addShot(3, 6, (t, lf) => shotExample(t, lf));
`,
    expectDur: 6,
    wantCode: 0,
    wantText: '时间线无断档/无重叠',
    forbidText: 'FAIL',
  },
  {
    // 注释掉的旧分镜行不应该参与统计
    name: '注释掉的旧分镜',
    body: `addShot(0, 3, (t, lf) => shotExample(t, lf));
// addShot(3, 6, (t, lf) => shotExample(t, lf));   // 暂时停用
addShot(3, 6, (t, lf) => shotExample(t, lf));
`,
    expectDur: 6,
    wantCode: 0,
    wantText: '时间线无断档/无重叠',
    forbidText: 'FAIL',
  },
];

let failed = 0;
for (const c of CASES) {
  fs.writeFileSync(SHOTS, c.body, 'utf8');
  const r = spawnSync('node', [
    path.join(REPO, 'verify.js'),
    `--scene=${SCENE}`,
    `--expect-duration=${c.expectDur}`,
    '--fps=24',
  ], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const codeOk = r.status === c.wantCode;
  const textOk = out.includes(c.wantText);
  const forbidOk = c.forbidText ? !out.includes(c.forbidText) : true;
  const ok = codeOk && textOk && forbidOk;
  if (!ok) failed++;

  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${c.name}: exit=${r.status}（期望 ${c.wantCode}）` +
    ` 关键行=${textOk}${c.forbidText ? ` 无"${c.forbidText}"=${forbidOk}` : ''}`);

  if (!ok) {
    for (const ln of out.split('\n')) {
      if (/时间线|字面量|镜头数|未通过|FAIL/.test(ln)) console.log('        ' + ln.trim());
    }
  }
}

// 清理
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
