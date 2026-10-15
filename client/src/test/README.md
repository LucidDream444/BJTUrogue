# 白箱测试场

> **这份文档是写给「别人家的 AI」看的。**
> 你的 AI 助手如果不知道这套约定，它会按自己的习惯把测试代码散在域目录里、
> 会去改 `main.ts`、会为了让自己的场子能跑而改别人的文件。
> **在这份仓库里用 AI 之前，先把这一页丢给它。**
> 一句话版本：**「测试场都在 `client/src/test/arenas/` 下**你自己的域文件夹**里，
> 抄 `arenas/_ArenaTemplate.ts`，不要改 `main.ts`，不要改任何别的文件。」**

## 〇、把下面这段整个复制给你的 AI 助手

（用 Cursor / Copilot / 通义灵码 / 什么别的工具都一样 —— 约定与工具无关。）

````text
这个仓库的游戏客户端在 client/，约定文件是根目录的 AGENTS.md，先读它。
我们要加/改一个白箱测试场。测试场的全部约定在 client/src/test/README.md，也要读。

硬性要求，请严格遵守：
1. 测试场一律放在 client/src/test/arenas/ 下、**你自己那个域文件夹里**，
   一个文件一个场子。**先建自己的文件夹**：arenas/D1/、arenas/D2/、arenas/D3/、
   arenas/D4/（一人一个，别往别人的文件夹里放，也别放在 arenas/ 顶层）。
   做法是复制 client/src/test/arenas/_ArenaTemplate.ts（模板文件名带下划线，
   不进菜单），放进你自己的文件夹、去掉文件名开头的下划线，再改。
   ⚠️ 文件名要**全局唯一**（跨文件夹也算）：id 取的是文件名、不含文件夹，
   两个域各有一个 basic_hit.ts 会当场报错。名字带点域色彩（d1_weapon_swing）就不会撞。
   ⚠️ 想在自己文件夹里放**不是场子**的 .ts（工具函数、假数据、类型），
   文件名加下划线开头（_helpers.ts）。不加的话它会被当成一个场子、
   因为「没有导出 arena」把**所有人**打开测试页时都炸掉。
2. 不要改 main.ts、不要改 index.html、不要改任何其他域的文件。
   新场子靠 registry.ts 里的 import.meta.glob 自动注册，不需要你来注册。
3. 场子继承 client/src/test/ArenaBase.ts 的 ArenaBase，只实现三个方法：
   configure()（必填）、onArenaCreate(ctx)、onArenaUpdate(dt, ctx)。
   后两个必须写 protected override，漏了 override 会编译不过（TS4114）。
