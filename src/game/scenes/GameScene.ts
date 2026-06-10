import Phaser from 'phaser'
import { GAME_WIDTH, GAME_HEIGHT } from '../config.ts'
import { JungleTheme } from '../themes/jungle.ts'
import { LEVELS } from '../levels.ts'
import * as Sdk from '../../yt/sdk.ts'
import { progress, saveProgress } from '../save.ts'
import type { GameMode } from './MenuScene.ts'

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
const CAM_FOLLOW_LERP = 0.15

/** Per-background-layer parallax factor (index-matched to theme background[]).
 *  0 = static; higher = drifts faster with travel. Sky slow, hills a bit faster. */
const BG_PARALLAX = [0.12, 0.35]

/** Fall past this far below the screen bottom (px) → respawn at the start. */
const FALL_LIMIT = 200

/**
 * Swing physics (custom pendulum — no engine). All in px and seconds.
 */
/** Swing-feel pass: a touch more gravity gives the pendulum real weight (a heavier
 *  drop/whip through the bottom of the arc); the launch & release are bumped to
 *  match so reach is preserved and the level stays beatable. */
const SWING_GRAVITY = 2600 // px/s² downward (was 2200 — weightier arc)
/** Initial launch velocity off the platform (the tap "jump"). */
const LAUNCH_VX = 480 // px/s rightward
const LAUNCH_VY = -1240 // px/s upward (raised to clear the hook band under heavier gravity)
/** Grab the nearest circle within this distance (px) when holding. Generous so
 *  a tap while flying/falling reliably catches the nearest circle. */
const GRAB_RADIUS = 460
/** Per-frame energy retention while swinging (1 = none lost). Slightly more bleed
 *  than before so swings feel weighty rather than floaty/perpetual. */
const SWING_DAMPING = 0.999
/** Tangential speed multiplier on release — a slingshot so each release flings
 *  him far enough to reach the next circle. Bumped for a punchier, snappier whip. */
const RELEASE_BOOST = 1.65

/** On-screen thickness of the rope vine, as a fraction of screen width. */
const ROPE_WIDTH = 0.06

/** Playback volume for the rope-release SFX (the clips are louder than the jump
 *  sound, so they're turned down to sit at a matching level). */
const RELEASE_SFX_VOLUME = 0.6

/** Visual-juice particle textures (generated at runtime, no art needed). */
const PARTICLE_KEY = 'juice-dot' // soft white dot, tinted per-burst
/** Tints for the bursts. */
const GRAB_TINT = 0x9be36b // leaf green — catching a vine hook
const DUST_TINT = 0xddc9a0 // sandy dust — launch & landing puffs
const BANANA_TINT = 0xffd83d // banana yellow — collecting a banana

/** Character motion state. */
const MoveState = {
  Idle: 0,
  Flying: 1,
  Swinging: 2,
  Landing: 3, // reached the goal temple (won) — stops here
} as const
type MoveState = (typeof MoveState)[keyof typeof MoveState]

/** Pre-placed zig-zag chain of wooden circles ahead in the level. Layout (count,
 *  spacing, heights) is per-level — see src/game/levels.ts. */
const HOOK_SIZE = 0.16 // diameter, fraction of screen width

/** Endless mode: hooks are generated ahead of the camera and culled behind it,
 *  with difficulty ramping by distance. Ramp values extend the campaign's curve
 *  (see src/game/levels.ts) and stay within reachable physics — playtest if a
 *  segment ever feels unbeatable (lower GAP_MAX or raise GAP_RAMP_HOOKS). */
const ENDLESS_LOOKAHEAD = 1.5 // screens of hooks kept spawned ahead of the camera
const ENDLESS_CULL_MARGIN = 0.8 // screens behind the camera before an object is destroyed
const ENDLESS_START_X = 0.9 // first hook x (fraction of width), matches LEVELS
const ENDLESS_GAP_START = 0.62 // starting hook gap (matches LEVELS[0])
const ENDLESS_GAP_MAX = 0.78 // hardest gap (just past LEVELS[4]'s 0.75)
const ENDLESS_GAP_RAMP_HOOKS = 60 // hooks to reach GAP_MAX
const ENDLESS_HIGH_Y_START = 0.5
const ENDLESS_HIGH_Y_MAX = 0.42
const ENDLESS_LOW_Y_START = 0.58
const ENDLESS_LOW_Y_MAX = 0.64
const ENDLESS_Y_JITTER = 0.03 // random row variance (scaled by ramp), fraction of height
const ENDLESS_BANANA_CHANCE = 0.5 // fraction of hook segments that also spawn a banana

/** Goal temple at the level end. */
const TEMPLE_HEIGHT = 0.92 // on-screen height, fraction of screen height (tall temple)
const TEMPLE_GROUND_Y = 1.02 // where the temple base sits, fraction of screen height (base off-screen)
/** Landing animation (frames 3&4 of the jump source). */
const LAND_ANIM = 'character-land'
const LAND_FPS = 8
const LAND_BODY_HEIGHT = 0.16

/** Scoring. */
const SCORE_PER_HOOK = 100 // base points for grabbing a NEW hook
const SCORE_COMBO_STEP = 0.5 // each chained hook adds +0.5x to the multiplier
/** Multiplier ceiling (hit at 9 chained hooks). The combo COUNTER keeps climbing,
 *  but payouts stop growing here — otherwise endless scores inflate quadratically
 *  with run length and BEST becomes unbeatable after one marathon run. */
const SCORE_COMBO_MAX = 5
const SCORE_WIN_BONUS = 500 // bonus for landing on the temple
const SCORE_PER_BANANA = 50 // bonus points for a collected banana
const SCORE_PERFECT_BONUS = 1000 // bonus for collecting every banana in the level

/** Star-rating thresholds on the FINAL score (after all bonuses). 1 star = any
 *  win; 2 and 3 stars reward higher scores (more hooks chained + bananas). */
const STAR_2_SCORE = 2500
const STAR_3_SCORE = 4000

/** Combo fire mode: at this many chained hooks (the x3 multiplier) the game
 *  visibly heats up — fiery combo text, a flame trail on the character, hotter
 *  score blips — so holding a long chain feels valuable and breaking it hurts. */
const FIRE_COMBO_COUNT = 5
const FIRE_TINT = 0xff8c1a // flame orange — ignition burst + trail particles

/** Collectible bananas (drawn at runtime, no art needed). Scattered through the
 *  vertical band the player travels so they stay reachable. Count is per-level
 *  (see src/game/levels.ts). */
const BANANA_SIZE = 0.08 // on-screen height, fraction of screen width
/** Vertical band (fraction of screen height) bananas spawn within — around the
 *  hook rows / swing arcs so they're catchable. */
const BANANA_Y_MIN = 0.4
const BANANA_Y_MAX = 0.72
/** Collect when the character's travel path passes within this distance (px) of
 *  a banana's center. Generous so a banana is never visually clipped yet missed;
 *  combined with the swept (segment) check this also prevents fast pass-throughs. */
