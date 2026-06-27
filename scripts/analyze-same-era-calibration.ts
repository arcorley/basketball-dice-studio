import fs from "node:fs";
import path from "node:path";
import { buildExpectedMatchupLine, buildMatchupCard, crossEraModelVersion, summarizeSimulations } from "../src/lib/diceEngine";
import { SeededRandom } from "../src/lib/random";
import type { DiceTeamCard, ExpectedTeamLine, MatchupOptions, StatLine } from "../src/lib/types";
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

type TeamResult = {
  teamId: string;
  team: string;
  seasonEndYear: number;
  sim: TeamBoxMetrics;
  expected: TeamBoxMetrics;
  source: TeamBoxMetrics;
  simMinusExpected: TeamBoxMetrics;
  expectedMinusSource: TeamBoxMetrics;
  simMinusSource: TeamBoxMetrics;
};

type PairResult = {
  awayId: string;
  homeId: string;
  away: string;
  home: string;
  seasonEndYear: number;
  games: number;
  possessionsEach: number;
  awayWinRate: number;
  averageMarginForAway: number;
  expectedMarginForAway: number;
  simMinusExpectedMarginForAway: number;
  teams: TeamResult[];
};

type MetricSummary = {
  mean: number;
  meanAbs: number;
  maxAbs: number;
};

type CalibrationSummary = {
  pairCount: number;
  teamLineCount: number;
  gameCount: number;
  simMinusExpected: Record<keyof TeamBoxMetrics, MetricSummary>;
  expectedMinusSource: Record<keyof TeamBoxMetrics, MetricSummary>;
  simMinusSource: Record<keyof TeamBoxMetrics, MetricSummary>;
};

const metricFields: Array<keyof TeamBoxMetrics> = ["pts", "fga", "fgPct", "threePa", "threePct", "fta", "ftPct", "tov", "orb", "poss"];

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    return [key, value] as const;
  })
);

const seed = numberArg("seed", 6262);
const pairsPerSeason = integerArg("pairs-per-season", 2);
const gamesPerPair = integerArg("games-per-pair", 60);
const minSeason = integerArg("min-season", 1990);
const maxSeason = integerArg("max-season", 2025);
const outputPath = path.resolve(
  args.get("output") ?? path.join(process.cwd(), "reports", `same-era-calibration-${pairsPerSeason}x${gamesPerPair}-seed-${seed}.json`)
);
const markdownPath = path.resolve(args.get("markdown") ?? outputPath.replace(/\.json$/i, ".md"));

