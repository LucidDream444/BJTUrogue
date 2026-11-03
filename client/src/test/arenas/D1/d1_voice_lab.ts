import Phaser from 'phaser'
import {
  CHARACTER_VOICE_CUES,
  CHARACTER_VOICE_PROFILES,
  characterVoiceKey,
  findAsset,
  type CharacterVoiceCue,
} from '@/core/assetManifest'
import { CharacterVoice } from '@/domains/combat/CharacterVoice'
import { ArenaBase, type ArenaConfig, type ArenaContext, type ArenaDefinition } from '../../ArenaBase'

const CHARACTER_NAMES: Readonly<Record<string, string>> = {
  student: '新生',
  athlete: '大鹅',
  scholar: '小红果',
}

const CUE_NAMES: Readonly<Record<CharacterVoiceCue, string>> = {
  hurt: '受伤',
  death: '死亡',
  skill: '使用技能',
  reward: '拿到奖励',
  boss_kill: '击杀 Boss',
}

type SlotState = 'ready' | 'silent' | 'missing'

class VoiceLabArena extends ArenaBase {
  private voice!: CharacterVoice
  private statusText!: Phaser.GameObjects.Text
  private volumeText!: Phaser.GameObjects.Text
  private volume = 0.8

  protected get definition(): ArenaDefinition {
    return arena
  }

  protected configure(): ArenaConfig {
    return {
      spawns: [],
      rngSeed: 0xd1a0d10,
    }
  }

