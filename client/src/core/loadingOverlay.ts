/**
 * 全屏加载遮罩（HTML DOM，不在 Phaser 里画）。
 *
 * 三个阶段共用：首次进站、标题 → 主菜单、主菜单 → 战斗。
 * 用 DOM 而不是 Phaser Text 的原因：首次进站时 Phaser 还没启动，
 * 必须先有一块能显示的字；之后场景 preload 只在同一块上更新进度。
 *
 * 文案统一为「初次加载资源较慢，请耐心等待。」——用户 2026-11-27 的要求。
 */
const ROOT_ID = 'game-loading'
const DEFAULT_NOTE = '初次加载资源较慢，请耐心等待。'

let root: HTMLElement | null = null
let fill: HTMLElement | null = null
let percent: HTMLElement | null = null
let note: HTMLElement | null = null

function ensure(): boolean {
  if (typeof document === 'undefined') return false
  if (root === null) root = document.getElementById(ROOT_ID)
  if (root === null) {
    root = document.createElement('div')
    root.id = ROOT_ID
    root.className = 'game-loading'
    root.innerHTML = `
      <div class="game-loading-title">课后勇者：异次元校园</div>
      <div class="game-loading-bar"><div class="game-loading-fill"></div></div>
      <div class="game-loading-percent">0%</div>
      <div class="game-loading-note">${DEFAULT_NOTE}</div>
    `
    document.body.append(root)
  }
  fill = root.querySelector<HTMLElement>('.game-loading-fill')
  percent = root.querySelector<HTMLElement>('.game-loading-percent')
  note = root.querySelector<HTMLElement>('.game-loading-note')
  return true
}

/** 显示遮罩；场景 preload 开始时调用。 */
export function showLoading(message = DEFAULT_NOTE): void {
  if (!ensure() || root === null) return
  root.classList.remove('is-hidden')
  root.classList.remove('is-booting')
  if (note !== null) note.textContent = message
  setLoadingProgress(0)
}

/** 更新 0—1 的进度；Phaser loader 的 `progress` 事件直接传进来。 */
export function setLoadingProgress(progress: number): void {
  if (!ensure() || root === null) return
  const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0))
  if (fill !== null) fill.style.width = `${(p * 100).toFixed(1)}%`
  if (percent !== null) percent.textContent = `${Math.round(p * 100)}%`
}

/** 场景 create 开始时调用：隐藏但不删除，下一次 preload 还能复用。 */
export function hideLoading(): void {
  if (!ensure() || root === null) return
  root.classList.add('is-hidden')
}
