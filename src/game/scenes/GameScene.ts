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

/** Jump launch animation (run→leap, plays once then holds the last frame). */
const JUMP_ANIM = 'character-jump'
const JUMP_FPS = 12

/** Directional swing animations (hands stay locked on the rope). */
const SWING_FWD_ANIM = 'swing-forward'
const SWING_BACK_ANIM = 'swing-backward'
/** Slower frames — the smooth motion comes from the pendulum arc, not the cycling. */
const SWING_FPS = 4
/** Only flip swing direction once speed clearly exceeds this (rad/s) — a deadzone
 *  so the pose doesn't pop back and forth at the top of each swing. */
const SWING_FLIP_DEADZONE = 0.4

/** Starting-area layout, as fractions of the screen. */
const PLATFORM_CENTER_X = 0.26
const PLATFORM_BOTTOM_Y = 0.92
const PLATFORM_WIDTH = 0.38
/** Visible character body height as a fraction of screen height. */
const CHARACTER_BODY_HEIGHT = 0.2
/** Jump/flying pose body height (smaller — the leaping pose reads larger). */
const JUMP_BODY_HEIGHT = 0.14
/** Swing pose body height (fraction of screen height). */
const SWING_BODY_HEIGHT = 0.16
/** Sink the feet a touch below the slab surface so they don't look like they hover on its edge. */
const CHARACTER_FOOT_SINK = 0.015

/** On-screen thickness of the overhead bar's wood band, as a fraction of screen height. */
const BAR_WOOD_THICKNESS = 0.09

/** Horizontal screen position the camera keeps the character at, as a fraction of width. */
const CHARACTER_SCREEN_X = 0.3
/** How quickly the camera catches up to the player each frame (0–1; higher = snappier). */
const CAM_FOLLOW_LERP = 0.12

/** Per-background-layer parallax factor (index-matched to theme background[]).
 *  0 = static; higher = drifts faster with travel. Sky slow, hills a bit faster. */
const BG_PARALLAX = [0.12, 0.35]

/** Fall past this far below the screen bottom (px) → respawn at the start. */
const FALL_LIMIT = 200

/**
 * Swing physics (custom pendulum — no engine). All in px and seconds.
 */
const SWING_GRAVITY = 2200 // px/s² downward
/** Initial launch velocity off the platform (the tap "jump"). */
const LAUNCH_VX = 480 // px/s rightward
const LAUNCH_VY = -1150 // px/s upward (arcs up into the hook band)
/** Grab the nearest circle within this distance (px) when holding. Generous so
 *  a tap while flying/falling reliably catches the nearest circle. */
const GRAB_RADIUS = 460
/** Per-frame energy retention while swinging (1 = none lost). Near-1 so the
 *  swing keeps its energy and can carry to the next circle. */
const SWING_DAMPING = 0.9995
/** Tangential speed multiplier on release — a slingshot so each release flings
 *  him far enough to reach the next circle. */
const RELEASE_BOOST = 1.5

/** On-screen thickness of the rope vine, as a fraction of screen width. */
const ROPE_WIDTH = 0.06

/** Character motion state. */
const MoveState = {
  Idle: 0,
  Flying: 1,
  Swinging: 2,
  Landing: 3, // reached the goal temple (won) — stops here
} as const
type MoveState = (typeof MoveState)[keyof typeof MoveState]

/** Pre-placed zig-zag chain of wooden circles ahead in the level. */
const HOOK_SIZE = 0.16 // diameter, fraction of screen width
const HOOK_COUNT = 12 // how many circles in the chain
const HOOK_GAP_X = 0.62 // horizontal spacing between circles, fraction of screen width (wider gaps)
const HOOK_START_X = 0.9 // first circle's x — further forward, where the big jump carries him
const HOOK_HIGH_Y = 0.5 // "up" row, fraction of screen height
const HOOK_LOW_Y = 0.58 // "down" row, fraction of screen height (gentler so swings carry)

