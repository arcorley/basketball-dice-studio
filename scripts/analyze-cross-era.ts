import fs from "node:fs";
import path from "node:path";
import {
  buildExpectedMatchupLine,
  buildMatchupCard,
  clearMatchupCaches,
  crossEraModelVersion,
  simParams,
  summarizeSimulations
} from "../src/lib/diceEngine";
import { SeededRandom } from "../src/lib/random";
import { calibration as cardCalibration } from "../src/lib/teamCards";
import type { DiceTeamCard, EraContextMode, ExpectedTeamLine, MatchupOptions, StatLine } from "../src/lib/types";
import { getDiceTeams } from "./sourceDataStatic";

type Bucket = {
  label: string;
  minGap: number;
  maxGap: number;
  pairs: PairResult[];
};

type PairResult = {
  newerId: string;
  olderId: string;
  newer: string;
  older: string;
  newerSeason: number;
  olderSeason: number;
  gap: number;
  games: number;
  newerWins: number;
  olderWins: number;
  newerWinRate: number;
  newerAvgMargin: number;
  expectedNewerAvgMargin: number;
  simMinusExpectedMargin: number;
  cardPowerDelta: number;
  srsDelta: number;
  talentDelta: number;
  eraContextMode: EraContextMode;
  eraContextSeason: number | null;
  eraContextBlend: number;
  eraContextPace: number;
  newerShotTalentAdjustment: number;
  olderShotTalentAdjustment: number;
  totalShotAdjustmentDelta: number;
  turnoverTargetDelta: number;
  foulDrawTargetDelta: number;
  threeAttemptTargetDelta: number;
  orbChanceDelta: number;
  metrics: {
    newer: TeamMetricResult;
    older: TeamMetricResult;
    bias: TeamBoxMetrics;
    expectedBias: TeamBoxMetrics;
    simMinusExpectedBias: TeamBoxMetrics;
  };
};

type TeamBoxMetrics = {
  pts: number;
  fga: number;
  fgPct: number;
  threePa: number;
  threePct: number;
  fta: number;
  ftPct: number;
  tov: number;
  orb: number;
  poss: number;
};

type TeamMetricResult = {
  sim: TeamBoxMetrics;
  expected: TeamBoxMetrics;
  source: TeamBoxMetrics;
  delta: TeamBoxMetrics;
  expectedDelta: TeamBoxMetrics;
  simMinusExpected: TeamBoxMetrics;
  absDelta: TeamBoxMetrics;
  absExpectedDelta: TeamBoxMetrics;
  absSimMinusExpected: TeamBoxMetrics;
};

type Aggregate = {
  label: string;
  pairCount: number;
  gameCount: number;
  newerWinRate: number;
  newerAvgMargin: number;
  avgExpectedNewerMargin: number;
  avgSimMinusExpectedMargin: number;
  avgGap: number;
  avgCardPowerDelta: number;
  avgSrsDelta: number;
  avgTalentDelta: number;
  avgTotalShotAdjustmentDelta: number;
  avgTurnoverTargetDelta: number;
  avgFoulDrawTargetDelta: number;
  avgThreeAttemptTargetDelta: number;
  avgOrbChanceDelta: number;
  metrics: {
    newer: TeamMetricResult;
    older: TeamMetricResult;
    bias: TeamBoxMetrics;
    expectedBias: TeamBoxMetrics;
    simMinusExpectedBias: TeamBoxMetrics;
  };
};

type RegressionSummary = {
  label: string;
  observations: number;
  targetMean: number;
  predictors: string[];
  coefficients: Record<string, number>;
  rSquared: number;
};

const metricFields: Array<keyof TeamBoxMetrics> = ["pts", "fga", "fgPct", "threePa", "threePct", "fta", "ftPct", "tov", "orb", "poss"];

function parseEraContextMode(value: string | undefined): EraContextMode {
  const mode = value ?? "midpoint";
  switch (mode) {
    case "midpoint":
    case "away-era":
    case "home-era":
    case "older-era":
    case "newer-era":
    case "fixed-season":
    case "custom":
      return mode;
    default:
      throw new Error(
        "Invalid --era-context-mode. Use midpoint, away-era, home-era, older-era, newer-era, fixed-season, or custom."
      );
  }
}

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    return [key, value] as const;
  })
);

