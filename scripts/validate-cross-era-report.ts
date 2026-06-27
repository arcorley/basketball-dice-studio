import fs from "node:fs";
import path from "node:path";

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

type Aggregate = {
  label: string;
  pairCount: number;
  gameCount: number;
  newerWinRate: number;
  newerAvgMargin: number;
  avgExpectedNewerMargin: number;
  avgSimMinusExpectedMargin: number;
  metrics: {
    bias: TeamBoxMetrics;
    expectedBias: TeamBoxMetrics;
    simMinusExpectedBias: TeamBoxMetrics;
  };
};

type RegressionSummary = {
  label: string;
  coefficients: Record<string, number>;
};

type CrossEraReport = {
  run?: {
    modelVersion?: string;
    seed?: number;
    pairsPerBucket?: number;
    gamesPerPair?: number;
  };
  summary: {
    overall: Aggregate;
    nearEqualCardPower: Aggregate;
  };
  diagnostics: {
    regressions: RegressionSummary[];
  };
};

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    return [key, value] as const;
  })
);

const positional = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const reportPath = args.get("report") ?? positional[0];

const thresholds = {
  maxMarginGapCoefficient: numberArg("max-margin-gap-coeff", 0.01),
  maxExpectedGapCoefficient: numberArg("max-expected-gap-coeff", 0.01),
  maxWinRateGapCoefficient: numberArg("max-win-gap-coeff", 0.001),
  minNearEqualWinRate: numberArg("min-near-equal-win", 0.485),
  maxNearEqualWinRate: numberArg("max-near-equal-win", 0.515),
  maxOverallWinBias: numberArg("max-overall-win-bias", 0.02),
  maxSimMinusExpectedMargin: numberArg("max-sim-minus-expected-margin", 0.35),
  maxSimMinusExpectedPtsBias: numberArg("max-sim-minus-expected-pts-bias", 0.35),
  maxSimMinusExpectedFgaBias: numberArg("max-sim-minus-expected-fga-bias", 0.35),
  maxSimMinusExpectedFtaBias: numberArg("max-sim-minus-expected-fta-bias", 0.35),
  maxSimMinusExpectedTovBias: numberArg("max-sim-minus-expected-tov-bias", 0.2),
  maxSimMinusExpectedOrbBias: numberArg("max-sim-minus-expected-orb-bias", 0.2),
  maxStatBiasPts: numberArg("max-stat-bias-pts", 5),
  maxStatBiasFgPct: numberArg("max-stat-bias-fgpct", 0.04),
  maxStatBiasThreePa: numberArg("max-stat-bias-3pa", 2),
  maxStatBiasFta: numberArg("max-stat-bias-fta", 5),
  maxStatBiasTov: numberArg("max-stat-bias-tov", 2),
  maxStatBiasOrb: numberArg("max-stat-bias-orb", 3.5)
};

function numberArg(name: string, fallback: number): number {
  const value = args.get(name);
  if (value === undefined) return fallback;
  const out = Number(value);
  if (!Number.isFinite(out)) throw new Error(`Invalid --${name}: ${value}`);
  return out;
}

function requiredReportPath(): string {
  if (!reportPath) {
    throw new Error("Usage: npm run validate:cross-era -- --report=reports/cross-era-model-midpoint-240x50-seed-7777.json");
  }
  return reportPath;
}

function readReport(filePath: string): CrossEraReport {
  const report = JSON.parse(fs.readFileSync(filePath, "utf8")) as CrossEraReport;
  if (!report.summary?.overall || !report.summary?.nearEqualCardPower || !report.diagnostics?.regressions) {
    throw new Error(`${filePath} is not a cross-era analysis report with summary and diagnostics.`);
  }
  return report;
}

function regression(report: CrossEraReport, label: string): RegressionSummary {
  const found = report.diagnostics.regressions.find((item) => item.label === label);
  if (!found) throw new Error(`Missing regression diagnostic: ${label}`);
  return found;
}

function assertFinite(value: number, label: string, failures: string[]): void {
  if (!Number.isFinite(value)) failures.push(`${label} is not finite`);
}

function assertMaxAbs(value: number, max: number, label: string, failures: string[]): void {
  assertFinite(value, label, failures);
  if (Math.abs(value) > max) failures.push(`${label}=${format(value)} exceeds +/-${format(max)}`);
}

function assertBetween(value: number, min: number, max: number, label: string, failures: string[]): void {
  assertFinite(value, label, failures);
  if (value < min || value > max) failures.push(`${label}=${format(value)} outside ${format(min)}-${format(max)}`);
}

function format(value: number): string {
  return Number(value.toFixed(5)).toString();
}

