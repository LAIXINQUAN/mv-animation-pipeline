#!/usr/bin/env node
/**
 * render.js — 生产级逐帧渲染器（把一条 __seek(t) 时间线渲染成 PNG 帧序列）
 *
 * 用法：
 *   node render.js <scene.html> [选项]
 *
 * 选项：
 *   --start=0            起始秒（含）
 *   --end=260            结束秒（不含）
 *   --fps=24             帧率
 *   --out=frames         输出目录
 *   --prefix=f_          文件名前缀（生成 f_00000.png …）
 *   --wait=300           首帧前等待毫秒（等字体/SVG 渲染完成）
 *   --quality=png        png | jpeg
 *   --report=http://127.0.0.1:8765   每 N 帧向流水线控制台汇报进度
 *   --report-every=30    汇报间隔（帧）
 *   --chrome=<path>      指定 Chrome/Chromium 可执行文件
 *   --concurrency=1      预留（当前单页顺序渲染，保证确定性）
 *
 * 约定（见 SKILL.md 技术红线）：
 *   页面必须暴露 window.__ready === true、window.__duration、window.__seek(t)。
 *   渲染器只调用 __seek(t)，不点鼠标、不读系统时间 —— 同输入必同输出。
 *
 * 依赖：puppeteer（自带 Chromium）或 puppeteer-core + 本机 Chrome。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

// ---------- 参数解析 ----------
const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith('--'));
const flags = {};
for (const a of argv) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) flags[m[1]] = m[2] === undefined ? 'true' : m[2];
}

if (!positional[0]) {
  console.error('用法: node render.js <scene.html> [--start=0] [--end=260] [--fps=24] [--out=frames]');
  process.exit(2);
}

const SCENE = path.resolve(positional[0]);
const START = parseFloat(flags.start || '0');
const END = parseFloat(flags.end || '10');
const FPS = parseFloat(flags.fps || '24');
const OUT = path.resolve(flags.out || 'frames');
const PREFIX = flags.prefix || 'f_';
const WAIT = parseInt(flags.wait || '300', 10);
const QUALITY = (flags.quality || 'png').toLowerCase();
const REPORT = flags.report || null;
const REPORT_EVERY = parseInt(flags['report-every'] || '30', 10);
const CONCURRENCY = parseInt(flags.concurrency || '1', 10);
if (flags.chrome) process.env.CHROME_PATH = flags.chrome;

if (!fs.existsSync(SCENE)) {
  console.error('找不到页面: ' + SCENE);
  process.exit(2);
}

// ---------- 依赖解析（不要求安装在本脚本目录）----------
const Module = require('module');

/**
 * 依次在「当前工作目录 → 脚本所在目录 → NODE_PATH」里找模块。
 * 使用者通常在自己项目目录下执行 `node <path>/render.js`，依赖装在项目里，
 * 直接 require() 会从脚本目录解析而报 Cannot find module。
 */
function requireFrom(name) {
  const bases = [process.cwd(), __dirname];
  for (const b of bases) {
    try {
      return Module.createRequire(path.join(b, 'noop.js'))(name);
    } catch (_) { /* 继续下一个 */ }
  }
  try { return require(name); } catch (_) { /* 交给下面报错 */ }
  const err = new Error(
    `缺少依赖 ${name}。请任选一种安装方式：\n` +
    `  cd ${process.cwd()} && npm i ${name}      # 装在当前项目\n` +
    `  cd ${__dirname} && npm i ${name}          # 装在工具目录\n` +
    `  npm i -g ${name}                          # 全局（需配 NODE_PATH）`
  );
  err.code = 'MODULE_MISSING';
  throw err;
}

