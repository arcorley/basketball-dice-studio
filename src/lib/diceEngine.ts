import type {
  AssignmentEvent,
  DicePlayerCard,
  DiceTeamCard,
  EraContext,
  ExpectedMatchupLine,
  ExpectedPlayerLine,
  ExpectedTeamLine,
  GameModelMetadata,
  GameResult,
  GameplayOptions,
  MatchupContext,
  MatchupCard,
  MatchupOptions,
  PlayerRangeRow,
  PossessionTrace,
  RangeRow,
  RollTraceStep,
  SimulationOptions,
  ShotLocationProfileMethod,
  ShotZone,
  SourcePlayer,
  SourceShotLocationProfile,
  SourcePlayerPostseasonProfile,
  StatLine,
  TeamGamePlanOptions,
  TeamMatchupStatic,
  TracedGameResult
} from "./types";
import { SeededRandom } from "./random";
import { calibration as cardCalibration } from "./teamCards";
import { buildEraContext, eraContextCacheKey, normalizeEraContextOptions } from "./eraModel";

export const crossEraModelVersion = "cross-era-midpoint-v1";

export const simParams = {
  globalShotMod: -1,
  globalFdMod: 1,
  globalTovMod: 0,
  tovScale: 1,
  fdScale: 1,
  threeMod: 0,
  orbBase: 27,
  astMod: 0,
  blockBase: 7,
  stealTurnoverPct: 60,
  nonshootFoulChance: 7,
  foulOutLimit: 6,
  defenseShotDivisor: 2,
  maxOrbExtensions: 2,
  crossEraStyleBlendYears: 30,
  crossEraStyleRetentionBoost: 0.2,
  homeCourtAdvantagePoints: 2.6,
  homeCourtShotAdjustment: 0.75,
  playoffPaceMultiplier: 0.96,
  playoffUseExponent: 0.16,
  playoffUseMinMultiplier: 0.62,
  playoffUseMaxMultiplier: 1.22,
  playoffTopEndShotScale: 0.5,
  playoffTopEndShotCap: 1.1,
  eraTalentShotMakeScale: 0,
  eraTalentTurnoverScale: 0,
  eraTalentReboundScale: 0,
  overtimeMinutes: 5,
  maxOvertimePeriods: 20
};

export const defaultMatchupOptions: MatchupOptions = {
  venue: "home-court",
  intensity: "regular"
};

const defaultTeamGamePlan: Required<TeamGamePlanOptions> = {
  usageConcentration: 1,
  playerUsageTargets: {},
  threePointEmphasis: 0,
  foulPressure: 0,
  crashBoards: 0,
  ballSecurity: 0
};

const defaultGameplayOptions: Required<Pick<GameplayOptions, "tempoMultiplier">> = {
  tempoMultiplier: 1
};

const statFields = ["PTS", "FGM", "FGA", "3PM", "3PA", "FTM", "FTA", "OREB", "DREB", "REB", "AST", "STL", "BLK", "TOV", "PF"];
const teamExtraStatFields = ["poss", "nonshooting_fouls_drawn", "continuation_fouls_drawn"];
const shotZones: ShotZone[] = ["rim", "shortMid", "longMid", "three"];
const shotZoneOrbMultipliers: Record<ShotZone, number> = {
  rim: 1.12,
  shortMid: 1.04,
  longMid: 0.94,
  three: 0.84
};
type ShotZoneProfileSource = "location" | "two-three";
type MatchupPlayerProfile = Pick<
  DicePlayerCard,
  "tov" | "fd" | "threeFrequency" | "p2" | "p3" | "ft" | "andOneChance" | "turnoverProfile" | "liveBallTurnoverChance" | "offensiveFoulTurnoverChance"
> & {
  shotProfile: ShotZoneProfileSource;
  shotProfileMethod: ShotLocationProfileMethod;
  shotProfileConfidence: number;
  twoZoneShares: Record<ShotZone, number>;
  shotMakes: Record<ShotZone, number>;
};
type MatchupActionProfile = {
  turnoverTargetChance: number;
  foulDrawTargetChance: number;
  threeAttemptTargetChance: number;
  turnoverScale: number;
  foulDrawScale: number;
  threeAttemptScale: number;
};
type GameAvailabilityState = {
  unavailablePlayerIds: Set<string>;
  events: NonNullable<GameResult["playerAvailabilityEvents"]>;
};

const matchupProfileCache = new Map<string, MatchupPlayerProfile>();
const matchupActionProfileCache = new Map<string, MatchupActionProfile>();

export function clearMatchupCaches(): void {
  matchupProfileCache.clear();
  matchupActionProfileCache.clear();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundedRoll(value: number): number {
  return Number(value.toFixed(1));
}

function percentRoll(rng: SeededRandom, chance: number): { roll: number; target: number; success: boolean } {
  const roll = rng.next() * 100;
  return {
    roll,
    target: chance,
    success: roll < chance
  };
}

function addTraceStep(trace: PossessionTrace | undefined, step: RollTraceStep): void {
  if (!trace) return;
  trace.steps.push({
    ...step,
    roll: step.roll === undefined ? undefined : roundedRoll(step.roll),
    target: step.target === undefined ? undefined : roundedRoll(step.target)
  });
}

function successLabel(success: boolean, yes = "Yes", no = "No"): string {
  return success ? yes : no;
}

function shotZoneLabel(zone: ShotZone): string {
  switch (zone) {
    case "rim":
      return "Rim";
    case "shortMid":
      return "Short 2";
    case "longMid":
      return "Long 2";
    case "three":
      return "3P";
  }
}

function safeRange(start: number, end: number): string {
  if (end < start || end <= 0) return "-";
  const safeStart = Math.max(1, start);
  const safeEnd = Math.min(100, end);
  if (safeEnd < safeStart) return "-";
  return `${String(safeStart).padStart(2, "0")}-${safeEnd === 100 ? "100" : String(safeEnd).padStart(2, "0")}`;
}

export function nRange(value: number): string {
  const rounded = Math.round(value);
  if (rounded <= 0) return "-";
  return safeRange(1, Math.min(100, rounded));
}

export function quarterSplit(possessionsEach: number): [number, number, number, number] {
  const quarters = [0, 0, 0, 0] as [number, number, number, number];
  quarters.fill(Math.floor(possessionsEach / 4));
  for (let index = 0; index < possessionsEach % 4; index += 1) {
    quarters[index] += 1;
  }
  return quarters;
}

export function overtimePossessionsEach(possessionsEach: number): number {
  return Math.max(3, Math.round((possessionsEach * simParams.overtimeMinutes) / 48));
}

function defenseShotAdjustment(defense: number): number {
  return defense / simParams.defenseShotDivisor;
}

function eraTalentAdjustment(offense: DiceTeamCard, defense: DiceTeamCard): TeamMatchupStatic["eraTalentAdjustment"] {
  const talentDelta =
    offense.source.seasonEndYear === defense.source.seasonEndYear
      ? 0
      : offense.calibration.leagueStrength.talentPointsPer100 - defense.calibration.leagueStrength.talentPointsPer100;
  return {
    talentDelta: Number(talentDelta.toFixed(3)),
    shotMakeAdjustment: clamp(talentDelta * simParams.eraTalentShotMakeScale, -1.25, 1.25),
    turnoverAdjustment: clamp(-talentDelta * simParams.eraTalentTurnoverScale, -0.35, 0.35),
    reboundAdjustment: clamp(talentDelta * simParams.eraTalentReboundScale, -0.35, 0.35)
  };
}

export function normalizeMatchupOptions(options: Partial<MatchupOptions> = {}): MatchupOptions {
  const venue = options.venue ?? defaultMatchupOptions.venue;
  const intensity = options.intensity ?? defaultMatchupOptions.intensity;
  return {
    venue: venue === "neutral" ? "neutral" : "home-court",
    intensity: intensity === "playoff" ? "playoff" : "regular",
    eraContext: normalizeEraContextOptions(options.eraContext),
    gameplay: normalizeGameplayOptions(options.gameplay)
  };
}

function normalizeTeamGamePlan(plan: Partial<TeamGamePlanOptions> | undefined): Required<TeamGamePlanOptions> {
  const playerUsageTargets = Object.fromEntries(
    Object.entries(plan?.playerUsageTargets ?? {})
      .filter(([playerId, target]) => playerId && Number.isFinite(target))
      .map(([playerId, target]) => [playerId, clamp(target, 0, 0.6)])
  );
  return {
    usageConcentration: clamp(plan?.usageConcentration ?? defaultTeamGamePlan.usageConcentration, 0.7, 1.4),
    playerUsageTargets,
    threePointEmphasis: clamp(plan?.threePointEmphasis ?? defaultTeamGamePlan.threePointEmphasis, -10, 10),
    foulPressure: clamp(plan?.foulPressure ?? defaultTeamGamePlan.foulPressure, -6, 6),
    crashBoards: clamp(plan?.crashBoards ?? defaultTeamGamePlan.crashBoards, -6, 6),
    ballSecurity: clamp(plan?.ballSecurity ?? defaultTeamGamePlan.ballSecurity, -6, 6)
  };
}

function normalizeGameplayOptions(gameplay: Partial<GameplayOptions> | undefined): GameplayOptions {
  const teamPlans = Object.fromEntries(
    Object.entries(gameplay?.teamPlans ?? {}).map(([teamId, plan]) => [teamId, normalizeTeamGamePlan(plan)])
  );
  return {
    tempoMultiplier: clamp(gameplay?.tempoMultiplier ?? defaultGameplayOptions.tempoMultiplier, 0.85, 1.15),
    away: gameplay?.away ? normalizeTeamGamePlan(gameplay.away) : undefined,
    home: gameplay?.home ? normalizeTeamGamePlan(gameplay.home) : undefined,
    teamPlans: Object.keys(teamPlans).length ? teamPlans : undefined
  };
}

function resolveMatchupOptionsForTeams(
  away: DiceTeamCard,
  home: DiceTeamCard,
  options: Partial<MatchupOptions> = defaultMatchupOptions
): MatchupOptions {
  const normalized = normalizeMatchupOptions(options);
  const gameplay = normalizeGameplayOptions(normalized.gameplay);
  const awayPlan = normalizeTeamGamePlan(gameplay.teamPlans?.[away.id] ?? gameplay.away);
  const homePlan = normalizeTeamGamePlan(gameplay.teamPlans?.[home.id] ?? gameplay.home);
  return {
    ...normalized,
    gameplay: {
      ...gameplay,
      away: awayPlan,
      home: homePlan,
      teamPlans: {
        ...(gameplay.teamPlans ?? {}),
        [away.id]: awayPlan,
        [home.id]: homePlan
      }
    }
  };
}

function teamGamePlan(options: MatchupOptions, team: DiceTeamCard): Required<TeamGamePlanOptions> {
  return normalizeTeamGamePlan(options.gameplay?.teamPlans?.[team.id]);
}

function teamGamePlanCacheKey(plan: Partial<TeamGamePlanOptions> | undefined): string {
  const normalized = normalizeTeamGamePlan(plan);
  const playerUsageTargets = Object.entries(normalized.playerUsageTargets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([playerId, target]) => `${playerId}:${target}`)
    .join(";");
  return [
    normalized.usageConcentration,
    playerUsageTargets,
    normalized.threePointEmphasis,
    normalized.foulPressure,
    normalized.crashBoards,
    normalized.ballSecurity
  ].join(",");
}

function gameplayCacheKey(options: MatchupOptions): string {
  const gameplay = normalizeGameplayOptions(options.gameplay);
  const teams = Object.entries(gameplay.teamPlans ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([teamId, plan]) => `${teamId}:${teamGamePlanCacheKey(plan)}`)
    .join(";");
  return `${gameplay.tempoMultiplier ?? 1}|${teamGamePlanCacheKey(gameplay.away)}|${teamGamePlanCacheKey(gameplay.home)}|${teams}`;
}

function hasGameplayAdjustments(options: MatchupOptions): boolean {
  const gameplay = normalizeGameplayOptions(options.gameplay);
  if (gameplay.tempoMultiplier !== defaultGameplayOptions.tempoMultiplier) return true;
  return [gameplay.away, gameplay.home, ...Object.values(gameplay.teamPlans ?? {})].some((plan) => teamGamePlanCacheKey(plan) !== teamGamePlanCacheKey(defaultTeamGamePlan));
}

function contextLabel(options: MatchupOptions, eraContext: EraContext): string {
  const venue = options.venue === "neutral" ? "Neutral court" : "Home court";
  const intensity = options.intensity === "playoff" ? "playoff intensity" : "regular season";
  const gameplay = hasGameplayAdjustments(options) ? ", custom game plan" : "";
  return `${venue}, ${intensity}, ${eraContext.label}${gameplay}`;
}

function matchupContextRules(options: MatchupOptions, eraContext: EraContext): MatchupContext {
  const homeCourt = options.venue === "home-court";
  const playoff = options.intensity === "playoff";
  return {
    label: contextLabel(options, eraContext),
    venue: options.venue,
    intensity: options.intensity,
    eraContext: options.eraContext ?? { mode: "midpoint" },
    homeCourtAdvantagePoints: homeCourt ? simParams.homeCourtAdvantagePoints : 0,
    awayShotContextAdjustment: homeCourt ? -simParams.homeCourtShotAdjustment : 0,
    homeShotContextAdjustment: homeCourt ? simParams.homeCourtShotAdjustment : 0,
    paceMultiplier: playoff ? simParams.playoffPaceMultiplier : 1,
    useWeightMode: playoff ? "playoff-tightened" : "regular"
  };
}

function contextCacheKey(options: MatchupOptions): string {
  return `${options.venue}|${options.intensity}|${gameplayCacheKey(options)}`;
}

function playerProfileCacheKey(): string {
  return [
    cardCalibration.threeEraAdaptation,
    cardCalibration.foulEraAdaptation,
    cardCalibration.playerRelativeShootingDampening,
    cardCalibration.playerThreeRelativeDampening,
    cardCalibration.regressionAttempts.twoPoint,
    cardCalibration.regressionAttempts.threePoint,
    cardCalibration.regressionAttempts.freeThrow
  ].join("|");
}

function actionProfileCacheKey(): string {
  return [
    playerProfileCacheKey(),
    simParams.globalFdMod,
    simParams.globalTovMod,
    simParams.threeMod,
    simParams.tovScale,
    simParams.fdScale,
    simParams.eraTalentTurnoverScale,
    simParams.crossEraStyleBlendYears,
    simParams.crossEraStyleRetentionBoost
  ].join("|");
}

function requiredNumber(value: number | null | undefined, label: string): number {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    throw new Error(`Missing required Basketball Reference value: ${label}`);
  }
  return value;
}

