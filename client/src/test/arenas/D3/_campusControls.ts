import type Phaser from 'phaser'
import { MENU_SCENE_KEY } from '../../arenaCatalog'

export function clearCampusArenaQuery(): void {
  const url = new URL(window.location.href)
  url.searchParams.delete('arena')
  window.history.replaceState(null, '', url)
}

export function campusMenuButton(scene: Phaser.Scene): void {
  campusButton(scene, 1148, 18, 115, 'Esc 返回菜单', () => {
    clearCampusArenaQuery()
    scene.scene.start(MENU_SCENE_KEY)
  })
}

/** Test-only canvas controls. Stop propagation so a button click never fires the debug gun. */
export function campusButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  label: string,
  action: () => void,
): Phaser.GameObjects.Text {
  return scene.add.text(x, y, label, {
    fontFamily: 'Microsoft YaHei, sans-serif', fontSize: '14px', color: '#edf5ff',
    backgroundColor: '#24354c', padding: { x: 9, y: 7 }, fixedWidth: width, align: 'center',
  }).setDepth(8000).setScrollFactor(0).setInteractive({ useHandCursor: true })
    .on('pointerover', function (this: Phaser.GameObjects.Text) { this.setBackgroundColor('#3b5473') })
    .on('pointerout', function (this: Phaser.GameObjects.Text) { this.setBackgroundColor('#24354c') })
    .on('pointerdown', (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation()
      action()
    })
}

export function campusText(scene: Phaser.Scene, x: number, y: number, text = '', width?: number): Phaser.GameObjects.Text {
  return scene.add.text(x, y, text, {
    fontFamily: 'Microsoft YaHei, sans-serif', fontSize: '14px', color: '#d9e7f5',
    backgroundColor: '#101b2bdc', padding: { x: 7, y: 5 }, lineSpacing: 4,
    ...(width ? { wordWrap: { width, useAdvancedWrap: true } } : {}),
  }).setDepth(7000).setScrollFactor(0)
}