const BANANA_COLLECT_RADIUS = 110

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
  /** Goal temple — campaign only; undefined in endless mode (no finish line). */
  private temple?: Phaser.GameObjects.Image
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
  /** Next rope-release SFX variant to play — cycles 0→1→2→3→0… per release. */
  private releaseSfxIndex = 0
  /** Active game mode (set in init()). Campaign = 5 fixed levels + temple finish;
   *  endless = infinite generated run, fall ends the run. */
  private mode: GameMode = 'campaign'
  /** Endless generation cursor: x of the last spawned hook + running hook index. */
  private lastHookX = 0
  private hookIndex = 0
  /** World position the character starts (and respawns) at. */
  private startX = 0
  private startY = 0
  /** Win-state: true once the level is completed (guards gameplay input). */
  private won = false
  /** Once-per-run flag: the mid-run "NEW BEST!" celebration already fired. */
  private newBestHit = false
  /** Combo fire mode state: active flag, the flame trail emitter following the
   *  character, and the pulse tween on the fiery combo text. */
  private onFire = false
  private fireTrail?: Phaser.GameObjects.Particles.ParticleEmitter
  private firePulse?: Phaser.Tweens.Tween
  /** Guards against double-tapping the replay button into stacked restarts. */
  private restarting = false
  /** Screen-pinned overlay objects shown on win (cleaned up on restart). */
  private winOverlay: Phaser.GameObjects.GameObject[] = []
  /** True while the "TRY AGAIN" fall flash is playing (before respawn). */
  private respawning = false

  /** Scoring run-state. */
  private score = 0
  /** Number of hooks chained without falling — drives the combo multiplier. */
  private comboCount = 0
  /** Hooks already scored this run (re-grabbing one pays nothing). */
  private scoredHooks = new Set<Phaser.GameObjects.Image>()
  /** Collectible bananas scattered through the level (collected on overlap). */
  private bananas: Phaser.GameObjects.Image[] = []
  /** How many bananas collected this run (for the perfect-collect bonus + display). */
  private bananasCollected = 0
  /** Total bananas spawned this run (denominator for the perfect-collect check). */
  private bananasTotal = 0
  /** Live HUD: score (top-center), combo multiplier (below it, hidden at 1x), and
   *  the top-left corner label (LEVEL n / BEST n). */
  private scoreText!: Phaser.GameObjects.Text
  private comboText!: Phaser.GameObjects.Text
  private cornerText!: Phaser.GameObjects.Text

  /** Campaign progression, backed by the cloud-save `progress` object so it both
   *  survives scene.restart() AND persists across sessions via YouTube cloud save
   *  (seeded once at boot by loadProgress(), saved at milestones). currentLevel
   *  indexes LEVELS; campaignScore is the running total carried across levels. */
  private static get currentLevel() {
    return progress.level
  }
  private static set currentLevel(v: number) {
    progress.level = v
  }
  private static get campaignScore() {
    return progress.campaignScore
  }
  private static set campaignScore(v: number) {
    progress.campaignScore = v
  }

  /** First-launch tutorial prompt objects (hand + label), torn down on launch. */
  private tutorial: Phaser.GameObjects.GameObject[] = []
  /** Session flag: the tutorial is shown once, not on every replay. Static so it
   *  survives scene.restart() (which reuses the same instance but reruns create). */
  private static tutorialSeen = false

  /** Authoritative mode across scene.restart() (Retry & campaign use bare
   *  restarts). Mirrors tutorialSeen — set in init(), read as the fallback. */
  private static currentMode: GameMode = 'campaign'

  constructor() {
    super('GameScene')
  }

  /** Receive the chosen mode from MenuScene (scene.start('GameScene', { mode })).
   *  Falls back to the static (survives a bare scene.restart) then to campaign. */
  init(data?: { mode?: GameMode }) {
    this.mode = data?.mode ?? GameScene.currentMode ?? 'campaign'
    GameScene.currentMode = this.mode
  }

  /** The active level's layout/difficulty config. Clamps the index so a stale or
   *  out-of-range cloud save (e.g. from a build with more levels) never yields
   *  undefined — it just lands on the last valid level. */
  private get level() {
    const i = Phaser.Math.Clamp(GameScene.currentLevel, 0, LEVELS.length - 1)
    return LEVELS[i]
  }

  create() {
    // Reset all run-state. Phaser's scene.restart() reuses the SAME instance, so
    // class fields keep their previous values — without this, a replay would
    // start with state=Landing/won=true and the character would never be planted.
    this.state = MoveState.Idle
    this.holding = false
    this.vx = 0
    this.vy = 0
    this.attachedHook = null
    this.angle = 0
    this.angVel = 0
    this.swingForward = true
    this.releaseSfxIndex = 0
    this.won = false
    this.newBestHit = false
    // Fire-mode display objects died with the old scene; just clear the refs.
    this.onFire = false
    this.fireTrail = undefined
    this.firePulse = undefined
    this.restarting = false
    this.winOverlay = []
    this.respawning = false
    // Campaign carries the running total across levels; endless starts each run
    // fresh at 0 (it never touches campaignScore).
    this.score = this.mode === 'endless' ? 0 : GameScene.campaignScore
    this.comboCount = 0
    this.hookIndex = 0
    this.lastHookX = 0
    this.scoredHooks.clear()
    this.bananas = []
    this.bananasCollected = 0
    this.bananasTotal = 0
    this.tutorial = []

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
    this.createParticleTexture()

    // Overhead bar: a screen-pinned TileSprite (scrollFactor 0) — a continuous
    // beam across the top no matter how far the camera scrolls forward. Uses a
    // mirrored texture so it tiles seamlessly, and is scrolled each frame (see
    // update()) so the beam drifts with the world for a clear sense of motion.
    const bar = JungleTheme.assets.overheadBar
    const barTex = this.textures.get(bar.key).getSourceImage()
    this.overheadBar = this.add
      .tileSprite(0, 0, GAME_WIDTH, barTex.height, this.buildMirroredTexture(bar.key))
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(5)

    this.hooks = []
    if (this.mode === 'endless') {
      // Endless: hooks + bananas are generated ahead of the camera and culled
      // behind it (see updateEndless). No temple — the run ends on a fall.
      this.initEndlessGeneration()
      this.templeWallX = Infinity // win-check can never fire in endless
    } else {
      // Campaign: pre-placed zig-zag chain of wooden circles at fixed world
      // positions, from the active level's config. Alternating high/low rows.
      const level = this.level
      for (let i = 0; i < level.hookCount; i++) {
        const x = GAME_WIDTH * (level.hookStartX + i * level.hookGapX)
        const y = GAME_HEIGHT * (i % 2 === 0 ? level.hookHighY : level.hookLowY)
        this.spawnHook(x, y, i)
      }

      this.spawnBananas()

      // Goal temple at the far right, just past the last hook. Bottom-anchored on
      // the ground line. The character lands on its steps to win.
      const templeX =
        GAME_WIDTH * (level.hookStartX + (level.hookCount - 1) * level.hookGapX + level.templeGapX)
      this.temple = this.add
        .image(templeX, GAME_HEIGHT * TEMPLE_GROUND_Y, JungleTheme.assets.destination.key)
        .setOrigin(0.5, 1)
        .setDepth(9)
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

    // Swing rope vine, drawn (stretched + rotated) from hook to hands while
    // swinging. Origin top-center so the top sits at the hook. Depth 6 = below
    // the hook (7) and character (11) so both ends tuck under them.
    this.rope = this.add
      .image(0, 0, JungleTheme.assets.rope.key)
      .setOrigin(0.5, 0)
      .setDepth(6)
      .setVisible(false)

    this.createHud()

    this.layout()
    this.scale.on('resize', this.layout, this)

    // First-run onboarding hint (once per session).
    if (!GameScene.tutorialSeen && this.state === MoveState.Idle) {
      this.showTutorial()
    }

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
    // Ignore gameplay taps once the level is won (the win overlay owns input)
    // or while the fall flash is playing.
    if (this.won || this.respawning) return
    this.holding = true
    if (this.state === MoveState.Idle) {
      this.launch()
    }
  }

  private onPointerUp() {
    if (this.won || this.respawning) return
    this.holding = false
    if (this.state === MoveState.Swinging) {
      this.release()
    }
  }

  /** Leave the platform: play the jump launch animation and start free flight. */
  private launch() {
    this.hideTutorial()
    this.sound.play(JungleTheme.assets.jumpSound.key)
    // Dust puff kicked up off the platform under his feet.
    this.burst(this.character.x, this.character.y, DUST_TINT, 10, 200)
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
    this.exitFireMode() // level done — the win overlay takes over from here

    // Completion bonus + perfect-collect bonus (all bananas), then update the live
    // HUD before the win overlay covers it.
    this.score += SCORE_WIN_BONUS
    if (this.bananasTotal > 0 && this.bananasCollected >= this.bananasTotal) {
      this.score += SCORE_PERFECT_BONUS
    }
    this.scoreText.setText(String(this.score))
    // Persist the running total so the next level continues from here, push the
    // final score to YouTube, and roll it into the cloud-saved best/progress.
    GameScene.campaignScore = this.score
    Sdk.sendScore(this.score)
    progress.best = Math.max(this.score, progress.best)
    saveProgress()

    const land = JungleTheme.assets.characterLand
    this.character.setOrigin(0.5, land.feetOriginY)
    this.character.setScale((GAME_HEIGHT * LAND_BODY_HEIGHT) / land.bodyHeight)
    this.character.setPosition(this.landingX, this.landingY)
    this.character.play(LAND_ANIM, true)

    // Juice: touchdown dust at the feet + a brief camera shake for impact + a
    // white screen flash and a win arpeggio.
    this.burst(this.landingX, this.landingY, DUST_TINT, 16, 260)
    this.cameras.main.shake(220, 0.008)
    this.winFlash()
    this.sfxWin()
    this.character.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      this.setIdlePose()
      this.character.setPosition(this.landingX, this.landingY)
    })

    // Smoothly pan the camera to center the temple on screen, then reveal the
    // win overlay so the player can replay. (land() only runs in campaign, where
    // the temple always exists; fall back to the character x just in case.)
    const focusX = this.temple ? this.temple.x : this.character.x
    this.tweens.add({
      targets: this.cameras.main,
      scrollX: focusX - GAME_WIDTH / 2,
      duration: 600,
      ease: 'Sine.easeInOut',
      onComplete: () => this.showWinOverlay(),
    })
  }

  /** Reveal the win overlay. On a non-final level it offers NEXT LEVEL; on the
   *  last level it's a campaign-complete screen with PLAY AGAIN. */
  private showWinOverlay() {
    this.won = true
    // Hide the live HUD so the score/combo/level don't bleed through the overlay
    // (the result is shown cleanly on the win screen instead).
    this.hideHud()

    // Commit the running campaign total to the persistent best before showing it.
    this.commitBestScore()
    const best = this.readBestScore()

    const isFinalLevel = GameScene.currentLevel >= LEVELS.length - 1

    // Dim the scene behind the overlay (screen-pinned, above the world).
    const dim = this.add
      .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x06210f, 0.62)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(100)

    // Headline — final level reads "YOU WIN!" (campaign done); otherwise
    // "LEVEL N COMPLETE!". Cartoon cream/gold fill with a dark outline.
    const headline = isFinalLevel ? 'YOU WIN!' : `LEVEL ${GameScene.currentLevel + 1}\nCOMPLETE!`
    const title = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT * 0.2, headline, {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: isFinalLevel ? '96px' : '72px',
        color: '#ffe9a8',
        stroke: '#3a2410',
        strokeThickness: 12,
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(101)

    // Star rating (1–3) based on the final score. Drawn at runtime; animated to
    // pop in one-by-one for a satisfying reveal.
    const earnedStars = this.starRating()
    const stars = this.buildStarRow(GAME_WIDTH / 2, GAME_HEIGHT * 0.32, earnedStars)

    // Score + bananas + best lines beneath the stars.
    const scoreLine = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT * 0.43, `SCORE  ${this.score}`, {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '52px',
        color: '#ffffff',
        stroke: '#3a2410',
        strokeThickness: 8,
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(101)
    const perfect = this.bananasTotal > 0 && this.bananasCollected >= this.bananasTotal
    const bananaLine = this.add
      .text(
        GAME_WIDTH / 2,
        GAME_HEIGHT * 0.48,
        perfect
          ? `ALL BANANAS!  +${SCORE_PERFECT_BONUS}`
          : `BANANAS  ${this.bananasCollected}/${this.bananasTotal}`,
        {
          fontFamily: 'Arial Black, Arial, sans-serif',
          fontSize: '34px',
          color: perfect ? '#ffd83d' : '#ffffff',
          stroke: '#3a2410',
          strokeThickness: 6,
          align: 'center',
        }
      )
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(101)
    const bestLine = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT * 0.52, `BEST  ${best}`, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '32px',
        color: '#9be36b',
        stroke: '#3a2410',
        strokeThickness: 6,
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(101)

    // Advance button — reuse the title's play-button art. NEXT LEVEL on a normal
    // level, PLAY AGAIN (restart campaign) after the last.
    const button = this.add
      .image(GAME_WIDTH / 2, GAME_HEIGHT * 0.64, JungleTheme.assets.playButton.key)
      .setScrollFactor(0)
      .setDepth(101)
      .setInteractive({ useHandCursor: true })
    const btnScale = (GAME_WIDTH * 0.62) / button.width
    button.setScale(btnScale)
    button.on('pointerdown', isFinalLevel ? this.restartCampaign : this.advanceLevel, this)

    const caption = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT * 0.74, isFinalLevel ? 'TAP TO PLAY AGAIN' : 'TAP FOR NEXT LEVEL', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '34px',
        color: '#ffffff',
        stroke: '#3a2410',
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(101)

    this.winOverlay = [dim, title, ...stars, scoreLine, bananaLine, bestLine, button, caption]

    // Pop-in juice on the text + button (stars animate separately, see buildStarRow).
    for (const obj of [title, scoreLine, bananaLine, bestLine, button, caption]) {
      obj.setAlpha(0)
    }
    const baseScale = button.scale
    this.tweens.add({
      targets: [title, scoreLine, bananaLine, bestLine, button, caption],
      alpha: 1,
      duration: 250,
      ease: 'Quad.easeOut',
    })
    this.tweens.add({
      targets: button,
      scale: { from: baseScale * 0.7, to: baseScale },
      duration: 320,
      ease: 'Back.easeOut',
    })

    // Gentle idle pulse on the button (matches the title screen).
    this.tweens.add({
      targets: button,
      scale: { from: baseScale, to: baseScale * 1.06 },
      duration: 700,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1,
      delay: 320,
    })
  }

  /** Endless run ended (fell). Lock input, commit the score/best, and show a
   *  GAME OVER screen with RETRY (new run) and MENU buttons. Modeled on
   *  showWinOverlay()'s overlay/cleanup patterns. */
  private showGameOver() {
    this.won = true // reuses the existing input lock (onPointerDown/Up guard)
    // Leave the active sim: stops Flying physics, camera follow, and endless
    // generation (all gated on Flying/Swinging) so the world freezes behind the
    // overlay — same mechanism the win path uses.
    this.state = MoveState.Landing
    this.holding = false
    this.vx = 0
    this.vy = 0
    this.rope.setVisible(false)
    this.exitFireMode()
    // Hide the live HUD so the score/combo/best don't bleed through the overlay
    // (the result is shown cleanly on the game-over screen instead).
    this.hideHud()

    // Commit best + push to YouTube + persist (best is the shared high score).
    // Capture the pre-commit best so the overlay can highlight a new record —
    // this also covers the first-ever record, which the mid-run guard skips.
    const isRecord = this.score > progress.best
    progress.best = Math.max(this.score, progress.best)
    Sdk.sendScore(this.score)
    saveProgress()
    const best = progress.best

    this.sfxFail()

    const dim = this.add
      .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x210606, 0.66)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(100)

    const title = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT * 0.24, 'GAME OVER', {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '88px',
        color: '#ffe9a8',
        stroke: '#3a2410',
        strokeThickness: 12,
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(101)

    const scoreLine = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT * 0.37, `SCORE  ${this.score}`, {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '52px',
        color: '#ffffff',
        stroke: '#3a2410',
        strokeThickness: 8,
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(101)

    // Best line — a fresh record gets the gold "NEW BEST!" treatment.
    const bestLine = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT * 0.43, isRecord ? `NEW BEST  ${best}!` : `BEST  ${best}`, {
        fontFamily: isRecord ? 'Arial Black, Arial, sans-serif' : 'Arial, sans-serif',
        fontSize: isRecord ? '44px' : '36px',
        color: isRecord ? '#ffd83d' : '#9be36b',
        stroke: '#3a2410',
        strokeThickness: isRecord ? 8 : 6,
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(101)
    if (isRecord) {
      // Gentle attention pulse on the record line.
      this.tweens.add({
        targets: bestLine,
        scale: { from: 1, to: 1.08 },
        duration: 500,
        ease: 'Sine.easeInOut',
        yoyo: true,
        repeat: -1,
      })
    }

    // RETRY — the dedicated retry-button art; restarts a fresh endless run.
    const retry = this.add
      .image(GAME_WIDTH / 2, GAME_HEIGHT * 0.57, JungleTheme.assets.retryButton.key)
      .setScrollFactor(0)
      .setDepth(101)
      .setInteractive({ useHandCursor: true })
    const retryScale = (GAME_WIDTH * 0.62) / retry.width
    retry.setScale(retryScale)
    retry.on('pointerdown', this.restartScene, this)

    // MENU — back to mode select. A bordered text button (no art needed).
    const menuBtn = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT * 0.69, 'MENU', {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '40px',
        color: '#ffe9a8',
        stroke: '#3a2410',
        strokeThickness: 8,
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(101)
      .setInteractive({ useHandCursor: true })
    menuBtn.on('pointerdown', this.toMenu, this)

    this.winOverlay = [dim, title, scoreLine, bestLine, retry, menuBtn]

    // Pop-in juice (everything but the dim fades in).
    const popIn = [title, scoreLine, bestLine, retry, menuBtn]
    for (const obj of popIn) obj.setAlpha(0)
    this.tweens.add({
      targets: popIn,
      alpha: 1,
      duration: 250,
      ease: 'Quad.easeOut',
    })
    this.tweens.add({
      targets: retry,
      scale: { from: retryScale * 0.7, to: retryScale },
      duration: 320,
      ease: 'Back.easeOut',
    })
  }

  // --- Star rating ---------------------------------------------------------

  /** Map the final score to a 1–3 star rating (a win is always at least 1 star). */
  private starRating(): number {
    if (this.score >= STAR_3_SCORE) return 3
    if (this.score >= STAR_2_SCORE) return 2
    return 1
  }

  /** Build a centered row of 3 stars (earned ones gold, the rest dimmed) and
   *  pop them in one-by-one. Returns the star images for overlay cleanup. */
  private buildStarRow(cx: number, cy: number, earned: number): Phaser.GameObjects.Image[] {
    const key = this.buildStarTexture()
    const size = GAME_WIDTH * 0.16
    const gap = size * 1.1
    const startX = cx - gap // 3 stars centered around cx
    const out: Phaser.GameObjects.Image[] = []

    for (let i = 0; i < 3; i++) {
      const isEarned = i < earned
      const star = this.add
        .image(startX + i * gap, cy, key)
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(101)
      star.setDisplaySize(size, size)
      star.setTint(isEarned ? 0xffd83d : 0x4a5a3a) // gold vs. dim green-grey
      out.push(star)

      if (isEarned) {
        // Pop each earned star in sequence (scale-bounce + a little sound).
        const targetScale = star.scale
        star.setScale(targetScale * 0.2)
        this.tweens.add({
          targets: star,
          scale: targetScale,
          duration: 280,
          ease: 'Back.easeOut',
          delay: 300 + i * 220,
        })
        this.time.delayedCall(300 + i * 220, () =>
          this.playTone({ freq: 700 + i * 200, type: 'triangle', duration: 0.14, gain: 0.1 })
        )
      } else {
        star.setAlpha(0)
        this.tweens.add({ targets: star, alpha: 0.85, duration: 250, delay: 250 })
      }
    }
    return out
  }

  /** Draw a 5-point star texture once (asset-free), tinted per-use. */
  private buildStarTexture(): string {
    const key = 'rating-star'
    if (this.textures.exists(key)) return key

    const size = 120
    const cx = size / 2
    const cy = size / 2
    const outer = 56
    const inner = 24
    // 10 alternating outer/inner vertices, starting at the top point.
    const points: Phaser.Math.Vector2[] = []
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? outer : inner
      const a = -Math.PI / 2 + (i * Math.PI) / 5
      points.push(new Phaser.Math.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r))
    }

    const g = this.make.graphics({ x: 0, y: 0 }, false)
    g.fillStyle(0xffffff, 1) // white so per-use tints render true
    g.fillPoints(points, true)
    // Dark outline for cartoon readability.
    g.lineStyle(6, 0x3a2410, 1)
    g.strokePoints(points, true, true)

    g.generateTexture(key, size, size)
    g.destroy()
    return key
  }

  /** Fade out and restart the level from scratch. */
  /** Advance to the next level: bump the level index (campaignScore already holds
   *  the running total) and restart the scene to build it. */
  private advanceLevel() {
    GameScene.currentLevel = Math.min(GameScene.currentLevel + 1, LEVELS.length - 1)
    saveProgress() // persist the new level/running score before rebuilding
    this.restartScene()
  }

  /** Start a fresh campaign from level 1 with a clean score (best is retained). */
  private restartCampaign() {
    GameScene.currentLevel = 0
    GameScene.campaignScore = 0
    saveProgress()
    this.restartScene()
  }

  /** Shared fade-out → scene.restart() transition used by the win/game-over
   *  buttons. Passes the current mode so a rebuilt scene stays in the same mode
   *  (the static currentMode is the authoritative fallback). */
  private restartScene() {
    if (this.restarting) return
    this.restarting = true
    // Tear down the overlay objects (scene.restart also destroys them, but this
    // makes the intent explicit and drops the button's listener immediately).
    for (const obj of this.winOverlay) obj.destroy()
    this.winOverlay = []
    this.cameras.main.fadeOut(200, 0, 0, 0)
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.restart({ mode: this.mode })
    })
  }

  /** Fade out → return to the mode-select menu (endless game-over MENU button). */
  private toMenu() {
    if (this.restarting) return
    this.restarting = true
    for (const obj of this.winOverlay) obj.destroy()
    this.winOverlay = []
    this.cameras.main.fadeOut(200, 0, 0, 0)
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start('MenuScene')
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
    this.addScore(hook)
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

    // Juice: leaf burst at the grabbed hook + a quick pop on both hook & character.
    this.burst(hook.x, hook.y, GRAB_TINT, 12, 260)
    this.squashPop()
    this.popHook(hook)
    this.sfxAttach()
  }

  /** Quick scale-bounce on a hook when grabbed. */
  private popHook(hook: Phaser.GameObjects.Image) {
    const s = hook.scale
    this.tweens.add({
      targets: hook,
      scale: s * 1.18,
      duration: 110,
      ease: 'Quad.easeOut',
      yoyo: true,
    })
  }

  /** Detach and fly off along the swing's tangent (momentum preserved). */
  private release() {
    if (!this.attachedHook) return
    const tangentialSpeed = this.angVel * this.ropeLen
    const tangentX = Math.cos(this.angle)
    const tangentY = -Math.sin(this.angle)
    this.vx = tangentX * tangentialSpeed * RELEASE_BOOST
    this.vy = tangentY * tangentialSpeed * RELEASE_BOOST

    // Juice: a small puff at the point of release.
    this.burst(this.character.x, this.character.y, GRAB_TINT, 8, 220)
    this.sfxRelease()

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

  // --- Scoring -------------------------------------------------------------

  /** Build the screen-pinned score + combo HUD. Depth 50 keeps it above the
   *  world but below the win overlay (100) so it's covered when you win. */
  private createHud() {
    // The overhead wooden bar occupies the top ~BAR_WOOD_THICKNESS of the screen,
    // so the HUD is placed just BELOW it (in the open sky) to avoid overlapping
    // the bar and reading as cramped. Stacked, centered: label → score → combo.
    const hudTopY = GAME_HEIGHT * (BAR_WOOD_THICKNESS + 0.02)

    // Top label (centered). Campaign shows the level; endless shows the best
    // score to chase. Sits ABOVE the current score.
    const cornerLabel =
      this.mode === 'endless' ? `BEST ${progress.best}` : `LEVEL ${GameScene.currentLevel + 1}`
    this.cornerText = this.add
      .text(GAME_WIDTH * 0.5, hudTopY, cornerLabel, {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '34px',
        color: '#ffffff',
        stroke: '#3a2410',
        strokeThickness: 6,
        align: 'center',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(50)

    // Current score: centered, just below the label.
    this.scoreText = this.add
      .text(GAME_WIDTH * 0.5, hudTopY + GAME_HEIGHT * 0.04, String(this.score), {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '64px',
        color: '#ffe9a8',
        stroke: '#3a2410',
        strokeThickness: 8,
        align: 'center',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(50)

    // Combo multiplier, just under the score.
    this.comboText = this.add
      .text(GAME_WIDTH * 0.5, hudTopY + GAME_HEIGHT * 0.11, '', {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '40px',
        color: '#9be36b',
        stroke: '#3a2410',
        strokeThickness: 6,
        align: 'center',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(50)
      .setVisible(false)
  }

  /** Hide the live HUD (score, combo, corner) — used when the game-over overlay
   *  takes over so the live readouts don't bleed through behind it. */
  private hideHud() {
    this.scoreText.setVisible(false)
    this.comboText.setVisible(false)
    this.cornerText.setVisible(false)
  }

  /** Bring the live HUD back (after the "NEW BEST!" banner). Combo visibility is
   *  conditional (hidden at 1x), so it's restored via updateComboHud(). */
  private showHud() {
    this.scoreText.setVisible(true)
    this.cornerText.setVisible(true)
    this.updateComboHud()
  }

  // --- Tutorial ------------------------------------------------------------

  /** First-run hint: a pulsing "TAP & HOLD TO SWING" label anchored above the
   *  character (where the action starts). Torn down on the first launch and
   *  never shown again this session. */
  private showTutorial() {
    // Horizontally centered & screen-pinned (scrollFactor 0) so the wide label
    // never clips off the ENVELOP side-crop or drifts with the camera. Sits in
    // the open sky above the character.
    const hy = this.character.y - GAME_HEIGHT * 0.36

    const label = this.add
      .text(GAME_WIDTH * 0.5, hy, 'TAP & HOLD\nTO SWING', {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '40px',
        color: '#ffffff',
        stroke: '#3a2410',
        strokeThickness: 7,
        align: 'center',
      })
      .setOrigin(0.5, 1)
      .setScrollFactor(0)
      .setDepth(40)

    this.tutorial = [label]

    // Gentle alpha pulse on the label.
    this.tweens.add({
      targets: label,
      alpha: { from: 1, to: 0.55 },
      duration: 700,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1,
    })
  }

  /** Tear down the tutorial prompt (on first launch) and mark it seen. */
  private hideTutorial() {
    if (this.tutorial.length === 0) return
    GameScene.tutorialSeen = true
    const objs = this.tutorial
    this.tutorial = []
    this.tweens.add({
      targets: objs,
      alpha: 0,
      duration: 200,
      ease: 'Quad.easeOut',
      onComplete: () => {
        for (const o of objs) o.destroy()
      },
    })
  }

  // --- Synth SFX (Web Audio, asset-free) -----------------------------------

  /** The Web Audio context, exposed by Phaser's WebAudio sound manager. Undefined
   *  under the HTML5 fallback or before the first user gesture unlocks audio. */
  private audioCtx(): AudioContext | undefined {
    return (this.sound as unknown as { context?: AudioContext }).context
  }

  /** Play a short synthesized tone with an attack/decay envelope and an optional
   *  frequency slide. No-op if the audio context isn't available. */
  private playTone(opts: {
    freq: number
    type?: OscillatorType
    duration?: number
    gain?: number
    slideTo?: number
    delay?: number
  }) {
    // Respect YouTube's mute / paused state. This synth path bypasses Phaser's
    // mixer, so game.sound.mute wouldn't catch it — gate on the shared flag.
    if (!Sdk.getAudioAllowed()) return
    const ctx = this.audioCtx()
    if (!ctx) return
    const { freq, type = 'sine', duration = 0.12, gain = 0.12, slideTo, delay = 0 } = opts
    const t0 = ctx.currentTime + delay

    const osc = ctx.createOscillator()
    const env = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t0)
    if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + duration)

    // Quick attack, smooth decay to silence.
    env.gain.setValueAtTime(0.0001, t0)
    env.gain.exponentialRampToValueAtTime(gain, t0 + 0.012)
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)

    osc.connect(env).connect(ctx.destination)
    osc.start(t0)
    osc.stop(t0 + duration + 0.02)
  }

  /** Soft "catch" chirp when the rope locks onto a hook — a quick rising two-note
   *  ping that reads as "attached" (distinct from the heavier jump/release SFX). */
  private sfxAttach() {
    this.playTone({ freq: 740, type: 'triangle', duration: 0.06, gain: 0.08 })
    this.playTone({ freq: 1100, type: 'triangle', duration: 0.08, gain: 0.07, delay: 0.05 })
  }

  /** Rope-release sound when letting go of a hook. Cycles through the loaded
   *  variants in order so repeated releases don't sound identical. */
  private sfxRelease() {
    const variants = JungleTheme.assets.ropeReleaseSounds
    this.sound.play(variants[this.releaseSfxIndex].key, { volume: RELEASE_SFX_VOLUME })
    this.releaseSfxIndex = (this.releaseSfxIndex + 1) % variants.length
  }

  /** Rising blip on score — pitch climbs with the combo for a satisfying ladder.
   *  On fire, a quieter sawtooth layer doubles it for a hotter, edgier timbre. */
  private sfxScore() {
    const step = Math.min(this.comboCount, 12)
    const freq = 520 * Math.pow(2, step / 12) // up a semitone-ish per chained hook
    this.playTone({ freq, type: 'triangle', duration: 0.1, gain: 0.09 })
    if (this.onFire) {
      this.playTone({ freq, type: 'sawtooth', duration: 0.1, gain: 0.05 })
    }
  }

  /** Three-note ascending arpeggio on win. */
  private sfxWin() {
    const notes = [523, 659, 784, 1047] // C5 E5 G5 C6
    notes.forEach((freq, i) =>
      this.playTone({ freq, type: 'triangle', duration: 0.16, gain: 0.11, delay: i * 0.11 })
    )
  }

  /** Downward thud when falling. */
  private sfxFail() {
    this.playTone({ freq: 320, slideTo: 90, type: 'sawtooth', duration: 0.3, gain: 0.12 })
  }

  /** A quick white full-screen flash that fades out — punctuates the win. */
  private winFlash() {
    const flash = this.add
      .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0xffffff, 0.7)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(99) // just under the win overlay's dim (100)
    this.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 320,
      ease: 'Quad.easeOut',
      onComplete: () => flash.destroy(),
    })
  }

  /** Award points for grabbing a NEW hook, ramping the combo multiplier. Re-grabs
   *  of an already-scored hook pay nothing and don't touch the combo. */
  private addScore(hook: Phaser.GameObjects.Image) {
    if (this.scoredHooks.has(hook)) return
    this.scoredHooks.add(hook)

    this.comboCount++
    if (!this.onFire && this.comboCount >= FIRE_COMBO_COUNT) this.enterFireMode()
    const points = Math.floor(SCORE_PER_HOOK * this.comboMultiplier())
    this.score += points

    this.scoreText.setText(String(this.score))
    this.bumpScoreText()
    this.updateComboHud()
    this.popFloatingScore(hook.x, hook.y, points)
    this.sfxScore()
    Sdk.sendScore(this.score)
    this.checkNewBest()
  }

  /** Fire the "NEW BEST!" celebration the first time an endless run's live score
   *  passes the stored best. Presentation only — progress.best is still committed
   *  at game over. Skipped on the very first run ever (best 0: no record to beat);
   *  the game-over screen still highlights that first record. */
  private checkNewBest() {
    if (this.mode !== 'endless' || this.newBestHit) return
    if (progress.best <= 0 || this.score <= progress.best) return
    this.newBestHit = true

    // Persistent signal for the rest of the run: the BEST label goes gold.
    this.cornerText.setColor('#ffd83d')

    // Gold burst at the character + a tiny shake + a quick rising fanfare
    // (distinct from the win arpeggio).
    this.burst(this.character.x, this.character.y, BANANA_TINT, 14, 280)
    this.cameras.main.shake(150, 0.004)
    const notes = [659, 880, 1319] // E5 A5 E6 — bright, short
    notes.forEach((freq, i) =>
      this.playTone({ freq, type: 'triangle', duration: 0.12, gain: 0.12, delay: i * 0.07 })
    )

    // Screen-pinned "NEW BEST!" pop; bounces in, holds, fades out — never blocks
    // play. The live HUD steps aside while it shows (hidden on pop, restored on
    // fade) so the banner owns the moment.
    this.hideHud()
    const label = this.add
      .text(GAME_WIDTH * 0.5, GAME_HEIGHT * 0.24, 'NEW BEST!', {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '64px',
        color: '#ffd83d',
        stroke: '#3a2410',
        strokeThickness: 10,
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(60) // above the HUD (50), below overlays (100)
      .setScale(0.2)
    this.tweens.add({
      targets: label,
      scale: 1,
      duration: 320,
      ease: 'Back.easeOut',
    })
    this.tweens.add({
      targets: label,
      alpha: 0,
      delay: 1100,
      duration: 300,
      ease: 'Quad.easeOut',
      onComplete: () => {
        label.destroy()
        // Don't bring the HUD back if a win/game-over overlay took over while
        // the banner was up (those keep the HUD hidden behind them).
        if (!this.won) this.showHud()
      },
    })
  }

  // --- Combo fire mode -------------------------------------------------------

  /** Ignite fire mode (combo reached FIRE_COMBO_COUNT): fiery pulsing combo text,
   *  a flame trail following the character, and an ignition burst + sizzle. */
  private enterFireMode() {
    this.onFire = true

    // Combo text flares: orange-gold over a deep red-brown, with a live pulse.
    this.comboText.setColor('#ffb13d')
    this.comboText.setStroke('#7a1d06', 6)
    this.firePulse = this.tweens.add({
      targets: this.comboText,
      scale: { from: 1, to: 1.12 },
      duration: 360,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1,
    })

    // Flame trail: small, short-lived embers shed behind the character. Depth 10
    // tucks it just under the character (11) so the figure stays readable.
    this.fireTrail = this.add.particles(0, 0, PARTICLE_KEY, {
      tint: FIRE_TINT,
      lifespan: 300,
      frequency: 45,
      speed: { min: 20, max: 70 },
      angle: { min: 60, max: 120 }, // shed downward-ish, drifting off the arc
      scale: { start: 0.45, end: 0 },
      alpha: { start: 0.85, end: 0 },
      gravityY: -120, // embers float up as they fade
    })
    this.fireTrail.setDepth(10)
    this.fireTrail.startFollow(this.character)

    // Ignition flourish: flame burst at the character + a rising sizzle.
    this.burst(this.character.x, this.character.y, FIRE_TINT, 14, 280)
    this.playTone({ freq: 220, slideTo: 880, type: 'sawtooth', duration: 0.18, gain: 0.08 })
  }

  /** Put the fire out (combo died): restore the calm green combo style, stop the
   *  pulse, and remove the trail. Safe to call when not on fire. */
  private exitFireMode() {
    if (!this.onFire) return
    this.onFire = false

    this.firePulse?.remove()
    this.firePulse = undefined
    this.comboText.setScale(1)
    this.comboText.setColor('#9be36b')
    this.comboText.setStroke('#3a2410', 6)

    this.fireTrail?.destroy()
    this.fireTrail = undefined
  }

  /** Refresh the combo HUD (hidden at 1x, shown as "xN.N COMBO" above). */
  private updateComboHud() {
    if (this.comboCount <= 1) {
      this.comboText.setVisible(false)
      return
    }
    const multiplier = this.comboMultiplier()
    const label = Number.isInteger(multiplier) ? `${multiplier}` : multiplier.toFixed(1)
    this.comboText.setText(`x${label} COMBO`).setVisible(true)
  }

  /** The current payout multiplier, capped at SCORE_COMBO_MAX. Single source for
   *  both the score math and the HUD so they can never disagree. */
  private comboMultiplier(): number {
    return Math.min(1 + (this.comboCount - 1) * SCORE_COMBO_STEP, SCORE_COMBO_MAX)
  }

  /** Quick scale-pop on the score readout when it changes (juice). */
  private bumpScoreText() {
    this.tweens.add({
      targets: this.scoreText,
      scale: { from: 1.25, to: 1 },
      duration: 180,
      ease: 'Back.easeOut',
    })
  }

  /** Floating "+N" that rises and fades at a grabbed hook (world-space). */
  private popFloatingScore(x: number, y: number, points: number) {
    const label = this.add
      .text(x, y, `+${points}`, {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '44px',
        color: '#ffe9a8',
        stroke: '#3a2410',
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setDepth(12) // above the character (11), matching the burst particles

    this.tweens.add({
      targets: label,
      y: y - GAME_HEIGHT * 0.08,
      alpha: { from: 1, to: 0 },
      duration: 700,
      ease: 'Quad.easeOut',
      onComplete: () => label.destroy(),
    })
  }

  // --- Hooks ---------------------------------------------------------------

  /** Create one wooden-circle hook at a world position with the subtle idle-bob
   *  that reads it as a live target. Shared by campaign (fixed) and endless
   *  (generated). `seq` staggers the bob; modulo keeps endless delays bounded. */
  private spawnHook(x: number, y: number, seq: number): Phaser.GameObjects.Image {
    const hook = this.add.image(x, y, JungleTheme.assets.hook.key).setOrigin(0.5).setDepth(7)
    hook.setDisplaySize(GAME_WIDTH * HOOK_SIZE, GAME_WIDTH * HOOK_SIZE)
    this.tweens.add({
      targets: hook,
      y: y + 4,
      duration: 1100,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1,
      delay: (seq % 8) * 120,
    })
    this.hooks.push(hook)
    return hook
  }

  // --- Endless generation --------------------------------------------------

  /** Seed the endless run: populate the first screen + lookahead with hooks. */
  private initEndlessGeneration() {
    this.hookIndex = 0
    // Place the cursor one easy gap before the first hook so the opening hook
    // lands at ENDLESS_START_X.
    this.lastHookX = GAME_WIDTH * (ENDLESS_START_X - ENDLESS_GAP_START)
    while (this.lastHookX < GAME_WIDTH * ENDLESS_LOOKAHEAD) this.spawnNextHook()
  }

  /** Spawn the next hook in the endless chain, with gap/height ramping by
   *  distance, and (sometimes) a banana on the same segment. */
  private spawnNextHook() {
    const i = this.hookIndex++
    const t = Math.min(i / ENDLESS_GAP_RAMP_HOOKS, 1) // 0 → 1 difficulty ramp

    const gap = Phaser.Math.Linear(ENDLESS_GAP_START, ENDLESS_GAP_MAX, t)
    this.lastHookX += GAME_WIDTH * gap

    const highY = Phaser.Math.Linear(ENDLESS_HIGH_Y_START, ENDLESS_HIGH_Y_MAX, t)
    const lowY = Phaser.Math.Linear(ENDLESS_LOW_Y_START, ENDLESS_LOW_Y_MAX, t)
    const jitter = (Math.random() * 2 - 1) * ENDLESS_Y_JITTER * t
    const yFrac = Phaser.Math.Clamp((i % 2 === 0 ? highY : lowY) + jitter, 0.38, 0.68)

    this.spawnHook(this.lastHookX, GAME_HEIGHT * yFrac, i)

    if (Math.random() < ENDLESS_BANANA_CHANCE) {
      // Bias the banana toward the swing arc between the two rows.
      const by = GAME_HEIGHT * Phaser.Math.Clamp(yFrac + 0.06, BANANA_Y_MIN, BANANA_Y_MAX)
      this.spawnBanana(this.lastHookX, by, i)
    }
  }

  /** Per-frame endless driver: spawn ahead of the camera, cull far behind it.
   *  Called from update() after the camera lerp so scrollX is current. */
  private updateEndless() {
    const scrollX = this.cameras.main.scrollX
    while (this.lastHookX < scrollX + GAME_WIDTH * ENDLESS_LOOKAHEAD) this.spawnNextHook()

    const cullX = scrollX - GAME_WIDTH * ENDLESS_CULL_MARGIN
    for (let i = this.hooks.length - 1; i >= 0; i--) {
      const h = this.hooks[i]
      // Never cull the hook we're currently swinging on — it drives the pendulum.
      if (h.x < cullX && h !== this.attachedHook) {
        this.scoredHooks.delete(h)
        this.tweens.killTweensOf(h)
        h.destroy()
        this.hooks.splice(i, 1)
      }
    }
    for (let i = this.bananas.length - 1; i >= 0; i--) {
      const b = this.bananas[i]
      if (b.x < cullX) {
        this.tweens.killTweensOf(b)
        b.destroy()
        this.bananas.splice(i, 1)
      }
    }
  }

  // --- Collectible bananas -------------------------------------------------

  /** Create one bobbing/spinning banana collectible at a world position. Shared
   *  by campaign scatter and endless generation. */
  private spawnBanana(x: number, y: number, seq: number): Phaser.GameObjects.Image {
    const banana = this.add.image(x, y, JungleTheme.assets.banana.key).setOrigin(0.5).setDepth(8)
    banana.setDisplaySize(GAME_WIDTH * BANANA_SIZE, GAME_WIDTH * BANANA_SIZE)
    this.bananas.push(banana)

    // Idle bob + slow rotation so it reads as a live collectible.
    this.tweens.add({
      targets: banana,
      y: y + 8,
      duration: 900,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1,
      delay: (seq % 8) * 90,
    })
    this.tweens.add({
      targets: banana,
      angle: 360,
      duration: 4000,
      ease: 'Linear',
      repeat: -1,
    })
    return banana
  }

  /** Scatter bananas randomly across the level's horizontal span, within the
   *  vertical band the player travels so they stay reachable. Each gently
   *  spins/bobs to read as a pickup. */
  private spawnBananas() {
    // Horizontal span: from the first hook to just past the last (where the
    // action happens), with a little margin so none hide behind the temple.
    const level = this.level
    const firstX = GAME_WIDTH * level.hookStartX
    const lastX = GAME_WIDTH * (level.hookStartX + (level.hookCount - 1) * level.hookGapX)

    for (let i = 0; i < level.bananaCount; i++) {
      const x = Phaser.Math.Between(firstX, lastX)
      const y = Phaser.Math.Between(GAME_HEIGHT * BANANA_Y_MIN, GAME_HEIGHT * BANANA_Y_MAX)
      this.spawnBanana(x, y, i)
    }
    this.bananasTotal = this.bananas.length
  }

  /** Collect any banana the character now overlaps. Iterates a copy-free reverse
   *  loop so we can splice out collected ones safely. */
  /** Collect any banana whose center lies within BANANA_COLLECT_RADIUS of the
   *  segment the character travelled this frame (prev → current). Using the swept
   *  segment instead of just the current point means a fast swing/release can't
   *  tunnel straight past a banana between frames. */
  private checkBananaPickups(prevX: number, prevY: number) {
    const curX = this.character.x
    const curY = this.character.y
    const r2 = BANANA_COLLECT_RADIUS * BANANA_COLLECT_RADIUS
    for (let i = this.bananas.length - 1; i >= 0; i--) {
      const banana = this.bananas[i]
      if (this.distSqPointToSegment(banana.x, banana.y, prevX, prevY, curX, curY) <= r2) {
        this.bananas.splice(i, 1)
        this.collectBanana(banana)
      }
    }
  }

  /** Squared distance from point (px,py) to the line segment (ax,ay)-(bx,by).
   *  Squared to avoid a sqrt in the per-frame, per-banana loop. */
  private distSqPointToSegment(
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number
  ): number {
    const abx = bx - ax
    const aby = by - ay
    const lenSq = abx * abx + aby * aby
    // Degenerate segment (no movement this frame) → point-to-point distance.
    let t = lenSq > 0 ? ((px - ax) * abx + (py - ay) * aby) / lenSq : 0
    t = t < 0 ? 0 : t > 1 ? 1 : t // clamp to the segment
    const dx = px - (ax + abx * t)
    const dy = py - (ay + aby * t)
    return dx * dx + dy * dy
  }

  /** Award banana points + juice, then remove it. */
  private collectBanana(banana: Phaser.GameObjects.Image) {
    this.score += SCORE_PER_BANANA
    this.bananasCollected++
    this.scoreText.setText(String(this.score))
    this.bumpScoreText()

    this.burst(banana.x, banana.y, BANANA_TINT, 10, 240)
    this.popFloatingScore(banana.x, banana.y, SCORE_PER_BANANA)
    this.sfxBanana()
    Sdk.sendScore(this.score)
    this.checkNewBest()

    // Quick pop-out, then destroy.
    this.tweens.killTweensOf(banana)
    this.tweens.add({
      targets: banana,
      scale: banana.scale * 1.6,
      alpha: 0,
      duration: 180,
      ease: 'Quad.easeOut',
      onComplete: () => banana.destroy(),
    })
  }

  /** Bright two-note "pickup" chirp. */
  private sfxBanana() {
    // Louder, brighter three-note rising sparkle so a pickup feels rewarding.
    this.playTone({ freq: 880, type: 'triangle', duration: 0.07, gain: 0.22 })
    this.playTone({ freq: 1175, type: 'triangle', duration: 0.08, gain: 0.22, delay: 0.05 })
    this.playTone({ freq: 1568, type: 'triangle', duration: 0.1, gain: 0.2, delay: 0.1 })
  }

  /** Roll the run's final score into the cloud-saved best and persist progress.
   *  (Cloud save is the only permitted mechanism — no localStorage.) */
  private commitBestScore() {
    progress.best = Math.max(this.score, progress.best)
    saveProgress()
  }

  private readBestScore(): number {
    return progress.best
  }

  update(_time: number, delta: number) {
    const dt = delta / 1000

    // Fell off the bottom → campaign: "TRY AGAIN" flash + respawn; endless: game
    // over. The `!this.won` guard stops endless re-triggering every frame (the
    // character stays Flying below the limit until the overlay restarts/leaves).
    if (
      this.state === MoveState.Flying &&
      !this.respawning &&
      !this.won &&
      this.character.y > GAME_HEIGHT + FALL_LIMIT
    ) {
      this.fail()
      return
    }

    // While the fall flash plays, hold the world still (no physics/grab/camera).
    if (this.respawning) return

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

    // Remember where the character was before this frame's movement so banana
    // pickups can sweep the full path travelled (no tunneling past fast).
    const prevX = this.character.x
    const prevY = this.character.y

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

    // Sweep up any banana along the path travelled this frame (while in motion).
    if (this.state === MoveState.Flying || this.state === MoveState.Swinging) {
      this.checkBananaPickups(prevX, prevY)
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

    // Endless: generate hooks ahead of the (now-updated) camera and cull behind.
    if (this.mode === 'endless') this.updateEndless()

    // Parallax: drift each background layer at its own factor relative to the
    // camera, so far (sky) moves slower than near (hills). Runs every frame.
    const scrollX = this.cameras.main.scrollX
    this.layers.forEach((sprite, index) => {
      sprite.tilePositionX = (scrollX * BG_PARALLAX[index]) / sprite.tileScaleX
    })

    // Overhead bar drifts with the world (factor 1) so the beam reads as a
    // continuous structure scrolling past, matching the foreground motion.
    this.overheadBar.tilePositionX = scrollX / this.overheadBar.tileScaleX
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
    if (this.temple) this.layoutTemple() // endless has no temple
    this.layoutStart()
  }

  /** Size the wooden circles. Positions are fixed world coords (set at create). */
  private layoutHooks() {
    const size = GAME_WIDTH * HOOK_SIZE
    for (const hook of this.hooks) hook.setDisplaySize(size, size)
  }

  /** Size the temple (by height) and compute the world landing point on its ledge. */
  private layoutTemple() {
    const temple = this.temple
    if (!temple) return // endless mode has no temple
    const dest = JungleTheme.assets.destination
    const scale = (GAME_HEIGHT * TEMPLE_HEIGHT) / temple.height
    temple.setScale(scale)

    // Landing point = the steps' surface, from the measured ratios. Temple origin
    // is bottom-center, so convert image ratios to world coords around it.
    const w = temple.displayWidth
    const h = temple.displayHeight
    const left = temple.x - w / 2
    const top = temple.y - h
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

  /** Generate a soft round dot texture once, used (tinted) for all juice bursts. */
  private createParticleTexture() {
    if (this.textures.exists(PARTICLE_KEY)) return
    const r = 16
    const g = this.make.graphics({ x: 0, y: 0 }, false)
    g.fillStyle(0xffffff, 1)
    g.fillCircle(r, r, r)
    g.fillStyle(0xffffff, 0.5)
    g.fillCircle(r, r, r) // double-fill center for a soft falloff feel
    g.generateTexture(PARTICLE_KEY, r * 2, r * 2)
    g.destroy()
  }

  /** One-shot particle burst at a world point (auto-destroys when done). */
  private burst(x: number, y: number, tint: number, count: number, speed: number) {
    const emitter = this.add.particles(x, y, PARTICLE_KEY, {
      tint,
      lifespan: 420,
      speed: { min: speed * 0.4, max: speed },
      angle: { min: 0, max: 360 },
      scale: { start: 0.5, end: 0 },
      alpha: { start: 0.9, end: 0 },
      gravityY: 300,
      quantity: count,
      emitting: false,
    })
    emitter.setDepth(12) // above the character (11)
    emitter.explode(count)
    // Clean up once the last particle has faded.
    this.time.delayedCall(500, () => emitter.destroy())
  }

  /** Quick squash-and-stretch pop on the character (e.g. on grab). */
  private squashPop() {
    const sx = this.character.scaleX
    const sy = this.character.scaleY
    this.tweens.add({
      targets: this.character,
      scaleX: sx * 1.12,
      scaleY: sy * 0.88,
      duration: 90,
      ease: 'Quad.easeOut',
      yoyo: true,
    })
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
  /** Fell off the bottom. Endless: the run ends → game over. Campaign: flash a
   *  brief "TRY AGAIN", then respawn at the start (score is kept). */
  private fail() {
    if (this.mode === 'endless') {
      this.showGameOver()
      return
    }
    this.respawning = true
    // Freeze the character so it doesn't keep falling behind the flash.
    this.vx = 0
    this.vy = 0
    this.rope.setVisible(false)

    // A fall breaks the combo (score is kept — it's cumulative for the run).
    this.comboCount = 0
    this.exitFireMode()
    this.updateComboHud()
    this.sfxFail()

    // Screen-pinned red dim + "TRY AGAIN" caption (above the world).
    const dim = this.add
      .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x5a0d0d, 0)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(100)
    const label = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT * 0.42, 'TRY AGAIN', {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '76px',
        color: '#ffffff',
        stroke: '#3a0a0a',
        strokeThickness: 10,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(101)
      .setAlpha(0)
      .setScale(0.7)

    // Flash in, hold briefly, then fade out → respawn and clean up.
    this.tweens.add({ targets: dim, alpha: 0.45, duration: 160, yoyo: true, hold: 360 })
    this.tweens.add({
      targets: label,
      alpha: 1,
      scale: 1,
      duration: 200,
      ease: 'Back.easeOut',
      yoyo: true,
      hold: 360,
      onComplete: () => {
        dim.destroy()
        label.destroy()
        this.respawn()
        this.respawning = false
      },
    })
  }

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