const thresholds = {
  maxSimExpectedPtsMeanAbs: numberArg("max-sim-exp-pts", 1.5),
  maxSimExpectedFgaMeanAbs: numberArg("max-sim-exp-fga", 0.9),
  maxSimExpectedThreePaMeanAbs: numberArg("max-sim-exp-3pa", 0.7),
  maxSimExpectedFtaMeanAbs: numberArg("max-sim-exp-fta", 0.9),
  maxSimExpectedTovMeanAbs: numberArg("max-sim-exp-tov", 0.55),
  maxSimExpectedOrbMeanAbs: numberArg("max-sim-exp-orb", 0.55),
  maxExpectedSourcePtsMeanAbs: numberArg("max-exp-source-pts", 7),
  maxExpectedSourceFgaMeanAbs: numberArg("max-exp-source-fga", 4),
  maxExpectedSourceThreePaMeanAbs: numberArg("max-exp-source-3pa", 3),
  maxExpectedSourceFtaMeanAbs: numberArg("max-exp-source-fta", 4),
  maxExpectedSourceTovMeanAbs: numberArg("max-exp-source-tov", 2.5),
  maxExpectedSourceOrbMeanAbs: numberArg("max-exp-source-orb", 3)
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

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sourceGames(team: DiceTeamCard): number {
  const wins = team.source.team.wins;
  const losses = team.source.team.losses;
  if (!finite(wins) || !finite(losses)) throw new Error(`Missing source wins/losses for ${team.id}`);
  return wins + losses;
}

function perGame(value: number | null | undefined, games: number): number {
  return finite(value) ? value / games : 0;
}

function rate(made: number | null | undefined, attempts: number | null | undefined): number {
  return finite(made) && finite(attempts) && attempts > 0 ? made / attempts : 0;
}

function sourceTeamLine(team: DiceTeamCard, paceTarget: number): TeamBoxMetrics {
  const games = sourceGames(team);
  const totals = team.source.team.totals;
  const sourcePace = team.source.team.pace;
  if (!finite(sourcePace) || sourcePace <= 0) throw new Error(`Missing source pace for ${team.id}`);
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

function metricDelta(left: TeamBoxMetrics, right: TeamBoxMetrics): TeamBoxMetrics {
  return metricMap((field) => left[field] - right[field]);
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

function sampleSeasonPairs(teams: DiceTeamCard[], rng: SeededRandom): Array<[DiceTeamCard, DiceTeamCard]> {
  const bySeason = new Map<number, DiceTeamCard[]>();
  for (const team of teams) {
    if (team.source.seasonEndYear < minSeason || team.source.seasonEndYear > maxSeason) continue;
    bySeason.set(team.source.seasonEndYear, [...(bySeason.get(team.source.seasonEndYear) ?? []), team]);
  }

  const pairs: Array<[DiceTeamCard, DiceTeamCard]> = [];
  const seen = new Set<string>();
  for (const season of [...bySeason.keys()].sort((a, b) => a - b)) {
    const seasonTeams = bySeason.get(season) ?? [];
    if (seasonTeams.length < 2) continue;
    let count = 0;
    let guard = 0;
    while (count < pairsPerSeason && guard < 10_000) {
      guard += 1;
      const away = seasonTeams[Math.floor(rng.next() * seasonTeams.length)];
      const home = seasonTeams[Math.floor(rng.next() * seasonTeams.length)];
      if (!away || !home || away.id === home.id) continue;
      const key = `${away.id}|${home.id}`;
      const reverseKey = `${home.id}|${away.id}`;
      if (seen.has(key) || seen.has(reverseKey)) continue;
      seen.add(key);
      pairs.push([away, home]);
      count += 1;
    }
  }
  return pairs;
}

function matchupOptions(): MatchupOptions {
  return {
    venue: "neutral",
    intensity: "regular",
    eraContext: { mode: "midpoint" }
  };
}

function runPair(away: DiceTeamCard, home: DiceTeamCard, index: number): PairResult {
  const options = matchupOptions();
  const matchup = buildMatchupCard(away, home, options);
  const expected = buildExpectedMatchupLine(away, home, options);
  const summary = summarizeSimulations(away, home, gamesPerPair, seed * 100_000 + index + 1, options);
  const teams = [away, home].map((team) => {
    const sim = simTeamLine(summary.teams[team.id]);
    const expectedBox = expectedTeamBox(team.id === away.id ? expected.away : expected.home);
    const source = sourceTeamLine(team, matchup.possessionsEach);
    return {
      teamId: team.id,
      team: team.shortName,
      seasonEndYear: team.source.seasonEndYear,
      sim: roundedMetrics(sim),
      expected: roundedMetrics(expectedBox),
      source: roundedMetrics(source),
      simMinusExpected: roundedMetrics(metricDelta(sim, expectedBox)),
      expectedMinusSource: roundedMetrics(metricDelta(expectedBox, source)),
      simMinusSource: roundedMetrics(metricDelta(sim, source))
    };
  });

  const awayLine = summary.teams[away.id];
  const homeLine = summary.teams[home.id];
  return {
    awayId: away.id,
    homeId: home.id,
    away: away.shortName,
    home: home.shortName,
    seasonEndYear: away.source.seasonEndYear,
    games: gamesPerPair,
    possessionsEach: matchup.possessionsEach,
    awayWinRate: fixed((summary.wins[away.id] ?? 0) / gamesPerPair),
    averageMarginForAway: fixed((awayLine.PTS ?? 0) - (homeLine.PTS ?? 0), 2),
    expectedMarginForAway: fixed(expected.marginForAway, 2),
    simMinusExpectedMarginForAway: fixed((awayLine.PTS ?? 0) - (homeLine.PTS ?? 0) - expected.marginForAway, 2),
    teams
  };
}

function summarizeDeltas(teamResults: TeamResult[], field: "simMinusExpected" | "expectedMinusSource" | "simMinusSource"): Record<keyof TeamBoxMetrics, MetricSummary> {
  return Object.fromEntries(
    metricFields.map((metric) => {
      const values = teamResults.map((team) => team[field][metric]);
      const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
      const abs = values.map((value) => Math.abs(value));
      return [
        metric,
        {
          mean: fixed(mean),
          meanAbs: fixed(abs.reduce((sum, value) => sum + value, 0) / Math.max(1, abs.length)),
          maxAbs: fixed(Math.max(...abs, 0))
        }
      ];
    })
  ) as Record<keyof TeamBoxMetrics, MetricSummary>;
}

function buildSummary(pairs: PairResult[]): CalibrationSummary {
  const teamResults = pairs.flatMap((pair) => pair.teams);
  return {
    pairCount: pairs.length,
    teamLineCount: teamResults.length,
    gameCount: pairs.length * gamesPerPair,
    simMinusExpected: summarizeDeltas(teamResults, "simMinusExpected"),
    expectedMinusSource: summarizeDeltas(teamResults, "expectedMinusSource"),
    simMinusSource: summarizeDeltas(teamResults, "simMinusSource")
  };
}

function assertMax(summary: CalibrationSummary, group: keyof Pick<CalibrationSummary, "simMinusExpected" | "expectedMinusSource">, metric: keyof TeamBoxMetrics, max: number, failures: string[]): void {
  const value = summary[group][metric].meanAbs;
  if (value > max) failures.push(`${group}.${metric}.meanAbs=${value} exceeds ${max}`);
}

function guardrailFailures(summary: CalibrationSummary): string[] {
  const failures: string[] = [];
  assertMax(summary, "simMinusExpected", "pts", thresholds.maxSimExpectedPtsMeanAbs, failures);
  assertMax(summary, "simMinusExpected", "fga", thresholds.maxSimExpectedFgaMeanAbs, failures);
  assertMax(summary, "simMinusExpected", "threePa", thresholds.maxSimExpectedThreePaMeanAbs, failures);
  assertMax(summary, "simMinusExpected", "fta", thresholds.maxSimExpectedFtaMeanAbs, failures);
  assertMax(summary, "simMinusExpected", "tov", thresholds.maxSimExpectedTovMeanAbs, failures);
  assertMax(summary, "simMinusExpected", "orb", thresholds.maxSimExpectedOrbMeanAbs, failures);
  assertMax(summary, "expectedMinusSource", "pts", thresholds.maxExpectedSourcePtsMeanAbs, failures);
  assertMax(summary, "expectedMinusSource", "fga", thresholds.maxExpectedSourceFgaMeanAbs, failures);
  assertMax(summary, "expectedMinusSource", "threePa", thresholds.maxExpectedSourceThreePaMeanAbs, failures);
  assertMax(summary, "expectedMinusSource", "fta", thresholds.maxExpectedSourceFtaMeanAbs, failures);
  assertMax(summary, "expectedMinusSource", "tov", thresholds.maxExpectedSourceTovMeanAbs, failures);
  assertMax(summary, "expectedMinusSource", "orb", thresholds.maxExpectedSourceOrbMeanAbs, failures);
  return failures;
}

function markdown(report: { generatedAt: string; run: Record<string, unknown>; summary: CalibrationSummary; status: string; failures: string[] }): string {
  const metricRow = (label: string, values: Record<keyof TeamBoxMetrics, MetricSummary>) =>
    `| ${label} | ${values.pts.meanAbs} | ${values.fga.meanAbs} | ${values.threePa.meanAbs} | ${values.fta.meanAbs} | ${values.tov.meanAbs} | ${values.orb.meanAbs} |`;
  const lines = [
    "# Same-Era Calibration",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Status: ${report.status.toUpperCase()}`,
    "",
    `Pairs: ${report.summary.pairCount}; team lines: ${report.summary.teamLineCount}; games: ${report.summary.gameCount}`,
    "",
    "| Delta Group | PTS | FGA | 3PA | FTA | TOV | ORB |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    metricRow("sim - expected mean abs", report.summary.simMinusExpected),
    metricRow("expected - source mean abs", report.summary.expectedMinusSource),
    metricRow("sim - source mean abs", report.summary.simMinusSource)
  ];
  if (report.failures.length) {
    lines.push("", "## Failures");
    for (const failure of report.failures) lines.push(`- ${failure}`);
  }
  return `${lines.join("\n")}\n`;
}

const started = Date.now();
const teams = getDiceTeams();
const pairs = sampleSeasonPairs(teams, new SeededRandom(seed));
const results = pairs.map(([away, home], index) => runPair(away, home, index));
const summary = buildSummary(results);
const failures = guardrailFailures(summary);
const report = {
  generatedAt: new Date().toISOString(),
  run: {
    modelVersion: crossEraModelVersion,
    seed,
    pairsPerSeason,
    gamesPerPair,
    minSeason,
    maxSeason,
    pairCount: results.length,
    matchupOptions: matchupOptions(),
    elapsedSeconds: fixed((Date.now() - started) / 1000, 1)
  },
  thresholds,
  status: failures.length ? "fail" : "pass",
  failures,
  summary,
  pairs: results
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(markdownPath, markdown(report));

console.log(`${report.status.toUpperCase()}: ${path.relative(process.cwd(), outputPath)}`);
console.log(`Markdown summary: ${path.relative(process.cwd(), markdownPath)}`);
console.log(`Run: ${results.length} pairs x ${gamesPerPair} games, ${report.run.elapsedSeconds}s`);
console.log(
  `sim-exp meanAbs: PTS=${summary.simMinusExpected.pts.meanAbs}, FGA=${summary.simMinusExpected.fga.meanAbs}, ` +
    `3PA=${summary.simMinusExpected.threePa.meanAbs}, FTA=${summary.simMinusExpected.fta.meanAbs}, ` +
    `TOV=${summary.simMinusExpected.tov.meanAbs}, ORB=${summary.simMinusExpected.orb.meanAbs}`
);
console.log(
  `exp-source meanAbs: PTS=${summary.expectedMinusSource.pts.meanAbs}, FGA=${summary.expectedMinusSource.fga.meanAbs}, ` +
    `3PA=${summary.expectedMinusSource.threePa.meanAbs}, FTA=${summary.expectedMinusSource.fta.meanAbs}, ` +
    `TOV=${summary.expectedMinusSource.tov.meanAbs}, ORB=${summary.expectedMinusSource.orb.meanAbs}`
);
for (const failure of failures) console.error(`FAIL: ${failure}`);
if (failures.length) process.exit(1);
