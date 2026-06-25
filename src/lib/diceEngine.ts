import type {
  AssignmentEvent,
  DicePlayerCard,
  DiceTeamCard,
  GameResult,
  MatchupContext,
  MatchupCard,
  MatchupOptions,
  PlayerRangeRow,
  RangeRow,
  ShotLocationProfileMethod,
  ShotZone,
  SourcePlayer,
  SourceShotLocationProfile,
  SourcePlayerPostseasonProfile,
  StatLine,
  TeamMatchupStatic
} from "./types";
import { SeededRandom } from "./random";
import { calibration as cardCalibration } from "./teamCards";

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
  eraTalentShotMakeScale: 0.35,
  eraTalentTurnoverScale: 0.1,
  eraTalentReboundScale: 0.1,
  overtimeMinutes: 5,
  maxOvertimePeriods: 20
};

export const defaultMatchupOptions: MatchupOptions = {
  venue: "home-court",
  intensity: "regular"
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

const matchupProfileCache = new Map<string, MatchupPlayerProfile>();
const matchupActionProfileCache = new Map<string, MatchupActionProfile>();

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function pctRoll(rng: SeededRandom, chance: number): boolean {
  return rng.next() * 100 < chance;
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
    intensity: intensity === "playoff" ? "playoff" : "regular"
  };
}

function contextLabel(options: MatchupOptions): string {
  const venue = options.venue === "neutral" ? "Neutral court" : "Home court";
  const intensity = options.intensity === "playoff" ? "playoff intensity" : "regular season";
  return `${venue}, ${intensity}`;
}

function matchupContextRules(options: MatchupOptions): MatchupContext {
  const homeCourt = options.venue === "home-court";
  const playoff = options.intensity === "playoff";
  return {
    label: contextLabel(options),
    venue: options.venue,
    intensity: options.intensity,
    homeCourtAdvantagePoints: homeCourt ? simParams.homeCourtAdvantagePoints : 0,
    awayShotContextAdjustment: homeCourt ? -simParams.homeCourtShotAdjustment : 0,
    homeShotContextAdjustment: homeCourt ? simParams.homeCourtShotAdjustment : 0,
    paceMultiplier: playoff ? simParams.playoffPaceMultiplier : 1,
    useWeightMode: playoff ? "playoff-tightened" : "regular"
  };
}

