/**
 * D4 —— 局外档（存档）的白箱场。**没有战斗、没有敌人**：这个场子验的是
 * 「存档坏了会怎么样」，而那些情况**在正常玩的时候永远碰不到**。
 *
 * 存档这类东西的失败模式有个共同点：**坏掉时不报错。** 玩家的体验是
 * 「我的解锁莫名其妙没了」「设置的音量每次都要重调一遍」，而控制台一片安静。
 * 所以这一场把几条路径直接摆成按键，让你**亲手制造**这些故障再看结论。
 *
 * | 键 | 干了什么 | 该看到什么 |
 * |---|---|---|
 * | `1` | 加 100 金币并落盘 | 存储里的字节数跟着涨；结论变 `updated` |
 * | `2` | 从存储重新读一份档 | 结论 `loaded`，数值和上一次落盘的一致 |
 * | `3` | 把存储**改成坏 JSON** 再重读 | 结论 `recovered`；档回落成默认；**原文出现在 backup** |
 * | `4` | 写一份**版本更高**的档再重读 | 结论 `recovered`，但**原 key 没被覆盖** —— 那份未来档还在 |
 * | `5` | 把后端换成"读写都抛异常"再重读 | 结论 `recovered`；**金币照样能加**（这一局照常玩），只是 lastError 有话说 |
 * | `6` | 清档 | 回到默认档，存储里写的是默认档而不是空 |
 *
 * ## 第 4 条是最该看的一条
 *
 * 它对应 UC11（版本发布与回退）与风险 R08：玩家用新版玩过之后回退到旧版，
 * 旧版读到一份自己看不懂的档。**直接重置是最常见也最伤人的做法** ——
 * 它会把玩家在新版里的解锁原地抹掉，还不告诉任何人。
 * 正确的做法是**原样备份 + 另起一份新档**，让回滚回去之后那份档还在。
 *
 * ## 这一场不验什么
 *
 * 不验界面、不验音频、不验设置面板 —— 那些要等主菜单和设置菜单做出来。
 * 这里只验**档本身**：读、写、迁移、损坏恢复、以及"存储不可用"。
 */

import type { ArenaConfig, ArenaContext, ArenaDefinition } from '../../ArenaBase'
import { ArenaBase, WORLD_WIDTH } from '../../ArenaBase'
import { ProfileStore } from '@/domains/meta/profile/ProfileStore'
import { LocalStorageProfileStorage, type ProfileStorage } from '@/domains/meta/profile/storage'
import {
  PROFILE_BACKUP_KEY,
  PROFILE_SCHEMA_VERSION,
  PROFILE_STORAGE_KEY,
  type LoadOutcome,
} from '@/domains/meta/profile/types'

/** 面板左边距与行高 */
const PAD = 24

/**
 * 「读写都抛」的后端，用来演示**存储彻底不可用**的那条路。
 *
 * 这不是臆想的场景：隐私模式下的 Safari、被策略禁掉存储的 iframe、
 * 以及配额写满的用户，都会落到这条路上。它必须表现为"这一局照常玩"，
 * 而不是"进场白屏"。
 */
class BrokenStorage implements ProfileStorage {
  read(_key: string): string | null {
    throw new Error('这个环境下 localStorage 不可用')
  }

  write(_key: string, _value: string): void {
    throw new Error('配额已满')
  }

  remove(_key: string): void {
    throw new Error('这个环境下 localStorage 不可用')
  }
}

class D4ProfileArena extends ArenaBase {
  private store!: ProfileStore
  private storage!: ProfileStorage
  private readonly realStorage = new LocalStorageProfileStorage()
  private panel!: Phaser.GameObjects.Text
  private unsubscribe: (() => void) | null = null
  private lastAction = '（还没有操作）'
  private renderAccMs = 0

  protected get definition(): ArenaDefinition {
    return arena
  }

  protected configure(): ArenaConfig {
    // 空场子：这一场验的是存档，刷怪只会挡住面板。
    // 底座仍然会把假玩家放进物理世界，所以 `WORLD_STEP` 照常发。
    return {}
  }

  protected override onArenaCreate(ctx: ArenaContext): void {
    this.storage = this.realStorage
    this.store = new ProfileStore({ storage: this.storage })

    this.add
      .text(PAD, PAD, this.instructions(), {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#7a7a90',
        lineSpacing: 4,
      })
      .setDepth(900)
      .setScrollFactor(0)

    this.panel = this.add
      .text(WORLD_WIDTH / 2 + 40, PAD, '', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#9ad4ff',
        lineSpacing: 6,
      })
      .setDepth(900)
      .setScrollFactor(0)

    this.bindKeys(ctx)
    this.loadAndRender('初次读档')

