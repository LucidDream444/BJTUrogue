import type { PlaygroundConfig, TalentEffect, TalentPlayground } from './_TalentPlaygroundModel'
import './_talent-playground.css'

const glyphs: Record<string, string> = {
  split:
    '<path d="M14 45 29 30m0 0L28 13m1 17 18-2M14 45l9-3m-9 3 3-9"/><path d="m23 18 5-5 5 5m8 5 6 5-6 5"/>',
  homing: '<circle cx="39" cy="21" r="9"/><path d="M10 48c25 0 8-27 29-27m-7-6 7 6-7 6"/>',
  crit: '<path d="m32 7 6 15 16 4-13 10 1 17-14-9-16 6 5-17-10-13 17-1Z"/>',
  bounce: '<path d="M10 47 28 13l17 34M10 14v33h39m-9-8 5 8 5-8"/>',
  pierce: '<path d="M9 32h45m-9-9 9 9-9 9M22 15v34m13-34v34"/>',
  scatter: '<path d="m10 32 42-19M10 32h44M10 32l42 19m-7-41 7 3-3 7m-3 26 6 5-7 3"/>',
  lightning: '<path d="m35 6-20 29h16l-4 23 23-32H34Z"/>',
  chain:
    '<circle cx="13" cy="39" r="7"/><circle cx="33" cy="17" r="7"/><circle cx="51" cy="43" r="7"/><path d="m18 33 10-11m10 1 9 14"/>',
  return: '<path d="M12 23c15-20 42-6 38 12-2 15-28 20-36 3m0 0 1 12m-1-12 13 1"/>',
  orbit:
    '<circle cx="32" cy="32" r="8"/><ellipse cx="32" cy="32" rx="26" ry="13" transform="rotate(-35 32 32)"/><circle cx="51" cy="18" r="4"/>',
  blackhole:
    '<ellipse cx="32" cy="32" rx="25" ry="12" transform="rotate(-25 32 32)"/><circle cx="32" cy="32" r="9"/><path d="M16 14c20-12 41 11 33 29M11 28c-5 17 18 33 35 19"/>',
  explosion: '<path d="m32 8 6 16 17-5-11 14 11 13-18-4-6 16-5-17-18 3 12-13L9 18l17 5Z"/>',
}

export function talentGlyph(icon: string): string {
  return `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyphs[icon] ?? glyphs.crit}</svg>`
}

export interface LabUiActions {
  select(id: string): void
  toggle(id: TalentEffect): void
  auto(): void
  reset(): void
  pause(): void
  skill(): void
}

export class TalentPlaygroundUi {
  readonly root = document.createElement('div')
  readonly viewport: HTMLElement
  private readonly controller = new AbortController()
  private readonly title: HTMLElement
  private readonly description: HTMLElement
  private readonly cards: HTMLElement
  private readonly numbers: HTMLElement
  private readonly hint: HTMLElement

  constructor(
    readonly config: PlaygroundConfig,
    private readonly actions: LabUiActions,
  ) {
    this.root.className = 'talent-lab'
    this.root.innerHTML = `
      <header class="tl-header"><div><div class="tl-eyebrow"><span></span> AFTER CLASS / EXPERIMENT 01</div><h1>让每一枪，<em>都有新花样。</em></h1></div><div class="tl-meta">课后勇者 · 天赋试射场<span>可操作原型 / 非正式平衡数值</span></div></header>
      <nav class="tl-presets" aria-label="选择射击奖励组合">${config.presets.map((p, i) => `<button data-preset="${p.id}" style="--tab-accent:${p.accent}"><small>0${i + 1}</small><strong>${p.name}</strong><span>${p.short}</span></button>`).join('')}</nav>
      <div class="tl-viewport"><div class="tl-arena-tag"><i></i> LIVE FIRING RANGE <span>白色方块为可击杀靶标 · 自动补充</span></div><div class="tl-arena-foot"><span class="tl-status">自动演示中</span><span>按住鼠标左键，亲自接管射击 ↗</span></div></div>
      <aside class="tl-panel"><div class="tl-panel-kicker">THIS RUN / 当前组合</div><h2></h2><p class="tl-description"></p><div class="tl-cards"></div><div class="tl-panel-note">点击天赋可单独开关，看看这一张究竟改变了什么。</div><button class="tl-baseline" data-action="baseline">对比：普通射击 <span>无天赋</span></button><button class="tl-skill" data-action="skill">Q · 主动落雷 <span>仅落雷天赋生效时可用</span></button></aside>
      <footer class="tl-footer"><div class="tl-controls"><span><kbd>W A S D</kbd> 移动</span><span><kbd>鼠标</kbd> 瞄准 / 按住开火</span><span><kbd>1 — 5</kbd> 换组合</span></div><div class="tl-actions"><button data-action="auto">关闭自动演示</button><button data-action="pause">暂停</button><button data-action="reset">重置靶场 ↻</button></div></footer>
      <div class="tl-readout" aria-live="off"></div>`
    document.body.append(this.root)
    const find = (selector: string): HTMLElement => this.root.querySelector<HTMLElement>(selector)!
    this.viewport = find('.tl-viewport')
    this.title = find('h2')
    this.description = find('.tl-description')
    this.cards = find('.tl-cards')
    this.numbers = find('.tl-readout')
    this.hint = find('.tl-status')
    this.root.addEventListener(
      'click',
      (event) => {
        const button = (event.target as Element).closest<HTMLElement>('button')
        if (!button) return
        if (button.dataset.preset) this.actions.select(button.dataset.preset)
        else if (button.dataset.effect) this.actions.toggle(button.dataset.effect as TalentEffect)
        else
          switch (button.dataset.action) {
            case 'baseline':
              this.actions.select('baseline')
              break
            case 'auto':
              this.actions.auto()
              break
            case 'reset':
              this.actions.reset()
              break
            case 'pause':
              this.actions.pause()
              break
            case 'skill':
              this.actions.skill()
              break
          }
        button.blur()
      },
      { signal: this.controller.signal },
    )
  }

