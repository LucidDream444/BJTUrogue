import { campusAsset } from './uiSkin'
import type { CombatSession } from './CombatSession'

/** One atomic choice per cleared round; only this modal consumes its keyboard shortcuts. */
export class RewardPanel {
  readonly root = document.createElement('div')
  private readonly off: (() => void)[] = []
  private readonly style = document.createElement('style')
  private previousFocus: HTMLElement | null = null
  private locked = false
  private activeRoom: string | null = null

  constructor(private readonly session: CombatSession) {
    this.root.className = 'd1-reward'
    this.root.hidden = true
    this.root.setAttribute('role', 'dialog')
    this.root.setAttribute('aria-modal', 'true')
    this.root.setAttribute('aria-labelledby', 'd1-reward-title')
    this.style.textContent = `
.d1-reward[hidden]{display:none!important}
.d1-reward{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:32px;overflow:auto;background:radial-gradient(ellipse at 50% 15%,#183d4780,transparent 60%),#07131ce8;backdrop-filter:blur(7px);color:#edf6ff;font-family:system-ui,'Microsoft YaHei',sans-serif}
.d1-reward *{box-sizing:border-box}
.d1-reward-content{width:min(100%,1000px);margin:auto}
.d1-reward-header{text-align:center;margin-bottom:28px}
.d1-reward-kicker{display:inline-block;color:#83efc6;border:1px solid #538d7b70;border-radius:999px;padding:7px 16px;font-size:13px;letter-spacing:2px;background:#102f2980}
.d1-reward h1{font-size:clamp(26px,4vw,38px);letter-spacing:4px;margin:15px 0 10px}
.d1-reward-intro{color:#a4b7c9;font-size:14px;margin:0}
.d1-reward-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}
.d1-reward-card{--accent:#7cdfff;position:relative;text-align:left;color:inherit;font:inherit;border:1px solid #53657d70;border-top:3px solid var(--accent);border-radius:17px;padding:22px 22px 18px;background:linear-gradient(145deg,#1c2d42,#0e1b2c);box-shadow:0 16px 38px #0003;min-height:354px;display:flex;flex-direction:column;gap:0;transition:transform .16s,border-color .16s,background .16s}
.d1-reward-card:hover,.d1-reward-card:focus-visible{transform:translateY(-6px);border-color:var(--accent);background:linear-gradient(145deg,#233c51,#15293d);outline:2px solid color-mix(in srgb,var(--accent) 30%,transparent);outline-offset:3px}
.d1-reward-card:disabled{opacity:.55;transform:none}
.d1-reward-card[data-category=survival]{--accent:#f5a5dc}
.d1-reward-card[data-category=firepower]{--accent:#ffc879}
.d1-reward-card[data-category=utility]{--accent:#89dfff}
.d1-reward-card-top{display:flex;justify-content:space-between;align-items:center;color:var(--accent);font-size:12px;letter-spacing:1px}
.d1-reward-key{border:1px solid #758da550;border-radius:6px;width:26px;height:26px;display:grid;place-items:center;background:#0b1728}
.d1-reward-icon{height:66px;width:66px;object-fit:contain;align-self:center;margin:20px 0 15px;filter:drop-shadow(0 0 14px #c0e6ff25)}
.d1-reward-name{font-size:23px;letter-spacing:1px}
.d1-reward-headline{color:var(--accent);font-size:15px;font-weight:650;margin:9px 0 12px}
.d1-reward-stat{border-radius:9px;background:#06111d8c;padding:11px 12px;margin-bottom:12px;font-size:13px;display:flex;align-items:center;justify-content:space-between;gap:8px;font-variant-numeric:tabular-nums}
.d1-reward-stat span{color:#9cafc4}
.d1-reward-stat strong{white-space:nowrap;color:#f2f9ff}
.d1-reward-detail{color:#aabed0;font-size:12px;line-height:1.7;margin:0 0 18px;min-height:40px}
.d1-reward-card-bottom{display:flex;justify-content:space-between;align-items:center;margin-top:auto;padding-top:13px;border-top:1px solid #7892ac25;font-size:12px;color:#98adbf}
.d1-reward-card-bottom b{color:var(--accent);font-size:13px}
.d1-reward-footer{text-align:center;color:#8099ad;font-size:12px;margin:22px 0 0;line-height:1.7}
@media(max-width:650px){.d1-reward{padding:16px}.d1-reward-header{margin-bottom:18px}.d1-reward-cards{grid-template-columns:1fr;gap:12px}.d1-reward-card{min-height:0;padding:14px 17px;display:grid;grid-template-columns:58px 1fr;column-gap:14px}.d1-reward-card-top{grid-column:1/-1;margin-bottom:10px}.d1-reward-icon{grid-column:1;grid-row:2/5;width:56px;height:56px;margin:0}.d1-reward-name,.d1-reward-headline,.d1-reward-stat,.d1-reward-detail{grid-column:2}.d1-reward-name{font-size:19px}.d1-reward-headline{margin:4px 0 7px}.d1-reward-stat{margin:0 0 5px;padding:8px;font-size:11px}.d1-reward-detail{margin:0;min-height:0;font-size:11px}.d1-reward-card-bottom{grid-column:1/-1;margin-top:10px;padding-top:9px}.d1-reward h1{margin:9px 0}.d1-reward-card:hover,.d1-reward-card:focus-visible{transform:none}}
@media(prefers-reduced-motion:reduce){.d1-reward-card{transition:none;transform:none!important}}
`
    document.head.append(this.style)
    document.body.append(this.root)
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation())
    document.addEventListener('keydown', this.onKey, true)
    this.off.push(
      session.bus.on('reward_offered', (e) => this.show(e.roomId)),
      session.bus.on('reward_finished', () => this.hide()),
    )
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    if (this.root.hidden) return
    // Keep the game shortcuts from restarting, moving or firing behind the choice screen.
    event.stopImmediatePropagation()
    if (['1', '2', '3'].includes(event.key)) {
      event.preventDefault()
      if (!event.repeat) {
        const option = this.session.rewards.offered[Number(event.key) - 1]
        if (option) this.select(option.id, this.activeRoom)
      }
    } else if (event.key === 'Tab') {
      event.preventDefault()
      const buttons = [...this.root.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      if (!buttons.length) return
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      buttons[(index + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length]?.focus()
    } else if (event.key === 'Escape' || event.key === ' ') {
      event.preventDefault()
    }
  }

  private select(id: string, room: string | null): void {
    if (this.locked || room === null || this.session.rewards.roomId !== room) return
    this.locked = true
    const buttons = this.root.querySelectorAll<HTMLButtonElement>('button')
    for (const button of buttons) button.disabled = true
    if (!this.session.choose(id)) {
      this.locked = false
      for (const button of buttons) button.disabled = false
    }
  }

  private show(roomId: string): void {
    const options = this.session.rewards.offered
    if (!options.length) return this.hide()
    this.activeRoom = roomId
    this.locked = false
    this.previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    this.root.replaceChildren()
    this.root.hidden = false
    const content = document.createElement('section')
    content.className = 'd1-reward-content'
    const header = document.createElement('header')
    header.className = 'd1-reward-header'
    const badge = document.createElement('span')
    badge.className = 'd1-reward-kicker'
    // ⚠️ **`/(\d+)$/` 曾经在这儿，它现在是个陷阱。**
    //    那个式子从 `d1-room-7` 里抠出「7」当轮次，而整层连续之后房号是
    //    `YF604` —— 同一个式子会抠出 **604**，界面上写着「第 604 轮 · 清怪完成」。
    //    它**不抛异常、不落在兜底分支上**（604 是个有限的正数），所以只在画面上看着荒谬。
    //    改成只认**完整形状**：`d1-room-<数字>` 才算「第 n 轮」（老宿主 / 测试场那份），
    //    其余一律把房号原样印出来 —— 房号本来就是个名字，比一个假轮次有信息量。
    const legacy = roomId.match(/^d1-room-(\d+)$/)
    badge.textContent = legacy ? `第 ${legacy[1]} 轮 · 清怪完成` : `${roomId} · 清怪完成`
    const title = document.createElement('h1')
    title.id = 'd1-reward-title'
    title.textContent = '选择你的成长'
    const intro = document.createElement('p')
    intro.className = 'd1-reward-intro'
    intro.textContent = '三选一 · 强化持续整局 · 选择后进入下一轮'
    header.append(badge, title, intro)
    const cards = document.createElement('div')
    cards.className = 'd1-reward-cards'
    options.forEach((r, index) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'd1-reward-card'
      button.dataset.rewardId = r.id
      button.dataset.category = r.category ?? 'utility'
      const top = document.createElement('div')
      top.className = 'd1-reward-card-top'
      const category = document.createElement('span')
      category.textContent =
        r.category === 'survival'
          ? '生存成长'
          : r.category === 'firepower'
            ? '火力强化'
            : '战斗辅助'
      const key = document.createElement('span')
      key.className = 'd1-reward-key'
      key.textContent = String(index + 1)
      top.append(category, key)
      const icon = document.createElement('img')
      icon.className = 'd1-reward-icon'
      icon.src = campusAsset(r.icon ?? 'energy')
      icon.alt = ''
      icon.draggable = false
      const name = document.createElement('strong')
      name.className = 'd1-reward-name'
      name.textContent = r.name
      const headline = document.createElement('p')
      headline.className = 'd1-reward-headline'
      headline.textContent = r.headline ?? r.description
      const changes = this.session.rewardChanges(r).map((change) => {
        const row = document.createElement('div')
        row.className = 'd1-reward-stat'
        const label = document.createElement('span')
        label.textContent = change.label
        const values = document.createElement('strong')
        values.textContent = `${change.before} → ${change.after}`
        row.append(label, values)
        return row
      })
      const detail = document.createElement('p')
      detail.className = 'd1-reward-detail'
      detail.textContent = r.description
      const bottom = document.createElement('div')
      bottom.className = 'd1-reward-card-bottom'
      const stacks = document.createElement('span')
      stacks.textContent = `已选 ${this.session.rewards.stacks.get(r.id) ?? 0} 次${r.maxStacks ? ' / ' + r.maxStacks : ' · 可重复强化'}`
      const action = document.createElement('b')
      action.textContent = '选择强化 →'
      bottom.append(stacks, action)
      button.append(top, icon, name, headline, ...changes, detail, bottom)
      button.addEventListener('click', () => this.select(r.id, roomId))
      cards.append(button)
    })
    const footer = document.createElement('p')
    footer.className = 'd1-reward-footer'
    footer.textContent =
      '点击卡片或按 1 / 2 / 3 选择 · 选择期间战斗暂停 · 强化持续整局 · 最多携带两把武器'
    content.append(header, cards, footer)
    this.root.append(content)
    cards.querySelector('button')?.focus({ preventScroll: true })
  }
  private hide(): void {
    this.root.hidden = true
    this.activeRoom = null
    this.root.replaceChildren()
    if (this.previousFocus?.isConnected) this.previousFocus.focus({ preventScroll: true })
    this.previousFocus = null
  }
  destroy(): void {
    for (const off of this.off) off()
    document.removeEventListener('keydown', this.onKey, true)
    this.root.remove()
    this.style.remove()
  }
}
