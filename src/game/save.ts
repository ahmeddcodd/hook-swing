/**
 * Campaign progress — the entire save-state, persisted via YouTube cloud save.
 *
 * Replaces the old localStorage best-score + static scene fields. The shape is a
 * tiny JSON object (~tens of bytes, far under the 3 MiB cloud-save limit). The
 * SDK MUST be the only save mechanism, so nothing here touches localStorage.
 *
 * Flow:
 *   - main.ts calls loadProgress() ONCE at boot (awaited before the game starts),
 *     so GameScene reads seeded values synchronously.
 *   - GameScene mutates `progress` as the run advances and calls saveProgress()
 *     at milestones (level complete, advance, campaign restart, game over) and
 *     on pause.
 */
import * as Sdk from '../yt/sdk.ts'

/** Save-format version stamp. v2 = trustworthy per-mode bests. Saves WITHOUT
 *  this stamp (the original single-`best` format, and the transitional split
 *  format that wrongly copied the shared best into bestCampaign) get a one-time
 *  repair on load: all best values fold into the endless record and the
 *  campaign best rebuilds from real campaign wins. */
const SAVE_VERSION = 2

export interface Progress {
  /** Best campaign total ever (drives the campaign win screen's BEST line). */
  bestCampaign: number
  /** Best endless run ever (drives the endless HUD + game-over record). */
  bestEndless: number
  /** Active level index into LEVELS. */
  level: number
  /** Running campaign score carried across levels. */
  campaignScore: number
}

/** The live, in-memory progress. Seeded by loadProgress(), mutated during play. */
export const progress: Progress = {
  bestCampaign: 0,
  bestEndless: 0,
  level: 0,
  campaignScore: 0,
}

/** Sanitize a saved number: finite → floored & non-negative, else the fallback. */
function readNum(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : fallback
}

/** Load + parse cloud save into `progress`. Tolerant of empty/old/invalid data
 *  (MUST handle previous-version saves without errors) — falls back to defaults.
 *  Unstamped saves (version < 2) get the one-time best-score repair described
 *  at SAVE_VERSION; stamped saves are read as-is. */
export async function loadProgress(): Promise<void> {
  const raw = await Sdk.loadData()
  if (!raw) return
  try {
    const data = JSON.parse(raw) as Partial<Progress> & { best?: number; version?: number }
    if (readNum(data.version) >= SAVE_VERSION) {
      // Trustworthy per-mode bests — read directly.
      progress.bestCampaign = readNum(data.bestCampaign)
      progress.bestEndless = readNum(data.bestEndless)
    } else {
      // Pre-stamp save: the campaign field either didn't exist or holds a copy
      // of the old shared best (endless-earned). Fold everything into endless
      // and let the campaign best rebuild from genuine campaign wins.
      progress.bestEndless = Math.max(
        readNum(data.bestEndless),
        readNum(data.bestCampaign),
        readNum(data.best)
      )
      progress.bestCampaign = 0
    }
    progress.level = readNum(data.level)
    progress.campaignScore = readNum(data.campaignScore)
  } catch {
    /* malformed/old save — keep defaults */
  }
}

/** Persist the current `progress` to cloud save (best-effort), stamped with the
 *  current format version so future loads skip the legacy repair. */
export function saveProgress(): void {
  void Sdk.saveData(JSON.stringify({ version: SAVE_VERSION, ...progress }))
}
