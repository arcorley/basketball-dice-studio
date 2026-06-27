import fs from "node:fs";
import path from "node:path";
import { buildExpectedMatchupLine, clearMatchupCaches, crossEraModelVersion, simParams } from "../src/lib/diceEngine";
import { SeededRandom } from "../src/lib/random";
import { calibration as cardCalibration } from "../src/lib/teamCards";
import type { DiceTeamCard, EraContextMode, ExpectedTeamLine, MatchupOptions, SourceCellNumber } from "../src/lib/types";
import { getDiceTeams } from "./sourceDataStatic";

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

type PairSample = {
  newer: DiceTeamCard;
  older: DiceTeamCard;
  gap: number;
  cardPowerDelta: number;
  srsDelta: number;
};

type PairEvaluation = PairSample & {
  expectedMargin: number;
  newerDelta: TeamBoxMetrics;
  olderDelta: TeamBoxMetrics;
  bias: TeamBoxMetrics;
  absoluteDelta: TeamBoxMetrics;
};

type TuningConfig = {
  threeEraAdaptation: number;
  foulEraAdaptation: number;
  playerRelativeShootingDampening: number;
  playerThreeRelativeDampening: number;
  crossEraStyleRetentionBoost: number;
};

type RegressionSummary = {
  targetMean: number;
  coefficients: Record<string, number>;
  rSquared: number;
};

type TuningResult = {
  rank: number;
  isBaseline: boolean;
  score: number;
  trainingScore: number;
  config: TuningConfig;
  components: {
    recencyGap: number;
    nearEqualMargin: number;
    statBias: number;
    absoluteStatError: number;
  };
  diagnostics: {
    expectedMarginRegression: RegressionSummary;
    nearEqualGapRegression: RegressionSummary;
    nearEqualMargin: number;
    overallExpectedMargin: number;
  };
  statBias: TeamBoxMetrics;
  absoluteStatError: TeamBoxMetrics;
  byGap: Array<{
    label: string;
    pairCount: number;
    avgGap: number;
    avgCardPowerDelta: number;
    expectedMargin: number;
    statBias: TeamBoxMetrics;
  }>;
};

const metricFields: Array<keyof TeamBoxMetrics> = ["pts", "fga", "fgPct", "threePa", "threePct", "fta", "ftPct", "tov", "orb", "poss"];
const statBiasWeights: Partial<Record<keyof TeamBoxMetrics, number>> = {
  pts: 1,
  fgPct: 1.2,
  threePa: 0.8,
  threePct: 0.7,
  fta: 1,
  tov: 0.8,
  orb: 0.8
};
const statBiasNormalizers: Record<keyof TeamBoxMetrics, number> = {
  pts: 2,
  fga: 2,
  fgPct: 0.02,
  threePa: 2,
  threePct: 0.02,
  fta: 2,
  ftPct: 0.02,
  tov: 1,
  orb: 1,
  poss: 1
};

const bucketDefs = [
  { label: "1-4 years", minGap: 1, maxGap: 4 },
  { label: "5-9 years", minGap: 5, maxGap: 9 },
  { label: "10-14 years", minGap: 10, maxGap: 14 },
  { label: "15-19 years", minGap: 15, maxGap: 19 },
  { label: "20+ years", minGap: 20, maxGap: Number.POSITIVE_INFINITY }
];

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    return [key, value] as const;
  })
);

const seed = Number(args.get("seed") ?? 5151);
const pairsPerBucket = Number(args.get("pairs-per-bucket") ?? 60);
const validationSeed = Number(args.get("validation-seed") ?? seed + 1);
const validationPairsPerBucket = Number(args.get("validation-pairs-per-bucket") ?? pairsPerBucket);
const top = Number(args.get("top") ?? 25);
const outputPath =
  args.get("output") ?? path.join(process.cwd(), "reports", `cross-era-tuning-${pairsPerBucket}-pairs-per-bucket-seed-${seed}.json`);
