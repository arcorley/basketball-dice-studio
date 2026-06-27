import fs from "node:fs";
import path from "node:path";
import { buildExpectedMatchupLine, crossEraModelVersion, summarizeSimulations } from "../src/lib/diceEngine";
import { SeededRandom } from "../src/lib/random";
import type { DiceTeamCard, ExpectedPlayerLine, MatchupOptions, StatLine, TeamGamePlanOptions } from "../src/lib/types";
import { getDiceTeams } from "./sourceDataStatic";

type PlayerMetric = "pts" | "fga" | "threePa" | "fta" | "tov" | "orb" | "ast";

type Scenario = {
  id: string;
  label: string;
  tempoMultiplier?: number;
  awayPlan?: TeamGamePlanOptions;
};

type PlayerCheck = {
  scenarioId: string;
  awayId: string;
  homeId: string;
  teamId: string;
  team: string;
  player: string;
  expected: Record<PlayerMetric, number>;
  sim: Record<PlayerMetric, number>;
  delta: Record<PlayerMetric, number>;
};

type MetricSummary = {
  count: number;
  meanBias: number;
  meanAbs: number;
  p90Abs: number;
  maxAbs: number;
};

const metricFields: PlayerMetric[] = ["pts", "fga", "threePa", "fta", "tov", "orb", "ast"];
const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    return [key, value] as const;
  })
);

const seed = integerArg("seed", 8383);
const pairsPerBucket = integerArg("pairs-per-bucket", 2);
const gamesPerPair = integerArg("games-per-pair", 200);
const playersPerTeam = integerArg("players-per-team", 7);
const minExpectedFga = numberArg("min-expected-fga", 2);
const outputPath = path.resolve(
  args.get("output") ?? path.join(process.cwd(), "reports", `player-sim-convergence-${pairsPerBucket}x${gamesPerPair}-seed-${seed}.json`)
);
const markdownPath = path.resolve(args.get("markdown") ?? outputPath.replace(/\.json$/i, ".md"));

const thresholds: Record<PlayerMetric, { maxMeanAbs: number; maxMeanBias: number; maxP90Abs: number }> = {
  pts: {
    maxMeanAbs: numberArg("max-mean-abs-pts", 1.35),
    maxMeanBias: numberArg("max-mean-bias-pts", 0.55),
    maxP90Abs: numberArg("max-p90-abs-pts", 2.75)
  },
  fga: {
    maxMeanAbs: numberArg("max-mean-abs-fga", 0.8),
    maxMeanBias: numberArg("max-mean-bias-fga", 0.35),
    maxP90Abs: numberArg("max-p90-abs-fga", 1.65)
  },
  threePa: {
    maxMeanAbs: numberArg("max-mean-abs-3pa", 0.55),
    maxMeanBias: numberArg("max-mean-bias-3pa", 0.3),
    maxP90Abs: numberArg("max-p90-abs-3pa", 1.2)
  },
  fta: {
    maxMeanAbs: numberArg("max-mean-abs-fta", 0.55),
    maxMeanBias: numberArg("max-mean-bias-fta", 0.3),
    maxP90Abs: numberArg("max-p90-abs-fta", 1.2)
  },
  tov: {
    maxMeanAbs: numberArg("max-mean-abs-tov", 0.35),
    maxMeanBias: numberArg("max-mean-bias-tov", 0.2),
    maxP90Abs: numberArg("max-p90-abs-tov", 0.8)
  },
  orb: {
    maxMeanAbs: numberArg("max-mean-abs-orb", 0.3),
    maxMeanBias: numberArg("max-mean-bias-orb", 0.18),
    maxP90Abs: numberArg("max-p90-abs-orb", 0.75)
  },
  ast: {
    maxMeanAbs: numberArg("max-mean-abs-ast", 0.45),
    maxMeanBias: numberArg("max-mean-bias-ast", 0.25),
    maxP90Abs: numberArg("max-p90-abs-ast", 1)
  }
};

const bucketDefs = [
  { label: "1-4 years", minGap: 1, maxGap: 4 },
  { label: "5-9 years", minGap: 5, maxGap: 9 },
  { label: "10-14 years", minGap: 10, maxGap: 14 },
  { label: "15-19 years", minGap: 15, maxGap: 19 },
  { label: "20+ years", minGap: 20, maxGap: Number.POSITIVE_INFINITY }
];

const scenarios: Scenario[] = [
  { id: "baseline", label: "Baseline" },
  {
    id: "usage-three-foul",
    label: "Usage + three + foul pressure",
    awayPlan: { usageConcentration: 1.2, threePointEmphasis: 4, foulPressure: 2 }
  },
  {
    id: "tempo-security-boards",
    label: "Tempo + boards + ball security",
    tempoMultiplier: 1.08,
    awayPlan: { crashBoards: 3, ballSecurity: 3 }
  }
];

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

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index];
}