function sourceGames(team: DiceTeamCard): number {
  const wins = requiredNumber(team.source.team.wins, `${team.id} wins`);
  const losses = requiredNumber(team.source.team.losses, `${team.id} losses`);
  const games = wins + losses;
  if (games <= 0) {
    throw new Error(`${team.id} has invalid sourced team games.`);
  }
  return games;
}

function teamTotalPerGame(team: DiceTeamCard, field: string): number {
  return requiredNumber(team.source.team.totals[field], `${team.id} team ${field}`) / sourceGames(team);
}

function opponentTotalPerGame(team: DiceTeamCard, field: string): number {
  return requiredNumber(team.source.team.opponentTotals[field], `${team.id} opponent ${field}`) / sourceGames(team);
}

function separatelyModeledAndOneFtaPerGame(team: DiceTeamCard): number {
  const sourcedAndOnes = team.source.players
    .map((player) => player.playByPlay.andOnes)
    .filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
  if (!sourcedAndOnes.length) return 0;
  return sourcedAndOnes.reduce((sum, value) => sum + Math.max(0, value), 0) / sourceGames(team);
}

function foulEndsPossessionChance(team: DiceTeamCard): number {
  const branchFta = Math.max(0, teamTotalPerGame(team, "fta") - separatelyModeledAndOneFtaPerGame(team));
  if (branchFta === 0) return 100;

  const weightedFtaPossessions =
    requiredNumber(team.source.team.pace, `${team.id} pace`) -
    teamTotalPerGame(team, "fga") +
    teamTotalPerGame(team, "orb") -
    teamTotalPerGame(team, "tov");
  if (weightedFtaPossessions < 0) {
    throw new Error(`${team.id} source totals imply negative free-throw possession weight.`);
  }

  return clamp((weightedFtaPossessions / branchFta) * 200, 0, 100);
}

function actionRates(fga: number, fta: number, tov: number, modeledAndOneFta = 0): { turnover: number; foulDraw: number } {
  const foulActions = Math.max(0, fta - modeledAndOneFta) / 2;
  const actions = fga + foulActions + tov;
  if (actions <= 0) {
    throw new Error("Sourced action rates require positive FGA, FTA, or TOV.");
  }
  return {
    turnover: (tov / actions) * 100,
    foulDraw: (foulActions / actions) * 100
  };
}

function offenseSourceActionRates(team: DiceTeamCard): { turnover: number; foulDraw: number } {
  return actionRates(
    teamTotalPerGame(team, "fga"),
    teamTotalPerGame(team, "fta"),
    teamTotalPerGame(team, "tov"),
    separatelyModeledAndOneFtaPerGame(team)
  );
}

function opponentAllowedActionRates(team: DiceTeamCard): { turnover: number; foulDraw: number } {
  return actionRates(opponentTotalPerGame(team, "fga"), opponentTotalPerGame(team, "fta"), opponentTotalPerGame(team, "tov"));
}

function teamThreeAttemptRate(team: DiceTeamCard): number {
  const fga = teamTotalPerGame(team, "fga");
  if (fga === 0) return 0;
  return teamTotalPerGame(team, "fg3a") / fga;
}

function opponentAllowedThreeAttemptRate(team: DiceTeamCard): number {
  const fga = opponentTotalPerGame(team, "fga");
  if (fga === 0) return 0;
  return opponentTotalPerGame(team, "fg3a") / fga;
}

function matchupContext(eraContext: EraContext): DiceTeamCard["calibration"]["leagueAverages"] {
  return eraContext.averages;
}

function offenseStyleWeight(offense: DiceTeamCard, defense: DiceTeamCard): number {
  const eraGap = Math.abs(offense.source.seasonEndYear - defense.source.seasonEndYear);
  const boost =
    clamp(eraGap / simParams.crossEraStyleBlendYears, 0, 1) * simParams.crossEraStyleRetentionBoost;
  return clamp(0.5 + boost, 0.5, 0.75);
}

function blendOffenseDefenseRate(offense: DiceTeamCard, defense: DiceTeamCard, offenseRate: number, defenseAllowedRate: number): number {
  const offenseWeight = offenseStyleWeight(offense, defense);
  return offenseRate * offenseWeight + defenseAllowedRate * (1 - offenseWeight);
}

function translatedRate(
  observedPct: number,
  attempts: number,
  sourceLeaguePct: number,
  contextPct: number,
  regressionAttempts: number,
  dampening: number
): number {
  const reliability = attempts / (attempts + regressionAttempts);
  return clamp(contextPct + (observedPct - sourceLeaguePct) * reliability * dampening, 0.01, 0.99);
}

function emptyShotZoneRecord(): Record<ShotZone, number> {
  return { rim: 0, shortMid: 0, longMid: 0, three: 0 };
}

function normalizeShotZoneChances(input: Record<ShotZone, number>, total = 100): Record<ShotZone, number> {
  const sum = shotZones.reduce((out, zone) => out + Math.max(0, input[zone]), 0);
  if (sum <= 0) {
    throw new Error("Shot zone chances require at least one positive sourced zone.");
  }
  return Object.fromEntries(shotZones.map((zone) => [zone, (Math.max(0, input[zone]) / sum) * total])) as Record<ShotZone, number>;
}

function weightedRate(items: Array<[number | null | undefined, number]>): number | null {
  const valid = items.filter(([rate, weight]) => rate !== null && rate !== undefined && Number.isFinite(rate) && weight > 0) as Array<[number, number]>;
  const totalWeight = valid.reduce((sum, [, weight]) => sum + weight, 0);
  if (totalWeight <= 0) return null;
  return valid.reduce((sum, [rate, weight]) => sum + rate * weight, 0) / totalWeight;
}

type PlayerStatProfile = SourcePlayer | SourcePlayerPostseasonProfile;

function playerStatProfile(player: DicePlayerCard, options: MatchupOptions): PlayerStatProfile {
  return options.intensity === "playoff" && player.playoffWeightSource === "postseason" && player.source.postseason ? player.source.postseason : player.source;
}

function sourcedRate(made: number | null | undefined, attempts: number, label: string): number | null {
  if (attempts === 0) return null;
  return requiredNumber(made, label) / attempts;
}

function sourcedAndOnes(profile: PlayerStatProfile): number | null {
  const andOnes = profile.playByPlay.andOnes;
  if (andOnes === null || andOnes === undefined || !Number.isFinite(andOnes)) return null;
  return Math.max(0, andOnes);
}

function shootingFoulBranchFta(profile: PlayerStatProfile, playerName: string): number {
  const fga = requiredNumber(profile.totals.fga, `${playerName} FGA`);
  if (fga <= 0) return 0;
  const fta = requiredNumber(profile.totals.fta, `${playerName} FTA`);
  const drawnShooting = profile.playByPlay.drawnShooting;
  const andOnes = sourcedAndOnes(profile);
  if (drawnShooting === null || drawnShooting === undefined || !Number.isFinite(drawnShooting) || andOnes === null) {
    return fta;
  }
  const shootingFoulTripsPerFga = Math.max(0, drawnShooting - andOnes) / fga;
  const shootingFoulFtaEquivalent = shootingFoulTripsPerFga * 2;
  return fga * (fta / fga * 0.72 + shootingFoulFtaEquivalent * 0.28);
}

function rawFreeThrowAttemptRate(profile: PlayerStatProfile, playerName: string): number {
  const fga = requiredNumber(profile.totals.fga, `${playerName} FGA`);
  return fga > 0 ? shootingFoulBranchFta(profile, playerName) / fga : 0;
}

function profileAndOneChance(profile: PlayerStatProfile, fallback: number, playerName: string): number {
  const andOnes = sourcedAndOnes(profile);
  if (andOnes === null) return fallback;
  const madeFieldGoals = requiredNumber(profile.totals.fg, `${playerName} FG`);
  if (madeFieldGoals <= 0) return 0;
  return clamp((andOnes / madeFieldGoals) * 100, 0, 35);
}

function profileTurnoverChance(profile: PlayerStatProfile, playerName: string): number {
  const tovPer100 = requiredNumber(profile.per100.tov, `${playerName} turnovers per 100`);
  const tovPct = requiredNumber(profile.advanced.tovPct, `${playerName} turnover percentage`);
  return clamp(tovPer100 * 0.9 + tovPct * 0.8, 1, 24);
}

function profileTurnoverSplit(
  profile: PlayerStatProfile,
  fallback: Pick<DicePlayerCard, "turnoverProfile" | "liveBallTurnoverChance" | "offensiveFoulTurnoverChance">,
  playerName: string
): Pick<MatchupPlayerProfile, "turnoverProfile" | "liveBallTurnoverChance" | "offensiveFoulTurnoverChance"> {
  const turnovers = requiredNumber(profile.totals.tov, `${playerName} turnovers`);
  if (turnovers <= 0) {
    return { turnoverProfile: "aggregate", liveBallTurnoverChance: 0, offensiveFoulTurnoverChance: 0 };
  }
  const badPass = profile.playByPlay.badPassTurnovers;
  const lostBall = profile.playByPlay.lostBallTurnovers;
  const offensiveFouls = profile.playByPlay.offensiveFouls;
  if (
    badPass === null ||
    badPass === undefined ||
    !Number.isFinite(badPass) ||
    lostBall === null ||
    lostBall === undefined ||
    !Number.isFinite(lostBall) ||
    offensiveFouls === null ||
    offensiveFouls === undefined ||
    !Number.isFinite(offensiveFouls)
  ) {
    return fallback;
  }

  const liveBall = Math.max(0, badPass) + Math.max(0, lostBall);
  const offensive = Math.max(0, offensiveFouls);
  const scale = liveBall + offensive > turnovers ? turnovers / (liveBall + offensive) : 1;
  return {
    turnoverProfile: "play-by-play",
    liveBallTurnoverChance: clamp(((liveBall * scale) / turnovers) * 100, 0, 100),
    offensiveFoulTurnoverChance: clamp(((offensive * scale) / turnovers) * 100, 0, 100)
  };
}

function hasCompleteLocationProfile(profile: SourceShotLocationProfile | null | undefined): profile is SourceShotLocationProfile {
  if (!profile) return false;
  const isFiniteSource = (value: number | null | undefined) => value !== null && value !== undefined && Number.isFinite(value);
  if (![profile.pctFga00_03, profile.pctFga03_10, profile.pctFga10_16, profile.pctFga16_xx, profile.pctFga3p].every(isFiniteSource)) {
    return false;
  }
  return [
    [profile.pctFga00_03, profile.fgPct00_03],
    [profile.pctFga03_10, profile.fgPct03_10],
    [profile.pctFga10_16, profile.fgPct10_16],
    [profile.pctFga16_xx, profile.fgPct16_xx]
  ].every(([share, make]) => Number(share) <= 0 || isFiniteSource(make));
}

function hasPositiveTwoPointZone(profile: SourceShotLocationProfile | null | undefined): profile is SourceShotLocationProfile {
  if (!profile) return false;
  return [profile.pctFga00_03, profile.pctFga03_10, profile.pctFga10_16, profile.pctFga16_xx].some(
    (value) => value !== null && value !== undefined && Number.isFinite(value) && value > 0
  );
}

function hasUsableLocationProfile(profile: SourceShotLocationProfile | null | undefined): profile is SourceShotLocationProfile {
  return hasCompleteLocationProfile(profile) && hasPositiveTwoPointZone(profile);
}

function postseasonShotLocationProfile(player: DicePlayerCard, profile: PlayerStatProfile): SourceShotLocationProfile | null {
  if (profile === player.source) return null;
  const shooting = profile.shooting;
  const postseasonProfile: SourceShotLocationProfile = {
    method: "sourced-location",
    modelVersion: "basketball-reference-postseason-shooting",
    confidence: 1,
    sourceRefs: [`${player.name} postseason shooting table`],
    sourcePlayerSeasons: [],
    neighborCount: 0,
    sourceFga: requiredNumber(profile.totals.fga, `${player.name} postseason shot-location FGA`),
    qualityWarnings: [],
    pctFga00_03: shooting.pctFga00_03,
    pctFga03_10: shooting.pctFga03_10,
    pctFga10_16: shooting.pctFga10_16,
    pctFga16_xx: shooting.pctFga16_xx,
    pctFga3p: shooting.pctFga3p,
    fgPct00_03: shooting.fgPct00_03,
    fgPct03_10: shooting.fgPct03_10,
    fgPct10_16: shooting.fgPct10_16,
    fgPct16_xx: shooting.fgPct16_xx,
    fgPct3p: shooting.fgPct3p
  };
  return hasUsableLocationProfile(postseasonProfile) ? postseasonProfile : null;
}

