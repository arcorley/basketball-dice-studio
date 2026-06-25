import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import scheduleData from "../src/data/bbr/raw/schedule-2021.json";
import { simulateGame } from "../src/lib/diceEngine";
import { diceTeams } from "../src/lib/sourceData";
import type { DiceTeamCard } from "../src/lib/types";
import { SeededRandom } from "../src/lib/random";

type ScheduleGame = {
  date: string;
  visitorAbbr: string;
  visitorPts: number;
  homeAbbr: string;
  homePts: number;
  boxScoreId: string;
};

type Conference = "East" | "West";

type ChunkInput = {
  iterations: number;
  seed: number;
};

type ChunkOutput = {
  iterations: number;
  winsByTeam: Record<string, number[]>;
  rankSumByTeam: Record<string, number>;
  topSeedByTeam: Record<string, number>;
  topSixByTeam: Record<string, number>;
  topTenByTeam: Record<string, number>;
  playoffByTeam: Record<string, number>;
  seedCountsByTeam: Record<string, number[]>;
  semifinalsByTeam: Record<string, number>;
  conferenceFinalsByTeam: Record<string, number>;
  finalsByTeam: Record<string, number>;
  championByTeam: Record<string, number>;
  seasonSnapshots: SeasonSnapshot[];
  brokenTies: number;
};

type TeamSeasonSummary = {
  teamId: string;
  team: string;
  conference: Conference;
  actualWins: number;
  actualLosses: number;
  averageWins: number;
  winDelta: number;
  absWinDelta: number;
  stdevWins: number;
  p05Wins: number;
  p50Wins: number;
  p95Wins: number;
  averageRank: number;
  topSeedPct: number;
  topSixPct: number;
  topTenPct: number;
};

type PostseasonResult = {
  eastChampionId: string;
  westChampionId: string;
  championId: string;
  playInTeams: Array<{ teamId: string; seed: number; conference: Conference }>;
  seededPlayoffTeams: Array<{ teamId: string; seed: number; conference: Conference }>;
  semifinalTeamIds: string[];
  conferenceFinalTeamIds: string[];
  brokenTies: number;
};

type SeasonSnapshot = {
  wins: Record<string, number>;
  conferenceOrder: Record<Conference, string[]>;
  playInSeeds: Record<Conference, string[]>;
  playoffSeeds: Record<Conference, string[]>;
  semifinals: Record<Conference, string[]>;
  conferenceFinals: Record<Conference, string[]>;
  finals: Record<Conference, string>;
  champion: string;
  brokenTies: number;
};

type PlayerRole = {
  availability: number;
  minutes: number;
  useWeight: number;
  astWeight: number;
  orbWeight: number;
  drbWeight: number;
  stlWeight: number;
  blkWeight: number;
  pfWeight: number;
};

type TeamAvailabilityProfile = {
  team: DiceTeamCard;
  context: "regularSeason" | "postseason";
  source: "season-games" | "playoff-tables" | "generic-playoff";
  paceFactor: number;
  minActivePlayers: number;
  roles: PlayerRole[];
  cache: Map<string, DiceTeamCard>;
};

type AvailabilityRuntime = {
  profiles: Map<string, TeamAvailabilityProfile>;
};

const scriptPath = fileURLToPath(import.meta.url);
const regularSeasonEnd = Date.UTC(2021, 4, 16, 23, 59, 59);
const defaultSeasonIterations = 10_000;
const defaultSeed = 4242;
const maxWorkerCount = Math.max(1, os.availableParallelism?.() ?? os.cpus().length);
const defaultWorkerCount = Math.max(1, Math.min(maxWorkerCount, 8));

const eastAbbrs = new Set(["ATL", "BOS", "BRK", "CHI", "CHO", "CLE", "DET", "IND", "MIA", "MIL", "NYK", "ORL", "PHI", "TOR", "WAS"]);
const westAbbrs = new Set(["DAL", "DEN", "GSW", "HOU", "LAC", "LAL", "MEM", "MIN", "NOP", "OKC", "PHO", "POR", "SAC", "SAS", "UTA"]);

function teamIdFromAbbr(abbr: string): string {
  return `2020-21-${abbr.toLowerCase()}`;
}

