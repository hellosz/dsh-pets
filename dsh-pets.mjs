/**
 * dsh-pets — Host half (persistent plugin).
 *
 * A pet state engine for the DeepSeek Harness Web GUI. Listens to DSH
 * lifecycle events, derives a per-session pet state, serves snapshots and
 * sprite assets over webServer routes (so the Client half can fetch them),
 * and registers a `pet_say` tool through the tools service.
 *
 * Notification text is optionally compressed into a short pet line with
 * deepseek-v4-flash; on an unconfigured provider it falls back to raw text.
 *
 * Installed via cordis.patch.yml `insert` (like the dsh-ntfy pattern).
 */
import { defineTool } from "@deepseek-ai/dsh-tools";
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKS_DIR_CANDIDATES = [
  join(__dirname, 'packs'), // 包内资源（npm 安装后，与 dsh-pets.mjs 同级）
  '/var/www/coding/dsh/pets/packs', // 项目目录（本地开发）
  'packs', // workspace-root-relative
];

const LABELS = {
  idle: { zh: '空闲', en: 'Idle' },
  running: { zh: '思考中', en: 'Running' },
  waiting: { zh: '等你确认', en: 'Waiting for input' },
  review: { zh: '待你审查', en: 'Ready for review' },
  failed: { zh: '出错了', en: 'Failed' },
};

const WAITING_HOLD_MS = 90 * 1000;
const FAILED_HOLD_MS = 25 * 1000;
const REVIEW_HOLD_MS = 12 * 1000;
const NOTICE_HOLD_MS = 8 * 1000;

const SUMMARIZE_PROMPT =
  '把下面的通知总结成一句不超过 18 个字的简体中文台词，用可爱宠物助手的口吻（第一人称），直接给出台词，不要引号、不要任何解释：\n\n';

function extractText(x) {
  if (!x) return '';
  if (typeof x === 'string') return x;
  if (typeof x === 'number') return String(x);
  if (typeof x.message === 'string') return x.message;
  if (typeof x.reason === 'string') return x.reason;
  if (typeof x.title === 'string') return x.title;
  if (typeof x.summary === 'string') return x.summary;
  if (typeof x.name === 'string') return x.name;
  return '';
}

function sidOf(x) {
  if (!x) return undefined;
  if (typeof x === 'string') return x;
  if (typeof x.id === 'string') return x.id;
  if (typeof x.sessionId === 'string') return x.sessionId;
  if (x.agent) return sidOf(x.agent);
  if (x.session) return sidOf(x.session);
  if (x.info && typeof x.info === 'object') return sidOf(x.info);
  if (x.exec && typeof x.exec === 'object') return sidOf(x.exec);
  if (x.req && typeof x.req === 'object') return sidOf(x.req);
  return undefined;
}

