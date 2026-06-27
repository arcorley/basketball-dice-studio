import fs from "node:fs";
import path from "node:path";
import { buildExpectedMatchupLine, buildMatchupCard, crossEraModelVersion, summarizeSimulations } from "../src/lib/diceEngine";
import { SeededRandom } from "../src/lib/random";
import type { DiceTeamCard, MatchupCard, MatchupOptions, StatLine, TeamGamePlanOptions } from "../src/lib/types";
import { getDiceTeams } from "./sourceDataStatic";

type TeamMetrics = {
  pts: number;
  fga: number;
  threePa: number;
  fta: number;
  tov: number;
  orb: number;
  poss: number;
};

type ScenarioMetric = keyof TeamMetrics | "topUseShare";

type Scenario = {
  id: string;
  label: string;
  metric: ScenarioMetric;
  direction: 1 | -1;
  tempoMultiplier?: number;
  awayPlan?: TeamGamePlanOptions;
  maxMeanError?: number;
  minDirectionPassRate: number;
};

type PairResult = {
  awayId: string;
  homeId: string;
  away: string;
  home: string;
  awaySeason: number;
  homeSeason: number;
  gap: number;
  trackedPlayer: string;
  baselineExpected: number;
  scenarioExpected: number;
  expectedDelta: number;
  baselineSim: number;
  scenarioSim: number;
  simDelta: number;
  simMinusExpectedDelta: number | null;
  directionPassed: boolean;
};

type BaselinePairState = {
  matchup: MatchupCard;
  expectedLine: ReturnType<typeof buildExpectedMatchupLine>;
  summary: ReturnType<typeof summarizeSimulations>;
  trackedPlayer: string;
};

type ScenarioSummary = {
  id: string;
  label: string;
  metric: ScenarioMetric;
  direction: 1 | -1;
  pairCount: number;
  gameCount: number;
  meanExpectedDelta: number;
  meanSimDelta: number;
  meanSimMinusExpectedDelta: number | null;
  meanAbsError: number | null;
  directionPassRate: number;
  status: "pass" | "fail";
  failures: string[];
};

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    return [key, value] as const;
  })
);

const seed = numberArg("seed", 8282);
const pairsPerBucket = integerArg("pairs-per-bucket", 8);
const gamesPerScenario = integerArg("games-per-scenario", 150);
const outputPath = path.resolve(
  args.get("output") ?? path.join(process.cwd(), "reports", `gameplay-lever-sweep-${pairsPerBucket}x${gamesPerScenario}-seed-${seed}.json`)
);
const markdownPath = path.resolve(args.get("markdown") ?? outputPath.replace(/\.json$/i, ".md"));

const bucketDefs = [
  { label: "1-4 years", minGap: 1, maxGap: 4 },
  { label: "5-9 years", minGap: 5, maxGap: 9 },
  { label: "10-14 years", minGap: 10, maxGap: 14 },
  { label: "15-19 years", minGap: 15, maxGap: 19 },
  { label: "20+ years", minGap: 20, maxGap: Number.POSITIVE_INFINITY }
];

