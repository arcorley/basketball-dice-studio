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

type TeamMetricResult = {
  sim: TeamBoxMetrics;
  expected: TeamBoxMetrics;
  source: TeamBoxMetrics;
  simMinusExpected: TeamBoxMetrics;
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
  newerWinRate: number;
  newerAvgMargin: number;
  expectedNewerAvgMargin: number;
  simMinusExpectedMargin: number;
  cardPowerDelta: number;
  totalShotAdjustmentDelta: number;
  turnoverTargetDelta: number;
  foulDrawTargetDelta: number;
  threeAttemptTargetDelta: number;
  orbChanceDelta: number;
  metrics: {
    newer: TeamMetricResult;
    older: TeamMetricResult;
    simMinusExpectedBias: TeamBoxMetrics;
  };
};

type CrossEraReport = {
  generatedAt?: string;
  run?: {
    modelVersion?: string;
    seed?: number;
    pairsPerBucket?: number;
    gamesPerPair?: number;
  };
  buckets?: Array<{
    label: string;
    pairs: PairResult[];
  }>;
};

type GroupSummary = {
  id: string;
  label: string;
  kind: string;
  pairCount: number;
  gameCount: number;
  avgGap: number;
  newerWinRate: number;
  newerAvgMargin: number;
  expectedNewerAvgMargin: number;
  simMinusExpectedMargin: number;
  pairRelativeBias: Pick<TeamBoxMetrics, "pts" | "fga" | "threePa" | "fta" | "tov" | "orb">;
  teamLineSimMinusExpected: Pick<TeamBoxMetrics, "pts" | "fga" | "threePa" | "fta" | "tov" | "orb">;
  failures: string[];
};

const metricFields = ["pts", "fga", "threePa", "fta", "tov", "orb"] as const;
const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    return [key, value] as const;
  })
);

const inputPath = path.resolve(args.get("report") ?? path.join(process.cwd(), "reports", "cross-era-model-current-240x50-seed-7777.json"));
const outputPath = path.resolve(args.get("output") ?? path.join(process.cwd(), "reports", "model-residual-diagnostics.json"));
const markdownPath = path.resolve(args.get("markdown") ?? outputPath.replace(/\.json$/i, ".md"));
const minPairs = integerArg("min-pairs", 50);

const thresholds = {
  maxGroupMarginBias: numberArg("max-group-margin-bias", 0.85),
  maxGroupPtsBias: numberArg("max-group-pts-bias", 0.75),
  maxGroupFgaBias: numberArg("max-group-fga-bias", 0.65),
  maxGroupThreePaBias: numberArg("max-group-3pa-bias", 0.6),
  maxGroupFtaBias: numberArg("max-group-fta-bias", 0.65),
  maxGroupTovBias: numberArg("max-group-tov-bias", 0.35),
  maxGroupOrbBias: numberArg("max-group-orb-bias", 0.35),
  maxTeamLinePtsBias: numberArg("max-team-line-pts-bias", 0.45),
  maxTeamLineFgaBias: numberArg("max-team-line-fga-bias", 0.45),
  maxTeamLineThreePaBias: numberArg("max-team-line-3pa-bias", 0.35),
  maxTeamLineFtaBias: numberArg("max-team-line-fta-bias", 0.45),
  maxTeamLineTovBias: numberArg("max-team-line-tov-bias", 0.25),
  maxTeamLineOrbBias: numberArg("max-team-line-orb-bias", 0.25)
};

function numberArg(name: string, fallback: number): number {
  const value = args.get(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid --${name}: ${value}`);
  return parsed;
}

function integerArg(name: string, fallback: number): number {
  const parsed = numberArg(name, fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Invalid --${name}: ${parsed}`);
  return parsed;
}

