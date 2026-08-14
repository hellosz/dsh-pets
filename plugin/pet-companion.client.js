/**
 * dsh-pet-companion — Client half.
 *
 * A floating pixel pet in the DeepSeek Harness Web GUI, modeled on OpenAI
 * Codex Pets. Renders the petdex-format spritesheet served by the Host half
 * (8 cols x 9 rows of 192x208 frames) and maps the Host state engine's
 * snapshot (idle | running | waiting | review | failed) onto animation rows.
 *
 * Each pet carries a personality and per-state catchphrases, so the status
 * bubble and animation pacing feel distinct per character.
 *
 * Plain JavaScript + React.createElement (no JSX, no bundler).
 */
const STATE_ROWS = {
  idle: 0,
  'running-right': 1,
  'running-left': 2,
  waving: 3,
  jumping: 4,
  failed: 5,
  waiting: 6,
  running: 7,
  review: 8,
};

const FRAME_COUNT = {
  idle: 6,
  'running-right': 8,
  'running-left': 8,
  waving: 4,
  jumping: 5,
  failed: 8,
  waiting: 6,
  running: 6,
  review: 6,
};

// Base frame pacing; per-pet speedMul adjusts it for character feel.
const FRAME_MS = {
  idle: 130,
  'running-right': 110,
  'running-left': 110,
  waving: 130,
  jumping: 130,
  failed: 120,
  waiting: 130,
  running: 110,
  review: 130,
};

const BASE_SIZE = 128; // px at zoom 1.0

const PETS = [
  {
    id: 'pikachu',
    name: '皮卡丘',
    emoji: '⚡',
    personality: '活泼好动，电力十足',
    speedMul: 1.0,
    catchphrases: {
      idle: ['皮卡皮卡~', '充满电啦！', '今天也元气满满'],
      running: ['交给我吧，皮卡！', '滋滋…思考中', '火力全开！'],
      waiting: ['到你了哦~', '等你呢，皮卡', '我在哦'],
      review: ['看看我的成果~', '检查一下吧', '这次做得不错吧？'],
      failed: ['哎呀漏电了…', '皮卡…', '唔，搞砸了'],
    },
  },
  {
    id: 'charmander',
    name: '小火龙',
    emoji: '🔥',
    personality: '倔强认真，尾巴燃着斗志',
    speedMul: 1.15,
    catchphrases: {
      idle: ['呼~', '尾巴要烧旺点', '别碰我的尾巴'],
      running: ['烧起来了！', '看我的火焰', '这点小事难不倒我'],
      waiting: ['听你的', '我等着', '你说了算'],
      review: ['检查吧，尾巴不骗人', '看仔细点', '我可没偷懒'],
      failed: ['火焰熄了…', '哼，再来一次！', '我才不会认输'],
    },
  },
];

// Host engine states -> status badge (dot color + zh label).
const STATE_META = {
  idle: { zh: '空闲', color: '#94a3b8' },
  running: { zh: '思考中', color: '#38bdf8' },
  waiting: { zh: '等你确认', color: '#f59e0b' },
  review: { zh: '待你审查', color: '#a78bfa' },
  failed: { zh: '出错了', color: '#f87171' },
};

// module-scope store shared by overlay + settings page, with a tiny pub/sub
// so either surface can update the other without window/document events.
const store = {
  petId: 'pikachu',
  zoom: 1.0, // relative to BASE_SIZE (128px); range 0.6 .. 2.5
  enabled: true,
};

const storeListeners = new Set();
function setStore(k, v) {
  if (store[k] === v) return;
  store[k] = v;
  storeListeners.forEach((fn) => fn());
}
function useStoreTick() {
  const [, force] = React.useState(0);
  React.useEffect(() => {
    const fn = () => force((x) => x + 1);
    storeListeners.add(fn);
    return () => storeListeners.delete(fn);
  }, []);
}

const assetCache = {};