function matchupShotZoneProfile(
  player: DicePlayerCard,
  p2: number,
  p3: number,
  profileSource: PlayerStatProfile
): Pick<MatchupPlayerProfile, "shotProfile" | "shotProfileMethod" | "shotProfileConfidence" | "twoZoneShares" | "shotMakes"> {
  const shooting = postseasonShotLocationProfile(player, profileSource) ?? player.source.shotLocationProfile;
  if (!hasUsableLocationProfile(shooting)) {
    throw new Error(`${player.name} is missing a sourced or derived shot-location profile.`);
  }

  const rimShare = requiredNumber(shooting.pctFga00_03, `${player.name} %FGA 0-3`);
  const floaterShare = requiredNumber(shooting.pctFga03_10, `${player.name} %FGA 3-10`);
  const shortJumperShare = requiredNumber(shooting.pctFga10_16, `${player.name} %FGA 10-16`);
  const shortShare = floaterShare + shortJumperShare;
  const longShare = requiredNumber(shooting.pctFga16_xx, `${player.name} %FGA 16-3P`);
  const twoZoneShares = normalizeShotZoneChances({ rim: rimShare, shortMid: shortShare, longMid: longShare, three: 0 }, 100);
  const rawTwoPct = Math.max(0.01, player.calibration.rawTwoPointPct);
  const twoMakeScale = (p2 / 100) / rawTwoPct;
  const zoneMake = (share: number, pct: number | null | undefined, label: string) => {
    if (share <= 0) return p2;
    return clamp(requiredNumber(pct, label) * twoMakeScale * 100, 1, 99);
  };
  const sourcedWeightedRate = (items: Array<[number, number | null | undefined, string]>, label: string) => {
    const rates = items.map(([share, pct, itemLabel]) => [share > 0 ? requiredNumber(pct, itemLabel) : null, share] as [number | null, number]);
    return requiredNumber(weightedRate(rates), label);
  };
  const shortMake =
    shortShare <= 0
      ? p2
      : clamp(
          sourcedWeightedRate(
            [
              [floaterShare, shooting.fgPct03_10, `${player.name} FG% 3-10`],
              [shortJumperShare, shooting.fgPct10_16, `${player.name} FG% 10-16`]
            ],
            `${player.name} FG% short mid`
          ) *
            twoMakeScale *
            100,
          1,
          99
        );

  return {
    shotProfile: "location",
    shotProfileMethod: shooting.method,
    shotProfileConfidence: shooting.confidence,
    twoZoneShares,
    shotMakes: {
      rim: zoneMake(rimShare, shooting.fgPct00_03, `${player.name} FG% 0-3`),
      shortMid: shortMake,
      longMid: zoneMake(longShare, shooting.fgPct16_xx, `${player.name} FG% 16-3P`),
      three: p3
    }
  };
}

function matchupThreeRate(
  offense: DiceTeamCard,
  defense: DiceTeamCard,
  eraContext: EraContext,
  player: DicePlayerCard,
  rawPlayerRate = player.calibration.rawThreeRate
): number {
  if (rawPlayerRate === 0) return 0;
  const context = matchupContext(eraContext);
  const rawTeamRate = teamThreeAttemptRate(offense);
  if (rawTeamRate <= 0) {
    throw new Error(`${offense.id} has invalid sourced team 3PA/FGA.`);
  }
  const translatedTeamRate = clamp(
    context.threeAttemptRate + (rawTeamRate - offense.calibration.leagueAverages.threeAttemptRate) * 0.55,
    0.02,
    0.65
  );
  const playerRoleWithinTeam = rawPlayerRate / rawTeamRate;
  const translatedRoleRate = clamp(translatedTeamRate * playerRoleWithinTeam, 0, 0.95);
  return clamp(rawPlayerRate * (1 - cardCalibration.threeEraAdaptation) + translatedRoleRate * cardCalibration.threeEraAdaptation, 0, 0.95);
}

function matchupFreeThrowAttemptRate(
  offense: DiceTeamCard,
  defense: DiceTeamCard,
  eraContext: EraContext,
  player: DicePlayerCard,
  playerFtaPerFga = player.calibration.rawFreeThrowAttemptRate
): number {
  const context = matchupContext(eraContext);
  if (playerFtaPerFga === 0) return 0;

  const eraTranslatedRate = clamp(
    context.freeThrowAttemptRate + (playerFtaPerFga - offense.calibration.leagueAverages.freeThrowAttemptRate) * 0.78,
    0,
    0.9
  );
  return clamp(playerFtaPerFga * (1 - cardCalibration.foulEraAdaptation) + eraTranslatedRate * cardCalibration.foulEraAdaptation, 0, 0.9);
}

function matchupPlayerProfile(
  offense: DiceTeamCard,
  defense: DiceTeamCard,
  player: DicePlayerCard,
  options: MatchupOptions,
  eraContext: EraContext
): MatchupPlayerProfile {
  const cacheKey = `${offense.id}|${defense.id}|${player.id}|${contextCacheKey(options)}|${eraContextCacheKey(eraContext)}|${playerProfileCacheKey()}`;
  const cached = matchupProfileCache.get(cacheKey);
  if (cached) return cached;

  const context = matchupContext(eraContext);
  const sourceLeague = offense.calibration.leagueAverages;
  const profileSource = playerStatProfile(player, options);
  const fga = requiredNumber(profileSource.totals.fga, `${player.name} FGA`);
  const fg2a = requiredNumber(profileSource.totals.fg2a, `${player.name} 2PA`);
  const fg3a = requiredNumber(profileSource.totals.fg3a, `${player.name} 3PA`);
  const fta = requiredNumber(profileSource.totals.fta, `${player.name} FTA`);
  const rawTwoPointPct = sourcedRate(profileSource.totals.fg2, fg2a, `${player.name} 2P%`);
  const rawThreePointPct = sourcedRate(profileSource.totals.fg3, fg3a, `${player.name} 3P%`);
  const rawFreeThrowPct = sourcedRate(profileSource.totals.ft, fta, `${player.name} FT%`);
  if (fga > 0 && fg2a > 0 && rawTwoPointPct === null) {
    throw new Error(`${player.name} is in the rotation without sourced 2P makes.`);
  }
  const rawThreeRate = fga > 0 ? fg3a / fga : 0;
  const profileFtaRate = rawFreeThrowAttemptRate(profileSource, player.name);

  const p2 =
    rawTwoPointPct === null
      ? 0.01
      : translatedRate(
          rawTwoPointPct,
          fg2a,
          sourceLeague.fg2Pct,
          context.fg2Pct,
          cardCalibration.regressionAttempts.twoPoint,
          cardCalibration.playerRelativeShootingDampening
        );
  const p3 =
    rawThreePointPct === null
      ? 0.01
      : translatedRate(
          rawThreePointPct,
          fg3a,
          sourceLeague.fg3Pct,
          context.fg3Pct,
          cardCalibration.regressionAttempts.threePoint,
          cardCalibration.playerThreeRelativeDampening
        );
  const ft =
    rawFreeThrowPct === null
      ? 0.01
      : translatedRate(rawFreeThrowPct, fta, sourceLeague.ftPct, context.ftPct, cardCalibration.regressionAttempts.freeThrow, 1);
  const turnover = profileTurnoverSplit(profileSource, player, player.name);

  const profile = {
    tov: profileTurnoverChance(profileSource, player.name),
    fd: clamp(matchupFreeThrowAttemptRate(offense, defense, eraContext, player, profileFtaRate) * 39, 0, 22),
    threeFrequency: clamp(matchupThreeRate(offense, defense, eraContext, player, rawThreeRate) * 100, 0, 95),
    p2: clamp(p2 * 100, 1, 99),
    p3: clamp(p3 * 100, 1, 99),
    ft: clamp(ft * 100, 1, 99),
    andOneChance: profileAndOneChance(profileSource, player.andOneChance, player.name),
    ...turnover,
    ...matchupShotZoneProfile(player, clamp(p2 * 100, 1, 99), clamp(p3 * 100, 1, 99), profileSource)
  };
  matchupProfileCache.set(cacheKey, profile);
  return profile;
}

function baseTurnoverChance(offense: DiceTeamCard, defense: DiceTeamCard, profile: MatchupPlayerProfile): number {
  return clamp((profile.tov + defense.toPress - offense.toProtect + simParams.globalTovMod) * simParams.tovScale, 0, 40);
}

function baseFoulDrawChance(offense: DiceTeamCard, defense: DiceTeamCard, profile: MatchupPlayerProfile): number {
  return clamp((profile.fd + offense.foulDraw - defense.foulDiscipline + simParams.globalFdMod) * simParams.fdScale, 0, 40);
}

function baseThreeAttemptChance(offense: DiceTeamCard, profile: MatchupPlayerProfile): number {
  return clamp(profile.threeFrequency + offense.threeTendency + simParams.threeMod, 0, 95);
}

function matchupThreeAttemptTarget(offense: DiceTeamCard, defense: DiceTeamCard, eraContext: EraContext): number {
  const context = matchupContext(eraContext);
  const offenseRaw = teamThreeAttemptRate(offense);
  const offenseTranslated = clamp(context.threeAttemptRate + (offenseRaw - offense.calibration.leagueAverages.threeAttemptRate) * 0.55, 0.02, 0.65);
  const offenseContextRate = clamp(
    offenseRaw * (1 - cardCalibration.threeEraAdaptation) + offenseTranslated * cardCalibration.threeEraAdaptation,
    0.02,
    0.65
  );
  const defenseAllowedTranslated = clamp(
    context.threeAttemptRate + (opponentAllowedThreeAttemptRate(defense) - defense.calibration.leagueAverages.threeAttemptRate) * 0.35,
    0.02,
    0.65
  );
  return clamp((offenseContextRate + (defenseAllowedTranslated - context.threeAttemptRate) * 0.25) * 100, 2, 65);
}

function baseUseWeight(player: DicePlayerCard, options: MatchupOptions): number {
  return options.intensity === "playoff" ? player.playoffUseWeight : player.useWeight;
}

function contextualUseWeightBeforePlayerTargets(team: DiceTeamCard, player: DicePlayerCard, options: MatchupOptions): number {
  let useWeight = baseUseWeight(player, options);
  const averageUse = team.players.reduce((sum, teammate) => sum + baseUseWeight(teammate, options), 0) / Math.max(1, team.players.length);
  if (options.intensity === "playoff" && averageUse > 0) {
    const relativeUse = Math.max(0.1, useWeight / averageUse);
    const multiplier = clamp(
      relativeUse ** simParams.playoffUseExponent,
      simParams.playoffUseMinMultiplier,
      simParams.playoffUseMaxMultiplier
    );
    useWeight *= multiplier;
  }

  const concentration = teamGamePlan(options, team).usageConcentration;
  if (concentration !== 1 && averageUse > 0) {
    const relativeUse = Math.max(0.1, useWeight / averageUse);
    useWeight *= clamp(relativeUse ** (concentration - 1), 0.55, 1.75);
  }
  return useWeight;
}

function playerUsageTargetMultiplier(baselineShare: number, targetShare: number): number {
  const baselineOdds = clamp(baselineShare, 0.001, 0.95) / clamp(1 - baselineShare, 0.05, 0.999);
  const targetOdds = clamp(targetShare, 0.001, 0.6) / clamp(1 - targetShare, 0.4, 0.999);
  const rawMultiplier = clamp(targetOdds / baselineOdds, 0.05, 20);
  const diminished = rawMultiplier >= 1 ? rawMultiplier ** 0.65 : 1 / ((1 / rawMultiplier) ** 0.65);
  return clamp(diminished, 0.25, 3.5);
}

function contextualUseWeight(team: DiceTeamCard, player: DicePlayerCard, options: MatchupOptions): number {
  const baselineWeight = contextualUseWeightBeforePlayerTargets(team, player, options);
  const targetShare = teamGamePlan(options, team).playerUsageTargets[player.id];
  if (targetShare === undefined) return baselineWeight;

  const totalBaselineWeight = team.players.reduce((sum, teammate) => sum + contextualUseWeightBeforePlayerTargets(team, teammate, options), 0);
  if (totalBaselineWeight <= 0) return baselineWeight;

  const baselineShare = baselineWeight / totalBaselineWeight;
  return baselineWeight * playerUsageTargetMultiplier(baselineShare, targetShare);
}

function useWeightedAverage(team: DiceTeamCard, options: MatchupOptions, value: (player: DicePlayerCard) => number): number {
  const totalWeight = team.players.reduce((sum, player) => sum + contextualUseWeight(team, player, options), 0);
  if (totalWeight <= 0) {
    throw new Error(`${team.id} has no positive player use weights.`);
  }
  return team.players.reduce((sum, player) => sum + value(player) * (contextualUseWeight(team, player, options) / totalWeight), 0);
}

