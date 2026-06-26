import { simulateGame } from "./diceEngine";
import type { DiceTeamCard, GameResult, LeagueGame, LeagueState, StatLine } from "./types";

export function createTournament(name: string, teamIds: string[]): LeagueState {
  const games: LeagueGame[] = [];
  let gameIndex = 1;
  for (let i = 0; i < teamIds.length; i += 1) {
    for (let j = i + 1; j < teamIds.length; j += 1) {
      const a = teamIds[i];
      const b = teamIds[j];
      games.push({ id: `${a}-at-${b}-1`, awayTeamId: a, homeTeamId: b, sequence: gameIndex, status: "unplayed" });
      gameIndex += 1;
      games.push({ id: `${b}-at-${a}-1`, awayTeamId: b, homeTeamId: a, sequence: gameIndex, status: "unplayed" });
      gameIndex += 1;
    }
  }

  const now = new Date().toISOString();
  return {
    id: `tournament-${Date.now()}`,
    name,
    teamIds,
    games,
    createdAt: now,
    updatedAt: now
  };
}

function addScheduledGame(games: LeagueGame[], awayTeamId: string, homeTeamId: string, index: number): void {
  games.push({
    id: `${awayTeamId}-at-${homeTeamId}-${index}`,
    awayTeamId,
    homeTeamId,
    sequence: index,
    status: "unplayed"
  });
}

