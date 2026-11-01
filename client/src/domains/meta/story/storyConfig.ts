import { findAsset } from '@/core/assetManifest'

export const STORY_CONFIG_NAME = 'story.json'
export const STORY_CONFIG_URL = `config/${STORY_CONFIG_NAME}`
export const STORY_CHARACTERS = ['student', 'athlete', 'scholar'] as const
export type StoryCharacterId = (typeof STORY_CHARACTERS)[number]
export type StoryKind = 'intro' | 'ending'

export interface StoryPage {
  readonly imageKey: string
  readonly caption: string
  readonly durationMs: number
}

export interface StoryConfig {
  readonly schemaVersion: 1
  readonly presentation: {
    readonly width: number
    readonly height: number
    readonly maxDeltaMs: number
    readonly inputGuardMs: number
    readonly autoPlay: boolean
  }
  readonly pages: Readonly<Record<string, StoryPage>>
  readonly branches: Readonly<Record<StoryCharacterId, Readonly<Record<StoryKind, readonly string[]>>>>
}

export class StoryConfigError extends Error {}

/** 纯数据校验：测试可注入资源目录，产品默认校验正式资源清单。 */
export function parseStoryConfig(
  raw: unknown,
  assetExists: (key: string) => boolean = (key) => findAsset(key)?.kind === 'image',
): StoryConfig {
  const root = record(raw, 'story')
  if (root.schemaVersion !== 1) throw new StoryConfigError('story.schemaVersion 必须为 1')
  const view = record(root.presentation, 'story.presentation')
  if (typeof view.autoPlay !== 'boolean') throw new StoryConfigError('story.presentation.autoPlay 必须是布尔值')
  const presentation = {
    width: positive(view.width, 'story.presentation.width'),
    height: positive(view.height, 'story.presentation.height'),
    maxDeltaMs: positive(view.maxDeltaMs, 'story.presentation.maxDeltaMs'),
    inputGuardMs: nonnegative(view.inputGuardMs, 'story.presentation.inputGuardMs'),
    autoPlay: view.autoPlay,
  }
  const pages: Record<string, StoryPage> = {}
  const images = new Set<string>()
  for (const [id, value] of Object.entries(record(root.pages, 'story.pages'))) {
    const page = record(value, `story.pages.${id}`)
    const imageKey = string(page.imageKey, `story.pages.${id}.imageKey`)
    if (!assetExists(imageKey)) throw new StoryConfigError(`story.pages.${id} 引用了不存在的图片 ${imageKey}`)
    if (images.has(imageKey)) throw new StoryConfigError(`故事独立画面不能重复使用图片 ${imageKey}`)
    images.add(imageKey)
    pages[id] = Object.freeze({
      imageKey,
      caption: string(page.caption, `story.pages.${id}.caption`),
      durationMs: positive(page.durationMs, `story.pages.${id}.durationMs`),
    })
  }
  if (Object.keys(pages).length !== 14) throw new StoryConfigError('story.pages 必须包含 14 张独立画面')
  const source = record(root.branches, 'story.branches')
  const branches = {} as Record<StoryCharacterId, Record<StoryKind, readonly string[]>>
  const used = new Set<string>()
  for (const characterId of STORY_CHARACTERS) {
    const branch = record(source[characterId], `story.branches.${characterId}`)
    branches[characterId] = {} as Record<StoryKind, readonly string[]>
    for (const kind of ['intro', 'ending'] as const) {
      const sequence = branch[kind]
      const count = kind === 'intro' ? 5 : 3
      if (!Array.isArray(sequence) || sequence.length !== count)
        throw new StoryConfigError(`story.branches.${characterId}.${kind} 必须为 ${count} 幕`)
      branches[characterId][kind] = Object.freeze(sequence.map((value, index) => {
        const id = string(value, `story.branches.${characterId}.${kind}[${index}]`)
        if (!pages[id]) throw new StoryConfigError(`故事分支引用了不存在的画面 ${id}`)
        used.add(id)
        return id
      }))
      if (new Set(branches[characterId][kind]).size !== count)
        throw new StoryConfigError(`story.branches.${characterId}.${kind} 不得重复画面`)
    }
    Object.freeze(branches[characterId])
  }
  if (used.size !== 14) throw new StoryConfigError('14 张故事图片必须全部用于角色分支')
  return Object.freeze({ schemaVersion: 1, presentation: Object.freeze(presentation), pages: Object.freeze(pages), branches: Object.freeze(branches) })
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StoryConfigError(`${where} 必须是对象`)
  return value as Record<string, unknown>
}
function string(value: unknown, where: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new StoryConfigError(`${where} 不得为空`)
  return value
}
function nonnegative(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new StoryConfigError(`${where} 必须是有限非负数`)
  return value
}
function positive(value: unknown, where: string): number {
  const number = nonnegative(value, where)
  if (number === 0) throw new StoryConfigError(`${where} 必须大于零`)
  return number
}
