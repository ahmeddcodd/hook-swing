import Phaser from 'phaser'
import { GAME_WIDTH, GAME_HEIGHT } from '../config.ts'
import { JungleTheme } from '../themes/jungle.ts'

/**
 * BootScene — loads the title-screen art with a minimal progress bar,
 * then hands off to the TitleScene.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene')
  }

  preload() {
    this.createLoadingBar()

    const {
      cover,
      playButton,
      background,
      platform,
      characterIdle,
      characterJump,
      characterHang,
    } = JungleTheme.assets
    this.load.image(cover.key, cover.path)
    this.load.image(playButton.key, playButton.path)

    // Parallax layers for the game screen.
    for (const layer of background) {
      this.load.image(layer.key, layer.path)
    }

    // Level start: platform + overhead bar + hook + character idle animation.
    this.load.image(platform.key, platform.path)
    this.load.image(JungleTheme.assets.overheadBar.key, JungleTheme.assets.overheadBar.path)
    this.load.image(JungleTheme.assets.hook.key, JungleTheme.assets.hook.path)
    this.load.spritesheet(characterIdle.key, characterIdle.path, {
      frameWidth: characterIdle.frameWidth,
      frameHeight: characterIdle.frameHeight,
    })
    this.load.spritesheet(characterJump.key, characterJump.path, {
      frameWidth: characterJump.frameWidth,
      frameHeight: characterJump.frameHeight,
    })
    this.load.spritesheet(characterHang.key, characterHang.path, {
      frameWidth: characterHang.frameWidth,
      frameHeight: characterHang.frameHeight,
    })
  }

  create() {
    this.scene.start('TitleScene')
  }

  private createLoadingBar() {
    const barWidth = GAME_WIDTH * 0.6
    const barHeight = 18
    const x = (GAME_WIDTH - barWidth) / 2
    const y = GAME_HEIGHT / 2 - barHeight / 2

    const frame = this.add.graphics()
    frame.lineStyle(2, 0x7bbf5a, 1)
    frame.strokeRect(x - 2, y - 2, barWidth + 4, barHeight + 4)

    const bar = this.add.graphics()
    this.load.on('progress', (value: number) => {
      bar.clear()
      bar.fillStyle(0x7bbf5a, 1)
      bar.fillRect(x, y, barWidth * value, barHeight)
    })

    this.load.on('complete', () => {
      bar.destroy()
      frame.destroy()
    })
  }
}
