#!/usr/bin/env node
/**
 * check-skill.js — 本地校验 SKILL.md 的 YAML frontmatter（与 CI 同规则）
 *
 * 用法：node check-skill.js [文件路径，默认 SKILL.md]
 * 退出码：0 = 通过；1 = 不合规
 *
 * 为什么需要本地校验：别的机器的 skill 加载器（Claude Code / Cursor / DSH）
 * 只认文件开头的 `---` frontmatter。一旦：
 *   - 文件带 UTF-8 BOM（Windows 的 Set-Content -Encoding UTF8 就会加）
 *   - 不是以 --- 开头
 *   - name 不是小写+连字符、description 超长
 * 加载器就静默读不到这个 skill —— 本机看着没问题，换台电脑就"丢了"。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const file = path.resolve(process.argv[2] || path.join(__dirname, 'SKILL.md'));
if (!fs.existsSync(file)) {
  console.error('找不到文件: ' + file);
  process.exit(1);
}

const raw = fs.readFileSync(file);
const issues = [];

// 1) BOM 检查（最常见的跨机器失效原因）
if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
  issues.push('文件带 UTF-8 BOM（EF BB BF）。Windows 的 Set-Content -Encoding UTF8 会自动加，' +
              '导致 frontmatter 失效，请存为无 BOM UTF-8。');
}

const text = raw.toString('utf8').replace(/^\uFEFF/, '');

// 2) 必须以 --- 开头
if (!text.startsWith('---')) {
  issues.push('文件未以 "---" 开头，不存在 frontmatter。');
} else {
  const end = text.indexOf('\n---', 3);
  if (end < 0) {
    issues.push('找不到 frontmatter 的闭合 "---"。');
  } else {
    const fm = text.slice(3, end);

    // 3) 必需字段
    for (const k of ['name:', 'description:']) {
      if (!fm.includes(k)) issues.push(`frontmatter 缺少必需字段 ${k}`);
    }

    // 4) name 规范
    const mName = /^name:\s*(.+)$/m.exec(fm);
    if (mName) {
      const name = mName[1].trim().replace(/^["']|["']$/g, '');
      if (!/^[a-z0-9-]{1,64}$/.test(name)) {
        issues.push(`name 不合规（需小写字母/数字/连字符，1-64 字符）: "${name}"`);
      }
    }

    // 5) description 长度与裸值风险
    const mDesc = /^description:\s*(.+)$/m.exec(fm);
    if (mDesc) {
      const desc = mDesc[1].trim();
      if (desc.length > 1024) {
        issues.push(`description 过长（${desc.length} > 1024）`);
      }
      if (['[', '{', '&', '*', '!', '|', '>', '%', '@', '`'].includes(desc[0])) {
        issues.push(`description 以 YAML 特殊字符 "${desc[0]}" 开头，需加引号`);
      }
      if (desc.includes(': ') || desc.includes(' #')) {
        issues.push('description 含 ": " 或 " #"，YAML 会误解析，需加引号');
      }
      if (/\s$/.test(desc)) issues.push('description 末尾有空白');
    }

    // 6) tab 缩进（YAML 禁止）
    fm.split(/\r?\n/).forEach((l, i) => {
      if (/\t/.test(l)) issues.push(`frontmatter 第 ${i + 1} 行含 TAB（YAML 禁止用 tab 缩进）`);
    });

    // 7) 无效控制字符
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(text)) {
      issues.push('文件含非法控制字符');
    }
  }
}

if (issues.length) {
  console.error('SKILL.md 校验失败：');
  for (const s of issues) console.error('  - ' + s);
  process.exit(1);
}

console.log(`SKILL.md 校验通过：${path.basename(file)}，无 BOM，frontmatter 合法（${raw.length} 字节）`);