// ---------- 解析浏览器 ----------
function resolveChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  try {
    // 优先用完整版 puppeteer 自带的 Chromium（无需系统安装）
    const puppeteer = requireFrom('puppeteer');
    const p = puppeteer.executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch (_) { /* 没装完整版，继续找系统 Chrome */ }

  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

// ---------- 汇报进度（可选，失败不影响渲染）----------
function report(doneFrames, totalFrames) {
  if (!REPORT) return;
  const body = JSON.stringify({ doneFrames, totalFrames });
  try {
    const u = new URL('/api/render', REPORT);
    const req = http.request(
      { hostname: u.hostname, port: u.port || 80, path: u.pathname, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => res.resume()
    );
    req.on('error', () => {});
    req.write(body);
    req.end();
  } catch (_) { /* 控制台没开就静默跳过 */ }
}

// ---------- 主流程 ----------
(async () => {
  const exe = resolveChrome();

  let launcher;
  if (exe) {
    // 用 puppeteer-core + 指定浏览器
    const pc = requireFrom('puppeteer-core');
    launcher = () => pc.launch({
      executablePath: exe,
      headless: 'new',
      args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars',
             '--force-device-scale-factor=1', '--font-render-hinting=none'],
    });
  } else {
    const p = requireFrom('puppeteer');
    launcher = () => p.launch({ headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  }

  fs.mkdirSync(OUT, { recursive: true });

  const browser = await launcher();
  const page = await browser.newPage();

  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('requestfailed', (r) => {
    // 只记录非 data:/file: 的失败请求（红线扫描的运行时佐证）
    const u = r.url();
    if (!/^(data:|file:|blob:|about:)/.test(u)) pageErrors.push('NETWORK ' + u);
  });

  const url = 'file:///' + SCENE.replace(/\\/g, '/');
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForFunction('window.__ready === true', { timeout: 20000 });

  const info = await page.evaluate(() => {
    // 画布尺寸优先取 <canvas>，其次取页面声明的 __size，最后退回视口
    const cv = document.querySelector('canvas');
    let w = null, h = null;
    if (cv && cv.width && cv.height) { w = cv.width; h = cv.height; }
    else if (Array.isArray(window.__size)) { w = window.__size[0]; h = window.__size[1]; }
    else { w = window.innerWidth; h = window.innerHeight; }
    return {
      duration: typeof window.__duration === 'number' ? window.__duration : null,
      seek: typeof window.__seek,
      w, h,
    };
  });

  if (info.duration === null) throw new Error('页面未暴露 window.__duration');
  if (info.seek !== 'function') throw new Error('页面未暴露 window.__seek(t)');

  const end = Math.min(END, info.duration);
  if (END > info.duration + 1e-6) {
    console.warn(`! --end=${END} 超出 __duration=${info.duration}，按 ${info.duration} 截断`);
  }

  // 视口对齐 __duration 所在画布尺寸
  const vp = { width: info.w, height: info.h, deviceScaleFactor: 1 };
  await page.setViewport(vp);

  const total = Math.round((end - START) * FPS);           // 帧间隔 1/fps
  const count = total + 1;                                  // 含首帧
  console.log(`[render] ${path.basename(SCENE)}  ${START}s..${end}s @ ${FPS}fps = ${count} 帧  →  ${OUT}`);

  const t0 = Date.now();
  const ext = QUALITY === 'jpeg' ? 'jpeg' : 'png';
  const suffix = ext === 'jpeg' ? '_placeholder' : '';
  let written = 0;

  for (let i = 0; i <= total; i++) {
    const t = START + i / FPS;
    await page.evaluate((tt) => window.__seek(tt), t);

    if (i === 0 && WAIT > 0) await new Promise((r) => setTimeout(r, WAIT));

    const name = PREFIX + String(i).padStart(5, '0') + '.' + (ext === 'jpeg' ? 'jpg' : 'png');
    await page.screenshot({
      path: path.join(OUT, name),
      type: ext,
      ...(ext === 'jpeg' ? { quality: 92 } : {}),
    });
    written++;

    if (i % REPORT_EVERY === 0) {
      process.stdout.write(`\r${i}/${total}`);
      report(i + 1, count);
    }
  }

  await browser.close();

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n[render] done: ${written} 帧，${secs}s（${(written / secs).toFixed(1)} 帧/秒）`);

  if (pageErrors.length) {
    console.error('[render] 运行期异常：');
    for (const e of pageErrors.slice(0, 10)) console.error('  - ' + e);
    process.exit(1);
  }
})().catch((e) => {
  console.error('[render] ERROR:', e.message);
  process.exit(1);
});
