import Phaser from 'phaser'
import { GAME_WIDTH, GAME_HEIGHT } from '../config.ts'
import { JungleTheme } from '../themes/jungle.ts'

/**
 * Idle animation. The spritesheet is pre-aligned (every frame centered &
 * feet-aligned by scripts/realign-spritesheet.cjs), so it animates in place
 * with no left-right drift. Slow frame rate keeps it a calm idle.
 */
const IDLE_ANIM = 'character-idle'
const IDLE_FPS = 5

/** Starting-area layout, as fractions of the screen. */
const PLATFORM_CENTER_X = 0.26
const PLATFORM_BOTTOM_Y = 0.92
const PLATFORM_WIDTH = 0.38
/** Visible character body height as a fraction of screen height. */
const CHARACTER_BODY_HEIGHT = 0.2
/** Jump/flying pose body height (smaller — the leaping pose reads larger). */
const JUMP_BODY_HEIGHT = 0.14
/** Hanging pose body height (fraction of screen height). */
const HANG_BODY_HEIGHT = 0.16
/** Sink the feet a touch below the slab surface so they don't look like they hover on its edge. */
const CHARACTER_FOOT_SINK = 0.015

/** On-screen thickness of the overhead bar's wood band, as a fraction of screen height. */
const BAR_WOOD_THICKNESS = 0.09

/** Horizontal screen position the camera keeps the character at, as a fraction of width. */
const CHARACTER_SCREEN_X = 0.3

/**
 * Swing physics (custom pendulum — no engine). All in px and seconds.
 */
const SWING_GRAVITY = 2200 // px/s² downward
/** Initial launch velocity off the platform (the tap "jump"). */
const LAUNCH_VX = 480 // px/s rightward
const LAUNCH_VY = -1150 // px/s upward (arcs up into the hook band)
/** Grab the nearest circle within this distance (px) when holding. */
const GRAB_RADIUS = 240
/** Per-frame energy retention while swinging (1 = none lost). */
const SWING_DAMPING = 0.996
/** Tangential speed multiplier on release (1 = natural momentum). */
const RELEASE_BOOST = 1.0
/** Don't re-grab the just-released hook for this long (ms). */
const RE_GRAB_COOLDOWN_MS = 250

/** Rope line visual. */
const ROPE_LINE_WIDTH = 8
const ROPE_LINE_COLOR = 0x5a8f3a

/** Character motion state. */
const MoveState = {
  Idle: 0,
  Flying: 1,
  Swinging: 2,
} as const
type MoveState = (typeof MoveState)[keyof typeof MoveState]

/** Pre-placed zig-zag chain of wooden circles ahead in the level. */
const HOOK_SIZE = 0.16 // diameter, fraction of screen width
const HOOK_COUNT = 12 // how many circles in the chain
const HOOK_GAP_X = 0.45 // horizontal spacing between circles, fraction of screen width
const HOOK_START_X = 0.62 // first circle's x, fraction of screen width (in the launch arc)
const HOOK_HIGH_Y = 0.5 // "up" row, fraction of screen height
const HOOK_LOW_Y = 0.62 // "down" row, fraction of screen height (stronger up/down)

/**
 * GameScene — the screen the player enters from the title.
 *
 * Composes the parallax jungle background (2 transparent layers) and places
 * the level start: the starting platform with the character idling on top.
 * Gameplay (hooks, swing physics) is added in a later phase.
 */
export class GameScene extends Phaser.Scene {
  private layers: Phaser.GameObjects.Image[] = []
  private platform!: Phaser.GameObjects.Image
  private overheadBar!: Phaser.GameObjects.TileSprite
  private hooks: Phaser.GameObjects.Image[] = []
  private character!: Phaser.GameObjects.Sprite
  private rope!: Phaser.GameObjects.Graphics