const scenarios: Scenario[] = [
  {
    id: "tempo-plus-10",
    label: "Tempo +10%",
    metric: "poss",
    direction: 1,
    tempoMultiplier: 1.1,
    maxMeanError: 0.45,
    minDirectionPassRate: 0.95
  },
  {
    id: "tempo-minus-10",
    label: "Tempo -10%",
    metric: "poss",
    direction: -1,
    tempoMultiplier: 0.9,
    maxMeanError: 0.45,
    minDirectionPassRate: 0.95
  },
  {
    id: "usage-plus-25",
    label: "Usage concentration +25%",
    metric: "topUseShare",
    direction: 1,
    awayPlan: { usageConcentration: 1.25 },
    minDirectionPassRate: 0.7
  },
  {
    id: "usage-minus-20",
    label: "Usage concentration -20%",
    metric: "topUseShare",
    direction: -1,
    awayPlan: { usageConcentration: 0.8 },
    minDirectionPassRate: 0.7
  },
  {
    id: "three-point-plus-6",
    label: "3PA emphasis +6",
    metric: "threePa",
    direction: 1,
    awayPlan: { threePointEmphasis: 6 },
    maxMeanError: 0.9,
    minDirectionPassRate: 0.85
  },
  {
    id: "three-point-minus-6",
    label: "3PA emphasis -6",
    metric: "threePa",
    direction: -1,
    awayPlan: { threePointEmphasis: -6 },
    maxMeanError: 0.9,
    minDirectionPassRate: 0.85
  },
  {
    id: "foul-pressure-plus-4",
    label: "Foul pressure +4",
    metric: "fta",
    direction: 1,
    awayPlan: { foulPressure: 4 },
    maxMeanError: 0.8,
    minDirectionPassRate: 0.85
  },
  {
    id: "crash-boards-plus-4",
    label: "Crash boards +4",
    metric: "orb",
    direction: 1,
    awayPlan: { crashBoards: 4 },
    maxMeanError: 0.65,
    minDirectionPassRate: 0.75
  },
  {
    id: "ball-security-plus-4",
    label: "Ball security +4",
    metric: "tov",
    direction: -1,
    awayPlan: { ballSecurity: 4 },
    maxMeanError: 0.5,
    minDirectionPassRate: 0.85
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

function baseOptions(): MatchupOptions {
  return {
    venue: "neutral",
    intensity: "regular",
    eraContext: { mode: "midpoint" }
  };
}

function scenarioOptions(scenario: Scenario): MatchupOptions {
  return {
    ...baseOptions(),
    gameplay: {
      tempoMultiplier: scenario.tempoMultiplier ?? 1,
      away: scenario.awayPlan
    }
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

function rate(made: number | undefined, attempts: number | undefined): number {
  return attempts && attempts > 0 && made !== undefined ? made / attempts : 0;
}

function simMetrics(line: StatLine): TeamMetrics {
  return {
    pts: line.PTS ?? 0,
    fga: line.FGA ?? 0,
    threePa: line["3PA"] ?? 0,
    fta: line.FTA ?? 0,
    tov: line.TOV ?? 0,
    orb: line.OREB ?? 0,
    poss: line.poss ?? 0
  };
}

function expectedMetrics(line: ReturnType<typeof buildExpectedMatchupLine>["away"]): TeamMetrics {
  return {
    pts: line.pts,
    fga: line.fga,
    threePa: line.threePa,
    fta: line.fta,
    tov: line.tov,
    orb: line.orb,
    poss: line.possessions
  };
}

function useRows(matchup: MatchupCard, teamId: string): Array<{ label: string; share: number }> {
  const rows = matchup.assignments[teamId]?.Use ?? [];
  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0);
  if (totalWeight <= 0) return [];
  return rows.map((row) => ({ label: row.label, share: row.weight / totalWeight }));
}

function topUsePlayer(matchup: MatchupCard, teamId: string): string {
  return [...useRows(matchup, teamId)].sort((a, b) => b.share - a.share)[0]?.label ?? "";
}

function useShare(matchup: MatchupCard, teamId: string, player: string): number {
  return useRows(matchup, teamId).find((row) => row.label === player)?.share ?? 0;
}

function playerFgaShare(summary: ReturnType<typeof summarizeSimulations>, teamId: string, player: string): number {
  const teamFga = summary.teams[teamId]?.FGA ?? 0;
  return rate(summary.players[teamId]?.[player]?.FGA, teamFga);
}

function metricValue(
  metric: ScenarioMetric,
  teamMetrics: TeamMetrics,
  matchup: MatchupCard,
  teamId: string,
  topPlayer: string
): number {
  if (metric === "topUseShare") return useShare(matchup, teamId, topPlayer);
  return teamMetrics[metric];
}

function simMetricValue(metric: ScenarioMetric, summary: ReturnType<typeof summarizeSimulations>, teamId: string, topPlayer: string): number {
  if (metric === "topUseShare") return playerFgaShare(summary, teamId, topPlayer);
  return simMetrics(summary.teams[teamId])[metric];
}

function buildBaselinePairState(away: DiceTeamCard, home: DiceTeamCard, pairSeed: number): BaselinePairState {
  const baselineOptions = baseOptions();
  const baselineMatchup = buildMatchupCard(away, home, baselineOptions);
  const baselineSummary = summarizeSimulations(away, home, gamesPerScenario, pairSeed, baselineOptions);
  return {
    matchup: baselineMatchup,
    expectedLine: buildExpectedMatchupLine(away, home, baselineOptions),
    summary: baselineSummary,
    trackedPlayer: topUsePlayer(baselineMatchup, away.id)
  };
}

function runScenarioPair(away: DiceTeamCard, home: DiceTeamCard, scenario: Scenario, pairSeed: number, baseline: BaselinePairState): PairResult {
  const nextOptions = scenarioOptions(scenario);
  const nextMatchup = buildMatchupCard(away, home, nextOptions);
  const nextExpectedLine = buildExpectedMatchupLine(away, home, nextOptions);
  const baselineExpected = metricValue(scenario.metric, expectedMetrics(baseline.expectedLine.away), baseline.matchup, away.id, baseline.trackedPlayer);
  const nextExpected = metricValue(scenario.metric, expectedMetrics(nextExpectedLine.away), nextMatchup, away.id, baseline.trackedPlayer);
  const nextSummary = summarizeSimulations(away, home, gamesPerScenario, pairSeed, nextOptions);
  const baselineSim = simMetricValue(scenario.metric, baseline.summary, away.id, baseline.trackedPlayer);
  const nextSim = simMetricValue(scenario.metric, nextSummary, away.id, baseline.trackedPlayer);
  const expectedDelta = nextExpected - baselineExpected;
  const simDelta = nextSim - baselineSim;
  const error = scenario.metric === "topUseShare" ? null : simDelta - expectedDelta;
  const directionPassed = scenario.direction === 1 ? simDelta > 0 && expectedDelta > 0 : simDelta < 0 && expectedDelta < 0;

  return {
    awayId: away.id,
    homeId: home.id,
    away: away.shortName,
    home: home.shortName,
    awaySeason: away.source.seasonEndYear,
    homeSeason: home.source.seasonEndYear,
    gap: Math.abs(away.source.seasonEndYear - home.source.seasonEndYear),
    trackedPlayer: baseline.trackedPlayer,
    baselineExpected: fixed(baselineExpected),
    scenarioExpected: fixed(nextExpected),
    expectedDelta: fixed(expectedDelta),
    baselineSim: fixed(baselineSim),
    scenarioSim: fixed(nextSim),
    simDelta: fixed(simDelta),
    simMinusExpectedDelta: error === null ? null : fixed(error),
    directionPassed
  };
}

function summarizeScenario(scenario: Scenario, pairs: PairResult[]): ScenarioSummary {
  const expectedDeltas = pairs.map((pair) => pair.expectedDelta);
  const simDeltas = pairs.map((pair) => pair.simDelta);
  const errors = pairs.map((pair) => pair.simMinusExpectedDelta).filter((value): value is number => value !== null);
  const directionPassRate = pairs.filter((pair) => pair.directionPassed).length / Math.max(1, pairs.length);
  const failures: string[] = [];
  const meanError = errors.length ? mean(errors) : null;
  const meanAbsError = errors.length ? mean(errors.map((value) => Math.abs(value))) : null;

  if (directionPassRate < scenario.minDirectionPassRate) {
    failures.push(`direction pass rate ${fixed(directionPassRate)} below ${scenario.minDirectionPassRate}`);
  }
  if (scenario.maxMeanError !== undefined && meanAbsError !== null && meanAbsError > scenario.maxMeanError) {
    failures.push(`mean abs sim-minus-expected delta ${fixed(meanAbsError)} exceeds ${scenario.maxMeanError}`);
  }

  return {
    id: scenario.id,
    label: scenario.label,
    metric: scenario.metric,
    direction: scenario.direction,
    pairCount: pairs.length,
    gameCount: pairs.length * gamesPerScenario,
    meanExpectedDelta: fixed(mean(expectedDeltas)),
    meanSimDelta: fixed(mean(simDeltas)),
    meanSimMinusExpectedDelta: meanError === null ? null : fixed(meanError),
    meanAbsError: meanAbsError === null ? null : fixed(meanAbsError),
    directionPassRate: fixed(directionPassRate),
    status: failures.length ? "fail" : "pass",
    failures
  };
}

function markdown(report: {
  generatedAt: string;
  run: Record<string, unknown>;
  summaries: ScenarioSummary[];
}): string {
  const lines = [
    "# Gameplay Lever Sweep",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Pairs per bucket: ${pairsPerBucket}; games per scenario: ${gamesPerScenario}; seed: ${seed}`,
    "",
    "| Lever | Metric | Status | Expected delta | Sim delta | Mean abs error | Direction pass |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: |"
  ];
  for (const row of report.summaries) {
    lines.push(
      `| ${row.label} | ${row.metric} | ${row.status.toUpperCase()} | ${row.meanExpectedDelta} | ${row.meanSimDelta} | ${row.meanAbsError ?? "-"} | ${row.directionPassRate} |`
    );
  }
  const failures = report.summaries.filter((row) => row.failures.length);
  if (failures.length) {
    lines.push("", "## Failures");
    for (const row of failures) {
      lines.push("", `### ${row.label}`);
      for (const failure of row.failures) lines.push(`- ${failure}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

const started = Date.now();
const pairs = selectedPairs();
const scenarioPairs = Object.fromEntries(scenarios.map((scenario) => [scenario.id, [] as PairResult[]]));

for (let pairIndex = 0; pairIndex < pairs.length; pairIndex += 1) {
  const [away, home] = pairs[pairIndex];
  const pairSeed = seed * 10_000 + pairIndex + 1;
  const baseline = buildBaselinePairState(away, home, pairSeed);
  for (const scenario of scenarios) {
    scenarioPairs[scenario.id].push(runScenarioPair(away, home, scenario, pairSeed, baseline));
  }
}

const summaries = scenarios.map((scenario) => summarizeScenario(scenario, scenarioPairs[scenario.id]));
const report = {
  generatedAt: new Date().toISOString(),
  run: {
    modelVersion: crossEraModelVersion,
    seed,
    pairsPerBucket,
    gamesPerScenario,
    pairCount: pairs.length,
    scenarioCount: scenarios.length,
    elapsedSeconds: fixed((Date.now() - started) / 1000, 1)
  },
  thresholds: Object.fromEntries(
    scenarios.map((scenario) => [
      scenario.id,
      {
        maxMeanError: scenario.maxMeanError ?? null,
        minDirectionPassRate: scenario.minDirectionPassRate
      }
    ])
  ),
  summaries,
  pairs: scenarioPairs
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(markdownPath, markdown(report));

console.log(`Wrote ${path.relative(process.cwd(), outputPath)}`);
console.log(`Markdown summary: ${path.relative(process.cwd(), markdownPath)}`);
console.log(`Run: ${pairs.length} pairs x ${gamesPerScenario} games x ${scenarios.length} scenarios, ${report.run.elapsedSeconds}s`);
for (const row of summaries) {
  console.log(
    `${row.status.toUpperCase()} ${row.label}: metric=${row.metric}, expectedDelta=${row.meanExpectedDelta}, ` +
      `simDelta=${row.meanSimDelta}, meanAbsError=${row.meanAbsError ?? "-"}, directionPass=${row.directionPassRate}`
  );
}
if (summaries.some((row) => row.status === "fail")) process.exit(1);
