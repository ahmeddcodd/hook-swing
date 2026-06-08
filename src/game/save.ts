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
 *     at milestones (level complete, advance, campaign restart) and on pause.
 */
import * as Sdk from '../yt/sdk.ts'

export interface Progress {
  /** Best final score ever achieved (drives the BEST line + sendScore best). */
  best: number
  /** Active level index into LEVELS. */
  level: number
  /** Running campaign score carried across levels. */
  campaignScore: number
}

/** The live, in-memory progress. Seeded by loadProgress(), mutated during play. */
export const progress: Progress = {
  best: 0,
  level: 0,
  campaignScore: 0,
}

/** Load + parse cloud save into `progress`. Tolerant of empty/old/invalid data
 *  (MUST handle previous-version saves without errors) — falls back to defaults. */
export async function loadProgress(): Promise<void> {
  const raw = await Sdk.loadData()
  if (!raw) return
  try {
    const data = JSON.parse(raw) as Partial<Progress>
    if (typeof data.best === 'number' && Number.isFinite(data.best)) {
      progress.best = Math.max(0, Math.floor(data.best))
    }
    if (typeof data.level === 'number' && Number.isFinite(data.level)) {
      progress.level = Math.max(0, Math.floor(data.level))
    }
    if (typeof data.campaignScore === 'number' && Number.isFinite(data.campaignScore)) {
      progress.campaignScore = Math.max(0, Math.floor(data.campaignScore))
    }
  } catch {
    /* malformed/old save — keep defaults */
  }
}

/** Persist the current `progress` to cloud save (best-effort). */
export function saveProgress(): void {
  void Sdk.saveData(JSON.stringify(progress))
}