function dateUtc(date: string): number {
  const withoutDay = date.replace(/^[A-Za-z]+, /, "");
  const parsed = Date.parse(`${withoutDay} 00:00:00 UTC`);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Could not parse schedule date: ${date}`);
  }
  return parsed;
}

function fixed(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function percentile(sorted: number[], pct: number): number {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * pct)));
  return sorted[index];
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function standardDeviation(values: number[], avg = mean(values)): number {
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / Math.max(1, values.length);
  return Math.sqrt(variance);
}

function pearsonCorrelation(a: number[], b: number[]): number {
  const aMean = mean(a);
  const bMean = mean(b);
  const numerator = a.reduce((sum, value, index) => sum + (value - aMean) * (b[index] - bMean), 0);
  const denominator = Math.sqrt(
    a.reduce((sum, value) => sum + (value - aMean) ** 2, 0) * b.reduce((sum, value) => sum + (value - bMean) ** 2, 0)
  );
  return denominator === 0 ? 0 : numerator / denominator;
}

function conferenceForAbbr(abbr: string): Conference {
  if (eastAbbrs.has(abbr)) return "East";
  if (westAbbrs.has(abbr)) return "West";
  throw new Error(`Unknown 2020-21 conference for ${abbr}`);
}

function loadRegularSeasonGames(): ScheduleGame[] {
  const games = (scheduleData as { games: ScheduleGame[] }).games.filter((game) => dateUtc(game.date) <= regularSeasonEnd);
  if (games.length !== 1_080) {
    throw new Error(`Expected 1,080 2020-21 regular-season games, found ${games.length}.`);
  }
  return games;
}

function teamMap(): Map<string, DiceTeamCard> {
  const teams = new Map(diceTeams.filter((team) => team.season === "2020-21").map((team) => [team.id, team]));
  if (teams.size !== 30) {
    throw new Error(`Expected 30 generated 2020-21 teams, found ${teams.size}.`);
  }
  return teams;
}

function zeroRecord(teamIds: string[]): Record<string, number> {
  return Object.fromEntries(teamIds.map((teamId) => [teamId, 0]));
}

function emptyWinSamples(teamIds: string[]): Record<string, number[]> {
  return Object.fromEntries(teamIds.map((teamId) => [teamId, []]));
}

function emptySeedCounts(teamIds: string[]): Record<string, number[]> {
  return Object.fromEntries(teamIds.map((teamId) => [teamId, Array.from({ length: 8 }, () => 0)]));
}

function requiredNumber(value: number | null | undefined, label: string): number {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    throw new Error(`Missing required value for ${label}`);
  }
  return value;
}

function teamSourceGames(team: DiceTeamCard): number {
  return requiredNumber(team.source.team.wins, `${team.id} wins`) + requiredNumber(team.source.team.losses, `${team.id} losses`);
}

function rawCell(row: Record<string, { text?: string } | undefined> | undefined, key: string): string {
  return row?.[key]?.text ?? "";
}

function rawNumber(row: Record<string, { text?: string } | undefined> | undefined, key: string): number | null {
  const text = rawCell(row, key).replace(/,/g, "");
  if (text === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function rawName(row: Record<string, { text?: string } | undefined>): string {
  return rawCell(row, "name_display") || rawCell(row, "player");
}

function rawTable(teamId: string, tableId: string): Array<Record<string, { text?: string } | undefined>> {
  const filePath = path.join(process.cwd(), "src", "data", "bbr", "raw", `${teamId}.json`);
  if (!fs.existsSync(filePath)) return [];
  const page = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
    tables?: Array<{ id: string; rows?: Array<Record<string, { text?: string } | undefined>> }>;
  };
  return page.tables?.find((table) => table.id === tableId)?.rows ?? [];
}

function rowsByName(rows: Array<Record<string, { text?: string } | undefined>>): Map<string, Record<string, { text?: string } | undefined>> {
  return new Map(rows.map((row) => [rawName(row), row]).filter(([name]) => name));
}

function impactUseMultiplier(player: DiceTeamCard["players"][number]): number {
  return clamp(1 + player.calibration.offensiveImpact * 0.045, 0.75, 1.28);
}

function seasonRole(player: DiceTeamCard["players"][number], teamGames: number): PlayerRole {
  const playerGames = clamp(requiredNumber(player.source.games, `${player.name} games`), 1, teamGames);
  const availability = clamp(playerGames / teamGames, 0.01, 1);
  const activeScale = 1 / availability;
  return {
    availability,
    minutes: requiredNumber(player.source.minutes, `${player.name} minutes`) / playerGames,
    useWeight: player.useWeight * activeScale,
    astWeight: player.astWeight * activeScale,
    orbWeight: player.orbWeight * activeScale,
    drbWeight: player.drbWeight * activeScale,
    stlWeight: player.stlWeight * activeScale,
    blkWeight: player.blkWeight * activeScale,
    pfWeight: player.pfWeight * activeScale
  };
}

function postRoleFromTables(player: DiceTeamCard["players"][number], totals: Record<string, { text?: string } | undefined>, teamPostGames: number): PlayerRole {
  const postGames = clamp(requiredNumber(rawNumber(totals, "games"), `${player.name} playoff games`), 0, teamPostGames);
  if (postGames <= 0) {
    return {
      availability: 0,
      minutes: 0,
      useWeight: 0,
      astWeight: 0,
      orbWeight: 0,
      drbWeight: 0,
      stlWeight: 0,
      blkWeight: 0,
      pfWeight: 0
    };
  }

  const perActiveGame = (key: string) => Math.max(0, requiredNumber(rawNumber(totals, key), `${player.name} playoff ${key}`) / postGames);
  const fga = perActiveGame("fga");
  const fta = perActiveGame("fta");
  const tov = perActiveGame("tov");
  return {
    availability: clamp(postGames / teamPostGames, 0.01, 1),
    minutes: perActiveGame("mp"),
    useWeight: Math.max(0.05, (fga + 0.44 * fta + tov) * impactUseMultiplier(player)),
    astWeight: perActiveGame("ast"),
    orbWeight: perActiveGame("orb"),
    drbWeight: perActiveGame("drb"),
    stlWeight: perActiveGame("stl"),
    blkWeight: perActiveGame("blk"),
    pfWeight: perActiveGame("pf")
  };
}

function genericPlayoffRole(player: DiceTeamCard["players"][number], teamGames: number, isCore: boolean): PlayerRole {
  const role = seasonRole(player, teamGames);
  if (isCore) {
    return { ...role, minutes: role.minutes * 1.08, availability: clamp(role.availability, 0.01, 1) };
  }
  return {
    ...role,
    availability: role.availability * 0.35,
    minutes: role.minutes * 0.55,
    useWeight: role.useWeight * 0.55,
    astWeight: role.astWeight * 0.55,
    orbWeight: role.orbWeight * 0.55,
    drbWeight: role.drbWeight * 0.55,
    stlWeight: role.stlWeight * 0.55,
    blkWeight: role.blkWeight * 0.55,
    pfWeight: role.pfWeight * 0.55
  };
}

function buildRegularSeasonProfile(team: DiceTeamCard): TeamAvailabilityProfile {
  const games = teamSourceGames(team);
  return {
    team,
    context: "regularSeason",
    source: "season-games",
    paceFactor: 1,
    minActivePlayers: Math.min(8, team.players.length),
    roles: team.players.map((player) => seasonRole(player, games)),
    cache: new Map()
  };
}

function buildPostseasonProfile(team: DiceTeamCard): TeamAvailabilityProfile {
  const totalsPost = rowsByName(rawTable(team.id, "totals_stats_post"));
  const postGames = Math.max(0, ...[...totalsPost.values()].map((row) => rawNumber(row, "games") ?? 0));
  const teamGames = teamSourceGames(team);
  if (postGames > 0) {
    return {
      team,
      context: "postseason",
      source: "playoff-tables",
      paceFactor: 0.965,
      minActivePlayers: Math.min(8, totalsPost.size),
      roles: team.players.map((player) => {
        const row = totalsPost.get(player.name);
        return row ? postRoleFromTables(player, row, postGames) : { ...seasonRole(player, teamGames), availability: 0, minutes: 0, useWeight: 0 };
      }),
      cache: new Map()
    };
  }

  const core = new Set(
    [...team.players]
      .sort((a, b) => requiredNumber(b.source.minutes, `${b.name} minutes`) - requiredNumber(a.source.minutes, `${a.name} minutes`))
      .slice(0, 9)
      .map((player) => player.name)
  );
  return {
    team,
    context: "postseason",
    source: "generic-playoff",
    paceFactor: 0.965,
    minActivePlayers: Math.min(8, team.players.length),
    roles: team.players.map((player) => genericPlayoffRole(player, teamGames, core.has(player.name))),
    cache: new Map()
  };
}

function buildAvailabilityRuntime(teams: Map<string, DiceTeamCard>, context: "regularSeason" | "postseason"): AvailabilityRuntime {
  return {
    profiles: new Map(
      [...teams.values()].map((team) => [team.id, context === "regularSeason" ? buildRegularSeasonProfile(team) : buildPostseasonProfile(team)])
    )
  };
}

function weightedImpact(players: DiceTeamCard["players"], roles: PlayerRole[], impact: "offensiveImpact" | "defensiveImpact"): number | null {
  const weighted = players
    .map((player, index) => [player.calibration[impact], roles[index]?.minutes ?? 0] as [number, number])
    .filter(([, weight]) => weight > 0);
  const total = weighted.reduce((sum, [, weight]) => sum + weight, 0);
  if (total <= 0) return null;
  return weighted.reduce((sum, [value, weight]) => sum + value * weight, 0) / total;
}

function activeTeamCard(profile: TeamAvailabilityProfile, rng: SeededRandom): DiceTeamCard {
  const active = profile.roles.map((role) => role.availability > 0 && rng.next() < role.availability);
  const eligibleByMinutes = profile.roles
    .map((role, index) => ({ index, role }))
    .filter(({ role }) => role.availability > 0 && role.minutes > 0)
    .sort((a, b) => b.role.minutes - a.role.minutes);

  let activeCount = active.filter(Boolean).length;
  for (const { index } of eligibleByMinutes) {
    if (activeCount >= Math.min(profile.minActivePlayers, eligibleByMinutes.length)) break;
    if (!active[index]) {
      active[index] = true;
      activeCount += 1;
    }
  }

  const mask = active.map((value) => (value ? "1" : "0")).join("");
  const cached = profile.cache.get(mask);
  if (cached) return cached;

  const activePlayers = profile.team.players
    .map((player, index) => ({ player, role: profile.roles[index], active: active[index] }))
    .filter((item) => item.active && item.role.availability > 0 && item.role.minutes > 0)
    .map(({ player, role }) => ({
      ...player,
      minutes: role.minutes,
      useWeight: role.useWeight,
      astWeight: role.astWeight,
      orbWeight: role.orbWeight,
      drbWeight: role.drbWeight,
      stlWeight: role.stlWeight,
      blkWeight: role.blkWeight,
      pfWeight: role.pfWeight
    }));

  if (!activePlayers.length) {
    throw new Error(`${profile.team.id} has no active players for ${profile.context}`);
  }

  const activeRoles = profile.team.players.map((_, index) => (active[index] ? profile.roles[index] : { ...profile.roles[index], minutes: 0 }));
  const offensiveImpact = weightedImpact(profile.team.players, activeRoles, "offensiveImpact") ?? profile.team.calibration.playerOffenseSignal;
  const defensiveImpact = weightedImpact(profile.team.players, activeRoles, "defensiveImpact") ?? profile.team.calibration.playerDefenseSignal;
  const adjusted: DiceTeamCard = {
    ...profile.team,
    pace: profile.team.pace * profile.paceFactor,
    shotQuality: profile.team.shotQuality + clamp((offensiveImpact - profile.team.calibration.playerOffenseSignal) * 1.15, -3, 3),
    defense: profile.team.defense + clamp((defensiveImpact - profile.team.calibration.playerDefenseSignal) * 1.35, -3.5, 3.5),
    players: activePlayers
  };
  profile.cache.set(mask, adjusted);
  return adjusted;
}

function teamForGame(runtime: AvailabilityRuntime, teamId: string, rng: SeededRandom): DiceTeamCard {
  const profile = runtime.profiles.get(teamId);
  if (!profile) throw new Error(`Missing availability profile for ${teamId}`);
  return activeTeamCard(profile, rng);
}

function groupSeedRows(rows: Array<{ teamId: string; seed: number; conference: Conference }>): Record<Conference, string[]> {
  return {
    East: rows
      .filter((row) => row.conference === "East")
      .sort((a, b) => a.seed - b.seed)
      .map((row) => row.teamId),
    West: rows
      .filter((row) => row.conference === "West")
      .sort((a, b) => a.seed - b.seed)
      .map((row) => row.teamId)
  };
}

function groupTeamIdsByConference(teamIds: string[], conferenceByTeamId: Map<string, Conference>): Record<Conference, string[]> {
  return {
    East: teamIds.filter((teamId) => conferenceByTeamId.get(teamId) === "East"),
    West: teamIds.filter((teamId) => conferenceByTeamId.get(teamId) === "West")
  };
}

function actualStandings(games: ScheduleGame[], teams: Map<string, DiceTeamCard>): Map<string, { wins: number; losses: number }> {
  const standings = new Map([...teams.keys()].map((teamId) => [teamId, { wins: 0, losses: 0 }]));

  for (const game of games) {
    const awayId = teamIdFromAbbr(game.visitorAbbr);
    const homeId = teamIdFromAbbr(game.homeAbbr);
    const away = standings.get(awayId);
    const home = standings.get(homeId);
    if (!away || !home) {
      throw new Error(`Schedule game references a generated-data miss: ${game.boxScoreId}`);
    }

    if (game.visitorPts > game.homePts) {
      away.wins += 1;
      home.losses += 1;
    } else if (game.homePts > game.visitorPts) {
      home.wins += 1;
      away.losses += 1;
    } else {
      throw new Error(`NBA schedule game ended tied: ${game.boxScoreId}`);
    }
  }

  for (const [teamId, record] of standings) {
    if (record.wins + record.losses !== 72) {
      throw new Error(`${teamId} has ${record.wins + record.losses} regular-season games; expected 72.`);
    }
  }

  return standings;
}

function orderTeams(teamIds: string[], wins: Map<string, number>, rng?: SeededRandom): string[] {
  const tieBreaker = new Map(teamIds.map((teamId) => [teamId, rng ? rng.next() : 0]));
  return [...teamIds].sort(
    (a, b) => (wins.get(b) ?? 0) - (wins.get(a) ?? 0) || (tieBreaker.get(b) ?? 0) - (tieBreaker.get(a) ?? 0) || a.localeCompare(b)
  );
}

function rankTeams(teamIds: string[], wins: Map<string, number>, rng?: SeededRandom): Map<string, number> {
  const ordered = orderTeams(teamIds, wins, rng);
  return new Map(ordered.map((teamId, index) => [teamId, index + 1]));
}

function simulateWinner(awayId: string, homeId: string, runtime: AvailabilityRuntime, rng: SeededRandom): { winnerId: string; brokenTie: boolean } {
  const away = teamForGame(runtime, awayId, rng);
  const home = teamForGame(runtime, homeId, rng);
  const result = simulateGame(away, home, rng.pickSeed());
  if (result.winnerTeamId === "tie") {
    return {
      winnerId: rng.next() < 0.5 ? away.id : home.id,
      brokenTie: true
    };
  }
  return {
    winnerId: result.winnerTeamId,
    brokenTie: false
  };
}

function betterRegularSeasonTeam(teamAId: string, teamBId: string, wins: Map<string, number>, rng: SeededRandom): string {
  const teamAWins = wins.get(teamAId) ?? 0;
  const teamBWins = wins.get(teamBId) ?? 0;
  if (teamAWins > teamBWins) return teamAId;
  if (teamBWins > teamAWins) return teamBId;
  return rng.next() < 0.5 ? teamAId : teamBId;
}

function simulateSeries(
  teamAId: string,
  teamBId: string,
  homeCourtId: string,
  runtime: AvailabilityRuntime,
  rng: SeededRandom
): { winnerId: string; brokenTies: number } {
  const awayCourtId = homeCourtId === teamAId ? teamBId : teamAId;
  const homeSequence = [homeCourtId, homeCourtId, awayCourtId, awayCourtId, homeCourtId, awayCourtId, homeCourtId];
  const wins = new Map([
    [teamAId, 0],
    [teamBId, 0]
  ]);
  let brokenTies = 0;

  for (const homeId of homeSequence) {
    const awayId = homeId === teamAId ? teamBId : teamAId;
    const result = simulateWinner(awayId, homeId, runtime, rng);
    if (result.brokenTie) brokenTies += 1;
    wins.set(result.winnerId, (wins.get(result.winnerId) ?? 0) + 1);
    if ((wins.get(result.winnerId) ?? 0) === 4) {
      return { winnerId: result.winnerId, brokenTies };
    }
  }

  throw new Error(`Playoff series did not produce a winner: ${teamAId} vs ${teamBId}`);
}

function simulateConferencePostseason(
  conference: Conference,
  seeds: string[],
  wins: Map<string, number>,
  runtime: AvailabilityRuntime,
  rng: SeededRandom
): {
  championId: string;
  playInTeams: Array<{ teamId: string; seed: number; conference: Conference }>;
  seededPlayoffTeams: Array<{ teamId: string; seed: number; conference: Conference }>;
  semifinalTeamIds: string[];
  conferenceFinalTeamIds: string[];
  brokenTies: number;
} {
  if (seeds.length !== 15) {
    throw new Error(`Expected 15 conference teams, found ${seeds.length}`);
  }
  let brokenTies = 0;

  const sevenEight = simulateWinner(seeds[7], seeds[6], runtime, rng);
  if (sevenEight.brokenTie) brokenTies += 1;
  const sevenSeed = sevenEight.winnerId;
  const sevenEightLoser = sevenEight.winnerId === seeds[6] ? seeds[7] : seeds[6];

  const nineTen = simulateWinner(seeds[9], seeds[8], runtime, rng);
  if (nineTen.brokenTie) brokenTies += 1;

  const eightSeedGame = simulateWinner(nineTen.winnerId, sevenEightLoser, runtime, rng);
  if (eightSeedGame.brokenTie) brokenTies += 1;
  const eightSeed = eightSeedGame.winnerId;
  const playoffSeeds = [seeds[0], seeds[1], seeds[2], seeds[3], seeds[4], seeds[5], sevenSeed, eightSeed];

  const round1A = simulateSeries(playoffSeeds[0], playoffSeeds[7], betterRegularSeasonTeam(playoffSeeds[0], playoffSeeds[7], wins, rng), runtime, rng);
  const round1B = simulateSeries(playoffSeeds[3], playoffSeeds[4], betterRegularSeasonTeam(playoffSeeds[3], playoffSeeds[4], wins, rng), runtime, rng);
  const round1C = simulateSeries(playoffSeeds[2], playoffSeeds[5], betterRegularSeasonTeam(playoffSeeds[2], playoffSeeds[5], wins, rng), runtime, rng);
  const round1D = simulateSeries(playoffSeeds[1], playoffSeeds[6], betterRegularSeasonTeam(playoffSeeds[1], playoffSeeds[6], wins, rng), runtime, rng);
  brokenTies += round1A.brokenTies + round1B.brokenTies + round1C.brokenTies + round1D.brokenTies;
  const semifinalTeamIds = [round1A.winnerId, round1B.winnerId, round1C.winnerId, round1D.winnerId];

  const round2A = simulateSeries(round1A.winnerId, round1B.winnerId, betterRegularSeasonTeam(round1A.winnerId, round1B.winnerId, wins, rng), runtime, rng);
  const round2B = simulateSeries(round1C.winnerId, round1D.winnerId, betterRegularSeasonTeam(round1C.winnerId, round1D.winnerId, wins, rng), runtime, rng);
  brokenTies += round2A.brokenTies + round2B.brokenTies;
  const conferenceFinalTeamIds = [round2A.winnerId, round2B.winnerId];

  const finals = simulateSeries(round2A.winnerId, round2B.winnerId, betterRegularSeasonTeam(round2A.winnerId, round2B.winnerId, wins, rng), runtime, rng);
  brokenTies += finals.brokenTies;

  return {
    championId: finals.winnerId,
    playInTeams: seeds.slice(6, 10).map((teamId, index) => ({ teamId, seed: index + 7, conference })),
    seededPlayoffTeams: playoffSeeds.map((teamId, index) => ({ teamId, seed: index + 1, conference })),
    semifinalTeamIds,
    conferenceFinalTeamIds,
    brokenTies
  };
}

function simulatePostseason(
  orderedByConference: Map<Conference, string[]>,
  wins: Map<string, number>,
  runtime: AvailabilityRuntime,
  rng: SeededRandom
): PostseasonResult {
  const east = simulateConferencePostseason("East", orderedByConference.get("East") ?? [], wins, runtime, rng);
  const west = simulateConferencePostseason("West", orderedByConference.get("West") ?? [], wins, runtime, rng);
  const finalsHomeCourt = betterRegularSeasonTeam(east.championId, west.championId, wins, rng);
  const finals = simulateSeries(east.championId, west.championId, finalsHomeCourt, runtime, rng);

  return {
    eastChampionId: east.championId,
    westChampionId: west.championId,
    championId: finals.winnerId,
    playInTeams: [...east.playInTeams, ...west.playInTeams],
    seededPlayoffTeams: [...east.seededPlayoffTeams, ...west.seededPlayoffTeams],
    semifinalTeamIds: [...east.semifinalTeamIds, ...west.semifinalTeamIds],
    conferenceFinalTeamIds: [...east.conferenceFinalTeamIds, ...west.conferenceFinalTeamIds],
    brokenTies: east.brokenTies + west.brokenTies + finals.brokenTies
  };
}

function simulateChunk(iterations: number, seed: number): ChunkOutput {
  const games = loadRegularSeasonGames();
  const teams = teamMap();
  const teamIds = [...teams.keys()].sort();
  const conferenceByTeamId = new Map(teamIds.map((teamId) => [teamId, conferenceForAbbr(teams.get(teamId)?.abbr ?? "")]));
  const regularSeasonRuntime = buildAvailabilityRuntime(teams, "regularSeason");
  const postseasonRuntime = buildAvailabilityRuntime(teams, "postseason");
  const scheduledGames = games.map((game) => {
    const awayId = teamIdFromAbbr(game.visitorAbbr);
    const homeId = teamIdFromAbbr(game.homeAbbr);
    if (!teams.has(awayId) || !teams.has(homeId)) {
      throw new Error(`Schedule game references a generated-data miss: ${game.boxScoreId}`);
    }
    return { awayId, homeId };
  });

  const rng = new SeededRandom(seed);
  const winsByTeam = emptyWinSamples(teamIds);
  const rankSumByTeam = zeroRecord(teamIds);
  const topSeedByTeam = zeroRecord(teamIds);
  const topSixByTeam = zeroRecord(teamIds);
  const topTenByTeam = zeroRecord(teamIds);
  const playoffByTeam = zeroRecord(teamIds);
  const seedCountsByTeam = emptySeedCounts(teamIds);
  const semifinalsByTeam = zeroRecord(teamIds);
  const conferenceFinalsByTeam = zeroRecord(teamIds);
  const finalsByTeam = zeroRecord(teamIds);
  const championByTeam = zeroRecord(teamIds);
  const seasonSnapshots: SeasonSnapshot[] = [];
  let brokenTies = 0;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const wins = new Map(teamIds.map((teamId) => [teamId, 0]));
    let seasonBrokenTies = 0;

    for (const game of scheduledGames) {
      const result = simulateWinner(game.awayId, game.homeId, regularSeasonRuntime, rng);
      let winnerId = result.winnerId;
      if (result.brokenTie) {
        brokenTies += 1;
        seasonBrokenTies += 1;
      }
      wins.set(winnerId, (wins.get(winnerId) ?? 0) + 1);
    }

    const orderedByConference = new Map<Conference, string[]>();
    for (const conference of ["East", "West"] as const) {
      const conferenceTeams = teamIds.filter((teamId) => conferenceByTeamId.get(teamId) === conference);
      const ordered = orderTeams(conferenceTeams, wins, rng);
      orderedByConference.set(conference, ordered);
      const ranks = new Map(ordered.map((teamId, index) => [teamId, index + 1]));
      for (const teamId of conferenceTeams) {
        const rank = ranks.get(teamId) ?? conferenceTeams.length;
        rankSumByTeam[teamId] += rank;
        if (rank === 1) topSeedByTeam[teamId] += 1;
        if (rank <= 6) topSixByTeam[teamId] += 1;
        if (rank <= 10) topTenByTeam[teamId] += 1;
      }
    }

    for (const teamId of teamIds) {
      winsByTeam[teamId].push(wins.get(teamId) ?? 0);
    }

    const postseason = simulatePostseason(orderedByConference, wins, postseasonRuntime, rng);
    brokenTies += postseason.brokenTies;
    seasonBrokenTies += postseason.brokenTies;
    for (const row of postseason.seededPlayoffTeams) {
      playoffByTeam[row.teamId] += 1;
      seedCountsByTeam[row.teamId][row.seed - 1] += 1;
    }
    for (const teamId of postseason.semifinalTeamIds) {
      semifinalsByTeam[teamId] += 1;
    }
    for (const teamId of postseason.conferenceFinalTeamIds) {
      conferenceFinalsByTeam[teamId] += 1;
    }
    finalsByTeam[postseason.eastChampionId] += 1;
    finalsByTeam[postseason.westChampionId] += 1;
    championByTeam[postseason.championId] += 1;
    seasonSnapshots.push({
      wins: Object.fromEntries(wins),
      conferenceOrder: {
        East: orderedByConference.get("East") ?? [],
        West: orderedByConference.get("West") ?? []
      },
      playInSeeds: groupSeedRows(postseason.playInTeams),
      playoffSeeds: groupSeedRows(postseason.seededPlayoffTeams),
      semifinals: groupTeamIdsByConference(postseason.semifinalTeamIds, conferenceByTeamId),
      conferenceFinals: groupTeamIdsByConference(postseason.conferenceFinalTeamIds, conferenceByTeamId),
      finals: {
        East: postseason.eastChampionId,
        West: postseason.westChampionId
      },
      champion: postseason.championId,
      brokenTies: seasonBrokenTies
    });
  }

  return {
    iterations,
    winsByTeam,
    rankSumByTeam,
    topSeedByTeam,
    topSixByTeam,
    topTenByTeam,
    playoffByTeam,
    seedCountsByTeam,
    semifinalsByTeam,
    conferenceFinalsByTeam,
    finalsByTeam,
    championByTeam,
    seasonSnapshots,
    brokenTies
  };
}

function buildChunks(seasonIterations: number, seed: number, workerCount: number): ChunkInput[] {
  const chunkCount = Math.min(seasonIterations, Math.max(workerCount, workerCount * 16));
  const base = Math.floor(seasonIterations / chunkCount);
  let remainder = seasonIterations % chunkCount;
  const rng = new SeededRandom(seed);
  const chunks: ChunkInput[] = [];

  for (let index = 0; index < chunkCount; index += 1) {
    const iterations = base + (remainder > 0 ? 1 : 0);
    remainder -= remainder > 0 ? 1 : 0;
    chunks.push({ iterations, seed: rng.pickSeed() });
  }

  return chunks.filter((chunk) => chunk.iterations > 0);
}

async function runChunkProcess(input: ChunkInput, tempDir: string, index: number): Promise<ChunkOutput> {
  const inputPath = path.join(tempDir, `direct-input-${index}.json`);
  const outputPath = path.join(tempDir, `direct-output-${index}.json`);
  fs.writeFileSync(inputPath, JSON.stringify(input));

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", scriptPath, "--worker", inputPath, outputPath], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Direct season worker ${index} exited with code ${code}.\n${stdout}${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(fs.readFileSync(outputPath, "utf8")) as ChunkOutput);
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function runWithConcurrency<T, R>(items: T[], concurrency: number, run: (item: T, index: number) => Promise<R>, onComplete: (result: R) => void): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const result = await run(items[index], index);
      results[index] = result;
      onComplete(result);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runNext()));
  return results;
}

async function simulateDirectSeasons(seasonIterations: number, seed: number, workerCount: number): Promise<ChunkOutput> {
  const chunks = buildChunks(seasonIterations, seed, workerCount);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "basketball-dice-direct-"));
  let completedChunks = 0;
  let completedIterations = 0;
  const started = Date.now();

  console.log(`Running ${seasonIterations.toLocaleString()} direct full-engine seasons in ${chunks.length} chunks across ${workerCount} workers...`);
  try {
    const outputs = await runWithConcurrency(
      chunks,
      workerCount,
      (chunk, index) => runChunkProcess(chunk, tempDir, index),
      (result) => {
        completedChunks += 1;
        completedIterations += result.iterations;
        console.log(
          `Chunk ${completedChunks}/${chunks.length}: ${completedIterations.toLocaleString()}/${seasonIterations.toLocaleString()} seasons complete.`
        );
      }
    );
    const merged = mergeOutputs(outputs);
    console.log(`Finished direct full-engine run in ${fixed((Date.now() - started) / 1000, 1)}s.`);
    return merged;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function mergeOutputs(outputs: ChunkOutput[]): ChunkOutput {
  const teams = teamMap();
  const teamIds = [...teams.keys()].sort();
  const merged: ChunkOutput = {
    iterations: 0,
    winsByTeam: emptyWinSamples(teamIds),
    rankSumByTeam: zeroRecord(teamIds),
    topSeedByTeam: zeroRecord(teamIds),
    topSixByTeam: zeroRecord(teamIds),
    topTenByTeam: zeroRecord(teamIds),
    playoffByTeam: zeroRecord(teamIds),
    seedCountsByTeam: emptySeedCounts(teamIds),
    semifinalsByTeam: zeroRecord(teamIds),
    conferenceFinalsByTeam: zeroRecord(teamIds),
    finalsByTeam: zeroRecord(teamIds),
    championByTeam: zeroRecord(teamIds),
    seasonSnapshots: [],
    brokenTies: 0
  };

  for (const output of outputs) {
    merged.iterations += output.iterations;
    merged.brokenTies += output.brokenTies;
    for (const teamId of teamIds) {
      merged.winsByTeam[teamId].push(...(output.winsByTeam[teamId] ?? []));
      merged.rankSumByTeam[teamId] += output.rankSumByTeam[teamId] ?? 0;
      merged.topSeedByTeam[teamId] += output.topSeedByTeam[teamId] ?? 0;
      merged.topSixByTeam[teamId] += output.topSixByTeam[teamId] ?? 0;
      merged.topTenByTeam[teamId] += output.topTenByTeam[teamId] ?? 0;
      merged.playoffByTeam[teamId] += output.playoffByTeam[teamId] ?? 0;
      const seedCounts = output.seedCountsByTeam[teamId] ?? [];
      for (let index = 0; index < 8; index += 1) {
        merged.seedCountsByTeam[teamId][index] += seedCounts[index] ?? 0;
      }
      merged.semifinalsByTeam[teamId] += output.semifinalsByTeam[teamId] ?? 0;
      merged.conferenceFinalsByTeam[teamId] += output.conferenceFinalsByTeam[teamId] ?? 0;
      merged.finalsByTeam[teamId] += output.finalsByTeam[teamId] ?? 0;
      merged.championByTeam[teamId] += output.championByTeam[teamId] ?? 0;
    }
    merged.seasonSnapshots.push(...output.seasonSnapshots);
  }

  return merged;
}

function membershipAccuracy(summaries: TeamSeasonSummary[], rankCutoff: number): Record<Conference, number> {
  const out = {} as Record<Conference, number>;
  for (const conference of ["East", "West"] as const) {
    const conferenceRows = summaries.filter((summary) => summary.conference === conference);
    const actual = new Set(
      [...conferenceRows].sort((a, b) => b.actualWins - a.actualWins || a.teamId.localeCompare(b.teamId)).slice(0, rankCutoff).map((summary) => summary.teamId)
    );
    const simulated = new Set(
      [...conferenceRows].sort((a, b) => b.averageWins - a.averageWins || a.teamId.localeCompare(b.teamId)).slice(0, rankCutoff).map((summary) => summary.teamId)
    );
    const matches = [...actual].filter((teamId) => simulated.has(teamId)).length;
    out[conference] = matches / rankCutoff;
  }
  return out;
}

function summarize(output: ChunkOutput): {
  summaries: TeamSeasonSummary[];
  metrics: Record<string, number>;
  topSixAccuracy: Record<Conference, number>;
  topTenAccuracy: Record<Conference, number>;
} {
  const games = loadRegularSeasonGames();
  const teams = teamMap();
  const actual = actualStandings(games, teams);
  const teamIds = [...teams.keys()].sort();
  const conferenceByTeamId = new Map(teamIds.map((teamId) => [teamId, conferenceForAbbr(teams.get(teamId)?.abbr ?? "")]));

  const summaries = teamIds
    .map((teamId) => {
      const team = teams.get(teamId);
      const record = actual.get(teamId);
      if (!team || !record) {
        throw new Error(`Missing summary inputs for ${teamId}`);
      }
      const winSamples = [...(output.winsByTeam[teamId] ?? [])].sort((a, b) => a - b);
      const averageWins = mean(winSamples);
      return {
        teamId,
        team: team.shortName,
        conference: conferenceByTeamId.get(teamId) ?? conferenceForAbbr(team.abbr),
        actualWins: record.wins,
        actualLosses: record.losses,
        averageWins,
        winDelta: averageWins - record.wins,
        absWinDelta: Math.abs(averageWins - record.wins),
        stdevWins: standardDeviation(winSamples, averageWins),
        p05Wins: percentile(winSamples, 0.05),
        p50Wins: percentile(winSamples, 0.5),
        p95Wins: percentile(winSamples, 0.95),
        averageRank: (output.rankSumByTeam[teamId] ?? 0) / output.iterations,
        topSeedPct: (output.topSeedByTeam[teamId] ?? 0) / output.iterations,
        topSixPct: (output.topSixByTeam[teamId] ?? 0) / output.iterations,
        topTenPct: (output.topTenByTeam[teamId] ?? 0) / output.iterations
      } satisfies TeamSeasonSummary;
    })
    .sort((a, b) => b.actualWins - a.actualWins || b.averageWins - a.averageWins);

  const actualWins = summaries.map((summary) => summary.actualWins);
  const averageWins = summaries.map((summary) => summary.averageWins);
  const errors = summaries.map((summary) => summary.winDelta);
  const metrics = {
    meanAbsoluteWinError: mean(summaries.map((summary) => summary.absWinDelta)),
    rootMeanSquareWinError: Math.sqrt(mean(errors.map((error) => error ** 2))),
    maxAbsoluteWinError: Math.max(...summaries.map((summary) => summary.absWinDelta)),
    actualToSimWinCorrelation: pearsonCorrelation(actualWins, averageWins)
  };

  return {
    summaries,
    metrics,
    topSixAccuracy: membershipAccuracy(summaries, 6),
    topTenAccuracy: membershipAccuracy(summaries, 10)
  };
}

function championshipRows(output: ChunkOutput): Array<Record<string, string | number>> {
  return [...teamMap().values()]
    .map((team) => ({
      teamId: team.id,
      team: team.shortName,
      titles: output.championByTeam[team.id] ?? 0,
      titlePct: fixed(((output.championByTeam[team.id] ?? 0) / output.iterations) * 100, 2),
      finals: output.finalsByTeam[team.id] ?? 0,
      finalsPct: fixed(((output.finalsByTeam[team.id] ?? 0) / output.iterations) * 100, 2),
      conferenceFinalsPct: fixed(((output.conferenceFinalsByTeam[team.id] ?? 0) / output.iterations) * 100, 1),
      semifinalsPct: fixed(((output.semifinalsByTeam[team.id] ?? 0) / output.iterations) * 100, 1),
      playoffsPct: fixed(((output.playoffByTeam[team.id] ?? 0) / output.iterations) * 100, 1)
    }))
    .filter((row) => row.titles > 0 || row.finals > 0)
    .sort((a, b) => b.titles - a.titles || b.finals - a.finals);
}

function bracketPlacementRows(output: ChunkOutput): Array<Record<string, string | number>> {
  return [...teamMap().values()]
    .map((team) => {
      const seedCounts = output.seedCountsByTeam[team.id] ?? [];
      return {
        teamId: team.id,
        team: team.shortName,
        conference: eastAbbrs.has(team.abbr) ? "East" : "West",
        playoffsPct: fixed(((output.playoffByTeam[team.id] ?? 0) / output.iterations) * 100, 1),
        seed1Pct: fixed(((seedCounts[0] ?? 0) / output.iterations) * 100, 1),
        seed2Pct: fixed(((seedCounts[1] ?? 0) / output.iterations) * 100, 1),
        seed3Pct: fixed(((seedCounts[2] ?? 0) / output.iterations) * 100, 1),
        seed4Pct: fixed(((seedCounts[3] ?? 0) / output.iterations) * 100, 1),
        seed5Pct: fixed(((seedCounts[4] ?? 0) / output.iterations) * 100, 1),
        seed6Pct: fixed(((seedCounts[5] ?? 0) / output.iterations) * 100, 1),
        seed7Pct: fixed(((seedCounts[6] ?? 0) / output.iterations) * 100, 1),
        seed8Pct: fixed(((seedCounts[7] ?? 0) / output.iterations) * 100, 1),
        semifinalsPct: fixed(((output.semifinalsByTeam[team.id] ?? 0) / output.iterations) * 100, 1),
        conferenceFinalsPct: fixed(((output.conferenceFinalsByTeam[team.id] ?? 0) / output.iterations) * 100, 1),
        finalsPct: fixed(((output.finalsByTeam[team.id] ?? 0) / output.iterations) * 100, 1),
        titlesPct: fixed(((output.championByTeam[team.id] ?? 0) / output.iterations) * 100, 1)
      };
    })
    .sort((a, b) => Number(b.playoffsPct) - Number(a.playoffsPct) || String(a.conference).localeCompare(String(b.conference)) || String(a.team).localeCompare(String(b.team)));
}

function defaultReportPath(seasonIterations: number, seed: number): string {
  return path.join(process.cwd(), "reports", `2021-season-direct-${seasonIterations}-availability-seed-${seed}.json`);
}

function writeJsonReport(output: ChunkOutput, workerCount: number, seed: number, outputPath: string): void {
  const games = loadRegularSeasonGames();
  const teams = [...teamMap().values()];
  const summary = summarize(output);
  const report = {
    generatedAt: new Date().toISOString(),
    run: {
      season: "2020-21",
      iterations: output.iterations,
      seed,
      workerCount,
      regularSeasonGamesPerSeason: games.length,
      directGamesSimulated: games.length * output.iterations,
      brokenTies: output.brokenTies,
      availabilityModel: {
        regularSeason: "Per-game active rosters sampled from sourced Basketball Reference regular-season games played; active roles scale from per-active-game season load.",
        postseason:
          "Actual playoff teams use sourced Basketball Reference playoff games, minutes, and totals for availability and role. Non-playoff teams use a generic tightened playoff rotation from regular-season availability.",
        shootingSkill: "Player shot-making remains based on larger regular-season samples to avoid overfitting small playoff shooting percentages."
      }
    },
    teams: teams.map((team) => ({
      teamId: team.id,
      name: team.name,
      shortName: team.shortName,
      abbr: team.abbr,
      conference: eastAbbrs.has(team.abbr) ? "East" : "West"
    })),
    accuracy: {
      metrics: summary.metrics,
      topSixAccuracy: summary.topSixAccuracy,
      topTenAccuracy: summary.topTenAccuracy,
      teamSummaries: summary.summaries
    },
    postseason: {
      championshipBreakdown: championshipRows(output),
      bracketPlacement: bracketPlacementRows(output),
      counts: {
        playoffByTeam: output.playoffByTeam,
        seedCountsByTeam: output.seedCountsByTeam,
        semifinalsByTeam: output.semifinalsByTeam,
        conferenceFinalsByTeam: output.conferenceFinalsByTeam,
        finalsByTeam: output.finalsByTeam,
        championByTeam: output.championByTeam
      },
      seasonSnapshots: output.seasonSnapshots
    },
    regularSeason: {
      winsByTeam: output.winsByTeam,
      rankSumByTeam: output.rankSumByTeam,
      topSeedByTeam: output.topSeedByTeam,
      topSixByTeam: output.topSixByTeam,
      topTenByTeam: output.topTenByTeam
    }
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Saved reusable JSON report: ${outputPath}`);
}

