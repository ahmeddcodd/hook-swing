/**
 * "GAME PAUSED" overlay shown when YouTube fires onPause.
 *
 * Implemented as a DOM element layered over the game canvas — NOT a Phaser
 * GameObject — on purpose:
 *   - onPause MUST halt all execution, so the bridge calls game.loop.sleep(),
 *     which stops Phaser's render loop. A Phaser overlay drawn after that would
 *     never paint. A DOM node renders independently of the Phaser loop, so it
 *     stays visible the whole time the game is frozen.
 *   - It's scene-agnostic: works whether the player paused on the title, mid-
 *     swing, or on the win screen, with no per-scene code.
 *
 * There is intentionally NO in-game resume button: the YouTube Playables SDK
 * provides no way for the game to tell YouTube it has resumed, and the platform
 * requires the game to stay paused until YouTube's own onResume fires. So the
 * overlay only informs the player to resume from YouTube's control — anything
 * else would desync from YouTube's pause UI.
 *
 * The overlay is injected once (lazily) and toggled via show()/hide().
 */

let overlay: HTMLDivElement | null = null

/** Create the overlay node once and attach it over the #game container. */
function ensureOverlay(): HTMLDivElement {
  if (overlay) return overlay

  const el = document.createElement('div')
  el.id = 'pause-overlay'
  el.setAttribute('aria-hidden', 'true')
  el.innerHTML = `
    <div class="pause-card">
      <div class="pause-icon"><span></span><span></span></div>
      <div class="pause-title">GAME PAUSED</div>
      <div class="pause-sub">Resume from YouTube to continue</div>
    </div>
  `

  // Mount over the game container if present, else the body, so it sits above
  // the canvas and covers the same area.
  const host = document.getElementById('game') ?? document.body
  host.appendChild(el)

  overlay = el
  return el
}

/** Reveal the pause screen (idempotent). */
export function showPauseOverlay(): void {
  const el = ensureOverlay()
  el.classList.add('is-visible')
}

/** Hide the pause screen (idempotent). */
export function hidePauseOverlay(): void {
  if (!overlay) return
  overlay.classList.remove('is-visible')
}
