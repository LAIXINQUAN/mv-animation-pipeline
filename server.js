// server.js — 视频动画流水线控制台（零依赖 Node 服务）
// v2：SSE 实时推送 + 状态机 + 日志环形缓冲 + 进度汇报端点
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const STATE = path.join(ROOT, 'state.json');
const CONFIG = path.join(ROOT, 'config.json');
const DASH = path.join(ROOT, 'dashboard.html');
const PORT = parseInt(process.env.PORT || '8765', 10);

// 帧代理目录：--frames=<dir> > 环境变量 FRAMES_DIR > 技能目录的上一级/frames
const FLAGS = {};
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)=(.*)$/.exec(a);
  if (m) FLAGS[m[1]] = m[2];
}
const FRAMES_DIR = path.resolve(FLAGS.frames || process.env.FRAMES_DIR || path.join(path.dirname(ROOT), 'frames'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

// ---- 读写工具 ----
function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { return null; }
}
function writeJSON(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
}
function nowStamp() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

// ---- 状态读取（带内存缓存 + schema 兜底）----
let stateCache = null;
let stateCacheTime = 0;

// 默认 schema：缺字段自动补全，防止 state.json 被外部破坏后服务崩溃
const DEFAULT_STATE = {
  project: '（未命名项目）',
  pipeline: {
    stages: [
      { id: 'direction', name: '确立方向', icon: '★', status: 'pending', detail: '', progress: 0 },
      { id: 'produce', name: '生产镜头', icon: '▣', status: 'pending', detail: '', progress: 0 },
      { id: 'review', name: '独立审核', icon: '◆', status: 'pending', detail: '', progress: 0 },
      { id: 'assemble', name: '汇总放行', icon: '▲', status: 'pending', detail: '', progress: 0 },
      { id: 'render', name: '渲染交付', icon: '●', status: 'pending', detail: '', progress: 0 },
    ],
  },
  current: { agent: '—', role: '—', task: '—', scene: '—', sceneFrame: null, frameTime: null },
  model: { producer: 'deepseek-v4-pro', reviewer: 'deepseek-v4-pro' },
  render: { fps: 24, totalFrames: 6240, doneFrames: 0, startedAt: null, lastFrame: null },
  log: [],
};

function ensureSchema(s) {
  if (!s || typeof s !== 'object') s = JSON.parse(JSON.stringify(DEFAULT_STATE));
  if (!s.project) s.project = DEFAULT_STATE.project;
  if (!s.pipeline || !Array.isArray(s.pipeline.stages)) s.pipeline = JSON.parse(JSON.stringify(DEFAULT_STATE.pipeline));
  if (!s.current) s.current = JSON.parse(JSON.stringify(DEFAULT_STATE.current));
  if (!s.model) s.model = JSON.parse(JSON.stringify(DEFAULT_STATE.model));
  if (!s.render) s.render = JSON.parse(JSON.stringify(DEFAULT_STATE.render));
  if (!Array.isArray(s.log)) s.log = [];
  return s;
}

function getState() {
  const now = Date.now();
  if (stateCache && now - stateCacheTime < 200) return stateCache; // 200ms 缓存
  stateCache = ensureSchema(readJSON(STATE));
  stateCacheTime = now;
  return stateCache;
}
function invalidate() { stateCache = null; }

// ---- SSE 客户端管理 ----
const sseClients = new Set();
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch (e) { sseClients.delete(res); }
  }
}

// ---- 日志追加（环形缓冲，广播 SSE）----
function appendLog(level, msg) {
  const s = ensureSchema(readJSON(STATE));
  s.log.push({ t: nowStamp(), level, msg });
  if (s.log.length > 300) s.log = s.log.slice(-300);
  s.updatedAt = new Date().toISOString();
  writeJSON(STATE, s);
  invalidate();
  const entry = s.log[s.log.length - 1];
  broadcast('log', entry);
  broadcast('state', s);
  return { ok: true, entry };
}

// ---- 阶段状态机 ----
const STAGE_FLOW = ['direction', 'produce', 'review', 'assemble', 'render'];
function setStage(stageId, status, detail, progress) {
  const s = ensureSchema(readJSON(STATE));
  const st = s.pipeline.stages.find(x => x.id === stageId);
  if (!st) return { ok: false, error: `unknown stage ${stageId}` };
  st.status = status;
  if (detail !== undefined) st.detail = detail;
  if (progress !== undefined) st.progress = progress;
  s.updatedAt = new Date().toISOString();
  writeJSON(STATE, s);
  invalidate();
  broadcast('state', s);
  return { ok: true, stage: st };
}