const seed = Number(args.get("seed") ?? 4242);
const pairsPerBucket = Number(args.get("pairs-per-bucket") ?? 160);
const gamesPerPair = Number(args.get("games-per-pair") ?? 40);
const eraTalentMode = args.get("era-talent") === "off" ? "off" : "on";
const styleRetentionMode = args.get("style-retention") === "off" ? "off" : "on";
const eraTalentShotScaleArg = args.get("era-talent-shot-scale");
const eraTalentTurnoverScaleArg = args.get("era-talent-turnover-scale");
const eraTalentReboundScaleArg = args.get("era-talent-rebound-scale");
const styleRetentionBoostArg = args.get("style-retention-boost");
const threeEraAdaptationArg = args.get("three-era-adaptation") ?? args.get("three-era");
const foulEraAdaptationArg = args.get("foul-era-adaptation") ?? args.get("foul-era");
const playerRelativeShootingDampeningArg = args.get("shooting-dampening");
const playerThreeRelativeDampeningArg = args.get("three-dampening");
const eraContextMode = parseEraContextMode(args.get("era-context-mode") ?? args.get("era-context"));
const eraContextBlendArg = args.get("era-context-blend") ?? args.get("era-blend");
const eraContextSeasonArg = args.get("era-context-season") ?? args.get("era-season");
const eraContextBlend = eraContextBlendArg === undefined ? undefined : Number(eraContextBlendArg);
const eraContextSeason = eraContextSeasonArg === undefined ? undefined : Number(eraContextSeasonArg);
const scaleSuffixes = [
  eraTalentMode === "off" ? "era-talent-off" : "",
  styleRetentionMode === "off" ? "style-retention-off" : "",
  eraTalentShotScaleArg !== undefined ? `shot-${eraTalentShotScaleArg}` : "",
  eraTalentTurnoverScaleArg !== undefined ? `tov-${eraTalentTurnoverScaleArg}` : "",
  eraTalentReboundScaleArg !== undefined ? `reb-${eraTalentReboundScaleArg}` : "",
  styleRetentionBoostArg !== undefined ? `style-${styleRetentionBoostArg}` : "",
  threeEraAdaptationArg !== undefined ? `three-era-${threeEraAdaptationArg}` : "",
  foulEraAdaptationArg !== undefined ? `foul-era-${foulEraAdaptationArg}` : "",
  playerRelativeShootingDampeningArg !== undefined ? `shoot-${playerRelativeShootingDampeningArg}` : "",
  playerThreeRelativeDampeningArg !== undefined ? `three-damp-${playerThreeRelativeDampeningArg}` : "",
  eraContextMode !== "midpoint" ? `era-${eraContextMode}` : "",
  eraContextBlendArg !== undefined ? `blend-${eraContextBlendArg}` : "",
  eraContextSeasonArg !== undefined ? `season-${eraContextSeasonArg}` : ""
].filter(Boolean);
const outputSuffix = scaleSuffixes.join("-");
const outputPath =
  args.get("output") ??
  path.join(
    process.cwd(),
    "reports",
    `cross-era-analysis-${pairsPerBucket}x${gamesPerPair}${outputSuffix ? `-${outputSuffix}` : ""}-seed-${seed}.json`
  );
const matchupOptions: MatchupOptions = {
  venue: args.get("venue") === "home-court" ? "home-court" : "neutral",
  intensity: args.get("intensity") === "playoff" ? "playoff" : "regular",
  eraContext: {
    mode: eraContextMode,
    ...(eraContextBlend === undefined ? {} : { blend: eraContextBlend }),
    ...(eraContextSeason === undefined ? {} : { seasonEndYear: eraContextSeason })
  }
};

if (eraTalentMode === "off") {
  simParams.eraTalentShotMakeScale = 0;
  simParams.eraTalentTurnoverScale = 0;
  simParams.eraTalentReboundScale = 0;
}
if (styleRetentionMode === "off") {
  simParams.crossEraStyleRetentionBoost = 0;
}
if (eraTalentShotScaleArg !== undefined) {
  simParams.eraTalentShotMakeScale = Number(eraTalentShotScaleArg);
}
if (eraTalentTurnoverScaleArg !== undefined) {
  simParams.eraTalentTurnoverScale = Number(eraTalentTurnoverScaleArg);
}
if (eraTalentReboundScaleArg !== undefined) {
  simParams.eraTalentReboundScale = Number(eraTalentReboundScaleArg);
}
if (styleRetentionBoostArg !== undefined) {
  simParams.crossEraStyleRetentionBoost = Number(styleRetentionBoostArg);
}
if (threeEraAdaptationArg !== undefined) {
  cardCalibration.threeEraAdaptation = Number(threeEraAdaptationArg);
}
if (foulEraAdaptationArg !== undefined) {
  cardCalibration.foulEraAdaptation = Number(foulEraAdaptationArg);
}
if (playerRelativeShootingDampeningArg !== undefined) {
  cardCalibration.playerRelativeShootingDampening = Number(playerRelativeShootingDampeningArg);
}
if (playerThreeRelativeDampeningArg !== undefined) {
  cardCalibration.playerThreeRelativeDampening = Number(playerThreeRelativeDampeningArg);
}
clearMatchupCaches();

