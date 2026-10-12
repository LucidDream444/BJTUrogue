# Phaser 3 性能与引擎事实

> 版本 v1.0 · 2026-10-12 · 当前由 D3 维护
> 对应《技术选型》§3「为什么是 Phaser」与 §11「风险与缓解」
>
> **本文的结论与网上流传的说法有多处冲突，那些冲突是重点。** 下文第 1 节逐条纠正了四个常见误解。

**适用范围**：`client/src/` 下的全部代码。尤其是「同屏数百实体」相关的部分。

## 0. 可信度分级 —— 先读这一节

本文每条结论都带标记，**不要把标记搞混**：

| 标记 | 含义 | 能不能写进提交的代码 |
|---|---|---|
| `[源码]` | 直接来自 Phaser **3.90.0** 官方 npm 包的 `src/`。文件路径可自行复核 | ✅ 可以，且优先信它 |
| `[实证]` | 有明确来源 URL，但**未读到原文**（调研时 WebFetch 被网络策略封禁） | ⚠️ 可以，但改代码前先自己验一次 |
| `[推断]` | 工程共识或调研者的推论，**无来源** | ❌ 必须自己用 Vitest 或浏览器实测**

**2026-10-12 调研时的环境限制**：能联网搜索、能访问 npm 镜像，但**无法打开任何网页正文**。
所以 `[源码]` 是本文最硬的部分；`[推断]` 部分请当作待办事项，不要当结论。

---

## 1. 先纠正四个常见误解

### ❌「必须自己钳制 delta，否则切标签页回来角色会瞬移穿墙」

**Phaser 3 已经替你钳制了。** `[源码]` `core/TimeStep.js`

- `minFps` 默认 5 → 单帧**理论上界 200 ms**；`targetFps` 默认 60 → 16.667 ms
- 失焦期间 `!inFocus` 为真 → delta 被钳到 `_target`（16.667 ms）
- 回焦时 `focus()` → `resetDelta()` → `_cooldown = panicMax = 120`，**接下来 120 帧继续钳**
- 若 delta > 200 ms → 替换成历史值；返回值恒为**最近 10 帧的平均**
- config key 是 **`deltaHistory`**（属性名才叫 `deltaSmoothingMax`）
- **Phaser 3 没有 `maxDelta` 这个属性**，网上说「maxDelta 默认 1000」是 Phaser 2 / CE 的说法

**但仍然必须自己做的两件事：**

1. **不要绕开 Phaser 的 delta。** 任何用 `performance.now()` 自己做差值的逻辑都会让上述保护完全失效。
2. **自己写死「单帧最多结算一次」的不变式。** 低端机掉到 20 fps 时 delta = 50 ms 是**合法**的，
   你不希望它变成 3 次伤害跳字、3 次受击音效。引擎的钳制是防止灾难，不是保证游戏语义。

### ❌「固定时间步需要自研」（《技术选型》§8 的说法）

**Arcade Physics 本来就是固定时间步。** `[源码]` `physics/arcade/World.js` L159–170
`fixedStep` 默认 **true**，`fps` 默认 **60**，靠 `_elapsed` 累积器 + `while` 循环推进。
（注意：`fixedStep` 为 false 时 `fps` 与 `timeScale` **两个属性都会被忽略**。）

> **本项目要做的是「游戏逻辑层的固定步」，不是物理层的。** 见第 4 节。

### ❌「用 SpriteGPULayer 能撑 140 万 sprite」

那是 **Phaser 4** 的特性（`SpriteGPULayer` / `TilemapGPULayer`）。`[源码]` 在 3.90.0 全量源码 grep
`SpriteGPULayer` / `GPULayer` **零命中**。而且那些 sprite **只存在于 GPU、不能点击、不能挂物理、不能交互**，
定位是背景装饰层 —— **对本项目的可交互敌人无用**。

> 顺带：Phaser 4 已发布（v4.2.1），**docs.phaser.io 现在默认展示 v4 文档**。
> 查 API 时务必确认左上角版本是 3.x，否则会抄到不存在的 API。

### ❌「Phaser 慢，同屏几百个就卡」

`[源码]` `physics/arcade/World.js` L319–355 的官方注释里**唯一的数量级建议**：

> 约 **5,000 个动态 body** 应被视为上限，超过就应关闭 RTree（`useTree = false`）。