// ---- 项目名 / 当前任务 ----
function setProject(project) {
  const s = ensureSchema(readJSON(STATE));
  const name = String(project || '').trim();
  if (!name) return { ok: false, error: 'project 不能为空' };
  s.project = name;
  s.updatedAt = new Date().toISOString();
  writeJSON(STATE, s);
  invalidate();
  broadcast('state', s);
  return { ok: true, project: s.project };
}

function setCurrent(patch) {
  const s = ensureSchema(readJSON(STATE));
  const KEYS = ['agent', 'role', 'task', 'scene', 'sceneFrame', 'frameTime'];
  let touched = 0;
  for (const k of KEYS) {
    if (patch && patch[k] !== undefined) { s.current[k] = patch[k]; touched++; }
  }
  if (!touched) return { ok: false, error: `可用字段: ${KEYS.join(', ')}` };
  s.updatedAt = new Date().toISOString();
  writeJSON(STATE, s);
  invalidate();
  broadcast('state', s);
  return { ok: true, current: s.current };
}

// ---- 渲染进度更新（高频，走轻量写盘 + SSE）----
function reportProgress(doneFrames) {
  const s = ensureSchema(readJSON(STATE));
  s.render.doneFrames = doneFrames;
  s.render.lastFrame = doneFrames > 0 ? `f_${String(doneFrames).padStart(5, '0')}.png` : null;
  s.updatedAt = new Date().toISOString();
  writeJSON(STATE, s);
  invalidate();
  broadcast('render', s.render);
  return { ok: true, doneFrames };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  // ---- SSE 流 ----
  if (p === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write(`event: hello\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  // ---- 状态 ----
  if (p === '/api/state') {
    const s = getState();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(s));
  }

  // ---- 配置（读写，合并式）----
  if (p === '/api/config') {
    if (req.method === 'GET') {
      const c = readJSON(CONFIG) || {};
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(c));
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', d => body += d);
      req.on('end', () => {
        try {
          const incoming = JSON.parse(body);
          const cur = readJSON(CONFIG) || {};
          const merged = Object.assign({}, cur, incoming);
          if (incoming.defaultModel) {
            merged.defaultModel = Object.assign({}, cur.defaultModel, incoming.defaultModel);
          }
          writeJSON(CONFIG, merged);
          const s = ensureSchema(readJSON(STATE));
          s.model = merged.defaultModel || s.model;
          writeJSON(STATE, s);
          invalidate();
          broadcast('state', s);
          appendLog('info', `模型配置更新: producer=${merged.defaultModel.producer} reviewer=${merged.defaultModel.reviewer}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, model: merged.defaultModel }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: String(e) }));
        }
      });
      return;
    }
  }

  // ---- 项目名 ----
  if (p === '/api/project' && req.method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const { project } = JSON.parse(body);
        const r = setProject(project);
        if (r.ok) appendLog('info', `项目名 → ${r.project}`);
        res.writeHead(r.ok ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e) }));
      }
    });
    return;
  }

  // ---- 当前任务（agent/role/task/scene/sceneFrame/frameTime）----
  if (p === '/api/current' && req.method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const r = setCurrent(JSON.parse(body));
        res.writeHead(r.ok ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e) }));
      }
    });
    return;
  }

  // ---- 日志 ----
  if (p === '/api/log') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', d => body += d);
      req.on('end', () => {
        try {
          const { level, msg } = JSON.parse(body);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(appendLog(level || 'info', msg || '')));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: String(e) }));
        }
      });
      return;
    }
  }

  // ---- 阶段状态更新 ----
  if (p === '/api/stage' && req.method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const { stageId, status, detail, progress } = JSON.parse(body);
        const r = setStage(stageId, status, detail, progress);
        if (r.ok) appendLog('info', `阶段 ${stageId} → ${status}${detail ? ' (' + detail + ')' : ''}`);
        res.writeHead(r.ok ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e) }));
      }
    });
    return;
  }

  // ---- 渲染进度汇报 ----
  if (p === '/api/render' && req.method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const { doneFrames } = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(reportProgress(parseInt(doneFrames) || 0)));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e) }));
      }
    });
    return;
  }

  // ---- 静态文件 ----
  if (p === '/' || p === '/dashboard.html') {
    res.writeHead(200, { 'Content-Type': MIME['.html'] });
    return res.end(fs.readFileSync(DASH, 'utf8'));
  }
  if (p.startsWith('/frames/')) {
    const name = path.basename(p);
    const fp = path.join(FRAMES_DIR, name);
    if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(name).toLowerCase()] || 'application/octet-stream' });
      return res.end(fs.readFileSync(fp));
    }
    res.writeHead(404); return res.end('frame not found: ' + name);
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found', path: p }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[pipeline] 控制台已启动 → http://127.0.0.1:${PORT}`);
  console.log(`[pipeline] 帧代理目录 → ${FRAMES_DIR}`);
  appendLog('info', `流水线控制台 v2 启动 (port ${PORT}, SSE 实时推送)`);
});
