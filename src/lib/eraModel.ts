import type { DiceTeamCard, EraContext, EraContextOptions, MatchupOptions, SourceLeague } from "./types";

const averageKeys: Array<keyof SourceLeague["averages"]> = [
  "pace",
  "offensiveRating",
  "defensiveRating",
  "simpleRating",
  "marginOfVictory",
  "efgPct",
  "turnoverPct",
  "offensiveReboundPct",
  "freeThrowRate",
  "freeThrowAttemptRate",
  "opponentEfgPct",
  "opponentTurnoverPct",
  "defensiveReboundPct",
  "opponentFreeThrowAttemptRate",
  "opponentFreeThrowRate",
  "threeAttemptRate",
  "fg2Pct",
  "fg3Pct",
  "ftPct"
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundTo(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function blendAverages(
  a: SourceLeague["averages"],
  b: SourceLeague["averages"],
  weightB: number,
  customAverages?: Partial<SourceLeague["averages"]>
): SourceLeague["averages"] {
  const weight = clamp(weightB, 0, 1);
  return Object.fromEntries(
    averageKeys.map((key) => {
      const blended = a[key] * (1 - weight) + b[key] * weight;
      return [key, customAverages?.[key] ?? blended];
    })
  ) as SourceLeague["averages"];
}

export function normalizeEraContextOptions(options?: Partial<EraContextOptions>): EraContextOptions {
  const mode = options?.mode ?? "midpoint";
  return {
    mode,
    seasonEndYear: options?.seasonEndYear,
    blend: options?.blend === undefined ? undefined : clamp(options.blend, 0, 1),
    customAverages: options?.customAverages
  };
}

export function normalizeMatchupEraContextOptions(options: Partial<MatchupOptions> = {}): EraContextOptions {
  return normalizeEraContextOptions(options.eraContext);
}

function contextBlendWeight(away: DiceTeamCard, home: DiceTeamCard, options: EraContextOptions): number {
  switch (options.mode) {
    case "away-era":
      return 0;
    case "home-era":
      return 1;
    case "older-era":
      return away.source.seasonEndYear <= home.source.seasonEndYear ? 0 : 1;
    case "newer-era":
      return away.source.seasonEndYear >= home.source.seasonEndYear ? 0 : 1;
    case "fixed-season": {
      if (options.seasonEndYear === away.source.seasonEndYear) return 0;
      if (options.seasonEndYear === home.source.seasonEndYear) return 1;
      if (away.source.seasonEndYear === home.source.seasonEndYear) return 0.5;
      if (options.seasonEndYear !== undefined) {
        return clamp((options.seasonEndYear - away.source.seasonEndYear) / (home.source.seasonEndYear - away.source.seasonEndYear), 0, 1);
      }
      return options.blend ?? 0.5;
    }
    case "custom":
    case "midpoint":
      return options.blend ?? 0.5;
  }
}

function contextSeasonEndYear(away: DiceTeamCard, home: DiceTeamCard, options: EraContextOptions, blend: number): number | null {
  if (options.mode === "custom") return options.seasonEndYear ?? null;
  if (options.mode === "fixed-season" && options.seasonEndYear !== undefined) return options.seasonEndYear;
  return Math.round(away.source.seasonEndYear * (1 - blend) + home.source.seasonEndYear * blend);
}

function contextLabel(away: DiceTeamCard, home: DiceTeamCard, options: EraContextOptions, blend: number): string {
  switch (options.mode) {
    case "away-era":
      return `${away.season} environment`;
    case "home-era":
      return `${home.season} environment`;
    case "older-era":
      return `${away.source.seasonEndYear <= home.source.seasonEndYear ? away.season : home.season} environment`;
    case "newer-era":
      return `${away.source.seasonEndYear >= home.source.seasonEndYear ? away.season : home.season} environment`;
    case "fixed-season":
      return options.seasonEndYear === undefined ? `Fixed environment (${roundTo(blend, 2)} blend)` : `${options.seasonEndYear} fixed environment`;
    case "custom":
      return "Custom era environment";
    case "midpoint":
      return blend === 0.5 ? "Midpoint era environment" : `Era environment blend ${roundTo(blend, 2)}`;
  }
}

export function buildEraContext(away: DiceTeamCard, home: DiceTeamCard, options: Partial<MatchupOptions> = {}): EraContext {
  const eraOptions = normalizeMatchupEraContextOptions(options);
  const blend = contextBlendWeight(away, home, eraOptions);
  const seasonEndYear = contextSeasonEndYear(away, home, eraOptions, blend);
  const averages = blendAverages(away.calibration.leagueAverages, home.calibration.leagueAverages, blend, eraOptions.customAverages);
  const id = [
    eraOptions.mode,
    seasonEndYear ?? "custom",
    roundTo(blend, 4),
    ...averageKeys.map((key) => roundTo(averages[key], 6))
  ].join("|");

  return {
    id,
    label: contextLabel(away, home, eraOptions, blend),
    mode: eraOptions.mode,
    seasonEndYear,
    blend,
    averages,
    sourceSeasons: {
      away: away.source.seasonEndYear,
      home: home.source.seasonEndYear
    }
  };
}

export function eraContextCacheKey(context: EraContext): string {
  return context.id;
}