function topEndImpactSignal(team: DiceTeamCard, options: MatchupOptions, field: "offensiveImpact" | "defensiveImpact", count = 3): number {
  const players = [...team.players]
    .map((player) => ({ player, weight: contextualUseWeight(team, player, options) }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, count);
  const totalWeight = players.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) {
    throw new Error(`${team.id} has no positive top-end player weights.`);
  }
  return players.reduce((sum, item) => sum + item.player.calibration[field] * (item.weight / totalWeight), 0);
}

function playoffLeverageShotAdjustment(offense: DiceTeamCard, defense: DiceTeamCard, options: MatchupOptions): number {
  if (options.intensity !== "playoff") return 0;
  const offensiveLeverage = topEndImpactSignal(offense, options, "offensiveImpact") - offense.calibration.playerOffenseSignal;
  const defensiveLeverage = topEndImpactSignal(defense, options, "defensiveImpact") - defense.calibration.playerDefenseSignal;
  return clamp((offensiveLeverage - defensiveLeverage) * simParams.playoffTopEndShotScale, -simParams.playoffTopEndShotCap, simParams.playoffTopEndShotCap);
}

function matchupActionProfile(offense: DiceTeamCard, defense: DiceTeamCard, options: MatchupOptions, eraContext: EraContext): MatchupActionProfile {
  const cacheKey = `${offense.id}|${defense.id}|${contextCacheKey(options)}|${eraContextCacheKey(eraContext)}|${actionProfileCacheKey()}`;
  const cached = matchupActionProfileCache.get(cacheKey);
  if (cached) return cached;

  const offenseRates = offenseSourceActionRates(offense);
  const defenseAllowedRates = opponentAllowedActionRates(defense);
  const talent = eraTalentAdjustment(offense, defense);
  const gamePlan = teamGamePlan(options, offense);
  const turnoverTargetChance = clamp(
    blendOffenseDefenseRate(offense, defense, offenseRates.turnover, defenseAllowedRates.turnover) + talent.turnoverAdjustment - gamePlan.ballSecurity,
    0,
    40
  );
  const foulDrawTargetChance = clamp(
    blendOffenseDefenseRate(offense, defense, offenseRates.foulDraw, defenseAllowedRates.foulDraw) + gamePlan.foulPressure,
    0,
    40
  );
  const threeAttemptTargetChance = clamp(matchupThreeAttemptTarget(offense, defense, eraContext) + gamePlan.threePointEmphasis, 2, 75);
  const baseTurnover = useWeightedAverage(offense, options, (player) =>
    baseTurnoverChance(offense, defense, matchupPlayerProfile(offense, defense, player, options, eraContext))
  );
  const baseFoulDraw = useWeightedAverage(offense, options, (player) =>
    baseFoulDrawChance(offense, defense, matchupPlayerProfile(offense, defense, player, options, eraContext))
  );
  const baseThreeAttempt = useWeightedAverage(offense, options, (player) =>
    baseThreeAttemptChance(offense, matchupPlayerProfile(offense, defense, player, options, eraContext))
  );

  if (baseTurnover <= 0 && turnoverTargetChance > 0) {
    throw new Error(`${offense.id} at ${defense.id} cannot scale turnovers from a zero base range.`);
  }
  if (baseFoulDraw <= 0 && foulDrawTargetChance > 0) {
    throw new Error(`${offense.id} at ${defense.id} cannot scale foul draw from a zero base range.`);
  }
  if (baseThreeAttempt <= 0 && threeAttemptTargetChance > 0) {
    throw new Error(`${offense.id} at ${defense.id} cannot scale three attempts from a zero base range.`);
  }

  const actionProfile = {
    turnoverTargetChance,
    foulDrawTargetChance,
    threeAttemptTargetChance,
    turnoverScale: baseTurnover > 0 ? turnoverTargetChance / baseTurnover : 1,
    foulDrawScale: baseFoulDraw > 0 ? foulDrawTargetChance / baseFoulDraw : 1,
    threeAttemptScale: baseThreeAttempt > 0 ? threeAttemptTargetChance / baseThreeAttempt : 1
  };
  matchupActionProfileCache.set(cacheKey, actionProfile);
  return actionProfile;
}

function effectiveTurnoverChance(
  offense: DiceTeamCard,
  defense: DiceTeamCard,
  options: MatchupOptions,
  eraContext: EraContext,
  profile: MatchupPlayerProfile
): number {
  return clamp(baseTurnoverChance(offense, defense, profile) * matchupActionProfile(offense, defense, options, eraContext).turnoverScale, 0, 40);
}

function effectiveFoulDrawChance(
  offense: DiceTeamCard,
  defense: DiceTeamCard,
  options: MatchupOptions,
  eraContext: EraContext,
  profile: MatchupPlayerProfile
): number {
  return clamp(baseFoulDrawChance(offense, defense, profile) * matchupActionProfile(offense, defense, options, eraContext).foulDrawScale, 0, 40);
}

function effectiveThreeAttemptChance(
  offense: DiceTeamCard,
  defense: DiceTeamCard,
  options: MatchupOptions,
  eraContext: EraContext,
  profile: MatchupPlayerProfile
): number {
  return clamp(baseThreeAttemptChance(offense, profile) * matchupActionProfile(offense, defense, options, eraContext).threeAttemptScale, 0, 95);
}

function effectiveShotZoneChances(
  offense: DiceTeamCard,
  defense: DiceTeamCard,
  options: MatchupOptions,
  eraContext: EraContext,
  profile: MatchupPlayerProfile
): Record<ShotZone, number> {
  const three = effectiveThreeAttemptChance(offense, defense, options, eraContext, profile);
  const two = 100 - three;
  return {
    rim: (profile.twoZoneShares.rim / 100) * two,
    shortMid: (profile.twoZoneShares.shortMid / 100) * two,
    longMid: (profile.twoZoneShares.longMid / 100) * two,
    three
  };
}

function matchupOffensiveReboundChance(offense: DiceTeamCard, defense: DiceTeamCard): number {
  const offenseOrbPct = requiredNumber(offense.source.team.offensiveReboundPct, `${offense.id} offensive rebound percentage`);
  const opponentAllowedOrbPct = 100 - requiredNumber(defense.source.team.defensiveReboundPct, `${defense.id} defensive rebound percentage`);
  return clamp(blendOffenseDefenseRate(offense, defense, offenseOrbPct, opponentAllowedOrbPct), 5, 45);
}

function teamShotZoneMix(offense: DiceTeamCard, defense: DiceTeamCard, options: MatchupOptions, eraContext: EraContext): Record<ShotZone, number> {
  const totalWeight = offense.players.reduce((sum, player) => sum + contextualUseWeight(offense, player, options), 0);
  if (totalWeight <= 0) {
    throw new Error(`${offense.id} has no positive player use weights.`);
  }
  const mix = emptyShotZoneRecord();
  for (const player of offense.players) {
    const profile = matchupPlayerProfile(offense, defense, player, options, eraContext);
    const chances = effectiveShotZoneChances(offense, defense, options, eraContext, profile);
    const weight = contextualUseWeight(offense, player, options) / totalWeight;
    for (const zone of shotZones) {
      mix[zone] += chances[zone] * weight;
    }
  }
  return normalizeShotZoneChances(mix);
}

function matchupOffensiveReboundChances(
  offense: DiceTeamCard,
  defense: DiceTeamCard,
  options: MatchupOptions,
  eraContext: EraContext
): Record<ShotZone, number> {
  const talent = eraTalentAdjustment(offense, defense);
  const base = clamp(matchupOffensiveReboundChance(offense, defense) + talent.reboundAdjustment + teamGamePlan(options, offense).crashBoards, 5, 45);
  const mix = teamShotZoneMix(offense, defense, options, eraContext);
  const weightedMultiplier = shotZones.reduce((sum, zone) => sum + (mix[zone] / 100) * shotZoneOrbMultipliers[zone], 0);
  if (weightedMultiplier <= 0) {
    throw new Error(`${offense.id} at ${defense.id} has invalid shot-zone rebound weights.`);
  }
  return Object.fromEntries(
    shotZones.map((zone) => [zone, clamp((base * shotZoneOrbMultipliers[zone]) / weightedMultiplier, 5, 45)])
  ) as Record<ShotZone, number>;
}

function chooseShotZoneResult(chances: Record<ShotZone, number>, rng: SeededRandom): { zone: ShotZone; roll: number } {
  let roll = rng.next() * 100;
  const originalRoll = roll;
  for (const zone of shotZones) {
    roll -= chances[zone];
    if (roll <= 0) return { zone, roll: originalRoll };
  }
  return { zone: "three", roll: originalRoll };
}

function assignmentWeight(team: DiceTeamCard, player: DicePlayerCard, event: AssignmentEvent, options: MatchupOptions): number {
  const healthy = options.intensity === "playoff";
  switch (event) {
    case "Use":
      return contextualUseWeight(team, player, options);
    case "AST":
      return healthy ? player.playoffAstWeight : player.astWeight;
    case "OREB":
      return healthy ? player.playoffOrbWeight : player.orbWeight;
    case "DREB":
      return healthy ? player.playoffDrbWeight : player.drbWeight;
    case "STL":
      return healthy ? player.playoffStlWeight : player.stlWeight;
    case "BLK":
      return healthy ? player.playoffBlkWeight : player.blkWeight;
    case "PF":
      return healthy ? player.playoffPfWeight : player.pfWeight;
    case "ShootingPF":
      return healthy ? player.playoffShootingFoulWeight : player.shootingFoulWeight;
  }
}

export function assignmentRows(team: DiceTeamCard, event: AssignmentEvent, options: Partial<MatchupOptions> = defaultMatchupOptions): RangeRow[] {
  const matchupOptions = normalizeMatchupOptions(options);
  const items = team.players
    .map((player) => ({ player, weight: assignmentWeight(team, player, event, matchupOptions) }))
    .filter((item) => item.weight > 0);
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) return [];

  const exact = items.map((item, index) => {
    const raw = (item.weight * 100) / total;
    return {
      index,
      player: item.player,
      weight: item.weight,
      count: Math.floor(raw),
      remainder: raw - Math.floor(raw)
    };
  });

  let remaining = 100 - exact.reduce((sum, item) => sum + item.count, 0);
  [...exact]
    .sort((a, b) => b.remainder - a.remainder || b.weight - a.weight)
    .slice(0, remaining)
    .forEach((item) => {
      item.count += 1;
    });

  remaining = 100 - exact.reduce((sum, item) => sum + item.count, 0);
  if (remaining > 0 && exact[0]) exact[0].count += remaining;

  let start = 1;
  return exact
    .sort((a, b) => a.index - b.index)
    .filter((item) => item.count > 0)
    .map((item) => {
      const end = start + item.count - 1;
      const row = {
        label: item.player.name,
        range: safeRange(start, end),
        weight: item.weight
      };
      start = end + 1;
      return row;
    });
}

function useRangeMap(team: DiceTeamCard, options: MatchupOptions): Map<string, string> {
  return new Map(assignmentRows(team, "Use", options).map((row) => [row.label, row.range]));
}

function expectedAssignmentDistribution(
  team: DiceTeamCard,
  event: AssignmentEvent,
  options: MatchupOptions,
  excludeName = ""
): Array<{ player: DicePlayerCard; probability: number }> {
  const items = team.players
    .filter((player) => player.name !== excludeName)
    .map((player) => ({ player, weight: assignmentWeight(team, player, event, options) }))
    .filter((item) => item.weight > 0);
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) return [];
  return items.map((item) => ({ player: item.player, probability: item.weight / totalWeight }));
}

function sideStatic(
  offense: DiceTeamCard,
  defense: DiceTeamCard,
  options: MatchupOptions,
  eraContext: EraContext,
  contextShotAdjustment: number
): TeamMatchupStatic {
  const defAdj = defenseShotAdjustment(defense.defense);
  const talent = eraTalentAdjustment(offense, defense);
  const orbChance = clamp(matchupOffensiveReboundChance(offense, defense) + talent.reboundAdjustment + teamGamePlan(options, offense).crashBoards, 5, 45);
  const orbByShotZone = matchupOffensiveReboundChances(offense, defense, options, eraContext);
  const blockChance = clamp(simParams.blockBase + defense.defense, 0, 40);
  const astMade2 = clamp(offense.assistMade2 + simParams.astMod, 0, 95);
  const astMade3 = clamp(offense.assistMade3 + simParams.astMod, 0, 95);
  const actionProfile = matchupActionProfile(offense, defense, options, eraContext);
  const foulEndChance = foulEndsPossessionChance(offense);
  const playoffLeverage = playoffLeverageShotAdjustment(offense, defense, options);
  const totalShotAdjustment = offense.shotQuality - defAdj + simParams.globalShotMod + contextShotAdjustment + playoffLeverage + talent.shotMakeAdjustment;
  return {
    offense: offense.id,
    defense: defense.id,
    orbChance,
    orbByShotZone,
    blockChance,
    astMade2,
    astMade3,
    turnoverTargetChance: actionProfile.turnoverTargetChance,
    foulDrawTargetChance: actionProfile.foulDrawTargetChance,
    threeAttemptTargetChance: actionProfile.threeAttemptTargetChance,
    turnoverScale: actionProfile.turnoverScale,
    foulDrawScale: actionProfile.foulDrawScale,
    threeAttemptScale: actionProfile.threeAttemptScale,
    foulEndsPossessionChance: foulEndChance,
    defenseShotAdjustment: defAdj,
    contextShotAdjustment,
    playoffLeverageShotAdjustment: playoffLeverage,
    eraTalentAdjustment: talent,
    totalShotAdjustment,
    ranges: {
      orb: nRange(orbChance),
      orbRim: nRange(orbByShotZone.rim),
      orbShortMid: nRange(orbByShotZone.shortMid),
      orbLongMid: nRange(orbByShotZone.longMid),
      orbThree: nRange(orbByShotZone.three),
      block: nRange(blockChance),
      ast2: nRange(astMade2),
      ast3: nRange(astMade3),
      foulEndsPossession: nRange(foulEndChance)
    }
  };
}