function contextCacheKey(options: MatchupOptions): string {
  return `${options.venue}|${options.intensity}`;
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

function matchupContext(offense: DiceTeamCard, defense: DiceTeamCard): DiceTeamCard["calibration"]["leagueAverages"] {
  const offenseContext = offense.calibration.leagueAverages;
  const defenseContext = defense.calibration.leagueAverages;
  return Object.fromEntries(
    (Object.keys(offenseContext) as Array<keyof typeof offenseContext>).map((key) => [key, (offenseContext[key] + defenseContext[key]) / 2])
  ) as DiceTeamCard["calibration"]["leagueAverages"];
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
  return options.intensity === "playoff" && player.source.postseason ? player.source.postseason : player.source;
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
  return hasCompleteLocationProfile(postseasonProfile) ? postseasonProfile : null;
}

function matchupShotZoneProfile(
  player: DicePlayerCard,
  p2: number,
  p3: number,
  profileSource: PlayerStatProfile
): Pick<MatchupPlayerProfile, "shotProfile" | "shotProfileMethod" | "shotProfileConfidence" | "twoZoneShares" | "shotMakes"> {
  const shooting = postseasonShotLocationProfile(player, profileSource) ?? player.source.shotLocationProfile;
  if (!hasCompleteLocationProfile(shooting)) {
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
  player: DicePlayerCard,
  rawPlayerRate = player.calibration.rawThreeRate
): number {
  if (rawPlayerRate === 0) return 0;
  const context = matchupContext(offense, defense);
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
  player: DicePlayerCard,
  playerFtaPerFga = player.calibration.rawFreeThrowAttemptRate
): number {
  const context = matchupContext(offense, defense);
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
  options: MatchupOptions
): MatchupPlayerProfile {
  const cacheKey = `${offense.id}|${defense.id}|${player.id}|${contextCacheKey(options)}`;
  const cached = matchupProfileCache.get(cacheKey);
  if (cached) return cached;

  const context = matchupContext(offense, defense);
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
    fd: clamp(matchupFreeThrowAttemptRate(offense, defense, player, profileFtaRate) * 39, 0, 22),
    threeFrequency: clamp(matchupThreeRate(offense, defense, player, rawThreeRate) * 100, 0, 95),
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

function matchupThreeAttemptTarget(offense: DiceTeamCard, defense: DiceTeamCard): number {
  const context = matchupContext(offense, defense);
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

function contextualUseWeight(team: DiceTeamCard, player: DicePlayerCard, options: MatchupOptions): number {
  const useWeight = baseUseWeight(player, options);
  if (options.intensity !== "playoff") return useWeight;
  const averageUse = team.players.reduce((sum, teammate) => sum + baseUseWeight(teammate, options), 0) / Math.max(1, team.players.length);
  if (averageUse <= 0) return useWeight;
  const relativeUse = Math.max(0.1, useWeight / averageUse);
  const multiplier = clamp(
    relativeUse ** simParams.playoffUseExponent,
    simParams.playoffUseMinMultiplier,
    simParams.playoffUseMaxMultiplier
  );
  return useWeight * multiplier;
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

function matchupActionProfile(offense: DiceTeamCard, defense: DiceTeamCard, options: MatchupOptions): MatchupActionProfile {
  const cacheKey = `${offense.id}|${defense.id}|${contextCacheKey(options)}`;
  const cached = matchupActionProfileCache.get(cacheKey);
  if (cached) return cached;

  const offenseRates = offenseSourceActionRates(offense);
  const defenseAllowedRates = opponentAllowedActionRates(defense);
  const talent = eraTalentAdjustment(offense, defense);
  const turnoverTargetChance = clamp(
    blendOffenseDefenseRate(offense, defense, offenseRates.turnover, defenseAllowedRates.turnover) + talent.turnoverAdjustment,
    0,
    40
  );
  const foulDrawTargetChance = clamp(
    blendOffenseDefenseRate(offense, defense, offenseRates.foulDraw, defenseAllowedRates.foulDraw),
    0,
    40
  );
  const threeAttemptTargetChance = matchupThreeAttemptTarget(offense, defense);
  const baseTurnover = useWeightedAverage(offense, options, (player) =>
    baseTurnoverChance(offense, defense, matchupPlayerProfile(offense, defense, player, options))
  );
  const baseFoulDraw = useWeightedAverage(offense, options, (player) =>
    baseFoulDrawChance(offense, defense, matchupPlayerProfile(offense, defense, player, options))
  );
  const baseThreeAttempt = useWeightedAverage(offense, options, (player) =>
    baseThreeAttemptChance(offense, matchupPlayerProfile(offense, defense, player, options))
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

function effectiveTurnoverChance(offense: DiceTeamCard, defense: DiceTeamCard, options: MatchupOptions, profile: MatchupPlayerProfile): number {
  return clamp(baseTurnoverChance(offense, defense, profile) * matchupActionProfile(offense, defense, options).turnoverScale, 0, 40);
}

function effectiveFoulDrawChance(offense: DiceTeamCard, defense: DiceTeamCard, options: MatchupOptions, profile: MatchupPlayerProfile): number {
  return clamp(baseFoulDrawChance(offense, defense, profile) * matchupActionProfile(offense, defense, options).foulDrawScale, 0, 40);
}

function effectiveThreeAttemptChance(offense: DiceTeamCard, defense: DiceTeamCard, options: MatchupOptions, profile: MatchupPlayerProfile): number {
  return clamp(baseThreeAttemptChance(offense, profile) * matchupActionProfile(offense, defense, options).threeAttemptScale, 0, 95);
}

function effectiveShotZoneChances(offense: DiceTeamCard, defense: DiceTeamCard, options: MatchupOptions, profile: MatchupPlayerProfile): Record<ShotZone, number> {
  const three = effectiveThreeAttemptChance(offense, defense, options, profile);
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

function teamShotZoneMix(offense: DiceTeamCard, defense: DiceTeamCard, options: MatchupOptions): Record<ShotZone, number> {
  const totalWeight = offense.players.reduce((sum, player) => sum + contextualUseWeight(offense, player, options), 0);
  if (totalWeight <= 0) {
    throw new Error(`${offense.id} has no positive player use weights.`);
  }
  const mix = emptyShotZoneRecord();
  for (const player of offense.players) {
    const profile = matchupPlayerProfile(offense, defense, player, options);
    const chances = effectiveShotZoneChances(offense, defense, options, profile);
    const weight = contextualUseWeight(offense, player, options) / totalWeight;
    for (const zone of shotZones) {
      mix[zone] += chances[zone] * weight;
    }
  }
  return normalizeShotZoneChances(mix);
}

function matchupOffensiveReboundChances(offense: DiceTeamCard, defense: DiceTeamCard, options: MatchupOptions): Record<ShotZone, number> {
  const talent = eraTalentAdjustment(offense, defense);
  const base = clamp(matchupOffensiveReboundChance(offense, defense) + talent.reboundAdjustment, 5, 45);
  const mix = teamShotZoneMix(offense, defense, options);
  const weightedMultiplier = shotZones.reduce((sum, zone) => sum + (mix[zone] / 100) * shotZoneOrbMultipliers[zone], 0);
  if (weightedMultiplier <= 0) {
    throw new Error(`${offense.id} at ${defense.id} has invalid shot-zone rebound weights.`);
  }
  return Object.fromEntries(
    shotZones.map((zone) => [zone, clamp((base * shotZoneOrbMultipliers[zone]) / weightedMultiplier, 5, 45)])
  ) as Record<ShotZone, number>;
}

function chooseShotZone(chances: Record<ShotZone, number>, rng: SeededRandom): ShotZone {
  let roll = rng.next() * 100;
  for (const zone of shotZones) {
    roll -= chances[zone];
    if (roll <= 0) return zone;
  }
  return "three";
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

function sideStatic(offense: DiceTeamCard, defense: DiceTeamCard, options: MatchupOptions, contextShotAdjustment: number): TeamMatchupStatic {
  const defAdj = defenseShotAdjustment(defense.defense);
  const talent = eraTalentAdjustment(offense, defense);
  const orbChance = clamp(matchupOffensiveReboundChance(offense, defense) + talent.reboundAdjustment, 5, 45);
  const orbByShotZone = matchupOffensiveReboundChances(offense, defense, options);
  const blockChance = clamp(simParams.blockBase + defense.defense, 0, 40);
  const astMade2 = clamp(offense.assistMade2 + simParams.astMod, 0, 95);
  const astMade3 = clamp(offense.assistMade3 + simParams.astMod, 0, 95);
  const actionProfile = matchupActionProfile(offense, defense, options);
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
  contextShotAdjustment = 0
): PlayerRangeRow[] {
  const matchupOptions = normalizeMatchupOptions(options);
  const uses = useRangeMap(offense, matchupOptions);
  const defAdj = defenseShotAdjustment(defense.defense);
  const talent = eraTalentAdjustment(offense, defense);
  const playoffLeverage = playoffLeverageShotAdjustment(offense, defense, matchupOptions);
  const totalShotAdjustment = offense.shotQuality - defAdj + simParams.globalShotMod + contextShotAdjustment + playoffLeverage + talent.shotMakeAdjustment;

  return offense.players.map((player) => {
    const profile = matchupPlayerProfile(offense, defense, player, matchupOptions);
    const tov = effectiveTurnoverChance(offense, defense, matchupOptions, profile);
    const fd = effectiveFoulDrawChance(offense, defense, matchupOptions, profile);
    const shotZoneChances = effectiveShotZoneChances(offense, defense, matchupOptions, profile);
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
  const matchupOptions = normalizeMatchupOptions(options);
  const context = matchupContextRules(matchupOptions);
  const possessionsEach = Math.round(((away.pace + home.pace) / 2) * context.paceMultiplier);
  const events: AssignmentEvent[] = ["Use", "AST", "OREB", "DREB", "STL", "BLK", "PF", "ShootingPF"];

  return {
    away,
    home,
    options: matchupOptions,
    context,
    possessionsEach,
    quarters: quarterSplit(possessionsEach),
    overtimePossessionsEach: overtimePossessionsEach(possessionsEach),
    looseFoulRange: nRange(simParams.nonshootFoulChance),
    stealOnTurnoverRange: nRange(simParams.stealTurnoverPct),
    awayStatic: sideStatic(away, home, matchupOptions, context.awayShotContextAdjustment),
    homeStatic: sideStatic(home, away, matchupOptions, context.homeShotContextAdjustment),
    awayPlayerRanges: playerRanges(away, home, matchupOptions, context.awayShotContextAdjustment),
    homePlayerRanges: playerRanges(home, away, matchupOptions, context.homeShotContextAdjustment),
    assignments: {
      [away.id]: Object.fromEntries(events.map((event) => [event, assignmentRows(away, event, matchupOptions)])) as Record<AssignmentEvent, RangeRow[]>,
      [home.id]: Object.fromEntries(events.map((event) => [event, assignmentRows(home, event, matchupOptions)])) as Record<AssignmentEvent, RangeRow[]>
    }
  };
}

function weightedChoice(team: DiceTeamCard, event: AssignmentEvent, options: MatchupOptions, rng: SeededRandom, excludeName = ""): DicePlayerCard | undefined {
  const items = team.players
    .filter((player) => player.name !== excludeName)
    .map((player) => ({ player, weight: assignmentWeight(team, player, event, options) }))
    .filter((item) => item.weight > 0);
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) return undefined;

  let roll = rng.next() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return item.player;
  }
  return items.at(-1)?.player;
}

function selectOffensivePlayer(team: DiceTeamCard, options: MatchupOptions, rng: SeededRandom): DicePlayerCard {
  const total = team.players.reduce((sum, player) => sum + contextualUseWeight(team, player, options), 0);
  let roll = rng.next() * total;
  for (const player of team.players) {
    roll -= contextualUseWeight(team, player, options);
    if (roll <= 0) return player;
  }
  return team.players.at(-1) as DicePlayerCard;
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

function resolvePossession(
  offense: DiceTeamCard,
  defense: DiceTeamCard,
  offenseStatic: TeamMatchupStatic,
  options: MatchupOptions,
  offensePlayerStats: Record<string, StatLine>,
  defensePlayerStats: Record<string, StatLine>,
  offenseTeamStats: StatLine,
  defenseTeamStats: StatLine,
  rng: SeededRandom
): void {
  add(offenseTeamStats, "poss");
  let extensions = 0;

  while (true) {
    if (simParams.nonshootFoulChance > 0 && pctRoll(rng, simParams.nonshootFoulChance)) {
      const fouler = weightedChoice(defense, "PF", options, rng);
      if (fouler) {
        add(defensePlayerStats[fouler.name], "PF");
        add(defenseTeamStats, "PF");
        add(offenseTeamStats, "nonshooting_fouls_drawn");
      }
    }

    const shooter = selectOffensivePlayer(offense, options, rng);
    const shooterProfile = matchupPlayerProfile(offense, defense, shooter, options);
    const effectiveTov = effectiveTurnoverChance(offense, defense, options, shooterProfile);
    const effectiveFd = effectiveFoulDrawChance(offense, defense, options, shooterProfile);
    const actionRoll = rng.next() * 100;

    if (actionRoll < effectiveTov) {
      add(offensePlayerStats[shooter.name], "TOV");
      add(offenseTeamStats, "TOV");
      if (pctRoll(rng, shooterProfile.offensiveFoulTurnoverChance)) {
        add(offensePlayerStats[shooter.name], "PF");
        add(offenseTeamStats, "PF");
        return;
      }
      if (pctRoll(rng, shooterProfile.liveBallTurnoverChance)) {
        const stealer = weightedChoice(defense, "STL", options, rng);
        if (stealer) {
          add(defensePlayerStats[stealer.name], "STL");
          add(defenseTeamStats, "STL");
        }
      }
      return;
    }

    if (actionRoll < effectiveTov + effectiveFd) {
      const fouler = weightedChoice(defense, "ShootingPF", options, rng);
      if (fouler) {
        add(defensePlayerStats[fouler.name], "PF");
        add(defenseTeamStats, "PF");
      }
      for (let shot = 0; shot < 2; shot += 1) {
        add(offensePlayerStats[shooter.name], "FTA");
        add(offenseTeamStats, "FTA");
        if (pctRoll(rng, shooterProfile.ft)) {
          add(offensePlayerStats[shooter.name], "FTM");
          add(offensePlayerStats[shooter.name], "PTS");
          add(offenseTeamStats, "FTM");
          add(offenseTeamStats, "PTS");
        }
      }

      if (pctRoll(rng, foulEndsPossessionChance(offense))) {
        return;
      }
      add(offenseTeamStats, "continuation_fouls_drawn");
    }

    const shotTaker = actionRoll < effectiveTov + effectiveFd ? selectOffensivePlayer(offense, options, rng) : shooter;
    const shotProfile = shotTaker.id === shooter.id ? shooterProfile : matchupPlayerProfile(offense, defense, shotTaker, options);
    const shotZone = chooseShotZone(effectiveShotZoneChances(offense, defense, options, shotProfile), rng);
    const isThree = shotZone === "three";
    const makeNumber = clamp(shotProfile.shotMakes[shotZone] + offenseStatic.totalShotAdjustment, 1, 99);

    add(offensePlayerStats[shotTaker.name], "FGA");
    add(offenseTeamStats, "FGA");
    if (isThree) {
      add(offensePlayerStats[shotTaker.name], "3PA");
      add(offenseTeamStats, "3PA");
    }

    if (pctRoll(rng, makeNumber)) {
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
      if (pctRoll(rng, clamp(assistChance + simParams.astMod, 0, 95))) {
        const passer = weightedChoice(offense, "AST", options, rng, shotTaker.name);
        if (passer) {
          add(offensePlayerStats[passer.name], "AST");
          add(offenseTeamStats, "AST");
        }
      }
      if (pctRoll(rng, shotProfile.andOneChance)) {
        const fouler = weightedChoice(defense, "ShootingPF", options, rng);
        if (fouler) {
          add(defensePlayerStats[fouler.name], "PF");
          add(defenseTeamStats, "PF");
        }
        add(offensePlayerStats[shotTaker.name], "FTA");
        add(offenseTeamStats, "FTA");
        if (pctRoll(rng, shotProfile.ft)) {
          add(offensePlayerStats[shotTaker.name], "FTM");
          add(offensePlayerStats[shotTaker.name], "PTS");
          add(offenseTeamStats, "FTM");
          add(offenseTeamStats, "PTS");
        }
      }
      return;
    }

    if (!isThree && pctRoll(rng, clamp(simParams.blockBase + defense.defense, 0, 40))) {
      const blocker = weightedChoice(defense, "BLK", options, rng);
      if (blocker) {
        add(defensePlayerStats[blocker.name], "BLK");
        add(defenseTeamStats, "BLK");
      }
    }

    const orbChance = offenseStatic.orbByShotZone[shotZone];
    if (pctRoll(rng, orbChance) && extensions < simParams.maxOrbExtensions) {
      const rebounder = weightedChoice(offense, "OREB", options, rng);
      if (rebounder) {
        add(offensePlayerStats[rebounder.name], "OREB");
        add(offenseTeamStats, "OREB");
      }
      extensions += 1;
      continue;
    }

    const rebounder = weightedChoice(defense, "DREB", options, rng);
    if (rebounder) {
      add(defensePlayerStats[rebounder.name], "DREB");
      add(defenseTeamStats, "DREB");
    }
    return;
  }
}

function finalizePlayerStats(stats: Record<string, StatLine>): void {
  for (const playerStats of Object.values(stats)) {
    playerStats.REB = (playerStats.OREB ?? 0) + (playerStats.DREB ?? 0);
  }
}

export function simulateGame(
  away: DiceTeamCard,
  home: DiceTeamCard,
  seed = Date.now(),
  source: "simulated" | "manual" = "simulated",
  options: Partial<MatchupOptions> = defaultMatchupOptions
): GameResult {
  const rng = new SeededRandom(seed);
  const matchupOptions = normalizeMatchupOptions(options);
  const matchup = buildMatchupCard(away, home, matchupOptions);
  const awayTeamStats = emptyTeamStats();
  const homeTeamStats = emptyTeamStats();
  const awayPlayerStats = emptyPlayerStats(away);
  const homePlayerStats = emptyPlayerStats(home);
  const quarters: Array<{ away: number; home: number }> = [];

  for (const possessions of matchup.quarters) {
    const awayBefore = awayTeamStats.PTS;
    const homeBefore = homeTeamStats.PTS;
    for (let possession = 0; possession < possessions; possession += 1) {
      resolvePossession(away, home, matchup.awayStatic, matchupOptions, awayPlayerStats, homePlayerStats, awayTeamStats, homeTeamStats, rng);
      resolvePossession(home, away, matchup.homeStatic, matchupOptions, homePlayerStats, awayPlayerStats, homeTeamStats, awayTeamStats, rng);
    }
    quarters.push({
      away: awayTeamStats.PTS - awayBefore,
      home: homeTeamStats.PTS - homeBefore
    });
  }

  let overtimePeriods = 0;
  while (awayTeamStats.PTS === homeTeamStats.PTS && overtimePeriods < simParams.maxOvertimePeriods) {
    const awayBefore = awayTeamStats.PTS;
    const homeBefore = homeTeamStats.PTS;
    for (let possession = 0; possession < matchup.overtimePossessionsEach; possession += 1) {
      resolvePossession(away, home, matchup.awayStatic, matchupOptions, awayPlayerStats, homePlayerStats, awayTeamStats, homeTeamStats, rng);
      resolvePossession(home, away, matchup.homeStatic, matchupOptions, homePlayerStats, awayPlayerStats, homeTeamStats, awayTeamStats, rng);
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

  const winnerTeamId = awayTeamStats.PTS > homeTeamStats.PTS ? away.id : homeTeamStats.PTS > awayTeamStats.PTS ? home.id : "tie";

  return {
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
    source,
    playedAt: new Date().toISOString()
  };
}

export function summarizeSimulations(
  away: DiceTeamCard,
  home: DiceTeamCard,
  games: number,
  seed = Date.now(),
  options: Partial<MatchupOptions> = defaultMatchupOptions
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
    source: "manual",
    playedAt: new Date().toISOString()
  };
}