4. 白箱：不许引入美术资源。用白色方块 + 文字，需要标注就用 this.add.text()。
5. 一切数值（血量、速度、伤害、冷却）都从配置表读，不许写死在代码里
   （client/public/config/*.json，通过 ctx.bundle / ctx.tune 拿）。
   这是项目红线，写死等于每改一次平衡就要重新构建。
6. 不要 import 别人的域的内部实现，跨域只走事件总线（ctx.bus）。
   **你自己那个域可以**（D1 的场子可以 import domains/combat，D2 的可以 import
   domains/procgen……）—— 这一条由 architecture.test.ts 按**文件夹名**检查：
   arenas/D3/ 下的场子只许碰 domains/enemies。别的域一律走总线。
7. 写完把这几条跑一遍并确保干净：
   cd client && npm run typecheck && npm test -- --run && npm run lint
8. 但这三条全绿**不等于场子能跑** —— 测试场里绝大部分失败是运行时的，静态检查看不见。
   所以最后必须真的打开一次 http://localhost:5173/test.html?arena=<你写的场子id>，
   先确认 HUD 第一行 frame 在涨。没有图形界面就按 README 第九节用 headless 截图。
   **报告结果时要说清是「跑过了」还是「只跑了静态检查」，不要把后者说成前者。**
9. 美术资源：测试场里一个都不许加（见第 4 条）。真要加美术是各域自己的事，规则在
   AGENTS.md 第六节 + client/public/assets/README.md：图片/音效统一放
   client/public/assets/ 下按目录分层，代码里不许出现硬编码路径或 texture key，
   一切经 client/src/core/assetManifest.ts 的 ASSETS 清单引用
   （imageUrl() / audioUrls() 拼相对路径）。

在这个基础上，帮我做一个测试场：<在这里写你想要什么>
````

---

## 一、怎么跑

```bash
cd client
npm run dev
```

- 游戏本体：<http://localhost:5173/>
- **测试场：<http://localhost:5173/test.html>**
- 直接进某个场子：<http://localhost:5173/test.html?arena=tank_grind>

现在是哪几个场子（都在 `arenas/D3/` 里）：

| id | 名字 | 看什么 |
|---|---|---|
| `basic_hit` | 基础命中 | 一只分裂怪 + 一只肉盾，空地。一枪一个 / 子弹穿透 / 顿帧 / 闪屏 |
| `splitter_chain` | 分裂链 | 三只一代 = 33 杀。第 5 杀闪屏、出生间隔、`ledger` 归零 |
| `tank_grind` | 肉盾磨血 | 肉盾 + 带 160px 缺口的墙。帧伤 tick、音效限频、音高、减速、绕路 |
| `swarm_stress` | 压力场 | 150+ 只怪铺满场。`queue` 排空、`moving` 不掉、`ai near/far` 比例、`frame` 不停。**默认那批是第三代 —— 不打爆了也不分裂，设计如此**；按 `G` 换成第一代就能看分裂链 |

### 场子按域分文件夹：`arenas/D1/` `arenas/D2/` `arenas/D3/` `arenas/D4/`（+ 跨域的 `joint/`）

**一人一个文件夹，放自己的场子。** 底座和模板是共用的，在 `arenas/` 顶层和 `test/` 顶层；
场子本身各自归各自。

```
src/test/
├── ArenaBase.ts  Hud.ts  DummyPlayer.ts  DebugGun.ts  ArenaMenu.ts
├── registry.ts  arenaCatalog.ts          ← 自动收场子，加场子不用改这里
└── arenas/
    ├── _ArenaTemplate.ts                 ← 共用模板（下划线开头，不进菜单）
    ├── D3/                               ← D3 的场子
    │   ├── basic_hit.ts  splitter_chain.ts  tank_grind.ts  swarm_stress.ts
    │   └── （D1 / D2 / D4 各建自己的）
    └── joint/                            ← 跨域联调（见下）
        └── d1d2_rooms.ts
```

文件夹**只影响谁的东西在哪儿，不影响 URL**：id 取的是文件名，
所以 `arenas/D3/tank_grind.ts` 还是 `?arena=tank_grind`，
菜单里的顺序也是按文件夹排的（同一个域的场子天然挨在一起）。

⚠️ 代价是**文件名要全局唯一**，跨文件夹也算 —— 撞了会当场抛，
并且把两个文件的路径都印出来（见 `arenaCatalog.test.ts` 里那条用例）。

**`joint/` 是唯一的例外，且只为联调存在。** 场子的货就是「两个域接在一起」时，
它按定义要同时 import 两个域 —— 放进任何一边的文件夹都会当场红
（`architecture.test.ts` 按文件夹对账「这个域的场子只许 import 自己那个域」）。
`joint/` 每一行在 `ARENA_FOLDER_DOMAINS` 里写清它碰哪几个域（`joint: ['combat', 'procgen']`）。
**这一行是例外、不是先例**：新场子照旧按自己的域放；要来加行的人先问一句
「这个场子是不是只为联调存在」，不是的话它就不该在这里。

## 二、操作

| 键 | 干什么 |
|---|---|
| `WASD` / 方向键 | 移动（假玩家） |
| 左键按住 | 连射 |
| 右键按住 | 挥砍（贴住肉盾看帧伤） |
| 空格 | 暂停 / 继续 |
| `I` | 无敌开关 |
| `0` | 清场（走完整的死亡流程，会触发分裂） |
| `R` | 复位（重启场景） |
| `Esc` | 回菜单 |
| 菜单里数字键 / 点名字 | 进场子 |

> 音效要等你**先点一下**才会响 —— 浏览器不许页面自动出声，所有浏览器通用。
> 「音效没响」最常见的原因是这一条，不是音效坏了。

## 三、加一个自己的场子（三步，不用改别人的文件）

```bash
cd client
mkdir -p src/test/arenas/D1                                   # 1. 建自己的域文件夹（D1/D2/D3/D4）
cp src/test/arenas/_ArenaTemplate.ts src/test/arenas/D1/我的场子.ts   #    复制进去，去掉文件名的下划线
```

2. 打开它，改 `configure()`（开局刷什么、有没有墙）、可选的两个钩子、以及底部的
   `displayName` / `description`。
3. 刷新 `/test.html`。**它已经在菜单里了。**

不需要注册、不需要 import 任何东西、不需要改 `main.ts`、不需要改 `registry.ts`。
`registry.ts` 用 `import.meta.glob` 自动收 `arenas/` **及其子文件夹**里的每个 `.ts`。

**文件夹名就是域（`D1`/`D2`/`D3`/`D4`）**，架构测试按它对账：`arenas/D1/` 里的场子
只许 import `domains/combat`，`arenas/D3/` 的只许 import `domains/enemies`，以此类推。
`joint/` 是例外：它按定义要碰两个域，允许哪几个写在表里（见 §一 末尾）。
**新建一个域文件夹（含 `joint/`）就必须在 `architecture.test.ts` 的 `ARENA_FOLDER_DOMAINS`
表里加一行** —— 否则那条测试会红，而且会告诉你缺的是哪个文件夹。

**文件名以 `_` 开头的不进菜单** —— 所以模板自己不会出现在里面，
你自己的 `_helpers.ts` 也不会。

### 三条硬要求（`AGENTS.md` §五）

1. **所有测试场都在 `client/src/test/` 下、按域分的文件夹里**，不许散到各域目录里。
   理由不是洁癖：五个域各写各的，散着放的话，别人找自己场子的时候会先撞见一堆不认识的文件；
   不按域分的话，两边的场子混在一个名字空间里（见 §一「场子按域分文件夹」）。
2. **加一个场子不许改任何别的文件**（包括 `main.ts`）。
   这条会由 `architecture.test.ts` 守护：`src/test/` 之外的代码 import 测试场会测试失败。
3. **测试场绝不能变成产品的运行时依赖。**
   `index.html` 走 `src/main.ts`，`test.html` 走 `src/test/launcherMain.ts` ——
   两个独立入口，产品的产物里根本不存在测试场这份代码。
   （`npm run build` 之后可以自己验：`dist/assets/main-*.js` 里搜不到任何场子的名字。）

## 四、白箱是什么意思

**没有美术也要看得懂。** 当前没有任何美术资源，一切是运行时生成的白色方块 + 文字。
形状由 `src/core/assetManifest.ts` 的占位纹理决定（不同代数/种类的方块大小不同，
所以「谁是几代」用眼睛能分出来）。

需要额外标注就自己 `this.add.text(...)`。

## 五、HUD 上那些数字（**这一节是重点**）

屏幕左上角那几行是**「坏掉时看不出来」的量的直接读数**。
测试场的价值不在于「跑起来了」，在于**它能暴露的失败模式**。

| 读数 | 它坏掉的样子 |
|---|---|
| `fps` | 掉帧会让一帧内的物理补步变多 —— 帧伤次数、AI 次数都会跟着变 |
| `frame` | **不涨 = 物理世界空了**。`World.update()` 第一句是 `bodies.size === 0` 就 return，一个 body 都没有时 `WORLD_STEP` 不再触发，敌人系统**静默假死** |
| `enemies alive / pool` | `alive` 掉到 0 而 `pool` 还停在高位 = 有人 `park()` 了却没还回池子 |
| `moving` | **一只都不动（行尾会标 ⚠️）= 速度意图没落到物理体上。** 读的是物理体速度而不是 `velIntent`，所以「AI 算得好好的、怪却不动」这种 bug 只有这个数看得出来。密集刷怪时它会比 `alive` 少最多 8（当帧刚出生的要下一帧才被算进来），**别拿两个数相等当判据** |
| `world bodies / steps` | `bodies` 是 0 或世界被暂停 = 和 `frame` 不涨是同一件事，但这两行能区分是哪一种 |
| `queue` | 一直涨 = 出生队列在漏（同帧几百只怪挤进物理世界）；一上来就是 0 = 队列被绕过了 |
| `ai near / far` | 两个数差不多大 = 降频没生效，远处那批怪的 AI 结果每帧都在被算然后丢掉 |
| `ledger pairs` | **停手之后该回到 0。** 只涨不落 = 有人忘了 `releaseBullet()` / `releaseMelee()`，那种泄漏**没有任何报错** |
| `juice hitstop budget` | 一直是 0 = 顿帧预算比例配错了，所有顿帧都被降档吃掉了 |
| `juice trauma` | 不衰减 = 画面会一直抖到通关，而从画面上分不出「抖得对」和「没在衰减」 |

**这几种失败模式有个共同点：短时间测试永远碰不到。**
所以要把条件摆出来（人多 / 有墙 / 打很久），再把那个数字显示出来。

## 六、底座给了你什么

`ArenaBase`（`src/test/ArenaBase.ts`）已经建好了每个场子都要的那一坨。
你继承它，只需要回答三个问题：

| 方法 | 回答什么 |
|---|---|
| `configure()` | **必填**。世界多大（固定 1280×720）、有没有墙、开局刷什么 |
| `onArenaCreate(ctx)` | 可选。还需要什么（订阅事件、加自己的显示对象）。要写 `protected override` |
| `onArenaUpdate(dt, ctx)` | 可选。每帧额外干什么（持续刷怪、统计）。要写 `protected override` |

`ctx` 里有：`scene` / `enemies` / `bus` / `clock` / `bundle`（配置表）/ `gun` / `player` / `hud` / `world` / `tune`。

`ctx.tune` 是几个常用配置读数（子弹伤害、玩家速度……），省得每次都 `bundle.balance.bullet.damage`。

### ⚠️ 四条会咬人的

1. **`configure()` 里刷怪的 `x`/`y` 要么都给、要么都不给。** 只给一个是场子写错了，
   底座会当场抛 —— 因为「默默随机撒点」会让「我明明设了坐标」看起来只是「运气不好撒歪了」。
2. **墙是有代价的：给了墙就会生成一张 BFS 寻路网格。**
   而且寻路的格子是 **80px** 的粗格 —— 留通道要留**至少两格（160px）**，
   否则它会被判成不可走，怪会贴着墙蹭。`tank_grind` 里那个 160px 的缺口就是为这个留的。
3. **撒点用 `this.randomPoint()`，别自己按格子算坐标。**
   它会避开墙。自己算的话迟早会把一批怪生在柱子里，而「卡在柱子里的怪」
   看起来和「寻路坏了」一模一样。
4. **场子自己持有 `CombatSession` 时（`arenas/D1/`、`joint/` 那种），`R` / `N` / `ESC`
   要「先还东西，再关场景」。** 把 `session.destroy()` 放进 `SHUTDOWN` 监听器里**不行**：
   Phaser 的 `UpdateList.shutdown` 排在场景自己的监听器**前面**，它会 `destroy(true)` 掉
   场景里每个注册过 `preUpdate` 的对象（`StageColliders` 那个 `StaticGroup` 就在其中）；
   组一销毁 `children` 就成了 `undefined`，随后 `StageColliders.clear()` 里的 `group.remove()`
   当场抛，异常从 `Systems.shutdown()` 冲出 `Game.step()` —— **rAF 不再排帧，整页只剩一张
   静止的图**，只有刷新能救（症状看起来像「游戏崩了」，其实是一条顺序问题）。
   顺序反过来（趁场景还活着先 `destroy()`，`SHUTDOWN` 里那一步自然成了空操作）就没事 ——
   D1 的 `BattleScene.restartDifficulty()`、`joint/d1d2_rooms` 的 `R` / `N` / `ESC` 都是这么写的。
   继承 `ArenaBase` 的场子不受影响（它们没有 `CombatSession`）。
   （这就是 `docs/Phaser3性能与引擎事实.md` §7 那条「`SHUTDOWN` 里做清理时引擎已经先拆过一遍了」
   的又一个实例 —— 那条读一遍，比在这里重学一遍便宜。）

## 七、测试场里那个「玩家」不是玩家角色

`DummyPlayer` 是一个白色方块 + 一个满足 `TickTarget` 的伤害模型。
它够敌人追、够肉盾砸、够挨打就行。**玩家角色归 D1**，别把这里的任何东西搬进产品代码 ——
它的判定是「圆 vs 圆」，而真玩家的受伤、无敌帧、击退全归 D1。

同理，`DebugGun` **不是武器系统**（武器和武器表归 D1）。
它存在的唯一理由是：肉盾与分裂怪的手感都要靠「打」才能验证，而 D1 还没接上。

**`DebugGun` 里没有任何 `if (enemy is tank)`。** 肉盾的穿透完全由
`HitResult.consumed` 表达 —— 这也是给 D1 的示范：
接武器的时候，穿透不需要武器代码知道任何关于肉盾的事。

```ts
const r = enemies.bulletContact(shotId, enemy, impact, tickDamage, maxTicks)
if (r.consumed) recycleBullet(bullet)     // ← 永远只有这一句
```

## 八、别用测试场做这些

- **别把它当产品的验收标准。** 它是白箱调试设施，不是功能。正式美术和正式玩法接上之后，
  测试场可以保留也可以删。
- **别让产品代码 import 它。** 有测试守着，但这不是「绕过去就行」的规则 ——
  一旦产品依赖了测试场，测试场就再也不能改了。
- **别在测试场里做需要 jsdom 的东西。** 单测跑在 `node` 环境（见 `vite.config.ts`），
  需要 jsdom 的话说明逻辑没和表现层分开，那是架构问题。

## 九、加完场子之后跑一遍

```bash
cd client
npm run typecheck
npm test -- --run
npm run lint
```

`architecture.test.ts` 会检查几条约定（资产路径、`core/` 不能依赖域、纯逻辑不能碰 Phaser、
测试场不能漏进产品产物……）。**它报错的时候不要改它**，那是约定被违反了。
唯一的例外是那个「文件级豁免清单」——加豁免要同时改那张表，这正是它的作用。

### ⚠️ 但上面三条全绿，**不代表场子能跑**

这是真发生过的：`typecheck` / `lint` / `test` / `build` 四条**全过**，而打开浏览器是一片漆黑 ——
配置表根本没加载上，场子在建起来的第三行就抛异常死了。

原因值得记住：**测试场里绝大部分失败是运行时的，而静态检查看不见运行时。**
`world` 是不是在步、`WORLD_STEP` 有没有人订阅、`preload` 有没有真的把表取回来、
场景是不是在 `create()` 第二条就死了 —— 这些只有跑起来才知道。

所以**最后一步必须是「真的打开一次」**：

```bash
cd client && npm run dev
# 然后浏览器打开 http://localhost:5173/test.html?arena=你的场子id
```

**先看 HUD 第一行 `frame` 有没有在涨**，再看后面几行。`frame` 不动 = 物理世界空了，
后面所有读数都别信（原因见第五节）。

没有浏览器界面的环境（CI、只能跑命令行的 AI 助手）可以这样截图，存成 png 再看：

```bash
# Windows
"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
  --headless=new --disable-gpu --no-sandbox --window-size=1280,720 \
  --virtual-time-budget=12000 \
  --screenshot=shot.png "http://localhost:5173/test.html?arena=你的场子id"
```

> 用 `--virtual-time-budget` 截出来的图里 `fps` 会显示 0、`frame`/`steps` 只有个位数 ——
> 那是虚拟时钟下 `requestAnimationFrame` 本来就只跑了几次，**不是掉帧**。看的是
> 「这些数**有没有在动**」，不是它们的绝对值。