import Phaser from 'phaser'
import { GAME_WIDTH, GAME_HEIGHT } from '../config.ts'
import { JungleTheme } from '../themes/jungle.ts'

/** Vertical position of the play button as a fraction of screen height. */
const BUTTON_Y_RATIO = 0.8
/** Target button width as a fraction of screen width. */
const BUTTON_WIDTH_RATIO = 0.62

/**
 * TitleScene — full-bleed Jungle cover with an animated "TAP TO PLAY" button.
 * The whole screen is tappable; tapping transitions toward the game
 * (placeholder until LevelSelectScene exists).
 */
export class TitleScene extends Phaser.Scene {
  private cover!: Phaser.GameObjects.Image
  private button!: Phaser.GameObjects.Image
  private pulse?: Phaser.Tweens.Tween
  private locked = false

  constructor() {
    super('TitleScene')
  }

  create() {
    const { cover, playButton } = JungleTheme.assets

    // Cover art, scaled to FILL the portrait viewport (crop overflow).
    this.cover = this.add.image(0, 0, cover.key).setOrigin(0.5)

    // Tap-to-play button.
    this.button = this.add
      .image(0, 0, playButton.key)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })

    this.layout()

    // Gentle idle pulse to draw the eye.
    this.pulse = this.tweens.add({
      targets: this.button,
      scale: { from: this.button.scale, to: this.button.scale * 1.06 },
      duration: 700,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1,
    })

    // Whole-screen tap + button tap both start the game.
    this.input.on('pointerdown', this.handleTap, this)

    // Keep things placed if the canvas is resized.
    this.scale.on('resize', this.layout, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.layout, this)
    })
  }

  /** Position & scale the cover (fill) and button (fixed ratio) for current size. */
  private layout() {
    const w = GAME_WIDTH
    const h = GAME_HEIGHT

    // Cover-fit: scale so the image fully covers the screen, centered.
    this.cover.setPosition(w / 2, h / 2)
    const coverScale = Math.max(
      w / this.cover.width,
      h / this.cover.height
    )
    this.cover.setScale(coverScale)

    // Button: fixed fraction of width, aspect preserved.
    const targetWidth = w * BUTTON_WIDTH_RATIO
    const btnScale = targetWidth / this.button.width
    this.button.setScale(btnScale)
    this.button.setPosition(w / 2, h * BUTTON_Y_RATIO)

    // If a pulse is running, rebase it to the new scale.
    if (this.pulse) {
      this.pulse.remove()
      this.pulse = this.tweens.add({
        targets: this.button,
        scale: { from: btnScale, to: btnScale * 1.06 },
        duration: 700,
        ease: 'Sine.easeInOut',
        yoyo: true,
        repeat: -1,
      })
    }
  }

  private handleTap() {
    if (this.locked) return
    this.locked = true
    this.pulse?.remove()

    // Quick press-down feedback, then transition.
    this.tweens.add({
      targets: this.button,
      scale: this.button.scale * 0.92,
      duration: 90,
      yoyo: true,
      ease: 'Quad.easeOut',
      onComplete: () => this.startGame(),
    })
  }

  private startGame() {
    this.cameras.main.fadeOut(250, 0, 0, 0)
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      // Enters the game screen. (LevelSelectScene will sit in between in a later phase.)
      this.scene.start('GameScene')
    })
  }
}
