/**
 * 校园地图主菜单的纯数据布局。
 *
 * 坐标使用 `CAMPUS_MENU_ART.map` 的原始像素空间（1459 × 821），场景负责整体等比缩放。
 * 每个入口只用建筑外接范围确定按钮中心，不再绘制建筑轮廓。
 */

import type { MenuAction } from './menuModel'

export const CAMPUS_MAP_SIZE = { width: 1459, height: 821 } as const
export const CAMPUS_BUTTON_SIZE = 38

export interface CampusHotspotDef {
  action: MenuAction
  /** 悬停卡里展示的建筑名。 */
  buildingName: string
  /** 建筑中心按钮内的两字文案。单字缩写要靠猜，两个字一眼就知道是干什么的。 */
  buttonLabel: string
  x: number
  y: number
  width: number
  height: number
}

/**
 * 七个入口与建筑的唯一对应表。
 *
 * 相连翼楼按一个建筑群处理；西操场取 01 号看台右侧的整块田径场，
 * 不是 01 号看台本身。按钮位置取下面矩形中心。
 */
export const CAMPUS_HOTSPOTS: readonly CampusHotspotDef[] = [
  {
    action: 'achievements',
    buildingName: '校史馆',
    buttonLabel: '成就',
    x: 326,
    y: 333,
    width: 119,
    height: 81,
  },
  {
    action: 'upgrade',
    buildingName: '西操场',
    buttonLabel: '升级',
    x: 349,
    y: 5,
    width: 160,
    height: 162,
  },
  {
    action: 'help',
    buildingName: '思源楼',
    buttonLabel: '说明',
    x: 489,
    y: 203,
    width: 107,
    height: 128,
  },
  {
    action: 'quit',
    buildingName: '南门',
    buttonLabel: '退出',
    x: 522,
    y: 740,
    width: 82,
    height: 70,
  },
  {
    action: 'settings',
    buildingName: '机械楼',
    buttonLabel: '设置',
    x: 1099,
    y: 469,
    width: 164,
    height: 106,
  },
  {
    action: 'codex',
    buildingName: '图书馆',
    buttonLabel: '图鉴',
    x: 934,
    y: 0,
    width: 210,
    height: 104,
  },
  {
    action: 'start',
    buildingName: '逸夫楼',
    buttonLabel: '开始',
    x: 1000,
    y: 264,
    width: 204,
    height: 139,
  },
]

export function hotspotButtonCenter(hotspot: CampusHotspotDef): { x: number; y: number } {
  return {
    x: hotspot.x + hotspot.width / 2,
    y: hotspot.y + hotspot.height / 2,
  }
}

export function hotspotForAction(action: MenuAction): CampusHotspotDef {
  const hotspot = CAMPUS_HOTSPOTS.find((candidate) => candidate.action === action)
  if (!hotspot) throw new Error(`校园主菜单缺少入口按钮：${action}`)
  return hotspot
}