const bucketDefs: Array<Omit<Bucket, "pairs">> = [
  { label: "1-4 years", minGap: 1, maxGap: 4 },
  { label: "5-9 years", minGap: 5, maxGap: 9 },
  { label: "10-14 years", minGap: 10, maxGap: 14 },
  { label: "15-19 years", minGap: 15, maxGap: 19 },
  { label: "20+ years", minGap: 20, maxGap: Number.POSITIVE_INFINITY }
];

function fixed(value: number, digits = 3): number {
  return Number(value.toFixed(digits));
}

function mean(items: PairResult[], value: (item: PairResult) => number): number {
  if (!items.length) return 0;
  return items.reduce((sum, item) => sum + value(item), 0) / items.length;
}

function weightedMean(items: PairResult[], value: (item: PairResult) => number, weight: (item: PairResult) => number): number {
  const totalWeight = items.reduce((sum, item) => sum + weight(item), 0);
  if (totalWeight <= 0) return 0;
  return items.reduce((sum, item) => sum + value(item) * weight(item), 0) / totalWeight;
}

function solveLinearSystem(matrix: number[][], rhs: number[]): number[] | null {
  const size = rhs.length;
  const augmented = matrix.map((row, index) => [...row, rhs[index]]);

  for (let column = 0; column < size; column += 1) {
    let pivotRow = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivotRow][column])) {
        pivotRow = row;
      }
    }
    if (Math.abs(augmented[pivotRow][column]) < 1e-10) return null;
    [augmented[column], augmented[pivotRow]] = [augmented[pivotRow], augmented[column]];

    const pivot = augmented[column][column];
    for (let entry = column; entry <= size; entry += 1) {
      augmented[column][entry] /= pivot;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let entry = column; entry <= size; entry += 1) {
        augmented[row][entry] -= factor * augmented[column][entry];
      }
    }
  }

  return augmented.map((row) => row[size]);
}

function regression(
  label: string,
  pairs: PairResult[],
  target: (pair: PairResult) => number,
  predictors: Array<[string, (pair: PairResult) => number]>
): RegressionSummary {
  if (pairs.length <= predictors.length) {
    return {
      label,
      observations: pairs.length,
      targetMean: 0,
      predictors: predictors.map(([name]) => name),
      coefficients: Object.fromEntries(["intercept", ...predictors.map(([name]) => name)].map((name) => [name, 0])),
      rSquared: 0
    };
  }

  const width = predictors.length + 1;
  const xTx = Array.from({ length: width }, () => Array.from({ length: width }, () => 0));
  const xTy = Array.from({ length: width }, () => 0);
  const yValues = pairs.map(target);

  for (let rowIndex = 0; rowIndex < pairs.length; rowIndex += 1) {
    const pair = pairs[rowIndex];
    const x = [1, ...predictors.map(([, value]) => value(pair))];
    const y = yValues[rowIndex];
    for (let row = 0; row < width; row += 1) {
      xTy[row] += x[row] * y;
      for (let column = 0; column < width; column += 1) {
        xTx[row][column] += x[row] * x[column];
      }
    }
  }

  const coefficients = solveLinearSystem(xTx, xTy) ?? Array.from({ length: width }, () => 0);
  const yMean = yValues.reduce((sum, value) => sum + value, 0) / yValues.length;
  const sse = pairs.reduce((sum, pair, index) => {
    const x = [1, ...predictors.map(([, value]) => value(pair))];
    const prediction = coefficients.reduce((out, coefficient, coefficientIndex) => out + coefficient * x[coefficientIndex], 0);
    return sum + (yValues[index] - prediction) ** 2;
  }, 0);
  const sst = yValues.reduce((sum, value) => sum + (value - yMean) ** 2, 0);
  const names = ["intercept", ...predictors.map(([name]) => name)];

  return {
    label,
    observations: pairs.length,
    targetMean: fixed(yMean, 4),
    predictors: predictors.map(([name]) => name),
    coefficients: Object.fromEntries(names.map((name, index) => [name, fixed(coefficients[index], 4)])),
    rSquared: fixed(sst > 0 ? 1 - sse / sst : 0, 4)
  };
}