    // 订阅是为了演示"改一处两边同步"（需求 §4.5）：真界面上，
    // 暂停菜单的音量滑杆和设置菜单读的是同一个档，所以一定同步。
    // 退订函数**必须存下来并在 shutdown 里调**（同 `core/events.ts` 的约定）。
    this.unsubscribe = this.store.subscribe(() => this.render())
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribe?.()
      this.unsubscribe = null
    })
  }

  protected override onArenaUpdate(dtMs: number, _ctx: ArenaContext): void {
    // 面板信息只在按键时变，但**存储可能在别的标签页里被改**（同一个 key），
    // 所以每 500ms 重新读一遍"存储里现在有什么"，让"没落盘"看得见。
    this.renderAccMs += dtMs
    if (this.renderAccMs < 500) return
    this.renderAccMs = 0
    this.render()
  }

  // ------------------------------------------------------------------ 按键

  private bindKeys(ctx: ArenaContext): void {
    const kb = ctx.scene.input.keyboard
    if (!kb) return

    kb.on('keydown-ONE', () => {
      const ok = this.store.update((draft) => {
        draft.currency.coins += 100
      })
      this.lastAction = ok
        ? '加 100 金币并落盘 → 成功'
        : `加 100 金币，但没存上：${this.store.lastError ?? '未知原因'}`
      this.render()
    })

    kb.on('keydown-TWO', () => this.loadAndRender('重新读档'))

    kb.on('keydown-THREE', () => {
      this.writeRaw('{这不是合法的 JSON', '写入坏 JSON')
      this.loadAndRender('坏档之后重读')
    })

    kb.on('keydown-FOUR', () => {
      const future = {
        schemaVersion: PROFILE_SCHEMA_VERSION + 1,
        currency: { coins: 999 },
        unlocks: { characters: ['来自未来版本的角色'], skills: [] },
      }
      this.writeRaw(JSON.stringify(future), '写入更高版本的档')
      this.loadAndRender('未来版本的档之后重读')
    })

    kb.on('keydown-FIVE', () => {
      this.storage = new BrokenStorage()
      this.store = new ProfileStore({ storage: this.storage })
      this.loadAndRender('换成读写都抛的后端之后重读')
    })

    kb.on('keydown-SIX', () => {
      const ok = this.store.reset()
      this.lastAction = ok ? '清档 → 回到默认档' : `清档失败：${this.store.lastError ?? ''}`
      this.render()
    })
  }

  private loadAndRender(what: string): void {
    const outcome = this.store.load()
    this.lastAction = `${what} → ${describe(outcome)}`
    this.render()
  }

  /** 绕过 store 直接改存储：模拟"另一个版本的代码写了这份档" */
  private writeRaw(text: string, what: string): void {
    try {
      this.storage.write(PROFILE_STORAGE_KEY, text)
      this.lastAction = `${what} → 成功`
    } catch (err) {
      this.lastAction = `${what} → 失败：${messageOf(err)}`
    }
  }

  // ------------------------------------------------------------------ 画面

  private instructions(): string {
    return [
      'D4 局外档 —— 存档的失败路径，正常玩的时候碰不到',
      '',
      '1  加 100 金币并落盘',
      '2  从存储重新读档',
      '3  写入坏 JSON 再重读   （看 recovered + 备份）',
      '4  写入更高版本的档再重读（看"不覆盖"）',
      '5  换成读写都抛的后端再重读（看"照常能玩"）',
      '6  清档',
      '',
      '空格 暂停    R 复位    Esc 回菜单',
      '（这一场没有敌人：它验的是档，不是战斗。）',
    ].join('\n')
  }

  private render(): void {
    const p = this.store.profile
    const raw = this.readRaw(PROFILE_STORAGE_KEY)
    const backup = this.readRaw(PROFILE_BACKUP_KEY)

    this.panel.setText(
      [
        `上次操作   ${this.lastAction}`,
        `load 结论  ${describe(this.store.lastOutcome)}`,
        '',
        `档          版本 ${p.schemaVersion}（本版 ${PROFILE_SCHEMA_VERSION}） · revision ${p.revision}`,
        `            金币 ${p.currency.coins}   角色 ${p.selected.characterId}   难度 ${p.selected.difficulty}`,
        `            解锁 ${p.unlocks.characters.join(', ') || '（空）'}`,
        `            升级 ${this.upgradeText(p.upgrades)}`,
        `            设置 BGM ${pct(p.settings.bgmVolume)}  音效 ${pct(p.settings.sfxVolume)}  ${p.settings.displayMode}`,
        `            统计 局数 ${p.stats.runs} · 通关 ${p.stats.wins} · 死亡 ${p.stats.deaths} · 最深 ${p.stats.bestDepth}`,
        '',
        '存储里现在有什么（不是内存里的档）',
        `  profile  ${raw === null ? '（空）' : `${raw.length} 字节`}`,
        `  backup   ${backup === null ? '（无）' : `${backup.length} 字节`}`,
        '',
        `lastError  ${this.store.lastError ?? '（无）'}`,
      ].join('\n'),
    )

    // 存储坏掉时画面上必须说出来 —— 「没存上」和「存上了」在界面上长得一样的话，
    // 玩家会一直以为自己有存档。
    this.hud.setNotice(
      this.store.lastError === null ? '' : `⚠️ 存档不可用：${this.store.lastError}`,
    )
  }

  private upgradeText(upgrades: Record<string, number>): string {
    const parts = Object.entries(upgrades).map(([id, n]) => `${id}×${n}`)
    return parts.length === 0 ? '（无）' : parts.join(' ')
  }

  private readRaw(key: string): string | null {
    try {
      return this.storage.read(key)
    } catch {
      return null
    }
  }
}

/** 把 load 的结论写成人话。**四种结论对玩家的意思完全不同。** */
function describe(outcome: LoadOutcome): string {
  switch (outcome.status) {
    case 'fresh':
      return 'fresh（第一次玩，用默认档）'
    case 'loaded':
      return 'loaded（读到了旧档）'
    case 'migrated':
      return `migrated（v${outcome.from} → v${outcome.to}）`
    case 'recovered':
      return `recovered（${outcome.reason}）`
  }
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export const arena: ArenaDefinition = {
  displayName: 'D4 局外档',
  description:
    '存档的失败路径：坏 JSON、更高版本的档、存储不可用。按 1—6 亲手制造这几种情况，看结论与备份。',
  scene: D4ProfileArena,
}
