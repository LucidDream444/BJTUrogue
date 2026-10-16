/**
 * 资源加载与占位纹理生成。**这个文件合法 import Phaser**（清单数据在 `assetManifest.ts`）。
 *
 * 五项约定：
 *
 * | 项 | 做法 |
 * |---|---|
 * | 占位纹理 key | `${逻辑key}__placeholder`，见 `assetManifest.ts` 的说明 |
 * | `placeholder: true` 的条目 | **绝不发起文件加载**，一个字都不下载 |
 * | 加载失败 | 统一落到 `__placeholder_missing`（洋红方块），一眼能看出缺东西 |
 * | 音效不在加载期判定 | 占位期 `SfxPool` 直接静默 no-op，见 `presentation/SfxPool.ts` |
 * | 动画注册 | 全局 `AnimationManager` 跨场景存活，注册前必须查 key 是否已存在 |
 */

import Phaser from 'phaser'
import {
  ANIMS,
  ASSETS,
  PLACEHOLDER_MISSING_KEY,
  PLACEHOLDER_SUFFIX,
  audioUrls,
  findAsset,
  imageUrl,
  resolveTextureKey,
  type AssetEntry,
} from './assetManifest'

/** 兜底纹理的尺寸，够大能看见就行。 */
const MISSING_SIZE = 16

/**
 * 在 `preload()` 里调用。只加载**真资源已到位**（`placeholder: false`）的条目。
 */
export function preloadAssets(scene: Phaser.Scene): void {
  for (const entry of ASSETS) {
    if (entry.placeholder) continue
    // 纹理与音频缓存跨场景存活；标题页/角色页已加载的资源不再重复注册。
    if (entry.kind === 'audio' ? scene.cache.audio.exists(entry.key) : scene.textures.exists(entry.key))
      continue

    switch (entry.kind) {
      case 'image':
        scene.load.image(entry.key, imageUrl(entry))
        break
      case 'spritesheet': {
        const frameWidth = entry.frameWidth
        const frameHeight = entry.frameHeight
        if (!frameWidth || !frameHeight) {
          console.warn(
            `[assets] "${entry.key}" 是 spritesheet 但没写 frameWidth/frameHeight，跳过加载。`,
          )
          break
        }
        scene.load.spritesheet(entry.key, imageUrl(entry), { frameWidth, frameHeight })
        break
      }
      case 'audio':
        scene.load.audio(entry.key, audioUrls(entry))
        break
    }
  }

  scene.load.once(Phaser.Loader.Events.COMPLETE, () => sweepFailedLoads(scene))
}

/**
 * 在 `create()` 里、**任何 sprite 被创建之前**调用。
 *
 * 为每个还没到位的资源生成一张白色方块占位纹理。已经生成过的跳过
 * （场景重启会再调一次）。
 */
export function ensurePlaceholderTextures(scene: Phaser.Scene): void {
  ensureMissingTexture(scene)

  for (const entry of ASSETS) {
    if (entry.kind === 'audio') continue
    if (!entry.placeholder) continue

    const placeholderKey = entry.key + PLACEHOLDER_SUFFIX
    if (scene.textures.exists(placeholderKey)) continue

    const w = entry.width ?? 32
    const h = entry.height ?? 32
    const g = scene.make.graphics({}, false) // 别加进显示列表
    g.fillStyle(0xffffff, 1)
    g.fillRect(0, 0, w, h)
    // [源码] Graphics.generateTexture(key, w, h)：key 已存在且源是 canvas 时
    // 是「再画一次」而不是替换。所以上面必须先查 exists，且 key 必须带 __placeholder 后缀。
    g.generateTexture(placeholderKey, w, h)
    g.destroy()
  }
}

/**
 * 注册 `ANIMS` 里的动画。**当前是空表**（项目暂不做序列帧），
 * 美术交付图集后才会有条目，届时不需要改任何加载代码。
 */
export function registerAnimations(scene: Phaser.Scene): void {
  for (const anim of ANIMS) {
    if (scene.anims.exists(anim.animKey)) continue // 跨场景存活的全局管理器，别重复建
    const entry = findAsset(anim.textureKey)
    if (!entry) {
      console.warn(`[assets] 动画 "${anim.animKey}" 引用了清单里不存在的 key "${anim.textureKey}"`)
      continue
    }
    // Placeholder textures have a single base frame, never the retired sprite-sheet frames.
    if (entry.placeholder) continue
    const texture = scene.textures.get(entry.key)
    if (!anim.frames.every((frame) => texture.has(String(frame)))) continue
    scene.anims.create({
      key: anim.animKey,
      frames: anim.frames.map((frame) => ({ key: anim.textureKey, frame })),
      frameRate: anim.frameRate,
      repeat: anim.repeat,
      yoyo: anim.yoyo ?? false,
    })
  }
}

/**
 * 逻辑 key → 当前该用的 texture key。**这是游戏代码唯一该用的取 key 方式。**
 *
 * 返回值可能是 `__placeholder_missing`（清单里没这个 key）——
 * 测试场会把它画成洋红方块，一眼能看出问题。
 */
export function textureKeyFor(scene: Phaser.Scene, logicalKey: string): string {
  const resolved = resolveTextureKey(logicalKey)
  if (!scene.textures.exists(resolved)) return PLACEHOLDER_MISSING_KEY
  return resolved
}

/** 当前是否处于占位状态（音效播放、特效降级要用）。 */
export function isPlaceholder(key: string): boolean {
  return findAsset(key)?.placeholder ?? true
}

function ensureMissingTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(PLACEHOLDER_MISSING_KEY)) return
  const g = scene.make.graphics({}, false)
  g.fillStyle(0xff00ff, 1)
  g.fillRect(0, 0, MISSING_SIZE, MISSING_SIZE)
  g.generateTexture(PLACEHOLDER_MISSING_KEY, MISSING_SIZE, MISSING_SIZE)
  g.destroy()
}

/**
 * 加载失败的真资源退回占位纹理。
 *
 * 没有这一步，一个写错文件名的资源会变成 Phaser 那个绿黑格子且不告诉你缺什么；
 * 退到白色方块 + 一条 console.warn，测试场里立刻能定位。
 */
function sweepFailedLoads(scene: Phaser.Scene): void {
  for (const entry of ASSETS) {
    if (entry.placeholder) continue
    if (entry.kind === 'audio') continue
    if (scene.textures.exists(entry.key)) continue

    console.warn(
      `[assets] 真资源 "${entry.key}" 加载失败（${entry.path}），退回白色方块占位。` +
        `检查 public/assets/ 下的文件名与清单是否一致。`,
    )
    const w = entry.width ?? 32
    const h = entry.height ?? 32
    const g = scene.make.graphics({}, false)
    g.fillStyle(0xffffff, 1)
    g.fillRect(0, 0, w, h)
    g.generateTexture(entry.key, w, h)
    g.destroy()
  }
}

/** 只在类型层面用到，避免 `verbatimModuleSyntax` 下 name 被摇掉。 */
export type { AssetEntry }
