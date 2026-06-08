/**
 * YouTube Playables SDK wrapper — the single integration point.
 *
 * Every other module talks to YouTube through this file and NEVER touches the
 * global `ytgame` directly. All calls are no-op-safe and try/catch-guarded, so:
 *   - The game runs identically OUTSIDE YouTube (local dev / Vercel), where
 *     `window.ytgame` is undefined — wrappers just return defaults.
 *   - A throwing/ rejecting SDK (the harness's "Reply with Error/rejected"
 *     toggles) can never crash the game.
 *
 * The SDK script (https://www.youtube.com/game_api/v1) is loaded first in
 * index.html, so `window.ytgame` is already populated when this module runs.
 *
 * API surface (verified against developers.google.com/youtube/gaming/playables):
 *   ytgame.IN_PLAYABLES_ENV, ytgame.SDK_VERSION
 *   ytgame.game.firstFrameReady() / gameReady()
 *   ytgame.game.loadData(): Promise<string> / saveData(data: string): Promise<void>
 *   ytgame.engagement.sendScore({ value: number }): Promise<void>
 *   ytgame.system.onPause/onResume/onAudioEnabledChange/isAudioEnabled/getLanguage
 */

interface YTGame {
  IN_PLAYABLES_ENV?: boolean
  SDK_VERSION?: string
  game: {
    firstFrameReady: () => void
    gameReady: () => void
    loadData: () => Promise<string>
    saveData: (data: string) => Promise<void>
  }
  engagement: {
    sendScore: (score: { value: number }) => Promise<void>
  }
  system: {
    onPause: (cb: () => void) => void
    onResume: (cb: () => void) => void
    onAudioEnabledChange: (cb: (enabled: boolean) => void) => void
    isAudioEnabled: () => boolean
    getLanguage: () => Promise<string>
  }
}

declare global {
  interface Window {
    ytgame?: YTGame
  }
}

/** The SDK instance, or undefined when running outside YouTube. */
const yt = (): YTGame | undefined => window.ytgame

/** True only inside the YouTube Playables environment. */
export const inPlayables = (): boolean => !!yt()?.IN_PLAYABLES_ENV

// --- Lifecycle (each fires at most once) -----------------------------------

let firstFrameSent = false
let gameReadySent = false

/** Notify YouTube the game has rendered its first frame. Must precede gameReady. */
export function firstFrameReady(): void {
  if (firstFrameSent) return
  firstFrameSent = true
  try {
    yt()?.game.firstFrameReady()
  } catch {
    /* SDK absent or threw — ignore */
  }
}

/** Notify YouTube the game is interactive (removes YouTube's loading spinner). */
export function gameReady(): void {
  if (gameReadySent) return
  // Guard the ordering contract: firstFrameReady MUST come first.
  if (!firstFrameSent) firstFrameReady()
  gameReadySent = true
  try {
    yt()?.game.gameReady()
  } catch {
    /* SDK absent or threw — ignore */
  }
}

// --- Cloud save -------------------------------------------------------------

/** Load the saved blob, or null when absent/empty/errored (callers default). */
export async function loadData(): Promise<string | null> {
  try {
    const data = await yt()?.game.loadData()
    return data ?? null
  } catch {
    return null
  }
}

/** Persist the save blob (≤ 3 MiB). Best-effort — rejections are swallowed. */
export async function saveData(data: string): Promise<void> {
  try {
    await yt()?.game.saveData(data)
  } catch {
    /* storage unavailable / rejected — ignore */
  }
}

// --- Engagement -------------------------------------------------------------

/** Send the player's score (integer). Best-effort; rejections are swallowed. */
export function sendScore(value: number): void {
  try {
    void yt()?.engagement.sendScore({ value: Math.floor(value) })
  } catch {
    /* SDK absent or threw — ignore */
  }
}

// --- System events ----------------------------------------------------------

export function onPause(cb: () => void): void {
  try {
    yt()?.system.onPause(cb)
  } catch {
    /* ignore */
  }
}

export function onResume(cb: () => void): void {
  try {
    yt()?.system.onResume(cb)
  } catch {
    /* ignore */
  }
}

export function onAudioEnabledChange(cb: (enabled: boolean) => void): void {
  try {
    yt()?.system.onAudioEnabledChange(cb)
  } catch {
    /* ignore */
  }
}

/** Current YouTube audio state. Defaults to enabled when the SDK is absent. */
export function isAudioEnabled(): boolean {
  try {
    const v = yt()?.system.isAudioEnabled()
    return v ?? true
  } catch {
    return true
  }
}

/**
 * Live "is the game allowed to make sound" flag, shared across the app.
 *
 * It folds together BOTH gates: the YouTube audio setting (onAudioEnabledChange
 * / isAudioEnabled) AND the pause state (no audio while paused). main.ts owns
 * updating it; GameScene's raw Web Audio synth (`playTone`) reads it to stay
 * silent when it should — that path bypasses Phaser's mixer, so `setMute` alone
 * wouldn't catch it.
 */
let audioAllowed = true
export function setAudioAllowed(v: boolean): void {
  audioAllowed = v
}
export function getAudioAllowed(): boolean {
  return audioAllowed
}

/** Player's BCP-47 language tag (e.g. "en-US"), or "en" when unavailable. */
export async function getLanguage(): Promise<string> {
  try {
    const lang = await yt()?.system.getLanguage()
    return lang ?? 'en'
  } catch {
    return 'en'
  }
}
