import { simulateGame } from "./diceEngine";
import type {
  DiceTeamCard,
  GameResult,
  LeagueGame,
  LeaguePlayInGame,
  LeaguePlayoffSeed,
  LeaguePlayoffSeries,
  LeagueState,
  MatchupOptions,
  StatLine
} from "./types";

export type LeagueGameScope = "regular" | "play-in" | "playoffs" | "postseason" | "all";

export interface LeaguePlayoffSeriesState {
  winsA: number;
  winsB: number;
  winnerTeamId?: string;
  status: "scheduled" | "complete";
  nextGame?: LeagueGame;
  completedGames: LeagueGame[];
}

const playoffWinsNeeded = 4;
const playoffHomeOrder: Array<"A" | "B"> = ["A", "A", "B", "B", "A", "B", "A"];
const firstRoundSeedMatchups: Array<[number, number]> = [
  [1, 8],
  [4, 5],
  [2, 7],
  [3, 6]
];
const playoffRoundNames: Record<number, string> = {
  1: "First Round",
  2: "Conference Semifinals",
  3: "Conference Finals",
  4: "Finals"
};

export function createTournament(name: string, teamIds: string[]): LeagueState {
  const games: LeagueGame[] = [];
  let gameIndex = 1;
  for (let i = 0; i < teamIds.length; i += 1) {
    for (let j = i + 1; j < teamIds.length; j += 1) {
      const a = teamIds[i];
      const b = teamIds[j];
      games.push({ id: `${a}-at-${b}-1`, awayTeamId: a, homeTeamId: b, sequence: gameIndex, stage: "regular", status: "unplayed" });
      gameIndex += 1;
      games.push({ id: `${b}-at-${a}-1`, awayTeamId: b, homeTeamId: a, sequence: gameIndex, stage: "regular", status: "unplayed" });
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
    stage: "regular",
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

function gameStage(game: Pick<LeagueGame, "stage">): "regular" | "play-in" | "playoffs" {
  if (game.stage === "play-in") return "play-in";
  if (game.stage === "playoffs") return "playoffs";
  return "regular";
}

function gamesForScope(games: LeagueGame[], scope: LeagueGameScope): LeagueGame[] {
  if (scope === "all") return games;
  if (scope === "postseason") return games.filter((game) => gameStage(game) !== "regular");
  return games.filter((game) => gameStage(game) === scope);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "league";
}

function maxSequence(games: LeagueGame[]): number {
  return games.reduce((max, game) => Math.max(max, game.sequence ?? 0), 0);
}

function lastScheduledDate(games: LeagueGame[]): string {
  return games.reduce((latest, game) => (game.date && game.date > latest ? game.date : latest), "");
}

function playoffRoundName(round: number): string {
  return playoffRoundNames[round] ?? `Round ${round}`;
}

function seedForTeam(playoffs: NonNullable<LeagueState["playoffs"]>, teamId: string): LeaguePlayoffSeed | undefined {
  return (playoffs.playoffSeeds ?? playoffs.seeds).find((seed) => seed.teamId === teamId);
}

function playoffSeriesWinner(league: LeagueState, series: LeaguePlayoffSeries): string | undefined {
  return playoffSeriesState(league, series).winnerTeamId;
}

function regularSeasonRowMap(league: LeagueState): Map<string, ReturnType<typeof standings>[number]> {
  return new Map(standings(league).map((row) => [row.teamId, row]));
}

function homeCourtTeamId(league: LeagueState, teamAId: string, teamBId: string, conference: string): string {
  const playoffs = league.playoffs;
  const seedA = playoffs ? seedForTeam(playoffs, teamAId) : undefined;
  const seedB = playoffs ? seedForTeam(playoffs, teamBId) : undefined;
  if (conference !== "Finals" && seedA?.conference === seedB?.conference && seedA && seedB) {
    return seedA.seed <= seedB.seed ? teamAId : teamBId;
  }

  const rows = regularSeasonRowMap(league);
  const rowA = rows.get(teamAId);
  const rowB = rows.get(teamBId);
  const compare =
    (rowB?.winPct ?? 0) - (rowA?.winPct ?? 0) ||
    (rowB?.wins ?? 0) - (rowA?.wins ?? 0) ||
    (rowB?.differential ?? 0) - (rowA?.differential ?? 0);
  if (compare < 0) return teamAId;
  if (compare > 0) return teamBId;
  return teamAId.localeCompare(teamBId) <= 0 ? teamAId : teamBId;
}

function buildPlayoffSeries(args: {
  league: LeagueState;
  round: number;
  conference: string;
  bracketIndex: number;
  teamAId: string;
  teamBId: string;
  sourceSeriesIds?: string[];
}): Omit<LeaguePlayoffSeries, "gameIds" | "createdAt"> {
  const playoffs = args.league.playoffs;
  const seedA = playoffs ? seedForTeam(playoffs, args.teamAId) : undefined;
  const seedB = playoffs ? seedForTeam(playoffs, args.teamBId) : undefined;
  const homeTeamId = homeCourtTeamId(args.league, args.teamAId, args.teamBId, args.conference);
  const teamAId = homeTeamId === args.teamAId ? args.teamAId : args.teamBId;
  const teamBId = teamAId === args.teamAId ? args.teamBId : args.teamAId;
  const homeSeed = teamAId === args.teamAId ? seedA : seedB;
  const awaySeed = teamBId === args.teamAId ? seedA : seedB;
  const roundSlug = `r${args.round}`;
  const conferenceSlug = slug(args.conference);
  const id = `playoffs-${roundSlug}-${conferenceSlug}-${args.bracketIndex + 1}-${slug(teamAId)}-vs-${slug(teamBId)}`;

  return {
    id,
    round: args.round,
    roundName: playoffRoundName(args.round),
    conference: args.conference,
    bracketIndex: args.bracketIndex,
    teamAId,
    teamBId,
    seedA: homeSeed?.seed,
    seedB: awaySeed?.seed,
    homeCourtTeamId: teamAId,
    sourceSeriesIds: args.sourceSeriesIds
  };
}

function gamesForPlayoffSeries(series: Omit<LeaguePlayoffSeries, "gameIds" | "createdAt">, startDate: string, startSequence: number): LeagueGame[] {
  return playoffHomeOrder.map((homeSlot, index) => {
    const gameNumber = index + 1;
    const homeTeamId = homeSlot === "A" ? series.teamAId : series.teamBId;
    const awayTeamId = homeTeamId === series.teamAId ? series.teamBId : series.teamAId;
    return {
      id: `${series.id}-g${gameNumber}`,
      awayTeamId,
      homeTeamId,
      date: addDaysIso(startDate, index * 2),
      round: series.round,
      sequence: startSequence + index,
      stage: "playoffs",
      playoffRound: series.round,
      playoffSeriesId: series.id,
      playoffGameNumber: gameNumber,
      playoffSeriesLabel: `${series.conference} ${series.roundName}`,
      status: "unplayed"
    };
  });
}

function appendPlayoffSeries(league: LeagueState, seriesInputs: Array<Omit<LeaguePlayoffSeries, "gameIds" | "createdAt">>, startDate: string): LeagueState {
  if (!league.playoffs || !seriesInputs.length) return league;
  const now = new Date().toISOString();
  let nextSequence = maxSequence(league.games) + 1;
  const games: LeagueGame[] = [];
  const seriesRows: LeaguePlayoffSeries[] = [];

  for (const input of seriesInputs) {
    const seriesGames = gamesForPlayoffSeries(input, startDate, nextSequence);
    nextSequence += seriesGames.length;
    games.push(...seriesGames);
    seriesRows.push({
      ...input,
      gameIds: seriesGames.map((game) => game.id),
      createdAt: now
    });
  }

  return {
    ...league,
    games: [...league.games, ...games],
    playoffs: {
      ...league.playoffs,
      series: [...league.playoffs.series, ...seriesRows],
      updatedAt: now
    },
    updatedAt: now
  };
}

function conferenceOrderFromSeeds(seeds: LeaguePlayoffSeed[]): string[] {
  const preferred = ["Eastern", "Western"];
  const found = Array.from(new Set(seeds.map((seed) => seed.conference)));
  return [...preferred.filter((conference) => found.includes(conference)), ...found.filter((conference) => !preferred.includes(conference)).sort()];
}

function seedTeam(seeds: LeaguePlayoffSeed[], conference: string, seed: number): string | undefined {
  return seeds.find((row) => row.conference === conference && row.seed === seed)?.teamId;
}

function seedForTeamFromList(seeds: LeaguePlayoffSeed[], teamId: string): LeaguePlayoffSeed | undefined {
  return seeds.find((seed) => seed.teamId === teamId);
}

function playInKindLabel(kind: LeaguePlayInGame["kind"]): string {
  if (kind === "seven-eight") return "7/8 Game";
  if (kind === "nine-ten") return "9/10 Game";
  return "8 Seed Game";
}

function appendPlayInGames(league: LeagueState, inputs: Array<Omit<LeaguePlayInGame, "gameId" | "createdAt">>, startDate: string): LeagueState {
  if (!league.playoffs || !inputs.length) return league;
  const now = new Date().toISOString();
  let nextSequence = maxSequence(league.games) + 1;
  const games: LeagueGame[] = [];
  const playInGames: LeaguePlayInGame[] = [];

  for (const input of inputs) {
    const id = input.id;
    const gameDate = input.kind === "nine-ten" ? addDaysIso(startDate, 1) : startDate;
    const gameId = `${id}-game`;
    games.push({
      id: gameId,
      awayTeamId: input.awayTeamId,
      homeTeamId: input.homeTeamId,
      date: gameDate,
      round: 0,
      sequence: nextSequence,
      stage: "play-in",
      playoffRound: 0,
      playoffGameNumber: input.kind === "seven-eight" ? 1 : input.kind === "nine-ten" ? 2 : 3,
      playoffSeriesLabel: `${input.conference} Play-In ${playInKindLabel(input.kind)}`,
      status: "unplayed"
    });
    nextSequence += 1;
    playInGames.push({
      ...input,
      gameId,
      createdAt: now
    });
  }

  return {
    ...league,
    games: [...league.games, ...games],
    playoffs: {
      ...league.playoffs,
      playInGames: [...league.playoffs.playInGames, ...playInGames],
      updatedAt: now
    },
    updatedAt: now
  };
}

function gameById(league: LeagueState, gameId: string): LeagueGame | undefined {
  return league.games.find((game) => game.id === gameId);
}

function gameWinner(league: LeagueState, gameId: string): string | undefined {
  const winnerTeamId = gameById(league, gameId)?.result?.winnerTeamId;
  return winnerTeamId && winnerTeamId !== "tie" ? winnerTeamId : undefined;
}

function gameLoser(league: LeagueState, gameId: string): string | undefined {
  const game = gameById(league, gameId);
  const winnerTeamId = game?.result?.winnerTeamId;
  if (!game || !winnerTeamId || winnerTeamId === "tie") return undefined;
  return winnerTeamId === game.awayTeamId ? game.homeTeamId : game.awayTeamId;
}

function playInGame(playoffs: NonNullable<LeagueState["playoffs"]>, conference: string, kind: LeaguePlayInGame["kind"]): LeaguePlayInGame | undefined {
  return playoffs.playInGames.find((game) => game.conference === conference && game.kind === kind);
}

export function startLeaguePlayoffs(league: LeagueState, seeds: LeaguePlayoffSeed[], startDate?: string): LeagueState {
  if (league.playoffs) return league;
  const orderedSeeds = seeds
    .filter((seed) => league.teamIds.includes(seed.teamId))
    .sort((a, b) => a.conference.localeCompare(b.conference) || a.seed - b.seed);
  const conferences = conferenceOrderFromSeeds(orderedSeeds).filter((conference) => orderedSeeds.filter((seed) => seed.conference === conference).length >= 10);
  if (conferences.length < 2) {
    throw new Error("The NBA play-in needs at least two conferences with ten seeded teams each.");
  }

  const now = new Date().toISOString();
  const initialLeague: LeagueState = {
    ...league,
    playoffs: {
      format: "nba-play-in-and-playoffs",
      status: "in-progress",
      seeds: orderedSeeds.filter((seed) => seed.seed <= 10),
      playInGames: [],
      series: [],
      createdAt: now,
      updatedAt: now
    },
    updatedAt: now
  };
  const playInInputs = conferences.flatMap((conference) => {
    const seed7 = seedTeam(orderedSeeds, conference, 7);
    const seed8 = seedTeam(orderedSeeds, conference, 8);
    const seed9 = seedTeam(orderedSeeds, conference, 9);
    const seed10 = seedTeam(orderedSeeds, conference, 10);
    if (!seed7 || !seed8 || !seed9 || !seed10) throw new Error(`Missing ${conference} play-in seeds.`);
    return [
      {
        id: `play-in-${slug(conference)}-seven-eight`,
        conference,
        kind: "seven-eight" as const,
        homeTeamId: seed7,
        awayTeamId: seed8,
        homeSeed: 7,
        awaySeed: 8
      },
      {
        id: `play-in-${slug(conference)}-nine-ten`,
        conference,
        kind: "nine-ten" as const,
        homeTeamId: seed9,
        awayTeamId: seed10,
        homeSeed: 9,
        awaySeed: 10
      }
    ];
  });

  const regularEndDate = lastScheduledDate(gamesForScope(league.games, "regular"));
  const playInStartDate = startDate || (regularEndDate ? addDaysIso(regularEndDate, 3) : new Date().toISOString().slice(0, 10));
  return appendPlayInGames(initialLeague, playInInputs, playInStartDate);
}

export function clearLeaguePlayoffs(league: LeagueState): LeagueState {
  if (!league.playoffs && !league.games.some((game) => gameStage(game) !== "regular")) return league;
  return {
    ...league,
    games: league.games.filter((game) => gameStage(game) === "regular"),
    playoffs: undefined,
    updatedAt: new Date().toISOString()
  };
}

function appendNeededPlayInFinals(league: LeagueState): LeagueState {
  if (!league.playoffs) return league;
  const inputs: Array<Omit<LeaguePlayInGame, "gameId" | "createdAt">> = [];

  for (const conference of conferenceOrderFromSeeds(league.playoffs.seeds)) {
    if (playInGame(league.playoffs, conference, "eight-seed")) continue;
    const sevenEight = playInGame(league.playoffs, conference, "seven-eight");
    const nineTen = playInGame(league.playoffs, conference, "nine-ten");
    if (!sevenEight || !nineTen) continue;
    const sevenEightLoser = gameLoser(league, sevenEight.gameId);
    const nineTenWinner = gameWinner(league, nineTen.gameId);
    if (!sevenEightLoser || !nineTenWinner) continue;
    const loserSeed = seedForTeamFromList(league.playoffs.seeds, sevenEightLoser);
    const winnerSeed = seedForTeamFromList(league.playoffs.seeds, nineTenWinner);
    inputs.push({
      id: `play-in-${slug(conference)}-eight-seed`,
      conference,
      kind: "eight-seed",
      homeTeamId: sevenEightLoser,
      awayTeamId: nineTenWinner,
      homeSeed: loserSeed?.seed,
      awaySeed: winnerSeed?.seed
    });
  }

  if (!inputs.length) return league;
  const startDate = addDaysIso(lastScheduledDate(gamesForScope(league.games, "postseason")), 2);
  return appendPlayInGames(league, inputs, startDate);
}

function playoffSeedsFromPlayIn(league: LeagueState): LeaguePlayoffSeed[] | null {
  if (!league.playoffs) return null;
  const playoffSeeds: LeaguePlayoffSeed[] = [];

  for (const conference of conferenceOrderFromSeeds(league.playoffs.seeds)) {
    const topSix = league.playoffs.seeds.filter((seed) => seed.conference === conference && seed.seed <= 6).sort((a, b) => a.seed - b.seed);
    if (topSix.length < 6) return null;
    const sevenEight = playInGame(league.playoffs, conference, "seven-eight");
    const eightSeedGame = playInGame(league.playoffs, conference, "eight-seed");
    if (!sevenEight || !eightSeedGame) return null;
    const seed7TeamId = gameWinner(league, sevenEight.gameId);
    const seed8TeamId = gameWinner(league, eightSeedGame.gameId);
    if (!seed7TeamId || !seed8TeamId) return null;
    playoffSeeds.push(...topSix, { teamId: seed7TeamId, conference, seed: 7 }, { teamId: seed8TeamId, conference, seed: 8 });
  }

  return playoffSeeds;
}

function appendFirstRoundFromPlayIn(league: LeagueState): LeagueState {
  if (!league.playoffs || league.playoffs.series.some((series) => series.round === 1)) return league;
  const playoffSeeds = playoffSeedsFromPlayIn(league);
  if (!playoffSeeds) return league;
  const now = new Date().toISOString();
  const seededLeague: LeagueState = {
    ...league,
    playoffs: {
      ...league.playoffs,
      playoffSeeds,
      updatedAt: now
    },
    updatedAt: now
  };
  const seriesInputs = conferenceOrderFromSeeds(playoffSeeds).flatMap((conference) => {
    const bySeed = new Map(playoffSeeds.filter((seed) => seed.conference === conference).map((seed) => [seed.seed, seed.teamId]));
    return firstRoundSeedMatchups.map(([seedA, seedB], bracketIndex) => {
      const teamAId = bySeed.get(seedA);
      const teamBId = bySeed.get(seedB);
      if (!teamAId || !teamBId) throw new Error(`Missing ${conference} playoff seed ${seedA} or ${seedB}.`);
      return buildPlayoffSeries({
        league: seededLeague,
        round: 1,
        conference,
        bracketIndex,
        teamAId,
        teamBId
      });
    });
  });
  const startDate = addDaysIso(lastScheduledDate(gamesForScope(seededLeague.games, "postseason")), 3);
  return appendPlayoffSeries(seededLeague, seriesInputs, startDate);
}

function removePlayoffSeriesFromRound(league: LeagueState, round: number): LeagueState {
  if (!league.playoffs) return league;
  const removedSeriesIds = new Set(league.playoffs.series.filter((series) => series.round >= round).map((series) => series.id));
  if (!removedSeriesIds.size) return league;
  const now = new Date().toISOString();
  return {
    ...league,
    games: league.games.filter((game) => !game.playoffSeriesId || !removedSeriesIds.has(game.playoffSeriesId)),
    playoffs: {
      ...league.playoffs,
      series: league.playoffs.series.filter((series) => !removedSeriesIds.has(series.id)),
      status: "in-progress",
      updatedAt: now
    },
    updatedAt: now
  };
}

function removeBracket(league: LeagueState): LeagueState {
  if (!league.playoffs || (!league.playoffs.series.length && !league.playoffs.playoffSeeds?.length)) return league;
  const now = new Date().toISOString();
  return {
    ...league,
    games: league.games.filter((game) => gameStage(game) !== "playoffs"),
    playoffs: {
      ...league.playoffs,
      playoffSeeds: undefined,
      series: [],
      status: "in-progress",
      updatedAt: now
    },
    updatedAt: now
  };
}

function pruneInvalidPlayInFinals(league: LeagueState): LeagueState {
  if (!league.playoffs) return league;
  const invalidFinals = new Set<string>();

  for (const finalGame of league.playoffs.playInGames.filter((game) => game.kind === "eight-seed")) {
    const sevenEight = playInGame(league.playoffs, finalGame.conference, "seven-eight");
    const nineTen = playInGame(league.playoffs, finalGame.conference, "nine-ten");
    const expectedHome = sevenEight ? gameLoser(league, sevenEight.gameId) : undefined;
    const expectedAway = nineTen ? gameWinner(league, nineTen.gameId) : undefined;
    if (!expectedHome || !expectedAway || finalGame.homeTeamId !== expectedHome || finalGame.awayTeamId !== expectedAway) {
      invalidFinals.add(finalGame.id);
    }
  }

  if (!invalidFinals.size) return league;
  const now = new Date().toISOString();
  const invalidGameIds = new Set(league.playoffs.playInGames.filter((game) => invalidFinals.has(game.id)).map((game) => game.gameId));
  return removeBracket({
    ...league,
    games: league.games.filter((game) => !invalidGameIds.has(game.id)),
    playoffs: {
      ...league.playoffs,
      playInGames: league.playoffs.playInGames.filter((game) => !invalidFinals.has(game.id)),
      updatedAt: now
    },
    updatedAt: now
  });
}

function sameSeedSet(a: LeaguePlayoffSeed[] | undefined, b: LeaguePlayoffSeed[]): boolean {
  if (!a || a.length !== b.length) return false;
  const key = (seed: LeaguePlayoffSeed) => `${seed.conference}:${seed.seed}:${seed.teamId}`;
  const aKeys = a.map(key).sort();
  const bKeys = b.map(key).sort();
  return aKeys.every((value, index) => value === bKeys[index]);
}

function pruneInvalidBracket(league: LeagueState): LeagueState {
  if (!league.playoffs) return league;
  const playoffSeeds = playoffSeedsFromPlayIn(league);
  let nextLeague = league;
  if (!playoffSeeds) {
    nextLeague = removeBracket(nextLeague);
  } else if (nextLeague.playoffs && nextLeague.playoffs.series.length && !sameSeedSet(nextLeague.playoffs.playoffSeeds, playoffSeeds)) {
    nextLeague = removeBracket(nextLeague);
  }

  if (!nextLeague.playoffs?.series.length) return nextLeague;
  for (const round of [2, 3, 4]) {
    const playoffs = nextLeague.playoffs;
    if (!playoffs) return nextLeague;
    const previousRoundSeries = playoffs.series.filter((series) => series.round === round - 1);
    const currentOrLater = playoffs.series.some((series) => series.round >= round);
    if (!currentOrLater) continue;
    if (!previousRoundSeries.length || previousRoundSeries.some((series) => !playoffSeriesWinner(nextLeague, series))) {
      nextLeague = removePlayoffSeriesFromRound(nextLeague, round);
    }
  }

  return nextLeague;
}

function completedSeriesByRound(league: LeagueState, round: number): LeaguePlayoffSeries[] {
  return (league.playoffs?.series ?? [])
    .filter((series) => series.round === round)
    .filter((series) => playoffSeriesWinner(league, series))
    .sort((a, b) => a.conference.localeCompare(b.conference) || a.bracketIndex - b.bracketIndex);
}

function appendNextPlayoffRound(league: LeagueState, round: number): LeagueState {
  if (!league.playoffs) return league;
  if (league.playoffs.series.some((series) => series.round === round)) return league;

  const previousRound = round - 1;
  const previousSeries = completedSeriesByRound(league, previousRound);
  const previousRoundSeries = league.playoffs.series.filter((series) => series.round === previousRound);
  if (!previousRoundSeries.length || previousSeries.length !== previousRoundSeries.length) return league;

  const startDate = addDaysIso(lastScheduledDate(gamesForScope(league.games, "playoffs")), 3);
  const seriesInputs: Array<Omit<LeaguePlayoffSeries, "gameIds" | "createdAt">> = [];

  if (round === 2) {
    for (const conference of conferenceOrderFromSeeds(league.playoffs.seeds)) {
      const rows = previousSeries.filter((series) => series.conference === conference);
      if (rows.length < 4) continue;
      for (let index = 0; index < 2; index += 1) {
        const first = rows[index * 2];
        const second = rows[index * 2 + 1];
        const teamAId = playoffSeriesWinner(league, first);
        const teamBId = playoffSeriesWinner(league, second);
        if (!teamAId || !teamBId) continue;
        seriesInputs.push(
          buildPlayoffSeries({
            league,
            round,
            conference,
            bracketIndex: index,
            teamAId,
            teamBId,
            sourceSeriesIds: [first.id, second.id]
          })
        );
      }
    }
  } else if (round === 3) {
    for (const conference of conferenceOrderFromSeeds(league.playoffs.seeds)) {
      const rows = previousSeries.filter((series) => series.conference === conference);
      if (rows.length < 2) continue;
      const teamAId = playoffSeriesWinner(league, rows[0]);
      const teamBId = playoffSeriesWinner(league, rows[1]);
      if (!teamAId || !teamBId) continue;
      seriesInputs.push(
        buildPlayoffSeries({
          league,
          round,
          conference,
          bracketIndex: 0,
          teamAId,
          teamBId,
          sourceSeriesIds: [rows[0].id, rows[1].id]
        })
      );
    }
  } else if (round === 4) {
    const rows = previousSeries;
    if (rows.length < 2) return league;
    const teamAId = playoffSeriesWinner(league, rows[0]);
    const teamBId = playoffSeriesWinner(league, rows[1]);
    if (!teamAId || !teamBId) return league;
    seriesInputs.push(
      buildPlayoffSeries({
        league,
        round,
        conference: "Finals",
        bracketIndex: 0,
        teamAId,
        teamBId,
        sourceSeriesIds: [rows[0].id, rows[1].id]
      })
    );
  }

  return appendPlayoffSeries(league, seriesInputs, startDate);
}

export function syncLeaguePlayoffs(league: LeagueState): LeagueState {
  if (!league.playoffs) return league;
  let nextLeague = pruneInvalidBracket(pruneInvalidPlayInFinals(league));
  nextLeague = appendNeededPlayInFinals(nextLeague);
  nextLeague = appendFirstRoundFromPlayIn(nextLeague);
  nextLeague = pruneInvalidBracket(nextLeague);
  for (const round of [2, 3, 4]) {
    nextLeague = appendNextPlayoffRound(nextLeague, round);
  }

  const finalSeries = nextLeague.playoffs?.series.find((series) => series.round === 4);
  const finalWinner = finalSeries ? playoffSeriesWinner(nextLeague, finalSeries) : undefined;
  if (nextLeague.playoffs && finalWinner && nextLeague.playoffs.status !== "complete") {
    const now = new Date().toISOString();
    nextLeague = {
      ...nextLeague,
      playoffs: {
        ...nextLeague.playoffs,
        status: "complete",
        updatedAt: now
      },
      updatedAt: now
    };
  } else if (nextLeague.playoffs && !finalWinner && nextLeague.playoffs.status === "complete") {
    const now = new Date().toISOString();
    nextLeague = {
      ...nextLeague,
      playoffs: {
        ...nextLeague.playoffs,
        status: "in-progress",
        updatedAt: now
      },
      updatedAt: now
    };
  }

  return nextLeague;
}

export function playoffSeriesState(league: LeagueState, series: LeaguePlayoffSeries): LeaguePlayoffSeriesState {
  let winsA = 0;
  let winsB = 0;
  const seriesGames = series.gameIds
    .map((gameId) => league.games.find((game) => game.id === gameId))
    .filter((game): game is LeagueGame => Boolean(game))
    .sort((a, b) => (a.playoffGameNumber ?? 0) - (b.playoffGameNumber ?? 0));
  const completedGames: LeagueGame[] = [];
  let winnerTeamId: string | undefined;

  for (const game of seriesGames) {
    if (!game.result) continue;
    completedGames.push(game);
    if (game.result.winnerTeamId === series.teamAId) winsA += 1;
    if (game.result.winnerTeamId === series.teamBId) winsB += 1;
    if (winsA >= playoffWinsNeeded) {
      winnerTeamId = series.teamAId;
      break;
    }
    if (winsB >= playoffWinsNeeded) {
      winnerTeamId = series.teamBId;
      break;
    }
  }

  const nextGame = winnerTeamId ? undefined : seriesGames.find((game) => game.status === "unplayed");
  return {
    winsA,
    winsB,
    winnerTeamId,
    status: winnerTeamId ? "complete" : "scheduled",
    nextGame,
    completedGames
  };
}

export function nextPlayablePlayoffGame(league: LeagueState): LeagueGame | undefined {
  const playInNext = (league.playoffs?.playInGames ?? [])
    .map((row) => gameById(league, row.gameId))
    .filter((game): game is LeagueGame => game !== undefined && game.status === "unplayed")
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || (a.sequence ?? 0) - (b.sequence ?? 0))[0];
  if (playInNext) return playInNext;

  return (league.playoffs?.series ?? [])
    .slice()
    .sort((a, b) => a.round - b.round || a.conference.localeCompare(b.conference) || a.bracketIndex - b.bracketIndex)
    .map((series) => playoffSeriesState(league, series).nextGame)
    .filter((game): game is LeagueGame => Boolean(game))
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || (a.sequence ?? 0) - (b.sequence ?? 0))[0];
}

export function renameLeague(league: LeagueState, name: string): LeagueState {
  const trimmedName = name.trim();
  return {
    ...league,
    name: trimmedName || league.name,
    updatedAt: new Date().toISOString()
  };
}

export function simulateLeagueGameWithTeams(
  league: LeagueState,
  gameId: string,
  away: DiceTeamCard,
  home: DiceTeamCard,
  seed = Date.now(),
  options?: Partial<MatchupOptions>
): LeagueState {
  return updateGame(league, gameId, (game) => {
    return {
      ...game,
      status: "simulated",
      result: simulateGame(away, home, seed, "simulated", options)
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

  for (const game of gamesForScope(league.games, "regular")) {
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

export function aggregateTeamStats(league: LeagueState, scope: LeagueGameScope = "regular"): Record<string, StatLine & { games: number }> {
  const rows: Record<string, StatLine & { games: number }> = {};
  for (const teamId of league.teamIds) {
    rows[teamId] = { games: 0 };
  }
  for (const game of gamesForScope(league.games, scope)) {
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

export function aggregatePlayerStats(league: LeagueState, scope: LeagueGameScope = "regular") {
  const rows: Array<{ teamId: string; player: string; games: number; totals: StatLine; perGame: StatLine }> = [];
  const map = new Map<string, { teamId: string; player: string; games: number; totals: StatLine }>();

  for (const game of gamesForScope(league.games, scope)) {
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