const matchupOptions: MatchupOptions = {
  venue: args.get("venue") === "home-court" ? "home-court" : "neutral",
  intensity: args.get("intensity") === "playoff" ? "playoff" : "regular",
  eraContext: {
    mode: parseEraContextMode(args.get("era-context-mode") ?? args.get("era-context")),
    ...(args.get("era-context-blend") === undefined ? {} : { blend: Number(args.get("era-context-blend")) }),
    ...(args.get("era-context-season") === undefined ? {} : { seasonEndYear: Number(args.get("era-context-season")) })
  }
};

const baselineConfig: TuningConfig = {
  threeEraAdaptation: cardCalibration.threeEraAdaptation,
  foulEraAdaptation: cardCalibration.foulEraAdaptation,
  playerRelativeShootingDampening: cardCalibration.playerRelativeShootingDampening,
  playerThreeRelativeDampening: cardCalibration.playerThreeRelativeDampening,
  crossEraStyleRetentionBoost: simParams.crossEraStyleRetentionBoost
};

const grids = {
  threeEraAdaptation: numberList(args.get("three-era"), [0.08, baselineConfig.threeEraAdaptation, 0.18]),
  foulEraAdaptation: numberList(args.get("foul-era"), [0.2, baselineConfig.foulEraAdaptation, 0.5]),
  playerRelativeShootingDampening: numberList(args.get("shooting-dampening"), [0.84, baselineConfig.playerRelativeShootingDampening, 1]),
  playerThreeRelativeDampening: numberList(args.get("three-dampening"), [0.74, baselineConfig.playerThreeRelativeDampening, 0.9]),
  crossEraStyleRetentionBoost: numberList(args.get("style-retention"), [0, 0.1, baselineConfig.crossEraStyleRetentionBoost])
};

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
      throw new Error("Invalid --era-context-mode.");
  }
}

function numberList(value: string | undefined, fallback: number[]): number[] {
  const list = value === undefined ? fallback : value.split(",").map((item) => Number(item.trim()));
  const unique = [...new Set(list.map((item) => fixed(item, 6)))].sort((a, b) => a - b);
  if (!unique.length || unique.some((item) => !Number.isFinite(item))) {
    throw new Error(`Invalid numeric list: ${value}`);
  }
  return unique;
}

function fixed(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

function mean<T>(items: T[], value: (item: T) => number): number {
  if (!items.length) return 0;
  return items.reduce((sum, item) => sum + value(item), 0) / items.length;
}

function teamPower(team: DiceTeamCard): number {
  return team.shotQuality + team.defense;
}

function srs(team: DiceTeamCard): number {
  const value = team.source.team.simpleRating;
  return finiteCell(value) ? value : 0;
}

function finiteCell(value: SourceCellNumber): value is number {
  return value !== null && value !== undefined && Number.isFinite(value);
}

function sourceGames(team: DiceTeamCard): number {
  const wins = team.source.team.wins;
  const losses = team.source.team.losses;
  if (!finiteCell(wins) || !finiteCell(losses)) {
    throw new Error(`Missing source wins/losses for ${team.id}`);
  }
  return wins + losses;
}

function perGame(value: SourceCellNumber, games: number): number {
  return finiteCell(value) ? value / games : 0;
}

function rate(made: SourceCellNumber | number, attempts: SourceCellNumber | number): number {
  return attempts && attempts > 0 && made !== null && made !== undefined && Number.isFinite(made) ? made / attempts : 0;
}

function sourceTeamLine(team: DiceTeamCard, paceTarget: number): TeamBoxMetrics {
  const games = sourceGames(team);
  const totals = team.source.team.totals;
  const sourcePace = team.source.team.pace;
  if (!finiteCell(sourcePace) || sourcePace <= 0) {
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

function metricDelta(a: TeamBoxMetrics, b: TeamBoxMetrics): TeamBoxMetrics {
  return metricMap((field) => a[field] - b[field]);
}

function metricAbs(input: TeamBoxMetrics): TeamBoxMetrics {
  return metricMap((field) => Math.abs(input[field]));
}

function metricAverage<T>(items: T[], value: (item: T) => TeamBoxMetrics): TeamBoxMetrics {
  return metricMap((field) => mean(items, (item) => value(item)[field]));
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

function solveLinearSystem(matrix: number[][], rhs: number[]): number[] | null {
  const size = rhs.length;
  const augmented = matrix.map((row, index) => [...row, rhs[index]]);

  for (let column = 0; column < size; column += 1) {
    let pivotRow = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivotRow][column])) pivotRow = row;
    }
    if (Math.abs(augmented[pivotRow][column]) < 1e-10) return null;
    [augmented[column], augmented[pivotRow]] = [augmented[pivotRow], augmented[column]];
    const pivot = augmented[column][column];
    for (let entry = column; entry <= size; entry += 1) augmented[column][entry] /= pivot;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let entry = column; entry <= size; entry += 1) augmented[row][entry] -= factor * augmented[column][entry];
    }
  }

  return augmented.map((row) => row[size]);
}

