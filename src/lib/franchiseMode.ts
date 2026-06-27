import { aggregatePlayerStats, aggregateTeamStats, standings } from "./league";
import type { DicePlayerCard, DiceTeamCard, LeagueGame, LeagueState, MatchupOptions, SourcePlayer, SourceTeam, StatLine, TeamGamePlanOptions } from "./types";

export type FranchiseSignalTone = "positive" | "neutral" | "warning" | "negative";
export type FranchiseTeamDirection = "contend" | "buy" | "retool" | "sell" | "develop";
export type FranchiseNeedPriority = "high" | "medium" | "low";
export type FranchiseProspectRisk = "low" | "medium" | "high";
export type FranchisePlayerMarket = "draft" | "free-agent" | "trade";
export type FranchiseNeedArea =
  | "shotCreation"
  | "spacing"
  | "rimPressure"
  | "ballSecurity"
  | "rebounding"
  | "perimeterDefense"
  | "rimProtection"
  | "depth"
  | "youth";

export type FranchiseTeamInput = DiceTeamCard | SourceTeam;
export type FranchiseTeamNameLookup = Map<string, string> | Record<string, string>;
export type FranchiseTeamKeyLookup = Map<string, string> | Record<string, string>;

export interface FranchiseStandingSnapshot {
  teamId: string;
  franchiseKey: string;
  teamName: string;
  rank: number;
  wins: number;
  losses: number;
  ties: number;
  played: number;
  winPct: number;
  pointsFor: number;
  pointsAgainst: number;
  differential: number;
  differentialPerGame: number;
}

export interface FranchiseSeasonSnapshot {
  leagueId: string;
  leagueName: string;
  seasonIndex: number;
  seasonLabel: string;
  teamIds: string[];
  completedGames: number;
  scheduledGames: number;
  regularCompletedGames: number;
  regularScheduledGames: number;
  regularSeasonLeaderTeamId?: string;
  championTeamId?: string;
  runnerUpTeamId?: string;
  standings: FranchiseStandingSnapshot[];
  leaders: {
    points?: FranchisePlayerLeader;
    rebounds?: FranchisePlayerLeader;
    assists?: FranchisePlayerLeader;
  };
}

export interface FranchisePlayerLeader {
  teamId: string;
  player: string;
  value: number;
  games: number;
}

export interface FranchiseDynastyTeamSnapshot {
  franchiseKey: string;
  teamIds: string[];
  displayName: string;
  seasons: number;
  completedSeasons: number;
  championships: number;
  finalsAppearances: number;
  regularSeasonTopSeeds: number;
  regularWins: number;
  regularLosses: number;
  averageWinPct: number;
  bestWinPct: number;
  averageDifferentialPerGame: number;
  currentSeasonStreak: number;
  dynastyScore: number;
}

export interface FranchiseContinuitySnapshot {
  seasons: FranchiseSeasonSnapshot[];
  dynastyTable: FranchiseDynastyTeamSnapshot[];
  totals: {
    seasons: number;
    completedGames: number;
    scheduledGames: number;
    franchises: number;
  };
}

export interface FranchiseContinuityOptions {
  teams?: readonly FranchiseTeamInput[];
  teamNames?: FranchiseTeamNameLookup;
  teamKeyById?: FranchiseTeamKeyLookup;
  seasonLabels?: FranchiseTeamNameLookup;
  includeIncompleteSeasons?: boolean;
}

export interface FranchiseNeedMetricSet {
  games: number;
  winPct: number;
  pointDifferentialPerGame: number;
  pointsPerGame: number;
  pointsAllowedPerGame: number;
  threeAttemptRate: number;
  freeThrowRate: number;
  assistRate: number;
  turnoverPerGame: number;
  reboundMarginPerGame: number;
  topPlayerLoadShare: number;
  rotationDepth: number;
  weightedAge: number | null;
}

export interface FranchiseTeamNeed {
  area: FranchiseNeedArea;
  priority: FranchiseNeedPriority;
  score: number;
  label: string;
  detail: string;
  tone: FranchiseSignalTone;
  metrics: Partial<FranchiseNeedMetricSet>;
}

export interface FranchiseTeamNeedsSummary {
  teamId: string;
  franchiseKey: string;
  teamName: string;
  rank: number;
  direction: FranchiseTeamDirection;
  record: string;
  metrics: FranchiseNeedMetricSet;
  needs: FranchiseTeamNeed[];
  strengths: FranchiseTeamNeed[];
}

export interface FranchiseTeamNeedsReport {
  leagueId: string;
  generatedFromGames: number;
  teams: FranchiseTeamNeedsSummary[];
}

export interface FranchiseDraftProspect {
  prospectId: string;
  rank: number;
  archetype: string;
  position: string;
  market: "draft";
  score: number;
  upside: number;
  readiness: number;
  risk: FranchiseProspectRisk;
  fitTeamIds: string[];
  needAreas: FranchiseNeedArea[];
  projectedPickBand: "lottery" | "mid-first" | "late-first" | "second-round";
  summary: string;
  developmentPlan: string;
}

export interface FranchiseFreeAgentTarget {
  playerId: string;
  rank: number;
  playerName: string;
  sourceTeamId: string;
  sourceTeamName: string;
  position: string;
  age: number | null;
  market: "free-agent";
  score: number;
  estimatedRole: "star" | "starter" | "rotation" | "specialist" | "depth";
  fitTeamIds: string[];
  fitAreas: FranchiseNeedArea[];
  strengths: string[];
  concerns: string[];
  summary: string;
}

export interface FranchiseTradeBlockPlayer {
  playerId: string;
  playerName: string;
  position: string;
  age: number | null;
  market: "trade";
  availability: "core" | "listening" | "available";
  tradeValue: number;
  availabilityScore: number;
  fitAreas: FranchiseNeedArea[];
  rationale: string;
}

export interface FranchiseTradeBlockTeam {
  teamId: string;
  teamName: string;
  direction: FranchiseTeamDirection;
  needs: FranchiseTeamNeed[];
  availablePlayers: FranchiseTradeBlockPlayer[];
  protectedPlayers: FranchiseTradeBlockPlayer[];
  targetArchetypes: string[];
  summary: string;
}

export interface FranchiseRosterBoards {
  leagueId: string;
  generatedFromGames: number;
  teamNeeds: FranchiseTeamNeedsReport;
  draftBoard: FranchiseDraftProspect[];
  freeAgentBoard: FranchiseFreeAgentTarget[];
  tradeBlock: FranchiseTradeBlockTeam[];
}

export interface FranchiseRosterBuildingOptions {
  teams?: readonly FranchiseTeamInput[];
  candidateTeams?: readonly FranchiseTeamInput[];
  focusTeamId?: string;
  teamNames?: FranchiseTeamNameLookup;
  teamKeyById?: FranchiseTeamKeyLookup;
  maxNeedsPerTeam?: number;
  maxDraftProspects?: number;
  maxFreeAgents?: number;
  maxTradePlayersPerTeam?: number;
  includeCurrentPlayersInFreeAgentPool?: boolean;
}

export interface FranchiseCoachSeasonSummary {
  leagueId: string;
  leagueName: string;
  seasonIndex: number;
  teamId: string;
  teamName: string;
  wins: number;
  losses: number;
  winPct: number;
  rank: number;
  pointDifferentialPerGame: number;
  offenseRank: number;
  defenseRank: number;
  planFitScore: number;
  xp: number;
  grade: "A" | "B" | "C" | "D" | "F";
  planTags: string[];
  notes: string[];
}

export interface FranchiseCoachProgressionSummary {
  teamId: string;
  franchiseKey: string;
  teamName: string;
  seasons: FranchiseCoachSeasonSummary[];
  totalXp: number;
  level: number;
  archetype: string;
  badges: string[];
  trend: "rising" | "steady" | "slipping" | "unknown";
  nextDevelopmentGoals: string[];
}

export interface FranchiseCoachProgressionOptions {
  teams?: readonly FranchiseTeamInput[];
  teamNames?: FranchiseTeamNameLookup;
  teamKeyById?: FranchiseTeamKeyLookup;
  plansByLeagueId?: Record<string, TeamGamePlanOptions>;
}

export interface SeasonLeagueSetupRecommendation {
  name: string;
  teamIds: string[];
  gamesPerTeam: number;
  seasonStartDate: string;
  focusTeamId?: string;
  matchupOptions?: MatchupOptions;
}

export interface FranchiseSeasonCarryoverRecommendation {
  sourceLeagueId: string;
  sourceLeagueName: string;
  setup: SeasonLeagueSetupRecommendation;
  retainedTeamIds: string[];
  expansionTeamIds: string[];
  contractionTeamIds: string[];
  protectedRivalries: Array<[string, string]>;
  continuity: {
    previousChampionTeamId?: string;
    previousRunnerUpTeamId?: string;
    regularSeasonLeaderTeamId?: string;
    standingsOrder: string[];
    historyLeagueIds: string[];
    dynastyLeaderFranchiseKey?: string;
    dynastyLeaderDisplayName?: string;
  };
  rosterHooks: FranchiseTeamNeedsSummary[];
  notes: string[];
}