function teamPower(team: DiceTeamCard): number {
  return team.shotQuality + team.defense;
}

function srs(team: DiceTeamCard): number {
  const value = team.source.team.simpleRating;
  return value === null || value === undefined || !Number.isFinite(value) ? 0 : value;
}

function sourceGames(team: DiceTeamCard): number {
  const wins = team.source.team.wins;
  const losses = team.source.team.losses;
  if (wins === null || wins === undefined || !Number.isFinite(wins) || losses === null || losses === undefined || !Number.isFinite(losses)) {
    throw new Error(`Missing source wins/losses for ${team.id}`);
  }
  return wins + losses;
}

function perGame(value: number | null | undefined, games: number): number {
  return value === null || value === undefined || !Number.isFinite(value) ? 0 : value / games;
}

function rate(made: number | null | undefined, attempts: number | null | undefined): number {
  return attempts && attempts > 0 && made !== null && made !== undefined && Number.isFinite(made) ? made / attempts : 0;
}

function sourceTeamLine(team: DiceTeamCard, paceTarget: number): TeamBoxMetrics {
  const games = sourceGames(team);
  const totals = team.source.team.totals;
  const sourcePace = team.source.team.pace;
  if (sourcePace === null || sourcePace === undefined || !Number.isFinite(sourcePace) || sourcePace <= 0) {
    throw new Error(`Missing source pace for ${team.id}`);
  }
  const scale = paceTarget / sourcePace;
  return {
    pts: perGame(totals.pts, games) * scale,
    fga: perGame(totals.fga, games) * scale,
    fgPct: rate(totals.fg, totals.fga),
    threePa: perGame(totals.fg3a, games) * scale,
    threePct: rate(totals.fg3, totals.fg3a),
    fta: perGame(totals.fta, games) * scale,
    ftPct: rate(totals.ft, totals.fta),
    tov: perGame(totals.tov, games) * scale,
    orb: perGame(totals.orb, games) * scale,
    poss: paceTarget
  };
}

function simTeamLine(line: StatLine): TeamBoxMetrics {
  return {
    pts: line.PTS ?? 0,
    fga: line.FGA ?? 0,
    fgPct: rate(line.FGM, line.FGA),
    threePa: line["3PA"] ?? 0,
    threePct: rate(line["3PM"], line["3PA"]),
    fta: line.FTA ?? 0,
    ftPct: rate(line.FTM, line.FTA),
    tov: line.TOV ?? 0,
    orb: line.OREB ?? 0,
    poss: line.poss ?? 0
  };
}

function expectedTeamBox(line: ExpectedTeamLine): TeamBoxMetrics {
  return {
    pts: line.pts,
    fga: line.fga,
    fgPct: line.fgPct,
    threePa: line.threePa,
    threePct: line.threePct,
    fta: line.fta,
    ftPct: line.ftPct,
    tov: line.tov,
    orb: line.orb,
    poss: line.possessions
  };
}

function metricMap(value: (field: keyof TeamBoxMetrics) => number): TeamBoxMetrics {
  return Object.fromEntries(metricFields.map((field) => [field, value(field)])) as TeamBoxMetrics;
}

function metricDelta(sim: TeamBoxMetrics, source: TeamBoxMetrics): TeamBoxMetrics {
  return metricMap((field) => sim[field] - source[field]);
}

function metricAbs(input: TeamBoxMetrics): TeamBoxMetrics {
  return metricMap((field) => Math.abs(input[field]));
}

function roundedMetrics(input: TeamBoxMetrics): TeamBoxMetrics {
  return {
    pts: fixed(input.pts, 2),
    fga: fixed(input.fga, 2),
    fgPct: fixed(input.fgPct, 4),
    threePa: fixed(input.threePa, 2),
    threePct: fixed(input.threePct, 4),
    fta: fixed(input.fta, 2),
    ftPct: fixed(input.ftPct, 4),
    tov: fixed(input.tov, 2),
    orb: fixed(input.orb, 2),
    poss: fixed(input.poss, 2)
  };
}

