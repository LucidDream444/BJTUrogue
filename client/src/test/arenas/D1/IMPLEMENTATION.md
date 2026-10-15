# D1 实施记录与接口边界

2026-10-12。本次只在工作区实现，不提交、推送、部署。

## 实施前核对

已有 ActorModel/takeHit、DamageLedger、GameClock、Rng、EnemySystem.bulletContact/releaseBullet、JuiceDirector/Policy/SfxPool；combat 目录不存在。DebugGun 的 realNowMs 射击和 pointer+scroll 瞄准仅为测试示例，正式逻辑使用 nowMs 和 camera.getWorldPoint。DummyPlayer 自有 HP 仅用于原 D3 场子，正式玩家继承 ActorModel。

素材 1 挥剑；2 持枪射击；4 持枪跑动；8 徒手跑动。3 为方向总览和八张方向单帧；5、6 为整幅 UI 图，不直接裁成可交互控件。缺少受击、死亡专用动作；使用染色、轻量倾斜临时表现。Godot 导出说明不是切换引擎的要求。

## 实施前武器定位 / 初始平衡表

| ID / 名称 | 定位 | 单颗直击 | 每发颗数 | 冷却 ms | 速度 px/s | 散布全角 | 寿命 ms | 理论直击 DPS |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| pencil / 自动铅笔 | 稳定中距，复用 balance 基线 | 10 | 1 | 250 | 520 | 2° | 900 | 40 |
| chalk / 粉笔散射 | 近距覆盖，远距分散 | 7 | 5 | 750 | 420 | 34° | 650 | 46.67（全中） |
| stapler / 重型订书器 | 低频慢弹，单发高 | 45 | 1 | 900 | 260 | 1° | 1800 | 50 |

每发总直击 = 单颗伤害 × 弹丸数。肉盾的持续接触伤害另按敌人表 tickDamageRatio、maxTicksPerSource 派生，不能把直击 DPS 当肉盾实际 DPS。每次扣扳机产生发射编号，每颗弹丸拥有独立攻击编号；这样同发散弹不会被跨弹丸去重。这些都是试玩调参起点，未经手感试玩不能称已平衡。

## 最小共用改动

- core/assetManifest.ts 增加 D1 数据引用，core/d1AssetManifest.ts 只放清单、原始动画元数据与脚底锚点数据。沿用已有 preloadAssets/registerAnimations，无需加载 Godot 文件。
- test/ArenaBase.ts 的 ArenaDefinition.scene 从 ArenaBase 放宽为 Phaser.Scene（类型改动），允许独立正式玩家场子，保持旧场子不变。
- D1 通过 combat/EnemyBridge.ts 组合 EnemySystem 与既有 JuiceDirector，仅使用公开碰撞、生命周期与只读位置接口。跨域通知走总线。无敌人 AI/模型/关卡域修改。
- C1 清房/奖励事件先在 D1 的 CombatEvents 扩展中定义，不修改 core/events.ts；D2 接入方案见交付文档。

需团队评审：上述资源条目和场子类型的共享层补丁，以及 D1 事件扩展纳入 C1/C2 的正式冻结。补丁已经本地可审阅，未宣称取得全员确认。