const filePath = path.resolve(requiredReportPath());
const report = readReport(filePath);
const failures: string[] = [];
const warnings: string[] = [];
const overall = report.summary.overall;
const nearEqual = report.summary.nearEqualCardPower;
const simMarginGap = regression(report, "sim_margin_vs_card_power_gap").coefficients.gap ?? Number.NaN;
const expectedMarginGap = regression(report, "expected_margin_vs_card_power_gap").coefficients.gap ?? Number.NaN;
const winRateGap = regression(report, "newer_win_rate_vs_card_power_gap").coefficients.gap ?? Number.NaN;

assertMaxAbs(simMarginGap, thresholds.maxMarginGapCoefficient, "sim margin gap coefficient", failures);
assertMaxAbs(expectedMarginGap, thresholds.maxExpectedGapCoefficient, "expected margin gap coefficient", failures);
assertMaxAbs(winRateGap, thresholds.maxWinRateGapCoefficient, "win-rate gap coefficient", failures);
assertBetween(nearEqual.newerWinRate, thresholds.minNearEqualWinRate, thresholds.maxNearEqualWinRate, "near-equal card-power newer win rate", failures);
assertMaxAbs(overall.newerWinRate - 0.5, thresholds.maxOverallWinBias, "overall newer win-rate bias", failures);
assertMaxAbs(overall.avgSimMinusExpectedMargin, thresholds.maxSimMinusExpectedMargin, "overall sim-minus-expected margin", failures);

assertMaxAbs(overall.metrics.simMinusExpectedBias.pts, thresholds.maxSimMinusExpectedPtsBias, "sim-minus-expected PTS bias", failures);
assertMaxAbs(overall.metrics.simMinusExpectedBias.fga, thresholds.maxSimMinusExpectedFgaBias, "sim-minus-expected FGA bias", failures);
assertMaxAbs(overall.metrics.simMinusExpectedBias.fta, thresholds.maxSimMinusExpectedFtaBias, "sim-minus-expected FTA bias", failures);
assertMaxAbs(overall.metrics.simMinusExpectedBias.tov, thresholds.maxSimMinusExpectedTovBias, "sim-minus-expected TOV bias", failures);
assertMaxAbs(overall.metrics.simMinusExpectedBias.orb, thresholds.maxSimMinusExpectedOrbBias, "sim-minus-expected ORB bias", failures);

assertMaxAbs(overall.metrics.bias.pts, thresholds.maxStatBiasPts, "source-relative PTS bias", failures);
assertMaxAbs(overall.metrics.bias.fgPct, thresholds.maxStatBiasFgPct, "source-relative FG% bias", failures);
assertMaxAbs(overall.metrics.bias.threePa, thresholds.maxStatBiasThreePa, "source-relative 3PA bias", failures);
assertMaxAbs(overall.metrics.bias.fta, thresholds.maxStatBiasFta, "source-relative FTA bias", failures);
assertMaxAbs(overall.metrics.bias.tov, thresholds.maxStatBiasTov, "source-relative TOV bias", failures);
assertMaxAbs(overall.metrics.bias.orb, thresholds.maxStatBiasOrb, "source-relative ORB bias", failures);

if ((report.run?.gamesPerPair ?? 0) < 30) warnings.push("gamesPerPair is below 30; Monte Carlo checks may be noisy.");
if ((report.run?.pairsPerBucket ?? 0) < 120) warnings.push("pairsPerBucket is below 120; recency diagnostics may be noisy.");

const status = failures.length ? "FAIL" : "PASS";
console.log(`${status}: ${path.relative(process.cwd(), filePath)}`);
console.log(
  `Model ${report.run?.modelVersion ?? "unknown"}, seed=${report.run?.seed ?? "?"}, ` +
    `pairsPerBucket=${report.run?.pairsPerBucket ?? "?"}, gamesPerPair=${report.run?.gamesPerPair ?? "?"}`
);
console.log(
  `gapCoefficients: sim=${format(simMarginGap)}, expected=${format(expectedMarginGap)}, winRate=${format(winRateGap)}; ` +
    `nearEqualWin=${format(nearEqual.newerWinRate)}, overallWin=${format(overall.newerWinRate)}`
);
console.log(
  `simMinusExpectedBias: PTS=${format(overall.metrics.simMinusExpectedBias.pts)}, ` +
    `FGA=${format(overall.metrics.simMinusExpectedBias.fga)}, FTA=${format(overall.metrics.simMinusExpectedBias.fta)}, ` +
    `TOV=${format(overall.metrics.simMinusExpectedBias.tov)}, ORB=${format(overall.metrics.simMinusExpectedBias.orb)}`
);
for (const warning of warnings) console.warn(`WARN: ${warning}`);
for (const failure of failures) console.error(`FAIL: ${failure}`);

if (failures.length) process.exit(1);