  private state: MoveState = MoveState.Idle
  private holding = false
  /** Free-flight velocity (px/s). */
  private vx = 0
  private vy = 0
  /** Pendulum state while swinging. */
  private attachedHook: Phaser.GameObjects.Image | null = null
  private ropeLen = 0
  private angle = 0 // radians, measured from straight-down at the hook
  private angVel = 0 // rad/s
  private lastReleasedHook: Phaser.GameObjects.Image | null = null
  private lastReleaseTime = 0

  constructor() {
    super('GameScene')
  }

  create() {
    // Background pinned to the camera (scrollFactor 0) so it keeps filling the
    // view as the camera scrolls with the character.
    this.layers = JungleTheme.assets.background.map((layer, index) => {
      const img = this.add.image(0, 0, layer.key).setOrigin(0.5).setScrollFactor(0)
      img.setDepth(index)
      return img
    })

    const { platform, characterIdle } = JungleTheme.assets

    this.createIdleAnim()

    // Overhead bar: a screen-pinned TileSprite (scrollFactor 0) — a continuous
    // beam across the top no matter how far the camera scrolls forward.
    const bar = JungleTheme.assets.overheadBar
    const barTex = this.textures.get(bar.key).getSourceImage()
    this.overheadBar = this.add
      .tileSprite(0, 0, GAME_WIDTH, barTex.height, bar.key)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(5)

    // Pre-placed zig-zag chain of wooden circles ahead in the level, at fixed
    // world positions. They come into view as the camera scrolls forward.
    // Alternating high/low rows with horizontal gaps between them.
    this.hooks = []
    for (let i = 0; i < HOOK_COUNT; i++) {
      const x = GAME_WIDTH * (HOOK_START_X + i * HOOK_GAP_X)
      const y = GAME_HEIGHT * (i % 2 === 0 ? HOOK_HIGH_Y : HOOK_LOW_Y)
      this.hooks.push(
        this.add.image(x, y, JungleTheme.assets.hook.key).setOrigin(0.5).setDepth(7)
      )
    }

    // Platform anchored by its bottom-center so it sits flush on the ground.
    this.platform = this.add
      .image(0, 0, platform.key)
      .setOrigin(0.5, 1)
      .setDepth(10)

    // Character: aligned sheet → simple centered origin, feet at the measured
    // baseline so it stands flush. Animates in place (no drift).
    this.character = this.add
      .sprite(0, 0, characterIdle.key)
      .setOrigin(0.5, characterIdle.feetOriginY)
      .setDepth(11)
      .play(IDLE_ANIM)

    // Rope line, drawn between hook and character while swinging.
    this.rope = this.add.graphics().setDepth(8)

    this.layout()
    this.scale.on('resize', this.layout, this)

    // Hold to swing: press launches off the platform (first time) and grabs;
    // release lets go with momentum.
    this.input.on('pointerdown', this.onPointerDown, this)
    this.input.on('pointerup', this.onPointerUp, this)
    this.input.on('pointerupoutside', this.onPointerUp, this)

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.layout, this)
      this.input.off('pointerdown', this.onPointerDown, this)
      this.input.off('pointerup', this.onPointerUp, this)
      this.input.off('pointerupoutside', this.onPointerUp, this)
    })

    this.cameras.main.fadeIn(250, 0, 0, 0)
  }

  private onPointerDown() {
    this.holding = true
    if (this.state === MoveState.Idle) {
      this.launch()
    }
  }

  private onPointerUp() {
    this.holding = false
    if (this.state === MoveState.Swinging) {
      this.release()
    }
  }

  /** Leave the platform: switch to the jump pose and start free flight. */
  private launch() {
    this.setJumpPose()
    this.vx = LAUNCH_VX
    this.vy = LAUNCH_VY
    this.state = MoveState.Flying
  }

  /** Flying/jumping pose: feet-anchored leaping frame. */
  private setJumpPose() {
    const jumpAsset = JungleTheme.assets.characterJump
    this.character.anims.stop()
    this.character.setTexture(jumpAsset.key, 0)
    this.character.setOrigin(0.5, jumpAsset.feetOriginY)
    this.character.setScale((GAME_HEIGHT * JUMP_BODY_HEIGHT) / jumpAsset.bodyHeight)
  }

  /** Hanging pose: raised-hand grip frame, origin at the HAND so it grabs the
   *  rope's top end (the character then dangles below it). */
  private setHangPose() {
    const hangAsset = JungleTheme.assets.characterHang
    this.character.anims.stop()
    this.character.setTexture(hangAsset.key, hangAsset.hangFrame)
    this.character.setOrigin(hangAsset.handOriginX, hangAsset.handOriginY)
    this.character.setScale((GAME_HEIGHT * HANG_BODY_HEIGHT) / hangAsset.bodyHeight)
  }

  /** Attach to the nearest hook within range, starting a pendulum swing. */
  private tryAttach() {
    const hook = this.nearestHookInRange()
    if (!hook) return

    this.attachedHook = hook
    const dx = this.character.x - hook.x
    const dy = this.character.y - hook.y
    this.ropeLen = Math.hypot(dx, dy)
    // angle measured from straight-down (0 = directly below the hook).
    this.angle = Math.atan2(dx, dy)

    // Seed angular velocity from the tangential part of the current velocity so
    // the swing continues the fly momentum (no snap). Tangent at this angle is
    // (cos angle, -sin angle).
    const tangentX = Math.cos(this.angle)
    const tangentY = -Math.sin(this.angle)
    const tangentialSpeed = this.vx * tangentX + this.vy * tangentY
    this.angVel = tangentialSpeed / this.ropeLen

    this.setHangPose()
    this.state = MoveState.Swinging
  }

  /** Detach and fly off along the swing's tangent (momentum preserved). */
  private release() {
    if (!this.attachedHook) return
    const tangentialSpeed = this.angVel * this.ropeLen
    const tangentX = Math.cos(this.angle)
    const tangentY = -Math.sin(this.angle)
    this.vx = tangentX * tangentialSpeed * RELEASE_BOOST
    this.vy = tangentY * tangentialSpeed * RELEASE_BOOST

    this.lastReleasedHook = this.attachedHook
    this.lastReleaseTime = this.time.now
    this.attachedHook = null
    this.setJumpPose()
    this.state = MoveState.Flying
  }

  private nearestHookInRange(): Phaser.GameObjects.Image | null {
    const onCooldown = this.time.now - this.lastReleaseTime < RE_GRAB_COOLDOWN_MS
    let best: Phaser.GameObjects.Image | null = null
    let bestDist = GRAB_RADIUS
    for (const hook of this.hooks) {
      if (onCooldown && hook === this.lastReleasedHook) continue
      const d = Phaser.Math.Distance.Between(this.character.x, this.character.y, hook.x, hook.y)
      if (d <= bestDist) {
        bestDist = d
        best = hook
      }
    }
    return best
  }

  update(_time: number, delta: number) {
    const dt = delta / 1000

    if (this.state === MoveState.Flying) {
      // While holding & flying, keep trying to grab a nearby hook.
      if (this.holding) this.tryAttach()
    }

    if (this.state === MoveState.Flying) {
      this.vy += SWING_GRAVITY * dt
      this.character.x += this.vx * dt
      this.character.y += this.vy * dt
    } else if (this.state === MoveState.Swinging && this.attachedHook) {
      const angAcc = -(SWING_GRAVITY / this.ropeLen) * Math.sin(this.angle)
      this.angVel += angAcc * dt
      this.angVel *= SWING_DAMPING
      this.angle += this.angVel * dt
      this.character.x = this.attachedHook.x + this.ropeLen * Math.sin(this.angle)
      this.character.y = this.attachedHook.y + this.ropeLen * Math.cos(this.angle)
    }

    this.drawRope()

    // Horizontal-only camera follow (ground/vertical stays fixed).
    if (this.state !== MoveState.Idle) {
      const cam = this.cameras.main
      const targetScrollX = this.character.x - GAME_WIDTH * CHARACTER_SCREEN_X
      if (targetScrollX > cam.scrollX) cam.scrollX = targetScrollX
    }
  }

  private drawRope() {
    this.rope.clear()
    if (this.state !== MoveState.Swinging || !this.attachedHook) return
    this.rope.lineStyle(ROPE_LINE_WIDTH, ROPE_LINE_COLOR, 1)
    this.rope.beginPath()
    this.rope.moveTo(this.attachedHook.x, this.attachedHook.y)
    this.rope.lineTo(this.character.x, this.character.y)
    this.rope.strokePath()
  }

  private createIdleAnim() {
    if (this.anims.exists(IDLE_ANIM)) return
    this.anims.create({
      key: IDLE_ANIM,
      frames: this.anims.generateFrameNumbers(JungleTheme.assets.characterIdle.key, {
        start: 0,
        end: JungleTheme.assets.characterIdle.frameCount - 1,
      }),
      frameRate: IDLE_FPS,
      repeat: -1,
      yoyo: true,
    })
  }

  private layout() {
    this.layoutBackground()
    this.layoutOverheadBar()
    this.layoutHooks()
    this.layoutStart()
  }

  /** Size the wooden circles. Positions are fixed world coords (set at create). */
  private layoutHooks() {
    const size = GAME_WIDTH * HOOK_SIZE
    for (const hook of this.hooks) hook.setDisplaySize(size, size)
  }

  /** Pin the overhead bar flush to the top, spanning the full screen width. */
  private layoutOverheadBar() {
    const bar = JungleTheme.assets.overheadBar
    const texHeight = (this.overheadBar.texture.getSourceImage() as HTMLImageElement).height

    // Scale the texture so the wood band has the desired on-screen thickness.
    const woodBandPx = (bar.woodBottomRatio - bar.woodTopRatio) * texHeight
    const scale = (GAME_HEIGHT * BAR_WOOD_THICKNESS) / woodBandPx
    this.overheadBar.setTileScale(scale, scale)

    // Full screen width; height covers the scaled texture. Shift up so the wood
    // band's top edge sits at the very top of the screen.
    this.overheadBar.setSize(GAME_WIDTH, texHeight * scale)
    this.overheadBar.setPosition(0, -bar.woodTopRatio * texHeight * scale)
  }

  /** Cover-fit every background layer to fill the portrait viewport, centered. */
  private layoutBackground() {
    for (const img of this.layers) {
      img.setPosition(GAME_WIDTH / 2, GAME_HEIGHT / 2)
      const scale = Math.max(GAME_WIDTH / img.width, GAME_HEIGHT / img.height)
      img.setScale(scale)
    }
  }

  /** Place the starting platform (lower-left) and the character standing on it. */
  private layoutStart() {
    const platformX = GAME_WIDTH * PLATFORM_CENTER_X
    const platformBottomY = GAME_HEIGHT * PLATFORM_BOTTOM_Y

    const platformScale = (GAME_WIDTH * PLATFORM_WIDTH) / this.platform.width
    this.platform.setScale(platformScale)
    this.platform.setPosition(platformX, platformBottomY)

    // Once he leaves the platform, the sim owns the character — don't re-plant.
    if (this.state !== MoveState.Idle) return

    // Scale the character by its visible body height so on-screen size is
    // predictable regardless of frame padding.
    const charScale =
      (GAME_HEIGHT * CHARACTER_BODY_HEIGHT) / JungleTheme.assets.characterIdle.bodyHeight
    this.character.setScale(charScale)

    // Plant the feet on the slab's actual top surface (measured surfaceRatio),
    // sunk a hair so they rest on it rather than hovering on the edge.
    const platformTopY = platformBottomY - this.platform.displayHeight
    const surfaceY =
      platformTopY +
      this.platform.displayHeight *
        (JungleTheme.assets.platform.surfaceRatio + CHARACTER_FOOT_SINK)
    this.character.setPosition(platformX, surfaceY)
  }
}
