/**
 * 测试场模板。**文件名以 `_` 开头，所以它不会出现在菜单里**（见 `arenaCatalog.ts`）。
 *
 * 用法：复制这个文件成 `arenas/你的名字.ts`（**去掉下划线**），改三处，完事。
 * 不需要注册、不需要改 `main.ts`、不需要改任何别人的文件 ——
 * `registry.ts` 用 `import.meta.glob` 自动收。
 *
 * 你只需要回答三个问题：
 *
 * | 方法 | 回答 |
 * |---|---|
 * | `configure()` | **必填**。世界多大、有没有墙、开局刷什么 |
 * | `onArenaCreate(ctx)` | 可选。还需要别的东西（订阅事件、造自己的显示对象） |
 * | `onArenaUpdate(dt, ctx)` | 可选。每帧额外干什么（持续刷怪、统计自己关心的量） |
 *
 * ⚠️ 后面两个要写 `protected override`，**不能只写 `protected`**。
 * `tsconfig` 开了 `noImplicitOverride`，漏了会直接编译不过 ——
 * 而报错信息是 `TS4114: This member must have an 'override' modifier`，
 * 一眼能看懂，所以这里不啰嗦原因。
 * （`configure` 不用写 `override`：它在底座里是 `abstract`，实现抽象成员不算重写。）
 *
 * ---
 *
 * ## 什么值得做成一个场子
 *
 * **「坏掉时看不出来」的东西。** 一个场子的价值等于它能暴露的失败模式，
 * 不是它覆盖的功能数量。所以先问：这功能悄悄坏掉的话，长什么样？
 *
 * - 「怪会卡在墙角」—— 只在有墙 + 拐角 + 多只怪同时抢路时才出现；
 * - 「降频逻辑反了」—— 远处那群怪的 AI 全在跑，帧率掉一点点，肉眼看不出来；
 * - 「池子没回收」—— 打十分钟才开始吃内存，短测试永远碰不到。
 *
 * 对应的做法：**把这个条件摆出来，再让 HUD 把那个量显示出来。**
 * 场上还要有 `ctx.hud` 之外的自定义读数时，用 `scene.add.text(...)` 自己加，
 * 或者把数字塞进 `onArenaUpdate` 里更新。
 *
 * ## 白箱：没有美术也要看得懂
 *
 * 白方块 + 文字。怪的形状来自 `assetManifest.ts` 的占位纹理（运行时生成的方块），
 * 不同代数/种类的方块大小不同，所以「谁是几代」用眼睛能分出来。
 * 需要额外的标注（比如「这里是窄通道」）就自己 `add.text`。
 *
 * ## ⚠️ 不要在这里 import 别的域的内部实现
 *
 * 跨域只走事件总线（`AGENTS.md` §四）。测试场也一样 ——
 * 测试场能看见某个域的内部状态，就意味着**那个域删一个字段时会悄悄弄坏一个测试场**，
 * 而跨域调用还会诱使人「反正测试场里能调，产品里也这么写吧」。
 * 唯一的例外是 D3 自己的东西：这个底座本来就在 D3 的域里。
 */

import type { ArenaConfig, ArenaDefinition, ArenaContext } from '../ArenaBase'
import { ArenaBase } from '../ArenaBase'

/** 场子的类名随意，但**不要 export 它** —— 目录只认底下的 `arena` 常量 */
class TemplateArena extends ArenaBase {
  // 这一句每个场子都一样，抄过去不用改。引用模块底部的常量而不是重写一遍元信息：
  // 重写两份的话，改了菜单里的说明而忘了改这里，HUD 标题就会和菜单不一致。
  protected get definition(): ArenaDefinition {
    return arena
  }

  protected configure(): ArenaConfig {
    return {
      // 开局刷什么。`x`/`y` 要么都给（固定点），要么都不给（随机撒，自动避开墙）。
      spawns: [
        // 例：{ kind: 'splitter', gen: 0, count: 1 },
        // 例：{ kind: 'tank', gen: 0, count: 1, x: 640, y: 200 },
      ],
      // 墙。给了墙，底座会同时生成寻路网格和显示方块。
      walls: [
        // 例：{ x: 640, y: 360, width: 240, height: 40 },
      ],
      // 可选：开局给玩家一点无敌时间，省得一进场就被围死
      // spawnGraceMs: 2000,
      // 可选：固定随机种子，让「这次看到的现象」能被复现
      // rngSeed: 0xd3d3,
    }
  }

  protected override onArenaCreate(_ctx: ArenaContext): void {
    // 可选。此时 `ctx.enemies` / `ctx.bus` / `ctx.clock` / `ctx.gun` 都已就绪。
    // 要在菜单外单独标注点什么，就在这里 `this.add.text(...)`。
  }

  protected override onArenaUpdate(_dtMs: number, _ctx: ArenaContext): void {
    // 可选。缺省什么都不做。
  }
}

/**
 * 目录读的就是这个。`id` 由**文件名**决定（`_ArenaTemplate.ts` → `_ArenaTemplate`，
 * 但因为下划线开头而被跳过），所以这里不写 id。
 *
 * `description` 会同时出现在菜单和场子里的 HUD 上，写「该看什么」而不是「有什么」：
 * 「两只肉盾，用挥砍持续输出」比「肉盾场」有用得多。
 */
export const arena: ArenaDefinition = {
  displayName: '模板（不会出现在菜单里）',
  description: '复制这个文件，去掉文件名开头的下划线，然后改这三个方法。',
  scene: TemplateArena,
}