本项目定位「数百量级」，离它有一个数量级余量 —— **照常开着 `useTree`**。
静态 body（墙、边界）永远走独立的 `staticTree` 且**不每帧重建**，永远享受全速搜索。

---

## 2. 对象池：三条会咬人的细节

`[源码]` `gameobjects/group/Group.js`

| 细节 | 源码事实 | 后果 |
|---|---|---|
| `maxSize` 默认 **-1 = 无上限** | `isFull()` 在 `maxSize === -1` 时**永远返回 false** | 不显式设 `maxSize` 的池**根本不封顶**，分裂这种生成风暴会一路涨到崩 |
| `get()` 找的是 **`active === false`** | 内部是 `getFirst(false, true, ...)` | 用 `setVisible(false)` 藏起来的对象**不会被复用**，池会静默失效 |
| `runChildUpdate: true` 时 | `preUpdate()` 每帧执行 **`children.entries.slice()`** | **每帧一次数组分配**。数百实体时是实打实的 GC 压力 |

**所以：**

```ts
// ✅ 池要显式封顶，回收时同时改 active 与 visible
this.pool = this.physics.add.group({
  classType: Enemy,
  maxSize: 400,          // ← 必须显式给，默认不封顶
  runChildUpdate: false, // ← 本项目的敌人 update 由外层统一调度，不用 Group 代劳
})

// ✅ 回收 / 唤醒：必须走 world 级 API，sprite 级的不够（见第 3 节）
spawn(sprite: Enemy, x: number, y: number) {
  sprite.setActive(true)
  sprite.setVisible(true)
  this.physics.world.add(sprite.body)      // ← 回加到 world.bodies，否则物理永远不动它
  sprite.body.reset(x, y)
}

despawn(sprite: Enemy) {
  this.pool.killAndHide(sprite)            // 改 active=false + visible=false
  this.physics.world.disableBody(sprite.body)  // ← 唯一真摘除，见第 3 节
}
```

> ⚠️ **唤醒时顺序无所谓，但 `world.add()` 不能省。** sprite 级的 `enableBody(true,x,y,true,true)`
> 只做 `body.reset()` + 改 `active/visible` + `body.enable = true`，**从不调 `world.add()`**——
> 用它唤醒一个被 `world.disableBody()` 摘除过的 body，结果是「看起来活了、物理完全不动」，
> 而且不报错。这是本项目最容易踩的一个坑。

**本项目的敌人调度不走 `Group.runChildUpdate`**，而是自己的「时间分片」调度器（见第 5 节）——
既避开每帧 `slice()` 分配，又能做错峰更新。

---

## 3. 实体回收：`body.enable = false` 是错的

`[源码]` `physics/arcade/World.js`

```js
// World.update() —— 注意 tree.load 不检查 enable
var bodies = this.bodies.entries
for (...) { if (body.enable) { body.preUpdate(willStep, fixedDelta) } }
...
if (this.useTree) { this.tree.clear(); this.tree.load(bodies) }   // ← 无条件

// disableBody() 才会真正摘除
disableBody: function (body) { this.remove(body); body.enable = false }
remove: function (body) {
  if (body.physicsType === DYNAMIC_BODY) { this.tree.remove(body); this.bodies.delete(body) }
}
```

| 做法 | 停 preUpdate | 从 `world.bodies` 移除 | 从 RTree 摘除 | 结论 |
|---|---|---|---|---|
| `setActive(false)` | ✅ | ❌ | ❌ | 只停了逻辑，物理成本照付 |
| `setVisible(false)` | ❌ | ❌ | ❌ | 只停渲染 |
| `body.enable = false` | ✅ | ❌ | ❌ | **仍留在 `world.bodies` 里，每步仍被 `tree.load()` 插进 RTree** |
| sprite 级 `sprite.disableBody(true, true)` | ✅ | ❌ | ❌ | **⚠️ 不够！** 源码只做 `body.stop()` + `enable=false` + 改 `active/visible`，**从不调 `world.remove()`** |
| **`physics.world.disableBody(body)`** | ✅ | ✅ | ✅ | **✅ 唯一真正移除物理成本的做法** |

`[源码]` 两处对照（`physics/arcade/components/Enable.js` L59–117 对 `physics/arcade/World.js` L552/L634/L654）：