return {
    inject: ['timer'],
    apply(ctx) {
      const slots = ctx.get('slots');
      if (slots === undefined) return;

      styles.insert(`
        .dsh-pet-wrap {
          position: fixed;
          right: 16px;
          bottom: 16px;
          z-index: 9999;
          pointer-events: none;
        }
        .dsh-pet-body {
          pointer-events: auto;
          cursor: grab;
          user-select: none;
          -webkit-user-select: none;
          background-repeat: no-repeat;
          background-color: transparent;
          transition: filter 0.15s ease;
          will-change: left, top;
        }
        .dsh-pet-body:active { cursor: grabbing; }
        .dsh-pet-body:hover { filter: drop-shadow(0 6px 14px rgba(0,0,0,0.28)); }
        .dsh-pet-status {
          position: absolute;
          bottom: calc(100% + 6px);
          right: 0;
          pointer-events: none;
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 4px;
          max-width: 300px;
        }
        .dsh-pet-status .line {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px 11px;
          border-radius: 999px;
          background: rgba(24, 24, 27, 0.88);
          color: #f4f4f5;
          font: 12px/1.5 system-ui, -apple-system, sans-serif;
          white-space: nowrap;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.22);
          backdrop-filter: blur(6px);
        }
        .dsh-pet-status .dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #94a3b8;
          box-shadow: 0 0 0 3px rgba(255,255,255,0.12);
        }
        .dsh-pet-status .phrase {
          padding: 5px 12px;
          border-radius: 12px;
          background: rgba(24, 24, 27, 0.82);
          color: #ececef;
          font: 12px/1.5 system-ui, -apple-system, sans-serif;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
          backdrop-filter: blur(6px);
        }
        .dsh-pet-status .phrase.notice {
          background: #f59e0b;
          color: #1c1200;
          font-weight: 700;
          font-size: 13px;
          border: none;
          box-shadow: 0 3px 16px rgba(245, 158, 11, 0.55);
        }
        .dsh-pet-backdrop {
          position: fixed;
          inset: 0;
          z-index: 10000;
          pointer-events: auto;
        }
        .dsh-pet-menu {
          position: absolute;
          bottom: calc(100% + 8px);
          right: 0;
          z-index: 10001;
          pointer-events: auto;
          width: 180px;
          padding: 10px;
          border-radius: 12px;
          background: rgba(24, 24, 27, 0.94);
          color: #f4f4f5;
          box-shadow: 0 10px 32px rgba(0, 0, 0, 0.4);
          font: 12px/1.6 system-ui, -apple-system, sans-serif;
          backdrop-filter: blur(10px);
        }
        .dsh-pet-menu .title {
          margin: 0 0 8px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.02em;
          color: rgba(244, 244, 245, 0.6);
        }
        .dsh-pet-menu .pets {
          display: flex;
          gap: 8px;
        }
        .dsh-pet-menu .pet-btn {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          padding: 8px 4px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.05);
          color: inherit;
          font: inherit;
          cursor: pointer;
          transition: background 0.12s ease, border-color 0.12s ease;
        }
        .dsh-pet-menu .pet-btn:hover { background: rgba(255, 255, 255, 0.12); }
        .dsh-pet-menu .pet-btn.active {
          background: rgba(245, 158, 11, 0.18);
          border-color: #f59e0b;
        }
        .dsh-pet-menu .pet-btn .emoji { font-size: 20px; line-height: 1; }
        .dsh-pet-menu .pet-btn .name { font-size: 11px; }
        .dsh-pet-menu .divider {
          height: 1px;
          margin: 8px 0;
          background: rgba(255, 255, 255, 0.08);
        }
        .dsh-pet-menu .zoom-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .dsh-pet-menu .zoom-row input[type="range"] {
          flex: 1;
          accent-color: #f59e0b;
        }
        .dsh-pet-menu .zoom-val {
          font-size: 11px;
          color: rgba(244, 244, 245, 0.8);
          min-width: 34px;
          text-align: right;
          font-variant-numeric: tabular-nums;
        }
        .dsh-pet-menu .actions {
          display: flex;
          gap: 8px;
        }
        .dsh-pet-menu .actions button {
          flex: 1;
          padding: 6px 0;
          border: none;
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.08);
          color: inherit;
          font: inherit;
          cursor: pointer;
          transition: background 0.12s ease;
        }
        .dsh-pet-menu .actions button:hover { background: rgba(255, 255, 255, 0.16); }
        .dsh-pet-menu .hint {
          margin-top: 8px;
          font-size: 10px;
          color: rgba(244, 244, 245, 0.45);
          text-align: center;
        }
        .dsh-pet-settings { display: grid; gap: 12px; max-width: 360px; }
        .dsh-pet-settings label { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
        .dsh-pet-settings select, .dsh-pet-settings input[type="range"] { padding: 5px 8px; border-radius: 6px; border: 1px solid rgba(128,128,128,.4); background: transparent; color: inherit; }
        .dsh-pet-settings input[type="range"] { padding: 0; border: none; accent-color: #f59e0b; }
      `);

      function PetOverlay() {
        useStoreTick();
        const [sheet, setSheet] = React.useState(null);
        const [assetError, setAssetError] = React.useState(false);
        const [hostState, setHostState] = React.useState('idle');
        const [frameIdx, setFrameIdx] = React.useState(0);
        const [menuOpen, setMenuOpen] = React.useState(false);
        const [pos, setPos] = React.useState(null); // {x,y}; null = default bottom-right
        const [notice, setNotice] = React.useState(null); // notification text from Host
        const wrapRef = React.useRef(null);
        const dragRef = React.useRef(null);
        const animRef = React.useRef({ anim: 'idle', until: 0, nextRandomAt: Date.now() + 6000, acc: 0 });
        const hostStateRef = React.useRef('idle');
        const phraseRef = React.useRef({ key: '', text: '' });

        const switchPet = (id) => {
          if (id === store.petId) return;
          setStore('petId', id);
          setFrameIdx(0);
        };

        // load spritesheet for the selected pet
        React.useEffect(() => {
          let alive = true;
          setAssetError(false);
          (async () => {
            const id = store.petId;
            const cached = assetCache[id];
            if (cached) {
              if (alive) setSheet(cached);
              return;
            }
            try {
              const res = await host.call('pet/asset', { petId: id });
              if (res && res.ok) {
                assetCache[id] = res;
                if (alive) setSheet(res);
              } else if (alive) {
                setAssetError(true);
                console.error('[pet-companion] asset load failed:', res && res.reason);
              }
            } catch (err) {
              if (alive) setAssetError(true);
              console.error('[pet-companion] asset load error:', String(err));
            }
          })();
          return () => {
            alive = false;
          };
        }, [store.petId]);

        // poll Host state engine
        React.useEffect(() => {
          const poll = () => {
            if (!store.enabled) return;
            host.call('pet/state', { petId: store.petId }).then(
              (s) => {
                if (s && s.state && s.state !== hostStateRef.current) {
                  hostStateRef.current = s.state;
                  setHostState(s.state);
                }
                setNotice((s && s.notice) || null);
              },
              () => {},
            );
          };
          poll();
          const d = ctx.interval(poll, 600);
          return () => d();
        }, []);

        // animation tick (advance frames, random idle behaviors)
        React.useEffect(() => {
          const tick = () => {
            const now = Date.now();
            const r = animRef.current;

            // choose target animation
            let target;
            switch (hostState) {
              case 'running': target = 'running'; break;
              case 'waiting': target = 'waiting'; break;
              case 'review': target = 'review'; break;
              case 'failed': target = 'failed'; break;
              default: target = 'idle';
            }

            if (target === 'idle') {
              if (now >= r.nextRandomAt && r.until < now) {
                const pool = ['waving', 'jumping', 'running-left', 'running-right'];
                const pick = pool[Math.floor(Math.random() * pool.length)];
                r.anim = pick;
                r.until = now + FRAME_COUNT[pick] * FRAME_MS[pick];
                r.acc = 0;
                r.nextRandomAt = now + 9000 + Math.random() * 9000;
              } else if (r.anim !== 'idle' && now >= r.until) {
                r.anim = 'idle';
                r.acc = 0;
              }
            } else {
              r.anim = target;
              r.acc = 0;
            }

            const pet = PETS.find((p) => p.id === store.petId) || PETS[0];
            const speedMul = pet.speedMul || 1.0;
            const anim = r.anim;
            const count = FRAME_COUNT[anim];
            const dur = FRAME_MS[anim] * speedMul;
            r.acc += 60;
            const step = Math.floor(r.acc / dur);
            if (step >= 1) {
              r.acc -= step * dur;
              setFrameIdx((f) => (f + step) % count);
            }
          };
          const d = ctx.interval(tick, 60);
          return () => d();
        }, [hostState]);

        if (!store.enabled) return null;

        const activePet = PETS.find((p) => p.id === store.petId) || PETS[0];
        const meta = STATE_META[hostState] || STATE_META.idle;
        const FALLBACK_ICON = { pikachu: '⚡', charmander: '🔥' };

        const sizePx = Math.round(BASE_SIZE * store.zoom);
        const frameScale = sizePx / 192;
        const dispW = sizePx;
        const dispH = Math.round(208 * frameScale);
        const row = STATE_ROWS[animRef.current.anim || 'idle'];
        const base64 = sheet ? sheet.dataBase64 : null;
        const bg = base64
          ? `url(data:image/png;base64,${base64})`
          : 'none';

        // pick a stable catchphrase per (pet, state)
        const phrasePool = activePet.catchphrases[hostState] || activePet.catchphrases.idle;
        const phraseKey = activePet.id + ':' + hostState;
        if (phraseRef.current.key !== phraseKey) {
          phraseRef.current = {
            key: phraseKey,
            text: phrasePool[Math.floor(Math.random() * phrasePool.length)],
          };
        }

        const wrapStyle = pos
          ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' }
          : { right: 16, bottom: 16, left: 'auto', top: 'auto' };

        const onDown = (e) => {
          e.preventDefault();
          e.stopPropagation();
          const el = wrapRef.current;
          dragRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            baseX: pos ? pos.x : el.offsetLeft,
            baseY: pos ? pos.y : el.offsetTop,
            moved: 0,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        };

        const onMove = (e) => {
          const d = dragRef.current;
          if (!d || !wrapRef.current) return;
          const dx = e.clientX - d.startX;
          const dy = e.clientY - d.startY;
          if (Math.abs(dx) + Math.abs(dy) > 5) d.moved = 1;
          const parent = wrapRef.current.offsetParent;
          let x = d.baseX + dx;
          let y = d.baseY + dy;
          if (parent) {
            const maxX = Math.max(0, parent.clientWidth - dispW);
            const maxY = Math.max(0, parent.clientHeight - dispH);
            x = Math.min(Math.max(0, x), maxX);
            y = Math.min(Math.max(0, y), maxY);
          }
          setPos({ x, y }); // live re-render so the pet follows the pointer
        };

        const onUp = (e) => {
          const d = dragRef.current;
          dragRef.current = null;
          if (d && !d.moved) setMenuOpen((v) => !v);
        };

        const petBody = base64
          ? React.createElement('div', {
              className: 'dsh-pet-body',
              style: {
                width: dispW,
                height: dispH,
                backgroundImage: bg,
                backgroundSize: `${8 * 192 * frameScale}px ${9 * 208 * frameScale}px`,
                backgroundPosition: `-${frameIdx * 192 * frameScale}px -${row * 208 * frameScale}px`,
              },
              onPointerDown: onDown,
              onPointerMove: onMove,
              onPointerUp: onUp,
            })
          : React.createElement(
              'div',
              {
                className: 'dsh-pet-body',
                style: {
                  width: dispW,
                  height: dispH,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(24,24,27,0.72)',
                  borderRadius: 14,
                  fontSize: Math.round(sizePx * 0.4),
                  lineHeight: 1,
                },
                title: assetError ? '素材加载失败' : '加载中…',
                onPointerDown: onDown,
                onPointerUp: onUp,
              },
              React.createElement('span', null, assetError ? '⚠️' : FALLBACK_ICON[store.petId] || '🐾'),
              React.createElement('span', { style: { fontSize: 10, marginTop: 4 } }, activePet.name),
            );

        const statusBubble = React.createElement(
          'div',
          { className: 'dsh-pet-status' },
          React.createElement(
            'div',
            { className: 'line' },
            React.createElement('span', { className: 'dot', style: { background: meta.color } }),
            React.createElement('span', null, meta.zh),
          ),
          React.createElement('div', { className: 'phrase' + (notice ? ' notice' : '') }, notice || phraseRef.current.text),
        );

        const menu = React.createElement(
          'div',
          { className: 'dsh-pet-menu' },
          React.createElement('div', { className: 'title' }, '切换宠物'),
          React.createElement(
            'div',
            { className: 'pets' },
            PETS.map((p) =>
              React.createElement(
                'button',
                {
                  key: p.id,
                  className: 'pet-btn' + (store.petId === p.id ? ' active' : ''),
                  onClick: () => switchPet(p.id),
                },
                React.createElement('span', { className: 'emoji' }, p.emoji),
                React.createElement('span', { className: 'name' }, p.name),
              ),
            ),
          ),
          React.createElement('div', { className: 'divider' }),
          React.createElement('div', { className: 'title' }, '大小'),
          React.createElement(
            'div',
            { className: 'zoom-row' },
            React.createElement('input', {
              type: 'range',
              min: '0.6',
              max: '2.5',
              step: '0.1',
              value: store.zoom,
              onChange: (e) => setStore('zoom', parseFloat(e.target.value)),
            }),
            React.createElement('span', { className: 'zoom-val' }, sizePx + 'px'),
          ),
          React.createElement('div', { className: 'divider' }),
          React.createElement(
            'div',
            { className: 'actions' },
            React.createElement('button', { onClick: () => { setStore('enabled', false); setMenuOpen(false); } }, '隐藏'),
            React.createElement('button', { onClick: () => setPos(null) }, '重置位置'),
          ),
          React.createElement('div', { className: 'hint' }, '拖拽移动 · 点击开关菜单'),
        );

        return React.createElement(
          'div',
          { className: 'dsh-pet-wrap', style: wrapStyle, ref: wrapRef },
          !menuOpen && statusBubble,
          menuOpen &&
            React.createElement('div', {
              className: 'dsh-pet-backdrop',
              onPointerDown: () => setMenuOpen(false),
            }),
          menuOpen && menu,
          petBody,
        );
      }

      function SettingsPage() {
        useStoreTick();
        return React.createElement(
          'div',
          { className: 'dsh-pet-settings' },
          React.createElement(
            'label',
            null,
            '宠物',
            React.createElement(
              'select',
              { value: store.petId, onChange: (e) => setStore('petId', e.target.value) },
              PETS.map((p) => React.createElement('option', { key: p.id, value: p.id }, p.name)),
            ),
          ),
          React.createElement(
            'label',
            null,
            '大小（' + Math.round(BASE_SIZE * store.zoom) + 'px）',
            React.createElement('input', {
              type: 'range',
              min: '0.6',
              max: '2.5',
              step: '0.1',
              value: store.zoom,
              onChange: (e) => setStore('zoom', parseFloat(e.target.value)),
            }),
          ),
          React.createElement(
            'label',
            null,
            '显示宠物',
            React.createElement('input', {
              type: 'checkbox',
              checked: store.enabled,
              onChange: (e) => setStore('enabled', e.target.checked),
            }),
          ),
          React.createElement(
            'div',
            { style: { fontSize: 12, opacity: 0.7, lineHeight: 1.7 } },
            PETS.map((p) =>
              React.createElement('div', { key: p.id }, p.emoji + ' ' + p.name + '：' + p.personality),
            ),
          ),
        );
      }

      slots.inject('shell.overlay', () =>
        slots.register({ name: 'shell.overlay', id: 'dsh-pet', order: 200 }, () =>
          React.createElement(PetOverlay),
        ),
      );

      slots.inject('settings.section', () =>
        slots.register(
          { name: 'settings.section', id: 'dsh-pet-settings', order: 60, label: '宠物伙伴' },
          () => React.createElement(SettingsPage),
        ),
      );

      console.log('[pet-companion] client ready');
    },
};
