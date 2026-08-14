/**
 * dsh-pet-companion — Client half.
 *
 * A floating pixel pet in the DeepSeek Harness Web GUI, modeled on OpenAI
 * Codex Pets. Renders the petdex-format spritesheet served by the Host half
 * (8 cols x 9 rows of 192x208 frames) and maps the Host state engine's
 * snapshot (idle | running | waiting | review | failed) onto animation rows.
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

const FRAME_MS = {
  idle: 180,
  'running-right': 130,
  'running-left': 130,
  waving: 160,
  jumping: 160,
  failed: 150,
  waiting: 160,
  running: 140,
  review: 160,
};

const PETS = [
  { id: 'pikachu', name: '皮卡丘 Pikachu' },
  { id: 'charmander', name: '小火龙 Charmander' },
];

const SIZES = { small: 64, medium: 96, large: 128 };

// module-scope store shared by overlay + settings page (re-render every tick
// picks changes up within ~100ms; no subscription machinery needed)
const store = {
  petId: 'pikachu',
  size: 'medium',
  enabled: true,
  pos: null, // { x, y } once dragged; null = default bottom-right
};

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
          image-rendering: pixelated;
          background-repeat: no-repeat;
          background-color: transparent;
        }
        .dsh-pet-body:active { cursor: grabbing; }
        .dsh-pet-backdrop {
          position: fixed;
          inset: 0;
          z-index: 9998;
          pointer-events: auto;
        }
        .dsh-pet-menu {
          position: absolute;
          bottom: calc(100% + 10px);
          right: 0;
          pointer-events: auto;
          min-width: 190px;
          padding: 10px 12px;
          border-radius: 10px;
          background: var(--dsh-pet-menu-bg, rgba(24, 24, 27, 0.92));
          color: var(--dsh-pet-menu-fg, #f4f4f5);
          box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
          font: 12px/1.6 system-ui, sans-serif;
          backdrop-filter: blur(8px);
        }
        .dsh-pet-menu h4 { margin: 0 0 6px; font-size: 12px; opacity: 0.85; font-weight: 600; }
        .dsh-pet-menu .row { display: flex; gap: 6px; align-items: center; margin: 4px 0; }
        .dsh-pet-menu button {
          flex: 1;
          padding: 4px 6px;
          border: 1px solid rgba(255, 255, 255, 0.18);
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.08);
          color: inherit;
          font: inherit;
          cursor: pointer;
        }
        .dsh-pet-menu button:hover { background: rgba(255, 255, 255, 0.16); }
        .dsh-pet-menu button.active { background: #f59e0b; color: #111; border-color: #f59e0b; }
        .dsh-pet-menu .hint { opacity: 0.55; font-size: 11px; margin-top: 6px; }
        .dsh-pet-settings { display: grid; gap: 10px; max-width: 360px; }
        .dsh-pet-settings label { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
        .dsh-pet-settings select { padding: 4px 6px; border-radius: 6px; border: 1px solid rgba(128,128,128,.4); background: transparent; color: inherit; }
      `);

      function PetOverlay() {
        const [sheet, setSheet] = React.useState(null);
        const [assetError, setAssetError] = React.useState(false);
        const [hostState, setHostState] = React.useState('idle');
        const [hostLabel, setHostLabel] = React.useState('Idle');
        const [frameIdx, setFrameIdx] = React.useState(0);
        const [menuOpen, setMenuOpen] = React.useState(false);
        const wrapRef = React.useRef(null);
        const dragRef = React.useRef(null);
        const animRef = React.useRef({ anim: 'idle', until: 0, nextRandomAt: Date.now() + 8000, acc: 0 });
        const hostStateRef = React.useRef('idle');

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
                  setHostLabel((s.label && (s.label.zh || s.label.en)) || s.state);
                }
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
                r.nextRandomAt = now + 12000 + Math.random() * 12000;
              } else if (r.anim !== 'idle' && now >= r.until) {
                r.anim = 'idle';
                r.acc = 0;
              }
            } else {
              r.anim = target;
              r.acc = 0;
            }

            const anim = r.anim;
            const count = FRAME_COUNT[anim];
            const dur = FRAME_MS[anim];
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

        const sizePx = SIZES[store.size] || SIZES.medium;
        const scale = sizePx / 192;
        const dispW = sizePx;
        const dispH = Math.round(208 * scale);
        const row = STATE_ROWS[animRef.current ? animRef.current.anim : 'idle'];
        const base64 = sheet ? sheet.dataBase64 : null;
        const bg = base64
          ? `url(data:image/png;base64,${base64})`
          : 'none';

        const wrapStyle = store.pos
          ? { left: store.pos.x, top: store.pos.y }
          : { right: 16, bottom: 16 };

        const FALLBACK_ICON = { pikachu: '⚡', charmander: '🔥' };
        const petBody = base64
          ? React.createElement('div', {
              className: 'dsh-pet-body',
              style: {
                width: dispW,
                height: dispH,
                backgroundImage: bg,
                backgroundSize: `${8 * 192 * scale}px ${9 * 208 * scale}px`,
                backgroundPosition: `-${frameIdx * 192 * scale}px -${row * 208 * scale}px`,
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
                  borderRadius: 12,
                  fontSize: Math.round(sizePx * 0.4),
                  lineHeight: 1,
                },
                title: assetError ? '素材加载失败：' + (sheet ? '' : '请检查 packs/ 目录') : '加载中…',
                onPointerDown: onDown,
                onPointerUp: onUp,
              },
              React.createElement('span', null, assetError ? '⚠️' : FALLBACK_ICON[store.petId] || '🐾'),
              React.createElement('span', { style: { fontSize: 10, marginTop: 4 } }, store.petId),
            );

        const onDown = (e) => {
          e.preventDefault();
          e.stopPropagation();
          const el = wrapRef.current;
          dragRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            baseX: store.pos ? store.pos.x : el.offsetLeft,
            baseY: store.pos ? store.pos.y : el.offsetTop,
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
          store.pos = {
            x: d.baseX + dx,
            y: d.baseY + dy,
          };
          if (parent) {
            const maxX = Math.max(0, parent.clientWidth - dispW);
            const maxY = Math.max(0, parent.clientHeight - dispH);
            store.pos.x = Math.min(Math.max(0, store.pos.x), maxX);
            store.pos.y = Math.min(Math.max(0, store.pos.y), maxY);
          }
        };

        const onUp = (e) => {
          const d = dragRef.current;
          dragRef.current = null;
          if (d && !d.moved) setMenuOpen((v) => !v);
        };

        return React.createElement(
          'div',
          { className: 'dsh-pet-wrap', style: wrapStyle, ref: wrapRef },
          menuOpen &&
            React.createElement('div', {
              className: 'dsh-pet-backdrop',
              onPointerDown: () => setMenuOpen(false),
            }),
          menuOpen &&
            React.createElement(
              'div',
              { className: 'dsh-pet-menu' },
              React.createElement('h4', null, 'Pet Companion'),
              React.createElement('div', { className: 'row' }, React.createElement('span', null, '状态:')),
              React.createElement('div', { className: 'row' }, React.createElement('b', null, hostLabel)),
              React.createElement('div', { className: 'row' }, React.createElement('span', null, '宠物:')),
              React.createElement(
                'div',
                { className: 'row' },
                PETS.map((p) =>
                  React.createElement(
                    'button',
                    {
                      key: p.id,
                      className: store.petId === p.id ? 'active' : '',
                      onClick: () => {
                        store.petId = p.id;
                        setSheet(null);
                        setFrameIdx(0);
                      },
                    },
                    p.name,
                  ),
                ),
              ),
              React.createElement(
                'div',
                { className: 'row' },
                React.createElement('button', { onClick: () => { store.enabled = false; setMenuOpen(false); } }, '隐藏宠物'),
              ),
              React.createElement('div', { className: 'hint' }, '拖拽移动 · 点击开关菜单'),
            ),
          petBody,
        );
      }

      function SettingsPage() {
        const [, force] = React.useState(0);
        const set = (k, v) => {
          store[k] = v;
          force((x) => x + 1);
        };
        return React.createElement(
          'div',
          { className: 'dsh-pet-settings' },
          React.createElement(
            'label',
            null,
            '宠物',
            React.createElement(
              'select',
              { value: store.petId, onChange: (e) => set('petId', e.target.value) },
              PETS.map((p) => React.createElement('option', { key: p.id, value: p.id }, p.name)),
            ),
          ),
          React.createElement(
            'label',
            null,
            '大小',
            React.createElement(
              'select',
              { value: store.size, onChange: (e) => set('size', e.target.value) },
              Object.keys(SIZES).map((s) => React.createElement('option', { key: s, value: s }, s)),
            ),
          ),
          React.createElement(
            'label',
            null,
            '显示宠物',
            React.createElement('input', {
              type: 'checkbox',
              checked: store.enabled,
              onChange: (e) => set('enabled', e.target.checked),
            }),
          ),
          React.createElement('button', { onClick: () => set('pos', null) }, '重置位置'),
        );
      }

      slots.inject('shell.overlay', () =>
        slots.register({ name: 'shell.overlay', id: 'dsh-pet', order: 200 }, () =>
          React.createElement(PetOverlay),
        ),
      );

      slots.inject('settings.section', () =>
        slots.register(
          { name: 'settings.section', id: 'dsh-pet-settings', order: 60, label: 'Pet Companion' },
          () => React.createElement(SettingsPage),
        ),
      );

      console.log('[pet-companion] client ready');
    },
};