function fixed(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

function mean<T>(items: T[], value: (item: T) => number): number {
  return items.length ? items.reduce((sum, item) => sum + value(item), 0) / items.length : 0;
}

function weightedMean<T>(items: T[], value: (item: T) => number, weight: (item: T) => number): number {
  const totalWeight = items.reduce((sum, item) => sum + weight(item), 0);
  return totalWeight > 0 ? items.reduce((sum, item) => sum + value(item) * weight(item), 0) / totalWeight : 0;
}

function metricPick(value: (field: (typeof metricFields)[number]) => number): Pick<TeamBoxMetrics, "pts" | "fga" | "threePa" | "fta" | "tov" | "orb"> {
  return Object.fromEntries(metricFields.map((field) => [field, fixed(value(field))])) as Pick<
    TeamBoxMetrics,
    "pts" | "fga" | "threePa" | "fta" | "tov" | "orb"
  >;
}

function decadeLabel(seasonEndYear: number): string {
  if (seasonEndYear < 2000) return "1990s";
  if (seasonEndYear < 2010) return "2000s";
  if (seasonEndYear < 2020) return "2010s";
  return "2020s";
}

function quantileGroups(pairs: PairResult[], kind: string, label: string, value: (pair: PairResult) => number): Array<[string, string, PairResult[]]> {
  const sorted = [...pairs].sort((a, b) => value(a) - value(b));
  const third = Math.floor(sorted.length / 3);
  return [
    [`${kind}-low`, `${label}: low`, sorted.slice(0, third)],
    [`${kind}-mid`, `${label}: middle`, sorted.slice(third, sorted.length - third)],
    [`${kind}-high`, `${label}: high`, sorted.slice(sorted.length - third)]
  ];
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) out.set(key(item), [...(out.get(key(item)) ?? []), item]);
  return out;
}

function summarizeGroup(id: string, label: string, kind: string, pairs: PairResult[]): GroupSummary {
  const gameWeight = (pair: PairResult) => pair.games;
  const teamLines = pairs.flatMap((pair) => [
    { pair, line: pair.metrics.newer.simMinusExpected },
    { pair, line: pair.metrics.older.simMinusExpected }
  ]);
  const pairRelativeBias = metricPick((field) => weightedMean(pairs, (pair) => pair.metrics.simMinusExpectedBias[field], gameWeight));
  const teamLineSimMinusExpected = metricPick((field) => weightedMean(teamLines, (item) => item.line[field], (item) => item.pair.games));
  const failures: string[] = [];

  function check(value: number, threshold: number, labelText: string): void {
    if (pairs.length >= minPairs && Math.abs(value) > threshold) failures.push(`${labelText} ${value} exceeds +/-${threshold}`);
  }

  check(fixed(weightedMean(pairs, (pair) => pair.simMinusExpectedMargin, gameWeight)), thresholds.maxGroupMarginBias, "margin bias");
  check(pairRelativeBias.pts, thresholds.maxGroupPtsBias, "pair-relative PTS bias");
  check(pairRelativeBias.fga, thresholds.maxGroupFgaBias, "pair-relative FGA bias");
  check(pairRelativeBias.threePa, thresholds.maxGroupThreePaBias, "pair-relative 3PA bias");
  check(pairRelativeBias.fta, thresholds.maxGroupFtaBias, "pair-relative FTA bias");
  check(pairRelativeBias.tov, thresholds.maxGroupTovBias, "pair-relative TOV bias");
  check(pairRelativeBias.orb, thresholds.maxGroupOrbBias, "pair-relative ORB bias");
  check(teamLineSimMinusExpected.pts, thresholds.maxTeamLinePtsBias, "team-line PTS bias");
  check(teamLineSimMinusExpected.fga, thresholds.maxTeamLineFgaBias, "team-line FGA bias");
  check(teamLineSimMinusExpected.threePa, thresholds.maxTeamLineThreePaBias, "team-line 3PA bias");
  check(teamLineSimMinusExpected.fta, thresholds.maxTeamLineFtaBias, "team-line FTA bias");
  check(teamLineSimMinusExpected.tov, thresholds.maxTeamLineTovBias, "team-line TOV bias");
  check(teamLineSimMinusExpected.orb, thresholds.maxTeamLineOrbBias, "team-line ORB bias");

  return {
    id,
    label,
    kind,
    pairCount: pairs.length,
    gameCount: pairs.reduce((sum, pair) => sum + pair.games, 0),
    avgGap: fixed(mean(pairs, (pair) => pair.gap), 2),
    newerWinRate: fixed(weightedMean(pairs, (pair) => pair.newerWinRate, gameWeight)),
    newerAvgMargin: fixed(weightedMean(pairs, (pair) => pair.newerAvgMargin, gameWeight)),
    expectedNewerAvgMargin: fixed(weightedMean(pairs, (pair) => pair.expectedNewerAvgMargin, gameWeight)),
    simMinusExpectedMargin: fixed(weightedMean(pairs, (pair) => pair.simMinusExpectedMargin, gameWeight)),
    pairRelativeBias,
    teamLineSimMinusExpected,
    failures
  };
}

