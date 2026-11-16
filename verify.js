#!/usr/bin/env node
/**
 * verify.js — 渲染前后自检（对应《交接说明》6.1 渲染前检查清单 + 6.4 必检项）
 *
 * 用法：
 *   node verify.js --scene=engine/scene.html [--frames=frames] [--video=video.mp4]
 *                  [--shots=shots.csv] [--expect-duration=260] [--fps=24]
 *
 * 检查项：
 *   页面完整性 / 时长一致性 / 独立可播 / 无外部依赖 / 帧序列完整 / 成片参数
 * 退出码：0 = 全过；1 = 有失败项
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const flags = {};
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)=(.*)$/.exec(a);
  if (m) flags[m[1]] = m[2];
}

const SCENE = flags.scene ? path.resolve(flags.scene) : null;
const FRAMES = flags.frames ? path.resolve(flags.frames) : null;
const VIDEO = flags.video ? path.resolve(flags.video) : null;
const SHOTS = flags.shots ? path.resolve(flags.shots) : null;
const EXPECT = flags['expect-duration'] ? parseFloat(flags['expect-duration']) : null;
const FPS = parseFloat(flags.fps || '24');

let failed = 0;
const results = [];

function chk(ok, label, detail) {
  results.push({ ok, label, detail });
  if (!ok) failed++;
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${label}${detail ? '  — ' + detail : ''}`);
}

/**
 * 按大括号配对，删掉每个匹配 opening 正开头的那一段 `{ ... }`。
 * 用于剔除源码里的兜底循环、模板占位代码，避免它们的 addShot 被当成真实分镜。
 */
function stripBlock(src, openingRe) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    openingRe.lastIndex = 0;
    const rest = src.slice(i);
    const m = openingRe.exec(rest);
    if (!m) { out += rest; break; }
    const start = i + m.index;
    out += src.slice(i, start);
    // 从 opening 的 '{' 开始配对
    let p = start + m[0].length - 1;   // 指向 '{'
    let depth = 0;
    let q = p;
    for (; q < src.length; q++) {
      if (src[q] === '{') depth++;
      else if (src[q] === '}') { depth--; if (depth === 0) break; }
    }
    i = q + 1;                          // 跳过整段
  }
  return out;
}

