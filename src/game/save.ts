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
 *  Migrates the legacy single `best` field (pre mode-split saves) into BOTH
 *  per-mode bests so old records carry over. */
export async function loadProgress(): Promise<void> {
  const raw = await Sdk.loadData()
  if (!raw) return
  try {
    const data = JSON.parse(raw) as Partial<Progress> & { best?: number }
    const legacyBest = readNum(data.best)
    progress.bestCampaign = Math.max(readNum(data.bestCampaign), legacyBest)
    progress.bestEndless = Math.max(readNum(data.bestEndless), legacyBest)
    progress.level = readNum(data.level)
    progress.campaignScore = readNum(data.campaignScore)
  } catch {
    /* malformed/old save — keep defaults */
  }
}

/** Persist the current `progress` to cloud save (best-effort). */
export function saveProgress(): void {
  void Sdk.saveData(JSON.stringify(progress))
}
