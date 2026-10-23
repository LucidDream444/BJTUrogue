/**
 * **电梯的楼层选择面板**（★ 2026-10-23，用户：「进去后可以选择楼层（之后楼层比较多），
 * 不然和楼梯没区别」）。
 *
 * ## 为什么是「面板」而不是「地上那几个方框」
 *
 * 上一版电梯里摆的是一列方框（一个可去的层一个），走到方框上按 `F` —— 那和楼梯间
 * 那两个方框**是同一个交互**，用户的原话就是「不然和楼梯没区别」。而且方框是
 * **按位置**选的：八个方框排开之后，「第 5 层」在哪儿全靠数，楼层一多就站不下了。
 *
 * 现在是：**走进电梯间就弹出这个面板**，一列楼层，点一下（或按数字键）就去。
 * 楼层数再多也只是列表变长 —— 面板本身是 DOM，滚动是免费的。
 *
 * ## 与 `RewardPanel` 的关系
 *
 * 同一套写法（DOM + 内联样式 + `stopImmediatePropagation` + 数字键 + 可点）。
 * 有意各写一个类而不是抽公共父类：两者的**生命周期**完全不同（强化面板是
 * 「清完房弹一次、选完关掉」，电梯是「站在电梯间里就一直开着、走出去才关」），
 * 抽出来只会让两边都多一层 if。
 *
 * ## ⚠️ 不暂停游戏
 *
 * 面板开着的时候世界照常走（与 `RewardPanel` 一致）。电梯间是非战斗房、里面不刷怪，
 * 而且**玩家随时能走出去**（走出去面板就关）—— 所以「开面板时被打」这件事不会发生；
 * 真要发生，玩家能立刻走开，不需要额外一道暂停。
 */
export interface FloorRow {
  /** 第几层（1 起） */
  readonly floor: number
  /** 现在是哪一层 —— 那一行画成「当前」，不可选 */
  readonly here: boolean
  /** 去过 / 楼梯间那一步能到（判据在 `BattleScene.elevatorTargets()`） */
  readonly unlocked: boolean
}

export class ElevatorPanel {
  private readonly root = document.createElement('div')
  private readonly style = document.createElement('style')
  private readonly onChoose: (floor: number) => void
  private rows: readonly FloorRow[] = []
  private previousFocus: HTMLElement | null = null