function teamMetricResult(team: DiceTeamCard, line: StatLine, expectedLine: ExpectedTeamLine, paceTarget: number): TeamMetricResult {
  const sim = simTeamLine(line);
  const expected = expectedTeamBox(expectedLine);
  const source = sourceTeamLine(team, paceTarget);
  const delta = metricDelta(sim, source);
  const expectedDelta = metricDelta(expected, source);
  const simMinusExpected = metricDelta(sim, expected);
  return {
    sim: roundedMetrics(sim),
    expected: roundedMetrics(expected),
    source: roundedMetrics(source),
    delta: roundedMetrics(delta),
    expectedDelta: roundedMetrics(expectedDelta),
    simMinusExpected: roundedMetrics(simMinusExpected),
    absDelta: roundedMetrics(metricAbs(delta)),
    absExpectedDelta: roundedMetrics(metricAbs(expectedDelta)),
    absSimMinusExpected: roundedMetrics(metricAbs(simMinusExpected))
  };
}

function metricAverage(pairs: PairResult[], value: (pair: PairResult) => TeamBoxMetrics): TeamBoxMetrics {
  if (!pairs.length) return roundedMetrics(metricMap(() => 0));
  return roundedMetrics(metricMap((field) => pairs.reduce((sum, pair) => sum + value(pair)[field], 0) / pairs.length));
}

function metricResultAverage(pairs: PairResult[], side: "newer" | "older"): TeamMetricResult {
  return {
    sim: metricAverage(pairs, (pair) => pair.metrics[side].sim),
    expected: metricAverage(pairs, (pair) => pair.metrics[side].expected),
    source: metricAverage(pairs, (pair) => pair.metrics[side].source),
    delta: metricAverage(pairs, (pair) => pair.metrics[side].delta),
    expectedDelta: metricAverage(pairs, (pair) => pair.metrics[side].expectedDelta),
    simMinusExpected: metricAverage(pairs, (pair) => pair.metrics[side].simMinusExpected),
    absDelta: metricAverage(pairs, (pair) => pair.metrics[side].absDelta),
    absExpectedDelta: metricAverage(pairs, (pair) => pair.metrics[side].absExpectedDelta),
    absSimMinusExpected: metricAverage(pairs, (pair) => pair.metrics[side].absSimMinusExpected)
  };
}

function aggregate(label: string, pairs: PairResult[]): Aggregate {
  return {
    label,
    pairCount: pairs.length,
    gameCount: pairs.reduce((sum, pair) => sum + pair.games, 0),
    newerWinRate: fixed(weightedMean(pairs, (pair) => pair.newerWins / pair.games, (pair) => pair.games), 4),
    newerAvgMargin: fixed(mean(pairs, (pair) => pair.newerAvgMargin), 2),
    avgExpectedNewerMargin: fixed(mean(pairs, (pair) => pair.expectedNewerAvgMargin), 2),
    avgSimMinusExpectedMargin: fixed(mean(pairs, (pair) => pair.simMinusExpectedMargin), 2),
    avgGap: fixed(mean(pairs, (pair) => pair.gap), 1),
    avgCardPowerDelta: fixed(mean(pairs, (pair) => pair.cardPowerDelta), 2),
    avgSrsDelta: fixed(mean(pairs, (pair) => pair.srsDelta), 2),
    avgTalentDelta: fixed(mean(pairs, (pair) => pair.talentDelta), 3),
    avgTotalShotAdjustmentDelta: fixed(mean(pairs, (pair) => pair.totalShotAdjustmentDelta), 2),
    avgTurnoverTargetDelta: fixed(mean(pairs, (pair) => pair.turnoverTargetDelta), 2),
    avgFoulDrawTargetDelta: fixed(mean(pairs, (pair) => pair.foulDrawTargetDelta), 2),
    avgThreeAttemptTargetDelta: fixed(mean(pairs, (pair) => pair.threeAttemptTargetDelta), 2),
    avgOrbChanceDelta: fixed(mean(pairs, (pair) => pair.orbChanceDelta), 2),
    metrics: {
      newer: metricResultAverage(pairs, "newer"),
      older: metricResultAverage(pairs, "older"),
      bias: metricAverage(pairs, (pair) => pair.metrics.bias),
      expectedBias: metricAverage(pairs, (pair) => pair.metrics.expectedBias),
      simMinusExpectedBias: metricAverage(pairs, (pair) => pair.metrics.simMinusExpectedBias)
    }
  };
}

function powerBand(delta: number): string {
  if (delta <= -3) return "newer -3 or worse";
  if (delta <= -1) return "newer -3 to -1";
  if (delta < 1) return "within +/-1";
  if (delta < 3) return "newer +1 to +3";
  return "newer +3 or better";
}

