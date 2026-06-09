import Phaser from 'phaser'
import { GAME_WIDTH, GAME_HEIGHT } from '../config.ts'
import { JungleTheme } from '../themes/jungle.ts'

/** Game mode passed to GameScene. Kept here too so MenuScene can type the choice. */
export type GameMode = 'campaign' | 'endless'

/** Target button width as a fraction of screen width. Under BUTTON_WIDTH_RATIO
 *  the buttons stay within the ENVELOP side-crop safe area on tall devices. */
const BUTTON_WIDTH_RATIO = 0.7

/**
 * MenuScene — mode-select screen reached from the title. Two tappable buttons let
 * the player choose CAMPAIGN (the 5-level story) or ENDLESS (infinite score-chase),
 * laid over the jungle cover.
 */
export class MenuScene extends Phaser.Scene {
  private cover!: Phaser.GameObjects.Image
  private locked = false
  /** Re-layout targets: [object, xFrac, yFrac] pinned to fractions of the screen. */
  private placed: { obj: Phaser.GameObjects.Components.Transform & Phaser.GameObjects.GameObject; xf: number; yf: number }[] = []

  constructor() {
    super('MenuScene')
  }

  create() {
    this.locked = false
    this.placed = []

    // Jungle cover as a cover-fit background (same look as the title).
    this.cover = this.add.image(0, 0, JungleTheme.assets.cover.key).setOrigin(0.5)

    // Official mode buttons in the lower open band (clear of the cover's logo).
    this.makeButton(0.66, JungleTheme.assets.campaignButton.key, () => this.startGame('campaign'))
    this.makeButton(0.82, JungleTheme.assets.endlessButton.key, () => this.startGame('endless'))

    this.layout()
    this.scale.on('resize', this.layout, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.layout, this)
    })

    this.cameras.main.fadeIn(250, 0, 0, 0)
  }

  /** Build one official mode button (image) centered at yFrac of the screen
   *  height, tappable with press-bounce + idle-pulse juice. */
  private makeButton(yFrac: number, textureKey: string, onPick: () => void) {
    const btn = this.add
      .image(0, 0, textureKey)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })

    // Scale to a fixed fraction of width (aspect preserved). Store as base scale
    // so the idle/press tweens are relative to it (set in layout()).
    const baseScale = (GAME_WIDTH * BUTTON_WIDTH_RATIO) / btn.width
    btn.setScale(baseScale)
    this.pin(btn, 0.5, yFrac)

    // Gentle idle pulse to draw the eye.
    this.tweens.add({
      targets: btn,
      scale: { from: baseScale, to: baseScale * 1.04 },
      duration: 800,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1,
    })

    btn.on('pointerdown', () => {
      if (this.locked) return
      this.locked = true
      this.tweens.killTweensOf(btn) // stop the idle pulse so it doesn't fight the press
      // Press-down feedback, then transition.
      this.tweens.add({
        targets: btn,
        scale: baseScale * 0.92,
        duration: 90,
        yoyo: true,
        ease: 'Quad.easeOut',
        onComplete: onPick,
      })
    })
  }

  /** Register an object to be positioned at (xFrac, yFrac) of the screen on layout. */
  private pin(
    obj: Phaser.GameObjects.Components.Transform & Phaser.GameObjects.GameObject,
    xf: number,
    yf: number
  ) {
    this.placed.push({ obj, xf, yf })
  }

  /** Cover-fit the background and place all pinned objects for the current size. */
  private layout() {
    const w = GAME_WIDTH
    const h = GAME_HEIGHT

    this.cover.setPosition(w / 2, h / 2)
    this.cover.setScale(Math.max(w / this.cover.width, h / this.cover.height))

    for (const { obj, xf, yf } of this.placed) obj.setPosition(w * xf, h * yf)
  }

  private startGame(mode: GameMode) {
    this.cameras.main.fadeOut(250, 0, 0, 0)
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start('GameScene', { mode })
    })
  }
}
