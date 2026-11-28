/**
 * 账号登录门(简陋版):**未登录时全屏挡住游戏**,必须注册或登录后才能进入。
 * 登录成功后自动同步一次云存档,再放行进入游戏;角落留一个「退出」按钮方便切换账号。
 * 正式 UI 由 D4 后续接替。
 */
import type { CloudSyncService } from './cloudSyncService'

export function mountCloudAuthOverlay(cloud: CloudSyncService): () => void {
  // 全屏门槛
  const gate = document.createElement('div')
  gate.style.cssText =
    'position:fixed;inset:0;z-index:99999;background:rgba(9,11,19,0.97);' +
    'display:flex;align-items:center;justify-content:center;font:15px/1.6 system-ui,sans-serif;color:#e8e8f0'

  const card = document.createElement('div')
  card.style.cssText =
    'background:#1b1e30;padding:32px 36px;border-radius:14px;width:320px;' +
    'box-shadow:0 12px 40px rgba(0,0,0,0.5);display:flex;flex-direction:column;gap:10px'
  gate.appendChild(card)

  const title = document.createElement('div')
  title.textContent = '《课后勇者》账号'
  title.style.cssText = 'font-size:20px;font-weight:600;text-align:center'
  card.appendChild(title)

  const subtitle = document.createElement('div')
  subtitle.textContent = '注册或登录后才能进入游戏'
  subtitle.style.cssText = 'font-size:13px;opacity:0.7;text-align:center;margin-bottom:6px'
  card.appendChild(subtitle)

  const username = input('用户名')
  const password = input('密码', true)
  card.appendChild(username)
  card.appendChild(password)

  const hint = document.createElement('div')
  hint.textContent = '密码至少 8 位'
  hint.style.cssText = 'font-size:12px;opacity:0.6'
  card.appendChild(hint)

  const status = document.createElement('div')
  status.style.cssText = 'font-size:13px;min-height:20px;text-align:center;opacity:0.85'
  card.appendChild(status)

  const row = document.createElement('div')
  row.style.cssText = 'display:flex;gap:10px'
  const registerBtn = btn('注册新账号', '#3a5a8c')
  const loginBtn = btn('登录', '#2f9e6e')
  row.appendChild(registerBtn)
  row.appendChild(loginBtn)
  card.appendChild(row)

  document.body.appendChild(gate)

  // 关键:Phaser 在 window 上 addCapture 了 SPACE/BACKSPACE/ENTER 等键并 preventDefault,
  // 会把 HTML 输入框的退格/空格/回车吞掉。这里在门内拦截冒泡,让这些事件到不了 window。
  for (const evt of ['keydown', 'keyup', 'keypress', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend']) {
    gate.addEventListener(evt, (e) => e.stopPropagation())
  }

  // 已登录时的小角标(退出用)
  const badge = document.createElement('div')
  badge.style.cssText =
    'position:fixed;top:10px;right:10px;z-index:99999;display:none;align-items:center;' +
    'gap:8px;background:rgba(27,30,48,0.9);color:#e8e8f0;padding:6px 10px;' +
    'border-radius:6px;font:13px system-ui,sans-serif'
  const badgeName = document.createElement('span')
  badge.appendChild(badgeName)
  const logoutBtn = btn('退出', '#5a3a4a')
  logoutBtn.style.cssText = 'padding:3px 8px;border-radius:4px;border:1px solid #666;background:#3a2a35;color:#e8e8f0;cursor:pointer;font:12px system-ui,sans-serif'
  badge.appendChild(logoutBtn)
  document.body.appendChild(badge)

  function refresh(): void {
    if (cloud.isLoggedIn) {
      gate.style.display = 'none'
      badge.style.display = 'flex'
      badgeName.textContent = `已登录：${cloud.currentAccountKey ?? ''}`
    } else {
      gate.style.display = 'flex'
      badge.style.display = 'none'
      username.focus()
    }
  }

  async function run(label: string, fn: () => Promise<void>): Promise<void> {
    status.textContent = `${label}中…`
    try {
      await fn()
      status.textContent = `${label}成功,正在同步…`
      const r = await cloud.sync()
      status.textContent = `同步结果:${r.kind}`
      refresh()
    } catch (err) {
      status.textContent = `${label}失败:${err instanceof Error ? err.message : String(err)}`
      console.error(`[云存档] ${label}失败`, err)
    }
  }

  function validate(): string | null {
    const u = username.value.trim()
    const p = password.value
    if (!u) return '请输入用户名'
    if (p.length < 8) return '密码至少 8 位'
    return null
  }

  registerBtn.onclick = () => {
    const err = validate()
    if (err) {
      status.textContent = err
      return
    }
    void run('注册', () => cloud.register(username.value.trim(), password.value))
  }
  loginBtn.onclick = () => {
    const err = validate()
    if (err) {
      status.textContent = err
      return
    }
    void run('登录', () => cloud.login(username.value.trim(), password.value))
  }
  logoutBtn.onclick = () => {
    cloud.logout()
    username.value = ''
    password.value = ''
    status.textContent = ''
    refresh()
  }

  // 密码框回车 = 登录
  password.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loginBtn.click()
  })

  refresh()
  return () => {
    gate.remove()
    badge.remove()
  }
}

function input(placeholder: string, isPassword = false): HTMLInputElement {
  const el = document.createElement('input')
  el.placeholder = placeholder
  if (isPassword) el.type = 'password'
  el.style.cssText =
    'width:100%;box-sizing:border-box;padding:9px 12px;border-radius:8px;' +
    'border:1px solid #444;background:#11141f;color:#e8e8f0;font:inherit'
  return el
}

function btn(text: string, bg: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.textContent = text
  b.style.cssText =
    'flex:1;padding:9px 0;border-radius:8px;border:none;cursor:pointer;' +
    `background:${bg};color:#fff;font:inherit;font-weight:500`
  return b
}