export function playerRanges(
  offense: DiceTeamCard,
  defense: DiceTeamCard,
  options: Partial<MatchupOptions> = defaultMatchupOptions,
  contextShotAdjustment = 0,
  eraContext?: EraContext
): PlayerRangeRow[] {
  const matchupOptions = normalizeMatchupOptions(options);
  const matchupEraContext = eraContext ?? buildEraContext(offense, defense, matchupOptions);
  const uses = useRangeMap(offense, matchupOptions);
  const defAdj = defenseShotAdjustment(defense.defense);
  const talent = eraTalentAdjustment(offense, defense);
  const playoffLeverage = playoffLeverageShotAdjustment(offense, defense, matchupOptions);
  const totalShotAdjustment = offense.shotQuality - defAdj + simParams.globalShotMod + contextShotAdjustment + playoffLeverage + talent.shotMakeAdjustment;

  return offense.players.map((player) => {
    const profile = matchupPlayerProfile(offense, defense, player, matchupOptions, matchupEraContext);
    const tov = effectiveTurnoverChance(offense, defense, matchupOptions, matchupEraContext, profile);
    const fd = effectiveFoulDrawChance(offense, defense, matchupOptions, matchupEraContext, profile);
    const shotZoneChances = effectiveShotZoneChances(offense, defense, matchupOptions, matchupEraContext, profile);
    const three = shotZoneChances.three;
    const p2 = clamp(profile.p2 + totalShotAdjustment, 1, 99);
    const p3 = clamp(profile.p3 + totalShotAdjustment, 1, 99);
    const shotMakes = {
      rim: clamp(profile.shotMakes.rim + totalShotAdjustment, 1, 99),
      shortMid: clamp(profile.shotMakes.shortMid + totalShotAdjustment, 1, 99),
      longMid: clamp(profile.shotMakes.longMid + totalShotAdjustment, 1, 99),
      three: p3
    };
    const rangeTov = Math.round(tov);
    const rangeFd = Math.round(fd);
    const rimEnd = Math.round(shotZoneChances.rim);
    const shortEnd = rimEnd + Math.round(shotZoneChances.shortMid);
    const longEnd = shortEnd + Math.round(shotZoneChances.longMid);

    return {
      player: player.name,
      use: uses.get(player.name) ?? "-",
      tov: safeRange(1, rangeTov),
      foul: safeRange(rangeTov + 1, rangeTov + rangeFd),
      shot: safeRange(rangeTov + rangeFd + 1, 100),
      shotProfile: profile.shotProfile,
      shotProfileMethod: profile.shotProfileMethod,
      shotProfileConfidence: profile.shotProfileConfidence,
      turnoverProfile: profile.turnoverProfile,
      liveBallTurnover: nRange(profile.liveBallTurnoverChance),
      offensiveFoulTurnover: nRange(profile.offensiveFoulTurnoverChance),
      rim: safeRange(1, rimEnd),
      shortMid: safeRange(rimEnd + 1, shortEnd),
      longMid: safeRange(shortEnd + 1, longEnd),
      three: safeRange(longEnd + 1, 100),
      rimMake: nRange(shotMakes.rim),
      shortMidMake: nRange(shotMakes.shortMid),
      longMidMake: nRange(shotMakes.longMid),
      p2: nRange(p2),
      p3: nRange(p3),
      ft: nRange(profile.ft),
      andOne: nRange(profile.andOneChance),
      raw: {
        tov,
        fd,
        liveBallTurnover: profile.liveBallTurnoverChance,
        offensiveFoulTurnover: profile.offensiveFoulTurnoverChance,
        shotZones: shotZoneChances,
        shotMakes,
        three,
        p2,
        p3,
        ft: profile.ft,
        andOne: profile.andOneChance
      }
    };
  });
}

export function buildMatchupCard(away: DiceTeamCard, home: DiceTeamCard, options: Partial<MatchupOptions> = defaultMatchupOptions): MatchupCard {
  const matchupOptions = resolveMatchupOptionsForTeams(away, home, options);
  const eraContext = buildEraContext(away, home, matchupOptions);
  const context = matchupContextRules(matchupOptions, eraContext);
  const possessionsEach = Math.round(eraContext.averages.pace * context.paceMultiplier * (matchupOptions.gameplay?.tempoMultiplier ?? 1));
  const events: AssignmentEvent[] = ["Use", "AST", "OREB", "DREB", "STL", "BLK", "PF", "ShootingPF"];

  return {
    away,
    home,
    options: matchupOptions,
    context,
    eraContext,
    possessionsEach,
    quarters: quarterSplit(possessionsEach),
    overtimePossessionsEach: overtimePossessionsEach(possessionsEach),
    looseFoulRange: nRange(simParams.nonshootFoulChance),
    stealOnTurnoverRange: nRange(simParams.stealTurnoverPct),
    awayStatic: sideStatic(away, home, matchupOptions, eraContext, context.awayShotContextAdjustment),
    homeStatic: sideStatic(home, away, matchupOptions, eraContext, context.homeShotContextAdjustment),
    awayPlayerRanges: playerRanges(away, home, matchupOptions, context.awayShotContextAdjustment, eraContext),
    homePlayerRanges: playerRanges(home, away, matchupOptions, context.homeShotContextAdjustment, eraContext),
    assignments: {
      [away.id]: Object.fromEntries(events.map((event) => [event, assignmentRows(away, event, matchupOptions)])) as Record<AssignmentEvent, RangeRow[]>,
      [home.id]: Object.fromEntries(events.map((event) => [event, assignmentRows(home, event, matchupOptions)])) as Record<AssignmentEvent, RangeRow[]>
    }
  };
}

type ExpectedLineAccumulator = {
  pts: number;
  fga: number;
  fg2a: number;
  fg2m: number;
  threePa: number;
  threePm: number;
  fta: number;
  ftm: number;
  tov: number;
  orb: number;
  ast: number;
  shotZones: Record<ShotZone, number>;
  makeByZone: Record<ShotZone, number>;
};

type ExpectedIteration = {
  line: ExpectedLineAccumulator;
  players: Map<string, ExpectedLineAccumulator>;
  continuationProbability: number;
};

function emptyExpectedLineAccumulator(): ExpectedLineAccumulator {
  return {
    pts: 0,
    fga: 0,
    fg2a: 0,
    fg2m: 0,
    threePa: 0,
    threePm: 0,
    fta: 0,
    ftm: 0,
    tov: 0,
    orb: 0,
    ast: 0,
    shotZones: emptyShotZoneRecord(),
    makeByZone: emptyShotZoneRecord()
  };
}

function emptyExpectedPlayerAccumulators(team: DiceTeamCard): Map<string, ExpectedLineAccumulator> {
  return new Map(team.players.map((player) => [player.id, emptyExpectedLineAccumulator()]));
}

function playerExpectedLine(players: Map<string, ExpectedLineAccumulator>, player: DicePlayerCard): ExpectedLineAccumulator {
  const found = players.get(player.id);
  if (found) return found;
  const line = emptyExpectedLineAccumulator();
  players.set(player.id, line);
  return line;
}

function addExpectedLine(target: ExpectedLineAccumulator, source: ExpectedLineAccumulator, scale = 1): void {
  target.pts += source.pts * scale;
  target.fga += source.fga * scale;
  target.fg2a += source.fg2a * scale;
  target.fg2m += source.fg2m * scale;
  target.threePa += source.threePa * scale;
  target.threePm += source.threePm * scale;
  target.fta += source.fta * scale;
  target.ftm += source.ftm * scale;
  target.tov += source.tov * scale;
  target.orb += source.orb * scale;
  target.ast += source.ast * scale;
  for (const zone of shotZones) {
    target.shotZones[zone] += source.shotZones[zone] * scale;
    target.makeByZone[zone] += source.makeByZone[zone] * scale;
  }
}

function addExpectedPlayerLines(
  target: Map<string, ExpectedLineAccumulator>,
  source: Map<string, ExpectedLineAccumulator>,
  scale = 1
): void {
  for (const [playerId, line] of source) {
    const targetLine = target.get(playerId) ?? emptyExpectedLineAccumulator();
    addExpectedLine(targetLine, line, scale);
    target.set(playerId, targetLine);
  }
}

function distributeExpectedStat(
  players: Map<string, ExpectedLineAccumulator>,
  distribution: Array<{ player: DicePlayerCard; probability: number }>,
  field: "ast" | "orb",
  amount: number
): void {
  if (amount <= 0) return;
  for (const item of distribution) {
    playerExpectedLine(players, item.player)[field] += amount * item.probability;
  }
}

function scaleShotZoneRecord(input: Record<ShotZone, number>, scale: number): Record<ShotZone, number> {
  return Object.fromEntries(shotZones.map((zone) => [zone, input[zone] * scale])) as Record<ShotZone, number>;
}

function safeStatRate(made: number, attempts: number): number {
  return attempts > 0 ? made / attempts : 0;
}

function expectedUseDistribution(
  team: DiceTeamCard,
  options: MatchupOptions
): Array<{ player: DicePlayerCard; probability: number }> {
  const totalWeight = team.players.reduce((sum, player) => sum + contextualUseWeight(team, player, options), 0);
  if (totalWeight <= 0) {
    throw new Error(`${team.id} has no positive player use weights.`);
  }
  return team.players.map((player) => ({
    player,
    probability: contextualUseWeight(team, player, options) / totalWeight
  }));
}

function actionProbabilities(turnoverChance: number, foulDrawChance: number): { turnover: number; foulDraw: number; shot: number } {
  const turnoverEnd = clamp(turnoverChance, 0, 100);
  const foulEnd = clamp(turnoverChance + foulDrawChance, 0, 100);
  const turnover = turnoverEnd / 100;
  const foulDraw = Math.max(0, foulEnd - turnoverEnd) / 100;
  return {
    turnover,
    foulDraw,
    shot: Math.max(0, 1 - turnover - foulDraw)
  };
}

function addExpectedShotAttempt(
  line: ExpectedLineAccumulator,
  players: Map<string, ExpectedLineAccumulator>,
  shooter: DicePlayerCard,
  profile: MatchupPlayerProfile,
  shotZoneChances: Record<ShotZone, number>,
  offenseStatic: TeamMatchupStatic,
  assistDistribution: Array<{ player: DicePlayerCard; probability: number }>,
  offensiveReboundDistribution: Array<{ player: DicePlayerCard; probability: number }>,
  shotProbability: number,
  allowOffensiveRebound: boolean
): number {
  let continuationProbability = 0;
  if (shotProbability <= 0) return continuationProbability;
  const shooterLine = playerExpectedLine(players, shooter);

  for (const zone of shotZones) {
    const attempt = shotProbability * (shotZoneChances[zone] / 100);
    if (attempt <= 0) continue;

    const makeRate = clamp(profile.shotMakes[zone] + offenseStatic.totalShotAdjustment, 1, 99) / 100;
    const makes = attempt * makeRate;
    const misses = attempt - makes;
    line.fga += attempt;
    line.shotZones[zone] += attempt;
    line.makeByZone[zone] += makes;
    shooterLine.fga += attempt;
    shooterLine.shotZones[zone] += attempt;
    shooterLine.makeByZone[zone] += makes;

    if (zone === "three") {
      line.threePa += attempt;
      line.threePm += makes;
      line.pts += makes * 3;
      shooterLine.threePa += attempt;
      shooterLine.threePm += makes;
      shooterLine.pts += makes * 3;
      const assistedMakes = makes * (offenseStatic.astMade3 / 100);
      line.ast += assistedMakes;
      distributeExpectedStat(players, assistDistribution, "ast", assistedMakes);
    } else {
      line.fg2a += attempt;
      line.fg2m += makes;
      line.pts += makes * 2;
      shooterLine.fg2a += attempt;
      shooterLine.fg2m += makes;
      shooterLine.pts += makes * 2;
      const assistedMakes = makes * (offenseStatic.astMade2 / 100);
      line.ast += assistedMakes;
      distributeExpectedStat(players, assistDistribution, "ast", assistedMakes);
    }

    const andOneTrips = makes * (profile.andOneChance / 100);
    line.fta += andOneTrips;
    line.ftm += andOneTrips * (profile.ft / 100);
    line.pts += andOneTrips * (profile.ft / 100);
    shooterLine.fta += andOneTrips;
    shooterLine.ftm += andOneTrips * (profile.ft / 100);
    shooterLine.pts += andOneTrips * (profile.ft / 100);

    if (allowOffensiveRebound) {
      const offensiveRebounds = misses * (offenseStatic.orbByShotZone[zone] / 100);
      line.orb += offensiveRebounds;
      distributeExpectedStat(players, offensiveReboundDistribution, "orb", offensiveRebounds);
      continuationProbability += offensiveRebounds;
    }
  }

  return continuationProbability;
}

