import { describe, expect, it } from 'vitest'
import {
  CAMPUS_HOTSPOTS,
  CAMPUS_MAP_SIZE,
  hotspotButtonCenter,
  hotspotForAction,
} from './campusMenuModel'
import { MENU_ACTIONS } from './menuModel'

describe('校园地图入口表', () => {
  it('七个主菜单入口各对应且只对应一个建筑热区', () => {
    expect(CAMPUS_HOTSPOTS).toHaveLength(MENU_ACTIONS.length)
    expect(new Set(CAMPUS_HOTSPOTS.map((h) => h.action))).toEqual(new Set(MENU_ACTIONS))
  })

  it('按用户确认的地标映射按钮', () => {
    expect(hotspotForAction('achievements')).toMatchObject({
      buildingNumber: '14',
      buildingName: '校史馆',
    })
    expect(hotspotForAction('upgrade')).toMatchObject({
      buildingNumber: '01 旁',
      buildingName: '西操场',
    })
    expect(hotspotForAction('help')).toMatchObject({
      buildingNumber: '07',
      buildingName: '思源楼',
    })
    expect(hotspotForAction('quit')).toMatchObject({
      buildingNumber: '34',
      buildingName: '南门',
    })
    expect(hotspotForAction('settings')).toMatchObject({
      buildingNumber: '24',
      buildingName: '机械楼',
    })
    expect(hotspotForAction('codex')).toMatchObject({
      buildingNumber: '03',
      buildingName: '图书馆',
    })
    expect(hotspotForAction('start')).toMatchObject({
      buildingNumber: '10',
      buildingName: '逸夫楼',
    })
  })

  it('所有热区都落在地图范围内', () => {
    for (const hotspot of CAMPUS_HOTSPOTS) {
      expect(hotspot.x).toBeGreaterThanOrEqual(0)
      expect(hotspot.y).toBeGreaterThanOrEqual(0)
      expect(hotspot.x + hotspot.width).toBeLessThanOrEqual(CAMPUS_MAP_SIZE.width)
      expect(hotspot.y + hotspot.height).toBeLessThanOrEqual(CAMPUS_MAP_SIZE.height)
      expect(hotspot.width).toBeGreaterThan(0)
      expect(hotspot.height).toBeGreaterThan(0)
    }
  })

  it('每个入口都是一个落在建筑范围内的中心方块，并有单字按钮文案', () => {
    for (const hotspot of CAMPUS_HOTSPOTS) {
      const center = hotspotButtonCenter(hotspot)
      expect(hotspot.buttonLabel.length).toBeGreaterThan(0)
      expect(center.x).toBeGreaterThan(hotspot.x)
      expect(center.y).toBeGreaterThan(hotspot.y)
      expect(center.x).toBeLessThan(hotspot.x + hotspot.width)
      expect(center.y).toBeLessThan(hotspot.y + hotspot.height)
      expect(center.x).toBeGreaterThan(0)
      expect(center.y).toBeGreaterThan(0)
      expect(center.x).toBeLessThan(CAMPUS_MAP_SIZE.width)
      expect(center.y).toBeLessThan(CAMPUS_MAP_SIZE.height)
    }
  })
})