function printReport(output: ChunkOutput, workerCount: number): void {
  const games = loadRegularSeasonGames();
  const teams = [...teamMap().values()];
  const { summaries, metrics, topSixAccuracy, topTenAccuracy } = summarize(output);

  console.log("");
  console.log(`2020-21 direct full-engine season sim: ${output.iterations.toLocaleString()} seasons`);
  console.log(`Schedule: ${games.length} regular-season games; ${(games.length * output.iterations).toLocaleString()} direct games simulated.`);
  console.log(`Parallelism: ${workerCount} workers. Randomly resolved engine ties: ${output.brokenTies.toLocaleString()}.`);
  console.log(
    "Availability: regular-season games sample active rosters from games played; postseason uses a separate playoff rotation/availability model."
  );
  console.log(
    `Accuracy: MAE ${fixed(metrics.meanAbsoluteWinError, 2)} wins, RMSE ${fixed(metrics.rootMeanSquareWinError, 2)}, max error ${fixed(
      metrics.maxAbsoluteWinError,
      2
    )}, correlation ${fixed(metrics.actualToSimWinCorrelation, 3)}.`
  );
  console.log(`Top-six membership accuracy: East ${fixed(topSixAccuracy.East * 100, 1)}%, West ${fixed(topSixAccuracy.West * 100, 1)}%.`);
  console.log(`Top-ten membership accuracy: East ${fixed(topTenAccuracy.East * 100, 1)}%, West ${fixed(topTenAccuracy.West * 100, 1)}%.`);
  console.log("");
  console.log("Championship breakdown");
  console.table(
    teams
      .map((team) => ({
        Team: team.shortName,
        Titles: output.championByTeam[team.id] ?? 0,
        TitlePct: `${fixed(((output.championByTeam[team.id] ?? 0) / output.iterations) * 100, 2)}%`,
        Finals: output.finalsByTeam[team.id] ?? 0,
        FinalsPct: `${fixed(((output.finalsByTeam[team.id] ?? 0) / output.iterations) * 100, 2)}%`,
        ConfFinals: `${fixed(((output.conferenceFinalsByTeam[team.id] ?? 0) / output.iterations) * 100, 1)}%`,
        Semis: `${fixed(((output.semifinalsByTeam[team.id] ?? 0) / output.iterations) * 100, 1)}%`,
        Playoffs: `${fixed(((output.playoffByTeam[team.id] ?? 0) / output.iterations) * 100, 1)}%`
      }))
      .filter((row) => row.Titles > 0 || row.Finals > 0)
      .sort((a, b) => b.Titles - a.Titles || b.Finals - a.Finals)
  );
  console.log("");
  console.log("Playoff bracket placement");
  console.table(
    teams
      .map((team) => {
        const seedCounts = output.seedCountsByTeam[team.id] ?? [];
        return {
          Team: team.shortName,
          Conf: team.abbr && eastAbbrs.has(team.abbr) ? "East" : "West",
          Playoffs: `${fixed(((output.playoffByTeam[team.id] ?? 0) / output.iterations) * 100, 1)}%`,
          Seed1: `${fixed(((seedCounts[0] ?? 0) / output.iterations) * 100, 1)}%`,
          Seed2: `${fixed(((seedCounts[1] ?? 0) / output.iterations) * 100, 1)}%`,
          Seed3: `${fixed(((seedCounts[2] ?? 0) / output.iterations) * 100, 1)}%`,
          Seed4: `${fixed(((seedCounts[3] ?? 0) / output.iterations) * 100, 1)}%`,
          Seed5: `${fixed(((seedCounts[4] ?? 0) / output.iterations) * 100, 1)}%`,
          Seed6: `${fixed(((seedCounts[5] ?? 0) / output.iterations) * 100, 1)}%`,
          Seed7: `${fixed(((seedCounts[6] ?? 0) / output.iterations) * 100, 1)}%`,
          Seed8: `${fixed(((seedCounts[7] ?? 0) / output.iterations) * 100, 1)}%`,
          Semis: `${fixed(((output.semifinalsByTeam[team.id] ?? 0) / output.iterations) * 100, 1)}%`,
          ConfFinals: `${fixed(((output.conferenceFinalsByTeam[team.id] ?? 0) / output.iterations) * 100, 1)}%`,
          Finals: `${fixed(((output.finalsByTeam[team.id] ?? 0) / output.iterations) * 100, 1)}%`,
          Titles: `${fixed(((output.championByTeam[team.id] ?? 0) / output.iterations) * 100, 1)}%`
        };
      })
      .sort((a, b) => Number.parseFloat(b.Playoffs) - Number.parseFloat(a.Playoffs) || a.Conf.localeCompare(b.Conf) || a.Team.localeCompare(b.Team))
  );
  console.log("");
  console.table(
    summaries.map((summary) => ({
      Team: summary.team,
      Conf: summary.conference,
      Actual: `${summary.actualWins}-${summary.actualLosses}`,
      SimWins: fixed(summary.averageWins, 1),
      Delta: fixed(summary.winDelta, 1),
      P05: summary.p05Wins,
      P50: summary.p50Wins,
      P95: summary.p95Wins,
      AvgRank: fixed(summary.averageRank, 1),
      Top6: `${fixed(summary.topSixPct * 100, 1)}%`,
      Top10: `${fixed(summary.topTenPct * 100, 1)}%`
    }))
  );
}