// ---- 0. 收集页面引用的本地脚本 ----
// 页面通过 <script src="shots.js"> 引用的同目录脚本，算页面的一部分：
// 既要校验它真的存在（否则运行期直接空白），也要把它的代码并进红线与时间线扫描。
function collectLocalScripts(scenePath, code) {
  const dir = path.dirname(scenePath);
  const refs = [...code.matchAll(/<script[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)]
    .map((m) => m[1])
    .filter((u) => !/^(https?:)?\/\//i.test(u) && !/^data:/i.test(u));
  const found = [];
  const missing = [];
  for (const r of refs) {
    const p = path.resolve(dir, r.split('?')[0].split('#')[0]);
    if (fs.existsSync(p)) found.push({ ref: r, path: p, code: fs.readFileSync(p, 'utf8') });
    else missing.push(r);
  }
  return { found, missing };
}

let pageCode = '';
const pageScripts = [];

// ---- 1. 页面 ----
if (SCENE) {
  console.log('\n== 页面检查 ==');
  const exists = fs.existsSync(SCENE);
  chk(exists, '页面文件存在', SCENE);
  if (exists) {
    const size = fs.statSync(SCENE).size;
    chk(size > 0, '页面非 0 字节', `${(size / 1024).toFixed(1)} KB`);
    pageCode = fs.readFileSync(SCENE, 'utf8');

    // 引用的本地脚本必须真的存在
    const { found, missing } = collectLocalScripts(SCENE, pageCode);
    pageScripts.push(...found);
    chk(missing.length === 0, '引用的本地脚本存在',
      missing.length ? `缺失 ${missing.slice(0, 3).join(', ')}` : `${found.length} 个`);
    if (found.length) console.log(`  外部脚本: ${found.map((f) => f.ref).join(', ')}`);

    // 第三方库（p5 / three / 压缩过的 vendor）本身就带 URL 与 Math.random，
    // 扫它们只会得到假阳性。红线只管「自己写的代码」，所以先分流。
    const isVendor = (f) =>
      /(?:^|[\\/])(?:p5(?:\.min)?|three(?:\.module)?|vendor|lib|jquery|matter|lodash|underscore)[\w.-]*\.js$/i.test(f.ref) ||
      f.code.length > 400000;   // 体积异常大的一律当压缩库

    const mine = found.filter((f) => !isVendor(f));
    const vendor = found.filter(isVendor);
    if (vendor.length) {
      console.log(`  跳过第三方库（不做红线扫描）: ${vendor.map((f) => f.ref).join(', ')}`);
    }
    if (mine.length) console.log(`  自写脚本（做红线扫描）: ${mine.map((f) => f.ref).join(', ')}`);

    // 页面 + 自写外部脚本合并成一份代码做扫描
    const all = [pageCode, ...mine.map((f) => f.code)].join('\n');
    // 暴露接口这一类只看自写代码；但仍允许由页面本身体现
    const allForInterface = [pageCode, ...mine.map((f) => f.code)].join('\n');

    // 无外部网络依赖（排除注释里的说明性 URL）
    const stripped = all.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const net = (stripped.match(/https?:\/\/[^\s"'`)]+/g) || []).filter((u) => !u.includes('127.0.0.1') && !u.includes('localhost'));
    chk(net.length === 0, '无外部网络地址', net.length ? net.slice(0, 3).join(', ') : '');

    chk(/window\.__duration\s*=/.test(allForInterface), '暴露 window.__duration');
    chk(/window\.__seek\s*=/.test(allForInterface), '暴露 window.__seek');
    chk(/__ready\s*=\s*true/.test(allForInterface), '暴露 window.__ready');

    // 红线：随机数与时间依赖
    const rand = /Math\.random\s*\(/.test(stripped);
    chk(!rand, '无裸 Math.random()', rand ? '改用固定种子伪随机' : '');
    const time = /Date\.now\s*\(/.test(stripped) || /new\s+Date\s*\(/.test(stripped);
    chk(!time, '无 Date.now() / new Date()', time ? '改用统一时间轴 t' : '');
  }
}

// ---- 2. 分镜表 / 时间线 ----
if (SCENE && fs.existsSync(SCENE)) {
  console.log('\n== 时间线检查 ==');
  // 时间线可以内联在 scene.html，也可以写在它引用的 shots.js —— 两边都算。
  // 但要排除第三方库（p5 之类）里恰好出现的 addShot 字样。
  const mineScripts = pageScripts.filter((f) => {
    const isVendor =
      /(?:^|[\\/])(?:p5(?:\.min)?|three(?:\.module)?|vendor|lib|jquery|matter|lodash|underscore)[\w.-]*\.js$/i.test(f.ref) ||
      f.code.length > 400000;
    return !isVendor;
  });
  const code = [pageCode, ...mineScripts.map((f) => f.code)].join('\n');

  // 分三步把「不是分镜」的 addShot 全部排除，否则会误报"有变量写法"：
  //   1) 去掉注释 —— 注释里常写 addShot(s, e, fn) 当文档
  //   2) 去掉 addShot 自身定义 —— function addShot(s, e, fn) / const addShot = …
  //   3) 去掉 init 模板的兜底循环 if (!SHOTS.length) { for (…) addShot(s, …) }
  const noComment = code
    // 块注释（含 JSDoc / 多行说明）
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // 行注释：前面不是冒号（避免误伤 http://），一直吃到行尾
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  const noDef = noComment
    .replace(/function\s+addShot\s*\([^)]*\)/g, '')
    .replace(/(?:const|let|var)\s+addShot\s*=\s*(?:function\s*)?\([^)]*\)/g, '');

  const callCode = stripBlock(noDef, /if\s*\(\s*!\s*SHOTS\.length\s*\)\s*\{/g);

  // 字面量必须"完整"：数字后紧跟 , 或 )，否则 6+D 会被读成 6
  const NUM = '(-?\\d+(?:\\.\\d+)?)\\s*(?=[,)])';
  const calls = [...callCode.matchAll(
    new RegExp(`addShot\\(\\s*${NUM}\\s*,\\s*${NUM}`, 'g')
  )].map((m) => [+m[1], +m[2]]);
  // 有没有 addShot 调用（含非字面量参数）—— 用于区分「真的没写时间线」和「写了但读不出数字」
  const rawCalls = [...callCode.matchAll(/addShot\s*\(\s*([^,)]+)\s*,\s*([^,)]+)/g)];
  if (calls.length) {
    console.log(`  镜头数: ${calls.length}`);
    let prev = null; const gaps = [];
    for (let i = 0; i < calls.length; i++) {
      const [s, e] = calls[i];
      if (prev !== null && Math.abs(s - prev) > 1e-6) gaps.push(`#${i + 1} ${prev}->${s}`);
      if (e <= s) gaps.push(`#${i + 1} 时长<=0 (${s},${e})`);
      prev = e;
    }
    chk(gaps.length === 0, '时间线无断档/无重叠', gaps.slice(0, 3).join(' ; '));
    const sum = +calls.reduce((a, c) => a + (c[1] - c[0]), 0).toFixed(2);
    chk(Math.abs(sum - (EXPECT ?? sum)) < 0.51, '时长合计与预期一致',
      `合计 ${sum}s${EXPECT ? ` / 预期 ${EXPECT}s` : ''}`);
    chk(Math.abs(calls[0][0]) < 1e-6, '首镜从 0.0 起', String(calls[0][0]));
    // 部分镜头写成变量时，字面量统计会漏掉它们 —— 数量对不上就报出来，避免静默少算
    if (rawCalls.length !== calls.length) {
      chk(false, '全部 addShot 都用字面量数字',
        `共 ${rawCalls.length} 处调用，只有 ${calls.length} 处能读出数字；` +
        `其余写成变量/表达式，时长与断档统计不完整。请改成 addShot(0, 3.2, …)`);
    }
  } else if (rawCalls.length) {
    // 有 addShot 但一个数字都读不出来：这是真问题，不能跳过
    chk(false, '能读出 addShot 的起止时间',
      `检测到 ${rawCalls.length} 处 addShot 调用，但起止时间是变量/表达式。` +
      `时间线校验依赖字面量数字，请写成 addShot(0, 3.2, …)`);
  } else {
    // 连 addShot 都没有：可能是一镜一页结构，静态检查无从下手 → 明确提示跳过
    console.log('  （未检测到 addShot 时间线，跳过；若本项目是一镜一页结构，此项不适用）');
  }
}

// ---- 3. 帧序列 ----
if (FRAMES) {
  console.log('\n== 帧序列检查 ==');
  const files = fs.existsSync(FRAMES) ? fs.readdirSync(FRAMES).filter((f) => /\.(png|jpg)$/i.test(f)) : [];
  chk(files.length > 0, '帧目录有内容', `${files.length} 张`);
  if (files.length) {
    const zero = files.filter((f) => fs.statSync(path.join(FRAMES, f)).size === 0);
    chk(zero.length === 0, '无 0 字节帧', `${zero.length} 张`);

    const nums = files
      .map((f) => { const m = /(\d+)\.(png|jpg)$/i.exec(f); return m ? +m[1] : null; })
      .filter((n) => n !== null)
      .sort((a, b) => a - b);
    if (nums.length) {
      const missing = [];
      for (let n = nums[0]; n <= nums[nums.length - 1]; n++) if (!nums.includes(n)) missing.push(n);
      chk(missing.length === 0, `编号 ${nums[0]}..${nums[nums.length - 1]} 连续无缺帧`, `缺 ${missing.length} 帧`);
      if (EXPECT) {
        const expectFrames = Math.round(EXPECT * FPS) + 1;
        chk(nums.length === expectFrames, `帧数 == ${expectFrames}`, `实际 ${nums.length}`);
      }
    }
  }
}

// ---- 4. 成片 ----
if (VIDEO && fs.existsSync(VIDEO)) {
  console.log('\n== 成片检查 ==');
  try {
    const out = execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration,size',
      '-show_entries', 'stream=codec_name,width,height,r_frame_rate',
      '-of', 'json', VIDEO,
    ], { encoding: 'utf8' });
    const j = JSON.parse(out);
    const v = (j.streams || []).find((s) => s.width);
    const a = (j.streams || []).find((s) => s.codec_name === 'aac' || s.codec_name === 'mp3');
    const dur = parseFloat(j.format.duration);
    console.log(`  ${v.width}x${v.height} ${v.codec_name} ${v.r_frame_rate} | 音频 ${a ? a.codec_name : '无'} | ${dur.toFixed(2)}s | ${(j.format.size / 1048576).toFixed(2)} MB`);
    chk(!!v, '含视频流');
    if (flags['audio-required'] === 'true') {
      chk(!!a, '含音频流');
    } else if (!a) {
      console.log('  [INFO] 无音频流（未加 --audio-required=true，不计失败）');
    } else {
      chk(true, '含音频流');
    }
    if (EXPECT) chk(Math.abs(dur - EXPECT) <= 0.5, `时长误差 ≤ 0.5s`, `${dur.toFixed(2)}s vs ${EXPECT}s`);
  } catch (e) {
    chk(false, 'ffprobe 可读取成片', e.message.split('\n')[0]);
  }
}

console.log('\n' + '='.repeat(56));
if (!results.length) {
  console.error('没有任何检查项被执行（至少给 --scene=<scene.html>）');
  process.exit(2);
}
console.log(failed === 0 ? '全部通过，可以交付' : `存在 ${failed} 项未通过，先修复`);
console.log('='.repeat(56));
process.exit(failed === 0 ? 0 : 1);
