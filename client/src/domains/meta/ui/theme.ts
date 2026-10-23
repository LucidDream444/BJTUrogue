/**
 * UI 视觉规范 —— **可执行的那一份**。纯数据，零 Phaser、零 DOM，node 下可直接读。
 *
 * 《人员分工方案》§三 把「UI 视觉规范」列为 D4 的输出，§四 又规定
 * 「各域界面必须基于公共控件搭建」。这份文件就是那句话的落点：
 * **颜色、字号、间距只有这里一份**，别处不许再写字面量。
 *
 * 为什么不用 CSS 变量 / Tailwind 之类：游戏画面全在 canvas 里，
 * 那些工具一个都用不上 —— 它们的等价物就是这样一个 TS 常量表。
 *
 * ## 现在是什么阶段
 *
 * 校园冒险主题：墨绿底、黄铜描边、暖米色文字，与木质像素房间统一
 * （需求草图上的「虚线框占位」在这里就是 `theme` 的颜色）。
 * 真美术到位后改的是这个文件，不是各个界面。
 *
 * ## 字体
 *
 * 用系统字体，中英文都靠系统栈兜住 —— 项目里没有字体资源
 * （`public/assets/fonts/` 是空的），也不打算为一个菜单引入 web font：
 * 那是首屏体积的直接开销（《技术选型》§8 第 6 条）。
 */

export const THEME = {
  color: {
    /** 整块背景。与 `index.html` / `main.ts` 的底色调一致 */
    backdrop: 0x101914,
    panel: 0x1c2b23,
    panelHover: 0x2b4032,
    border: 0x756144,
    /** 焦点 / 选中的描边 */
    accent: 0xd5b274,
    /** 错误与阻断状态 */
    danger: 0xb85b4b,
    /** 焦点的填充（比 accent 暗，免得白字压不上去） */
    accentFill: 0x3c5139,
    /** 禁用态：几乎与背景同色，只在描边上留一点存在感 */
    disabled: 0x18211c,
    /** 滑杆的滑块 */
    knob: 0xf4e7cc,
    dim: 0x000000,
  },
  text: {
    body: '#f4e7cc',
    dim: '#b5b69c',
    disabled: '#7f8879',
    accent: '#efd198',
    danger: '#eca191',
  },
  font: {
    family: "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif",
    /** 界面里的字一律用这些字号，别写字面量 */
    title: 30,
    heading: 18,
    body: 14,
    small: 12,
  },
  space: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  /** 左栏按钮的默认尺寸 */
  button: { width: 250, height: 46 },
  /** 角色卡的默认尺寸（会被布局按窗口宽度缩） */
  card: { width: 190, height: 210 },
  /** 弹层的最大宽度（内容再宽也不会把窗口撑破） */
  overlay: { maxWidth: 640 },
} as const

/** 从 `THEME.font` 里取一个字号，做成 Phaser 要的 `'14px'` 串 */
export function fontPx(size: number): string {
  return `${size}px`
}