export interface FranchiseSeasonCarryoverOptions {
  history?: readonly LeagueState[];
  teams?: readonly FranchiseTeamInput[];
  teamNames?: FranchiseTeamNameLookup;
  teamKeyById?: FranchiseTeamKeyLookup;
  nextSeasonName?: string;
  nextSeasonStartDate?: string;
  gamesPerTeam?: number;
  retainTeamIds?: readonly string[];
  expansionTeamIds?: readonly string[];
  contractionTeamIds?: readonly string[];
  focusTeamId?: string;
  maxRosterHooks?: number;
}

type StandingRow = ReturnType<typeof standings>[number];
type PlayerStatRow = ReturnType<typeof aggregatePlayerStats>[number];
type TeamSourceRecord = {
  id: string;
  name: string;
  shortName: string;
  abbr: string;
  franchise?: string;
  season?: string;
  seasonEndYear?: number;
  dice?: DiceTeamCard;
  source?: SourceTeam;
};
type PlayerSourceRecord = {
  id: string;
  name: string;
  position: string;
  age: number | null;
  teamId: string;
  teamName: string;
  dice?: DicePlayerCard;
  source?: SourcePlayer;
};

const defaultMaxNeeds = 4;
const needLabels: Record<FranchiseNeedArea, string> = {
  shotCreation: "Shot creation",
  spacing: "Spacing",
  rimPressure: "Rim pressure",
  ballSecurity: "Ball security",
  rebounding: "Rebounding",
  perimeterDefense: "Perimeter defense",
  rimProtection: "Rim protection",
  depth: "Depth",
  youth: "Youth"
};

const needDetail: Record<FranchiseNeedArea, string> = {
  shotCreation: "Add a dependable advantage creator who can lift the half-court floor.",
  spacing: "Add shooting gravity so primary actions have more room.",
  rimPressure: "Add paint pressure and free-throw creation.",
  ballSecurity: "Reduce empty possessions with cleaner initiation and passing.",
  rebounding: "Stabilize the glass before adding lower-leverage skills.",
  perimeterDefense: "Improve the first line of defense against guards and wings.",
  rimProtection: "Add back-line deterrence and defensive possession finishers.",
  depth: "Raise the eighth-through-tenth-man floor.",
  youth: "Refresh the age curve without forcing a full teardown."
};

