#!/usr/bin/env node
/**
 * generate-packs.js — Build petdex-compatible pet packs for the DSH Pet Companion.
 *
 * Pack format (petdex v1): pet.json + spritesheet (8 rows x 9 cols, frame 192x208).
 * Rows: 0 idle, 1 running-right, 2 running-left, 3 waving, 4 jumping,
 *       5 failed, 6 waiting, 7 running, 8 review.
 *
 * idle uses real frames from the official fifth-generation animated GIF
 * (PokeAPI generation-v/black-white/animated), so it has genuine blink /
 * breathe / tail-sway motion. The other rows are derived programmatically
 * from the classic front sprite with amplified offsets (mirror, bounce, jump,
 * wiggle, tint) so the motion reads clearly at small sizes.
 *
 * Dependency: ImageMagick 6+ (`convert`) on PATH. No npm deps.
 * Usage: node scripts/generate-packs.js
 */
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SPRITES = path.join(ROOT, 'sprites');
const OUT = path.join(ROOT, 'packs');

// petdex state table: row -> { frames, label }
const STATES = [
  { id: 'idle', frames: 6 },
  { id: 'running-right', frames: 8 },
  { id: 'running-left', frames: 8 },
  { id: 'waving', frames: 4 },
  { id: 'jumping', frames: 5 },
  { id: 'failed', frames: 8 },
  { id: 'waiting', frames: 6 },
  { id: 'running', frames: 6 },
  { id: 'review', frames: 6 },
];

const FRAME_W = 192;
const FRAME_H = 208;
const GRID_COLS = 8; // petdex v1: 8 columns x 9 rows (9 states)
const SPRITE_SIZE = 144; // classic sprite scaled up inside the 192x208 frame

function sh(args, opts = {}) {
  try {
    return execFileSync('convert', args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, ...opts });
  } catch (e) {
    const msg = (e.stderr && e.stderr.toString()) || e.message;
    throw new Error(`convert failed: ${args.join(' ').slice(0, 200)}\n${msg.slice(0, 800)}`);
  }
}

function tmp(name) {
  return path.join(OUT, '.tmp-' + name + '-' + Math.random().toString(36).slice(2) + '.png');
}

/** Build a 192x208 transparent frame with `sprite` composited at center + offset. */
function frame(spritePng, dx, dy, rotateDeg = 0, scalePct = 100) {
  let src = spritePng;
  if (rotateDeg !== 0) {
    const rp = tmp('rot' + Math.round(rotateDeg));
    sh(['-background', 'none', spritePng, '-rotate', String(rotateDeg), rp]);
    src = rp;
  }
  let final = src;
  if (scalePct !== 100) {
    const sp = tmp('scl' + scalePct);
    sh(['-background', 'none', src, '-filter', 'point', '-resize', scalePct + '%', sp]);
    final = sp;
  }
  const cx = Math.round((FRAME_W - SPRITE_SIZE) / 2) + dx;
  const cy = Math.round(FRAME_H - 10 - SPRITE_SIZE) + dy; // 10px bottom margin
  const out = tmp('f');
  sh(['-size', `${FRAME_W}x${FRAME_H}`, 'xc:none', final, '-geometry', `+${cx}+${cy}`, '-composite', out]);
  return out;
}

/** Prepare base sprite: classic front sprite scaled up to 144 with point filter. */
function prepareBase(petDir) {
  const src = path.join(petDir, 'front-classic.png');
  const out = tmp('base');
  sh(['-background', 'none', src, '-filter', 'point', '-resize', `${SPRITE_SIZE}x${SPRITE_SIZE}`, out]);
  return out;
}

/** Extract `n` evenly sampled frames from the official animated GIF, scaled to 144. */
function extractIdleFrames(gifPath, n) {
  const dir = tmp('idle');
  fs.mkdirSync(dir, { recursive: true });
  sh(['-coalesce', gifPath, path.join(dir, 'f-%02d.png')]);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
  const picks = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.min(files.length - 1, Math.round((i * (files.length - 1)) / (n - 1)));
    picks.push(path.join(dir, files[idx]));
  }
  return picks.map((f, i) => {
    const s = tmp('idle-s' + i);
    sh(['-background', 'none', f, '-filter', 'point', '-resize', `${SPRITE_SIZE}x${SPRITE_SIZE}`, s]);
    return s;
  });
}