function expectedIteration(
  offense: DiceTeamCard,
  defense: DiceTeamCard,
  offenseStatic: TeamMatchupStatic,
  options: MatchupOptions,
  eraContext: EraContext,
  allowOffensiveRebound: boolean
): ExpectedIteration {
  const line = emptyExpectedLineAccumulator();
  const players = emptyExpectedPlayerAccumulators(offense);
  const usage = expectedUseDistribution(offense, options).map((item) => ({
    ...item,
    profile: matchupPlayerProfile(offense, defense, item.player, options, eraContext)
  }));
  const directShotProbabilities = new Map<string, number>();
  const foulEndChance = foulEndsPossessionChance(offense) / 100;
  let continuationShotProbability = 0;
  const offensiveReboundDistribution = expectedAssignmentDistribution(offense, "OREB", options);

  for (const item of usage) {
    const effectiveTov = effectiveTurnoverChance(offense, defense, options, eraContext, item.profile);
    const effectiveFd = effectiveFoulDrawChance(offense, defense, options, eraContext, item.profile);
    const action = actionProbabilities(effectiveTov, effectiveFd);
    const turnoverProbability = item.probability * action.turnover;
    const foulDrawProbability = item.probability * action.foulDraw;
    const playerLine = playerExpectedLine(players, item.player);

    line.tov += turnoverProbability;
    line.fta += foulDrawProbability * 2;
    line.ftm += foulDrawProbability * 2 * (item.profile.ft / 100);
    line.pts += foulDrawProbability * 2 * (item.profile.ft / 100);
    playerLine.tov += turnoverProbability;
    playerLine.fta += foulDrawProbability * 2;
    playerLine.ftm += foulDrawProbability * 2 * (item.profile.ft / 100);
    playerLine.pts += foulDrawProbability * 2 * (item.profile.ft / 100);
    continuationShotProbability += foulDrawProbability * (1 - foulEndChance);
    directShotProbabilities.set(item.player.id, item.probability * action.shot);
  }

  let continuationProbability = 0;
  for (const item of usage) {
    const directShotProbability = directShotProbabilities.get(item.player.id) ?? 0;
    const shotProbability = directShotProbability + continuationShotProbability * item.probability;
    continuationProbability += addExpectedShotAttempt(
      line,
      players,
      item.player,
      item.profile,
      effectiveShotZoneChances(offense, defense, options, eraContext, item.profile),
      offenseStatic,
      expectedAssignmentDistribution(offense, "AST", options, item.player.name),
      offensiveReboundDistribution,
      shotProbability,
      allowOffensiveRebound
    );
  }

  return {
    line,
    players,
    continuationProbability: allowOffensiveRebound ? continuationProbability : 0
  };
}

function expectedTeamLine(
  team: DiceTeamCard,
  defense: DiceTeamCard,
  offenseStatic: TeamMatchupStatic,
  options: MatchupOptions,
  eraContext: EraContext,
  possessions: number
): ExpectedTeamLine {
  const total = emptyExpectedLineAccumulator();
  const players = emptyExpectedPlayerAccumulators(team);
  const fullIteration = expectedIteration(team, defense, offenseStatic, options, eraContext, true);
  const terminalIteration = expectedIteration(team, defense, offenseStatic, options, eraContext, false);
  let reachProbability = 1;

  for (let extension = 0; extension <= simParams.maxOrbExtensions; extension += 1) {
    const terminal = extension >= simParams.maxOrbExtensions;
    const iteration = terminal ? terminalIteration : fullIteration;
    addExpectedLine(total, iteration.line, reachProbability);
    addExpectedPlayerLines(players, iteration.players, reachProbability);
    if (terminal) break;
    reachProbability *= iteration.continuationProbability;
  }

  const pts = total.pts * possessions;
  const fga = total.fga * possessions;
  const fg2a = total.fg2a * possessions;
  const fg2m = total.fg2m * possessions;
  const threePa = total.threePa * possessions;
  const threePm = total.threePm * possessions;
  const fta = total.fta * possessions;
  const ftm = total.ftm * possessions;
  const useDistribution = new Map(expectedUseDistribution(team, options).map((item) => [item.player.id, item.probability]));
  const playerLines = team.players
    .map((player) => {
      const line = players.get(player.id) ?? emptyExpectedLineAccumulator();
      const playerFga = line.fga * possessions;
      const playerFg2a = line.fg2a * possessions;
      const playerFg2m = line.fg2m * possessions;
      const playerThreePa = line.threePa * possessions;
      const playerThreePm = line.threePm * possessions;
      const playerFta = line.fta * possessions;
      const playerFtm = line.ftm * possessions;
      return {
        playerId: player.id,
        player: player.name,
        teamId: team.id,
        usageShare: useDistribution.get(player.id) ?? 0,
        pts: line.pts * possessions,
        fgm: (line.fg2m + line.threePm) * possessions,
        fga: playerFga,
        fgPct: safeStatRate(playerFg2m + playerThreePm, playerFga),
        fg2a: playerFg2a,
        fg2m: playerFg2m,
        fg2Pct: safeStatRate(playerFg2m, playerFg2a),
        threePa: playerThreePa,
        threePm: playerThreePm,
        threePct: safeStatRate(playerThreePm, playerThreePa),
        fta: playerFta,
        ftm: playerFtm,
        ftPct: safeStatRate(playerFtm, playerFta),
        tov: line.tov * possessions,
        orb: line.orb * possessions,
        ast: line.ast * possessions,
        shotZones: scaleShotZoneRecord(line.shotZones, possessions),
        makeByZone: scaleShotZoneRecord(line.makeByZone, possessions)
      } satisfies ExpectedPlayerLine;
    })
    .sort((a, b) => b.pts - a.pts || b.fga - a.fga || a.player.localeCompare(b.player));

  return {
    teamId: team.id,
    team: team.shortName,
    possessions,
    pts,
    fga,
    fgPct: safeStatRate(fg2m + threePm, fga),
    fg2a,
    fg2m,
    fg2Pct: safeStatRate(fg2m, fg2a),
    threePa,
    threePm,
    threePct: safeStatRate(threePm, threePa),
    fta,
    ftm,
    ftPct: safeStatRate(ftm, fta),
    tov: total.tov * possessions,
    orb: total.orb * possessions,
    ast: total.ast * possessions,
    shotZones: scaleShotZoneRecord(total.shotZones, possessions),
    makeByZone: scaleShotZoneRecord(total.makeByZone, possessions),
    pointsPerPossession: possessions > 0 ? pts / possessions : 0,
    players: playerLines
  };
}

export function buildExpectedMatchupLine(
  away: DiceTeamCard,
  home: DiceTeamCard,
  options: Partial<MatchupOptions> = defaultMatchupOptions
): ExpectedMatchupLine {
  const matchup = buildMatchupCard(away, home, options);
  return expectedMatchupLineFromCard(matchup);
}

export function expectedMatchupLineFromCard(matchup: MatchupCard): ExpectedMatchupLine {
  const awayLine = expectedTeamLine(matchup.away, matchup.home, matchup.awayStatic, matchup.options, matchup.eraContext, matchup.possessionsEach);
  const homeLine = expectedTeamLine(matchup.home, matchup.away, matchup.homeStatic, matchup.options, matchup.eraContext, matchup.possessionsEach);

  return {
    options: matchup.options,
    eraContext: matchup.eraContext,
    possessionsEach: matchup.possessionsEach,
    away: awayLine,
    home: homeLine,
    marginForAway: awayLine.pts - homeLine.pts
  };
}

function gameModelMetadata(matchup: MatchupCard): GameModelMetadata {
  const expected = expectedMatchupLineFromCard(matchup);
  return {
    modelVersion: crossEraModelVersion,
    contextLabel: matchup.context.label,
    options: matchup.options,
    eraContext: matchup.eraContext,
    expected: {
      possessionsEach: expected.possessionsEach,
      awayScore: expected.away.pts,
      homeScore: expected.home.pts,
      marginForAway: expected.marginForAway,
      away: expected.away,
      home: expected.home
    }
  };
}

function availabilityTargets(away: DiceTeamCard, home: DiceTeamCard): Array<{ team: DiceTeamCard; player: DicePlayerCard }> {
  return [away, home].flatMap((team) => team.players.map((player) => ({ team, player })));
}

function findAvailabilityTarget(away: DiceTeamCard, home: DiceTeamCard, token: string): { team: DiceTeamCard; player: DicePlayerCard } | undefined {
  const targets = availabilityTargets(away, home);
  const exactId = targets.find(({ player }) => player.id === token);
  if (exactId) return exactId;

  const normalized = token.toLowerCase();
  const matches = targets.filter(({ team, player }) => player.name.toLowerCase() === normalized || `${team.id}:${player.name}`.toLowerCase() === normalized);
  return matches.length === 1 ? matches[0] : undefined;
}

function markPlayerUnavailable(
  availability: GameAvailabilityState,
  team: DiceTeamCard,
  player: DicePlayerCard,
  reason: NonNullable<GameResult["playerAvailabilityEvents"]>[number]["reason"],
  trace?: PossessionTrace,
  fouls?: number
): boolean {
  if (availability.unavailablePlayerIds.has(player.id)) return false;
  availability.unavailablePlayerIds.add(player.id);
  availability.events.push({
    teamId: team.id,
    playerId: player.id,
    player: player.name,
    reason,
    fouls,
    periodLabel: trace?.periodLabel,
    possessionNumber: trace?.possessionNumber
  });
  if (trace) {
    addTraceStep(trace, {
      label: reason === "fouled-out" ? "Foul out" : "Player unavailable",
      result: player.name,
      detail: reason === "fouled-out" ? `${fouls ?? simParams.foulOutLimit} personal fouls` : team.shortName
    });
  }
  return true;
}

function createGameAvailabilityState(away: DiceTeamCard, home: DiceTeamCard, options: Partial<SimulationOptions>): GameAvailabilityState {
  const availability: GameAvailabilityState = {
    unavailablePlayerIds: new Set(),
    events: []
  };

  for (const token of options.unavailablePlayerIds ?? []) {
    const target = findAvailabilityTarget(away, home, token);
    if (!target) {
      throw new Error(`Unknown unavailable player for ${away.id} at ${home.id}: ${token}`);
    }
    markPlayerUnavailable(availability, target.team, target.player, "taken-away");
  }

  return availability;
}

function playerAvailable(player: DicePlayerCard, availability?: GameAvailabilityState): boolean {
  return !availability?.unavailablePlayerIds.has(player.id);
}

function availablePlayerPool(team: DiceTeamCard, availability?: GameAvailabilityState, excludeName = ""): DicePlayerCard[] {
  const candidates = team.players.filter((player) => player.name !== excludeName);
  return candidates.filter((player) => playerAvailable(player, availability));
}

function weightedChoiceResult(
  team: DiceTeamCard,
  event: AssignmentEvent,
  options: MatchupOptions,
  rng: SeededRandom,
  excludeName = "",
  availability?: GameAvailabilityState
): { player: DicePlayerCard | undefined; roll: number; total: number } {
  const items = availablePlayerPool(team, availability, excludeName)
    .map((player) => ({ player, weight: assignmentWeight(team, player, event, options) }))
    .filter((item) => item.weight > 0);
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) return { player: undefined, roll: 0, total: 0 };

  let roll = rng.next() * total;
  const originalRoll = roll;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return { player: item.player, roll: originalRoll, total };
  }
  return { player: items.at(-1)?.player, roll: originalRoll, total };
}

function selectOffensivePlayerResult(
  team: DiceTeamCard,
  options: MatchupOptions,
  rng: SeededRandom,
  availability?: GameAvailabilityState
): { player: DicePlayerCard; roll: number; total: number } {
  const players = availablePlayerPool(team, availability);
  const total = players.reduce((sum, player) => sum + contextualUseWeight(team, player, options), 0);
  if (total <= 0) {
    throw new Error(`${team.id} has no positive active player use weights.`);
  }
  let roll = rng.next() * total;
  const originalRoll = roll;
  for (const player of players) {
    roll -= contextualUseWeight(team, player, options);
    if (roll <= 0) return { player, roll: originalRoll, total };
  }
  return { player: players.at(-1) as DicePlayerCard, roll: originalRoll, total };
}

function emptyTeamStats(): StatLine {
  return Object.fromEntries([...statFields, ...teamExtraStatFields].map((field) => [field, 0]));
}

function emptyPlayerStats(team: DiceTeamCard): Record<string, StatLine> {
  return Object.fromEntries(team.players.map((player) => [player.name, Object.fromEntries(statFields.map((field) => [field, 0]))]));
}

function add(statLine: StatLine, field: string, amount = 1): void {
  statLine[field] = (statLine[field] ?? 0) + amount;
}

function addPersonalFoul(
  team: DiceTeamCard,
  player: DicePlayerCard,
  playerStats: Record<string, StatLine>,
  teamStats: StatLine,
  availability: GameAvailabilityState,
  trace?: PossessionTrace
): void {
  add(playerStats[player.name], "PF");
  add(teamStats, "PF");
  const fouls = playerStats[player.name].PF ?? 0;
  if (fouls >= simParams.foulOutLimit) {
    markPlayerUnavailable(availability, team, player, "fouled-out", trace, fouls);
  }
}