```js
// components/Enable.js —— sprite 级，只碰 body 自己
disableBody: function (disableGameObject, hideGameObject) {
  this.body.stop()
  this.body.enable = false
  ...
}

// World.js —— world 级，才动容器与树
disableBody: function (body) { this.remove(body); body.enable = false }
remove: function (body) {
  if (body.physicsType === DYNAMIC_BODY) { this.tree.remove(body); this.bodies.delete(body) }
}
add: function (body) { if (body.physicsType === DYNAMIC_BODY) { this.bodies.set(body) } }
```

> **数百实体下，池中休眠的敌人走 `physics.world.disableBody(body)`。** 这是最低成本、最高收益的一项优化。
> 注意命名陷阱：**sprite 上和 world 上各有一个 `disableBody`，名字一样、做的事完全不同。**
> sprite 上那个是官方教程里「碰撞回调里删对象」用的，它可以安全地在回调内调用（不修改 world 的集合）；
> 想真正省物理开销必须用 world 那个。

> ⚠️ **另一个连带发现**：`World.update()` 的第一句是
> `if (this.isPaused || this.bodies.size === 0) { return; }`——**`bodies.size === 0` 也会让它整帧不跑**。
> 所以把场上所有 body 都 park 掉之后，**`WORLD_STEP` 一次都不会触发**。
> 挂在 `WORLD_STEP` 上的持续伤害账本、周期性逻辑会随之静默停摆。
> 本项目任何时候都有玩家 body 在场，暂时构不成问题；**但测试场里一个纯敌人的空白场景要留意。**

---

## 4. 持续伤害（帧伤）：挂 `WORLD_STEP`，不挂 `Scene.update`

`[源码]` `physics/arcade/World.js` —— `update()` 与 `step()` 都会 `emit(WORLD_STEP, fixedDelta)`，
**每次物理步恰好一次**，且带固定步长。

```ts
// ✅ 正确：逻辑 tick 与物理步严格对齐
this.physics.world.on(Phaser.Physics.Arcade.Events.WORLD_STEP, (fixedDelta: number) => {
  this.damageLedger.step(fixedDelta)
})

// ❌ 错误：挂渲染帧 delta
update(_time: number, delta: number) { this.damageLedger.step(delta) }  // 144Hz 屏伤害会翻倍
```

**为什么这是「帧伤」的正解**：Arcade 的 `overlap` / `collide` 回调
**没有 enter/stay/exit 语义，持续重叠时每一步都会触发**。`[源码]` `collideSpriteVsSprite`：
只要 `separate()` 返回 true 就调回调，而它在持续重叠的每一步都返回 true，**没有内建 once 参数**。

这对我们要的「接触即持续结算」**正合适**，但**是经典 bug 源**（同一帧结算 N 次）。所以必须：

```ts
// 伤害记账的三条不变式，写进代码并用 Vitest 锁死：
// 1. 每个 (攻击者, 目标) 配对，每 tick 最多结算一次 —— 用 Set<`${attackerId}:${targetId}`> 去重
// 2. 单帧最多推进一次 tick —— 即便 delta 是 50ms
// 3. 攻击源失效（子弹被回收/近战挥砍结束）时，清掉它的配对记录，否则池化复用后会串味
```

**另一个硬性要求**：**物理回调里只打标记，绝不在回调内销毁对象。**
`[源码]` 回调查询与集合修改同时发生会导致迭代器失效；官方教程在碰撞回调里删对象用的是
`disableBody(true, true)`，**从来不是 `destroy()`**。对本项目的**蜂群分裂**（一次物理步内连锁 1→2→8）
这是必须的 —— 分裂只入队，在 `update()` 末尾统一结算生成与回收。

---

## 5. 数百个敌人：三个优化，按收益排序

### 5.1 空间哈希做分离，别用朴素 O(N²)

朴素两两比较在 300 个实体时约 **45,000 次距离检查/帧**，且随分离半径平方增长。
`[实证]` 均匀网格适合**密集、尺寸相近**的对象 —— 正好是几百个分裂小怪。
**不要直接查物理的 RTree**：它装的是 `Body`，语义是物理宽相，且你无法控制查询半径。

```ts
// 每 tick 批量重建一次，O(N)，之后每个实体只查本格 + 邻格
hash.rebuild(agents)              // Map<cellKey, Agent[]>
const neighbors = hash.query(x, y, separationRadius)
```

