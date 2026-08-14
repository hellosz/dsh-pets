# Design: Pet Companion for DeepSeek Harness

## Context

DSH 是 Cordis 组合的 AI coding agent 系统，浏览器端为 Web GUI。插件通过 Cordis 的动态插件机制注入：Host 半区跑在 Node 进程（可监听 Host 事件、注册 `harness` RPC），Client 半区跑在浏览器页面（可注册 Slot UI、调用 `host.call`）。

调研结论（2026-05 Codex Pets 发布）：Codex Pets 把 agent 状态可视化为宠物行为状态——running（思考/写代码）→ 用户继续等待；waiting（需确认）→ 用户回去响应；ready for review（完成待审查）→ 用户查看 diff。社区生态 petdex（4521 个宠物）定义了宠物包标准：`pet.json` + 8×9 spritesheet（每帧 192×208），9 行对应 9 个状态（idle / running-right / running-left / waving / jumping / failed / waiting / running / review）。clawd-on-desk 等开源项目已验证该格式可跨工具复用。

已验证的 DSH 集成点（经 Inspect Provider 逐一确认）：
- Host 事件（emit 模式可监听）：`agent/status`、`agent/turn-stopping`、`agent/error`、`approval/request`、`tools/execute`、`tools/result`、`subagent/start`、`subagent/end`、`workflow/start`、`workflow/end`、`agent/session-start`、`session/created`、`session/disposed`
- Host RPC：`harness.handle(method, handler)`（Client→Host JSON RPC，无 Host→Client 主动推送）
- Client Slot：`shell.overlay`（list 类型，全屏浮动层，点击穿透、`replaceRisk: none`，注册键 `{id, order, label}`）、`settings.section`（list，设置页）
- Client 服务：`slots`、`timer`（interval/timeout/throttle/debounce）、`styles.insert`
- Client 内建：`React`（无 JSX）、`host.call`

约束：动态插件是进程级、临时性的，状态只存内存；Client 代码纯 JavaScript、无打包器；Host 与 Client 之间只走 JSON。

## Goals / Non-Goals

**Goals:**
- 宠物在 DSH Web GUI 中浮动显示，用行为动画反映当前会话的 agent 状态（Codex Pets 三状态模型 + petdex 九状态扩展）
- 内置皮卡丘、小火龙两个宠物包，素材来自已验证的 PokeAPI/Showdown 资源，动画可读、可爱
- 用户可切换宠物、开关宠物、拖拽位置
- 纯插件实现，零改动 DSH 核心，全部消费现有公开接口
- 项目开源到 GitHub，含文档与资源生成脚本，可复现

**Non-Goals:**
- 不做桌面端浮动宠物（那是 petdex desktop / clawd-on-desk 的地盘，本项目专注 DSH Web GUI 内嵌）
- 不做宠物的"养成/进化/孵化"玩法（Codex 的 hatch-pet 需要模型生成 spritesheet，超出 v1 范围，可作为 v2 方向）
- 不参与对话、不打断 agent 流程（与 Codex Pets 一致：宠物只做状态信号，不发言）
- 不做持久化配置（动态插件生命周期内内存态即可；开源版可加 localStorage 持久化）

## Decisions

### D1. 状态引擎在 Host，UI 在 Client，Client 轮询状态

**决策**：Host 监听全部相关事件，用状态机推导每会话的宠物状态，存内存 Map；Client 通过 `host.call('pet/state')` 轮询（timer interval ~600ms，throttle 控制）。

**理由**：事件都在 Host 进程（`agent/status` 等全部是 Host 事件），Client 拿不到；而 RPC 方向只有 Client→Host，没有 Host→Client 推送通道。600ms 轮询对宠物动画（帧间隔 100-300ms）完全够用，且比引入推送基础设施简单可靠。

**备选**：Client 订阅 `useSessions` snapshot 自己猜状态——不可行，会话快照不含工具执行/审批等瞬态事件；Host 端每事件推送到 Client——无现成推送 API，需要额外的 web socket 或事件总线，过度设计。

### D2. 状态优先级模型（确定性推导）

**决策**：每个会话维护一个带优先级的"当前状态 + 证据"：

```
waiting (approval/request) > failed (agent/error) > review (turn-stopping) > running (agent/status=running | tools/execute | subagent/start | workflow/start) > idle
```

同优先级取最近事件。`waiting` 触发后保持直到对应审批结束信号或 60s 超时；`review` 在 turn-stopping 后保持 8s 或直到新的 running 事件。

**理由**：Codex 三状态要解决的核心问题是"现在该做什么"——等待输入/审批的优先级必须最高，否则用户会错过确认。事件有重叠（一个 turn 里工具执行 + agent running 同时发生），优先级 + 最近事件规则避免状态抖动。

**备选**：完整状态机（每个事件显式转移）——事件组合爆炸，难维护；简单"最后一个事件决定状态"——审批等待会被后续工具事件覆盖，丢失关键信号。