function resolvePossession(
  offense: DiceTeamCard,
  defense: DiceTeamCard,
  offenseStatic: TeamMatchupStatic,
  options: MatchupOptions,
  eraContext: EraContext,
  offensePlayerStats: Record<string, StatLine>,
  defensePlayerStats: Record<string, StatLine>,
  offenseTeamStats: StatLine,
  defenseTeamStats: StatLine,
  rng: SeededRandom,
  availability: GameAvailabilityState,
  trace?: PossessionTrace
): void {
  add(offenseTeamStats, "poss");
  let extensions = 0;

  while (true) {
    if (simParams.nonshootFoulChance > 0) {
      const looseFoul = percentRoll(rng, simParams.nonshootFoulChance);
      addTraceStep(trace, {
        label: "Loose foul check",
        roll: looseFoul.roll,
        target: looseFoul.target,
        result: successLabel(looseFoul.success),
        detail: `${defense.shortName} non-shooting foul range`
      });
      if (looseFoul.success) {
        const foulChoice = weightedChoiceResult(defense, "PF", options, rng, "", availability);
        const fouler = foulChoice.player;
        addTraceStep(trace, {
          label: "Personal foul assignment",
          roll: foulChoice.roll,
          target: foulChoice.total,
          result: fouler?.name ?? "No assignment",
          detail: "PF assignment table"
        });
        if (fouler) {
          addPersonalFoul(defense, fouler, defensePlayerStats, defenseTeamStats, availability, trace);
          add(offenseTeamStats, "nonshooting_fouls_drawn");
        }
      }
    }

    const shooterChoice = selectOffensivePlayerResult(offense, options, rng, availability);
    const shooter = shooterChoice.player;
    addTraceStep(trace, {
      label: "Usage assignment",
      roll: shooterChoice.roll,
      target: shooterChoice.total,
      result: shooter.name,
      detail: `${offense.shortName} use table`
    });
    const shooterProfile = matchupPlayerProfile(offense, defense, shooter, options, eraContext);
    const effectiveTov = effectiveTurnoverChance(offense, defense, options, eraContext, shooterProfile);
    const effectiveFd = effectiveFoulDrawChance(offense, defense, options, eraContext, shooterProfile);
    const actionRoll = rng.next() * 100;
    const actionResult = actionRoll < effectiveTov ? "Turnover" : actionRoll < effectiveTov + effectiveFd ? "Foul draw" : "Shot";
    addTraceStep(trace, {
      label: "Action roll",
      roll: actionRoll,
      target: actionResult === "Turnover" ? effectiveTov : actionResult === "Foul draw" ? effectiveTov + effectiveFd : 100,
      result: actionResult,
      detail: `${shooter.name}: TOV ${effectiveTov.toFixed(1)}, foul ${effectiveFd.toFixed(1)}, shot ${(100 - effectiveTov - effectiveFd).toFixed(1)}`
    });

    if (actionRoll < effectiveTov) {
      add(offensePlayerStats[shooter.name], "TOV");
      add(offenseTeamStats, "TOV");
      const offensiveFoul = percentRoll(rng, shooterProfile.offensiveFoulTurnoverChance);
      addTraceStep(trace, {
        label: "Offensive foul turnover",
        roll: offensiveFoul.roll,
        target: offensiveFoul.target,
        result: successLabel(offensiveFoul.success),
        detail: shooter.name
      });
      if (offensiveFoul.success) {
        addPersonalFoul(offense, shooter, offensePlayerStats, offenseTeamStats, availability, trace);
        if (trace) trace.summary = `${offense.shortName} turnover, offensive foul on ${shooter.name}`;
        return;
      }
      const liveBall = percentRoll(rng, shooterProfile.liveBallTurnoverChance);
      addTraceStep(trace, {
        label: "Live-ball turnover",
        roll: liveBall.roll,
        target: liveBall.target,
        result: successLabel(liveBall.success),
        detail: shooter.name
      });
      if (liveBall.success) {
        const stealChoice = weightedChoiceResult(defense, "STL", options, rng, "", availability);
        const stealer = stealChoice.player;
        addTraceStep(trace, {
          label: "Steal assignment",
          roll: stealChoice.roll,
          target: stealChoice.total,
          result: stealer?.name ?? "No assignment",
          detail: `${defense.shortName} STL table`
        });
        if (stealer) {
          add(defensePlayerStats[stealer.name], "STL");
          add(defenseTeamStats, "STL");
        }
      }
      if (trace) trace.summary = `${offense.shortName} turnover by ${shooter.name}`;
      return;
    }

    if (actionRoll < effectiveTov + effectiveFd) {
      const foulChoice = weightedChoiceResult(defense, "ShootingPF", options, rng, "", availability);
      const fouler = foulChoice.player;
      addTraceStep(trace, {
        label: "Shooting foul assignment",
        roll: foulChoice.roll,
        target: foulChoice.total,
        result: fouler?.name ?? "No assignment",
        detail: `${defense.shortName} shooting PF table`
      });
      if (fouler) {
        addPersonalFoul(defense, fouler, defensePlayerStats, defenseTeamStats, availability, trace);
      }
      for (let shot = 0; shot < 2; shot += 1) {
        add(offensePlayerStats[shooter.name], "FTA");
        add(offenseTeamStats, "FTA");
        const freeThrow = percentRoll(rng, shooterProfile.ft);
        addTraceStep(trace, {
          label: `Free throw ${shot + 1}`,
          roll: freeThrow.roll,
          target: freeThrow.target,
          result: successLabel(freeThrow.success, "Made", "Miss"),
          detail: shooter.name
        });
        if (freeThrow.success) {
          add(offensePlayerStats[shooter.name], "FTM");
          add(offensePlayerStats[shooter.name], "PTS");
          add(offenseTeamStats, "FTM");
          add(offenseTeamStats, "PTS");
        }
      }

      const foulEnds = percentRoll(rng, foulEndsPossessionChance(offense));
      addTraceStep(trace, {
        label: "Foul ends possession",
        roll: foulEnds.roll,
        target: foulEnds.target,
        result: successLabel(foulEnds.success),
        detail: `${offense.shortName} foul-end range`
      });
      if (foulEnds.success) {
        if (trace) trace.summary = `${offense.shortName} shooting foul trip for ${shooter.name}`;
        return;
      }
      add(offenseTeamStats, "continuation_fouls_drawn");
    }

    let shotTaker = shooter;
    if (actionRoll < effectiveTov + effectiveFd) {
      const continuationChoice = selectOffensivePlayerResult(offense, options, rng, availability);
      shotTaker = continuationChoice.player;
      addTraceStep(trace, {
        label: "Continuation usage",
        roll: continuationChoice.roll,
        target: continuationChoice.total,
        result: shotTaker.name,
        detail: `${offense.shortName} use table`
      });
    }
    const shotProfile = shotTaker.id === shooter.id ? shooterProfile : matchupPlayerProfile(offense, defense, shotTaker, options, eraContext);
    const zoneChances = effectiveShotZoneChances(offense, defense, options, eraContext, shotProfile);
    const zoneChoice = chooseShotZoneResult(zoneChances, rng);
    const shotZone = zoneChoice.zone;
    const isThree = shotZone === "three";
    const makeNumber = clamp(shotProfile.shotMakes[shotZone] + offenseStatic.totalShotAdjustment, 1, 99);
    addTraceStep(trace, {
      label: "Shot zone",
      roll: zoneChoice.roll,
      target: 100,
      result: shotZoneLabel(shotZone),
      detail: `${shotTaker.name}: rim ${zoneChances.rim.toFixed(1)}, short ${zoneChances.shortMid.toFixed(1)}, long ${zoneChances.longMid.toFixed(1)}, 3P ${zoneChances.three.toFixed(1)}`
    });

    add(offensePlayerStats[shotTaker.name], "FGA");
    add(offenseTeamStats, "FGA");
    if (isThree) {
      add(offensePlayerStats[shotTaker.name], "3PA");
      add(offenseTeamStats, "3PA");
    }

    const shotMake = percentRoll(rng, makeNumber);
    addTraceStep(trace, {
      label: "Shot make",
      roll: shotMake.roll,
      target: shotMake.target,
      result: successLabel(shotMake.success, "Made", "Miss"),
      detail: `${shotTaker.name} ${shotZoneLabel(shotZone)}`
    });
    if (shotMake.success) {
      add(offensePlayerStats[shotTaker.name], "FGM");
      add(offenseTeamStats, "FGM");
      if (isThree) {
        add(offensePlayerStats[shotTaker.name], "3PM");
        add(offensePlayerStats[shotTaker.name], "PTS", 3);
        add(offenseTeamStats, "3PM");
        add(offenseTeamStats, "PTS", 3);
      } else {
        add(offensePlayerStats[shotTaker.name], "PTS", 2);
        add(offenseTeamStats, "PTS", 2);
      }

      const assistChance = isThree ? offense.assistMade3 : offense.assistMade2;
      const assist = percentRoll(rng, clamp(assistChance + simParams.astMod, 0, 95));
      addTraceStep(trace, {
        label: "Assist check",
        roll: assist.roll,
        target: assist.target,
        result: successLabel(assist.success),
        detail: isThree ? "Made 3P assist range" : "Made 2P assist range"
      });
      if (assist.success) {
        const assistChoice = weightedChoiceResult(offense, "AST", options, rng, shotTaker.name, availability);
        const passer = assistChoice.player;
        addTraceStep(trace, {
          label: "Assist assignment",
          roll: assistChoice.roll,
          target: assistChoice.total,
          result: passer?.name ?? "No assignment",
          detail: `${offense.shortName} AST table`
        });
        if (passer) {
          add(offensePlayerStats[passer.name], "AST");
          add(offenseTeamStats, "AST");
        }
      }
      const andOne = percentRoll(rng, shotProfile.andOneChance);
      addTraceStep(trace, {
        label: "And-one check",
        roll: andOne.roll,
        target: andOne.target,
        result: successLabel(andOne.success),
        detail: shotTaker.name
      });
      if (andOne.success) {
        const foulChoice = weightedChoiceResult(defense, "ShootingPF", options, rng, "", availability);
        const fouler = foulChoice.player;
        addTraceStep(trace, {
          label: "And-one foul assignment",
          roll: foulChoice.roll,
          target: foulChoice.total,
          result: fouler?.name ?? "No assignment",
          detail: `${defense.shortName} shooting PF table`
        });
        if (fouler) {
          addPersonalFoul(defense, fouler, defensePlayerStats, defenseTeamStats, availability, trace);
        }
        add(offensePlayerStats[shotTaker.name], "FTA");
        add(offenseTeamStats, "FTA");
        const freeThrow = percentRoll(rng, shotProfile.ft);
        addTraceStep(trace, {
          label: "And-one free throw",
          roll: freeThrow.roll,
          target: freeThrow.target,
          result: successLabel(freeThrow.success, "Made", "Miss"),
          detail: shotTaker.name
        });
        if (freeThrow.success) {
          add(offensePlayerStats[shotTaker.name], "FTM");
          add(offensePlayerStats[shotTaker.name], "PTS");
          add(offenseTeamStats, "FTM");
          add(offenseTeamStats, "PTS");
        }
      }
      if (trace) trace.summary = `${offense.shortName} ${shotTaker.name} made ${isThree ? "a 3" : "a 2"}`;
      return;
    }

    if (!isThree) {
      const block = percentRoll(rng, clamp(simParams.blockBase + defense.defense, 0, 40));
      addTraceStep(trace, {
        label: "Block check",
        roll: block.roll,
        target: block.target,
        result: successLabel(block.success),
        detail: `${defense.shortName} block range`
      });
      if (block.success) {
        const blockChoice = weightedChoiceResult(defense, "BLK", options, rng, "", availability);
        const blocker = blockChoice.player;
        addTraceStep(trace, {
          label: "Block assignment",
          roll: blockChoice.roll,
          target: blockChoice.total,
          result: blocker?.name ?? "No assignment",
          detail: `${defense.shortName} BLK table`
        });
        if (blocker) {
          add(defensePlayerStats[blocker.name], "BLK");
          add(defenseTeamStats, "BLK");
        }
      }
    }

    const orbChance = offenseStatic.orbByShotZone[shotZone];
    const offensiveRebound = percentRoll(rng, orbChance);
    addTraceStep(trace, {
      label: "Offensive rebound check",
      roll: offensiveRebound.roll,
      target: offensiveRebound.target,
      result: offensiveRebound.success && extensions < simParams.maxOrbExtensions ? "Yes" : "No",
      detail: extensions >= simParams.maxOrbExtensions ? "Extension limit reached" : `${shotZoneLabel(shotZone)} rebound range`
    });
    if (offensiveRebound.success && extensions < simParams.maxOrbExtensions) {
      const reboundChoice = weightedChoiceResult(offense, "OREB", options, rng, "", availability);
      const rebounder = reboundChoice.player;
      addTraceStep(trace, {
        label: "Offensive rebound assignment",
        roll: reboundChoice.roll,
        target: reboundChoice.total,
        result: rebounder?.name ?? "No assignment",
        detail: `${offense.shortName} OREB table`
      });
      if (rebounder) {
        add(offensePlayerStats[rebounder.name], "OREB");
        add(offenseTeamStats, "OREB");
      }
      extensions += 1;
      if (trace) trace.summary = `${offense.shortName} missed, offensive rebound`;
      continue;
    }

    const reboundChoice = weightedChoiceResult(defense, "DREB", options, rng, "", availability);
    const rebounder = reboundChoice.player;
    addTraceStep(trace, {
      label: "Defensive rebound assignment",
      roll: reboundChoice.roll,
      target: reboundChoice.total,
      result: rebounder?.name ?? "No assignment",
      detail: `${defense.shortName} DREB table`
    });
    if (rebounder) {
      add(defensePlayerStats[rebounder.name], "DREB");
      add(defenseTeamStats, "DREB");
    }
    if (trace) trace.summary = `${offense.shortName} ${shotTaker.name} missed ${shotZoneLabel(shotZone)}`;
    return;
  }
}