const draftArchetypes: Array<{
  id: string;
  archetype: string;
  position: string;
  areas: FranchiseNeedArea[];
  upside: number;
  readiness: number;
  risk: FranchiseProspectRisk;
  developmentPlan: string;
}> = [
  {
    id: "lead-creator",
    archetype: "Lead creator",
    position: "G",
    areas: ["shotCreation", "ballSecurity"],
    upside: 91,
    readiness: 72,
    risk: "medium",
    developmentPlan: "Give them second-unit control early, then scale late-clock reps as efficiency stabilizes."
  },
  {
    id: "movement-shooter",
    archetype: "Movement shooter",
    position: "G/F",
    areas: ["spacing", "depth"],
    upside: 82,
    readiness: 84,
    risk: "low",
    developmentPlan: "Install simple off-ball actions first and grow secondary handling only after the shot diet translates."
  },
  {
    id: "two-way-wing",
    archetype: "Two-way wing",
    position: "F",
    areas: ["perimeterDefense", "spacing"],
    upside: 88,
    readiness: 78,
    risk: "medium",
    developmentPlan: "Prioritize matchup reps and corner-three volume before asking for heavy on-ball work."
  },
  {
    id: "rim-running-big",
    archetype: "Rim-running big",
    position: "C",
    areas: ["rimProtection", "rebounding", "rimPressure"],
    upside: 84,
    readiness: 80,
    risk: "low",
    developmentPlan: "Anchor the second unit with vertical spacing, drop coverage, and simple glass rules."
  },
  {
    id: "connective-forward",
    archetype: "Connective forward",
    position: "F",
    areas: ["ballSecurity", "rebounding", "depth"],
    upside: 79,
    readiness: 86,
    risk: "low",
    developmentPlan: "Use them as a stabilizer in mixed lineups while the scoring package catches up."
  },
  {
    id: "athletic-stopper",
    archetype: "Athletic stopper",
    position: "G/F",
    areas: ["perimeterDefense", "youth"],
    upside: 86,
    readiness: 68,
    risk: "high",
    developmentPlan: "Keep the offensive role narrow, then graduate from point-of-attack assignments to switch groups."
  },
  {
    id: "stretch-big",
    archetype: "Stretch big",
    position: "F/C",
    areas: ["spacing", "rimProtection"],
    upside: 87,
    readiness: 70,
    risk: "high",
    developmentPlan: "Pair them with a rebounding forward until defensive reads and foul discipline become dependable."
  },
  {
    id: "bench-organizer",
    archetype: "Bench organizer",
    position: "G",
    areas: ["depth", "ballSecurity"],
    upside: 75,
    readiness: 88,
    risk: "low",
    developmentPlan: "Let them own low-turnover bench minutes and close only when the matchup needs steadier handling."
  }
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundTo(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function stat(line: StatLine | undefined, field: string): number {
  return line?.[field] ?? 0;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function average(values: number[]): number {
  return values.length ? sum(values) / values.length : 0;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}

function finiteNumber(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isFinite(value) ? value : null;
}

function lookupValue(lookup: FranchiseTeamNameLookup | FranchiseTeamKeyLookup | undefined, key: string): string | undefined {
  if (!lookup) return undefined;
  if (lookup instanceof Map) return lookup.get(key);
  return lookup[key];
}

function isDiceTeam(team: FranchiseTeamInput): team is DiceTeamCard {
  return "calibration" in team && "source" in team && Array.isArray(team.players) && (team.players.length === 0 || "useWeight" in team.players[0]);
}

function normalizeTeam(team: FranchiseTeamInput): TeamSourceRecord {
  if (isDiceTeam(team)) {
    return {
      id: team.id,
      name: team.name,
      shortName: team.shortName,
      abbr: team.abbr,
      franchise: team.source.franchise,
      season: team.season,
      seasonEndYear: team.source.seasonEndYear,
      dice: team,
      source: team.source
    };
  }
  return {
    id: team.id,
    name: team.name,
    shortName: team.shortName,
    abbr: team.abbr,
    franchise: team.franchise,
    season: team.season,
    seasonEndYear: team.seasonEndYear,
    source: team
  };
}

function teamRecords(teams: readonly FranchiseTeamInput[] | undefined): Map<string, TeamSourceRecord> {
  return new Map((teams ?? []).map((team) => normalizeTeam(team)).map((team) => [team.id, team]));
}

function teamName(teamId: string, teamMap: Map<string, TeamSourceRecord>, names?: FranchiseTeamNameLookup): string {
  return lookupValue(names, teamId) ?? teamMap.get(teamId)?.shortName ?? teamMap.get(teamId)?.name ?? teamId;
}

function franchiseKey(teamId: string, teamMap: Map<string, TeamSourceRecord>, keyById?: FranchiseTeamKeyLookup): string {
  return lookupValue(keyById, teamId) ?? teamMap.get(teamId)?.franchise ?? teamMap.get(teamId)?.abbr ?? teamId;
}

function sortedLeagues(leagues: readonly LeagueState[]): LeagueState[] {
  return [...leagues].sort((a, b) => {
    const aDate = a.currentDate || a.createdAt || a.updatedAt || "";
    const bDate = b.currentDate || b.createdAt || b.updatedAt || "";
    return aDate.localeCompare(bDate) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
}

function gameStage(game: Pick<LeagueGame, "stage">): "regular" | "play-in" | "playoffs" {
  if (game.stage === "play-in") return "play-in";
  if (game.stage === "playoffs") return "playoffs";
  return "regular";
}

function completedGames(games: readonly LeagueGame[]): LeagueGame[] {
  return games.filter((game) => Boolean(game.result));
}

function completedRegularGames(league: LeagueState): LeagueGame[] {
  return league.games.filter((game) => gameStage(game) === "regular" && game.result);
}

function teamRecordLabel(wins: number, losses: number, ties = 0): string {
  return ties ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
}

function resultScore(result: NonNullable<LeagueGame["result"]>, teamId: string): number {
  if (teamId === result.awayTeamId) return result.awayScore;
  if (teamId === result.homeTeamId) return result.homeScore;
  return stat(result.teamStats[teamId], "PTS");
}

function playoffFinalists(league: LeagueState): { championTeamId?: string; runnerUpTeamId?: string } {
  const series = league.playoffs?.series ?? [];
  if (!series.length) return {};
  const finalRound = Math.max(...series.map((row) => row.round));
  const finalSeries = series.filter((row) => row.round === finalRound).sort((a, b) => a.bracketIndex - b.bracketIndex || a.id.localeCompare(b.id))[0];
  if (!finalSeries) return {};

  const wins = new Map<string, number>([
    [finalSeries.teamAId, 0],
    [finalSeries.teamBId, 0]
  ]);
  for (const gameId of finalSeries.gameIds) {
    const winner = league.games.find((game) => game.id === gameId)?.result?.winnerTeamId;
    if (winner && winner !== "tie") wins.set(winner, (wins.get(winner) ?? 0) + 1);
  }

  const winsA = wins.get(finalSeries.teamAId) ?? 0;
  const winsB = wins.get(finalSeries.teamBId) ?? 0;
  if (Math.max(winsA, winsB) < 4 && league.playoffs?.status !== "complete") return {};
  if (winsA === winsB) return {};
  return winsA > winsB
    ? { championTeamId: finalSeries.teamAId, runnerUpTeamId: finalSeries.teamBId }
    : { championTeamId: finalSeries.teamBId, runnerUpTeamId: finalSeries.teamAId };
}

function playerLeader(rows: PlayerStatRow[], field: "PTS" | "REB" | "AST"): FranchisePlayerLeader | undefined {
  const leader = rows
    .filter((row) => row.games > 0)
    .sort((a, b) => (b.perGame[field] ?? 0) - (a.perGame[field] ?? 0) || b.games - a.games || a.player.localeCompare(b.player))[0];
  if (!leader) return undefined;
  return {
    teamId: leader.teamId,
    player: leader.player,
    value: roundTo(leader.perGame[field] ?? 0, 1),
    games: leader.games
  };
}

function seasonLabel(league: LeagueState, index: number, options?: FranchiseContinuityOptions): string {
  return lookupValue(options?.seasonLabels, league.id) ?? league.currentDate?.slice(0, 4) ?? `Season ${index + 1}`;
}

function standingSnapshots(league: LeagueState, teamMap: Map<string, TeamSourceRecord>, options?: Pick<FranchiseContinuityOptions, "teamNames" | "teamKeyById">): FranchiseStandingSnapshot[] {
  return standings(league).map((row, index) => ({
    teamId: row.teamId,
    franchiseKey: franchiseKey(row.teamId, teamMap, options?.teamKeyById),
    teamName: teamName(row.teamId, teamMap, options?.teamNames),
    rank: index + 1,
    wins: row.wins,
    losses: row.losses,
    ties: row.ties,
    played: row.played,
    winPct: roundTo(row.winPct, 3),
    pointsFor: row.pointsFor,
    pointsAgainst: row.pointsAgainst,
    differential: row.differential,
    differentialPerGame: roundTo(row.played ? row.differential / row.played : 0, 1)
  }));
}

function buildSeasonSnapshot(
  league: LeagueState,
  index: number,
  teamMap: Map<string, TeamSourceRecord>,
  options?: FranchiseContinuityOptions
): FranchiseSeasonSnapshot {
  const regularGames = league.games.filter((game) => gameStage(game) === "regular");
  const standingsRows = standingSnapshots(league, teamMap, options);
  const playerRows = aggregatePlayerStats(league, "regular");
  const finalists = playoffFinalists(league);
  return {
    leagueId: league.id,
    leagueName: league.name,
    seasonIndex: index,
    seasonLabel: seasonLabel(league, index, options),
    teamIds: [...league.teamIds],
    completedGames: completedGames(league.games).length,
    scheduledGames: league.games.length,
    regularCompletedGames: regularGames.filter((game) => game.result).length,
    regularScheduledGames: regularGames.length,
    regularSeasonLeaderTeamId: standingsRows[0]?.teamId,
    championTeamId: finalists.championTeamId,
    runnerUpTeamId: finalists.runnerUpTeamId,
    standings: standingsRows,
    leaders: {
      points: playerLeader(playerRows, "PTS"),
      rebounds: playerLeader(playerRows, "REB"),
      assists: playerLeader(playerRows, "AST")
    }
  };
}

function dynastyStreak(seasons: FranchiseSeasonSnapshot[], teamIds: Set<string>): number {
  let streak = 0;
  for (let index = seasons.length - 1; index >= 0; index -= 1) {
    const season = seasons[index];
    const row = season.standings.find((candidate) => teamIds.has(candidate.teamId));
    if (!row || row.winPct < 0.5) break;
    streak += 1;
  }
  return streak;
}

function buildDynastyTable(seasons: FranchiseSeasonSnapshot[]): FranchiseDynastyTeamSnapshot[] {
  const rows = new Map<string, FranchiseDynastyTeamSnapshot & { differentialTotal: number; winPctTotal: number }>();
  for (const season of seasons) {
    for (const row of season.standings) {
      const target =
        rows.get(row.franchiseKey) ??
        ({
          franchiseKey: row.franchiseKey,
          teamIds: [],
          displayName: row.teamName,
          seasons: 0,
          completedSeasons: 0,
          championships: 0,
          finalsAppearances: 0,
          regularSeasonTopSeeds: 0,
          regularWins: 0,
          regularLosses: 0,
          averageWinPct: 0,
          bestWinPct: 0,
          averageDifferentialPerGame: 0,
          currentSeasonStreak: 0,
          dynastyScore: 0,
          differentialTotal: 0,
          winPctTotal: 0
        } satisfies FranchiseDynastyTeamSnapshot & { differentialTotal: number; winPctTotal: number });
      if (!target.teamIds.includes(row.teamId)) target.teamIds.push(row.teamId);
      target.seasons += 1;
      if (row.played > 0) {
        target.completedSeasons += 1;
        target.winPctTotal += row.winPct;
        target.differentialTotal += row.differentialPerGame;
      }
      target.regularWins += row.wins;
      target.regularLosses += row.losses;
      target.bestWinPct = Math.max(target.bestWinPct, row.winPct);
      if (season.regularSeasonLeaderTeamId === row.teamId) target.regularSeasonTopSeeds += 1;
      if (season.championTeamId === row.teamId) target.championships += 1;
      if (season.championTeamId === row.teamId || season.runnerUpTeamId === row.teamId) target.finalsAppearances += 1;
      rows.set(row.franchiseKey, target);
    }
  }

  return Array.from(rows.values())
    .map((row) => {
      const teamIdSet = new Set(row.teamIds);
      const averageWinPct = row.completedSeasons ? row.winPctTotal / row.completedSeasons : 0;
      const averageDifferentialPerGame = row.completedSeasons ? row.differentialTotal / row.completedSeasons : 0;
      const dynastyScore =
        row.championships * 100 +
        row.finalsAppearances * 38 +
        row.regularSeasonTopSeeds * 24 +
        averageWinPct * 82 +
        averageDifferentialPerGame * 2 +
        dynastyStreak(seasons, teamIdSet) * 8;
      return {
        franchiseKey: row.franchiseKey,
        teamIds: row.teamIds.sort(),
        displayName: row.displayName,
        seasons: row.seasons,
        completedSeasons: row.completedSeasons,
        championships: row.championships,
        finalsAppearances: row.finalsAppearances,
        regularSeasonTopSeeds: row.regularSeasonTopSeeds,
        regularWins: row.regularWins,
        regularLosses: row.regularLosses,
        averageWinPct: roundTo(averageWinPct, 3),
        bestWinPct: roundTo(row.bestWinPct, 3),
        averageDifferentialPerGame: roundTo(averageDifferentialPerGame, 1),
        currentSeasonStreak: dynastyStreak(seasons, teamIdSet),
        dynastyScore: roundTo(dynastyScore, 1)
      };
    })
    .sort((a, b) => b.dynastyScore - a.dynastyScore || a.displayName.localeCompare(b.displayName));
}

export function buildFranchiseContinuitySnapshot(leagues: readonly LeagueState[], options: FranchiseContinuityOptions = {}): FranchiseContinuitySnapshot {
  const teamMap = teamRecords(options.teams);
  const orderedLeagues = sortedLeagues(leagues);
  const seasons = orderedLeagues
    .map((league, index) => buildSeasonSnapshot(league, index, teamMap, options))
    .filter((season) => options.includeIncompleteSeasons !== false || season.completedGames > 0);
  const dynastyTable = buildDynastyTable(seasons);

  return {
    seasons,
    dynastyTable,
    totals: {
      seasons: seasons.length,
      completedGames: sum(seasons.map((season) => season.completedGames)),
      scheduledGames: sum(seasons.map((season) => season.scheduledGames)),
      franchises: dynastyTable.length
    }
  };
}

export const buildDynastySnapshot = buildFranchiseContinuitySnapshot;

function scorePriority(score: number): FranchiseNeedPriority {
  if (score >= 67) return "high";
  if (score >= 38) return "medium";
  return "low";
}

function toneForNeedScore(score: number): FranchiseSignalTone {
  if (score >= 67) return "negative";
  if (score >= 38) return "warning";
  return "neutral";
}

function toneForStrengthScore(score: number): FranchiseSignalTone {
  if (score >= 67) return "positive";
  if (score >= 38) return "neutral";
  return "warning";
}

function teamGamesPerTeam(league: LeagueState): Map<string, number> {
  const counts = new Map(league.teamIds.map((teamId) => [teamId, 0]));
  for (const game of league.games.filter((row) => gameStage(row) === "regular")) {
    counts.set(game.awayTeamId, (counts.get(game.awayTeamId) ?? 0) + 1);
    counts.set(game.homeTeamId, (counts.get(game.homeTeamId) ?? 0) + 1);
  }
  return counts;
}

function sourceGames(source: SourceTeam | undefined): number {
  const wins = finiteNumber(source?.team.wins) ?? 0;
  const losses = finiteNumber(source?.team.losses) ?? 0;
  return Math.max(1, wins + losses);
}

function sourceRotationDepth(source: TeamSourceRecord | undefined): number {
  if (!source) return 0;
  if (source.dice) {
    return source.dice.players.filter((player) => player.minutes >= 12).length;
  }
  const games = sourceGames(source.source);
  return (source.source?.players ?? []).filter((player) => (finiteNumber(player.minutes) ?? 0) / games >= 12).length;
}

function sourceWeightedAge(source: TeamSourceRecord | undefined): number | null {
  const players = source?.source?.players ?? [];
  const weighted = players
    .map((player) => {
      const age = finiteNumber(player.age);
      const minutes = finiteNumber(player.minutes);
      return age !== null && minutes !== null ? [age, Math.max(0, minutes)] as [number, number] : null;
    })
    .filter((row): row is [number, number] => Boolean(row));
  const totalWeight = sum(weighted.map(([, weight]) => weight));
  return totalWeight > 0 ? roundTo(sum(weighted.map(([age, weight]) => age * weight)) / totalWeight, 1) : null;
}

function playerLoad(line: StatLine): number {
  return stat(line, "FGA") + 0.44 * stat(line, "FTA") + stat(line, "TOV") + 0.35 * stat(line, "AST");
}

function topPlayerLoadShare(playerRows: PlayerStatRow[], teamId: string): number {
  const loads = playerRows.filter((row) => row.teamId === teamId).map((row) => playerLoad(row.totals));
  const total = sum(loads);
  return total > 0 ? Math.max(...loads) / total : 0;
}

function teamDirection(row: StandingRow | undefined, metrics: FranchiseNeedMetricSet): FranchiseTeamDirection {
  if (!row || metrics.games < 5) return "develop";
  if (metrics.winPct >= 0.62 && metrics.pointDifferentialPerGame >= 2) return "contend";
  if (metrics.winPct >= 0.5) return "buy";
  if (metrics.winPct >= 0.38) return "retool";
  if (metrics.weightedAge !== null && metrics.weightedAge <= 25.5) return "develop";
  return "sell";
}

function leagueMetricAverages(teamMetrics: FranchiseNeedMetricSet[]): FranchiseNeedMetricSet {
  return {
    games: roundTo(average(teamMetrics.map((row) => row.games)), 1),
    winPct: average(teamMetrics.map((row) => row.winPct)),
    pointDifferentialPerGame: average(teamMetrics.map((row) => row.pointDifferentialPerGame)),
    pointsPerGame: average(teamMetrics.map((row) => row.pointsPerGame)),
    pointsAllowedPerGame: average(teamMetrics.map((row) => row.pointsAllowedPerGame)),
    threeAttemptRate: average(teamMetrics.map((row) => row.threeAttemptRate)),
    freeThrowRate: average(teamMetrics.map((row) => row.freeThrowRate)),
    assistRate: average(teamMetrics.map((row) => row.assistRate)),
    turnoverPerGame: average(teamMetrics.map((row) => row.turnoverPerGame)),
    reboundMarginPerGame: average(teamMetrics.map((row) => row.reboundMarginPerGame)),
    topPlayerLoadShare: average(teamMetrics.map((row) => row.topPlayerLoadShare)),
    rotationDepth: average(teamMetrics.map((row) => row.rotationDepth)),
    weightedAge: average(teamMetrics.map((row) => row.weightedAge).filter((age): age is number => age !== null))
  };
}

function needScoreFromDelta(delta: number, scale: number): number {
  return clamp((delta / scale) * 50 + 20, 0, 100);
}

function strengthScoreFromDelta(delta: number, scale: number): number {
  return clamp((delta / scale) * 50, 0, 100);
}

function buildNeed(area: FranchiseNeedArea, score: number, metrics: Partial<FranchiseNeedMetricSet>, asStrength = false): FranchiseTeamNeed {
  return {
    area,
    priority: scorePriority(score),
    score: roundTo(score, 0),
    label: needLabels[area],
    detail: needDetail[area],
    tone: asStrength ? toneForStrengthScore(score) : toneForNeedScore(score),
    metrics
  };
}

function sourceTeamNeedAdjustments(team: TeamSourceRecord | undefined): Partial<Record<FranchiseNeedArea, number>> {
  if (!team) return {};
  const source = team.source;
  const dice = team.dice;
  return {
    shotCreation:
      (source?.team.offensiveRating !== null && source?.team.offensiveRating !== undefined ? clamp((112 - source.team.offensiveRating) * 3, -12, 18) : 0) +
      (dice ? clamp((4.8 - dice.shotQuality) * 6, -10, 16) : 0),
    spacing:
      (source?.team.threeAttemptRate !== null && source?.team.threeAttemptRate !== undefined ? clamp((0.35 - source.team.threeAttemptRate) * 80, -10, 18) : 0) +
      (dice ? clamp((4.8 - dice.threeTendency) * 5, -10, 14) : 0),
    rimPressure: dice ? clamp((4.8 - dice.foulDraw) * 5, -8, 14) : 0,
    ballSecurity:
      (source?.team.turnoverPct !== null && source?.team.turnoverPct !== undefined ? clamp((source.team.turnoverPct - 13) * 4, -8, 14) : 0) +
      (dice ? clamp((4.7 - dice.toProtect) * 5, -8, 14) : 0),
    rebounding: dice ? clamp((4.7 - Math.min(dice.orb, dice.drb)) * 5, -8, 14) : 0,
    perimeterDefense: dice ? clamp((4.7 - dice.toPress) * 5, -8, 14) : 0,
    rimProtection:
      (source?.team.defensiveRating !== null && source?.team.defensiveRating !== undefined ? clamp((source.team.defensiveRating - 112) * 2.5, -12, 18) : 0) +
      (dice ? clamp((4.7 - dice.defense) * 5, -10, 16) : 0)
  };
}

function metricsForTeam(
  league: LeagueState,
  row: StandingRow | undefined,
  teamLine: StatLine & { games: number },
  opponentLine: StatLine | undefined,
  source: TeamSourceRecord | undefined,
  playerRows: PlayerStatRow[]
): FranchiseNeedMetricSet {
  const games = Math.max(1, teamLine.games || row?.played || 0);
  const fga = stat(teamLine, "FGA");
  const fgm = stat(teamLine, "FGM");
  const reb = stat(teamLine, "REB");
  const opponentReb = stat(opponentLine, "REB");
  const gamesPerTeam = teamGamesPerTeam(league);
  const scheduledGames = Math.max(1, gamesPerTeam.get(row?.teamId ?? source?.id ?? "") ?? games);
  return {
    games: teamLine.games,
    winPct: row?.winPct ?? 0,
    pointDifferentialPerGame: roundTo(row?.played ? (row.differential / row.played) : 0, 1),
    pointsPerGame: roundTo(stat(teamLine, "PTS") / games, 1),
    pointsAllowedPerGame: roundTo((row?.pointsAgainst ?? 0) / games, 1),
    threeAttemptRate: roundTo(rate(stat(teamLine, "3PA"), fga), 3),
    freeThrowRate: roundTo(rate(stat(teamLine, "FTA"), fga), 3),
    assistRate: roundTo(rate(stat(teamLine, "AST"), fgm), 3),
    turnoverPerGame: roundTo(stat(teamLine, "TOV") / games, 1),
    reboundMarginPerGame: roundTo((reb - opponentReb) / games, 1),
    topPlayerLoadShare: roundTo(topPlayerLoadShare(playerRows, row?.teamId ?? source?.id ?? ""), 3),
    rotationDepth: sourceRotationDepth(source) || Math.min(10, Math.max(0, Math.round(scheduledGames / Math.max(1, scheduledGames / 9)))),
    weightedAge: sourceWeightedAge(source)
  };
}

function opponentStatsByTeam(league: LeagueState): Record<string, StatLine> {
  const rows = Object.fromEntries(league.teamIds.map((teamId) => [teamId, {} as StatLine]));
  for (const game of completedRegularGames(league)) {
    const result = game.result;
    if (!result) continue;
    const awayLine = result.teamStats[game.awayTeamId] ?? {};
    const homeLine = result.teamStats[game.homeTeamId] ?? {};
    addStats(rows[game.awayTeamId], homeLine);
    addStats(rows[game.homeTeamId], awayLine);
  }
  return rows;
}

function addStats(target: StatLine, source: StatLine): void {
  for (const [field, value] of Object.entries(source)) {
    target[field] = (target[field] ?? 0) + value;
  }
}

function needsForMetrics(metrics: FranchiseNeedMetricSet, averages: FranchiseNeedMetricSet, sourceAdjustments: Partial<Record<FranchiseNeedArea, number>>): FranchiseTeamNeed[] {
  const scores: Array<[FranchiseNeedArea, number, Partial<FranchiseNeedMetricSet>]> = [
    [
      "shotCreation",
      needScoreFromDelta(averages.pointsPerGame - metrics.pointsPerGame, 10) + Math.max(0, metrics.topPlayerLoadShare - 0.34) * 60,
      { pointsPerGame: metrics.pointsPerGame, topPlayerLoadShare: metrics.topPlayerLoadShare }
    ],
    ["spacing", needScoreFromDelta(averages.threeAttemptRate - metrics.threeAttemptRate, 0.09), { threeAttemptRate: metrics.threeAttemptRate }],
    ["rimPressure", needScoreFromDelta(averages.freeThrowRate - metrics.freeThrowRate, 0.1), { freeThrowRate: metrics.freeThrowRate }],
    ["ballSecurity", needScoreFromDelta(metrics.turnoverPerGame - averages.turnoverPerGame, 4), { turnoverPerGame: metrics.turnoverPerGame }],
    ["rebounding", needScoreFromDelta(averages.reboundMarginPerGame - metrics.reboundMarginPerGame, 6), { reboundMarginPerGame: metrics.reboundMarginPerGame }],
    ["perimeterDefense", needScoreFromDelta(metrics.pointsAllowedPerGame - averages.pointsAllowedPerGame, 10), { pointsAllowedPerGame: metrics.pointsAllowedPerGame }],
    ["rimProtection", needScoreFromDelta(metrics.pointsAllowedPerGame - averages.pointsAllowedPerGame + Math.max(0, -metrics.reboundMarginPerGame) * 0.7, 12), { pointsAllowedPerGame: metrics.pointsAllowedPerGame, reboundMarginPerGame: metrics.reboundMarginPerGame }],
    ["depth", needScoreFromDelta(averages.rotationDepth - metrics.rotationDepth, 3.5), { rotationDepth: metrics.rotationDepth }],
    [
      "youth",
      metrics.weightedAge === null ? 20 : needScoreFromDelta(metrics.weightedAge - Math.max(26, averages.weightedAge ?? 27), 4),
      { weightedAge: metrics.weightedAge ?? undefined }
    ]
  ];

  return scores
    .map(([area, score, metricSet]) => buildNeed(area, clamp(score + (sourceAdjustments[area] ?? 0), 0, 100), metricSet))
    .filter((need) => need.score >= 24)
    .sort((a, b) => b.score - a.score || needLabels[a.area].localeCompare(needLabels[b.area]));
}

function strengthsForMetrics(metrics: FranchiseNeedMetricSet, averages: FranchiseNeedMetricSet): FranchiseTeamNeed[] {
  const scores: Array<[FranchiseNeedArea, number, Partial<FranchiseNeedMetricSet>]> = [
    ["shotCreation", strengthScoreFromDelta(metrics.pointsPerGame - averages.pointsPerGame, 10), { pointsPerGame: metrics.pointsPerGame }],
    ["spacing", strengthScoreFromDelta(metrics.threeAttemptRate - averages.threeAttemptRate, 0.09), { threeAttemptRate: metrics.threeAttemptRate }],
    ["rimPressure", strengthScoreFromDelta(metrics.freeThrowRate - averages.freeThrowRate, 0.1), { freeThrowRate: metrics.freeThrowRate }],
    ["ballSecurity", strengthScoreFromDelta(averages.turnoverPerGame - metrics.turnoverPerGame, 4), { turnoverPerGame: metrics.turnoverPerGame }],
    ["rebounding", strengthScoreFromDelta(metrics.reboundMarginPerGame - averages.reboundMarginPerGame, 6), { reboundMarginPerGame: metrics.reboundMarginPerGame }],
    ["perimeterDefense", strengthScoreFromDelta(averages.pointsAllowedPerGame - metrics.pointsAllowedPerGame, 10), { pointsAllowedPerGame: metrics.pointsAllowedPerGame }],
    ["depth", strengthScoreFromDelta(metrics.rotationDepth - averages.rotationDepth, 3.5), { rotationDepth: metrics.rotationDepth }]
  ];
  return scores
    .map(([area, score, metricSet]) => buildNeed(area, score, metricSet, true))
    .filter((need) => need.score >= 28)
    .sort((a, b) => b.score - a.score || needLabels[a.area].localeCompare(needLabels[b.area]));
}

export function buildTeamNeedsReport(league: LeagueState, options: FranchiseRosterBuildingOptions = {}): FranchiseTeamNeedsReport {
  const teamMap = teamRecords(options.teams);
  const rowByTeam = new Map(standings(league).map((row, index) => [row.teamId, { row, rank: index + 1 }]));
  const teamStats = aggregateTeamStats(league, "regular");
  const opponentStats = opponentStatsByTeam(league);
  const playerRows = aggregatePlayerStats(league, "regular");
  const metricRows = league.teamIds.map((teamId) =>
    metricsForTeam(league, rowByTeam.get(teamId)?.row, teamStats[teamId] ?? { games: 0 }, opponentStats[teamId], teamMap.get(teamId), playerRows)
  );
  const averages = leagueMetricAverages(metricRows);
  const maxNeeds = options.maxNeedsPerTeam ?? defaultMaxNeeds;

  return {
    leagueId: league.id,
    generatedFromGames: completedRegularGames(league).length,
    teams: league.teamIds
      .map((teamId, index) => {
        const row = rowByTeam.get(teamId)?.row;
        const metrics = metricRows[index];
        const needs = needsForMetrics(metrics, averages, sourceTeamNeedAdjustments(teamMap.get(teamId))).slice(0, maxNeeds);
        const strengths = strengthsForMetrics(metrics, averages).slice(0, 3);
        return {
          teamId,
          franchiseKey: franchiseKey(teamId, teamMap, options.teamKeyById),
          teamName: teamName(teamId, teamMap, options.teamNames),
          rank: rowByTeam.get(teamId)?.rank ?? league.teamIds.indexOf(teamId) + 1,
          direction: teamDirection(row, metrics),
          record: teamRecordLabel(row?.wins ?? 0, row?.losses ?? 0, row?.ties ?? 0),
          metrics,
          needs,
          strengths
        };
      })
      .sort((a, b) => a.rank - b.rank || a.teamName.localeCompare(b.teamName))
  };
}

function draftFitScore(needs: FranchiseTeamNeed[], areas: FranchiseNeedArea[]): number {
  return sum(areas.map((area) => needs.find((need) => need.area === area)?.score ?? 0)) / areas.length;
}

function pickBand(rank: number): FranchiseDraftProspect["projectedPickBand"] {
  if (rank <= 5) return "lottery";
  if (rank <= 12) return "mid-first";
  if (rank <= 20) return "late-first";
  return "second-round";
}

export function buildDraftBoard(league: LeagueState, options: FranchiseRosterBuildingOptions = {}): FranchiseDraftProspect[] {
  const needsReport = buildTeamNeedsReport(league, options);
  const focus = options.focusTeamId ? needsReport.teams.find((team) => team.teamId === options.focusTeamId) : undefined;
  const maxProspects = options.maxDraftProspects ?? draftArchetypes.length;
  return draftArchetypes
    .map((template) => {
      const teamFits = needsReport.teams
        .map((team) => ({ teamId: team.teamId, score: draftFitScore(team.needs, template.areas) }))
        .sort((a, b) => b.score - a.score || a.teamId.localeCompare(b.teamId));
      const focusScore = focus ? draftFitScore(focus.needs, template.areas) : average(teamFits.slice(0, 6).map((row) => row.score));
      const score = clamp(focusScore * 0.68 + template.upside * 0.2 + template.readiness * 0.12, 0, 100);
      return {
        prospectId: `${slug(league.id)}-draft-${template.id}`,
        rank: 0,
        archetype: template.archetype,
        position: template.position,
        market: "draft" as const,
        score: roundTo(score, 0),
        upside: template.upside,
        readiness: template.readiness,
        risk: template.risk,
        fitTeamIds: teamFits.filter((row) => row.score >= 36).slice(0, 5).map((row) => row.teamId),
        needAreas: template.areas,
        projectedPickBand: "second-round" as FranchiseDraftProspect["projectedPickBand"],
        summary: `${template.archetype} maps to ${template.areas.map((area) => needLabels[area].toLowerCase()).join(" and ")} needs.`,
        developmentPlan: template.developmentPlan
      };
    })
    .sort((a, b) => b.score - a.score || b.upside - a.upside || a.archetype.localeCompare(b.archetype))
    .slice(0, maxProspects)
    .map((prospect, index) => ({ ...prospect, rank: index + 1, projectedPickBand: pickBand(index + 1) }));
}

function sourcePlayerRecord(team: TeamSourceRecord, player: SourcePlayer): PlayerSourceRecord {
  return {
    id: player.sourceId || `${team.id}:${slug(player.name)}`,
    name: player.name,
    position: player.position || "F",
    age: finiteNumber(player.age),
    teamId: team.id,
    teamName: team.shortName,
    source: player
  };
}

function dicePlayerRecord(team: TeamSourceRecord, player: DicePlayerCard): PlayerSourceRecord {
  return {
    id: player.id,
    name: player.name,
    position: player.position || "F",
    age: finiteNumber(player.source.age),
    teamId: team.id,
    teamName: team.shortName,
    dice: player,
    source: player.source
  };
}

function playerRecordsFromTeam(team: TeamSourceRecord): PlayerSourceRecord[] {
  if (team.dice) return team.dice.players.map((player) => dicePlayerRecord(team, player));
  return (team.source?.players ?? []).map((player) => sourcePlayerRecord(team, player));
}

function playerMinutes(player: PlayerSourceRecord): number {
  if (player.dice) return player.dice.minutes;
  return finiteNumber(player.source?.perGame.mp) ?? ((finiteNumber(player.source?.minutes) ?? 0) / Math.max(1, finiteNumber(player.source?.games) ?? 82));
}

function playerPoints(player: PlayerSourceRecord): number {
  return finiteNumber(player.source?.perGame.pts) ?? 0;
}

function playerRebounds(player: PlayerSourceRecord): number {
  return finiteNumber(player.source?.perGame.trb) ?? 0;
}

function playerAssists(player: PlayerSourceRecord): number {
  return finiteNumber(player.source?.perGame.ast) ?? 0;
}

function playerValue(player: PlayerSourceRecord): number {
  const bpm = finiteNumber(player.source?.advanced.bpm) ?? 0;
  const ws = finiteNumber(player.source?.advanced.ws) ?? 0;
  const ts = finiteNumber(player.source?.advanced.tsPct) ?? 0.54;
  const age = player.age ?? 27;
  const ageCurve = age <= 24 ? 5 : age >= 33 ? -6 : 0;
  const diceSignal = player.dice ? (player.dice.useWeight + player.dice.astWeight * 0.25 + player.dice.drbWeight * 0.1 + player.dice.blkWeight * 0.1) * 0.35 : 0;
  return clamp(
    playerMinutes(player) * 1.1 +
      playerPoints(player) * 1.15 +
      playerRebounds(player) * 0.85 +
      playerAssists(player) * 1.2 +
      bpm * 3.5 +
      ws * 1.1 +
      (ts - 0.54) * 60 +
      diceSignal +
      ageCurve,
    0,
    100
  );
}

function roleForValue(value: number, minutes: number): FranchiseFreeAgentTarget["estimatedRole"] {
  if (value >= 72 || minutes >= 32) return "star";
  if (value >= 56 || minutes >= 26) return "starter";
  if (value >= 36 || minutes >= 16) return "rotation";
  if (value >= 24) return "specialist";
  return "depth";
}

function playerNeedAreas(player: PlayerSourceRecord): FranchiseNeedArea[] {
  const areas = new Set<FranchiseNeedArea>();
  const position = player.position.toUpperCase();
  const threeRate = rate(finiteNumber(player.source?.totals.fg3a) ?? 0, finiteNumber(player.source?.totals.fga) ?? 0);
  const ftRate = rate(finiteNumber(player.source?.totals.fta) ?? 0, finiteNumber(player.source?.totals.fga) ?? 0);
  const astPct = finiteNumber(player.source?.advanced.astPct) ?? 0;
  const tovPct = finiteNumber(player.source?.advanced.tovPct) ?? 14;
  const trbPct = finiteNumber(player.source?.advanced.trbPct) ?? 0;
  const blkPct = finiteNumber(player.source?.advanced.blkPct) ?? 0;
  const stlPct = finiteNumber(player.source?.advanced.stlPct) ?? 0;

  if (playerPoints(player) >= 14 || finiteNumber(player.source?.advanced.usagePct) && (player.source?.advanced.usagePct ?? 0) >= 22) areas.add("shotCreation");
  if (threeRate >= 0.33 || (player.dice?.threeFrequency ?? 0) >= 35) areas.add("spacing");
  if (ftRate >= 0.28 || (player.dice?.fd ?? 0) >= 8) areas.add("rimPressure");
  if (astPct >= 18 || tovPct <= 10) areas.add("ballSecurity");
  if (trbPct >= 12 || position.includes("C")) areas.add("rebounding");
  if (stlPct >= 1.8 || position.includes("G") || position.includes("F")) areas.add("perimeterDefense");
  if (blkPct >= 2.2 || position.includes("C")) areas.add("rimProtection");
  if (playerMinutes(player) >= 14) areas.add("depth");
  if ((player.age ?? 28) <= 24) areas.add("youth");
  return Array.from(areas);
}

function freeAgentStrengths(player: PlayerSourceRecord, areas: FranchiseNeedArea[]): string[] {
  const strengths = areas.slice(0, 3).map((area) => needLabels[area]);
  if (playerValue(player) >= 55) strengths.unshift("Impact role");
  return Array.from(new Set(strengths)).slice(0, 4);
}

function freeAgentConcerns(player: PlayerSourceRecord): string[] {
  const concerns: string[] = [];
  if ((player.age ?? 0) >= 33) concerns.push("Age curve");
  if (playerMinutes(player) < 12) concerns.push("Limited role sample");
  if ((finiteNumber(player.source?.advanced.tovPct) ?? 0) >= 17) concerns.push("Turnover risk");
  if ((finiteNumber(player.source?.advanced.tsPct) ?? 1) < 0.51) concerns.push("Scoring efficiency");
  return concerns.slice(0, 3);
}

function candidatePlayerPool(league: LeagueState, options: FranchiseRosterBuildingOptions): PlayerSourceRecord[] {
  const currentIds = new Set(league.teamIds);
  const candidateMap = teamRecords([...(options.candidateTeams ?? []), ...(options.teams ?? [])]);
  const players: PlayerSourceRecord[] = [];
  for (const team of candidateMap.values()) {
    if (!options.includeCurrentPlayersInFreeAgentPool && currentIds.has(team.id)) continue;
    players.push(...playerRecordsFromTeam(team));
  }
  return Array.from(new Map(players.map((player) => [player.id, player])).values());
}

export function buildFreeAgentBoard(league: LeagueState, options: FranchiseRosterBuildingOptions = {}): FranchiseFreeAgentTarget[] {
  const needsReport = buildTeamNeedsReport(league, options);
  const focus = options.focusTeamId ? needsReport.teams.find((team) => team.teamId === options.focusTeamId) : undefined;
  const maxFreeAgents = options.maxFreeAgents ?? 24;
  return candidatePlayerPool(league, options)
    .map((player) => {
      const areas = playerNeedAreas(player);
      const fits = needsReport.teams
        .map((team) => ({
          teamId: team.teamId,
          score: sum(areas.map((area) => team.needs.find((need) => need.area === area)?.score ?? 0))
        }))
        .filter((row) => row.score > 0)
        .sort((a, b) => b.score - a.score || a.teamId.localeCompare(b.teamId));
      const value = playerValue(player);
      const focusFit = focus ? sum(areas.map((area) => focus.needs.find((need) => need.area === area)?.score ?? 0)) : average(fits.slice(0, 5).map((row) => row.score));
      const score = clamp(value * 0.72 + focusFit * 0.28, 0, 100);
      return {
        playerId: player.id,
        rank: 0,
        playerName: player.name,
        sourceTeamId: player.teamId,
        sourceTeamName: player.teamName,
        position: player.position,
        age: player.age,
        market: "free-agent" as const,
        score: roundTo(score, 0),
        estimatedRole: roleForValue(value, playerMinutes(player)),
        fitTeamIds: fits.slice(0, 5).map((row) => row.teamId),
        fitAreas: areas,
        strengths: freeAgentStrengths(player, areas),
        concerns: freeAgentConcerns(player),
        summary: `${player.name} profiles as ${roleForValue(value, playerMinutes(player))} help for ${areas.slice(0, 2).map((area) => needLabels[area].toLowerCase()).join(" and ") || "depth"}.`
      };
    })
    .filter((target) => target.score >= 18)
    .sort((a, b) => b.score - a.score || a.playerName.localeCompare(b.playerName))
    .slice(0, maxFreeAgents)
    .map((target, index) => ({ ...target, rank: index + 1 }));
}

function availabilityForPlayer(player: PlayerSourceRecord, value: number, team: FranchiseTeamNeedsSummary, teamPlayers: PlayerSourceRecord[]): FranchiseTradeBlockPlayer["availability"] {
  const sorted = [...teamPlayers].sort((a, b) => playerValue(b) - playerValue(a));
  const rank = sorted.findIndex((candidate) => candidate.id === player.id) + 1;
  if (rank > 0 && rank <= 2 && team.direction !== "sell") return "core";
  if (value < 28 || playerMinutes(player) < 14 || team.direction === "sell") return "available";
  return "listening";
}

function tradeRationale(player: PlayerSourceRecord, team: FranchiseTeamNeedsSummary, availability: FranchiseTradeBlockPlayer["availability"]): string {
  if (availability === "core") return "Core value is high enough to protect unless a major upgrade is available.";
  if (team.direction === "sell") return "Team direction points toward converting veterans or surplus role players into future value.";
  if (playerMinutes(player) < 14) return "Role is small enough to shop without damaging the main rotation.";
  return "Useful player, but movable if the return addresses a higher-priority need.";
}

export function buildTradeBlock(league: LeagueState, options: FranchiseRosterBuildingOptions = {}): FranchiseTradeBlockTeam[] {
  const needsReport = buildTeamNeedsReport(league, options);
  const teamMap = teamRecords(options.teams);
  const maxPlayers = options.maxTradePlayersPerTeam ?? 5;

  return needsReport.teams.map((team) => {
    const sourceTeam = teamMap.get(team.teamId);
    const players = sourceTeam ? playerRecordsFromTeam(sourceTeam) : [];
    const blockPlayers = players
      .map((player) => {
        const value = playerValue(player);
        const availability = availabilityForPlayer(player, value, team, players);
        return {
          playerId: player.id,
          playerName: player.name,
          position: player.position,
          age: player.age,
          market: "trade" as const,
          availability,
          tradeValue: roundTo(value, 0),
          availabilityScore: roundTo(availability === "available" ? 85 - value * 0.35 : availability === "listening" ? 52 - value * 0.12 : 10, 0),
          fitAreas: playerNeedAreas(player),
          rationale: tradeRationale(player, team, availability)
        };
      })
      .sort((a, b) => {
        const availabilityOrder = { available: 0, listening: 1, core: 2 };
        return availabilityOrder[a.availability] - availabilityOrder[b.availability] || b.availabilityScore - a.availabilityScore || b.tradeValue - a.tradeValue;
      });

    return {
      teamId: team.teamId,
      teamName: team.teamName,
      direction: team.direction,
      needs: team.needs,
      availablePlayers: blockPlayers.filter((player) => player.availability !== "core").slice(0, maxPlayers),
      protectedPlayers: blockPlayers.filter((player) => player.availability === "core").slice(0, 3),
      targetArchetypes: draftArchetypes
        .filter((template) => template.areas.some((area) => team.needs.slice(0, 3).some((need) => need.area === area)))
        .slice(0, 3)
        .map((template) => template.archetype),
      summary:
        team.direction === "contend" || team.direction === "buy"
          ? "Prioritize cleaner fits over volume; move only surplus pieces for direct need coverage."
          : team.direction === "sell"
            ? "Convert movable veterans and duplicated roles into younger or more flexible assets."
            : "Keep optionality open while targeting role clarity."
    };
  });
}

export function buildRosterBuildingBoards(league: LeagueState, options: FranchiseRosterBuildingOptions = {}): FranchiseRosterBoards {
  return {
    leagueId: league.id,
    generatedFromGames: completedRegularGames(league).length,
    teamNeeds: buildTeamNeedsReport(league, options),
    draftBoard: buildDraftBoard(league, options),
    freeAgentBoard: buildFreeAgentBoard(league, options),
    tradeBlock: buildTradeBlock(league, options)
  };
}

function rankByMetric(teamMetrics: Array<{ teamId: string; value: number }>, teamId: string, lowerIsBetter = false): number {
  const sorted = [...teamMetrics].sort((a, b) => (lowerIsBetter ? a.value - b.value : b.value - a.value) || a.teamId.localeCompare(b.teamId));
  return sorted.findIndex((row) => row.teamId === teamId) + 1 || sorted.length;
}

function planForTeam(league: LeagueState, teamId: string, options: FranchiseCoachProgressionOptions): TeamGamePlanOptions | undefined {
  return options.plansByLeagueId?.[league.id] ?? league.matchupOptions?.gameplay?.teamPlans?.[teamId];
}

function planTags(plan: TeamGamePlanOptions | undefined): string[] {
  if (!plan) return ["Base plan"];
  const tags: string[] = [];
  if ((plan.threePointEmphasis ?? 0) >= 0.2) tags.push("3P emphasis");
  if ((plan.foulPressure ?? 0) >= 0.2) tags.push("Rim pressure");
  if ((plan.crashBoards ?? 0) >= 0.2) tags.push("Crash glass");
  if ((plan.ballSecurity ?? 0) >= 0.2) tags.push("Ball security");
  if ((plan.usageConcentration ?? 0) >= 0.2) tags.push("Star usage");
  return tags.length ? tags : ["Balanced"];
}

function planFit(plan: TeamGamePlanOptions | undefined, metrics: FranchiseNeedMetricSet, averages: FranchiseNeedMetricSet): number {
  if (!plan) return 58;
  let score = 56;
  if ((plan.threePointEmphasis ?? 0) > 0) score += clamp((metrics.threeAttemptRate - averages.threeAttemptRate) * 110, -10, 14);
  if ((plan.foulPressure ?? 0) > 0) score += clamp((metrics.freeThrowRate - averages.freeThrowRate) * 95, -10, 14);
  if ((plan.crashBoards ?? 0) > 0) score += clamp((metrics.reboundMarginPerGame - averages.reboundMarginPerGame) * 3.5, -10, 14);
  if ((plan.ballSecurity ?? 0) > 0) score += clamp((averages.turnoverPerGame - metrics.turnoverPerGame) * 3, -10, 14);
  if ((plan.usageConcentration ?? 0) > 0) score += metrics.topPlayerLoadShare >= averages.topPlayerLoadShare ? 5 : -4;
  return roundTo(clamp(score, 0, 100), 0);
}

function coachGrade(score: number): FranchiseCoachSeasonSummary["grade"] {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

function coachArchetype(seasons: FranchiseCoachSeasonSummary[]): string {
  const tags = seasons.flatMap((season) => season.planTags);
  const count = (tag: string) => tags.filter((candidate) => candidate === tag).length;
  if (count("3P emphasis") >= 2) return "Spacing architect";
  if (count("Ball security") >= 2) return "Control coach";
  if (count("Crash glass") >= 2) return "Possession hunter";
  if (count("Rim pressure") >= 2) return "Paint-pressure builder";
  if (seasons.some((season) => season.winPct >= 0.62)) return "Win-now steward";
  return "Balanced program builder";
}

function coachBadges(seasons: FranchiseCoachSeasonSummary[]): string[] {
  const badges: string[] = [];
  if (seasons.some((season) => season.winPct >= 0.65)) badges.push("60-win pace");
  if (seasons.some((season) => season.offenseRank <= 3)) badges.push("Top-three offense");
  if (seasons.some((season) => season.defenseRank <= 3)) badges.push("Top-three defense");
  if (seasons.some((season) => season.planFitScore >= 76)) badges.push("Plan translator");
  if (seasons.length >= 3 && seasons[seasons.length - 1].winPct > seasons[0].winPct) badges.push("Program growth");
  return badges.length ? badges : ["Foundation builder"];
}

function coachTrend(seasons: FranchiseCoachSeasonSummary[]): FranchiseCoachProgressionSummary["trend"] {
  if (seasons.length < 2) return "unknown";
  const last = seasons[seasons.length - 1];
  const previous = seasons[seasons.length - 2];
  const delta = last.winPct - previous.winPct + (last.planFitScore - previous.planFitScore) / 250;
  if (delta >= 0.05) return "rising";
  if (delta <= -0.05) return "slipping";
  return "steady";
}

function coachGoals(seasons: FranchiseCoachSeasonSummary[]): string[] {
  const last = seasons[seasons.length - 1];
  if (!last) return ["Establish a plan identity after the first simulated season."];
  const goals: string[] = [];
  if (last.offenseRank > 10) goals.push("Define one reliable half-court advantage source.");
  if (last.defenseRank > 10) goals.push("Tighten defensive identity before adding more offensive complexity.");
  if (last.planFitScore < 62) goals.push("Align game-plan sliders with the roster's strongest statistical edges.");
  if (last.winPct < 0.45) goals.push("Prioritize development minutes and asset flexibility over short-term patches.");
  return goals.length ? goals.slice(0, 3) : ["Preserve the current identity and prepare counters for playoff-style matchups."];
}

export function buildCoachProgressionSummary(
  leagues: readonly LeagueState[],
  teamId: string,
  options: FranchiseCoachProgressionOptions = {}
): FranchiseCoachProgressionSummary {
  const teamMap = teamRecords(options.teams);
  const key = franchiseKey(teamId, teamMap, options.teamKeyById);
  const orderedLeagues = sortedLeagues(leagues);
  const seasons: FranchiseCoachSeasonSummary[] = [];

  for (let index = 0; index < orderedLeagues.length; index += 1) {
    const league = orderedLeagues[index];
    const matchingTeamId = league.teamIds.find((candidate) => franchiseKey(candidate, teamMap, options.teamKeyById) === key);
    if (!matchingTeamId) continue;

    const needsReport = buildTeamNeedsReport(league, { teams: options.teams, teamNames: options.teamNames, teamKeyById: options.teamKeyById });
    const averages = leagueMetricAverages(needsReport.teams.map((team) => team.metrics));
    const teamNeeds = needsReport.teams.find((team) => team.teamId === matchingTeamId);
    const row = standings(league).find((standing) => standing.teamId === matchingTeamId);
    const teamStats = aggregateTeamStats(league, "regular");
    const teamValues = Object.entries(teamStats).map(([candidateTeamId, line]) => ({
      teamId: candidateTeamId,
      offense: rate(stat(line, "PTS"), Math.max(1, line.games)),
      defense: standings(league).find((standing) => standing.teamId === candidateTeamId)?.played
        ? (standings(league).find((standing) => standing.teamId === candidateTeamId)?.pointsAgainst ?? 0) /
          Math.max(1, standings(league).find((standing) => standing.teamId === candidateTeamId)?.played ?? 1)
        : 0
    }));
    const plan = planForTeam(league, matchingTeamId, options);
    const planFitScore = teamNeeds ? planFit(plan, teamNeeds.metrics, averages) : 50;
    const winPct = row?.winPct ?? 0;
    const differential = row?.played ? row.differential / row.played : 0;
    const xp = roundTo((row?.wins ?? 0) * 6 + Math.max(0, differential) * 4 + planFitScore * 0.7 + completedGames(league.games.filter((game) => gameStage(game) !== "regular")).filter((game) => game.result?.winnerTeamId === matchingTeamId).length * 10, 0);
    const numericGrade = clamp(winPct * 62 + planFitScore * 0.28 + clamp(differential, -12, 12) * 1.4 + 18, 0, 100);

    seasons.push({
      leagueId: league.id,
      leagueName: league.name,
      seasonIndex: index,
      teamId: matchingTeamId,
      teamName: teamName(matchingTeamId, teamMap, options.teamNames),
      wins: row?.wins ?? 0,
      losses: row?.losses ?? 0,
      winPct: roundTo(winPct, 3),
      rank: needsReport.teams.find((team) => team.teamId === matchingTeamId)?.rank ?? 0,
      pointDifferentialPerGame: roundTo(differential, 1),
      offenseRank: rankByMetric(teamValues.map((value) => ({ teamId: value.teamId, value: value.offense })), matchingTeamId),
      defenseRank: rankByMetric(teamValues.map((value) => ({ teamId: value.teamId, value: value.defense })), matchingTeamId, true),
      planFitScore,
      xp,
      grade: coachGrade(numericGrade),
      planTags: planTags(plan),
      notes: teamNeeds?.needs.slice(0, 2).map((need) => `${need.label}: ${need.detail}`) ?? []
    });
  }

  const totalXp = sum(seasons.map((season) => season.xp));
  return {
    teamId,
    franchiseKey: key,
    teamName: teamName(teamId, teamMap, options.teamNames),
    seasons,
    totalXp,
    level: Math.max(1, Math.floor(totalXp / 120) + 1),
    archetype: coachArchetype(seasons),
    badges: coachBadges(seasons),
    trend: coachTrend(seasons),
    nextDevelopmentGoals: coachGoals(seasons)
  };
}

function inferGamesPerTeam(league: LeagueState): number {
  const counts = teamGamesPerTeam(league);
  return Math.max(0, ...counts.values());
}

function addYearToIsoDate(date: string | undefined): string {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return "2026-10-20";
  const year = Number(date.slice(0, 4));
  return `${year + 1}${date.slice(4)}`;
}

function inferSeasonStartDate(league: LeagueState): string {
  const firstDatedGame = [...league.games].filter((game) => gameStage(game) === "regular" && game.date).sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))[0];
  return addYearToIsoDate(firstDatedGame?.date ?? league.currentDate);
}

function incrementSeasonName(name: string): string {
  const rangeMatch = name.match(/(\d{4})-(\d{2})/);
  if (rangeMatch) {
    const start = Number(rangeMatch[1]) + 1;
    const end = (Number(rangeMatch[2]) + 1) % 100;
    return name.replace(rangeMatch[0], `${start}-${String(end).padStart(2, "0")}`);
  }
  const yearMatch = name.match(/\b(20\d{2}|19\d{2})\b/);
  if (yearMatch) {
    const nextYear = Number(yearMatch[1]) + 1;
    return name.replace(yearMatch[1], String(nextYear));
  }
  return `${name} Next Season`;
}

function protectedRivalries(league: LeagueState): Array<[string, string]> {
  const pairs = new Map<string, { ids: [string, string]; games: number; closeGames: number; pointDelta: number }>();
  for (const game of completedRegularGames(league)) {
    const ids: [string, string] = [game.awayTeamId, game.homeTeamId].sort() as [string, string];
    const key = ids.join("|");
    const result = game.result;
    if (!result) continue;
    const margin = Math.abs(result.awayScore - result.homeScore);
    const row = pairs.get(key) ?? { ids, games: 0, closeGames: 0, pointDelta: 0 };
    row.games += 1;
    row.closeGames += margin <= 8 ? 1 : 0;
    row.pointDelta += margin;
    pairs.set(key, row);
  }
  return Array.from(pairs.values())
    .sort((a, b) => b.closeGames - a.closeGames || a.pointDelta / Math.max(1, a.games) - b.pointDelta / Math.max(1, b.games) || a.ids.join("|").localeCompare(b.ids.join("|")))
    .slice(0, 6)
    .map((row) => row.ids);
}

export function recommendSeasonCarryover(league: LeagueState, options: FranchiseSeasonCarryoverOptions = {}): FranchiseSeasonCarryoverRecommendation {
  const teamMap = teamRecords(options.teams);
  const contractionIds = new Set(options.contractionTeamIds ?? []);
  const retainedTeamIds = [...(options.retainTeamIds ?? league.teamIds)].filter((teamId) => league.teamIds.includes(teamId) && !contractionIds.has(teamId));
  const expansionTeamIds = [...(options.expansionTeamIds ?? [])].filter((teamId) => !retainedTeamIds.includes(teamId));
  const nextTeamIds = [...retainedTeamIds, ...expansionTeamIds];
  const finalists = playoffFinalists(league);
  const standingsOrder = standings(league).map((row) => row.teamId);
  const historyById = new Map([...(options.history ?? []), league].map((historyLeague) => [historyLeague.id, historyLeague]));
  const continuitySnapshot = buildFranchiseContinuitySnapshot(Array.from(historyById.values()), {
    teams: options.teams,
    teamNames: options.teamNames,
    teamKeyById: options.teamKeyById
  });
  const dynastyLeader = continuitySnapshot.dynastyTable[0];
  const needs = buildTeamNeedsReport(league, {
    teams: options.teams,
    teamNames: options.teamNames,
    teamKeyById: options.teamKeyById,
    maxNeedsPerTeam: 3
  });
  const focusTeamId = options.focusTeamId ?? (league.focusTeamId && nextTeamIds.includes(league.focusTeamId) ? league.focusTeamId : nextTeamIds[0]);
  const setup: SeasonLeagueSetupRecommendation = {
    name: options.nextSeasonName ?? incrementSeasonName(league.name),
    teamIds: nextTeamIds,
    gamesPerTeam: options.gamesPerTeam ?? inferGamesPerTeam(league),
    seasonStartDate: options.nextSeasonStartDate ?? inferSeasonStartDate(league),
    focusTeamId,
    matchupOptions: league.matchupOptions ? { ...league.matchupOptions, gameplay: league.matchupOptions.gameplay ? { ...league.matchupOptions.gameplay } : undefined } : undefined
  };

  const notes: string[] = [];
  if (finalists.championTeamId) notes.push(`Carry over ${teamName(finalists.championTeamId, teamMap, options.teamNames)} as defending champion context.`);
  if (dynastyLeader) notes.push(`${dynastyLeader.displayName} leads the current dynasty table at ${dynastyLeader.dynastyScore} continuity points.`);
  if (expansionTeamIds.length) notes.push("Expansion teams are appended after retained teams; generate their schedules from the returned setup.");
  if (contractionIds.size) notes.push("Contraction teams are excluded from the next setup but the source league remains unchanged.");
  if (!completedRegularGames(league).length) notes.push("Roster hooks are based mostly on source/team-card data because this league has no completed regular-season games.");

  return {
    sourceLeagueId: league.id,
    sourceLeagueName: league.name,
    setup,
    retainedTeamIds,
    expansionTeamIds,
    contractionTeamIds: [...contractionIds],
    protectedRivalries: protectedRivalries(league).filter(([a, b]) => nextTeamIds.includes(a) && nextTeamIds.includes(b)),
    continuity: {
      previousChampionTeamId: finalists.championTeamId,
      previousRunnerUpTeamId: finalists.runnerUpTeamId,
      regularSeasonLeaderTeamId: standingsOrder[0],
      standingsOrder,
      historyLeagueIds: continuitySnapshot.seasons.map((season) => season.leagueId),
      dynastyLeaderFranchiseKey: dynastyLeader?.franchiseKey,
      dynastyLeaderDisplayName: dynastyLeader?.displayName
    },
    rosterHooks: needs.teams
      .filter((team) => nextTeamIds.includes(team.teamId))
      .sort((a, b) => {
        const maxNeedA = a.needs[0]?.score ?? 0;
        const maxNeedB = b.needs[0]?.score ?? 0;
        return maxNeedB - maxNeedA || a.rank - b.rank;
      })
      .slice(0, options.maxRosterHooks ?? 8),
    notes
  };
}