function randomPairForBucket(teams: DiceTeamCard[], rng: SeededRandom, minGap: number, maxGap: number): [DiceTeamCard, DiceTeamCard] {
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const a = teams[Math.floor(rng.next() * teams.length)];
    const b = teams[Math.floor(rng.next() * teams.length)];
    if (a.id === b.id) continue;
    const gap = Math.abs(a.source.seasonEndYear - b.source.seasonEndYear);
    if (gap < minGap || gap > maxGap) continue;
    return a.source.seasonEndYear > b.source.seasonEndYear ? [a, b] : [b, a];
  }
  throw new Error(`Could not sample pair for gap ${minGap}-${maxGap}`);
}

function runPair(newer: DiceTeamCard, older: DiceTeamCard, rng: SeededRandom): PairResult {
  const summary = summarizeSimulations(newer, older, gamesPerPair, rng.pickSeed(), matchupOptions);
  const matchup = buildMatchupCard(newer, older, matchupOptions);
  const expected = buildExpectedMatchupLine(newer, older, matchupOptions);
  const newerWins = summary.wins[newer.id] ?? 0;
  const olderWins = summary.wins[older.id] ?? 0;
  const newerLine = summary.teams[newer.id];
  const olderLine = summary.teams[older.id];
  const newerMetrics = teamMetricResult(newer, newerLine, expected.away, matchup.possessionsEach);
  const olderMetrics = teamMetricResult(older, olderLine, expected.home, matchup.possessionsEach);
  const newerAvgMargin = (newerLine.PTS ?? 0) - (olderLine.PTS ?? 0);

  return {
    newerId: newer.id,
    olderId: older.id,
    newer: newer.shortName,
    older: older.shortName,
    newerSeason: newer.source.seasonEndYear,
    olderSeason: older.source.seasonEndYear,
    gap: newer.source.seasonEndYear - older.source.seasonEndYear,
    games: gamesPerPair,
    newerWins,
    olderWins,
    newerWinRate: fixed(newerWins / gamesPerPair, 4),
    newerAvgMargin: fixed(newerAvgMargin, 2),
    expectedNewerAvgMargin: fixed(expected.marginForAway, 2),
    simMinusExpectedMargin: fixed(newerAvgMargin - expected.marginForAway, 2),
    cardPowerDelta: fixed(teamPower(newer) - teamPower(older), 2),
    srsDelta: fixed(srs(newer) - srs(older), 2),
    talentDelta: fixed(newer.calibration.leagueStrength.talentPointsPer100 - older.calibration.leagueStrength.talentPointsPer100, 3),
    eraContextMode: expected.eraContext.mode,
    eraContextSeason: expected.eraContext.seasonEndYear,
    eraContextBlend: fixed(expected.eraContext.blend, 4),
    eraContextPace: fixed(expected.eraContext.averages.pace, 2),
    newerShotTalentAdjustment: fixed(matchup.awayStatic.eraTalentAdjustment.shotMakeAdjustment, 3),
    olderShotTalentAdjustment: fixed(matchup.homeStatic.eraTalentAdjustment.shotMakeAdjustment, 3),
    totalShotAdjustmentDelta: fixed(matchup.awayStatic.totalShotAdjustment - matchup.homeStatic.totalShotAdjustment, 2),
    turnoverTargetDelta: fixed(matchup.awayStatic.turnoverTargetChance - matchup.homeStatic.turnoverTargetChance, 2),
    foulDrawTargetDelta: fixed(matchup.awayStatic.foulDrawTargetChance - matchup.homeStatic.foulDrawTargetChance, 2),
    threeAttemptTargetDelta: fixed(matchup.awayStatic.threeAttemptTargetChance - matchup.homeStatic.threeAttemptTargetChance, 2),
    orbChanceDelta: fixed(matchup.awayStatic.orbChance - matchup.homeStatic.orbChance, 2),
    metrics: {
      newer: newerMetrics,
      older: olderMetrics,
      bias: roundedMetrics(metricMap((field) => newerMetrics.delta[field] - olderMetrics.delta[field])),
      expectedBias: roundedMetrics(metricMap((field) => newerMetrics.expectedDelta[field] - olderMetrics.expectedDelta[field])),
      simMinusExpectedBias: roundedMetrics(metricMap((field) => newerMetrics.simMinusExpected[field] - olderMetrics.simMinusExpected[field]))
    }
  };
}

