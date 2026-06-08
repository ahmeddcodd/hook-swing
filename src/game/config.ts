import Phaser from 'phaser'
import { BootScene } from './scenes/BootScene.ts'
import { TitleScene } from './scenes/TitleScene.ts'
import { GameScene } from './scenes/GameScene.ts'

/** Portrait design resolution (matches the 9:16 art assets). */
export const GAME_WIDTH = 720
export const GAME_HEIGHT = 1280

export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#000000',
  scale: {
    // ENVELOP scales the fixed 720×1280 design space to COVER the #game parent
    // (no letterbox bars), cropping any slight overflow. The parent is locked to
    // a 9:16 box in CSS (see style.css), so the game stays 9:16 on every device:
    // it fills portrait phones and shows as a centered 9:16 frame on wide desktop.
    mode: Phaser.Scale.ENVELOP,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    // Respect the CSS-sized #game box instead of forcing it to fill the window.
    expandParent: false,
  },
  render: {
    antialias: true,
    roundPixels: false,
  },
  scene: [BootScene, TitleScene, GameScene],
}
