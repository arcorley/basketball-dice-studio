import fs from "node:fs";
import path from "node:path";
import { buildExpectedMatchupLine, buildMatchupCard, crossEraModelVersion, summarizeSimulations } from "../src/lib/diceEngine";
import type { DicePlayerCard, DiceTeamCard, ExpectedTeamLine, MatchupOptions, ShotZone, StatLine, TeamMatchupStatic } from "../src/lib/types";
import { getDiceTeams, getTeam } from "./sourceDataStatic";

type NumericRange = {
  min: number;
  max: number;
  minTeam?: string;
  maxTeam?: string;
};

type TeamBoxScore = {
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

type MatchupCheck = {
  label: string;
  awayId: string;
  homeId: string;
};

const [iterationsArg = "1000", seedArg = "4242", outputArg] = process.argv.slice(2);
const iterations = Number(iterationsArg);
const seed = Number(seedArg);
const outputPath =
  outputArg ?? path.join(process.cwd(), "reports", `sanity-accuracy-${iterations}-seed-${seed}.json`);

const matchups: MatchupCheck[] = [
  { label: "1993 Finals same-era", awayId: "1992-93-chi", homeId: "1992-93-pho" },
  { label: "2021 Finals same-era", awayId: "2020-21-mil", homeId: "2020-21-pho" },
  { label: "Cross-era stress: 2021 Suns at 1993 Bulls", awayId: "2020-21-pho", homeId: "1992-93-chi" },
  { label: "Cross-era elite: 1996 Bulls at 2017 Warriors", awayId: "1995-96-chi", homeId: "2016-17-gsw" },
  { label: "Modern elite: 2025 Thunder at 2025 Celtics", awayId: "2024-25-okc", homeId: "2024-25-bos" },
  { label: "Modern elite: 2025 Cavaliers at 2025 Thunder", awayId: "2024-25-cle", homeId: "2024-25-okc" }
];

const teamNumericFields: Array<keyof Pick<
  DiceTeamCard,
  | "pace"
  | "offensiveRating"
  | "defensiveRating"
  | "shotQuality"
  | "defense"
  | "toPress"
  | "toProtect"
  | "foulDraw"
  | "foulDiscipline"
  | "threeTendency"
  | "orb"
  | "drb"
  | "assistMade2"
  | "assistMade3"
>> = [
  "pace",
  "offensiveRating",
  "defensiveRating",
  "shotQuality",
  "defense",
  "toPress",
  "toProtect",
  "foulDraw",
  "foulDiscipline",
  "threeTendency",
  "orb",
  "drb",
  "assistMade2",
  "assistMade3"
];

const playerNumericFields: Array<keyof Pick<
  DicePlayerCard,
  | "minutes"
  | "useWeight"
  | "tov"
  | "fd"
  | "threeFrequency"
  | "p2"
  | "p3"
  | "ft"
  | "andOneChance"
  | "liveBallTurnoverChance"
  | "offensiveFoulTurnoverChance"
  | "astWeight"
  | "orbWeight"
  | "drbWeight"
  | "stlWeight"
  | "blkWeight"
  | "pfWeight"
  | "shootingFoulWeight"
>> = [
  "minutes",
  "useWeight",
  "tov",
  "fd",
  "threeFrequency",
  "p2",
  "p3",
  "ft",
  "andOneChance",
  "liveBallTurnoverChance",
  "offensiveFoulTurnoverChance",
  "astWeight",
  "orbWeight",
  "drbWeight",
  "stlWeight",
  "blkWeight",
  "pfWeight",
  "shootingFoulWeight"
];

const staticNumericFields: Array<keyof Omit<TeamMatchupStatic, "offense" | "defense" | "ranges">> = [
  "orbChance",
  "blockChance",
  "astMade2",
  "astMade3",
  "turnoverTargetChance",
  "foulDrawTargetChance",
  "threeAttemptTargetChance",
  "turnoverScale",
  "foulDrawScale",
  "threeAttemptScale",
  "foulEndsPossessionChance",
  "defenseShotAdjustment",
  "contextShotAdjustment",
  "playoffLeverageShotAdjustment",
  "totalShotAdjustment"
];
const contextSmokeOptions: Array<{ label: string; options: MatchupOptions }> = [
  { label: "neutral regular", options: { venue: "neutral", intensity: "regular" } },
  { label: "home playoff", options: { venue: "home-court", intensity: "playoff" } }
];
const shotZones: ShotZone[] = ["rim", "shortMid", "longMid", "three"];

function fixed(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function pct(value: number): number {
  return fixed(value * 100, 1);
}

function rate(made: number, attempts: number): number {
  return attempts > 0 ? fixed(made / attempts, 3) : 0;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sourceGames(team: DiceTeamCard): number {
  const wins = team.source.team.wins;
  const losses = team.source.team.losses;
  if (!finite(wins) || !finite(losses)) {
    throw new Error(`Missing source wins/losses for ${team.id}`);
  }
  return wins + losses;
}

function perGame(value: number | null | undefined, games: number): number {
  if (!finite(value)) return 0;
  return value / games;
}

function sourceTeamLine(team: DiceTeamCard, paceTarget: number): TeamBoxScore {
  const games = sourceGames(team);
  const totals = team.source.team.totals;
  const sourcePace = team.source.team.pace;
  if (!finite(sourcePace) || sourcePace <= 0) {
    throw new Error(`Missing source pace for ${team.id}`);
  }
  const scale = paceTarget / sourcePace;
  return {
    pts: fixed(perGame(totals.pts, games) * scale, 1),
    fga: fixed(perGame(totals.fga, games) * scale, 1),
    fgPct: rate(totals.fg ?? 0, totals.fga ?? 0),
    threePa: fixed(perGame(totals.fg3a, games) * scale, 1),
    threePct: rate(totals.fg3 ?? 0, totals.fg3a ?? 0),
    fta: fixed(perGame(totals.fta, games) * scale, 1),
    ftPct: rate(totals.ft ?? 0, totals.fta ?? 0),
    tov: fixed(perGame(totals.tov, games) * scale, 1),
    orb: fixed(perGame(totals.orb, games) * scale, 1),
    poss: fixed(paceTarget, 1)
  };
}

function simTeamLine(line: StatLine): TeamBoxScore {
  return {
    pts: fixed(line.PTS, 1),
    fga: fixed(line.FGA, 1),
    fgPct: rate(line.FGM, line.FGA),
    threePa: fixed(line["3PA"], 1),
    threePct: rate(line["3PM"], line["3PA"]),
    fta: fixed(line.FTA, 1),
    ftPct: rate(line.FTM, line.FTA),
    tov: fixed(line.TOV, 1),
    orb: fixed(line.OREB, 1),
    poss: fixed(line.poss, 1)
  };
}

function expectedTeamBox(line: ExpectedTeamLine): TeamBoxScore {
  return {
    pts: fixed(line.pts, 1),
    fga: fixed(line.fga, 1),
    fgPct: fixed(line.fgPct, 3),
    threePa: fixed(line.threePa, 1),
    threePct: fixed(line.threePct, 3),
    fta: fixed(line.fta, 1),
    ftPct: fixed(line.ftPct, 3),
    tov: fixed(line.tov, 1),
    orb: fixed(line.orb, 1),
    poss: fixed(line.possessions, 1)
  };
}

function boxDelta(sim: TeamBoxScore, source: TeamBoxScore): TeamBoxScore {
  return {
    pts: fixed(sim.pts - source.pts, 1),
    fga: fixed(sim.fga - source.fga, 1),
    fgPct: fixed(sim.fgPct - source.fgPct, 3),
    threePa: fixed(sim.threePa - source.threePa, 1),
    threePct: fixed(sim.threePct - source.threePct, 3),
    fta: fixed(sim.fta - source.fta, 1),
    ftPct: fixed(sim.ftPct - source.ftPct, 3),
    tov: fixed(sim.tov - source.tov, 1),
    orb: fixed(sim.orb - source.orb, 1),
    poss: fixed(sim.poss - source.poss, 1)
  };
}

function emptyRange(): NumericRange {
  return { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY };
}

function updateRange(ranges: Record<string, NumericRange>, field: string, value: number, teamId: string): void {
  ranges[field] ??= emptyRange();
  if (value < ranges[field].min) {
    ranges[field].min = value;
    ranges[field].minTeam = teamId;
  }
  if (value > ranges[field].max) {
    ranges[field].max = value;
    ranges[field].maxTeam = teamId;
  }
}

function compactRanges(ranges: Record<string, NumericRange>): Record<string, NumericRange> {
  return Object.fromEntries(
    Object.entries(ranges).map(([field, range]) => [
      field,
      {
        min: fixed(range.min, 2),
        max: fixed(range.max, 2),
        minTeam: range.minTeam,
        maxTeam: range.maxTeam
      }
    ])
  );
}

function checkCards(teams: DiceTeamCard[]) {
  const failures: string[] = [];
  const warnings: string[] = [];
  const teamRanges: Record<string, NumericRange> = {};
  const playerRanges: Record<string, NumericRange> = {};
  const rotationRanges: Record<string, NumericRange> = {};

  for (const team of teams) {
    if (!team.players.length) failures.push(`${team.id} has no rotation players`);
    if (team.players.length < 5) warnings.push(`${team.id} has fewer than five rotation players`);
    if (team.players.length > 12) warnings.push(`${team.id} has ${team.players.length} rotation players`);
    updateRange(rotationRanges, "players", team.players.length, team.id);

    for (const field of teamNumericFields) {
      const value = team[field];
      if (!finite(value)) failures.push(`${team.id}.${field} is not finite`);
      else updateRange(teamRanges, field, value, team.id);
    }

    for (const player of team.players) {
      for (const field of playerNumericFields) {
        const value = player[field];
        if (!finite(value)) failures.push(`${team.id}.${player.name}.${field} is not finite`);
        else updateRange(playerRanges, field, value, team.id);
      }
    }
  }

  return {
    teamsChecked: teams.length,
    failures,
    warnings,
    teamRanges: compactRanges(teamRanges),
    playerRanges: compactRanges(playerRanges),
    rotationRanges: compactRanges(rotationRanges)
  };
}

function checkStaticMatchupFields(matchup: ReturnType<typeof buildMatchupCard>): string[] {
  const failures: string[] = [];
  for (const side of ["awayStatic", "homeStatic"] as const) {
    const statics = matchup[side];
    for (const field of staticNumericFields) {
      if (!finite(statics[field])) failures.push(`${matchup.away.id}@${matchup.home.id}.${side}.${field} is not finite`);
    }
    for (const [field, value] of Object.entries(statics.eraTalentAdjustment)) {
      if (!finite(value)) failures.push(`${matchup.away.id}@${matchup.home.id}.${side}.eraTalentAdjustment.${field} is not finite`);
      if (matchup.away.source.seasonEndYear === matchup.home.source.seasonEndYear && Math.abs(value) > 0.000001) {
        failures.push(`${matchup.away.id}@${matchup.home.id}.${side}.eraTalentAdjustment.${field} should be zero for same-era matchup`);
      }
    }
    for (const zone of shotZones) {
      const value = statics.orbByShotZone[zone];
      if (!finite(value)) failures.push(`${matchup.away.id}@${matchup.home.id}.${side}.orbByShotZone.${zone} is not finite`);
      else if (value < 5 || value > 45) {
        failures.push(`${matchup.away.id}@${matchup.home.id}.${side}.orbByShotZone.${zone} is outside rebound bounds: ${value}`);
      }
    }
  }

  for (const [side, rows] of [
    ["awayPlayerRanges", matchup.awayPlayerRanges],
    ["homePlayerRanges", matchup.homePlayerRanges]
  ] as const) {
    for (const row of rows) {
      if (row.shotProfile !== "location") {
        failures.push(`${matchup.away.id}@${matchup.home.id}.${side}.${row.player}.shotProfile is ${row.shotProfile}; expected location`);
      }
      if (!["sourced-location", "same-player-neighbor-proxy", "era-role-neighbor-proxy", "manual-audit"].includes(row.shotProfileMethod)) {
        failures.push(`${matchup.away.id}@${matchup.home.id}.${side}.${row.player}.shotProfileMethod is invalid`);
      }
      if (!finite(row.shotProfileConfidence) || row.shotProfileConfidence < 0 || row.shotProfileConfidence > 1) {
        failures.push(`${matchup.away.id}@${matchup.home.id}.${side}.${row.player}.shotProfileConfidence is invalid`);
      }
      const zoneTotal = shotZones.reduce((sum, zone) => sum + row.raw.shotZones[zone], 0);
      if (Math.abs(zoneTotal - 100) > 0.01) {
        failures.push(`${matchup.away.id}@${matchup.home.id}.${side}.${row.player}.shotZones total ${fixed(zoneTotal, 3)}`);
      }
      for (const zone of shotZones) {
        const chance = row.raw.shotZones[zone];
        const make = row.raw.shotMakes[zone];
        if (!finite(chance)) failures.push(`${matchup.away.id}@${matchup.home.id}.${side}.${row.player}.shotZones.${zone} is not finite`);
        if (!finite(make)) failures.push(`${matchup.away.id}@${matchup.home.id}.${side}.${row.player}.shotMakes.${zone} is not finite`);
        if (finite(make) && (make < 1 || make > 99)) {
          failures.push(`${matchup.away.id}@${matchup.home.id}.${side}.${row.player}.shotMakes.${zone} outside d100 bounds: ${make}`);
        }
      }
    }
  }
  return failures;
}

function runMatchup(check: MatchupCheck, index: number) {
  const away = getTeam(check.awayId);
  const home = getTeam(check.homeId);
  const matchup = buildMatchupCard(away, home);
  const expected = buildExpectedMatchupLine(away, home);
  const staticFailures = checkStaticMatchupFields(matchup);
  const summary = summarizeSimulations(away, home, iterations, seed + index * 100_000);
  const ties = summary.wins.tie ?? 0;
  const awayWins = summary.wins[away.id] ?? 0;
  const homeWins = summary.wins[home.id] ?? 0;

  return {
    label: check.label,
    awayId: away.id,
    homeId: home.id,
    away: away.shortName,
    home: home.shortName,
    possessionsEach: matchup.possessionsEach,
    quarters: matchup.quarters,
    winRates: {
      [away.id]: pct(awayWins / iterations),
      [home.id]: pct(homeWins / iterations),
      tie: pct(ties / iterations)
    },
    overtimeRate: pct((summary.overtimeGames ?? 0) / iterations),
    averageMarginForAway: fixed(summary.teams[away.id].PTS - summary.teams[home.id].PTS, 1),
    expectedMarginForAway: fixed(expected.marginForAway, 1),
    simMinusExpectedMarginForAway: fixed(summary.teams[away.id].PTS - summary.teams[home.id].PTS - expected.marginForAway, 1),
    staticFailures,
    teams: [away, home].map((team) => {
      const sim = simTeamLine(summary.teams[team.id]);
      const expectedTeam = team.id === away.id ? expected.away : expected.home;
      const expectedBox = expectedTeamBox(expectedTeam);
      const source = sourceTeamLine(team, matchup.possessionsEach);
      return {
        teamId: team.id,
        team: team.shortName,
        card: {
          pace: fixed(team.pace, 1),
          shotQuality: fixed(team.shotQuality, 2),
          defense: fixed(team.defense, 2),
          foulDraw: fixed(team.foulDraw, 2),
          foulDiscipline: fixed(team.foulDiscipline, 2),
          threeTendency: fixed(team.threeTendency, 2)
        },
        sim,
        expected: expectedBox,
        paceAdjustedSource: source,
        delta: boxDelta(sim, source),
        expectedDelta: boxDelta(expectedBox, source),
        simMinusExpected: boxDelta(sim, expectedBox)
      };
    })
  };
}

function runContextSmokeChecks() {
  return matchups.slice(0, 3).flatMap((check) => {
    const away = getTeam(check.awayId);
    const home = getTeam(check.homeId);
    return contextSmokeOptions.map(({ label, options }) => {
      const matchup = buildMatchupCard(away, home, options);
      return {
        label: `${check.label} / ${label}`,
        context: matchup.context.label,
        possessionsEach: matchup.possessionsEach,
        staticFailures: checkStaticMatchupFields(matchup)
      };
    });
  });
}

if (!Number.isFinite(iterations) || iterations <= 0 || !Number.isInteger(iterations) || !Number.isFinite(seed)) {
  throw new Error("Usage: npm run sanity:accuracy -- <iterations=1000> <seed=4242> <outputPath?>");
}

const started = Date.now();
const teams = getDiceTeams();
const cardSanity = checkCards(teams);
const matchupResults = matchups.map(runMatchup);
const contextSmoke = runContextSmokeChecks();
const report = {
  generatedAt: new Date().toISOString(),
  run: {
    modelVersion: crossEraModelVersion,
    iterations,
    seed,
    matchupCount: matchups.length,
    elapsedSeconds: fixed((Date.now() - started) / 1000, 1)
  },
  data: {
    teamsChecked: teams.length,
    seasons: new Set(teams.map((team) => team.season)).size
  },
  cardSanity,
  contextSmoke,
  matchups: matchupResults
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(`Checked ${teams.length} generated team cards across ${report.data.seasons} seasons.`);
console.log(`Card sanity: ${cardSanity.failures.length} failures, ${cardSanity.warnings.length} warnings.`);
console.log(`Context smoke: ${contextSmoke.reduce((sum, item) => sum + item.staticFailures.length, 0)} failures across ${contextSmoke.length} cards.`);
for (const result of matchupResults) {
  const awayRate = result.winRates[result.awayId];
  const homeRate = result.winRates[result.homeId];
  console.log(
    `${result.label}: ${result.away} ${awayRate}% at ${result.home} ${homeRate}% ` +
      `(avg margin away ${result.averageMarginForAway > 0 ? "+" : ""}${result.averageMarginForAway}, ` +
      `expected ${result.expectedMarginForAway > 0 ? "+" : ""}${result.expectedMarginForAway}, ` +
      `sim-exp ${result.simMinusExpectedMarginForAway > 0 ? "+" : ""}${result.simMinusExpectedMarginForAway})`
  );
  for (const team of result.teams) {
    const delta = team.delta;
    const simMinusExpected = team.simMinusExpected;
    console.log(
      `  ${team.team}: delta pts ${delta.pts > 0 ? "+" : ""}${delta.pts}, ` +
        `FGA ${delta.fga > 0 ? "+" : ""}${delta.fga}, 3PA ${delta.threePa > 0 ? "+" : ""}${delta.threePa}, ` +
        `FTA ${delta.fta > 0 ? "+" : ""}${delta.fta}, TOV ${delta.tov > 0 ? "+" : ""}${delta.tov}, ORB ${delta.orb > 0 ? "+" : ""}${delta.orb}; ` +
        `sim-exp pts ${simMinusExpected.pts > 0 ? "+" : ""}${simMinusExpected.pts}, FGA ${simMinusExpected.fga > 0 ? "+" : ""}${simMinusExpected.fga}`
    );
  }
}
console.log(`Saved report: ${outputPath}`);