  refresh(model: TalentPlayground): void {
    const preset = this.config.presets.find((p) => p.id === model.presetId)
    this.root.style.setProperty('--accent', preset?.accent ?? '#dbe4f3')
    this.title.textContent = preset?.name ?? '普通射击'
    this.description.textContent =
      preset?.description ?? '没有追加天赋，只有一颗直行子弹。先试试，再切回组合感受变化。'
    this.cards.innerHTML =
      preset?.cards
        .map(
          (card) =>
            `<button class="tl-card ${model.enabled.has(card.id) ? 'is-on' : ''}" data-effect="${card.id}" aria-pressed="${model.enabled.has(card.id)}"><div class="tl-card-art">${talentGlyph(card.icon)}</div><div class="tl-card-copy"><div><strong>${card.name}</strong><span>${model.enabled.has(card.id) ? '已生效' : '已关闭'}</span></div><p>${card.text}</p></div></button>`,
        )
        .join('') ?? '<div class="tl-empty">一颗子弹。<br>也是所有变化的起点。</div>'
    this.root.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.preset === model.presetId)
      button.setAttribute('aria-pressed', String(button.dataset.preset === model.presetId))
    })
    this.root.querySelector<HTMLButtonElement>('[data-action="skill"]')!.disabled =
      !model.enabled.has('lightning')
  }

  update(model: TalentPlayground, auto: boolean, paused: boolean): void {
    const { stats } = model
    this.root.dataset.frame = String(model.frame)
    this.root.dataset.preset = model.presetId
    this.root.dataset.kills = String(stats.kills)
    this.root.dataset.shots = String(stats.shots)
    this.root.dataset.bullets = String(model.bullets.length)
    this.root.dataset.effects = String(model.effects.length)
    this.root.dataset.lightning = String(stats.lightning)
    this.root.dataset.fields = String(stats.fields)
    this.root.dataset.player = `${model.player.x.toFixed(1)},${model.player.y.toFixed(1)}`
    this.root.dataset.paused = String(paused)
    const extra =
      model.presetId === 'thunder'
        ? ['落雷', stats.lightning]
        : model.presetId === 'singularity'
          ? ['引力场', stats.fields]
          : model.presetId === 'ricochet'
            ? ['弹墙', stats.bounces]
            : ['分裂', stats.splits]
    this.numbers.innerHTML = `<div><strong>${stats.shots}</strong><span>开火次数</span></div><div><strong>${stats.hits}</strong><span>有效命中</span></div><div><strong>${stats.kills}</strong><span>击杀靶标</span></div><div><strong>${extra[1]}</strong><span>${extra[0]}触发</span></div><small>frame ${model.frame} · 弹丸 ${model.bullets.length}/${model.config.tuning.maxBullets}</small>`
    this.hint.textContent = paused
      ? '已暂停'
      : auto
        ? '自动演示中 · 点击场内接管'
        : '手动试射 · 按住左键开火'
    this.root.querySelector('[data-action="auto"]')!.textContent = auto
      ? '关闭自动演示'
      : '开启自动演示'
    this.root.querySelector('[data-action="pause"]')!.textContent = paused ? '继续' : '暂停'
  }

  destroy(): void {
    this.controller.abort()
    this.root.remove()
  }
}