if (
  !Number.isFinite(seed) ||
  !Number.isInteger(pairsPerBucket) ||
  pairsPerBucket <= 0 ||
  !Number.isInteger(gamesPerPair) ||
  gamesPerPair <= 0 ||
  !Number.isFinite(simParams.eraTalentShotMakeScale) ||
  !Number.isFinite(simParams.eraTalentTurnoverScale) ||
  !Number.isFinite(simParams.eraTalentReboundScale) ||
  !Number.isFinite(simParams.crossEraStyleRetentionBoost) ||
  !Number.isFinite(cardCalibration.threeEraAdaptation) ||
  !Number.isFinite(cardCalibration.foulEraAdaptation) ||
  !Number.isFinite(cardCalibration.playerRelativeShootingDampening) ||
  !Number.isFinite(cardCalibration.playerThreeRelativeDampening) ||
  (eraContextBlend !== undefined && (!Number.isFinite(eraContextBlend) || eraContextBlend < 0 || eraContextBlend > 1)) ||
  (eraContextSeason !== undefined && (!Number.isFinite(eraContextSeason) || !Number.isInteger(eraContextSeason)))
) {
  throw new Error(
    "Usage: tsx scripts/analyze-cross-era.ts --seed=4242 --pairs-per-bucket=160 --games-per-pair=40 --era-context-mode=midpoint"
  );
}

const started = Date.now();
const rng = new SeededRandom(seed);
const teams = getDiceTeams();
const buckets: Bucket[] = bucketDefs.map((bucket) => ({ ...bucket, pairs: [] }));
const seen = new Set<string>();