/** Goal temple at the level end. */
const TEMPLE_HEIGHT = 0.92 // on-screen height, fraction of screen height (tall temple)
const TEMPLE_GROUND_Y = 1.02 // where the temple base sits, fraction of screen height (base off-screen)
/** How far past the last hook the temple sits, fraction of screen width. */
const TEMPLE_GAP_X = 0.55
/** Landing animation (frames 3&4 of the jump source). */
const LAND_ANIM = 'character-land'
const LAND_FPS = 8
const LAND_BODY_HEIGHT = 0.16

/**
 * GameScene — the screen the player enters from the title.
 *
 * Composes the parallax jungle background (2 transparent layers) and places
 * the level start: the starting platform with the character idling on top.
 * Gameplay (hooks, swing physics) is added in a later phase.
 */
export class GameScene extends Phaser.Scene {
  private layers: Phaser.GameObjects.TileSprite[] = []
  private platform!: Phaser.GameObjects.Image
  private overheadBar!: Phaser.GameObjects.TileSprite
  private hooks: Phaser.GameObjects.Image[] = []
  private temple!: Phaser.GameObjects.Image
  /** World landing point on the temple steps. */
  private landingX = 0
  private landingY = 0
  /** Hard end wall: the character can never pass this x (the temple front). */
  private templeWallX = 0
  private character!: Phaser.GameObjects.Sprite
  private rope!: Phaser.GameObjects.Image

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
  /** Current swing animation direction (true = forward/travel direction). */
  private swingForward = true
  /** World position the character starts (and respawns) at. */
  private startX = 0
  private startY = 0

  constructor() {
    super('GameScene')
  }

  create() {
    // Background layers as screen-pinned TileSprites (scrollFactor 0). Each uses
    // a runtime [original|mirrored] texture so tiling is perfectly seamless (no
    // edge-mismatch seam lines). They scroll at different speeds for parallax
    // depth (see update()). Depth: index 0 (sky) behind, index 1 (hills) front.
    this.layers = JungleTheme.assets.background.map((layer, index) =>
      this.add
        .tileSprite(0, 0, GAME_WIDTH, GAME_HEIGHT, this.buildMirroredTexture(layer.key))
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(index)
    )

    const { platform, characterIdle } = JungleTheme.assets

    this.createIdleAnim()
    this.createJumpAnim()
    this.createLandAnim()
    this.createSwingAnims()

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

    // Goal temple at the far right, just past the last hook. Bottom-anchored on
    // the ground line. The character lands on its steps to win.
    const templeX = GAME_WIDTH * (HOOK_START_X + (HOOK_COUNT - 1) * HOOK_GAP_X + TEMPLE_GAP_X)
    this.temple = this.add
      .image(templeX, GAME_HEIGHT * TEMPLE_GROUND_Y, JungleTheme.assets.destination.key)
      .setOrigin(0.5, 1)
      .setDepth(9)

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

    // Swing rope vine, drawn (stretched + rotated) from hook to hands while
    // swinging. Origin top-center so the top sits at the hook. Depth 6 = below
    // the hook (7) and character (11) so both ends tuck under them.
    this.rope = this.add
      .image(0, 0, JungleTheme.assets.rope.key)
      .setOrigin(0.5, 0)
      .setDepth(6)
      .setVisible(false)

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

  /** Leave the platform: play the jump launch animation and start free flight. */
  private launch() {
    this.sound.play(JungleTheme.assets.jumpSound.key)
    this.setJumpPose(true)
    this.vx = LAUNCH_VX
    this.vy = LAUNCH_VY
    this.state = MoveState.Flying
  }

  private createJumpAnim() {
    if (this.anims.exists(JUMP_ANIM)) return
    const jump = JungleTheme.assets.characterJump
    this.anims.create({
      key: JUMP_ANIM,
      frames: this.anims.generateFrameNumbers(jump.key, { start: 0, end: jump.frameCount - 1 }),
      frameRate: JUMP_FPS,
      repeat: 0, // play once
    })
  }

  private createLandAnim() {
    if (this.anims.exists(LAND_ANIM)) return
    const land = JungleTheme.assets.characterLand
    this.anims.create({
      key: LAND_ANIM,
      frames: this.anims.generateFrameNumbers(land.key, { start: 0, end: land.frameCount - 1 }),
      frameRate: LAND_FPS,
      repeat: 0, // play once
    })
  }

  /** Reached the temple: snap onto the steps, play the landing anim once, then
   *  settle into idle. Level complete — stops here. */
  private land() {
    this.state = MoveState.Landing
    this.holding = false
    this.vx = 0
    this.vy = 0
    this.rope.setVisible(false)

    const land = JungleTheme.assets.characterLand
    this.character.setOrigin(0.5, land.feetOriginY)
    this.character.setScale((GAME_HEIGHT * LAND_BODY_HEIGHT) / land.bodyHeight)
    this.character.setPosition(this.landingX, this.landingY)
    this.character.play(LAND_ANIM, true)
    this.character.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      this.setIdlePose()
      this.character.setPosition(this.landingX, this.landingY)
    })

