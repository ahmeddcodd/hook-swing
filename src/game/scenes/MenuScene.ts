import Phaser from 'phaser'
import { GAME_WIDTH, GAME_HEIGHT } from '../config.ts'
import { JungleTheme } from '../themes/jungle.ts'

/** Game mode passed to GameScene. Kept here too so MenuScene can type the choice. */
export type GameMode = 'campaign' | 'endless'

/** Safe horizontal inset (fraction of width) so boxes/text aren't clipped by the
 *  ENVELOP side-crop on devices taller than 9:16 (matches GameScene.SAFE_INSET_X). */
const SAFE_INSET_X = 0.1

/**
 * MenuScene — mode-select screen reached from the title. Two tappable boxes let
 * the player choose CAMPAIGN (the 5-level story) or ENDLESS (infinite score-chase).
 * Drawn asset-free over the jungle cover; styled to match the game's cartoon look.
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

    // Headline.
    const headline = this.add
      .text(0, 0, 'SELECT MODE', {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '56px',
        color: '#ffe9a8',
        stroke: '#3a2410',
        strokeThickness: 10,
        align: 'center',
      })
      .setOrigin(0.5)
    // Sit the headline below the cover's "HOOK SWING" logo (clear of it).
    this.pin(headline, 0.5, 0.52)

    // Boxes in the lower open band so they don't collide with the logo/character.
    this.makeBox(0.66, 'CAMPAIGN', () => this.startGame('campaign'))
    this.makeBox(0.82, 'ENDLESS', () => this.startGame('endless'))

    this.layout()
    this.scale.on('resize', this.layout, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.layout, this)
    })

    this.cameras.main.fadeIn(250, 0, 0, 0)
  }

  /** Build one cartoon mode box (rounded panel + label) centered at yFrac of the
   *  screen height, tappable with press-bounce + idle-pulse juice. */
  private makeBox(yFrac: number, label: string, onPick: () => void) {
    const boxW = GAME_WIDTH * (1 - 2 * SAFE_INSET_X)
    const boxH = GAME_HEIGHT * 0.13

    const panel = this.add
      .rectangle(0, 0, boxW, boxH, 0x06210f, 0.85)
      .setStrokeStyle(8, 0x3a2410)
      .setInteractive({ useHandCursor: true })
    // Inner green accent border for the cartoon look.
    const accent = this.add
      .rectangle(0, 0, boxW - 18, boxH - 18)
      .setStrokeStyle(4, 0x9be36b)
    const text = this.add
      .text(0, 0, label, {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '56px',
        color: '#ffe9a8',
        stroke: '#3a2410',
        strokeThickness: 10,
        align: 'center',
      })
      .setOrigin(0.5)

    this.pin(panel, 0.5, yFrac)
    this.pin(accent, 0.5, yFrac)
    this.pin(text, 0.5, yFrac)

    // Gentle idle pulse on the whole box to draw the eye.
    this.tweens.add({
      targets: [panel, accent, text],
      scale: { from: 1, to: 1.03 },
      duration: 800,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1,
    })

    panel.on('pointerdown', () => {
      if (this.locked) return
      this.locked = true
      // Press-down feedback, then transition.
      this.tweens.add({
        targets: [panel, accent, text],
        scale: 0.94,
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