function regression(
  pairs: PairEvaluation[],
  target: (pair: PairEvaluation) => number,
  predictors: Array<[string, (pair: PairEvaluation) => number]>
): RegressionSummary {
  if (pairs.length <= predictors.length) {
    return {
      targetMean: 0,
      coefficients: Object.fromEntries(["intercept", ...predictors.map(([name]) => name)].map((name) => [name, 0])),
      rSquared: 0
    };
  }

  const width = predictors.length + 1;
  const xTx = Array.from({ length: width }, () => Array.from({ length: width }, () => 0));
  const xTy = Array.from({ length: width }, () => 0);
  const yValues = pairs.map(target);

  for (let index = 0; index < pairs.length; index += 1) {
    const pair = pairs[index];
    const x = [1, ...predictors.map(([, value]) => value(pair))];
    const y = yValues[index];
    for (let row = 0; row < width; row += 1) {
      xTy[row] += x[row] * y;
      for (let column = 0; column < width; column += 1) xTx[row][column] += x[row] * x[column];
    }
  }

  const coefficients = solveLinearSystem(xTx, xTy) ?? Array.from({ length: width }, () => 0);
  const yMean = mean(yValues, (value) => value);
  const sse = pairs.reduce((sum, pair, index) => {
    const x = [1, ...predictors.map(([, value]) => value(pair))];
    const prediction = coefficients.reduce((out, coefficient, coefficientIndex) => out + coefficient * x[coefficientIndex], 0);
    return sum + (yValues[index] - prediction) ** 2;
  }, 0);
  const sst = yValues.reduce((sum, value) => sum + (value - yMean) ** 2, 0);
  const names = ["intercept", ...predictors.map(([name]) => name)];

  return {
    targetMean: fixed(yMean, 4),
    coefficients: Object.fromEntries(names.map((name, index) => [name, fixed(coefficients[index], 4)])),
    rSquared: fixed(sst > 0 ? 1 - sse / sst : 0, 4)
  };
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

function samplePairs(teams: DiceTeamCard[], rng: SeededRandom, countPerBucket: number): PairSample[] {
  const samples: PairSample[] = [];
  const seen = new Set<string>();
  for (const bucket of bucketDefs) {
    let count = 0;
    while (count < countPerBucket) {
      const [newer, older] = randomPairForBucket(teams, rng, bucket.minGap, bucket.maxGap);
      const key = `${newer.id}|${older.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      samples.push({
        newer,
        older,
        gap: newer.source.seasonEndYear - older.source.seasonEndYear,
        cardPowerDelta: teamPower(newer) - teamPower(older),
        srsDelta: srs(newer) - srs(older)
      });
      count += 1;
    }
  }
  return samples;
}

function setConfig(config: TuningConfig): void {
  cardCalibration.threeEraAdaptation = config.threeEraAdaptation;
  cardCalibration.foulEraAdaptation = config.foulEraAdaptation;
  cardCalibration.playerRelativeShootingDampening = config.playerRelativeShootingDampening;
  cardCalibration.playerThreeRelativeDampening = config.playerThreeRelativeDampening;
  simParams.crossEraStyleRetentionBoost = config.crossEraStyleRetentionBoost;
  clearMatchupCaches();
}

function isSameConfig(a: TuningConfig, b: TuningConfig): boolean {
  return (
    a.threeEraAdaptation === b.threeEraAdaptation &&
    a.foulEraAdaptation === b.foulEraAdaptation &&
    a.playerRelativeShootingDampening === b.playerRelativeShootingDampening &&
    a.playerThreeRelativeDampening === b.playerThreeRelativeDampening &&
    a.crossEraStyleRetentionBoost === b.crossEraStyleRetentionBoost
  );
}

function configs(): TuningConfig[] {
  const out: TuningConfig[] = [];
  for (const threeEraAdaptation of grids.threeEraAdaptation) {
    for (const foulEraAdaptation of grids.foulEraAdaptation) {
      for (const playerRelativeShootingDampening of grids.playerRelativeShootingDampening) {
        for (const playerThreeRelativeDampening of grids.playerThreeRelativeDampening) {
          for (const crossEraStyleRetentionBoost of grids.crossEraStyleRetentionBoost) {
            out.push({
              threeEraAdaptation,
              foulEraAdaptation,
              playerRelativeShootingDampening,
              playerThreeRelativeDampening,
              crossEraStyleRetentionBoost
            });
          }
        }
      }
    }
  }
  return out;
}

function evaluatePair(pair: PairSample): PairEvaluation {
  const expected = buildExpectedMatchupLine(pair.newer, pair.older, matchupOptions);
  const newerExpected = expectedTeamBox(expected.away);
  const olderExpected = expectedTeamBox(expected.home);
  const newerDelta = metricDelta(newerExpected, sourceTeamLine(pair.newer, expected.possessionsEach));
  const olderDelta = metricDelta(olderExpected, sourceTeamLine(pair.older, expected.possessionsEach));
  return {
    ...pair,
    expectedMargin: expected.marginForAway,
    newerDelta,
    olderDelta,
    bias: metricDelta(newerDelta, olderDelta),
    absoluteDelta: metricMap((field) => (Math.abs(newerDelta[field]) + Math.abs(olderDelta[field])) / 2)
  };
}

function normalizedMetricScore(metrics: TeamBoxMetrics, weights = statBiasWeights): number {
  const entries = Object.entries(weights) as Array<[keyof TeamBoxMetrics, number]>;
  const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0);
  return entries.reduce((sum, [field, weight]) => sum + (Math.abs(metrics[field]) / statBiasNormalizers[field]) * weight, 0) / totalWeight;
}

function byGap(evaluations: PairEvaluation[]): TuningResult["byGap"] {
  return bucketDefs.map((bucket) => {
    const pairs = evaluations.filter((pair) => pair.gap >= bucket.minGap && pair.gap <= bucket.maxGap);
    return {
      label: bucket.label,
      pairCount: pairs.length,
      avgGap: fixed(mean(pairs, (pair) => pair.gap), 1),
      avgCardPowerDelta: fixed(mean(pairs, (pair) => pair.cardPowerDelta), 2),
      expectedMargin: fixed(mean(pairs, (pair) => pair.expectedMargin), 2),
      statBias: roundedMetrics(metricAverage(pairs, (pair) => pair.bias))
    };
  });
}

function evaluateConfig(config: TuningConfig, samples: PairSample[]): Omit<TuningResult, "rank"> {
  setConfig(config);
  const evaluations = samples.map(evaluatePair);
  const nearEqualCardPower = evaluations.filter((pair) => Math.abs(pair.cardPowerDelta) < 1);
  const expectedMarginRegression = regression(evaluations, (pair) => pair.expectedMargin, [
    ["cardPowerDelta", (pair) => pair.cardPowerDelta],
    ["gap", (pair) => pair.gap]
  ]);
  const nearEqualGapRegression = regression(nearEqualCardPower, (pair) => pair.expectedMargin, [["gap", (pair) => pair.gap]]);
  const statBias = metricAverage(evaluations, (pair) => pair.bias);
  const absoluteStatError = metricAverage(evaluations, (pair) => pair.absoluteDelta);
  const nearEqualMargin = mean(nearEqualCardPower, (pair) => pair.expectedMargin);
  const recencyGap = Math.abs(expectedMarginRegression.coefficients.gap ?? 0) / 0.01;
  const components = {
    recencyGap: fixed(recencyGap, 4),
    nearEqualMargin: fixed(Math.abs(nearEqualMargin) / 1.0, 4),
    statBias: fixed(normalizedMetricScore(statBias), 4),
    absoluteStatError: fixed(normalizedMetricScore(absoluteStatError), 4)
  };
  const score = fixed(components.recencyGap * 4 + components.nearEqualMargin + components.statBias * 2 + components.absoluteStatError, 4);

  return {
    isBaseline: isSameConfig(config, baselineConfig),
    score,
    config,
    components,
    diagnostics: {
      expectedMarginRegression,
      nearEqualGapRegression,
      nearEqualMargin: fixed(nearEqualMargin, 3),
      overallExpectedMargin: fixed(mean(evaluations, (pair) => pair.expectedMargin), 3)
    },
    statBias: roundedMetrics(statBias),
    absoluteStatError: roundedMetrics(absoluteStatError),
    byGap: byGap(evaluations)
  };
}

if (!Number.isFinite(seed) || !Number.isInteger(pairsPerBucket) || pairsPerBucket <= 0 || !Number.isInteger(top) || top <= 0) {
  throw new Error("Usage: npm run tune:cross-era -- --seed=5151 --pairs-per-bucket=60 --top=25");
}
if (!Number.isFinite(validationSeed) || !Number.isInteger(validationPairsPerBucket) || validationPairsPerBucket <= 0) {
  throw new Error("Validation seed and validation pairs per bucket must be finite positive integers.");
}

const started = Date.now();
const trainingRng = new SeededRandom(seed);
const validationRng = new SeededRandom(validationSeed);
const teams = getDiceTeams();
const trainingSamples = samplePairs(teams, trainingRng, pairsPerBucket);
const validationSamples = samplePairs(teams, validationRng, validationPairsPerBucket);
const grid = configs();
const results = grid
  .map((config) => {
    const training = evaluateConfig(config, trainingSamples);
    const validation = evaluateConfig(config, validationSamples);
    return {
      ...validation,
      trainingScore: training.score,
      trainingComponents: training.components,
      trainingDiagnostics: training.diagnostics
    };
  })
  .sort((a, b) => a.score - b.score)
  .map((result, index) => ({ ...result, rank: index + 1 }));
const baseline = results.find((result) => result.isBaseline);

const report = {
  generatedAt: new Date().toISOString(),
  run: {
    modelVersion: crossEraModelVersion,
    seed,
    validationSeed,
    pairsPerBucket,
    validationPairsPerBucket,
    trainingPairCount: trainingSamples.length,
    validationPairCount: validationSamples.length,
    configCount: grid.length,
    matchupOptions,
    grids,
    scoring: {
      score: "4*recencyGap + nearEqualMargin + 2*statBias + absoluteStatError",
      recencyGap: "abs(expected margin regression gap coefficient) / 0.01 points per year",
      nearEqualMargin: "abs(mean expected margin for cardPowerDelta within +/-1) / 1 point",
      statBias: "weighted normalized abs(newer expected-source delta minus older expected-source delta)",
      absoluteStatError: "weighted normalized average abs(expected-source delta) for both teams"
    },
    elapsedSeconds: fixed((Date.now() - started) / 1000, 1)
  },
  baseline,
  top: results.slice(0, top),
  results
};

setConfig(baselineConfig);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(`Wrote ${outputPath}`);
console.log(
  `Evaluated ${trainingSamples.length} training pairs and ${validationSamples.length} validation pairs ` +
    `across ${grid.length} configs in ${report.run.elapsedSeconds}s.`
);
if (baseline) {
  console.log(
    `Baseline rank ${baseline.rank}/${grid.length}: score=${baseline.score}, ` +
      `gap=${baseline.diagnostics.expectedMarginRegression.coefficients.gap}, statBias=${baseline.components.statBias}`
  );
}
for (const result of report.top.slice(0, Math.min(10, report.top.length))) {
  console.log(
    `#${result.rank} score=${result.score}, gap=${result.diagnostics.expectedMarginRegression.coefficients.gap}, ` +
      `nearEq=${result.diagnostics.nearEqualMargin}, statBias=${result.components.statBias}, ` +
      `cfg=${JSON.stringify(result.config)}`
  );
}