  protected override onArenaCreate(_ctx: ArenaContext): void {
    this.voice = new CharacterVoice(this, { volume: this.volume, hurtCooldownMs: 0 })
    this.buildLab()
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.voice.destroy())
  }

  private buildLab(): void {
    const root = this.add.container(0, 0).setDepth(5000).setScrollFactor(0)
    root.add(
      this.add
        .rectangle(640, 400, 1220, 500, 0x0d1118, 0.97)
        .setStrokeStyle(2, 0x71849d),
    )
    root.add(
      this.add.text(640, 175, '角色语音测试台', {
        fontFamily: 'Microsoft YaHei',
        fontSize: '28px',
        color: '#f4e7cc',
      }).setOrigin(0.5),
    )
    root.add(
      this.add.text(640, 207, '点击格子播放 · 第一次点击同时解锁浏览器音频', {
        fontFamily: 'Microsoft YaHei',
        fontSize: '14px',
        color: '#9db1c8',
      }).setOrigin(0.5),
    )

    const firstColumnX = 245
    const columnGap = 197
    CHARACTER_VOICE_CUES.forEach((cue, index) => {
      root.add(
        this.add.text(firstColumnX + index * columnGap, 242, CUE_NAMES[cue], {
          fontFamily: 'Microsoft YaHei',
          fontSize: '15px',
          color: '#d9c08c',
        }).setOrigin(0.5),
      )
    })

    CHARACTER_VOICE_PROFILES.forEach((profile, row) => {
      const y = 296 + row * 90
      root.add(
        this.add.text(92, y, CHARACTER_NAMES[profile.characterId] ?? profile.characterId, {
          fontFamily: 'Microsoft YaHei',
          fontSize: '18px',
          color: '#f4e7cc',
        }).setOrigin(0.5),
      )

      CHARACTER_VOICE_CUES.forEach((cue, column) => {
        const key = characterVoiceKey(profile.characterId, cue)
        const state = this.slotState(key)
        const color =
          state === 'ready' ? 0x17392d : state === 'silent' ? 0x252a32 : 0x4a2024
        const border =
          state === 'ready' ? 0x5fd19b : state === 'silent' ? 0x596273 : 0xd8656f
        const button = this.add
          .rectangle(firstColumnX + column * columnGap, y, 181, 82, color, 1)
          .setStrokeStyle(2, border)
          .setInteractive({ useHandCursor: true })
        const stateLabel = state === 'ready' ? '已接入' : state === 'silent' ? '静默' : '文件缺失'
        const stateText = this.add
          .text(button.x, y - 15, stateLabel, {
            fontFamily: 'Microsoft YaHei',
            fontSize: '14px',
            color: state === 'ready' ? '#9fffc8' : state === 'silent' ? '#aab3c2' : '#ff9aa2',
          })
          .setOrigin(0.5)
        const keyText = this.add
          .text(button.x, y + 15, key.replace('voice_player_', ''), {
            fontFamily: 'monospace',
            fontSize: '10px',
            color: '#8391a4',
          })
          .setOrigin(0.5)
        button.on(Phaser.Input.Events.POINTER_DOWN, () =>
          this.playVoice(profile.characterId, cue, key),
        )
        root.add([button, stateText, keyText])
      })
    })

    this.statusText = this.add.text(640, 535, '尚未播放', {
      fontFamily: 'Microsoft YaHei',
      fontSize: '15px',
      color: '#f4e7cc',
    }).setOrigin(0.5)
    root.add(this.statusText)

    const minus = this.volumeButton(root, 850, 590, '−')
    const plus = this.volumeButton(root, 905, 590, '+')
    minus.on(Phaser.Input.Events.POINTER_DOWN, () => this.nudgeVolume(-0.1))
    plus.on(Phaser.Input.Events.POINTER_DOWN, () => this.nudgeVolume(0.1))
    this.volumeText = this.add.text(420, 590, '', {
      fontFamily: 'Microsoft YaHei',
      fontSize: '16px',
      color: '#d9c08c',
    }).setOrigin(0, 0.5)
    root.add([minus, plus, this.volumeText])
    this.updateVolumeText()

    const keyboard = this.input.keyboard
    if (keyboard) {
      keyboard.addCapture([Phaser.Input.Keyboard.KeyCodes.MINUS, Phaser.Input.Keyboard.KeyCodes.PLUS])
      keyboard.on('keydown-MINUS', () => this.nudgeVolume(-0.1))
      keyboard.on('keydown-PLUS', () => this.nudgeVolume(0.1))
    }
  }

  private volumeButton(
    root: Phaser.GameObjects.Container,
    x: number,
    y: number,
    label: string,
  ): Phaser.GameObjects.Rectangle {
    const button = this.add
      .rectangle(x, y, 42, 36, 0x1c2530, 1)
      .setStrokeStyle(1, 0x71849d)
      .setInteractive({ useHandCursor: true })
    const text = this.add
      .text(x, y, label, {
        fontFamily: 'Microsoft YaHei',
        fontSize: '22px',
        color: '#f4e7cc',
      })
      .setOrigin(0.5)
    root.add([button, text])
    return button
  }

  private playVoice(characterId: string, cue: CharacterVoiceCue, key: string): void {
    if (this.sound.locked) this.sound.unlock()
    this.voice.setCharacter(characterId)
    const played = this.voice.play(cue)
    const characterName = CHARACTER_NAMES[characterId] ?? characterId
    if (played) {
      this.statusText.setText(`${characterName} · ${CUE_NAMES[cue]} · ${key}`)
      return
    }
    this.statusText.setText(
      this.sound.locked
        ? '浏览器音频尚未解锁：再点一次'
        : `${characterName} · ${CUE_NAMES[cue]} · 未接入或文件未加载`,
    )
  }

  private slotState(key: string): SlotState {
    const asset = findAsset(key)
    if (!asset) return 'missing'
    if (asset.placeholder) return 'silent'
    return this.cache.audio.exists(key) ? 'ready' : 'missing'
  }

  private nudgeVolume(delta: number): void {
    this.volume = Phaser.Math.Clamp(this.volume + delta, 0, 1)
    this.voice.setVolume(this.volume)
    this.updateVolumeText()
  }

  private updateVolumeText(): void {
    this.volumeText.setText(`测试音量 ${Math.round(this.volume * 100)}%  （键盘 - / =）`)
  }
}

export const arena: ArenaDefinition = {
  displayName: 'D1 角色语音测试台',
  description:
    '点击“角色 × 触发点”测试正式角色语音；绿色已接入、灰色静默、红色缺文件。可调测试音量，不会修改正式存档。',
  scene: VoiceLabArena,
}
