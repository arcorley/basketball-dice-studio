import { buildMatchupCard, summarizeSimulations } from "../src/lib/diceEngine";
import { diceTeams } from "../src/lib/sourceData";
import type { DiceTeamCard, SourcePlayer, StatLine } from "../src/lib/types";

const [awayId = "2020-21-pho", homeId = "1992-93-chi", gamesArg = "500", seedArg = "4242"] = process.argv.slice(2);
const games = Number(gamesArg);
const seed = Number(seedArg);

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function rate(made: number, attempts: number): string {
  return attempts > 0 ? pct(made / attempts) : "-";
}

function fixed(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function perGame(value: number | null | undefined, games: number): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return 0;
  return value / games;
}

function sourceGames(team: DiceTeamCard): number {
  const wins = team.source.team.wins;
  const losses = team.source.team.losses;
  if (wins === null || wins === undefined || losses === null || losses === undefined) {
    throw new Error(`Missing source wins/losses for ${team.id}`);
  }
  return wins + losses;
}

function sourceTeamLine(team: DiceTeamCard) {
  const games = sourceGames(team);
  const totals = team.source.team.totals;
  return {
    pts: perGame(totals.pts, games),
    fga: perGame(totals.fga, games),
    fgPct: rate(totals.fg ?? 0, totals.fga ?? 0),
    threePa: perGame(totals.fg3a, games),
    threePct: rate(totals.fg3 ?? 0, totals.fg3a ?? 0),
    fta: perGame(totals.fta, games),
    ftPct: rate(totals.ft ?? 0, totals.fta ?? 0),
    tov: perGame(totals.tov, games),
    orb: perGame(totals.orb, games)
  };
}

function simTeamLine(line: StatLine) {
  return {
    pts: Number(line.PTS.toFixed(1)),
    fga: Number(line.FGA.toFixed(1)),
    fgPct: rate(line.FGM, line.FGA),
    threePa: Number(line["3PA"].toFixed(1)),
    threePct: rate(line["3PM"], line["3PA"]),
    fta: Number(line.FTA.toFixed(1)),
    ftPct: rate(line.FTM, line.FTA),
    tov: Number(line.TOV.toFixed(1)),
    orb: Number(line.OREB.toFixed(1))
  };
}

function deltas(sim: ReturnType<typeof simTeamLine>, source: ReturnType<typeof sourceTeamLine>) {
  return {
    pts: Number((sim.pts - source.pts).toFixed(1)),
    fga: Number((sim.fga - source.fga).toFixed(1)),
    threePa: Number((sim.threePa - source.threePa).toFixed(1)),
    fta: Number((sim.fta - source.fta).toFixed(1)),
    tov: Number((sim.tov - source.tov).toFixed(1)),
    orb: Number((sim.orb - source.orb).toFixed(1))
  };
}

function playerSourceLine(player: SourcePlayer) {
  return {
    pts: player.perGame.pts ?? 0,
    fga: player.perGame.fga ?? 0,
    threePa: player.perGame.fg3a ?? 0,
    fta: player.perGame.fta ?? 0,
    tov: player.perGame.tov ?? 0,
    ast: player.perGame.ast ?? 0
  };
}

function playerSimLine(line: StatLine | undefined) {
  return {
    pts: Number((line?.PTS ?? 0).toFixed(1)),
    fga: Number((line?.FGA ?? 0).toFixed(1)),
    threePa: Number((line?.["3PA"] ?? 0).toFixed(1)),
    fta: Number((line?.FTA ?? 0).toFixed(1)),
    tov: Number((line?.TOV ?? 0).toFixed(1)),
    ast: Number((line?.AST ?? 0).toFixed(1))
  };
}

const away = diceTeams.find((team) => team.id === awayId);
const home = diceTeams.find((team) => team.id === homeId);

if (!away || !home) {
  throw new Error(`Unknown matchup: ${awayId} at ${homeId}`);
}

if (!Number.isFinite(games) || games <= 0 || !Number.isFinite(seed)) {
  throw new Error("Usage: npm run calibrate:matchup -- <awayId> <homeId> <games> <seed>");
}

const summary = summarizeSimulations(away, home, games, seed);
const matchup = buildMatchupCard(away, home);

for (const team of [away, home]) {
  const line = summary.teams[team.id];
  const sim = simTeamLine(line);
  const source = sourceTeamLine(team);
  const matchupRows = team.id === away.id ? matchup.awayPlayerRanges : matchup.homePlayerRanges;
  const rangeByPlayer = new Map(matchupRows.map((row) => [row.player, row.raw]));
  const wins = summary.wins[team.id] ?? 0;
  console.log(`${team.shortName}: ${wins}-${games - wins - (summary.wins.tie ?? 0)} (${pct(wins / games)})`);
  console.log(
    JSON.stringify(
      {
        card: {
          pace: Number(team.pace.toFixed(1)),
          shotQuality: fixed(team.shotQuality),
          defense: fixed(team.defense),
          toPress: fixed(team.toPress),
          toProtect: fixed(team.toProtect),
          foulDraw: fixed(team.foulDraw),
          foulDiscipline: fixed(team.foulDiscipline),
          threeTendency: fixed(team.threeTendency),
          orb: fixed(team.orb),
          drb: fixed(team.drb)
        },
        avg: sim,
        source,
        delta: deltas(sim, source),
        topPlayers: team.players.slice(0, 8).map((player) => {
          const raw = rangeByPlayer.get(player.name);
          return {
            name: player.name,
            effective: raw
              ? {
                  tov: fixed(raw.tov, 1),
                  foulDraw: fixed(raw.fd, 1),
                  threeFrequency: fixed(raw.three, 1),
                  p2: fixed(raw.p2, 1),
                  p3: fixed(raw.p3, 1),
                  ft: fixed(raw.ft, 1)
                }
              : null,
            sim: playerSimLine(summary.players[team.id][player.name]),
            source: playerSourceLine(player.source)
          };
        })
      },
      null,
      2
    )
  );
}

if (summary.wins.tie) {
  console.log(`Ties: ${summary.wins.tie} (${pct(summary.wins.tie / games)})`);
}