for (const bucket of buckets) {
  while (bucket.pairs.length < pairsPerBucket) {
    const [newer, older] = randomPairForBucket(teams, rng, bucket.minGap, bucket.maxGap);
    const key = `${newer.id}|${older.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    bucket.pairs.push(runPair(newer, older, rng));
  }
}

const pairs = buckets.flatMap((bucket) => bucket.pairs);
const byGap = buckets.map((bucket) => aggregate(bucket.label, bucket.pairs));
const powerLabels = ["newer -3 or worse", "newer -3 to -1", "within +/-1", "newer +1 to +3", "newer +3 or better"];
const byCardPower = powerLabels.map((label) => aggregate(label, pairs.filter((pair) => powerBand(pair.cardPowerDelta) === label)));
const nearEqualCardPower = pairs.filter((pair) => Math.abs(pair.cardPowerDelta) < 1);
const nearEqualSrs = pairs.filter((pair) => Math.abs(pair.srsDelta) < 1);
const olderFavoredCardPower = pairs.filter((pair) => pair.cardPowerDelta < -1);
const newerFavoredCardPower = pairs.filter((pair) => pair.cardPowerDelta > 1);
const strengthGapPredictors: Array<[string, (pair: PairResult) => number]> = [
  ["cardPowerDelta", (pair) => pair.cardPowerDelta],
  ["gap", (pair) => pair.gap]
];

const report = {
  generatedAt: new Date().toISOString(),
  run: {
    modelVersion: crossEraModelVersion,
    seed,
    pairsPerBucket,
    gamesPerPair,
    matchupOptions,
    eraTalentMode,
    styleRetentionMode,
    simParams: {
      eraTalentShotMakeScale: simParams.eraTalentShotMakeScale,
      eraTalentTurnoverScale: simParams.eraTalentTurnoverScale,
      eraTalentReboundScale: simParams.eraTalentReboundScale,
      crossEraStyleRetentionBoost: simParams.crossEraStyleRetentionBoost
    },
    cardCalibration: {
      threeEraAdaptation: cardCalibration.threeEraAdaptation,
      foulEraAdaptation: cardCalibration.foulEraAdaptation,
      playerRelativeShootingDampening: cardCalibration.playerRelativeShootingDampening,
      playerThreeRelativeDampening: cardCalibration.playerThreeRelativeDampening
    },
    elapsedSeconds: fixed((Date.now() - started) / 1000, 1)
  },
  catalog: {
    teamCount: teams.length,
    seasonCount: new Set(teams.map((team) => team.source.seasonEndYear)).size,
    minSeason: Math.min(...teams.map((team) => team.source.seasonEndYear)),
    maxSeason: Math.max(...teams.map((team) => team.source.seasonEndYear))
  },
  summary: {
    overall: aggregate("overall", pairs),
    nearEqualCardPower: aggregate("nearEqualCardPower", nearEqualCardPower),
    nearEqualSrs: aggregate("nearEqualSrs", nearEqualSrs),
    olderFavoredCardPower: aggregate("olderFavoredCardPower", olderFavoredCardPower),
    newerFavoredCardPower: aggregate("newerFavoredCardPower", newerFavoredCardPower)
  },
  byGap,
  byCardPower,
  diagnostics: {
    regressions: [
      regression("sim_margin_vs_card_power_gap", pairs, (pair) => pair.newerAvgMargin, strengthGapPredictors),
      regression("expected_margin_vs_card_power_gap", pairs, (pair) => pair.expectedNewerAvgMargin, strengthGapPredictors),
      regression("sim_minus_expected_margin_vs_card_power_gap", pairs, (pair) => pair.simMinusExpectedMargin, strengthGapPredictors),
      regression("newer_win_rate_vs_card_power_gap", pairs, (pair) => pair.newerWinRate - 0.5, strengthGapPredictors),
      regression("near_equal_card_power_sim_margin_vs_gap", nearEqualCardPower, (pair) => pair.newerAvgMargin, [["gap", (pair) => pair.gap]]),
      regression("near_equal_card_power_expected_margin_vs_gap", nearEqualCardPower, (pair) => pair.expectedNewerAvgMargin, [["gap", (pair) => pair.gap]])
    ]
  },
  strongestNewerEdges: [...pairs].sort((a, b) => b.newerAvgMargin - a.newerAvgMargin).slice(0, 12),
  strongestOlderEdges: [...pairs].sort((a, b) => a.newerAvgMargin - b.newerAvgMargin).slice(0, 12),
  buckets
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(`Wrote ${outputPath}`);
console.log(`Catalog: ${report.catalog.teamCount} teams, ${report.catalog.minSeason}-${report.catalog.maxSeason}`);
console.log(
  `Run: ${pairs.length} pairs x ${gamesPerPair} games, ${report.run.elapsedSeconds}s, ${matchupOptions.venue}/${matchupOptions.intensity}, ` +
    `eraTalent=${eraTalentMode} ` +
    `(shot=${simParams.eraTalentShotMakeScale}, tov=${simParams.eraTalentTurnoverScale}, reb=${simParams.eraTalentReboundScale}), ` +
    `styleRetention=${styleRetentionMode}, eraContext=${matchupOptions.eraContext?.mode ?? "midpoint"}, ` +
    `threeEra=${cardCalibration.threeEraAdaptation}, foulEra=${cardCalibration.foulEraAdaptation}, ` +
    `shootDamp=${cardCalibration.playerRelativeShootingDampening}, threeDamp=${cardCalibration.playerThreeRelativeDampening}`
);
for (const row of [report.summary.overall, ...byGap, report.summary.nearEqualCardPower, report.summary.olderFavoredCardPower]) {
  console.log(
    `${row.label}: pairs=${row.pairCount}, newerWin=${(row.newerWinRate * 100).toFixed(1)}%, ` +
      `margin=${row.newerAvgMargin > 0 ? "+" : ""}${row.newerAvgMargin}, ` +
      `expected=${row.avgExpectedNewerMargin > 0 ? "+" : ""}${row.avgExpectedNewerMargin}, ` +
      `sim-exp=${row.avgSimMinusExpectedMargin > 0 ? "+" : ""}${row.avgSimMinusExpectedMargin}, ` +
      `powerDelta=${row.avgCardPowerDelta > 0 ? "+" : ""}${row.avgCardPowerDelta}, ` +
      `talentDelta=${row.avgTalentDelta > 0 ? "+" : ""}${row.avgTalentDelta}, ` +
      `shotAdjDelta=${row.avgTotalShotAdjustmentDelta > 0 ? "+" : ""}${row.avgTotalShotAdjustmentDelta}`
  );
}
const simMarginRegression = report.diagnostics.regressions.find((item) => item.label === "sim_margin_vs_card_power_gap");
const expectedMarginRegression = report.diagnostics.regressions.find((item) => item.label === "expected_margin_vs_card_power_gap");
if (simMarginRegression && expectedMarginRegression) {
  const simGap = simMarginRegression.coefficients.gap ?? 0;
  const expectedGap = expectedMarginRegression.coefficients.gap ?? 0;
  console.log(
    `Regression gap coefficient, pts/year controlling card power: sim=${simGap > 0 ? "+" : ""}${simGap}, ` +
      `expected=${expectedGap > 0 ? "+" : ""}${expectedGap}`
  );
}
