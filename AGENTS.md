# AGENTS.md — 项目约定

> **这是给所有 AI 助手看的唯一约定文件，与具体工具无关。**
> Claude Code 读 `CLAUDE.md`（它只是一行 `@AGENTS.md` 导入，内容就是本文件）；
> Cursor、GitHub Copilot、Codex、Windsurf、Gemini CLI 等直接读 `AGENTS.md` 本身。
> 用别的工具的话，在对话开头说一句「先读 AGENTS.md」即可。
>
> **改这份文件要通知全员**（《人员分工方案》§9.3）。当前由 D3 维护初版。

---

## 一、这是什么项目

《课后勇者：异次元校园》——2D 俯视角轻量化地牢闯关 roguelike，**浏览器网页游戏**（不是桌面客户端）。
五人团队按「设计域」分工，一人一域、端到端负责。**你的用户通常是五个域中的一个。**

**动手前先读这三份**（路径相对仓库根目录）：

| 文档 | 什么时候读 |
|---|---|
| `docs/人员分工方案.md` | 搞不清某个东西归谁、域之间怎么接口 |
| `docs/技术选型.md` | 搞不清用什么库、为什么这么选、浏览器有哪些坑 |
| `docs/Phaser3性能与引擎事实.md` | **写任何涉及实体、对象池、物理、持续伤害、音效、粒子的代码前必读** |
| `docs/需求分析与产品设计.md` | 需要知道需求编号（P0/P1/P2、R01—R10、UC01—UC11）时。**优先读 md 版**，PDF 原件是权威来源 |

---

## 二、仓库结构

```
BJTUrogue/
├── client/          客户端：Phaser 3 + TypeScript + Vite   ← 游戏本体
├── server/          服务端：Django 5 + DRF + PostgreSQL     ← D5 的工作区，尚未开工
├── docs/            项目文档
└── CLAUDE.md        本文件
```

**客户端的一切都在 `client/` 里。** 任何 `npm` 命令都要先 `cd client`，
根目录没有 `package.json`，在根目录跑 `npm install` 会失败。

```bash
cd client
npm install
npm run dev          # http://localhost:5173
npm run typecheck    # tsc --noEmit
npm test             # Vitest（watch）
npm run test:run     # Vitest（跑一次）
npm run lint         # ESLint
```

依赖版本**锁定**写在 `client/package.json`（不用 `^`、不用 `~`）。要升级先问 D5。
当前锁定：Phaser `3.90.0` / TypeScript `5.9.3` / Vite `5.4.21` / Vitest `2.1.9` / Node 20 LTS。

> **为什么不用 Phaser 4：** 全组依赖 AI 辅助开发，而模型语料与社区教程里 Phaser 3 比 Phaser 4 多一个量级。
> 升级会同时抬高五个人的学习成本，收益不抵代价。**不是疏忽，是决定。**

---

## 三、三条红线（《人员分工方案》§9.4 · 违反 = 返工）

1. **游戏核心循环永远不 `await` 网络。** 遥测必须 fire-and-forget，服务端挂掉不影响游戏。
2. **配置数值不写死在代码里**，一律走配置表（`client/public/config/*.json`）。
   血量、速度、伤害、冷却、概率——**全部**在配置里。写死等于每改一次平衡就重新构建。
3. **所有本地存档数据带 `schemaVersion` 字段**，为将来迁移留路。

---

## 四、目录归属：文件级所有权

**一人一域端到端负责。** 改别人域的文件要先在群里说，不要直接动手改。

| 目录 | 归属 | 说明 |
|---|---|---|
| `client/src/core/` | **共用层** | 事件总线、资源清单、配置加载、随机数、时间。**改动需全员同意** |
| `client/src/domains/combat/` | D1 战斗核心 | 战斗 Scene、武器、奖励、手感实现 |
| `client/src/domains/procgen/` | D2 关卡与地牢生成 | 生成器、可达性校验、房间构建 |
| `client/src/domains/enemies/` | D3 敌人与首领 | 敌人 AI、寻路、行为配置、敌人表现 |
| `client/src/domains/meta/` | D4 局外成长与存档 | 主菜单、结算、升级页、存档、设置 |
| `client/src/test/` | **各域各自加** | 白箱测试场，见下节 |
| `client/public/config/` | 字段定义归 D2（C2），各域填自己的表 | 敌人表由 D3 填，武器表由 D1 填 |
| `client/public/assets/` | 资源管线归 D4，各域投自己的资源 | 命名规范见 `client/public/assets/README.md` |
| `server/` | D5 | 客户端代码不要放这里 |

**跨域通信只走事件总线**（`client/src/core/events.ts`，C1 契约，D1 起草）。
不要直接调用另一个域的方法或读取它的内部状态。

---

## 五、白箱测试场（重要约定）

没有美术资源、没有玩家角色、各域尚未互相接通时，**功能靠测试场验证**。

**规则：**

1. **所有测试场统一放 `client/src/test/`**，不得散落在各域目录里。
2. **每个测试场自带启动代码**，新增一个测试场**不需要修改任何其他域的文件**（包括 `main.ts`）。
3. **白箱**：用白色方块 / 几何图形代替美术，用文字标出编号与状态。没有美术也要能看懂。
4. 测试场是**临时的调试设施**，不是产品功能。正式美术与正式玩法接入后，测试场可以保留也可以删，
   但**绝不能变成产品运行时依赖的代码**。

**为什么要统一放：** 其他组员也用 AI 辅助开发，目录约定统一，他们的 AI 才不会各写各的。
如果你要加一个测试场，**照 `client/src/test/` 里既有测试场的样子抄**。

> 详细的启动机制（URL 参数、注册表）见 `client/src/test/README.md`。

