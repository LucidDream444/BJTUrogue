import { REWARD_ART, findAsset, imageUrl } from '@/core/assetManifest'
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
    this.root.style.setProperty('--reward-header', `url("${rewardArtUrl(REWARD_ART.header)}")`)
    this.root.hidden = true
    this.root.setAttribute('role', 'dialog')
    this.root.setAttribute('aria-modal', 'true')
    this.root.setAttribute('aria-labelledby', 'd1-reward-title')
    this.style.textContent = `
.d1-reward[hidden]{display:none!important}
.d1-reward{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:18px 30px;overflow:auto;background:radial-gradient(ellipse at 12% 8%,#b9648940,transparent 45%),radial-gradient(ellipse at 88% 72%,#589f8e24,transparent 45%),#101a27ed;backdrop-filter:blur(8px);color:#f2e7d0;font-family:system-ui,'Microsoft YaHei',sans-serif}
.d1-reward *{box-sizing:border-box}
.d1-reward-content{width:min(100%,980px);margin:auto}
.d1-reward-header{text-align:center;position:relative;height:225px;margin:0 auto 0;max-width:850px;background:var(--reward-header) center top/100% 100% no-repeat;filter:drop-shadow(0 8px 16px #0005)}
.d1-reward-kicker{position:absolute;top:104px;left:50%;transform:translateX(-50%);padding:4px 14px;border-radius:3px;background:#172839dd;font-size:12px;color:#f7e8bd;white-space:nowrap}
.d1-reward h1{position:absolute;top:152px;left:31%;width:40%;margin:0;padding:7px 0;background:linear-gradient(90deg,#20304900,#203049 13%,#203049 87%,#20304900);font-family:'KaiTi','SimSun',serif;font-size:29px;letter-spacing:4px;color:#ffe6ae;text-shadow:0 2px 4px #000}
.d1-reward-intro{position:absolute;top:226px;width:100%;font-size:12px;color:#bdc9ce;margin:0}
.d1-reward-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px;align-items:start;padding:26px 28px 0}
.d1-reward-card{--accent:#8bccff;position:relative;aspect-ratio:372/720;padding:0;border:0;border-radius:12px;background:transparent;color:#3e3529;font:inherit;cursor:pointer;filter:drop-shadow(0 12px 18px #0007);transition:transform .18s,filter .18s}
.d1-reward-art{position:absolute;inset:0;width:100%;height:100%;object-fit:fill;pointer-events:none}
.d1-reward-card[data-category=survival]{--accent:#a4e979}
.d1-reward-card[data-category=firepower]{--accent:#ffc77b}
.d1-reward-card:hover,.d1-reward-card:focus-visible{transform:translateY(-7px);filter:drop-shadow(0 0 9px var(--accent)) drop-shadow(0 15px 19px #0008);outline:none}
.d1-reward-card:disabled{opacity:.6;cursor:default;transform:none}
.d1-reward-card-top{position:absolute;top:13%;left:10%;right:10%;display:flex;align-items:center;justify-content:space-between;font-size:11px;color:#f9eccc;letter-spacing:1px}
.d1-reward-key{width:25px;height:25px;border:1px solid #d0b67c;border-radius:4px;background:#142432aa;display:grid;place-items:center}
.d1-reward-copy{position:absolute;top:64.2%;left:9%;right:9%;bottom:8%;display:flex;flex-direction:column;text-align:center;line-height:1.25}
.d1-reward-name{font-size:23px;font-family:'KaiTi','SimSun',serif;font-weight:700;letter-spacing:1px}
.d1-reward-headline{margin:5px 0 6px;color:#71512e;font-size:14px;font-weight:650}
.d1-reward-stat{display:flex;justify-content:space-between;gap:4px;padding:3px 0;border-top:1px solid #94764740;font-size:12px;font-variant-numeric:tabular-nums}
.d1-reward-stat strong{color:#285d50;white-space:nowrap}
.d1-reward-detail{font-size:12px;line-height:1.4;margin:4px 0;color:#685e4e}
.d1-reward-card-bottom{display:flex;align-items:center;justify-content:space-between;margin-top:auto;font-size:11px;color:#75664f;border-top:1px solid #94764740;padding-top:4px}
.d1-reward-card-bottom b{color:#705027;font-size:11px}
.d1-reward-footer{font-size:12px;line-height:1.7;text-align:center;color:#b9c2c7;margin:16px 0 0}
@media(min-width:900px) and (max-height:800px){.d1-reward-content{max-width:820px}.d1-reward-header{height:145px;max-width:550px}.d1-reward-kicker{top:54px}.d1-reward h1{top:94px;font-size:20px}.d1-reward-intro{top:145px}.d1-reward-name{font-size:18px}.d1-reward-detail{font-size:10px}.d1-reward-headline{margin:3px 0;font-size:11px}.d1-reward-copy{top:64.2%}.d1-reward-cards{gap:18px}.d1-reward-footer{margin-top:9px}}
@media(max-width:650px){.d1-reward{padding:12px}.d1-reward-header{height:155px}.d1-reward-kicker{top:65px;font-size:10px}.d1-reward h1{top:103px;font-size:19px;letter-spacing:1px}.d1-reward-intro{top:145px;font-size:10px}.d1-reward-cards{grid-template-columns:1fr;padding:14px 0;gap:16px}.d1-reward-card{width:min(100%,320px);justify-self:center}.d1-reward-name{font-size:23px}.d1-reward-headline{font-size:14px}.d1-reward-stat,.d1-reward-detail{font-size:12px}.d1-reward-card-bottom,.d1-reward-card-bottom b{font-size:11px}.d1-reward-card:hover,.d1-reward-card:focus-visible{transform:none}}
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
      const art = document.createElement('img')
      art.className = 'd1-reward-art'
      const artKey =
        r.id === 'sneakers'
          ? REWARD_ART.speed
          : r.id === 'tempo'
            ? REWARD_ART.utility
            : r.category === 'survival'
              ? REWARD_ART.survival
              : r.category === 'firepower'
                ? REWARD_ART.firepower
                : REWARD_ART.utility
      art.src = rewardArtUrl(artKey)
      art.alt = ''
      art.draggable = false
      const copy = document.createElement('div')
      copy.className = 'd1-reward-copy'
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
      copy.append(name, headline, ...changes, detail, bottom)
      button.append(art, top, copy)
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

function rewardArtUrl(key: string): string {
  const entry = findAsset(key)
  if (!entry) throw new Error('缺少奖励界面素材：' + key)
  return imageUrl(entry)
}
