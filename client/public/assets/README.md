# 美术 / 音效资源目录

> 本目录只放**运行时按路径加载**的原始资源。代码通过 `src/core/assetManifest.ts` 里的资源清单引用它们，
> **任何代码都不许硬编码这里的路径字符串，也不许硬编码 texture key**。

## 一、当前状态：全部是白方块占位

项目尚未产出任何美术资源。因此：

- `sprites/**` 目前是**空目录**，目录下只有 `.gitkeep`（git 不追踪空目录）。
- 游戏启动时，`src/core/assets.ts` 会把标记为 `placeholder: true` 的条目**在运行时用 Phaser 的
  `Graphics.generateTexture()` 生成白色方块**。
- **占位纹理用独立 key `${真实key}__placeholder`**，由清单层的 `resolveTextureKey(key)` 解析。
  因此美术把真图片丢进对应目录后，只需要在 `src/core/assetManifest.ts` 里把该条的 `placeholder` 改成
  `false`，**其余代码一行都不用改**。
- 音效同理：`placeholder: true` 时不加载、播放时静默返回，不会因为文件缺失报错。

### 为什么占位图和真图不用同一个 key

看起来「同 key」更省事（占位期和正式期用的是同一个 key，什么都不用解析），但它有个很坏的失效方式：
`Graphics.generateTexture(key, …)` 在 key 已存在、且源是 canvas 纹理时，**是往同一张 canvas 上再画一次**
——不替换、不报错。于是真美术文件到位后，只要漏掉一道守卫，**真图就会被白方块静默覆盖**，
而这只有等接入真美术那天才会发现。

独立 key 的失败方式相反：谁忘了走 `resolveTextureKey()` 而硬编码了真 key，占位期立刻显示
Phaser 的 `__MISSING` 纹理，**开发时当场就看得见**。用一次当场报错换掉一次三个月后的静默失效。

## 二、命名规范

```
<域>_<对象>_<变体>[_<帧序号>].<ext>
```

| 段 | 取值 | 说明 |
|---|---|---|
| 域 | `enemy` / `player` / `weapon` / `projectile` / `fx` / `ui` / `pickup` | 与子目录一致 |
| 对象 | `splitter` / `tank` / `bullet` / … | 与配置表里的 id 一致 |
| 变体 | `idle` / `move` / `hurt` / `death` / `split` / `attack` | 状态或行为 |
| 帧序号 | `00` `01` … | 序列帧才需要，两位补零 |

示例：

```
sprites/enemies/enemy_splitter_t1_idle.png
sprites/enemies/enemy_tank_hurt.png
audio/sfx/enemies/sfx_enemy_splitter_split_01.ogg
audio/sfx/enemies/sfx_enemy_tank_hurt_loop.ogg
```

**分隔符统一用下划线，不用空格、不用大写、不用中文。** 文件名即资源 id，跨平台（Windows / macOS / Linux /
CI）大小写敏感差异会因此消失。

## 三、规格约定（初版，D4 可以改）

| 类型 | 约定 |
|---|---|
| 敌人贴图 | 单帧 PNG，透明背景，正方形。分裂怪三代的画布尺寸由小到大：`24 / 32 / 48` px；肉盾怪 `96` px。物理碰撞半径由配置表给，与贴图尺寸解耦 |
| 抛射物 | `16` px |
| 动画 | **当前一律单帧 + 代码补间**（缩放、旋转、闪白）。清单已预留 `kind: 'spritesheet'`（配 `frameWidth`/`frameHeight`）与独立的 `ANIMS` 动画表，交付序列帧时**只改清单、不改加载代码** |
| 图集 | 单类资源超过 8 张时打成图集（Texture Atlas），减少 draw call。当前不必要 |
| 音效 | **`.ogg` 与 `.mp3` 双格式**（Safari 不支持 ogg，其余浏览器优先 ogg）。单个文件 ≤ 50 KB，循环音效必须无缝 |
| 音频总量 | 首屏加载体积是网页方案的硬约束（《技术选型》§8 第 6 条），全部音效合计目标 ≤ 2 MB |
| 音乐 | `audio/bgm/`，循环点写在文件名注释里（如 `bgm_dungeon_loop_8bar.ogg`） |

## 四、不要做的事

- **不要直接提交大文件。** 美术 / 音频走 Git LFS（《技术选型》§1 已列入）。LFS 规则由 D4 在资源管线里统一加，
  在那之前放进来的文件请先确认体积。
- **不要在这里放配置文件。** 数值配置表在 `public/config/`，两者归属不同。
- **不要手改 `dist/`。** 构建产物，刷新即覆盖。