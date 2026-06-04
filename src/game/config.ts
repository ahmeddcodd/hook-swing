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
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: {
    antialias: true,
    roundPixels: false,
  },
  scene: [BootScene, TitleScene, GameScene],
}