/** Compose one state row: `frames` images + pad to 8 cols, horizontally appended. */
function row(frames, count) {
  const list = [];
  for (let i = 0; i < count; i++) list.push(frames[i]);
  while (list.length < GRID_COLS) {
    const e = tmp('empty');
    sh(['-size', `${FRAME_W}x${FRAME_H}`, 'xc:none', e]);
    list.push(e);
  }
  const out = tmp('row');
  sh(['-background', 'none', ...list, '+append', out]);
  return out;
}

function generate(pet) {
  const petDir = path.join(SPRITES, pet.id);
  const outDir = path.join(OUT, pet.id);
  fs.mkdirSync(outDir, { recursive: true });

  const base = prepareBase(petDir);
  const idleGif = path.join(petDir, 'idle-animated.gif');
  const idleSrc = fs.existsSync(idleGif) ? extractIdleFrames(idleGif, STATES[0].frames) : null;

  const rows = [];
  for (const st of STATES) {
    const n = st.frames;
    const frames = [];
    if (st.id === 'idle' && idleSrc) {
      // real official animation frames
      for (let i = 0; i < n; i++) frames.push(frame(idleSrc[i], 0, 0));
    } else {
      for (let i = 0; i < n; i++) {
        let dx = 0, dy = 0, rot = 0, scl = 100, use = base;
        switch (st.id) {
          case 'running-right': {
            const t = (i / n) * Math.PI * 2;
            dx = Math.round(Math.sin(t) * 34);
            dy = Math.round(Math.abs(Math.sin(t)) * 10);
            rot = 5;
            break;
          }
          case 'running-left': {
            const f = tmp('flop');
            sh(['-background', 'none', base, '-flop', f]);
            use = f;
            const t = (i / n) * Math.PI * 2;
            dx = -Math.round(Math.sin(t) * 34);
            dy = Math.round(Math.abs(Math.sin(t)) * 10);
            rot = -5;
            break;
          }
          case 'waving':
            rot = [0, 18, 0, -18][i] || 0;
            break;
          case 'jumping':
            dy = [0, -42, -66, -42, 0][i] || 0;
            break;
          case 'failed': {
            const f = tmp('fail');
            sh(['-background', 'none', base, '-modulate', '100,18,100', '-fill', '#4a6fa5', '-colorize', '28%', f]);
            use = f;
            dx = [0, 4, -4, 0, 4, -4, 0, 0][i] || 0;
            break;
          }
          case 'waiting':
            rot = [0, -8, -14, -8, 0, 0][i] || 0;
            dy = [0, -4, 0, -4, 0, 0][i] || 0;
            break;
          case 'running':
            dy = [0, -22, -36, -22, 0, 0][i] || 0;
            rot = [-4, -2, 0, 2, 4, 0][i] || 0;
            break;
          case 'review':
            rot = [-4, -8, -12, -8, -4, 0][i] || 0;
            scl = [100, 101, 102, 101, 100, 100][i] || 100;
            break;
          default:
            break;
        }
        frames.push(frame(use, dx, dy, rot, scl));
      }
    }
    rows.push(row(frames, n));
  }

  const sheet = tmp('sheet');
  sh(['-background', 'none', ...rows, '-append', sheet]);

  const finalSheet = path.join(outDir, 'spritesheet.png');
  fs.copyFileSync(sheet, finalSheet);

  const manifest = {
    id: pet.id,
    displayName: pet.displayName,
    description: pet.description,
    spritesheetPath: 'spritesheet.png',
  };
  fs.writeFileSync(path.join(outDir, 'pet.json'), JSON.stringify(manifest, null, 2) + '\n');

  // cleanup tmp files
  for (const f of fs.readdirSync(OUT)) {
    if (f.startsWith('.tmp-')) fs.rmSync(path.join(OUT, f), { recursive: true, force: true });
  }

  const info = execFileSync('identify', ['-format', '%wx%h', finalSheet], { encoding: 'utf8' });
  console.log(`✔ ${pet.id}: spritesheet ${info} (${fs.statSync(finalSheet).size} bytes)`);
  return finalSheet;
}

const PETS = [
  {
    id: 'pikachu',
    displayName: 'Pikachu',
    description: '皮卡丘（Pikachu #25）—— 活泼好动的电系伙伴。',
  },
  {
    id: 'charmander',
    displayName: 'Charmander',
    description: '小火龙（Charmander #4）—— 倔强认真的火系伙伴。',
  },
];

fs.mkdirSync(OUT, { recursive: true });
for (const pet of PETS) generate(pet);
console.log('Done. Packs written to', OUT);