### D3. 宠物包采用 petdex 兼容格式（pet.json + 8×9 spritesheet）

**决策**：内置宠物包用 petdex v1 格式：`pet.json`（`{id, displayName, description, spritesheetPath}`）+ spritesheet（8 行 × 9 列，每帧 192×208），行序与 petdex 状态定义一致（idle=0, running-right=1, running-left=2, waving=3, jumping=4, failed=5, waiting=6, running=7, review=8）。

**理由**：这是 Codex 生态事实标准（petdex 4521 个宠物、clawd-on-desk 等 21 个项目兼容），采用它意味着：① 未来可直接支持导入社区宠物包；② 格式规范已被社区验证（帧时长表、行序都在 petdex 仓库开源）；③ 我们生成的包别人也能用，利于开源生态。

**备选**：自定义 JSON + 逐状态 GIF——实现简单但孤岛，无法复用生态资源；直接用原始 GIF——状态不全（只有 idle），且无法表达九状态语义。

### D4. 内置包动画：真实帧 + 程序化派生

**决策**：idle 状态用第五世代官方动画 GIF 的真实帧序列（PokeAPI `generation-v/black-white/animated/25.gif`，已验证）；其余状态由静态精灵程序化派生：running-left/right = 水平翻转 + 逐帧位移；jumping = 垂直弹跳位移；waving = 旋转摆动；failed = 灰度/蓝色调 + 抖动；waiting = 呼吸缩放；running = 原地上下弹；review = 轻微倾斜脉动。生成脚本（Node + ImageMagick/sharp）写入仓库，可复现。

**理由**：官方只有 idle 动画帧可用；手绘 9 状态 × 8 帧 × 2 只宠物工作量过大且非目标。程序化派生保证 9 状态齐全、风格统一、可复现。

**备选**：只用静态图 + CSS 变换做动画——浏览器里省事但状态语义弱（无法表达"running"与"idle"的行为差异）；逐帧手绘——超出 v1 范围。

### D5. UI 注册 `shell.overlay`，点击穿透 + 可拖拽

**决策**：宠物组件注册到 `shell.overlay`（list、`replaceRisk: none`、全屏浮动层、默认点击穿透）。组件根元素默认 `pointer-events: none`，仅宠物本体 `pointer-events: auto`（可拖拽、可点击弹出状态气泡/菜单），不遮挡底层界面。默认位置右下角，可拖拽记忆（内存态）。

**理由**：该 Slot 是官方为"badge/toast/status pill"准备的 additive 座位，目的完全匹配；点击穿透语义避免干扰主界面。

**备选**：`sidebar.footer.action`（太小）、`conversation.session.header.actions`（会话级、位置受限）、替换 `root`/`conversation`（replaceRisk 高，会遮蔽出厂 UI，禁止）。

### D6. 状态气泡与宠物切换 UI

**决策**：点击宠物弹出小菜单：当前状态标签（中/英）、宠物切换（皮卡丘/小火龙）、开关、拖动提示。注册 `settings.section` 提供完整设置页（宠物选择、大小滑块、开关、位置重置）。

**理由**：`shell.overlay` 是全局浮动层，不适合放完整设置表单；`settings.section` 是官方设置页入口，二者职责分离。

## Risks / Trade-offs

- [程序化派生动画可能不够"官方"→ 以 idle 真实帧为质量锚点，派生状态用大位移/色调保证语义可读；生成脚本开源可被社区替换为手绘帧]
- [轮询 600ms 有 ~1 帧延迟 → 动画帧 100-300ms，人类感知无差异；且用 throttle+只发增量，开销可忽略]
- [事件流未来变动导致状态推导失效 → 全部监听通过 `ctx.on` 注册、随插件卸载；状态机对未知事件降级为 idle，不抛错]
- [宠物动画造成视觉干扰（Codex 用户评测 3.2/5 分项）→ 默认小尺寸（~96px）、可一键隐藏、设置页可调大小]
- [皮卡丘/小火龙素材版权 → 仅内置程序化派生的像素精灵（PokeAPI 社区惯例、官方艺术图不内置），README 说明来源与替换方式]

## Migration Plan

- v1 作为动态插件（cordis_define/cordis_run）在会话内交付验证；验证通过后整理为可安装的插件包目录（含 `package.json`/README）推送到 GitHub 开源。
- 回滚：`cordis_stop` / `cordis_undefine` 即完全移除，无持久化副作用。
- 开源版安装方式：克隆仓库 → 用 DSH 动态插件机制加载（README 提供步骤），或按 DSH 插件目录规范安装。

## Open Questions

- 是否 v1 就支持导入外部 petdex 宠物包（manifest API 直连）？——倾向 v1.1，v1 先锁定内置双包，避免范围膨胀。
- 是否要做多会话聚合（多个并发会话显示多个宠物）？——v1 显示当前激活会话的状态；多宠物是 v2 方向。
- GitHub 仓库名与账号归属——实现完成后与用户确认并推送。