function runWorker(inputPath: string | undefined, outputPath: string | undefined): void {
  if (!inputPath || !outputPath) {
    throw new Error("Worker mode requires input and output JSON paths.");
  }
  const input = JSON.parse(fs.readFileSync(inputPath, "utf8")) as ChunkInput;
  const output = simulateChunk(input.iterations, input.seed);
  fs.writeFileSync(outputPath, JSON.stringify(output));
}

async function main(): Promise<void> {
  const [seasonIterationsArg, seedArg, workerCountArg, outputPathArg] = process.argv.slice(2);
  const seasonIterations = Number(seasonIterationsArg ?? defaultSeasonIterations);
  const seed = Number(seedArg ?? defaultSeed);
  const requestedWorkers = Number(workerCountArg ?? defaultWorkerCount);
  const workerCount = Math.max(1, Math.min(Number.isFinite(requestedWorkers) ? Math.floor(requestedWorkers) : defaultWorkerCount, maxWorkerCount));
  const outputPath = path.resolve(outputPathArg ?? defaultReportPath(seasonIterations, seed));

  if (![seasonIterations, seed, workerCount].every(Number.isFinite) || seasonIterations <= 0 || workerCount <= 0) {
    throw new Error("Usage: npm run simulate:2021-season:direct -- <seasonIterations=10000> <seed=4242> <workers=auto> <outputPath=reports/...json>");
  }

  const output = await simulateDirectSeasons(seasonIterations, seed, workerCount);
  writeJsonReport(output, workerCount, seed, outputPath);
  printReport(output, workerCount);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  if (process.argv[2] === "--worker") {
    try {
      runWorker(process.argv[3], process.argv[4]);
    } catch (error: unknown) {
      console.error(error instanceof Error ? error.stack ?? error.message : error);
      process.exitCode = 1;
    }
  } else {
    main().catch((error: unknown) => {
      console.error(error instanceof Error ? error.stack ?? error.message : error);
      process.exitCode = 1;
    });
  }
}
