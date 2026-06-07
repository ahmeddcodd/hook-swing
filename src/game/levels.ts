/**
 * Level definitions — the layout/difficulty data that drives GameScene.
 *
 * GameScene reads the active level's config instead of hardcoded constants, so
 * adding or tuning a level means editing this array only (no scene-logic changes).
 * Values are fractions of the screen (width for x/gaps, height for the hook rows),
 * matching the units GameScene already uses.
 *
 * Difficulty ramps across the 5 levels: more hooks, wider/variable gaps, and
 * steeper height swings, with bananas thinning out relative to length. All values
 * are kept within reachable physics (the tuned launch + generous GRAB_RADIUS give
 * margin) — tune here after a playtest if any level feels unbeatable or trivial.
 */
export interface LevelConfig {
  /** How many wooden circles in the chain. */
  hookCount: number
  /** Horizontal spacing between circles (fraction of screen width). */
  hookGapX: number
  /** First circle's x (fraction of screen width). */
  hookStartX: number
  /** "Up" row height (fraction of screen height). */
  hookHighY: number
  /** "Down" row height (fraction of screen height). */
  hookLowY: number
  /** How many collectible bananas to scatter. */
  bananaCount: number
  /** Gap past the last hook to the goal temple (fraction of screen width). */
  templeGapX: number
}

export const LEVELS: LevelConfig[] = [
  // Level 1 — the original tuned layout (gentle, teaches the loop).
  {
    hookCount: 12,
    hookGapX: 0.62,
    hookStartX: 0.9,
    hookHighY: 0.5,
    hookLowY: 0.58,
    bananaCount: 10,
    templeGapX: 0.55,
  },
  // Level 2 — slightly longer, a touch wider gaps.
  {
    hookCount: 13,
    hookGapX: 0.66,
    hookStartX: 0.9,
    hookHighY: 0.48,
    hookLowY: 0.6,
    bananaCount: 9,
    templeGapX: 0.55,
  },
  // Level 3 — longer still, steeper height swings.
  {
    hookCount: 14,
    hookGapX: 0.68,
    hookStartX: 0.9,
    hookHighY: 0.45,
    hookLowY: 0.62,
    bananaCount: 8,
    templeGapX: 0.6,
  },
  // Level 4 — wide gaps demand strong release timing.
  {
    hookCount: 15,
    hookGapX: 0.72,
    hookStartX: 0.9,
    hookHighY: 0.44,
    hookLowY: 0.63,
    bananaCount: 8,
    templeGapX: 0.6,
  },
  // Level 5 — longest, widest, steepest: the campaign finale.
  {
    hookCount: 16,
    hookGapX: 0.75,
    hookStartX: 0.9,
    hookHighY: 0.42,
    hookLowY: 0.64,
    bananaCount: 7,
    templeGapX: 0.62,
  },
]