function emptyEntry() {
  return {
    status: 'idle',
    tools: 0,
    subagents: 0,
    workflows: 0,
    waiting: null,
    failed: null,
    review: null,
    notice: null,
    summarizing: false,
    revision: 0,
    lastChange: Date.now(),
  };
}

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function bytesToBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64_CHARS[b0 >> 2];
    out += B64_CHARS[((b0 & 3) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    out += b1 === undefined ? '=' : B64_CHARS[((b1 & 15) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    out += b2 === undefined ? '=' : B64_CHARS[b2 & 63];
  }
  return out;
}

export default {
  name: 'dsh-pets',
  inject: ['webServer', 'tools'],
  apply(ctx) {
    const bySession = new Map();
    let lastActiveSessionId = undefined;
    let waitingSeq = 0;
    let summarizeUnavailable = false;
    let summarizeWarned = false;

    function mark(sid, patch) {
      if (!sid) return;
      const e = bySession.get(sid) || emptyEntry();
      Object.assign(e, patch);
      e.lastChange = Date.now();
      e.revision += 1;
      bySession.set(sid, e);
      lastActiveSessionId = sid;
    }

    function clearWaitingIf(sid, seq) {
      const e = bySession.get(sid);
      if (!e || !e.waiting) return;
      if (seq !== undefined && e.waiting.seq !== seq) return;
      e.waiting = null;
      e.lastChange = Date.now();
      e.revision += 1;
    }

    function setNotice(sid, text, holdMs, skipSummarize) {
      if (!sid || !text) return;
      const e = bySession.get(sid) || emptyEntry();
      e.notice = { text: String(text).slice(0, 160), until: Date.now() + (holdMs || NOTICE_HOLD_MS) };
      e.lastChange = Date.now();
      e.revision += 1;
      bySession.set(sid, e);
      lastActiveSessionId = sid;
      if (!skipSummarize && !e.summarizing) {
        e.summarizing = true;
        summarizeNotice(sid, e.notice.text, holdMs).finally(() => {
          const cur = bySession.get(sid);
          if (cur) cur.summarizing = false;
        });
      }
    }

    function markSummarizeUnavailable() {
      summarizeUnavailable = true;
      if (!summarizeWarned) {
        summarizeWarned = true;
        console.warn('[dsh-pets] 通知总结不可用（deepseek-official 未配置），将直接显示原文');
      }
    }

    async function summarizeNotice(sid, text, holdMs) {
      if (summarizeUnavailable) return;
      const llmSvc = ctx.get('llm');
      if (!llmSvc) return markSummarizeUnavailable();
      let providers;
      try {
        providers = llmSvc.listProviders();
      } catch (_) {
        return markSummarizeUnavailable();
      }
      if (!providers || !providers.some((p) => p && p.id === 'deepseek-official')) {
        return markSummarizeUnavailable();
      }
      try {
        const chunks = llmSvc.stream({
          provider: 'deepseek-official',
          model: 'deepseek-v4-flash',
          messages: [
            { role: 'user', content: [{ type: 'text', text: SUMMARIZE_PROMPT + text }] },
          ],
          maxTokens: 80,
        });
        let out = '';
        for await (const chunk of chunks) {
          if (chunk && chunk.type === 'text-delta' && chunk.text) out += chunk.text;
        }
        const summary = out.trim().replace(/^["'「【\s]+|["'」】\s]+$/g, '').slice(0, 40);
        if (summary) {
          const e = bySession.get(sid);
          if (e && e.notice) {
            e.notice.text = summary;
            e.notice.until = Date.now() + (holdMs || NOTICE_HOLD_MS);
            e.revision += 1;
            e.lastChange = Date.now();
          }
        }
      } catch (_) {
        // Transient failure: keep raw text.
      }
    }

    // ---- pet_say dynamic tool (tools service) ----
    const toolsSvc = ctx.get('tools');
    if (toolsSvc) {
      toolsSvc.register(defineTool({
        name: 'pet_say',
        description: '让屏幕右下角的宠物伙伴开口说一句话，显示在宠物头顶的气泡里。适合给用户一句轻松的提示、鼓励、提醒或状态播报，台词要简短口语化。',
        parameters: {
          text: { type: 'string', required: true, description: '让宠物说的台词，简体中文，20 字以内' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              ok: { type: 'boolean', required: true },
              text: { type: 'string', required: true },
            },
          },
          render: (args, value) => [{ type: 'text', text: '宠物已说：' + (value && value.text || '') }],
        },
        async execute(args, exec) {
          const text = String(args && args.text || '').trim().slice(0, 40);
          if (!text) return { ok: false, text: '' };
          const sid = sidOf(exec && exec.agent) || lastActiveSessionId;
          setNotice(sid, text, 10 * 1000, true);
          return { ok: true, text };
        },
      }));
    }

    function computeState(sid) {
      const e = bySession.get(sid) || emptyEntry();
      const now = Date.now();
      if (e.waiting && now < e.waiting.until) return { state: 'waiting', label: LABELS.waiting };
      if (e.failed && now < e.failed) return { state: 'failed', label: LABELS.failed };
      if (e.review && now < e.review) return { state: 'review', label: LABELS.review };
      if (e.status === 'running' || e.tools > 0 || e.subagents > 0 || e.workflows > 0) {
        return { state: 'running', label: LABELS.running };
      }
      return { state: 'idle', label: LABELS.idle };
    }

    // ---- event listeners ----
    ctx.on('agent/status', (payload) => {
      const sid = sidOf(payload && payload.agent);
      if (payload && payload.status === 'running') {
        mark(sid, { status: 'running', review: null, failed: null });
      } else {
        mark(sid, { status: 'idle' });
      }
    });

    ctx.on('agent/turn-stopping', (payload) => {
      const sid = sidOf(payload && payload.agent);
      mark(sid, { review: Date.now() + REVIEW_HOLD_MS });
      setNotice(sid, '回合完成，待你审查', REVIEW_HOLD_MS);
    });

    ctx.on('agent/error', (payload) => {
      const sid = sidOf(payload && payload.agent);
      mark(sid, { failed: Date.now() + FAILED_HOLD_MS, status: 'idle' });
      const errText = extractText(payload && payload.error);
      if (errText) setNotice(sid, '出错了：' + errText, FAILED_HOLD_MS);
    });

    ctx.on('approval/request', (req, next) => {
      const sid = sidOf(req);
      const seq = ++waitingSeq;
      mark(sid, { waiting: { seq, until: Date.now() + WAITING_HOLD_MS } });
      const reason = extractText(req && (req.reason || req.title || req.question));
      if (reason) setNotice(sid, '等你确认：' + reason, WAITING_HOLD_MS);
      const p = Promise.resolve(next());
      p.then(
        () => clearWaitingIf(sid, seq),
        () => clearWaitingIf(sid, seq),
      );
      return p;
    });

    ctx.on('tools/execute', (exec, next) => {
      const sid = sidOf(exec && exec.agent);
      mark(sid, { tools: (bySession.get(sid) || emptyEntry()).tools + 1 });
      const p = Promise.resolve(next());
      return p;
    });

    ctx.on('tools/result', (exec) => {
      const sid = sidOf(exec);
      const e = bySession.get(sid);
      if (e && e.tools > 0) mark(sid, { tools: e.tools - 1 });
    });

    ctx.on('subagent/start', (info) => {
      const sid = sidOf(info);
      mark(sid, { subagents: (bySession.get(sid) || emptyEntry()).subagents + 1 });
    });

    ctx.on('subagent/end', (info) => {
      const sid = sidOf(info);
      const e = bySession.get(sid);
      if (e && e.subagents > 0) mark(sid, { subagents: e.subagents - 1 });
    });

    ctx.on('workflow/start', (info) => {
      const sid = sidOf(info);
      mark(sid, { workflows: (bySession.get(sid) || emptyEntry()).workflows + 1 });
    });

    ctx.on('workflow/end', (info) => {
      const sid = sidOf(info);
      const e = bySession.get(sid);
      if (e && e.workflows > 0) mark(sid, { workflows: e.workflows - 1 });
    });

    ctx.on('workflow/log', (info, message) => {
      const sid = sidOf(info);
      if (message) setNotice(sid, message, NOTICE_HOLD_MS);
    });

    ctx.on('workflow/phase', (info, title) => {
      const sid = sidOf(info);
      if (title) setNotice(sid, '阶段：' + title, NOTICE_HOLD_MS);
    });

    ctx.on('session/disposed', (session) => {
      const sid = sidOf(session);
      if (sid) bySession.delete(sid);
    });

    // ---- web routes (替代 harness.handle RPC) ----
    const fsSvc = ctx.get('fs');
    const assetCache = new Map();

    async function locatePack(petId) {
      if (!fsSvc) return null;
      for (const base of PACKS_DIR_CANDIDATES) {
        try {
          const target = await fsSvc.resolve(base + '/' + petId + '/spritesheet.png');
          const st = await fsSvc.stat(target);
          if (st) return target;
        } catch (_) {
          // try next candidate
        }
      }
      return null;
    }

    const webServer = ctx.get('webServer');
    if (webServer) {
      webServer.register({
        kind: 'exact',
        path: '/pet/state',
        handler: async (req, res) => {
          const url = new URL(req.url, 'http://localhost');
          const sid = url.searchParams.get('sessionId') || lastActiveSessionId;
          const petId = url.searchParams.get('petId') || 'pikachu';
          const e = bySession.get(sid) || emptyEntry();
          const { state, label } = computeState(sid);
          const now = Date.now();
          const notice = e.notice && now < e.notice.until ? e.notice.text : null;
          const body = JSON.stringify({
            sessionId: sid || null,
            state,
            label,
            notice,
            revision: e.revision,
            petId,
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(body);
        },
      });

      webServer.register({
        kind: 'exact',
        path: '/pet/asset',
        handler: async (req, res) => {
          const url = new URL(req.url, 'http://localhost');
          const petId = url.searchParams.get('petId') || 'pikachu';
          if (assetCache.has(petId)) {
            const cached = assetCache.get(petId);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(cached));
            return;
          }
          try {
            const target = await locatePack(petId);
            if (!target) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ petId, ok: false, reason: 'pack-not-found' }));
              return;
            }
            const bytes = await fsSvc.readBytes(target, undefined, 8 * 1024 * 1024);
            const b64 = bytesToBase64(bytes);
            const result = { petId, ok: true, dataBase64: b64 };
            assetCache.set(petId, result);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          } catch (err) {
            console.error('[dsh-pets] asset load failed:', String(err && err.message || err));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ petId, ok: false, reason: 'load-failed' }));
          }
        },
      });
    }

    console.log('[dsh-pets] host engine ready (persistent)');
  },
};
