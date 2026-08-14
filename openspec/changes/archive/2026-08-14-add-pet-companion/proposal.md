# Add Pet Companion to DeepSeek Harness

## Why

DeepSeek Harness (DSH) 是运行在浏览器中的 AI coding agent，长任务执行期间用户无法直观感知 agent 当前状态（思考中 / 等待输入 / 已完成待审查）。OpenAI Codex Pets 验证了一种新 UX 范式：**用宠物的行为状态代替进度条**——3 个核心状态（running / waiting / ready for review）分别对应开发者的 3 个动作（继续等待 / 回去响应 / 查看 diff），比盯着进度条直观得多。本项目把这一产品逻辑移植为 DSH 的 Cordis 插件，内置皮卡丘与小火龙宠物（用户指定的媒体资源），让 DSH 用户获得同样的状态感知体验。

## What Changes

- 新增一个 Cordis 动态插件（Host + Client 双端），运行时注入 DSH Web GUI，无需修改 DSH 核心。
- **Host 端：宠物状态引擎**——监听 DSH 现有事件（`agent/status`、`agent/turn-stopping`、`agent/error`、`approval/request`、`tools/execute`、`tools/result`、`subagent/start`、`subagent/end`、`workflow/start`、`workflow/end`），推导出每个会话的宠物状态，通过 Package-private RPC（`harness.handle`）暴露给 Client。
- **Client 端：浮动宠物 UI**——注册到 `shell.overlay` Slot（全屏浮动层，点击穿透，`replaceRisk: none`），宠物悬浮在界面角落，按状态播放对应动画帧；支持拖拽、点击切换宠物、显示当前状态气泡。
- **宠物状态模型**（对齐 Codex Pets 三状态 + petdex 生态 9 状态）：
  - `idle`：空闲呼吸/眨眼
  - `running`：agent 思考/写代码/工具执行中（对应 Codex "running"）
  - `waiting`：等待用户输入或审批（`approval/request`，对应 Codex "waiting for input"）
  - `review`：回合结束待审查（`turn-stopping`，对应 Codex "ready for review"）
  - `failed`：出错
  - `waving`/`jumping`：注意/庆祝
  - `running-left`/`running-right`：方向跑动
- **宠物资源包（pet-pack）**：采用社区标准格式（petdex 兼容：`pet.json` + 8×9 spritesheet，每帧 192×208），内置皮卡丘和小火龙两个包；动画帧从已验证的 PokeAPI / Pokemon Showdown 资源生成（idle 用第五世代 GIF 真实帧，其余状态由静态精灵派生）。
- **设置入口**：注册 `settings.section` 设置页，可切换宠物（皮卡丘/小火龙）、开关宠物、调节大小与位置。

## Capabilities

### New Capabilities

- `pet-state-engine`: Host 端事件监听与状态推导——把 DSH 生命周期事件映射为宠物状态机，按会话维护当前状态，通过 Package-private RPC 暴露只读状态快照。
- `pet-display`: Client 端浮动宠物 UI——`shell.overlay` 悬浮宠物、按状态播放 spritesheet 动画、拖拽/点击交互、状态气泡与宠物切换。
- `pet-packs`: 宠物资源包格式与内置包——petdex 兼容的 `pet.json` + spritesheet 规范、内置皮卡丘/小火龙包、包内状态→动画帧映射表。

### Modified Capabilities

（无——不修改 DSH 现有 spec，仅消费现有 Events/Slots/harness 接口。）

## Impact

- **代码**：新增独立插件包（`dsh-pet-companion`），Host 逻辑 + Client UI + 资源生成脚本；不触碰 DSH 核心源码。
- **接口依赖**：Host 消费 DSH 事件（emit 模式监听）、`harness.handle` RPC、Client 的 `slots`/`timer` 服务、`shell.overlay`/`settings.section` Slot、`styles.insert`。均为现有公开接口。
- **资源**：皮卡丘（#25）、小火龙（#4）素材来自 PokeAPI/sprites（MIT 友好，社区广泛使用）与 Pokemon Showdown 动画精灵（已逐条验证 HTTP 200）；成品 spritesheet 为程序化派生（翻转/位移/色调），作为插件的开源内置资产。
- **风险**：动画帧为程序化派生，非官方动作逐帧手绘，质量以"可爱可读"为目标；宠物状态为尽力推导，不阻塞、不篡改任何 DSH 事件流（全部 emit 监听，无 waterfall 干预）。
