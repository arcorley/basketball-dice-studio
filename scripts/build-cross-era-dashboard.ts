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
  generatedAt?: string;
  run?: {
    modelVersion?: string;
    seed?: number;
    pairsPerBucket?: number;
    gamesPerPair?: number;
    matchupOptions?: unknown;
    elapsedSeconds?: number;
  };
  summary?: {
    overall?: Aggregate;
    nearEqualCardPower?: Aggregate;
  };
  diagnostics?: {
    regressions?: RegressionSummary[];
  };
};

type DashboardRow = {
  file: string;
  generatedAt: string | null;
  modelVersion: string;
  seed: number | null;
  pairsPerBucket: number | null;
  gamesPerPair: number | null;
  guardrailStatus: "pass" | "fail";
  failures: string[];
  overall: {
    pairCount: number;
    gameCount: number;
    newerWinRate: number;
    newerWinRateBias: number;
    newerAvgMargin: number;
    expectedNewerAvgMargin: number;
    simMinusExpectedMargin: number;
  };
  nearEqualCardPower: {
    newerWinRate: number;
    newerWinRateBias: number;
    newerAvgMargin: number;
    expectedNewerAvgMargin: number;
  };
  simMinusExpectedBias: TeamBoxMetrics;
  sourceRelativeBias: TeamBoxMetrics;
  regressions: {
    simMarginGap: number | null;
    expectedMarginGap: number | null;
    winRateGap: number | null;
  };
};

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    return [key, value] as const;
  })
);

const outputPath = path.resolve(args.get("output") ?? path.join(process.cwd(), "reports", "cross-era-dashboard.json"));
const markdownPath = path.resolve(args.get("markdown") ?? outputPath.replace(/\.json$/i, ".md"));

const thresholds = {
  maxOverallWinBias: numberArg("max-overall-win-bias", 0.02),
  minNearEqualWinRate: numberArg("min-near-equal-win", 0.485),
  maxNearEqualWinRate: numberArg("max-near-equal-win", 0.515),
  maxSimMinusExpectedMargin: numberArg("max-sim-minus-expected-margin", 0.35),
  maxSimMinusExpectedPtsBias: numberArg("max-sim-minus-expected-pts-bias", 0.35),
  maxSimMinusExpectedFgaBias: numberArg("max-sim-minus-expected-fga-bias", 0.35),
  maxSimMinusExpectedFtaBias: numberArg("max-sim-minus-expected-fta-bias", 0.35),
  maxSimMinusExpectedTovBias: numberArg("max-sim-minus-expected-tov-bias", 0.2),
  maxSimMinusExpectedOrbBias: numberArg("max-sim-minus-expected-orb-bias", 0.2),
  maxMarginGapCoefficient: numberArg("max-margin-gap-coeff", 0.01),
  maxExpectedGapCoefficient: numberArg("max-expected-gap-coeff", 0.01),
  maxWinRateGapCoefficient: numberArg("max-win-gap-coeff", 0.001)
};