### 5.2 AI 时间分片 + 距离 LOD，不要每帧更新所有敌人

`[实证]` UE 真实案例：30 个敌人时行为树 + 感知 **~8 ms/帧**（超半个帧预算），
优化到 3.5 ms，关键手法之一是**拉长 tick 间隔、避免所有 agent 同帧更新**。
`[实证]` AI LOD 的参考区间：**近距离 30 Hz → 远处 5 Hz**（最低档约 6× 削减）。

```ts
// 按索引错峰：每帧只更新 1/N，用 frameIncrement 偏移，避免所有实体在同一帧扎堆
if ((this.aiFrame + this.index) % this.aiStride !== 0) return
```

本项目具体策略：几百个分裂小怪里，只有**靠近玩家的少数**需要完整 AI（索敌、攻击前摇），
远处的只做直线移动。

### 5.3 占位纹理：注意 `generateTexture` 的 key 语义

`[源码]` `gameobjects/graphics/Graphics.js` —— **`generateTexture(key, w, h)` 在 key 已存在、
且源是 canvas 纹理时，是「往同一张 canvas 上再画一次」，不是替换、也不报错。**

```ts
// ❌ 危险：真图与占位图同名 key —— 真图会被白方块静默覆盖，且只在接入真美术时才暴露
g.generateTexture('enemy_splitter_t1_idle', 48, 48)

// ✅ 本项目的做法：占位图用独立 key `${真实key}__placeholder`，由清单层 resolveTextureKey() 解析
//    清单里 placeholder:false 时才去 load 真图
const placeholderKey = key + PLACEHOLDER_SUFFIX      // 'enemy_splitter_t1_idle__placeholder'
if (!textures.exists(placeholderKey)) {              // ← 查的是占位 key，不是真 key
  const g = this.make.graphics({ add: false })       // ← 不加入显示列表
  g.fillStyle(0xffffff, 1).fillRect(0, 0, w, h)
  g.generateTexture(placeholderKey, w, h)
  g.destroy()
}
```

> **为什么选独立 key 而不是「同 key + 守卫」**（本文件初版给的是后者，2026-10-12 修订）：
> 同 key 方案的失败模式是**静默且迟到**——真美术到位、漏掉一道守卫，真图被白方块盖掉，
> 不报错、不崩，等发现时早已没人记得上下文。
> 独立 key 的失败模式是**响亮且当场**：谁硬编码了真 key，占位期立刻显示 `__MISSING` 纹理。
> 用一次「开发期当场就看见」的报错，换掉一次「三个月后才发现」的静默失效，这笔买卖划算。
> 代价是必须走 `resolveTextureKey()`，由 `architecture.test.ts` 的字面量扫描兜住。

**更便宜的纯占位**：`this.add.rectangle(x, y, w, h, 0xffffff)` —— Shape GameObject，
**不需要任何 texture key、零分配**。代价是它是 Shape 不是 Sprite（不支持帧动画）。
**纯调试用 Shape，一旦要接动画/闪光/tint 就换纹理。**

> `Graphics.generateTexture` 的已知限制 `[源码]`：纹理由浏览器 Canvas API 创建，
> 所以 `fillGradientStyle` 这类 Graphics 特有特性**不会出现在结果纹理里**。

---

## 6. 受击音效：必须池化，否则会「掐断」

`[源码]` 两条，合起来决定了唯一正确的写法：

```js
// sound/webaudio/WebAudioSound.js —— 同一个实例反复 play() 会掐断上一个音
play: function (markerName, config) {
  ...
  this.stopAndRemoveBufferSource();     // ← 停掉当前 source
  this.createAndStartBufferSource();    // ← 新建一个重新开始
}

// sound/BaseSoundManager.js —— manager.play(key) 每次新建整个 Sound 对象
play: function (key, extra) {
  var sound = this.add(key)
  sound.once(Events.COMPLETE, sound.destroy, sound)   // 播完销毁
}
```

| 写法 | 能不能重叠 | GC 压力 | 结论 |
|---|---|---|---|
| 持有一个实例反复 `.play()` | ❌ 掐断上一个 | 低 | **❌ 连续命中音会断** |
| `this.sound.play(key)` | ✅ | **每次分配 + 销毁对象** | ⚠️ 低频可用，高频打击音不行 |
| **预建固定大小池 + 轮转** | ✅ | **零分配** | **✅ 唯一正解** |

