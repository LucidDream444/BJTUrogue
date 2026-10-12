# 白箱测试场

> **这份文档是写给「别人家的 AI」看的。**
> 你的 AI 助手如果不知道这套约定，它会按自己的习惯把测试代码散在域目录里、
> 会去改 `main.ts`、会为了让自己的场子能跑而改别人的文件。
> **在这份仓库里用 AI 之前，先把这一页丢给它。**
> 一句话版本：**「测试场都在 `client/src/test/`，抄 `arenas/_ArenaTemplate.ts`，
> 不要改 `main.ts`，不要碰 `registry.ts` 之外的文件。」**

## 〇、把下面这段整个复制给你的 AI 助手

（用 Cursor / Copilot / 通义灵码 / 什么别的工具都一样 —— 约定与工具无关。）

````text
这个仓库的游戏客户端在 client/，约定文件是根目录的 AGENTS.md，先读它。
我们要加/改一个白箱测试场。测试场的全部约定在 client/src/test/README.md，也要读。

硬性要求，请严格遵守：
1. 测试场一律放在 client/src/test/arenas/ 下，一个文件一个场子。
   做法是复制 client/src/test/arenas/_ArenaTemplate.ts（模板文件名带下划线，
   不进菜单），去掉文件名开头的下划线再改。
2. 不要改 main.ts、不要改 index.html、不要改任何其他域的文件。
   新场子靠 registry.ts 里的 import.meta.glob 自动注册，不需要你来注册。
3. 场子继承 client/src/test/ArenaBase.ts 的 ArenaBase，只实现三个方法：
   configure()（必填）、onArenaCreate(ctx)、onArenaUpdate(dt, ctx)。
   后两个必须写 protected override，漏了 override 会编译不过（TS4114）。
4. 白箱：不许引入美术资源。用白色方块 + 文字，需要标注就用 this.add.text()。
5. 一切数值（血量、速度、伤害、冷却）都从配置表读，不许写死在代码里
   （client/public/config/*.json，通过 ctx.bundle / ctx.tune 拿）。
   这是项目红线，写死等于每改一次平衡就要重新构建。
6. 不要 import 别的域的内部实现，跨域只走事件总线（ctx.bus）。
7. 写完把这几条跑一遍并确保干净：
   cd client && npm run typecheck && npm test -- --run && npm run lint

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

现在是哪几个场子：

| id | 名字 | 看什么 |
|---|---|---|
| `basic_hit` | 基础命中 | 一只分裂怪 + 一只肉盾，空地。一枪一个 / 子弹穿透 / 顿帧 / 闪屏 |
| `splitter_chain` | 分裂链 | 三只一代 = 33 杀。第 5 杀闪屏、出生间隔、`ledger` 归零 |
| `tank_grind` | 肉盾磨血 | 肉盾 + 带 160px 缺口的墙。帧伤 tick、音效限频、音高、减速、绕路 |
| `swarm_stress` | 压力场 | 150+ 只怪铺满场。`queue` 排空、`ai near/far` 比例、`frame` 不停 |

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
cp src/test/arenas/_ArenaTemplate.ts src/test/arenas/我的场子.ts   # 1. 复制，去掉文件名的下划线
```

2. 打开它，改 `configure()`（开局刷什么、有没有墙）、可选的两个钩子、以及底部的
   `displayName` / `description`。
3. 刷新 `/test.html`。**它已经在菜单里了。**

不需要注册、不需要 import 任何东西、不需要改 `main.ts`、不需要改 `registry.ts`。
`registry.ts` 用 `import.meta.glob` 自动收 `arenas/` 下的每个 `.ts`。

**文件名以 `_` 开头的不进菜单** —— 所以模板自己不会出现在里面。

### 三条硬要求（`AGENTS.md` §五）

1. **所有测试场都在 `client/src/test/`**，不许散到各域目录里。
   理由不是洁癖：五个域各写各的，散着放的话，别人找自己场子的时候会先撞见一堆不认识的文件。
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

### ⚠️ 三条会咬人的

1. **`configure()` 里刷怪的 `x`/`y` 要么都给、要么都不给。** 只给一个是场子写错了，
   底座会当场抛 —— 因为「默默随机撒点」会让「我明明设了坐标」看起来只是「运气不好撒歪了」。
2. **墙是有代价的：给了墙就会生成一张 BFS 寻路网格。**
   而且寻路的格子是 **80px** 的粗格 —— 留通道要留**至少两格（160px）**，
   否则它会被判成不可走，怪会贴着墙蹭。`tank_grind` 里那个 160px 的缺口就是为这个留的。
3. **撒点用 `this.randomPoint()`，别自己按格子算坐标。**
   它会避开墙。自己算的话迟早会把一批怪生在柱子里，而「卡在柱子里的怪」
   看起来和「寻路坏了」一模一样。

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