  constructor(onChoose: (floor: number) => void) {
    this.onChoose = onChoose
    this.root.className = 'd1-elevator'
    this.root.hidden = true
    this.root.setAttribute('role', 'dialog')
    this.root.setAttribute('aria-modal', 'true')
    this.root.setAttribute('aria-labelledby', 'd1-elevator-title')
    this.style.textContent = `
.d1-elevator[hidden]{display:none!important}
.d1-elevator{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:24px;overflow:auto;background:#07131cd0;backdrop-filter:blur(6px);color:#edf6ff;font-family:system-ui,'Microsoft YaHei',sans-serif}
.d1-elevator *{box-sizing:border-box}
.d1-elevator-content{width:min(100%,460px);margin:auto;border:1px solid #53657d80;border-radius:18px;background:linear-gradient(160deg,#16283c,#0a1624);box-shadow:0 18px 48px #0006;padding:22px 22px 16px}
.d1-elevator-kicker{display:inline-block;color:#9cd6ff;border:1px solid #538dbd70;border-radius:999px;padding:5px 13px;font-size:12px;letter-spacing:2px;background:#102a3f80}
.d1-elevator h1{font-size:24px;letter-spacing:3px;margin:12px 0 6px}
.d1-elevator-intro{color:#9fb3c7;font-size:13px;margin:0 0 16px;line-height:1.6}
.d1-elevator-list{display:flex;flex-direction:column;gap:9px;max-height:52vh;overflow:auto}
.d1-elevator-row{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;text-align:left;font:inherit;color:inherit;border:1px solid #53657d70;border-radius:11px;padding:12px 15px;background:#0e1c2c;cursor:pointer;transition:border-color .14s,background .14s,transform .14s}
.d1-elevator-row:hover:not(:disabled),.d1-elevator-row:focus-visible:not(:disabled){border-color:#7cdfff;background:#152a3e;transform:translateX(3px);outline:none}
.d1-elevator-row:disabled{cursor:default;opacity:.45}
.d1-elevator-row[data-here=true]{border-color:#ffc46b;background:#1d2635;opacity:1}
.d1-elevator-name{font-size:17px;letter-spacing:1px}
.d1-elevator-tag{font-size:12px;letter-spacing:1px;color:#9fb3c7;border:1px solid #53657d70;border-radius:6px;padding:2px 8px;white-space:nowrap}
.d1-elevator-row[data-here=true] .d1-elevator-tag{color:#ffd694;border-color:#ffc46b70}
.d1-elevator-key{display:inline-grid;place-items:center;width:22px;height:22px;margin-right:9px;border:1px solid #758da550;border-radius:5px;background:#0b1728;font-size:12px;color:#cfe4f6;vertical-align:2px}
.d1-elevator-footer{color:#7f97ab;font-size:12px;margin:14px 0 0;line-height:1.7;text-align:center}
`
    document.head.append(this.style)
    document.body.append(this.root)
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation())
    document.addEventListener('keydown', this.onKey, true)
  }

  get visible(): boolean {
    return !this.root.hidden
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    if (this.root.hidden) return
    // 与 `RewardPanel` 一样：面板开着的时候别让数字键去换枪、别让空格去冲。
    event.stopImmediatePropagation()
    if (/^[1-9]$/.test(event.key)) {
      event.preventDefault()
      if (event.repeat) return
      const row = this.rows[Number(event.key) - 1]
      if (row !== undefined && !row.here && row.unlocked) this.pick(row.floor)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      this.hide()
    }
  }

  private pick(floor: number): void {
    if (this.root.hidden) return
    this.hide()
    this.onChoose(floor)
  }

  /** 摆出一列楼层。**同一份内容重复调用不会重建 DOM**（只在楼层数变了时重建）。 */
  show(rows: readonly FloorRow[]): void {
    const same =
      rows.length === this.rows.length &&
      rows.every((r, i) => r.floor === this.rows[i]!.floor && r.unlocked === this.rows[i]!.unlocked && r.here === this.rows[i]!.here)
    this.rows = rows
    if (same) {
      this.root.hidden = false
      return
    }
    const list = rows
      .map((r) => {
        const tag = r.here ? '当前' : r.unlocked ? '前往' : '未解锁'
        const key = r.unlocked && !r.here ? `<span class="d1-elevator-key">${r.floor}</span>` : ''
        const disabled = !r.unlocked || r.here ? ' disabled' : ''
        return (
          `<button class="d1-elevator-row" data-floor="${r.floor}" data-here="${r.here}"${disabled}>` +
          `<span class="d1-elevator-name">${key}第 ${r.floor} 层</span>` +
          `<span class="d1-elevator-tag">${tag}</span></button>`
        )
      })
      .join('')
    this.root.innerHTML =
      `<div class="d1-elevator-content">` +
      `<span class="d1-elevator-kicker">电梯 · 选择楼层</span>` +
      `<h1 id="d1-elevator-title">去哪一层？</h1>` +
      `<p class="d1-elevator-intro">只列出<b>已经解锁</b>的层（走到的层，和楼梯间那一步能到的下一层）。</p>` +
      `<div class="d1-elevator-list">${list}</div>` +
      `<p class="d1-elevator-footer">按数字键或点击 · 走出电梯间自动关掉</p>` +
      `</div>`
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('button[data-floor]')) {
      button.addEventListener('click', () => this.pick(Number(button.dataset.floor)))
    }
    this.root.hidden = false
    // 焦点给第一个能点的行（键盘玩家不用先 Tab 一圈）。
    this.previousFocus = document.activeElement as HTMLElement | null
    this.root.querySelector<HTMLButtonElement>('button[data-floor]:not(:disabled)')?.focus()
  }

  hide(): void {
    if (this.root.hidden) return
    this.root.hidden = true
    this.previousFocus?.focus?.()
    this.previousFocus = null
  }

  destroy(): void {
    this.style.remove()
    this.root.remove()
  }
}
