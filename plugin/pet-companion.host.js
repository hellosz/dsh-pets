/**
 * dsh-pet-companion — Host half.
 *
 * A pet state engine for the DeepSeek Harness Web GUI, modeled on OpenAI
 * Codex Pets: pet behavior states replace progress bars. This half listens
 * to DSH lifecycle events, derives a per-session pet state with a strict
 * priority order, and serves read-only snapshots to the Client half over
 * Package-private RPC (harness.handle).
 *
 * State set: idle | running | waiting | review | failed
 * (the client maps these onto the 9-row petdex spritesheet, adding
 *  directional/jumping/waving behaviors client-side).
 *
 * Priority: waiting > failed > review > running > idle.
 *
 * This is a Cordis plugin body: plain JavaScript, no imports, no JSX.
 */
const PACKS_DIR_CANDIDATES = [
  '/var/www/coding/dsh/pets/packs', // dev workspace (this session)
  'packs', // workspace-root-relative (open-source installs)
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
    status: 'idle', // from agent/status
    tools: 0,
    subagents: 0,
    workflows: 0,
    waiting: null, // { seq, until }
    failed: null, // until
    review: null, // until
    revision: 0,
    lastChange: Date.now(),
  };
}

// Byte-level base64 (no TextDecoder/btoa: the harness btoa is UTF-8 text and
// would corrupt binary PNG bytes into an invalid data: URL).
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

return {
    apply(ctx) {
      const bySession = new Map();
      let lastActiveSessionId = undefined;
      let waitingSeq = 0;

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

      // ---- event listeners (all observe-only, no waterfall veto) ----

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
      });

      ctx.on('agent/error', (payload) => {
        const sid = sidOf(payload && payload.agent);
        mark(sid, { failed: Date.now() + FAILED_HOLD_MS, status: 'idle' });
      });

      ctx.on('approval/request', (req, next) => {
        const sid = sidOf(req);
        const seq = ++waitingSeq;
        mark(sid, { waiting: { seq, until: Date.now() + WAITING_HOLD_MS } });
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

      ctx.on('session/disposed', (session) => {
        const sid = sidOf(session);
        if (sid) bySession.delete(sid);
      });

      // ---- RPC: read-only state snapshot ----

      harness.handle('pet/state', (args) => {
        const req = args || {};
        const sid = typeof req.sessionId === 'string' ? req.sessionId : lastActiveSessionId;
        const e = bySession.get(sid) || emptyEntry();
        const { state, label } = computeState(sid);
        return {
          sessionId: sid || null,
          state,
          label,
          revision: e.revision,
          petId: typeof req.petId === 'string' ? req.petId : 'pikachu',
        };
      });

      // ---- RPC: serve pack assets (spritesheet + manifest) as base64 ----

      const fsSvc = ctx.get('fs');
      const assetCache = new Map();

      async function locatePack(petId) {
        if (!fsSvc) return null;
        const sp = ctx.get('sandboxPolicy');
        const root = sp && sp.workspaceRoot ? sp.workspaceRoot : null;
        const bases = [];
        if (root) bases.push(root + '/packs');
        bases.push(...PACKS_DIR_CANDIDATES);
        for (const base of bases) {
          try {
            const target = await fsSvc.resolve(base + '/' + petId + '/spritesheet.png');
            const st = await fsSvc.stat(target);
            if (st) return target;
          } catch (_) {
            /* try next candidate */
          }
        }
        return null;
      }

      harness.handle('pet/asset', async (args) => {
        const petId = args && typeof args.petId === 'string' ? args.petId : 'pikachu';
        if (assetCache.has(petId)) return assetCache.get(petId);
        try {
          const target = await locatePack(petId);
          if (!target) return { petId, ok: false, reason: 'pack-not-found' };
          const bytes = await fsSvc.readBytes(target, undefined, 8 * 1024 * 1024);
          const b64 = bytesToBase64(bytes);
          const result = { petId, ok: true, dataBase64: b64 };
          assetCache.set(petId, result);
          return result;
        } catch (err) {
          console.error('[pet-companion] asset load failed:', String(err && err.message || err));
          return { petId, ok: false, reason: 'load-failed' };
        }
      });

      console.log('[pet-companion] host engine ready');
    },
};
