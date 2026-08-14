# Tasks: Add Pet Companion

## 1. Asset Generation

- [x] 1.1 编写资源生成脚本 `scripts/generate-packs.js`：从本地 `sprites/` 目录读取皮卡丘/小火龙素材，解码第五世代 idle GIF 帧，程序化派生其余状态帧，输出 petdex 格式 spritesheet（8×9 网格，每帧 192×208）
- [x] 1.2 为每只宠物生成 `pet.json`（id / displayName / description / spritesheetPath）与 spritesheet，输出到 `packs/pikachu/` 与 `packs/charmander/`
- [x] 1.3 验证生成的 spritesheet：尺寸为 192×208 的整数倍、9 行帧数符合规范（idle 6 / running-right 8 / running-left 8 / waving 4 / jumping 5 / failed 8 / waiting 6 / running 6 / review 6）、背景透明

## 2. Plugin Host Half（状态引擎）

- [x] 2.1 实现状态引擎：内存 Map 按会话维护状态，事件映射（approval/request→waiting、agent/error→failed、agent/turn-stopping→review、agent/status=running→running、tools/execute+result→running、subagent/workflow start→running、空闲→idle），优先级 waiting > failed > review > running > idle，最近事件优先
- [x] 2.2 注册 `harness.handle('pet/state')` RPC：返回 `{sessionId, state, label, petId, revision}` 只读 JSON 快照；revision 单调递增
- [x] 2.3 注册 `harness.handle('pet/config')` RPC：读取/更新宠物选择与开关（内存态）
- [x] 2.4 生命周期清理：所有 `ctx.on` 监听随插件停止/更新移除；`session/disposed` 清理对应会话状态

## 3. Plugin Client Half（宠物 UI）

- [x] 3.1 注册 `shell.overlay` Slot 条目（唯一 id，如 `dsh-pet`），渲染浮动宠物；外层点击穿透、宠物本体可交互
- [x] 3.2 实现 spritesheet 动画渲染器：按状态行 + 帧表（帧数/帧时长）推进帧，`image-rendering: pixelated`，透明背景
- [x] 3.3 实现状态轮询：`timer` interval ≤600ms + throttle 调 `host.call('pet/state')`，状态变化切换动画行
- [x] 3.4 实现拖拽与视口钳制、位置内存记忆（默认右下角）
- [x] 3.5 实现点击菜单：状态标签、宠物切换（皮卡丘/小火龙）、开关、拖动提示；点击外部关闭
- [x] 3.6 注册 `settings.section` 设置页：宠物选择、尺寸（小/中/大）、开关、重置位置

## 4. 集成验证

- [x] 4.1 用 `cordis_define` 定义插件（Host + Client），`cordis_run` 激活并在浏览器验证宠物渲染
- [x] 4.2 触发真实事件验证状态切换：发起长任务（running）→ 触发审批（waiting）→ 回合结束（review）→ 出错（failed），确认动画行随状态切换
- [x] 4.3 验证开关/切宠物/拖拽/设置页功能，验证 stop 后无残留监听与 UI

## 5. 开源发布

- [x] 5.1 整理仓库结构：插件源码 + `packs/` 资源 + `scripts/` 生成脚本 + README（安装/使用/宠物包格式说明）+ LICENSE（MIT）
- [x] 5.2 `git init` 提交全部内容，与用户确认 GitHub 账号与仓库名后推送
- [x] 5.3 更新 openspec change 状态（验证 tasks 全部完成），归档 change
