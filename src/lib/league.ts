import { simulateGame } from "./diceEngine";
import { getTeam } from "./sourceData";
import type { GameResult, LeagueGame, LeagueState, StatLine } from "./types";

export function createLeague(name: string, teamIds: string[]): LeagueState {
  const games: LeagueGame[] = [];
  for (let i = 0; i < teamIds.length; i += 1) {
    for (let j = i + 1; j < teamIds.length; j += 1) {
      const a = teamIds[i];
      const b = teamIds[j];
      games.push({ id: `${a}-at-${b}-1`, awayTeamId: a, homeTeamId: b, status: "unplayed" });
      games.push({ id: `${b}-at-${a}-1`, awayTeamId: b, homeTeamId: a, status: "unplayed" });
    }
  }

  const now = new Date().toISOString();
  return {
    id: `league-${Date.now()}`,
    name,
    teamIds,
    games,
    createdAt: now,
    updatedAt: now
  };
}

export function simulateLeagueGame(league: LeagueState, gameId: string, seed = Date.now()): LeagueState {
  return updateGame(league, gameId, (game) => {
    const away = getTeam(game.awayTeamId);
    const home = getTeam(game.homeTeamId);
    return {
      ...game,
      status: "simulated",
      result: simulateGame(away, home, seed)
    };
  });
}

export function setManualLeagueResult(league: LeagueState, gameId: string, result: GameResult): LeagueState {
  return updateGame(league, gameId, (game) => ({
    ...game,
    status: "manual",
    result
  }));
}

export function markUnplayed(league: LeagueState, gameId: string): LeagueState {
  return updateGame(league, gameId, (game) => ({
    ...game,
    status: "unplayed",
    result: undefined
  }));
}

function updateGame(league: LeagueState, gameId: string, updater: (game: LeagueGame) => LeagueGame): LeagueState {
  return {
    ...league,
    games: league.games.map((game) => (game.id === gameId ? updater(game) : game)),
    updatedAt: new Date().toISOString()
  };
}

export function standings(league: LeagueState) {
  const rows = Object.fromEntries(
    league.teamIds.map((teamId) => [
      teamId,
      {
        teamId,
        wins: 0,
        losses: 0,
        ties: 0,
        played: 0,
        pointsFor: 0,
        pointsAgainst: 0
      }
    ])
  );

  for (const game of league.games) {
    if (!game.result) continue;
    const away = rows[game.awayTeamId];
    const home = rows[game.homeTeamId];
    away.played += 1;
    home.played += 1;
    away.pointsFor += game.result.awayScore;
    away.pointsAgainst += game.result.homeScore;
    home.pointsFor += game.result.homeScore;
    home.pointsAgainst += game.result.awayScore;
    if (game.result.winnerTeamId === "tie") {
      away.ties += 1;
      home.ties += 1;
    } else if (game.result.winnerTeamId === game.awayTeamId) {
      away.wins += 1;
      home.losses += 1;
    } else {
      home.wins += 1;
      away.losses += 1;
    }
  }

  return Object.values(rows)
    .map((row) => ({
      ...row,
      winPct: row.played ? (row.wins + row.ties * 0.5) / row.played : 0,
      differential: row.pointsFor - row.pointsAgainst
    }))
    .sort((a, b) => b.winPct - a.winPct || b.differential - a.differential);
}

export function aggregateTeamStats(league: LeagueState): Record<string, StatLine & { games: number }> {
  const rows: Record<string, StatLine & { games: number }> = {};
  for (const teamId of league.teamIds) {
    rows[teamId] = { games: 0 };
  }
  for (const game of league.games) {
    if (!game.result) continue;
    for (const teamId of [game.awayTeamId, game.homeTeamId]) {
      const target = rows[teamId];
      target.games += 1;
      for (const [field, value] of Object.entries(game.result.teamStats[teamId] ?? {})) {
        target[field] = (target[field] ?? 0) + value;
      }
    }
  }
  return rows;
}

export function aggregatePlayerStats(league: LeagueState) {
  const rows: Array<{ teamId: string; player: string; games: number; totals: StatLine; perGame: StatLine }> = [];
  const map = new Map<string, { teamId: string; player: string; games: number; totals: StatLine }>();

  for (const game of league.games) {
    if (!game.result) continue;
    for (const teamId of [game.awayTeamId, game.homeTeamId]) {
      for (const [player, line] of Object.entries(game.result.playerStats[teamId] ?? {})) {
        const key = `${teamId}:${player}`;
        const target = map.get(key) ?? { teamId, player, games: 0, totals: {} };
        target.games += 1;
        for (const [field, value] of Object.entries(line)) {
          target.totals[field] = (target.totals[field] ?? 0) + value;
        }
        map.set(key, target);
      }
    }
  }

  for (const row of map.values()) {
    rows.push({
      ...row,
      perGame: Object.fromEntries(Object.entries(row.totals).map(([field, value]) => [field, value / Math.max(1, row.games)]))
    });
  }

  return rows.sort((a, b) => (b.perGame.PTS ?? 0) - (a.perGame.PTS ?? 0));
}