function addDaysIso(date: string, days: number): string {
  const nextDate = new Date(`${date}T00:00:00.000Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return nextDate.toISOString().slice(0, 10);
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

function teamIdsForGames(games: LeagueGame[]): string[] {
  return Array.from(new Set(games.flatMap((game) => [game.awayTeamId, game.homeTeamId])));
}

function teamGameCounts(games: LeagueGame[], teams: string[]): Map<string, number> {
  const counts = new Map(teams.map((teamId) => [teamId, 0]));
  for (const game of games) {
    counts.set(game.awayTeamId, (counts.get(game.awayTeamId) ?? 0) + 1);
    counts.set(game.homeTeamId, (counts.get(game.homeTeamId) ?? 0) + 1);
  }
  return counts;
}

function targetSeasonDaysFor(maxGamesPerTeam: number): number {
  if (maxGamesPerTeam >= 70) return 174;
  return Math.max(21, Math.ceil(maxGamesPerTeam * 2.12));
}

function dailySlateLimit(teamCount: number): number {
  const fullSlate = Math.floor(teamCount / 2);
  if (teamCount <= 2) return fullSlate;
  return Math.max(1, fullSlate - 1);
}

function slateWeightForDate(date: string, dayIndex: number, seasonDays: number): number {
  const dayOfWeek = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  const weeklyWeights = [0.7, 1.08, 0.62, 1.34, 0.56, 1.28, 1.02];
  let weight = weeklyWeights[dayOfWeek];

  if (seasonDays >= 140) {
    const breakStart = Math.round(seasonDays * 0.66);
    if (dayIndex >= breakStart && dayIndex < breakStart + 5) {
      return dayIndex === breakStart + 4 ? 0.25 : 0;
    }
  }

  if (dayIndex > 0 && dayIndex % 31 === 17) weight *= 0.45;
  if (dayIndex > 0 && dayIndex % 47 === 29) weight *= 0.25;
  return weight;
}

function buildSlateTargets(totalGames: number, teamCount: number, seasonStartDate: string, seasonDays: number): number[] {
  const slateLimit = dailySlateLimit(teamCount);
  if (!totalGames || !slateLimit) return [];

  let dayCount = Math.max(seasonDays, Math.ceil(totalGames / slateLimit));
  while (dayCount * slateLimit < totalGames) dayCount += 1;

  const weights = Array.from({ length: dayCount }, (_, dayIndex) => slateWeightForDate(addDaysIso(seasonStartDate, dayIndex), dayIndex, seasonDays));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || dayCount;
  const quotas = weights.map((weight) => (totalGames * (weight || 0)) / totalWeight);
  const targets = quotas.map((quota) => Math.min(slateLimit, Math.floor(quota)));
  let remaining = totalGames - targets.reduce((sum, target) => sum + target, 0);

  while (remaining > 0) {
    let bestIndex = -1;
    let bestScore = -Infinity;
    for (let index = 0; index < targets.length; index += 1) {
      if (targets[index] >= slateLimit) continue;
      const score = quotas[index] - targets[index] + weights[index] * 0.001 - index * 0.000001;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    if (bestIndex < 0) {
      targets.push(1);
      weights.push(1);
      quotas.push(1);
    } else {
      targets[bestIndex] += 1;
    }
    remaining -= 1;
  }

  return targets;
}

function recentGameCount(recentDays: Map<string, number[]>, teamId: string, dayIndex: number): number {
  return (recentDays.get(teamId) ?? []).filter((playedDay) => dayIndex - playedDay <= 6).length;
}

function deterministicJitter(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return (hash % 997) / 997;
}

function assignSeasonDates(games: LeagueGame[], seasonStartDate: string): LeagueGame[] {
  const teams = teamIdsForGames(games);
  const teamTotals = teamGameCounts(games, teams);
  const maxGamesPerTeam = Math.max(0, ...teamTotals.values());
  const seasonDays = targetSeasonDaysFor(maxGamesPerTeam);
  const slateTargets = buildSlateTargets(games.length, teams.length, seasonStartDate, seasonDays);
  const unscheduled = games.map((game, index) => ({ ...game, sequence: game.sequence ?? index + 1 }));
  const scheduled: LeagueGame[] = [];
  const scheduledByTeam = new Map(teams.map((teamId) => [teamId, 0]));
  const lastPlayedDay = new Map<string, number>();
  const recentDays = new Map(teams.map((teamId) => [teamId, [] as number[]]));
  const lastPairDay = new Map<string, number>();
  let dayIndex = 0;

  while (unscheduled.length) {
    const gamesTodayTarget = slateTargets[dayIndex] ?? Math.min(dailySlateLimit(teams.length), unscheduled.length);
    const teamsToday = new Set<string>();
    const date = addDaysIso(seasonStartDate, dayIndex);

    for (let gamesToday = 0; gamesToday < gamesTodayTarget; gamesToday += 1) {
      let bestIndex = -1;
      let bestScore = -Infinity;

      for (let relaxLevel = 0; relaxLevel < 4 && bestIndex < 0; relaxLevel += 1) {
        for (let index = 0; index < unscheduled.length; index += 1) {
          const game = unscheduled[index];
          if (teamsToday.has(game.awayTeamId) || teamsToday.has(game.homeTeamId)) continue;

          const awayLastPlayed = lastPlayedDay.get(game.awayTeamId);
          const homeLastPlayed = lastPlayedDay.get(game.homeTeamId);
          const awayRest = awayLastPlayed === undefined ? 99 : dayIndex - awayLastPlayed;
          const homeRest = homeLastPlayed === undefined ? 99 : dayIndex - homeLastPlayed;
          const awayRecent = recentGameCount(recentDays, game.awayTeamId, dayIndex);
          const homeRecent = recentGameCount(recentDays, game.homeTeamId, dayIndex);
          const key = pairKey(game.awayTeamId, game.homeTeamId);
          const pairLastPlayed = lastPairDay.get(key);
          const pairRest = pairLastPlayed === undefined ? 99 : dayIndex - pairLastPlayed;

          if (relaxLevel === 0 && (awayRest < 2 || homeRest < 2 || awayRecent >= 4 || homeRecent >= 4 || pairRest < 5)) continue;
          if (relaxLevel === 1 && (awayRest < 2 || homeRest < 2 || awayRecent >= 5 || homeRecent >= 5)) continue;
          if (relaxLevel === 2 && (awayRest < 1 || homeRest < 1 || awayRecent >= 5 || homeRecent >= 5)) continue;

          const awayExpected = ((dayIndex + 1) / seasonDays) * (teamTotals.get(game.awayTeamId) ?? 0);
          const homeExpected = ((dayIndex + 1) / seasonDays) * (teamTotals.get(game.homeTeamId) ?? 0);
          const awayBehind = awayExpected - (scheduledByTeam.get(game.awayTeamId) ?? 0);
          const homeBehind = homeExpected - (scheduledByTeam.get(game.homeTeamId) ?? 0);
          const restScore = Math.min(awayRest, 5) + Math.min(homeRest, 5);
          const pairSpacingScore = Math.min(pairRest, 18) * 0.2;
          const backToBackPenalty = awayRest === 1 || homeRest === 1 ? 18 : 0;
          const score =
            (awayBehind + homeBehind) * 9 +
            restScore +
            pairSpacingScore -
            backToBackPenalty -
            (game.sequence ?? index) * 0.0001 +
            deterministicJitter(game.id) * 0.01;

          if (score > bestScore) {
            bestScore = score;
            bestIndex = index;
          }
        }
      }

      if (bestIndex < 0) break;

      const [game] = unscheduled.splice(bestIndex, 1);
      teamsToday.add(game.awayTeamId);
      teamsToday.add(game.homeTeamId);
      scheduled.push({
        ...game,
        date,
        round: dayIndex + 1
      });
      scheduledByTeam.set(game.awayTeamId, (scheduledByTeam.get(game.awayTeamId) ?? 0) + 1);
      scheduledByTeam.set(game.homeTeamId, (scheduledByTeam.get(game.homeTeamId) ?? 0) + 1);
      lastPlayedDay.set(game.awayTeamId, dayIndex);
      lastPlayedDay.set(game.homeTeamId, dayIndex);
      recentDays.set(game.awayTeamId, [...(recentDays.get(game.awayTeamId) ?? []), dayIndex].filter((playedDay) => dayIndex - playedDay <= 6));
      recentDays.set(game.homeTeamId, [...(recentDays.get(game.homeTeamId) ?? []), dayIndex].filter((playedDay) => dayIndex - playedDay <= 6));
      lastPairDay.set(pairKey(game.awayTeamId, game.homeTeamId), dayIndex);
    }

    dayIndex += 1;
  }

  return scheduled.map((game, index) => ({ ...game, sequence: index + 1 }));
}

export function createSeasonLeague(name: string, teamIds: string[], gamesPerTeam = 82, seasonStartDate = "2025-10-21"): LeagueState {
  const teams = [...teamIds];
  const games: LeagueGame[] = [];
  const homeCounts = new Map(teams.map((teamId) => [teamId, 0]));
  const totalCounts = new Map(teams.map((teamId) => [teamId, 0]));
  const extraCounts = new Map(teams.map((teamId) => [teamId, 0]));
  const pairCounts = new Map<string, number>();
  let gameIndex = 1;

  const schedule = (awayTeamId: string, homeTeamId: string) => {
    addScheduledGame(games, awayTeamId, homeTeamId, gameIndex);
    gameIndex += 1;
    homeCounts.set(homeTeamId, (homeCounts.get(homeTeamId) ?? 0) + 1);
    totalCounts.set(awayTeamId, (totalCounts.get(awayTeamId) ?? 0) + 1);
    totalCounts.set(homeTeamId, (totalCounts.get(homeTeamId) ?? 0) + 1);
    const key = pairKey(awayTeamId, homeTeamId);
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
  };

  for (let i = 0; i < teams.length; i += 1) {
    for (let j = i + 1; j < teams.length; j += 1) {
      schedule(teams[i], teams[j]);
      schedule(teams[j], teams[i]);
    }
  }

  const baseGamesPerTeam = Math.max(0, (teams.length - 1) * 2);
  const extraTarget = Math.max(0, gamesPerTeam - baseGamesPerTeam);
  let guard = 0;
  while (teams.some((teamId) => (extraCounts.get(teamId) ?? 0) < extraTarget) && guard < teams.length * extraTarget * 12) {
    guard += 1;
    const ordered = [...teams].sort((a, b) => (extraCounts.get(a) ?? 0) - (extraCounts.get(b) ?? 0) || a.localeCompare(b));
    let added = false;
    for (const teamId of ordered) {
      if ((extraCounts.get(teamId) ?? 0) >= extraTarget) continue;
      const opponent = ordered
        .filter((candidate) => candidate !== teamId && (extraCounts.get(candidate) ?? 0) < extraTarget)
        .sort(
          (a, b) =>
            (pairCounts.get(pairKey(teamId, a)) ?? 0) - (pairCounts.get(pairKey(teamId, b)) ?? 0) ||
            (extraCounts.get(a) ?? 0) - (extraCounts.get(b) ?? 0) ||
            a.localeCompare(b)
        )[0];
      if (!opponent) continue;

      const teamHomeCount = homeCounts.get(teamId) ?? 0;
      const opponentHomeCount = homeCounts.get(opponent) ?? 0;
      const homeTeamId = teamHomeCount <= opponentHomeCount ? teamId : opponent;
      const awayTeamId = homeTeamId === teamId ? opponent : teamId;
      schedule(awayTeamId, homeTeamId);
      extraCounts.set(teamId, (extraCounts.get(teamId) ?? 0) + 1);
      extraCounts.set(opponent, (extraCounts.get(opponent) ?? 0) + 1);
      added = true;
    }
    if (!added) break;
  }

  const now = new Date().toISOString();
  return {
    id: `season-league-${Date.now()}`,
    name,
    teamIds: teams,
    games: assignSeasonDates(games, seasonStartDate),
    currentDate: seasonStartDate,
    focusTeamId: teams[0],
    createdAt: now,
    updatedAt: now
  };
}

export const createLeague = createTournament;

export function renameLeague(league: LeagueState, name: string): LeagueState {
  const trimmedName = name.trim();
  return {
    ...league,
    name: trimmedName || league.name,
    updatedAt: new Date().toISOString()
  };
}

export function simulateLeagueGameWithTeams(league: LeagueState, gameId: string, away: DiceTeamCard, home: DiceTeamCard, seed = Date.now()): LeagueState {
  return updateGame(league, gameId, (game) => {
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

export function setSimulatedLeagueResult(league: LeagueState, gameId: string, result: GameResult): LeagueState {
  return updateGame(league, gameId, (game) => ({
    ...game,
    status: "simulated",
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

export function setLeagueCurrentDate(league: LeagueState, currentDate: string): LeagueState {
  return {
    ...league,
    currentDate,
    updatedAt: new Date().toISOString()
  };
}

export function setLeagueFocusTeam(league: LeagueState, focusTeamId: string | null): LeagueState {
  return {
    ...league,
    focusTeamId: focusTeamId ?? undefined,
    updatedAt: new Date().toISOString()
  };
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
      const line = game.result.teamStats[teamId] ?? {};
      target.games += 1;
      for (const [field, value] of Object.entries(line)) {
        if (field === "REB") continue;
        target[field] = (target[field] ?? 0) + value;
      }
      if (line.REB !== undefined || line.OREB !== undefined || line.DREB !== undefined) {
        target.REB = (target.REB ?? 0) + Math.max(line.REB ?? 0, (line.OREB ?? 0) + (line.DREB ?? 0));
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