---

## 六、美术资源与占位

- 资源放在 `client/public/assets/`，**代码里不许出现硬编码路径字符串、也不许出现硬编码 texture key**，
  一切经 `client/src/core/assetManifest.ts` 的清单引用。
- **当前没有任何美术资源。** 清单里 `placeholder: true` 的条目，启动时用 Phaser 的
  `Graphics.generateTexture()` **在运行时生成白色方块**。
- **占位纹理用独立 key `${真实key}__placeholder`，由 `resolveTextureKey()` 解析。**
  美术把真图片丢进目录后，把该条的 `placeholder` 改成 `false` 即可，**其余代码一行都不用改**。
- **为什么不用「占位图和真图同 key」**（看起来更省事）：`Graphics.generateTexture(key, …)`
  在 key 已存在且是 canvas 纹理时，是**往同一张 canvas 上再画一次**，不替换也不报错。
  同 key 方案下，真美术到位后只要漏掉一道守卫，真图就会被白方块**静默覆盖**——而这类问题
  **只在接入真美术时才暴露**，那时已经没人记得上下文了。
  独立 key 的失败模式是**响亮且当场**：谁硬编码了真 key，占位期立刻显示 `__MISSING` 纹理。
  **宁可当场炸，不要三个月后静默。**
- 命名规范：`<域>_<对象>_<变体>[_<帧号>].<ext>`，全小写下划线，例：`enemy_splitter_t1_idle.png`。
  目录分层与音效双格式（ogg+mp3）见 `client/public/assets/README.md`（owner 是 D4，那是唯一真值）。
- 清单支持 `kind: 'image' | 'spritesheet' | 'audio'`。**动画集单独一张 `ANIMS` 表**，
  占位期不加载也不注册——美术交付序列帧/图集时只改清单，不用改加载代码。

---

## 七、技术栈约定（《技术选型》§3 的「刻意不引入」）

**不引入**：ECS 框架、状态管理库（Redux 等）、UI 组件库、任何游戏引擎。
采用 **Phaser GameObject + 自定义数据组件 + 事件总线**。额外抽象只会增加五人的沟通成本。

**单元测试只测纯逻辑。** `client/vite.config.ts` 里 Vitest 的环境被固定为 `node`——
不加载 Phaser、不碰 DOM。**如果某个测试需要 jsdom，说明逻辑没和表现层分开，那是架构问题，不是测试问题。**
敌人 AI、伤害结算、生成算法这类东西必须能在没有浏览器的环境下测。

---

## 八、Phaser 子类化：一个必须知道的坑

`client/tsconfig.json` 开了 `useDefineForClassFields: true`。**子类化 Phaser 的类时，
重写继承来的字段必须用 `declare` 声明**，否则子类的类字段会以 `undefined` 覆盖掉
父类构造函数里已经赋好的值（表现为「明明继承了却报 `body` 是 undefined」）。

```ts
// ✅ 正确：declare 不产生运行时代码，只告诉 TS 类型
export class Enemy extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body
}

// ❌ 错误：这行会在运行时把 body 覆盖成 undefined
export class Enemy extends Phaser.Physics.Arcade.Sprite {
  body: Phaser.Physics.Arcade.Body
}
```

---

## 九、浏览器特有的坑（《技术选型》§8，这几条最容易变成「玄学 bug」）

1. **切标签页时 `requestAnimationFrame` 会停**，切回来单帧 delta 可能是几十秒。
   **必须钳制 delta**（每帧上限 1/30 秒）。不钳制会产生穿墙、以及「按时间累积的伤害一次性结算几百次」。
2. **音频自动播放限制**：主菜单需要一次用户点击才能解锁音频，所有浏览器通用。
3. **全屏 / 指针锁定必须写在点击事件处理函数内**，不能在加载时自动触发。
4. **F5 刷新 = 本局进度全丢**，`beforeunload` 要拦截。

---

## 十、其他

- **不要碰 `.gitignore` 里关于 `openspec/` 的那一段。** 那是 yuyu 的内容，其他组员不需要用，也不会用。
- `.vscode/settings.json` 被 gitignore 忽略（个人偏好），队友需要各自在本地建一份。
  其中 `eslint.workingDirectories` 是**子目录布局下 ESLint 插件工作的前提**，缺了它编辑器里不会有 lint 提示。
- 提交信息用中文写清楚「哪个域、做了什么」，例：`D3: 分裂怪三代数值表与分裂逻辑`。
- 主干开发 + 短分支，分支存活不超过 3 天，每周至少合并一次（《人员分工方案》§9.1）。

---

## 十一、改动日志：`持续更新MM.DD.md`

仓库根目录有一份改动日志，**文件名里的 `MM.DD` 就是最后一次改动的当天**。

**每做完一件事，就做这三步：**

1. 在文件**最上面**（日期标题之下）加一条。写「哪个域、改了什么、**别人要不要跟着做什么**」。
2. **把文件名改成当天日期**，例：`持续更新10.12.md` → `持续更新10.15.md`。
3. 和代码一起提交。

**为什么要有它：** `git log` 答得了「哪一行什么时候变的」，答不了「上周三我们到底决定了什么、
为什么这么决定」。组员（和他们的 AI）看这份文件就知道自己要不要跟着动。

**这条对 AI 助手是硬要求 ——** 你改完代码不更新这份文件，等于没改完。
加一条不费多少字，但漏了的话，下一次别人接手的起点就是「上次那个改动到底是什么」的猜测。

> 别写成「修复了 bug」。写成「D3：肉盾受击减速加了地板，防止罚站死」这种
> 别人能据此判断「要不要跟着改」的样子。文件顶部有模板。