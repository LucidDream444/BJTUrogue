/** Notebook-styled elevator selector. Travel eligibility remains owned by BattleScene. */
import { ARCHIVE_ART, findAsset, imageUrl } from '@/core/assetManifest'
import { ARCHIVE_THEME as A, THEME } from '../meta/ui/theme'

export interface FloorRow {
  readonly floor: number
  readonly here: boolean
  readonly unlocked: boolean
}

export class ElevatorPanel {
  private readonly root = document.createElement('div')
  private readonly style = document.createElement('style')
  private readonly onChoose: (floor: number) => void
  private rows: readonly FloorRow[] = []
  private previousFocus: HTMLElement | null = null
  /** Esc/continue walking dismisses this visit; leaving the elevator resets it. */
  private dismissed = false

  constructor(onChoose: (floor: number) => void) {
    this.onChoose = onChoose
    this.root.className = 'd1-elevator'
    this.root.hidden = true
    this.root.setAttribute('role', 'dialog')
    // The world is not paused: WASD must continue to reach the game.
    this.root.setAttribute('aria-modal', 'false')
    this.root.setAttribute('aria-labelledby', 'd1-elevator-title')
    this.root.style.setProperty('--elevator-book', `url("${artUrl(ARCHIVE_ART.dark)}")`)
    this.style.textContent = `
.d1-elevator[hidden]{display:none!important}
.d1-elevator{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:24px;overflow-x:hidden;overflow-y:auto;background:#101827dd;backdrop-filter:blur(5px);color:${A.paper};font-family:${THEME.font.family}}
.d1-elevator *{box-sizing:border-box;min-width:0}
.d1-elevator-content{position:relative;width:min(100%,1120px);margin:auto;padding:75px 7% 58px;background:var(--elevator-book) center/100% 100% no-repeat;filter:drop-shadow(0 24px 45px #0005)}
.d1-elevator-header{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:36px}
.d1-elevator h1{margin:0 0 10px;font-family:${A.font};font-weight:700;font-size:clamp(28px,3vw,40px);letter-spacing:3px}
.d1-elevator-kicker{color:${A.muted};font-size:12px;letter-spacing:2px}
.d1-elevator-close{flex:none;color:${A.paper};font:inherit;font-size:13px;padding:10px 16px;margin-right:8%;border:1px solid #7585a080;background:#222c43ba;border-radius:3px;cursor:pointer}
.d1-elevator-body{display:grid;grid-template-columns:240px minmax(0,1fr);gap:46px}
.d1-elevator-guide{text-align:center;padding:8px 0 20px}
.d1-elevator-current-label{margin:0;color:${A.muted};font-size:13px;letter-spacing:4px}
.d1-elevator-current{margin:12px 0 0;font-family:${A.font};font-size:76px;line-height:1;color:${A.paper};text-shadow:0 0 26px #7bcfff35;font-variant-numeric:tabular-nums}
.d1-elevator-current span{font-size:26px;color:${A.muted};margin-left:6px}
.d1-elevator-seal{display:block;width:77px;height:88px;object-fit:contain;margin:23px auto 18px}
.d1-elevator-guide h2{font-family:${A.font};font-size:23px;font-weight:700;margin:0 0 14px}
.d1-elevator-intro{margin:0 auto;color:${A.muted};font-size:13px;line-height:1.9;max-width:225px}
.d1-elevator-guide strong{color:${A.energy};font-weight:500}
.d1-elevator-directory{padding:0 0 14px}
.d1-elevator-directory-title{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:0 0 15px;padding-bottom:12px;border-bottom:1px solid #7585a04d;color:${A.muted};font-size:12px}
.d1-elevator-directory-title b{color:${A.paper};font-size:18px;font-weight:500}
.d1-elevator-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;max-height:365px;overflow-x:hidden;overflow-y:auto;scrollbar-width:thin;scrollbar-color:#7585a0 #171d30;padding:3px 5px 5px 3px}
.d1-elevator-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px;width:100%;min-height:74px;text-align:left;font:inherit;color:${A.paper};border:1px solid #7585a066;border-radius:5px;padding:15px;background:linear-gradient(135deg,#25334bce,#182238ed);cursor:pointer;transition:border-color .15s,box-shadow .15s,background .15s}
.d1-elevator-row:hover:not(:disabled),.d1-elevator-row:focus-visible:not(:disabled),.d1-elevator-close:hover,.d1-elevator-close:focus-visible{border-color:${A.energy};background:#283d58;box-shadow:inset 0 0 15px #7bcfff16,0 0 9px #7bcfff12;outline:1px solid ${A.energy};outline-offset:-1px}
.d1-elevator-row:disabled{cursor:default;color:${A.dim};background:#171d3090}
.d1-elevator-row[data-here=true]{color:${A.paper};border-color:#a1c5df;background:linear-gradient(135deg,#354c6c,#263550);box-shadow:inset 3px 0 ${A.energy}}
.d1-elevator-name{font-family:${A.font};font-size:23px;letter-spacing:1px;white-space:nowrap}
.d1-elevator-tag{font-size:11px;letter-spacing:1px;white-space:nowrap;color:${A.muted}}
.d1-elevator-row[data-here=true] .d1-elevator-tag{color:${A.energy}}
.d1-elevator-row[data-unlocked=false]:not([data-here=true]) .d1-elevator-tag{color:${A.dim}}
.d1-elevator-number{font-family:${THEME.font.family};font-size:14px;margin-right:10px;opacity:.7}
.d1-elevator-footer{margin:28px 0 0 286px;border-top:1px solid #7585a04d;padding-top:14px;color:${A.muted};font-size:12px;line-height:1.7}
@media(min-width:761px) and (max-height:700px){.d1-elevator-content{padding-top:53px;padding-bottom:46px}.d1-elevator-header{margin-bottom:20px}.d1-elevator-list{max-height:300px;gap:9px}.d1-elevator-row{min-height:62px;padding:12px}.d1-elevator-current{font-size:58px}.d1-elevator-seal{height:65px;width:60px;margin:15px auto}.d1-elevator-footer{margin-top:15px}}
@media(min-width:761px) and (max-width:1050px){.d1-elevator-body{grid-template-columns:180px minmax(0,1fr);gap:24px}.d1-elevator-number{display:none}.d1-elevator-current-label{font-size:11px;letter-spacing:1px}.d1-elevator-guide{padding-top:0}.d1-elevator-guide h2{font-size:20px}.d1-elevator-intro{font-size:12px;line-height:1.7}.d1-elevator-footer{margin-left:204px;font-size:11px}.d1-elevator-row{flex-wrap:nowrap;min-height:60px}.d1-elevator-seal{height:52px;margin:12px auto}.d1-elevator-current{font-size:52px}}
@media(max-width:760px){.d1-elevator{padding:10px}.d1-elevator-content{padding:72px 7% 70px}.d1-elevator-header{margin-bottom:24px;gap:10px}.d1-elevator-close{margin-right:0;font-size:11px;padding:8px}.d1-elevator-body{grid-template-columns:1fr;gap:22px}.d1-elevator-guide{display:grid;grid-template-columns:105px minmax(0,1fr);text-align:left;column-gap:18px;padding:0}.d1-elevator-current-label{grid-column:1;font-size:11px;letter-spacing:1px}.d1-elevator-current{grid-column:1;grid-row:2/4;font-size:50px}.d1-elevator-current span{font-size:18px}.d1-elevator-seal{display:none}.d1-elevator-guide h2{grid-column:2;grid-row:1/3;font-size:21px;margin:0 0 7px}.d1-elevator-intro{grid-column:2;grid-row:3;margin:0;max-width:none;font-size:12px}.d1-elevator-list{max-height:340px;gap:9px}.d1-elevator-row{padding:11px;min-height:65px}.d1-elevator-name{font-size:21px}.d1-elevator-number{display:none}.d1-elevator-footer{margin:20px 0 0;font-size:11px;background:#171d30e8;border-radius:4px;padding:10px}.d1-elevator-kicker{font-size:10px;letter-spacing:1px}}
@media(prefers-reduced-motion:reduce){.d1-elevator-row{transition:none}}
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
    if (/^[1-9]$/.test(event.key)) {
      event.stopImmediatePropagation()
      event.preventDefault()
      if (!event.repeat) {
        const row = this.rows.find((row) => row.floor === Number(event.key))
        if (row?.unlocked && !row.here) this.pick(row.floor)
      }
    } else if (event.key === 'Escape') {
      event.stopImmediatePropagation()
      event.preventDefault()
      this.dismiss()
    } else if (event.key === 'Tab') {
      event.stopImmediatePropagation()
      event.preventDefault()
      const choices = [...this.root.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      const index = choices.indexOf(document.activeElement as HTMLButtonElement)
      choices[(index + (event.shiftKey ? choices.length - 1 : 1)) % choices.length]?.focus({
        preventScroll: true,
      })
    } else if (event.key === ' ' || event.key === 'Enter') {
      // Preserve native button activation while preventing skill/menu shortcuts underneath.
      event.stopImmediatePropagation()
      if (!this.root.contains(document.activeElement)) event.preventDefault()
    }
    // Movement keys intentionally fall through so walking out still closes the panel.
  }

  private pick(floor: number): void {
    const row = this.rows.find((row) => row.floor === floor)
    if (this.root.hidden || !row?.unlocked || row.here) return
    this.hide()
    this.onChoose(floor)
  }

  private dismiss(): void {
    this.hide()
    this.dismissed = true
  }

  show(rows: readonly FloorRow[]): void {
    const same =
      rows.length === this.rows.length &&
      rows.every(
        (r, i) =>
          r.floor === this.rows[i]!.floor &&
          r.here === this.rows[i]!.here &&
          r.unlocked === this.rows[i]!.unlocked,
      )
    this.rows = rows
    if (this.dismissed && same) return
    this.dismissed = false
    const opening = this.root.hidden
    if (opening)
      this.previousFocus =
        document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!same || !this.root.childElementCount) this.render()
    this.root.hidden = false
    if (opening)
      this.root
        .querySelector<HTMLButtonElement>('button[data-floor]:not(:disabled)')
        ?.focus({ preventScroll: true })
  }

  private render(): void {
    const here = this.rows.find((row) => row.here)
    const available = this.rows.filter((row) => row.unlocked && !row.here).length
    const list = this.rows
      .map((row) => {
        const disabled = row.here || !row.unlocked
        return (
          `<button type="button" class="d1-elevator-row" data-floor="${row.floor}" data-here="${row.here}" data-unlocked="${row.unlocked}"${disabled ? ' disabled' : ''}${row.here ? ' aria-current="location"' : ''} aria-label="第 ${row.floor} 层，${row.here ? '当前楼层' : row.unlocked ? '可前往' : '未解锁'}">` +
          `<span class="d1-elevator-name"><span class="d1-elevator-number" aria-hidden="true">${String(row.floor).padStart(2, '0')}</span>第 ${row.floor} 层</span>` +
          `<span class="d1-elevator-tag">${row.here ? '◆ 当前' : row.unlocked ? '前往 ↗' : '未解锁'}</span></button>`
        )
      })
      .join('')
    this.root.innerHTML = `<section class="d1-elevator-content">
      <header class="d1-elevator-header"><div><h1 id="d1-elevator-title">楼层导览</h1><span class="d1-elevator-kicker">课后勇者 / 校园电梯</span></div><button type="button" class="d1-elevator-close">继续步行 ×</button></header>
      <div class="d1-elevator-body"><aside class="d1-elevator-guide"><p class="d1-elevator-current-label">当前楼层 / CURRENT</p><p class="d1-elevator-current">${here ? String(here.floor).padStart(2, '0') : '—'}<span>F</span></p><img class="d1-elevator-seal" src="${artUrl(ARCHIVE_ART.seal)}" alt="" draggable="false"><h2>下一站，去哪里？</h2><p class="d1-elevator-intro">已到达的楼层与当前可到达的下一层可乘梯前往。<br><strong>${available ? '选择一层，继续探索。' : '暂时没有其他可前往的楼层。'}</strong></p></aside>
      <div class="d1-elevator-directory"><div class="d1-elevator-directory-title"><b>楼层目录</b><span>${available} 层可前往 / 共 ${this.rows.length} 层</span></div><div class="d1-elevator-list">${list}</div></div></div>
      <p class="d1-elevator-footer">点击楼层或按对应数字键 1–9 前往<br>WASD 继续移动 · 走出电梯自动关闭 · Esc 收起面板</p></section>`
    this.root.querySelector('.d1-elevator-close')?.addEventListener('click', () => this.dismiss())
    this.root
      .querySelectorAll<HTMLButtonElement>('button[data-floor]')
      .forEach((button) =>
        button.addEventListener('click', () => this.pick(Number(button.dataset.floor))),
      )
  }

  hide(): void {
    this.dismissed = false
    if (this.root.hidden) return
    this.root.hidden = true
    if (this.previousFocus?.isConnected) this.previousFocus.focus({ preventScroll: true })
    this.previousFocus = null
  }

  destroy(): void {
    this.hide()
    document.removeEventListener('keydown', this.onKey, true)
    this.style.remove()
    this.root.remove()
  }
}

function artUrl(key: string): string {
  const asset = findAsset(key)
  if (!asset) throw new Error(`缺少电梯界面资源：${key}`)
  return imageUrl(asset)
}
