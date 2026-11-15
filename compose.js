#!/usr/bin/env node
/**
 * compose.js — 帧序列 + 音轨 → 成片（ffmpeg 封装，跨平台）
 *
 * 用法：
 *   node compose.js [选项]
 *
 * 选项：
 *   --frames=frames            帧目录
 *   --pattern=f_%05d.png       ffmpeg 输入模式（省略 = 按帧目录自动识别 png/jpg）
 *   --fps=24                   输入帧率
 *   --audio=audio.mp3          音轨（可省略 = 无音轨）
 *   --out=video.mp4            输出
 *   --crf=18                   质量
 *   --preset=slow              编码预设
 *   --pix-fmt=yuv444p          yuv444p（硬像素最锐）| yuv420p（最大兼容）
 *   --audio-bitrate=192k       AAC 码率
 *   --start=0                  帧起始编号（render.js 的 --start 秒 × fps）
 *
 * 例：
 *   node compose.js --frames=frames --audio=audio.mp3 --out=video.mp4
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const flags = {};
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)=(.*)$/.exec(a);
  if (m) flags[m[1]] = m[2];
}

const FRAMES = path.resolve(flags.frames || 'frames');
let PATTERN = flags.pattern || null;
const FPS = flags.fps || '24';
const AUDIO = flags.audio ? path.resolve(flags.audio) : null;
const OUT = path.resolve(flags.out || 'video.mp4');
const CRF = flags.crf || '18';
const PRESET = flags.preset || 'slow';
const PIXFMT = flags['pix-fmt'] || 'yuv444p';
const ABR = flags['audio-bitrate'] || '192k';
const START = parseInt(flags.start || '0', 10);

if (!fs.existsSync(FRAMES)) {
  console.error('帧目录不存在: ' + FRAMES);
  process.exit(2);
}
if (AUDIO && !fs.existsSync(AUDIO)) {
  console.error('音轨不存在: ' + AUDIO);
  process.exit(2);
}

// 未显式给 --pattern 时，按帧目录里的实际文件名自动推导（png/jpg 都认）
if (!PATTERN) {
  const imgs = fs.readdirSync(FRAMES).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort();
  if (!imgs.length) {
    console.error('帧目录为空（找不到 png/jpg 帧）: ' + FRAMES);
    process.exit(2);
  }
  PATTERN = imgs[0].replace(/(\d+)(\.(?:png|jpe?g))$/i, (_, d, ext) => `%0${d.length}d${ext}`);
  console.log(`[compose] 自动识别帧模式: ${PATTERN}（来自 ${imgs[0]}）`);
}

const first = PATTERN.replace(/%0(\d)d/, (_, n) => String(START).padStart(+n, '0'));
if (!fs.existsSync(path.join(FRAMES, first))) {
  console.error(`找不到首帧 ${first}（--start=${START} 是否正确？）`);
  process.exit(2);
}

// 注意：ffmpeg 的 image2 demuxer 对含非 ASCII 字符的绝对路径会解析失败，
// 因此在帧目录内用相对模式调用（cwd = FRAMES），输出仍写绝对路径。
const args = [
  '-y', '-v', 'error', '-stats',
  '-framerate', FPS,
  '-start_number', String(START),
  '-i', PATTERN,
];
if (AUDIO) args.push('-i', AUDIO);

args.push('-c:v', 'libx264', '-pix_fmt', PIXFMT, '-crf', CRF, '-preset', PRESET);

if (AUDIO) {
  // -strict -2：部分发行版把 aac 编码器标为 experimental，不加此参数会直接报错退出
  args.push('-map', '0:v:0', '-map', '1:a:0', '-c:a', 'aac', '-b:a', ABR, '-strict', '-2', '-shortest');
} else {
  args.push('-an');
}
args.push(OUT);

console.log('[compose] cwd=' + FRAMES);
console.log('[compose] ffmpeg ' + args.join(' '));
const r = spawnSync('ffmpeg', args, { stdio: 'inherit', cwd: FRAMES });

if (r.error) {
  console.error('[compose] 找不到 ffmpeg 可执行文件，请先安装并加入 PATH');
  process.exit(1);
}
if (r.status !== 0) {
  console.error('[compose] ffmpeg 失败，退出码 ' + r.status);
  process.exit(r.status || 1);
}

const mb = (fs.statSync(OUT).size / 1048576).toFixed(2);
console.log(`[compose] done: ${OUT}  ${mb} MB`);