    // Smoothly pan the camera to center the temple on screen.
    this.tweens.add({
      targets: this.cameras.main,
      scrollX: this.temple.x - GAME_WIDTH / 2,
      duration: 600,
      ease: 'Sine.easeInOut',
    })
  }

  /**
   * Flying/jumping pose, feet-anchored. `animate` plays the launch sequence once
   * (used when leaving the platform); otherwise it just holds the final leap
   * frame (used when releasing a hook back into flight).
   */
  private setJumpPose(animate: boolean) {
    const jumpAsset = JungleTheme.assets.characterJump
    this.character.setOrigin(0.5, jumpAsset.feetOriginY)
    this.character.setScale((GAME_HEIGHT * JUMP_BODY_HEIGHT) / jumpAsset.bodyHeight)
    if (animate) {
      this.character.play(JUMP_ANIM, true)
    } else {
      this.character.anims.stop()
      this.character.setTexture(jumpAsset.key, jumpAsset.frameCount - 1)
    }
  }

  private createSwingAnims() {
    const fwd = JungleTheme.assets.characterSwingForward
    const back = JungleTheme.assets.characterSwingBackward
    if (!this.anims.exists(SWING_FWD_ANIM)) {
      this.anims.create({
        key: SWING_FWD_ANIM,
        frames: this.anims.generateFrameNumbers(fwd.key, { start: 0, end: fwd.frameCount - 1 }),
        frameRate: SWING_FPS,
        repeat: -1,
        yoyo: true,
      })
    }
    if (!this.anims.exists(SWING_BACK_ANIM)) {
      this.anims.create({
        key: SWING_BACK_ANIM,
        frames: this.anims.generateFrameNumbers(back.key, { start: 0, end: back.frameCount - 1 }),
        frameRate: SWING_FPS,
        repeat: -1,
        yoyo: true,
      })
    }
  }

  /** Apply the swing pose for a direction (true = forward/travel direction).
   *  Sheets are hand-aligned & origin'd at the hands so the grip stays on the
   *  rope. Both directions are scaled to the same on-screen body height so
   *  swapping never changes size. No-op if already in that pose. */
  private setSwingPose(forward: boolean) {
    if (this.swingForward === forward && this.state === MoveState.Swinging) return
    this.swingForward = forward
    const asset = forward
      ? JungleTheme.assets.characterSwingForward
      : JungleTheme.assets.characterSwingBackward
    this.character.setOrigin(asset.handOriginX, asset.handOriginY)
    this.character.setScale((GAME_HEIGHT * SWING_BODY_HEIGHT) / asset.bodyHeight)
    this.character.play(forward ? SWING_FWD_ANIM : SWING_BACK_ANIM, true)
  }

  /** Choose swing direction with a deadzone so the pose doesn't pop back and
   *  forth at the top of each swing (where angVel passes through 0). */
  private updateSwingDirection() {
    if (this.angVel > SWING_FLIP_DEADZONE) this.setSwingPose(true)
    else if (this.angVel < -SWING_FLIP_DEADZONE) this.setSwingPose(false)
    // else: within the deadzone near the swing's apex — keep the current pose.
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

    this.state = MoveState.Swinging
    // Force the initial swing pose (forward = angle increasing / rightward).
    this.swingForward = this.angVel < 0 // set opposite so setSwingPose always applies
    this.setSwingPose(this.angVel >= 0)
  }

  /** Detach and fly off along the swing's tangent (momentum preserved). */
  private release() {
    if (!this.attachedHook) return
    const tangentialSpeed = this.angVel * this.ropeLen
    const tangentX = Math.cos(this.angle)
    const tangentY = -Math.sin(this.angle)
    this.vx = tangentX * tangentialSpeed * RELEASE_BOOST
    this.vy = tangentY * tangentialSpeed * RELEASE_BOOST

    this.attachedHook = null
    this.setJumpPose(false) // hold the leap frame, don't replay the launch sequence
    this.state = MoveState.Flying
  }

  private nearestHookInRange(): Phaser.GameObjects.Image | null {
    // Always grab the nearest circle in range — re-grab fully enabled (no
    // exclusion), so a tap while falling reliably reconnects to the closest one.
    let best: Phaser.GameObjects.Image | null = null
    let bestDist = GRAB_RADIUS
    for (const hook of this.hooks) {
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

    // Fell off the bottom → respawn at the start.
    if (this.state === MoveState.Flying && this.character.y > GAME_HEIGHT + FALL_LIMIT) {
      this.respawn()
      return
    }

    // The temple is a hard end wall — the character can't pass its front x from
    // any direction (top, bottom, or straight on). Reaching it = land (win).
    if (
      (this.state === MoveState.Flying || this.state === MoveState.Swinging) &&
      this.character.x >= this.templeWallX
    ) {
      this.land()
      return
    }

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
      // Face the swing direction, with a deadzone so it doesn't flip at the apex.
      this.updateSwingDirection()
    }

    this.drawRope()

    // Horizontal-only camera follow (ground/vertical stays fixed). Follows the
    // player in BOTH directions (so swinging backward onto an earlier circle
    // stays in view), smoothly lerped to avoid jitter. Skip while landing/won —
    // land() centers the camera on the temple instead.
    if (this.state === MoveState.Flying || this.state === MoveState.Swinging) {
      const cam = this.cameras.main
      const targetScrollX = this.character.x - GAME_WIDTH * CHARACTER_SCREEN_X
      cam.scrollX += (targetScrollX - cam.scrollX) * CAM_FOLLOW_LERP
    }

    // Parallax: drift each background layer at its own factor relative to the
    // camera, so far (sky) moves slower than near (hills). Runs every frame.
    const scrollX = this.cameras.main.scrollX
    this.layers.forEach((sprite, index) => {
      sprite.tilePositionX = (scrollX * BG_PARALLAX[index]) / sprite.tileScaleX
    })
  }

  /** Stretch + rotate the rope vine from the hook (top) to the hands (bottom). */
  private drawRope() {
    if (this.state !== MoveState.Swinging || !this.attachedHook) {
      this.rope.setVisible(false)
      return
    }
    const a = this.attachedHook
    const b = this.character
    const dist = Math.hypot(b.x - a.x, b.y - a.y)
    const ang = Math.atan2(b.y - a.y, b.x - a.x)

    this.rope.setPosition(a.x, a.y)
    // Vine extends DOWN (+Y) from its top-center origin; rotate to face the hands.
    this.rope.setRotation(ang - Math.PI / 2)
    // Stretch length to span hook→hands; fixed thickness independent of length.
    this.rope.scaleY = dist / this.rope.height
    this.rope.scaleX = (GAME_WIDTH * ROPE_WIDTH) / this.rope.width
    this.rope.setVisible(true)
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
    this.layoutTemple()
    this.layoutStart()
  }

  /** Size the wooden circles. Positions are fixed world coords (set at create). */
  private layoutHooks() {
    const size = GAME_WIDTH * HOOK_SIZE
    for (const hook of this.hooks) hook.setDisplaySize(size, size)
  }

  /** Size the temple (by height) and compute the world landing point on its ledge. */
  private layoutTemple() {
    const dest = JungleTheme.assets.destination
    const scale = (GAME_HEIGHT * TEMPLE_HEIGHT) / this.temple.height
    this.temple.setScale(scale)

    // Landing point = the steps' surface, from the measured ratios. Temple origin
    // is bottom-center, so convert image ratios to world coords around it.
    const w = this.temple.displayWidth
    const h = this.temple.displayHeight
    const left = this.temple.x - w / 2
    const top = this.temple.y - h
    this.landingX = left + w * dest.landingXRatio
    this.landingY = top + h * dest.landingSurfaceRatio
    // Hard end wall at the temple's front entrance — he can't pass this x.
    this.templeWallX = this.landingX
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

  /**
   * Build a `[ original | horizontally-mirrored ]` texture from a loaded image
   * and return its key. This doubled texture tiles perfectly seamlessly (every
   * wrap meets identical pixels), eliminating the edge-mismatch seam lines that
   * appear when tiling the raw, non-seamless background art. Idempotent.
   */
  private buildMirroredTexture(srcKey: string): string {
    const mirrorKey = `${srcKey}__mirror`
    if (this.textures.exists(mirrorKey)) return mirrorKey

    const src = this.textures.get(srcKey).getSourceImage() as HTMLImageElement
    const w = src.width
    const h = src.height
    const canvasTex = this.textures.createCanvas(mirrorKey, w * 2, h)
    if (!canvasTex) return mirrorKey

    const ctx = canvasTex.context
    ctx.clearRect(0, 0, w * 2, h) // preserve transparency (hills)
    ctx.drawImage(src, 0, 0)
    // Mirror into the right half: flip horizontally, translate by 2w.
    ctx.save()
    ctx.translate(w * 2, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(src, 0, 0)
    ctx.restore()
    canvasTex.refresh() // upload canvas → GPU

    return mirrorKey
  }

  /** Cover-fit every background TileSprite to fill the portrait viewport. The
   *  sprite spans the screen; the texture is scaled (tileScale) to cover it and
   *  vertically centered, matching the previous static look — but now scrollable. */
  private layoutBackground() {
    for (const sprite of this.layers) {
      sprite.setPosition(0, 0)
      sprite.setSize(GAME_WIDTH, GAME_HEIGHT)
      const tex = sprite.texture.getSourceImage() as HTMLImageElement
      // The texture is the doubled [original|mirror] canvas, so the single tile
      // width is half of it — cover-fit against that so framing is unchanged.
      const tileW = tex.width / 2
      const scale = Math.max(GAME_WIDTH / tileW, GAME_HEIGHT / tex.height)
      sprite.setTileScale(scale, scale)
      // Center the texture vertically (tilePositionY is in texture pixels).
      sprite.tilePositionY = (tex.height - GAME_HEIGHT / scale) / 2
    }
  }

  /** Place the starting platform (lower-left) and the character standing on it. */
  private layoutStart() {
    const platformX = GAME_WIDTH * PLATFORM_CENTER_X
    const platformBottomY = GAME_HEIGHT * PLATFORM_BOTTOM_Y

    const platformScale = (GAME_WIDTH * PLATFORM_WIDTH) / this.platform.width
    this.platform.setScale(platformScale)
    this.platform.setPosition(platformX, platformBottomY)

    // Record the start/respawn position (feet on the slab's actual top surface,
    // sunk a hair so they rest on it rather than hovering on the edge).
    const platformTopY = platformBottomY - this.platform.displayHeight
    this.startX = platformX
    this.startY =
      platformTopY +
      this.platform.displayHeight *
        (JungleTheme.assets.platform.surfaceRatio + CHARACTER_FOOT_SINK)

    // Once he leaves the platform, the sim owns the character — don't re-plant.
    if (this.state !== MoveState.Idle) return

    this.setIdlePose()
    this.character.setPosition(this.startX, this.startY)
  }

  /** Standing idle pose on the platform. */
  private setIdlePose() {
    const idle = JungleTheme.assets.characterIdle
    this.character.setOrigin(0.5, idle.feetOriginY)
    this.character.setScale((GAME_HEIGHT * CHARACTER_BODY_HEIGHT) / idle.bodyHeight)
    this.character.play(IDLE_ANIM, true)
  }

  /** Return the character to the starting platform after a fall. */
  private respawn() {
    this.state = MoveState.Idle
    this.holding = false
    this.vx = 0
    this.vy = 0
    this.attachedHook = null
    this.rope.setVisible(false)
    this.setIdlePose()
    this.character.setPosition(this.startX, this.startY)
    this.cameras.main.scrollX = 0
  }
}
