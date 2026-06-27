import fs from "node:fs";
import path from "node:path";
import { buildExpectedMatchupLine, crossEraModelVersion } from "../src/lib/diceEngine";
import { SeededRandom } from "../src/lib/random";
import type { DiceTeamCard, ExpectedPlayerLine, ExpectedTeamLine, MatchupOptions } from "../src/lib/types";
import { getDiceTeams } from "./sourceDataStatic";

type TeamCheck = {
  teamId: string;
  team: string;
  side: "away" | "home";
  deltas: Record<string, number>;
  failures: string[];
};

type PairCheck = {
  awayId: string;
  homeId: string;
  away: string;
  home: string;
  awaySeason: number;
  homeSeason: number;
  eraGap: number;
  teams: TeamCheck[];
};

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    return [key, value] as const;
  })
);

const seed = integerArg("seed", 7373);
const pairs = integerArg("pairs", 80);
const tolerance = numberArg("tolerance", 0.01);
const outputPath = path.resolve(args.get("output") ?? path.join(process.cwd(), "reports", `expected-player-lines-${pairs}-seed-${seed}.json`));
const markdownPath = path.resolve(args.get("markdown") ?? outputPath.replace(/\.json$/i, ".md"));
const metricPairs: Array<[string, keyof ExpectedTeamLine, keyof ExpectedPlayerLine]> = [
  ["PTS", "pts", "pts"],
  ["2PM", "fg2m", "fg2m"],
  ["FGA", "fga", "fga"],
  ["3PM", "threePm", "threePm"],
  ["3PA", "threePa", "threePa"],
  ["FTM", "ftm", "ftm"],
  ["FTA", "fta", "fta"],
  ["TOV", "tov", "tov"],
  ["OREB", "orb", "orb"],
  ["AST", "ast", "ast"]
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

function pairOptions(): MatchupOptions {
  return {
    venue: "neutral",
    intensity: "regular",
    eraContext: { mode: "midpoint" }
  };
}

function samplePairs(teams: DiceTeamCard[]): Array<[DiceTeamCard, DiceTeamCard]> {
  const rng = new SeededRandom(seed);
  const seen = new Set<string>();
  const out: Array<[DiceTeamCard, DiceTeamCard]> = [];
  while (out.length < pairs) {
    const away = teams[Math.floor(rng.next() * teams.length)];
    const home = teams[Math.floor(rng.next() * teams.length)];
    if (!away || !home || away.id === home.id) continue;
    const key = `${away.id}|${home.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([away, home]);
  }
  return out;
}

function teamCheck(teamLine: ExpectedTeamLine, side: "away" | "home"): TeamCheck {
  const failures: string[] = [];
  const deltas: Record<string, number> = {};
  for (const [label, teamField, playerField] of metricPairs) {
    const teamValue = Number(teamLine[teamField]);
    const playerValue = teamLine.players.reduce((sum, player) => sum + Number(player[playerField]), 0);
    const delta = fixed(playerValue - teamValue);
    deltas[label] = delta;
    if (Math.abs(delta) > tolerance) failures.push(`${label} player total ${fixed(playerValue)} differs from team ${fixed(teamValue)} by ${delta}`);
  }
  const fgmDelta = fixed(teamLine.players.reduce((sum, player) => sum + player.fgm, 0) - (teamLine.fg2m + teamLine.threePm));
  deltas.FGM = fgmDelta;
  if (Math.abs(fgmDelta) > tolerance) failures.push(`FGM player total differs by ${fgmDelta}`);

  return {
    teamId: teamLine.teamId,
    team: teamLine.team,
    side,
    deltas,
    failures
  };
}

function markdown(report: { generatedAt: string; status: string; pairCount: number; failures: string[] }): string {
  const lines = [
    "# Expected Player Lines",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Status: ${report.status.toUpperCase()}`,
    "",
    `Pairs: ${report.pairCount}; tolerance: ${tolerance}`
  ];
  if (report.failures.length) {
    lines.push("", "## Failures");
    for (const failure of report.failures) lines.push(`- ${failure}`);
  }
  return `${lines.join("\n")}\n`;
}

const started = Date.now();
const checks: PairCheck[] = samplePairs(getDiceTeams()).map(([away, home]) => {
  const expected = buildExpectedMatchupLine(away, home, pairOptions());
  return {
    awayId: away.id,
    homeId: home.id,
    away: away.shortName,
    home: home.shortName,
    awaySeason: away.source.seasonEndYear,
    homeSeason: home.source.seasonEndYear,
    eraGap: Math.abs(away.source.seasonEndYear - home.source.seasonEndYear),
    teams: [teamCheck(expected.away, "away"), teamCheck(expected.home, "home")]
  };
});
const failures = checks.flatMap((pair) =>
  pair.teams.flatMap((team) => team.failures.map((failure) => `${pair.awayId}@${pair.homeId}.${team.side}.${team.teamId}: ${failure}`))
);
const report = {
  generatedAt: new Date().toISOString(),
  run: {
    modelVersion: crossEraModelVersion,
    seed,
    pairs,
    tolerance,
    elapsedSeconds: fixed((Date.now() - started) / 1000, 1)
  },
  status: failures.length ? "fail" : "pass",
  failures,
  checks
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(markdownPath, markdown({ generatedAt: report.generatedAt, status: report.status, pairCount: checks.length, failures }));

console.log(`${report.status.toUpperCase()}: ${path.relative(process.cwd(), outputPath)}`);
console.log(`Markdown summary: ${path.relative(process.cwd(), markdownPath)}`);
console.log(`Pairs: ${checks.length}, failures=${failures.length}, elapsed=${report.run.elapsedSeconds}s`);
for (const failure of failures) console.error(`FAIL: ${failure}`);
if (failures.length) process.exit(1);