function markdown(report: {
  generatedAt: string;
  inputReport: string;
  status: string;
  groups: GroupSummary[];
}): string {
  const lines = [
    "# Model Residual Diagnostics",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Input: ${report.inputReport}`,
    "",
    `Status: ${report.status.toUpperCase()}`,
    "",
    "| Group | Pairs | Sim-exp margin | Pair PTS/FGA/3PA/FTA/TOV/ORB | Team PTS/FGA/3PA/FTA/TOV/ORB |",
    "| --- | ---: | ---: | --- | --- |"
  ];

  for (const group of report.groups) {
    const pairMetrics = metricFields.map((field) => group.pairRelativeBias[field]).join(" / ");
    const teamMetrics = metricFields.map((field) => group.teamLineSimMinusExpected[field]).join(" / ");
    lines.push(`| ${group.label} | ${group.pairCount} | ${group.simMinusExpectedMargin} | ${pairMetrics} | ${teamMetrics} |`);
  }

  const failures = report.groups.filter((group) => group.failures.length);
  if (failures.length) {
    lines.push("", "## Failures");
    for (const group of failures) {
      lines.push("", `### ${group.label}`);
      for (const failure of group.failures) lines.push(`- ${failure}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

const started = Date.now();
const input = JSON.parse(fs.readFileSync(inputPath, "utf8")) as CrossEraReport;
const pairs = (input.buckets ?? []).flatMap((bucket) => bucket.pairs ?? []);
if (!pairs.length) throw new Error(`${inputPath} has no bucket pair data`);

const groupSpecs: Array<[string, string, string, PairResult[]]> = [];
groupSpecs.push(["all", "Overall", "overall", pairs]);
for (const [label, items] of groupBy(pairs, (pair) => `${pair.gap <= 4 ? "1-4 years" : pair.gap <= 9 ? "5-9 years" : pair.gap <= 14 ? "10-14 years" : pair.gap <= 19 ? "15-19 years" : "20+ years"}`)) {
  groupSpecs.push([`gap-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, `Gap ${label}`, "gap", items]);
}
for (const [label, items] of groupBy(pairs, (pair) => `Newer ${decadeLabel(pair.newerSeason)}`)) {
  groupSpecs.push([`era-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, label, "newer-era", items]);
}
for (const [id, label, items] of quantileGroups(pairs, "card-power", "Card power delta", (pair) => pair.cardPowerDelta)) {
  groupSpecs.push([id, label, "card-power", items]);
}
for (const [id, label, items] of quantileGroups(pairs, "three-delta", "3PA target delta", (pair) => pair.threeAttemptTargetDelta)) {
  groupSpecs.push([id, label, "style-three", items]);
}
for (const [id, label, items] of quantileGroups(pairs, "foul-delta", "FTA target delta", (pair) => pair.foulDrawTargetDelta)) {
  groupSpecs.push([id, label, "style-foul", items]);
}
for (const [id, label, items] of quantileGroups(pairs, "tov-delta", "TOV target delta", (pair) => pair.turnoverTargetDelta)) {
  groupSpecs.push([id, label, "style-tov", items]);
}
for (const [id, label, items] of quantileGroups(pairs, "orb-delta", "ORB chance delta", (pair) => pair.orbChanceDelta)) {
  groupSpecs.push([id, label, "style-orb", items]);
}
for (const [id, label, items] of quantileGroups(pairs, "shot-delta", "Shot adjustment delta", (pair) => pair.totalShotAdjustmentDelta)) {
  groupSpecs.push([id, label, "style-shot", items]);
}

const groups = groupSpecs.map(([id, label, kind, items]) => summarizeGroup(id, label, kind, items));
const status = groups.some((group) => group.failures.length) ? "fail" : "pass";
const report = {
  generatedAt: new Date().toISOString(),
  inputReport: path.relative(process.cwd(), inputPath),
  run: {
    modelVersion: input.run?.modelVersion ?? "unknown",
    seed: input.run?.seed ?? null,
    pairsPerBucket: input.run?.pairsPerBucket ?? null,
    gamesPerPair: input.run?.gamesPerPair ?? null,
    pairCount: pairs.length,
    elapsedSeconds: fixed((Date.now() - started) / 1000, 1)
  },
  thresholds: {
    minPairs,
    ...thresholds
  },
  status,
  groups
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(markdownPath, markdown({ generatedAt: report.generatedAt, inputReport: report.inputReport, status, groups }));

console.log(`${status.toUpperCase()}: ${path.relative(process.cwd(), outputPath)}`);
console.log(`Markdown summary: ${path.relative(process.cwd(), markdownPath)}`);
console.log(`Groups: ${groups.length}; failures=${groups.reduce((sum, group) => sum + group.failures.length, 0)}`);
for (const group of groups.filter((item) => item.failures.length)) {
  for (const failure of group.failures) console.error(`FAIL ${group.label}: ${failure}`);
}
if (status === "fail") process.exit(1);
