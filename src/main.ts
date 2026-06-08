import './style.css'
import Phaser from 'phaser'
import { gameConfig } from './game/config.ts'
import * as Sdk from './yt/sdk.ts'
import { showPauseOverlay, hidePauseOverlay } from './yt/pauseOverlay.ts'
import { loadProgress, saveProgress } from './game/save.ts'

/**
 * Boot sequence:
 *   1. Read the player's BCP-47 language (so the call exists; the harness's
 *      "Set language" control exercises it). UI is English for now — see the
 *      `// TODO localize` seam in the scenes.
 *   2. Load cloud save (seeds GameScene's campaign state) BEFORE the game starts,
 *      satisfying "MUST await loadData before saveData".
 *   3. Create the Phaser game, then wire the YouTube system bridge to it.
 *
 * The whole sequence is no-op-safe outside YouTube: the SDK wrappers return
 * defaults, so the game boots and plays identically in local dev / Vercel.
 */
async function boot() {
  // TODO localize: language is read but the UI is English for now.
  void Sdk.getLanguage()

  // Seed campaign progress from cloud save before any scene reads it.
  await loadProgress()

  const game = new Phaser.Game(gameConfig)

  bridgeSystemEvents(game)
}

/**
 * Connect YouTube's pause / resume / audio controls to the running game.
 * Pausing must stop ALL execution (loop + render) and audio; resuming restores
 * both, honoring the current YouTube mute state.
 */
function bridgeSystemEvents(game: Phaser.Game) {
  // Apply the initial YouTube mute state once audio is up.
  applyAudio(game, Sdk.isAudioEnabled())

  let paused = false

  const pauseHandlers = {
    pause() {
      if (paused) return
      paused = true
      // Show the "GAME PAUSED" screen FIRST. It's a DOM overlay, so it paints
      // even after the Phaser loop is asleep (the canvas is frozen behind it).
      showPauseOverlay()
      // Stop the game loop entirely (no update/render) and silence all audio.
      game.loop.sleep()
      applyAudio(game, false)
      // Save-on-pause (SHOULD): give YouTube the latest progress before eviction.
      saveProgress()
    },
    resume() {
      if (!paused) return
      paused = false
      game.loop.wake()
      hidePauseOverlay()
      // Restore audio to whatever YouTube's mute setting currently is.
      applyAudio(game, Sdk.isAudioEnabled())
    },
  }

  Sdk.onPause(() => pauseHandlers.pause())
  Sdk.onResume(() => pauseHandlers.resume())

  // YouTube audio toggle: only affects sound while NOT paused (paused stays silent).
  Sdk.onAudioEnabledChange((enabled) => {
    if (paused) return
    applyAudio(game, enabled)
  })

  // Dev-only: outside the real Playables env, expose manual pause/resume on
  // window so the pause screen can be previewed locally (press a key in the
  // console, e.g. __ytPause()/__ytResume()). Never registered inside YouTube.
  if (!Sdk.inPlayables()) {
    const w = window as unknown as Record<string, unknown>
    w.__ytPause = () => pauseHandlers.pause()
    w.__ytResume = () => pauseHandlers.resume()
  }
}

/**
 * Single place that gates sound. Covers BOTH audio paths:
 *   - Phaser's mixer (the loaded jump SFX) via game.sound.mute
 *   - the raw Web Audio synth (GameScene.playTone) via the shared audio flag
 */
function applyAudio(game: Phaser.Game, enabled: boolean) {
  game.sound.mute = !enabled
  Sdk.setAudioAllowed(enabled)
}

void boot()