function finalizePlayerStats(stats: Record<string, StatLine>): void {
  for (const playerStats of Object.values(stats)) {
    playerStats.REB = (playerStats.OREB ?? 0) + (playerStats.DREB ?? 0);
  }
}

function finalizeTeamStats(stats: StatLine): void {
  stats.REB = (stats.OREB ?? 0) + (stats.DREB ?? 0);
}

function clonePlayerStats(stats: Record<string, StatLine>): Record<string, StatLine> {
  return Object.fromEntries(
    Object.entries(stats).map(([player, line]) => [
      player,
      {
        ...line,
        REB: (line.OREB ?? 0) + (line.DREB ?? 0)
      }
    ])
  );
}

function cloneTeamStats(stats: StatLine): StatLine {
  return {
    ...stats,
    REB: (stats.OREB ?? 0) + (stats.DREB ?? 0)
  };
}

function liveResultSnapshot({
  seed,
  away,
  home,
  matchup,
  completedQuarters,
  awayTeamStats,
  homeTeamStats,
  awayPlayerStats,
  homePlayerStats,
  availabilityEvents,
  model,
  playedAt
}: {
  seed: number;
  away: DiceTeamCard;
  home: DiceTeamCard;
  matchup: MatchupCard;
  completedQuarters: Array<{ away: number; home: number }>;
  awayTeamStats: StatLine;
  homeTeamStats: StatLine;
  awayPlayerStats: Record<string, StatLine>;
  homePlayerStats: Record<string, StatLine>;
  availabilityEvents: NonNullable<GameResult["playerAvailabilityEvents"]>;
  model: GameModelMetadata;
  playedAt: string;
}): GameResult {
  const liveAwayTeamStats = cloneTeamStats(awayTeamStats);
  const liveHomeTeamStats = cloneTeamStats(homeTeamStats);
  const awayScore = liveAwayTeamStats.PTS ?? 0;
  const homeScore = liveHomeTeamStats.PTS ?? 0;
  const completedAwayScore = completedQuarters.reduce((sum, quarter) => sum + quarter.away, 0);
  const completedHomeScore = completedQuarters.reduce((sum, quarter) => sum + quarter.home, 0);
  const liveQuarter = {
    away: awayScore - completedAwayScore,
    home: homeScore - completedHomeScore
  };

  return {
    id: `live-${seed}-${away.id}-at-${home.id}`,
    awayTeamId: away.id,
    homeTeamId: home.id,
    awayScore,
    homeScore,
    winnerTeamId: awayScore === homeScore ? "tie" : awayScore > homeScore ? away.id : home.id,
    possessionsEach: matchup.possessionsEach,
    quarters: [...completedQuarters.map((quarter) => ({ ...quarter })), liveQuarter],
    teamStats: {
      [away.id]: liveAwayTeamStats,
      [home.id]: liveHomeTeamStats
    },
    playerStats: {
      [away.id]: clonePlayerStats(awayPlayerStats),
      [home.id]: clonePlayerStats(homePlayerStats)
    },
    playerAvailabilityEvents: availabilityEvents.length ? availabilityEvents.map((event) => ({ ...event })) : undefined,
    model,
    source: "simulated",
    playedAt
  };
}

function periodLabel(periodIndex: number): string {
  return periodIndex < 4 ? `Q${periodIndex + 1}` : `OT${periodIndex - 3}`;
}

function simulateGameInternal(
  away: DiceTeamCard,
  home: DiceTeamCard,
  seed: number,
  source: "simulated" | "manual",
  options: Partial<SimulationOptions>,
  collectTrace: boolean
): TracedGameResult {
  const rng = new SeededRandom(seed);
  const matchup = buildMatchupCard(away, home, options);
  const matchupOptions = matchup.options;
  const model = gameModelMetadata(matchup);
  const availability = createGameAvailabilityState(away, home, options);
  const awayTeamStats = emptyTeamStats();
  const homeTeamStats = emptyTeamStats();
  const awayPlayerStats = emptyPlayerStats(away);
  const homePlayerStats = emptyPlayerStats(home);
  const quarters: Array<{ away: number; home: number }> = [];
  const possessions: PossessionTrace[] = [];
  const playedAt = new Date().toISOString();
  let possessionNumber = 0;

  const playPossession = (
    periodIndex: number,
    possessionInPeriod: number,
    side: "away" | "home",
    offense: DiceTeamCard,
    defense: DiceTeamCard,
    offenseStatic: TeamMatchupStatic,
    offensePlayerStats: Record<string, StatLine>,
    defensePlayerStats: Record<string, StatLine>,
    offenseTeamStats: StatLine,
    defenseTeamStats: StatLine
  ) => {
    const offensePointsBefore = offenseTeamStats.PTS;
    const trace: PossessionTrace | undefined = collectTrace
      ? {
          id: `${periodLabel(periodIndex)}-${possessionInPeriod + 1}-${side}`,
          periodIndex,
          periodLabel: periodLabel(periodIndex),
          possessionNumber: possessionNumber + 1,
          side,
          offenseTeamId: offense.id,
          defenseTeamId: defense.id,
          startScore: {
            away: awayTeamStats.PTS,
            home: homeTeamStats.PTS
          },
          endScore: {
            away: awayTeamStats.PTS,
            home: homeTeamStats.PTS
          },
          points: 0,
          summary: "",
          steps: []
        }
      : undefined;

    possessionNumber += 1;
    resolvePossession(
      offense,
      defense,
      offenseStatic,
      matchupOptions,
      matchup.eraContext,
      offensePlayerStats,
      defensePlayerStats,
      offenseTeamStats,
      defenseTeamStats,
      rng,
      availability,
      trace
    );

    if (trace) {
      trace.endScore = {
        away: awayTeamStats.PTS,
        home: homeTeamStats.PTS
      };
      trace.points = offenseTeamStats.PTS - offensePointsBefore;
      trace.summary ||= `${offense.shortName} possession`;
      trace.liveResult = liveResultSnapshot({
        seed,
        away,
        home,
        matchup,
        completedQuarters: quarters,
        awayTeamStats,
        homeTeamStats,
        awayPlayerStats,
        homePlayerStats,
        availabilityEvents: availability.events,
        model,
        playedAt
      });
      possessions.push(trace);
    }
  };

  for (let periodIndex = 0; periodIndex < matchup.quarters.length; periodIndex += 1) {
    const periodPossessions = matchup.quarters[periodIndex];
    const awayBefore = awayTeamStats.PTS;
    const homeBefore = homeTeamStats.PTS;
    for (let possession = 0; possession < periodPossessions; possession += 1) {
      playPossession(periodIndex, possession, "away", away, home, matchup.awayStatic, awayPlayerStats, homePlayerStats, awayTeamStats, homeTeamStats);
      playPossession(periodIndex, possession, "home", home, away, matchup.homeStatic, homePlayerStats, awayPlayerStats, homeTeamStats, awayTeamStats);
    }
    quarters.push({
      away: awayTeamStats.PTS - awayBefore,
      home: homeTeamStats.PTS - homeBefore
    });
  }

  let overtimePeriods = 0;
  while (awayTeamStats.PTS === homeTeamStats.PTS && overtimePeriods < simParams.maxOvertimePeriods) {
    const periodIndex = 4 + overtimePeriods;
    const awayBefore = awayTeamStats.PTS;
    const homeBefore = homeTeamStats.PTS;
    for (let possession = 0; possession < matchup.overtimePossessionsEach; possession += 1) {
      playPossession(periodIndex, possession, "away", away, home, matchup.awayStatic, awayPlayerStats, homePlayerStats, awayTeamStats, homeTeamStats);
      playPossession(periodIndex, possession, "home", home, away, matchup.homeStatic, homePlayerStats, awayPlayerStats, homeTeamStats, awayTeamStats);
    }
    quarters.push({
      away: awayTeamStats.PTS - awayBefore,
      home: homeTeamStats.PTS - homeBefore
    });
    overtimePeriods += 1;
  }

  if (awayTeamStats.PTS === homeTeamStats.PTS) {
    throw new Error(`Game remained tied after ${simParams.maxOvertimePeriods} overtime periods: ${away.id} at ${home.id}.`);
  }

  finalizePlayerStats(awayPlayerStats);
  finalizePlayerStats(homePlayerStats);
  finalizeTeamStats(awayTeamStats);
  finalizeTeamStats(homeTeamStats);

  const winnerTeamId = awayTeamStats.PTS > homeTeamStats.PTS ? away.id : homeTeamStats.PTS > awayTeamStats.PTS ? home.id : "tie";

  const result = {
    id: `game-${seed}-${away.id}-at-${home.id}`,
    awayTeamId: away.id,
    homeTeamId: home.id,
    awayScore: awayTeamStats.PTS,
    homeScore: homeTeamStats.PTS,
    winnerTeamId,
    possessionsEach: matchup.possessionsEach,
    quarters,
    teamStats: {
      [away.id]: awayTeamStats,
      [home.id]: homeTeamStats
    },
    playerStats: {
      [away.id]: awayPlayerStats,
      [home.id]: homePlayerStats
    },
    playerAvailabilityEvents: availability.events.length ? availability.events : undefined,
    model,
    source,
    playedAt
  };

  return {
    seed,
    result,
    possessions
  };
}

export function simulateGame(
  away: DiceTeamCard,
  home: DiceTeamCard,
  seed = Date.now(),
  source: "simulated" | "manual" = "simulated",
  options: Partial<SimulationOptions> = defaultMatchupOptions
): GameResult {
  return simulateGameInternal(away, home, seed, source, options, false).result;
}

export function simulateTracedGame(
  away: DiceTeamCard,
  home: DiceTeamCard,
  seed = Date.now(),
  options: Partial<SimulationOptions> = defaultMatchupOptions
): TracedGameResult {
  return simulateGameInternal(away, home, seed, "simulated", options, true);
}

export function summarizeSimulations(
  away: DiceTeamCard,
  home: DiceTeamCard,
  games: number,
  seed = Date.now(),
  options: Partial<SimulationOptions> = defaultMatchupOptions
) {
  const rng = new SeededRandom(seed);
  const teamTotals: Record<string, StatLine[]> = { [away.id]: [], [home.id]: [] };
  const playerTotals: Record<string, Record<string, StatLine[]>> = { [away.id]: {}, [home.id]: {} };
  const wins: Record<string, number> = { [away.id]: 0, [home.id]: 0, tie: 0 };
  let overtimeGames = 0;

  for (let index = 0; index < games; index += 1) {
    const result = simulateGame(away, home, rng.pickSeed(), "simulated", options);
    if (result.quarters.length > 4) overtimeGames += 1;
    wins[result.winnerTeamId] = (wins[result.winnerTeamId] ?? 0) + 1;
    for (const team of [away, home]) {
      teamTotals[team.id].push(result.teamStats[team.id]);
      for (const [player, line] of Object.entries(result.playerStats[team.id])) {
        playerTotals[team.id][player] ??= [];
        playerTotals[team.id][player].push(line);
      }
    }
  }

  const averageLine = (lines: StatLine[]) => {
    const out: StatLine = {};
    for (const field of [...statFields, ...teamExtraStatFields]) {
      out[field] = lines.reduce((sum, line) => sum + (line[field] ?? 0), 0) / Math.max(1, lines.length);
    }
    return out;
  };

  return {
    games,
    wins,
    overtimeGames,
    teams: {
      [away.id]: averageLine(teamTotals[away.id]),
      [home.id]: averageLine(teamTotals[home.id])
    },
    players: Object.fromEntries(
      [away, home].map((team) => [
        team.id,
        Object.fromEntries(Object.entries(playerTotals[team.id]).map(([player, lines]) => [player, averageLine(lines)]))
      ])
    ) as Record<string, Record<string, StatLine>>
  };
}

export function createManualResult(
  away: DiceTeamCard,
  home: DiceTeamCard,
  awayScore: number,
  homeScore: number,
  options: Partial<MatchupOptions> = defaultMatchupOptions
): GameResult {
  if (awayScore === homeScore) {
    throw new Error("Final scores cannot be tied. Play overtime and enter the resolved final score.");
  }
  const awayStats = emptyTeamStats();
  const homeStats = emptyTeamStats();
  const matchup = buildMatchupCard(away, home, options);
  const model = gameModelMetadata(matchup);
  awayStats.PTS = awayScore;
  homeStats.PTS = homeScore;
  return {
    id: `manual-${Date.now()}-${away.id}-at-${home.id}`,
    awayTeamId: away.id,
    homeTeamId: home.id,
    awayScore,
    homeScore,
    winnerTeamId: awayScore > homeScore ? away.id : homeScore > awayScore ? home.id : "tie",
    possessionsEach: matchup.possessionsEach,
    quarters: [],
    teamStats: {
      [away.id]: awayStats,
      [home.id]: homeStats
    },
    playerStats: {
      [away.id]: emptyPlayerStats(away),
      [home.id]: emptyPlayerStats(home)
    },
    model,
    source: "manual",
    playedAt: new Date().toISOString()
  };
}