function numberArg(name: string, fallback: number): number {
  const value = args.get(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid --${name}: ${value}`);
  return parsed;
}

function defaultReportPaths(): string[] {
  const reportsDir = path.join(process.cwd(), "reports");
  if (!fs.existsSync(reportsDir)) return [];
  const pattern = args.get("include-analysis") === "true" ? /^cross-era-(model|analysis)-.*\.json$/ : /^cross-era-model-.*\.json$/;
  return fs
    .readdirSync(reportsDir)
    .filter((file) => pattern.test(file))
    .map((file) => path.join(reportsDir, file))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

function selectedReportPaths(): string[] {
  const reportsArg = args.get("reports") ?? args.get("report");
  if (!reportsArg) return defaultReportPaths();
  return reportsArg
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => path.resolve(entry));
}

function readReport(filePath: string): CrossEraReport {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as CrossEraReport;
}

function regression(report: CrossEraReport, label: string): number | null {
  const value = report.diagnostics?.regressions?.find((item) => item.label === label)?.coefficients.gap;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function metric(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;
}

function metricBlock(input: TeamBoxMetrics | undefined): TeamBoxMetrics {
  return {
    pts: metric(input?.pts),
    fga: metric(input?.fga),
    fgPct: metric(input?.fgPct),
    threePa: metric(input?.threePa),
    threePct: metric(input?.threePct),
    fta: metric(input?.fta),
    ftPct: metric(input?.ftPct),
    tov: metric(input?.tov),
    orb: metric(input?.orb),
    poss: metric(input?.poss)
  };
}

function maxAbs(value: number | null, max: number, label: string, failures: string[]): void {
  if (value === null || !Number.isFinite(value)) {
    failures.push(`${label} missing`);
    return;
  }
  if (Math.abs(value) > max) failures.push(`${label}=${format(value)} exceeds +/-${format(max)}`);
}

function between(value: number, min: number, max: number, label: string, failures: string[]): void {
  if (!Number.isFinite(value)) {
    failures.push(`${label} missing`);
    return;
  }
  if (value < min || value > max) failures.push(`${label}=${format(value)} outside ${format(min)}-${format(max)}`);
}

function format(value: number | null, digits = 4): string {
  if (value === null || !Number.isFinite(value)) return "-";
  return Number(value.toFixed(digits)).toString();
}

function dashboardRow(filePath: string): DashboardRow {
  const report = readReport(filePath);
  const overall = report.summary?.overall;
  const nearEqual = report.summary?.nearEqualCardPower;
  if (!overall || !nearEqual) {
    throw new Error(`${filePath} is missing summary.overall or summary.nearEqualCardPower`);
  }

  const simMarginGap = regression(report, "sim_margin_vs_card_power_gap");
  const expectedMarginGap = regression(report, "expected_margin_vs_card_power_gap");
  const winRateGap = regression(report, "newer_win_rate_vs_card_power_gap");
  const simMinusExpectedBias = metricBlock(overall.metrics?.simMinusExpectedBias);
  const sourceRelativeBias = metricBlock(overall.metrics?.bias);
  const failures: string[] = [];

  maxAbs(overall.newerWinRate - 0.5, thresholds.maxOverallWinBias, "overall newer win-rate bias", failures);
  between(nearEqual.newerWinRate, thresholds.minNearEqualWinRate, thresholds.maxNearEqualWinRate, "near-equal newer win rate", failures);
  maxAbs(overall.avgSimMinusExpectedMargin, thresholds.maxSimMinusExpectedMargin, "sim-minus-expected margin", failures);
  maxAbs(simMinusExpectedBias.pts, thresholds.maxSimMinusExpectedPtsBias, "sim-minus-expected PTS", failures);
  maxAbs(simMinusExpectedBias.fga, thresholds.maxSimMinusExpectedFgaBias, "sim-minus-expected FGA", failures);
  maxAbs(simMinusExpectedBias.fta, thresholds.maxSimMinusExpectedFtaBias, "sim-minus-expected FTA", failures);
  maxAbs(simMinusExpectedBias.tov, thresholds.maxSimMinusExpectedTovBias, "sim-minus-expected TOV", failures);
  maxAbs(simMinusExpectedBias.orb, thresholds.maxSimMinusExpectedOrbBias, "sim-minus-expected ORB", failures);
  maxAbs(simMarginGap, thresholds.maxMarginGapCoefficient, "sim margin gap coefficient", failures);
  maxAbs(expectedMarginGap, thresholds.maxExpectedGapCoefficient, "expected margin gap coefficient", failures);
  maxAbs(winRateGap, thresholds.maxWinRateGapCoefficient, "win-rate gap coefficient", failures);

  return {
    file: path.relative(process.cwd(), filePath),
    generatedAt: report.generatedAt ?? null,
    modelVersion: report.run?.modelVersion ?? "unknown",
    seed: report.run?.seed ?? null,
    pairsPerBucket: report.run?.pairsPerBucket ?? null,
    gamesPerPair: report.run?.gamesPerPair ?? null,
    guardrailStatus: failures.length ? "fail" : "pass",
    failures,
    overall: {
      pairCount: overall.pairCount,
      gameCount: overall.gameCount,
      newerWinRate: overall.newerWinRate,
      newerWinRateBias: overall.newerWinRate - 0.5,
      newerAvgMargin: overall.newerAvgMargin,
      expectedNewerAvgMargin: overall.avgExpectedNewerMargin,
      simMinusExpectedMargin: overall.avgSimMinusExpectedMargin
    },
    nearEqualCardPower: {
      newerWinRate: nearEqual.newerWinRate,
      newerWinRateBias: nearEqual.newerWinRate - 0.5,
      newerAvgMargin: nearEqual.newerAvgMargin,
      expectedNewerAvgMargin: nearEqual.avgExpectedNewerMargin
    },
    simMinusExpectedBias,
    sourceRelativeBias,
    regressions: {
      simMarginGap,
      expectedMarginGap,
      winRateGap
    }
  };
}

function markdown(rows: DashboardRow[]): string {
  const lines = [
    "# Cross-Era Calibration Dashboard",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "| Report | Status | Overall newer win | Near-equal newer win | Sim-exp margin | PTS/FGA/FTA/TOV/ORB sim-exp | Gap coeffs sim/exp/win |",
    "| --- | --- | ---: | ---: | ---: | --- | --- |"
  ];
  for (const row of rows) {
    lines.push(
      `| ${row.file} | ${row.guardrailStatus.toUpperCase()} | ${format(row.overall.newerWinRate)} | ${format(row.nearEqualCardPower.newerWinRate)} | ${format(row.overall.simMinusExpectedMargin)} | ` +
        `${format(row.simMinusExpectedBias.pts)}/${format(row.simMinusExpectedBias.fga)}/${format(row.simMinusExpectedBias.fta)}/${format(row.simMinusExpectedBias.tov)}/${format(row.simMinusExpectedBias.orb)} | ` +
        `${format(row.regressions.simMarginGap)}/${format(row.regressions.expectedMarginGap)}/${format(row.regressions.winRateGap, 5)} |`
    );
  }
  const failed = rows.filter((row) => row.failures.length);
  if (failed.length) {
    lines.push("", "## Failures");
    for (const row of failed) {
      lines.push("", `### ${row.file}`);
      for (const failure of row.failures) lines.push(`- ${failure}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

const reports = selectedReportPaths();
if (!reports.length) throw new Error("No cross-era reports found. Run npm run analyze:cross-era first.");

const rows = reports.map(dashboardRow);
const dashboard = {
  generatedAt: new Date().toISOString(),
  thresholds,
  reportCount: rows.length,
  passCount: rows.filter((row) => row.guardrailStatus === "pass").length,
  failCount: rows.filter((row) => row.guardrailStatus === "fail").length,
  rows
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(dashboard, null, 2)}\n`);
fs.writeFileSync(markdownPath, markdown(rows));

console.log(`Cross-era dashboard: ${path.relative(process.cwd(), outputPath)}`);
console.log(`Markdown summary: ${path.relative(process.cwd(), markdownPath)}`);
console.log(`Reports: ${rows.length}, pass=${dashboard.passCount}, fail=${dashboard.failCount}`);