function baseOptions(scenario: Scenario): MatchupOptions {
  return {
    venue: "neutral",
    intensity: "regular",
    eraContext: { mode: "midpoint" },
    gameplay:
      scenario.tempoMultiplier !== undefined || scenario.awayPlan
        ? {
            tempoMultiplier: scenario.tempoMultiplier ?? 1,
            away: scenario.awayPlan
          }
        : undefined
  };
}

function randomPairForBucket(teams: DiceTeamCard[], rng: SeededRandom, minGap: number, maxGap: number): [DiceTeamCard, DiceTeamCard] {
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const a = teams[Math.floor(rng.next() * teams.length)];
    const b = teams[Math.floor(rng.next() * teams.length)];
    if (!a || !b || a.id === b.id) continue;
    const gap = Math.abs(a.source.seasonEndYear - b.source.seasonEndYear);
    if (gap < minGap || gap > maxGap) continue;
    return a.source.seasonEndYear > b.source.seasonEndYear ? [a, b] : [b, a];
  }
  throw new Error(`Could not sample pair for gap ${minGap}-${maxGap}`);
}

function selectedPairs(): Array<[DiceTeamCard, DiceTeamCard]> {
  const rng = new SeededRandom(seed);
  const teams = getDiceTeams();
  const seen = new Set<string>();
  const pairs: Array<[DiceTeamCard, DiceTeamCard]> = [];

  for (const bucket of bucketDefs) {
    let count = 0;
    while (count < pairsPerBucket) {
      const pair = randomPairForBucket(teams, rng, bucket.minGap, bucket.maxGap);
      const key = `${pair[0].id}|${pair[1].id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push(pair);
      count += 1;
    }
  }
  return pairs;
}

function expectedMetrics(line: ExpectedPlayerLine): Record<PlayerMetric, number> {
  return {
    pts: line.pts,
    fga: line.fga,
    threePa: line.threePa,
    fta: line.fta,
    tov: line.tov,
    orb: line.orb,
    ast: line.ast
  };
}

function simMetrics(line: StatLine): Record<PlayerMetric, number> {
  return {
    pts: line.PTS ?? 0,
    fga: line.FGA ?? 0,
    threePa: line["3PA"] ?? 0,
    fta: line.FTA ?? 0,
    tov: line.TOV ?? 0,
    orb: line.OREB ?? 0,
    ast: line.AST ?? 0
  };
}

function metricDelta(left: Record<PlayerMetric, number>, right: Record<PlayerMetric, number>): Record<PlayerMetric, number> {
  return Object.fromEntries(metricFields.map((field) => [field, fixed(left[field] - right[field])])) as Record<PlayerMetric, number>;
}

function roundedMetrics(input: Record<PlayerMetric, number>): Record<PlayerMetric, number> {
  return Object.fromEntries(metricFields.map((field) => [field, fixed(input[field])])) as Record<PlayerMetric, number>;
}

function trackedPlayers(players: ExpectedPlayerLine[]): ExpectedPlayerLine[] {
  return [...players]
    .filter((player) => player.fga >= minExpectedFga)
    .sort((a, b) => b.fga - a.fga || b.pts - a.pts || a.player.localeCompare(b.player))
    .slice(0, playersPerTeam);
}

function runPairScenario(away: DiceTeamCard, home: DiceTeamCard, pairIndex: number, scenario: Scenario): PlayerCheck[] {
  const options = baseOptions(scenario);
  const expected = buildExpectedMatchupLine(away, home, options);
  const summary = summarizeSimulations(away, home, gamesPerPair, seed * 100_000 + pairIndex * 100 + scenarios.indexOf(scenario) + 1, options);
  const checks: PlayerCheck[] = [];

  for (const [team, teamLine] of [
    [away, expected.away],
    [home, expected.home]
  ] as const) {
    for (const playerLine of trackedPlayers(teamLine.players)) {
      const sim = simMetrics(summary.players[team.id]?.[playerLine.player] ?? {});
      const expectedLine = expectedMetrics(playerLine);
      checks.push({
        scenarioId: scenario.id,
        awayId: away.id,
        homeId: home.id,
        teamId: team.id,
        team: team.shortName,
        player: playerLine.player,
        expected: roundedMetrics(expectedLine),
        sim: roundedMetrics(sim),
        delta: metricDelta(sim, expectedLine)
      });
    }
  }

  return checks;
}

function metricSummaries(checks: PlayerCheck[]): Record<PlayerMetric, MetricSummary> {
  return Object.fromEntries(
    metricFields.map((field) => {
      const deltas = checks.map((check) => check.delta[field]);
      const abs = deltas.map((value) => Math.abs(value));
      return [
        field,
        {
          count: deltas.length,
          meanBias: fixed(mean(deltas)),
          meanAbs: fixed(mean(abs)),
          p90Abs: fixed(percentile(abs, 0.9)),
          maxAbs: fixed(Math.max(0, ...abs))
        }
      ];
    })
  ) as Record<PlayerMetric, MetricSummary>;
}

function failuresForSummary(summary: Record<PlayerMetric, MetricSummary>): string[] {
  const failures: string[] = [];
  for (const field of metricFields) {
    const metric = summary[field];
    const threshold = thresholds[field];
    if (metric.meanAbs > threshold.maxMeanAbs) {
      failures.push(`${field} meanAbs ${metric.meanAbs} exceeds ${threshold.maxMeanAbs}`);
    }
    if (Math.abs(metric.meanBias) > threshold.maxMeanBias) {
      failures.push(`${field} meanBias ${metric.meanBias} exceeds +/-${threshold.maxMeanBias}`);
    }
    if (metric.p90Abs > threshold.maxP90Abs) {
      failures.push(`${field} p90Abs ${metric.p90Abs} exceeds ${threshold.maxP90Abs}`);
    }
  }
  return failures;
}

function worstChecks(checks: PlayerCheck[], field: PlayerMetric, count = 8): Array<PlayerCheck & { absError: number }> {
  return [...checks]
    .map((check) => ({ ...check, absError: fixed(Math.abs(check.delta[field])) }))
    .sort((a, b) => b.absError - a.absError || a.player.localeCompare(b.player))
    .slice(0, count);
}

function markdown(report: {
  generatedAt: string;
  status: string;
  run: Record<string, unknown>;
  summaries: Record<string, Record<PlayerMetric, MetricSummary>>;
  failures: Record<string, string[]>;
  worst: Record<string, Record<PlayerMetric, Array<PlayerCheck & { absError: number }>>>;
}): string {
  const lines = [
    "# Player Sim Convergence",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Status: ${report.status.toUpperCase()}`,
    "",
    `Pairs per bucket: ${pairsPerBucket}; games per pair: ${gamesPerPair}; players per team: ${playersPerTeam}; min expected FGA: ${minExpectedFga}`,
    ""
  ];

  for (const scenario of scenarios) {
    lines.push(`## ${scenario.label}`, "", "| Metric | Mean bias | Mean abs | P90 abs | Max abs |", "| --- | ---: | ---: | ---: | ---: |");
    for (const field of metricFields) {
      const row = report.summaries[scenario.id][field];
      lines.push(`| ${field} | ${row.meanBias} | ${row.meanAbs} | ${row.p90Abs} | ${row.maxAbs} |`);
    }
    const scenarioFailures = report.failures[scenario.id];
    if (scenarioFailures.length) {
      lines.push("", "Failures:");
      for (const failure of scenarioFailures) lines.push(`- ${failure}`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

const started = Date.now();
const pairs = selectedPairs();
const checksByScenario = Object.fromEntries(scenarios.map((scenario) => [scenario.id, [] as PlayerCheck[]]));

for (let index = 0; index < pairs.length; index += 1) {
  const [away, home] = pairs[index];
  for (const scenario of scenarios) {
    checksByScenario[scenario.id].push(...runPairScenario(away, home, index, scenario));
  }
}

const summaries = Object.fromEntries(scenarios.map((scenario) => [scenario.id, metricSummaries(checksByScenario[scenario.id])])) as Record<
  string,
  Record<PlayerMetric, MetricSummary>
>;
const failures = Object.fromEntries(scenarios.map((scenario) => [scenario.id, failuresForSummary(summaries[scenario.id])])) as Record<string, string[]>;
const worst = Object.fromEntries(
  scenarios.map((scenario) => [
    scenario.id,
    Object.fromEntries(metricFields.map((field) => [field, worstChecks(checksByScenario[scenario.id], field)])) as Record<
      PlayerMetric,
      Array<PlayerCheck & { absError: number }>
    >
  ])
);
const status = Object.values(failures).some((items) => items.length) ? "fail" : "pass";
const report = {
  generatedAt: new Date().toISOString(),
  run: {
    modelVersion: crossEraModelVersion,
    seed,
    pairsPerBucket,
    gamesPerPair,
    playersPerTeam,
    minExpectedFga,
    pairCount: pairs.length,
    scenarioCount: scenarios.length,
    playerLineCount: Object.values(checksByScenario).reduce((sum, checks) => sum + checks.length, 0),
    elapsedSeconds: fixed((Date.now() - started) / 1000, 1)
  },
  thresholds,
  status,
  summaries,
  failures,
  checks: checksByScenario,
  worst
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(markdownPath, markdown(report));

console.log(`${status.toUpperCase()}: ${path.relative(process.cwd(), outputPath)}`);
console.log(`Markdown summary: ${path.relative(process.cwd(), markdownPath)}`);
console.log(`Run: ${pairs.length} pairs x ${gamesPerPair} games x ${scenarios.length} scenarios, ${report.run.elapsedSeconds}s`);
for (const scenario of scenarios) {
  const parts = metricFields.map((field) => `${field}.meanAbs=${summaries[scenario.id][field].meanAbs}`).join(", ");
  console.log(`${failures[scenario.id].length ? "FAIL" : "PASS"} ${scenario.label}: ${parts}`);
  for (const failure of failures[scenario.id]) console.error(`FAIL ${scenario.label}: ${failure}`);
}
if (status === "fail") process.exit(1);