```ts
// 池大小 = 每秒最大并发命中数 = 天然的节流阀
this.hitPool = Array.from({ length: 8 }, () => this.sound.add('sfx_hit'))
let cursor = 0
playHit() {
  const s = this.hitPool[cursor = (cursor + 1) % this.hitPool.length]
  s.play({ detune: Phaser.Math.Between(-200, 200) })   // ±2 个半音
}
```

- **`detune` 单位是音分**：1200 cents = 1 个八度，100 cents = 1 个半音
- `totalRate = rate × manager.rate × 2^(detune/1200)` `[源码]` `sound/BaseSound.js`
- **扰动音高只用 `detune`，别动 `rate`** —— 两者数学上等价、都会改变时长，但 `detune` 语义更贴「变调」
- `this.sound.detune` / `this.sound.rate` 是**全局**属性，会叠加到每个音效 —— 适合做慢动作时全体音调下压

---

## 7. 其他会咬人的

| 项 | 事实 |
|---|---|
| **粒子必须显式设上限** | `[源码]` `ParticleEmitter.maxParticles` 默认 **0 = 不限**。分裂时的死亡粒子会一路涨 |
| **`roundPixels` 默认 false** | `[源码]` 且有纹理的 GameObject 才受它影响，Graphics 这类无纹理对象忽略它 |
| **渲染器不用手选** | `[源码]` `renderType` 默认 `AUTO`，自动 WebGL、回退 Canvas |
| **场景生命周期** | 在 `create()` 里对外部事件源 `on()` 而 `shutdown` 里不 `off()` → **重启 3 次留 3 个 handler**。必须保存函数引用，匿名函数 `off()` 会静默失败 |
| **共享动画住在 game 级** | `AnimationManager` 跨场景存活，而播放回调属于场景实例。`create()` 里建动画前先查 key 是否存在 |
| **顿帧（hitstop）用 `world.pause()`，绝不用 `world.timeScale = 0`** | `[源码]` `World.js` L936：`update()` 第一句 `if (this.isPaused \|\| this.bodies.size === 0) return;`——**在 `_elapsed += delta` 之前就 return**，所以暂停期间不累积时间，恢复后不会追赶补步。而 `timeScale = 0` 会让 `msPerFrame = _frameTimeMS * timeScale` 变成 0，`while (_elapsed >= msPerFrame)` **永不退出**（死循环）。本项目顿帧 = `clock.freeze(ms)`（冻结只解决逻辑层，**不够**）+ `physics.world.pause()`（冻结物理积分、子弹位移、sprite 位置），到期两者一起恢复 |

---

## 8. 写代码前自问的清单

- [ ] 这个池**显式设了 `maxSize`** 吗？（默认无上限）
- [ ] 回收走的是 **`disableBody(true, true)`** 而不是 `body.enable = false`？
- [ ] 伤害 tick 挂在 **`WORLD_STEP`** 上，而不是渲染 delta？
- [ ] 有 **「每 (攻击者,目标) 每 tick 最多结算一次」** 的去重吗？有测试吗？
- [ ] 物理回调里**只打标记**，销毁/生成统一在 `update()` 末尾吗？
- [ ] 每帧是否更新了**所有**敌人？能不能错峰 / 降频？
- [ ] 分离力用**空间哈希**了吗？
- [ ] 高频音效走的是**固定池 + 轮转**吗？
- [ ] 粒子的 `maxParticles` 设了吗？
- [ ] 占位纹理与真资源的 **key 冲突**处理了吗？
- [ ] `scene.shutdown` 里把 `create()` 里 `on()` 的都 `off()` 了吗？

---

## 9. 实测优先于本文

以上都是静态事实与二手结论。**真正的瓶颈只能靠 profiler 找**，不要凭本文猜。

- 渲染 / 主线程：Chrome DevTools Performance 面板（火焰图里看 `step` / `update` / `render` 的占比）
- Phaser 内置：`game.loop.actualFps`、`physics.world._total`（本帧碰撞检测次数）
- 先量再改。**早期不做性能优化**（《技术选型》风险 R-T1 的结论）—— 本文提供的是「不要踩坑」，
  不是「提前优化」的许可。