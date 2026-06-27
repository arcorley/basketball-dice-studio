import {
  ArrowLeftRight,
  BarChart3,
  BookOpen,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  ListFilter,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Search,
  SkipForward,
  Trash2,
  Trophy,
  X
} from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import {
  buildExpectedMatchupLine,
  buildMatchupCard,
  createManualResult,
  defaultMatchupOptions,
  nRange,
  simulateGame,
  simulateTracedGame,
  summarizeSimulations
} from "./lib/diceEngine";
import {
  aggregatePlayerStats,
  aggregateTeamStats,
  clearLeaguePlayoffs,
  createSeasonLeague,
  createTournament,
  markUnplayed,
  nextPlayablePlayoffGame,
  playoffSeriesState,
  renameLeague,
  setLeagueCurrentDate,
  setLeagueFocusTeam,
  setLeagueMatchupOptions,
  setManualLeagueResult,
  setSimulatedLeagueResult,
  simulateLeagueGameWithTeams,
  startLeaguePlayoffs,
  standings,
  syncLeaguePlayoffs
} from "./lib/league";
import { exportGameCardPdf, exportGamePacketPdf, exportPossessionFlowPdf, exportScoresheetsPdf } from "./lib/pdfExport";
import { formatNumber, formatPct, loadDiceTeam, loadSourceCatalog } from "./lib/sourceData";
import { generalDerivationNotes, teamDerivationNotes } from "./lib/teamCards";
import { loadSeasonLeague, loadSeasonLeagueCollection, loadTournament, saveSeasonLeagues, saveTournament, type SeasonLeagueCollectionState } from "./lib/storage";
import type {
  DicePlayerCard,
  DiceTeamCard,
  EraContextMode,
  EraContextOptions,
  GameResult,
  LeagueGame,
  LeaguePlayoffSeed,
  LeaguePlayoffSeries,
  LeagueState,
  MatchupCard,
  MatchupOptions,
  ExpectedMatchupLine,
  PossessionTrace,
  SimulationOptions,
  SimIntensity,
  SourceCatalog,
  SourcePlayer,
  SourceTeamCatalogEntry,
  StatLine,
  TeamGamePlanOptions,
  TracedGameResult
} from "./lib/types";

type Tab = "library" | "matchup" | "sim" | "tournament" | "league";
type PlaySpeed = "manual" | "slow" | "normal" | "fast";
type SimulatorMode = "play" | "simulate";
type SimulationRunMode = "single" | "batch";
type WatchGameView = "game" | "box";
type CompetitionSection = "schedule" | "standings" | "leaders" | "team";
type PostseasonBracketView = "playoffs" | "play-in";
type LeaguePreset = "season" | "franchise-best" | "best-record";
type LeagueStatusFilter = "all" | "unplayed" | "played" | "simulated" | "manual";
type LeagueViewMode = "select" | "create" | "play";
type StandingsView = "overall" | "conference" | "division";
type StandingsConference = "Eastern" | "Western" | "Other";
type StandingsSeedStatus = "playoff" | "play-in" | "outside";
type LeaderTableView = "teams" | "players";
type CardStatsMode = "league" | "source";
type CardStatDisplayMode = "averages" | "totals";
type SortDirection = "asc" | "desc";
type LeaderStatField = "PTS" | "REB" | "AST" | "STL" | "BLK";
type TeamLeaderSortKey = "team" | "games" | LeaderStatField;
type PlayerLeaderSortKey = "player" | "team" | "games" | LeaderStatField;
type ScheduledLeagueGame = LeagueGame & { date: string; sequence: number };
type StandingRow = ReturnType<typeof standings>[number];

const minEraContextSeason = 1990;
const maxEraContextSeason = 2025;

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function eraContextOptionsKey(options: Pick<MatchupOptions, "eraContext">): string {
  const eraContext = options.eraContext;
  if (!eraContext) return "midpoint|0.5|";
  return `${eraContext.mode}|${eraContext.blend ?? ""}|${eraContext.seasonEndYear ?? ""}`;
}

const neutralTeamGamePlan: Required<TeamGamePlanOptions> = {
  usageConcentration: 1,
  playerUsageTargets: {},
  threePointEmphasis: 0,
  foulPressure: 0,
  crashBoards: 0,
  ballSecurity: 0
};

function normalizedTeamGamePlan(plan: TeamGamePlanOptions | undefined): Required<TeamGamePlanOptions> {
  const playerUsageTargets = Object.fromEntries(
    Object.entries(plan?.playerUsageTargets ?? {})
      .filter(([playerId, target]) => playerId && Number.isFinite(target))
      .map(([playerId, target]) => [playerId, clampNumber(target, 0, 0.6)])
  );
  return {
    usageConcentration: clampNumber(plan?.usageConcentration ?? neutralTeamGamePlan.usageConcentration, 0.7, 1.4),
    playerUsageTargets,
    threePointEmphasis: clampNumber(plan?.threePointEmphasis ?? neutralTeamGamePlan.threePointEmphasis, -10, 10),
    foulPressure: clampNumber(plan?.foulPressure ?? neutralTeamGamePlan.foulPressure, -6, 6),
    crashBoards: clampNumber(plan?.crashBoards ?? neutralTeamGamePlan.crashBoards, -6, 6),
    ballSecurity: clampNumber(plan?.ballSecurity ?? neutralTeamGamePlan.ballSecurity, -6, 6)
  };
}

function isNeutralTeamGamePlan(plan: TeamGamePlanOptions | undefined): boolean {
  const normalized = normalizedTeamGamePlan(plan);
  return (
    normalized.usageConcentration === neutralTeamGamePlan.usageConcentration &&
    Object.keys(normalized.playerUsageTargets).length === 0 &&
    normalized.threePointEmphasis === neutralTeamGamePlan.threePointEmphasis &&
    normalized.foulPressure === neutralTeamGamePlan.foulPressure &&
    normalized.crashBoards === neutralTeamGamePlan.crashBoards &&
    normalized.ballSecurity === neutralTeamGamePlan.ballSecurity
  );
}

function teamGamePlanOptionsKey(plan: TeamGamePlanOptions | undefined): string {
  const normalized = normalizedTeamGamePlan(plan);
  const playerUsageTargets = Object.entries(normalized.playerUsageTargets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([playerId, target]) => `${playerId}:${target}`)
    .join(";");
  return [
    normalized.usageConcentration,
    playerUsageTargets,
    normalized.threePointEmphasis,
    normalized.foulPressure,
    normalized.crashBoards,
    normalized.ballSecurity
  ].join(",");
}

function gameplayOptionsKey(options: Pick<MatchupOptions, "gameplay">): string {
  const gameplay = options.gameplay;
  const teamPlans = Object.entries(gameplay?.teamPlans ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([teamId, plan]) => `${teamId}:${teamGamePlanOptionsKey(plan)}`)
    .join(";");
  return [
    gameplay?.tempoMultiplier ?? 1,
    teamGamePlanOptionsKey(gameplay?.away),
    teamGamePlanOptionsKey(gameplay?.home),
    teamPlans
  ].join("|");
}

function matchupOptionsKey(options: MatchupOptions): string {
  return [options.venue, options.intensity, eraContextOptionsKey(options), gameplayOptionsKey(options)].join("||");
}

function defaultLeagueMatchupOptions(league: LeagueState | null | undefined): MatchupOptions {
  return league?.matchupOptions ?? defaultMatchupOptions;
}
type TeamLeaderRow = { teamId: string; line: StatLine & { games: number } };
type PlayerLeaderRow = ReturnType<typeof aggregatePlayerStats>[number];
type SeasonStatLine = StatLine & { games: number };

interface LeagueBatchSimulationRequest {
  label: string;
  games: ScheduledLeagueGame[];
  fromDate?: string;
  throughDate?: string;
  advanceToDate?: string;
  confirmLabel?: string;
  stopBeforeGameId?: string;
  stopBeforeLabel?: string;
}

interface StandingsAlignment {
  conference: StandingsConference;
  division: string;
  conferenceOrder: number;
  divisionOrder: number;
}

interface StandingsGroup {
  label: string;
  rows: StandingRow[];
}

interface LeagueLeaderGroup {
  label: string;
  teamRows: TeamLeaderRow[];
  playerRows: PlayerLeaderRow[];
}

interface StandingsSeed {
  conference: StandingsConference;
  seed: number;
  status: StandingsSeedStatus;
}

interface SortState<Key extends string> {
  key: Key;
  direction: SortDirection;
}

interface ParsedScorecard {
  sourceName: string;
  awayScore?: number;
  homeScore?: number;
  playerInputs: Record<string, Record<string, number>>;
  warnings: string[];
  rowsParsed: number;
  imagePreviewUrl?: string;
}

interface CardOpenerContextValue {
  openTeamCard: (team: DiceTeamCard | string) => void;
  openPlayerCard: (team: DiceTeamCard | string, player: DicePlayerCard | string) => void;
}

interface LeagueCardStatsContextValue {
  leagueId: string;
  leagueName: string;
  teamStats: Record<string, SeasonStatLine>;
  playerStats: Map<string, SeasonStatLine>;
  teamRecords: Map<string, string>;
}

const CardOpenerContext = createContext<CardOpenerContextValue | null>(null);
const LeagueCardStatsContext = createContext<LeagueCardStatsContextValue | null>(null);

function useCardOpener() {
  return useContext(CardOpenerContext);
}

function useLeagueCardStats() {
  return useContext(LeagueCardStatsContext);
}

const statColumns = ["PTS", "REB", "AST", "STL", "BLK", "TOV", "PF"];
const leaderStatFields: LeaderStatField[] = ["PTS", "REB", "AST", "STL", "BLK"];
const boxScoreColumns = [
  "PTS",
  "FG",
  "FG%",
  "3PT",
  "3P%",
  "FT",
  "FT%",
  "OREB",
  "DREB",
  "REB",
  "AST",
  "STL",
  "BLK",
  "TOV",
  "PF"
] as const;
const rotationCardColumns = ["Pos", "Min", "Use %", "TOV", "FD", "3F", "2P", "3P", "FT", "And-1", "ASTw", "REBw"] as const;
const maxLeagueTeams = 32;
const allSeasonsValue = "__all__";
const maxTeamPickerResults = 80;
const maxLibraryResults = 160;
const maxCalendarGamesPerDay = 8;
const allTeamsValue = "__all_teams__";
const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const playSpeedMs: Record<Exclude<PlaySpeed, "manual">, number> = {
  slow: 1600,
  normal: 650,
  fast: 120
};
const sportsReferenceAssetVersion = "202106291";

type VisualTeam = {
  id?: string;
  abbr: string;
  name?: string;
  shortName: string;
  season?: string;
  seasonEndYear?: number;
  source?: {
    seasonEndYear?: number;
  };
};

type SeasonChoice = { season: string; seasonEndYear: number };

function seasonChoicesFor(teams: SourceTeamCatalogEntry[]): SeasonChoice[] {
  return Array.from(new Map(teams.map((team) => [team.season, team.seasonEndYear])))
    .map(([season, seasonEndYear]) => ({ season, seasonEndYear }))
    .sort((a, b) => b.seasonEndYear - a.seasonEndYear);
}

function sortCatalogTeams(teams: SourceTeamCatalogEntry[]): SourceTeamCatalogEntry[] {
  return [...teams].sort(
    (a, b) =>
      b.seasonEndYear - a.seasonEndYear ||
      (b.team.wins ?? 0) - (a.team.wins ?? 0) ||
      a.shortName.localeCompare(b.shortName)
  );
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function teamSearchText(team: SourceTeamCatalogEntry): string {
  return normalizeText(`${team.name} ${team.shortName} ${team.franchise} ${team.abbr} ${team.season}`);
}

function recordLabel(team: SourceTeamCatalogEntry): string {
  return `${team.team.wins ?? "-"}-${team.team.losses ?? "-"}`;
}

function standingsRecordLabel(row?: { wins: number; losses: number; ties?: number }): string {
  if (!row) return "0-0";
  return `${row.wins}-${row.losses}${row.ties ? `-${row.ties}` : ""}`;
}

function filterCatalogTeams(
  teams: SourceTeamCatalogEntry[],
  filters: { season?: string; query?: string; franchise?: string }
): SourceTeamCatalogEntry[] {
  const query = normalizeText(filters.query ?? "");
  const tokens = query ? query.split(" ") : [];
  return sortCatalogTeams(
    teams.filter((team) => {
      if (filters.season && filters.season !== allSeasonsValue && team.season !== filters.season) return false;
      if (filters.franchise && filters.franchise !== allSeasonsValue && team.franchise !== filters.franchise) return false;
      if (!tokens.length) return true;
      const haystack = teamSearchText(team);
      return tokens.every((token) => haystack.includes(token));
    })
  );
}

function franchiseChoicesFor(teams: SourceTeamCatalogEntry[]): string[] {
  return Array.from(new Set(teams.map((team) => team.franchise))).sort((a, b) => a.localeCompare(b));
}

const canonicalFranchiseOverrides: Record<string, string> = {
  "New Jersey Nets": "Brooklyn Nets",
  "Charlotte Bobcats": "Charlotte Hornets",
  "Vancouver Grizzlies": "Memphis Grizzlies",
  "New Orleans Hornets": "New Orleans Pelicans",
  "New Orleans/Oklahoma City Hornets": "New Orleans Pelicans",
  "Seattle SuperSonics": "Oklahoma City Thunder",
  "Washington Bullets": "Washington Wizards"
};

const championsBySeasonEndYear: Record<number, string> = {
  1990: "Detroit Pistons",
  1991: "Chicago Bulls",
  1992: "Chicago Bulls",
  1993: "Chicago Bulls",
  1994: "Houston Rockets",
  1995: "Houston Rockets",
  1996: "Chicago Bulls",
  1997: "Chicago Bulls",
  1998: "Chicago Bulls",
  1999: "San Antonio Spurs",
  2000: "Los Angeles Lakers",
  2001: "Los Angeles Lakers",
  2002: "Los Angeles Lakers",
  2003: "San Antonio Spurs",
  2004: "Detroit Pistons",
  2005: "San Antonio Spurs",
  2006: "Miami Heat",
  2007: "San Antonio Spurs",
  2008: "Boston Celtics",
  2009: "Los Angeles Lakers",
  2010: "Los Angeles Lakers",
  2011: "Dallas Mavericks",
  2012: "Miami Heat",
  2013: "Miami Heat",
  2014: "San Antonio Spurs",
  2015: "Golden State Warriors",
  2016: "Cleveland Cavaliers",
  2017: "Golden State Warriors",
  2018: "Golden State Warriors",
  2019: "Toronto Raptors",
  2020: "Los Angeles Lakers",
  2021: "Milwaukee Bucks",
  2022: "Golden State Warriors",
  2023: "Denver Nuggets",
  2024: "Boston Celtics",
  2025: "Oklahoma City Thunder"
};

function canonicalFranchise(team: SourceTeamCatalogEntry): string {
  return canonicalFranchiseOverrides[team.franchise] ?? team.franchise;
}

function isChampionTeam(team: SourceTeamCatalogEntry): boolean {
  return championsBySeasonEndYear[team.seasonEndYear] === canonicalFranchise(team);
}

function winPctFor(team: SourceTeamCatalogEntry): number {
  const wins = team.team.wins ?? 0;
  const losses = team.team.losses ?? 0;
  const games = wins + losses;
  return games ? wins / games : 0;
}

function compareByRecord(a: SourceTeamCatalogEntry, b: SourceTeamCatalogEntry): number {
  return winPctFor(b) - winPctFor(a) || (b.team.wins ?? 0) - (a.team.wins ?? 0) || b.seasonEndYear - a.seasonEndYear;
}

const standingsConferenceOrder: StandingsConference[] = ["Eastern", "Western", "Other"];
const nbaStandingsGroups = [
  {
    conference: "Eastern",
    division: "Atlantic",
    franchises: ["Boston Celtics", "Brooklyn Nets", "New York Knicks", "Philadelphia 76ers", "Toronto Raptors"]
  },
  {
    conference: "Eastern",
    division: "Central",
    franchises: ["Chicago Bulls", "Cleveland Cavaliers", "Detroit Pistons", "Indiana Pacers", "Milwaukee Bucks"]
  },
  {
    conference: "Eastern",
    division: "Southeast",
    franchises: ["Atlanta Hawks", "Charlotte Hornets", "Miami Heat", "Orlando Magic", "Washington Wizards"]
  },
  {
    conference: "Western",
    division: "Northwest",
    franchises: ["Denver Nuggets", "Minnesota Timberwolves", "Oklahoma City Thunder", "Portland Trail Blazers", "Utah Jazz"]
  },
  {
    conference: "Western",
    division: "Pacific",
    franchises: ["Golden State Warriors", "Los Angeles Clippers", "Los Angeles Lakers", "Phoenix Suns", "Sacramento Kings"]
  },
  {
    conference: "Western",
    division: "Southwest",
    franchises: ["Dallas Mavericks", "Houston Rockets", "Memphis Grizzlies", "New Orleans Pelicans", "San Antonio Spurs"]
  }
] as const;
const standingsDivisionOrder = [...nbaStandingsGroups.map((group) => group.division), "Other"];
const unalignedStandings: StandingsAlignment = {
  conference: "Other",
  division: "Other",
  conferenceOrder: standingsConferenceOrder.indexOf("Other"),
  divisionOrder: standingsDivisionOrder.indexOf("Other")
};
const standingsAlignmentByFranchise = new Map<string, StandingsAlignment>(
  nbaStandingsGroups.flatMap((group, divisionOrder) => {
    const conference = group.conference as StandingsConference;
    const conferenceOrder = standingsConferenceOrder.indexOf(conference);
    return group.franchises.map((franchise) => [
      franchise,
      {
        conference,
        division: group.division,
        conferenceOrder,
        divisionOrder
      }
    ]);
  })
);

function standingsAlignmentForTeam(team?: SourceTeamCatalogEntry): StandingsAlignment {
  if (!team) return unalignedStandings;
  return standingsAlignmentByFranchise.get(canonicalFranchise(team)) ?? unalignedStandings;
}

function groupedRows<T>(rows: T[], labelForRow: (row: T) => string, orderedLabels: string[]): Array<{ label: string; rows: T[] }> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const label = labelForRow(row);
    grouped.set(label, [...(grouped.get(label) ?? []), row]);
  }

  const labels = [
    ...orderedLabels.filter((label) => grouped.has(label)),
    ...Array.from(grouped.keys())
      .filter((label) => !orderedLabels.includes(label))
      .sort((a, b) => a.localeCompare(b))
  ];

  return labels.map((label) => ({ label, rows: grouped.get(label) ?? [] })).filter((group) => group.rows.length);
}

function groupedStandingsRows(rows: StandingRow[], labelForRow: (row: StandingRow) => string, orderedLabels: string[]): StandingsGroup[] {
  return groupedRows(rows, labelForRow, orderedLabels);
}

function labelForTeamGrouping(teamId: string, view: StandingsView, sourceTeamsById: Map<string, SourceTeamCatalogEntry>): string {
  if (view === "overall") return "Overall";
  const alignment = standingsAlignmentForTeam(sourceTeamsById.get(teamId));
  return view === "conference" ? alignment.conference : alignment.division;
}

function leagueLeaderGroups(
  view: StandingsView,
  teamRows: TeamLeaderRow[],
  playerRows: PlayerLeaderRow[],
  sourceTeamsById: Map<string, SourceTeamCatalogEntry>
): LeagueLeaderGroup[] {
  const orderedLabels = view === "overall" ? ["Overall"] : view === "conference" ? standingsConferenceOrder : standingsDivisionOrder;
  const groupedTeams = groupedRows(teamRows, (row) => labelForTeamGrouping(row.teamId, view, sourceTeamsById), orderedLabels);
  const groupedPlayers = groupedRows(playerRows, (row) => labelForTeamGrouping(row.teamId, view, sourceTeamsById), orderedLabels);
  const labels = [
    ...orderedLabels.filter((label) => groupedTeams.some((group) => group.label === label) || groupedPlayers.some((group) => group.label === label)),
    ...Array.from(new Set([...groupedTeams.map((group) => group.label), ...groupedPlayers.map((group) => group.label)]))
      .filter((label) => !orderedLabels.includes(label))
      .sort((a, b) => a.localeCompare(b))
  ];

  return labels.map((label) => ({
    label,
    teamRows: groupedTeams.find((group) => group.label === label)?.rows ?? [],
    playerRows: groupedPlayers.find((group) => group.label === label)?.rows ?? []
  }));
}

function nextSortState<Key extends string>(current: SortState<Key>, key: Key, defaultDirection: SortDirection): SortState<Key> {
  if (current.key !== key) return { key, direction: defaultDirection };
  return { key, direction: current.direction === "desc" ? "asc" : "desc" };
}

function compareLeaderValues(a: string | number, b: string | number, direction: SortDirection): number {
  const order = direction === "asc" ? 1 : -1;
  if (typeof a === "string" || typeof b === "string") {
    return String(a).localeCompare(String(b)) * order;
  }
  return (a - b) * order;
}

function teamLeaderSortValue(row: TeamLeaderRow, key: TeamLeaderSortKey, teamNames: Map<string, string>): string | number {
  if (key === "team") return teamLabel(teamNames, row.teamId);
  if (key === "games") return row.line.games;
  return (row.line[key] ?? 0) / Math.max(1, row.line.games);
}

function playerLeaderSortValue(row: PlayerLeaderRow, key: PlayerLeaderSortKey, teamNames: Map<string, string>): string | number {
  if (key === "player") return row.player;
  if (key === "team") return teamLabel(teamNames, row.teamId);
  if (key === "games") return row.games;
  return row.perGame[key] ?? 0;
}

function sortTeamLeaderRows(rows: TeamLeaderRow[], sort: SortState<TeamLeaderSortKey>, teamNames: Map<string, string>): TeamLeaderRow[] {
  return [...rows].sort((a, b) => {
    const valueCompare = compareLeaderValues(teamLeaderSortValue(a, sort.key, teamNames), teamLeaderSortValue(b, sort.key, teamNames), sort.direction);
    return valueCompare || teamLabel(teamNames, a.teamId).localeCompare(teamLabel(teamNames, b.teamId));
  });
}

function sortPlayerLeaderRows(rows: PlayerLeaderRow[], sort: SortState<PlayerLeaderSortKey>, teamNames: Map<string, string>): PlayerLeaderRow[] {
  return [...rows].sort((a, b) => {
    const valueCompare = compareLeaderValues(playerLeaderSortValue(a, sort.key, teamNames), playerLeaderSortValue(b, sort.key, teamNames), sort.direction);
    return valueCompare || a.player.localeCompare(b.player) || teamLabel(teamNames, a.teamId).localeCompare(teamLabel(teamNames, b.teamId));
  });
}

function playoffSeedStatus(seed: number): StandingsSeedStatus {
  if (seed <= 6) return "playoff";
  if (seed <= 10) return "play-in";
  return "outside";
}

function conferenceSeedMap(rows: StandingRow[], sourceTeamsById: Map<string, SourceTeamCatalogEntry>): Map<string, StandingsSeed> {
  const seedMap = new Map<string, StandingsSeed>();
  const conferenceGroups = groupedStandingsRows(
    rows,
    (row) => standingsAlignmentForTeam(sourceTeamsById.get(row.teamId)).conference,
    standingsConferenceOrder
  );

  for (const group of conferenceGroups) {
    if (group.label === "Other") continue;
    const conference = group.label as StandingsConference;
    group.rows.forEach((row, index) => {
      const seed = index + 1;
      seedMap.set(row.teamId, {
        conference,
        seed,
        status: playoffSeedStatus(seed)
      });
    });
  }
  return seedMap;
}

function playoffSeedsForLeague(league: LeagueState, sourceTeamsById: Map<string, SourceTeamCatalogEntry>): LeaguePlayoffSeed[] {
  const rows = standings(league);
  return groupedStandingsRows(
    rows,
    (row) => standingsAlignmentForTeam(sourceTeamsById.get(row.teamId)).conference,
    standingsConferenceOrder
  )
    .filter((group) => group.label !== "Other")
    .flatMap((group) =>
      group.rows.slice(0, 10).map((row, index) => ({
        teamId: row.teamId,
        conference: group.label,
        seed: index + 1
      }))
    );
}

function seasonRoster(teams: SourceTeamCatalogEntry[], season: string): SourceTeamCatalogEntry[] {
  return teams
    .filter((team) => team.season === season)
    .sort((a, b) => canonicalFranchise(a).localeCompare(canonicalFranchise(b)) || a.shortName.localeCompare(b.shortName));
}

function bestByCanonicalFranchise(teams: SourceTeamCatalogEntry[], championshipFirst: boolean): SourceTeamCatalogEntry[] {
  const grouped = new Map<string, SourceTeamCatalogEntry[]>();
  for (const team of teams) {
    const key = canonicalFranchise(team);
    grouped.set(key, [...(grouped.get(key) ?? []), team]);
  }

  return Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, group]) =>
      [...group].sort((a, b) => {
        if (championshipFirst) {
          const titleDelta = Number(isChampionTeam(b)) - Number(isChampionTeam(a));
          if (titleDelta !== 0) return titleDelta;
        }
        return compareByRecord(a, b);
      })[0]
    )
    .filter((team): team is SourceTeamCatalogEntry => Boolean(team));
}

function addDaysIso(date: string, days: number): string {
  const nextDate = new Date(`${date}T00:00:00.000Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return nextDate.toISOString().slice(0, 10);
}

function normalizedDateRange(startDate: string, endDate: string): [string, string] {
  if (!startDate && !endDate) return ["", ""];
  const start = startDate || endDate;
  const end = endDate || startDate;
  return start <= end ? [start, end] : [end, start];
}

function startOfCalendarWeekIso(date: string): string {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return addDaysIso(date, -day);
}

function endOfCalendarWeekIso(date: string): string {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return addDaysIso(date, 6 - day);
}

function datesBetweenInclusive(startDate: string, endDate: string): string[] {
  if (!startDate || !endDate) return [];
  const dates: string[] = [];
  let current = startDate;
  let guard = 0;
  while (current <= endDate && guard < 400) {
    dates.push(current);
    current = addDaysIso(current, 1);
    guard += 1;
  }
  return dates;
}

function calendarGridDates(startDate: string, endDate: string): string[] {
  if (!startDate || !endDate) return [];
  return datesBetweenInclusive(startDate, endDate);
}

function seasonStartDateForTeams(teams: SourceTeamCatalogEntry[]): string {
  const years = new Set(teams.map((team) => team.seasonEndYear));
  if (years.size === 1) {
    const [seasonEndYear] = Array.from(years);
    return `${seasonEndYear - 1}-10-21`;
  }
  return "2025-10-21";
}

function scheduledDateForGame(game: LeagueGame, index: number): string {
  return game.date ?? addDaysIso("2025-10-21", Math.floor(index / 8));
}

function scheduleLeagueGames(league: Pick<LeagueState, "games"> | null | undefined): ScheduledLeagueGame[] {
  return (league?.games ?? [])
    .map((game, index) => ({
      ...game,
      date: scheduledDateForGame(game, index),
      sequence: game.sequence ?? index + 1
    }))
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || (a.sequence ?? 0) - (b.sequence ?? 0));
}

function isPostseasonGame(game: Pick<LeagueGame, "stage">): boolean {
  return game.stage === "play-in" || game.stage === "playoffs";
}

function isRegularSeasonGame(game: Pick<LeagueGame, "stage">): boolean {
  return !isPostseasonGame(game);
}

function leagueGameMatchupOptions(game: Pick<LeagueGame, "stage">, league?: LeagueState | null): MatchupOptions {
  const base = defaultLeagueMatchupOptions(league);
  return isPostseasonGame(game) ? { ...base, venue: "home-court", intensity: "playoff" } : base;
}

function addMonthsIso(date: string, months: number): string {
  if (!date) return "";
  const source = new Date(`${date}T00:00:00.000Z`);
  const dayOfMonth = source.getUTCDate();
  const target = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + months, 1));
  const lastDayOfTargetMonth = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(dayOfMonth, lastDayOfTargetMonth));
  return target.toISOString().slice(0, 10);
}

function leagueCurrentDate(league: LeagueState, games: ScheduledLeagueGame[]): string {
  return league.currentDate ?? games.find((game) => game.status === "unplayed")?.date ?? games[0]?.date ?? "";
}

function nextLeagueMorning(date: string): string {
  return date ? addDaysIso(date, 1) : "";
}

function nextUnplayedLeagueGame(games: ScheduledLeagueGame[], currentDate = "", teamId?: string): ScheduledLeagueGame | null {
  const isMatch = (game: ScheduledLeagueGame) => {
    if (game.status !== "unplayed") return false;
    return !teamId || game.awayTeamId === teamId || game.homeTeamId === teamId;
  };
  return games.find((game) => isMatch(game) && (!currentDate || game.date >= currentDate)) ?? games.find(isMatch) ?? null;
}

function formatIsoDate(date: string): string {
  if (!date) return "-";
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  });
}

function formatCalendarDay(date: string): string {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  });
}

function formatLeagueClock(date: string): string {
  return date ? `${formatIsoDate(date)} · 9:00 AM` : "-";
}

function scheduleRangeLabel(games: ScheduledLeagueGame[]): string {
  const firstDate = games[0]?.date ?? "";
  const lastDate = games[games.length - 1]?.date ?? "";
  if (!firstDate) return "No scheduled dates";
  if (firstDate === lastDate) return formatIsoDate(firstDate);
  return `${formatIsoDate(firstDate)} to ${formatIsoDate(lastDate)}`;
}

function leagueStatusFilterLabel(status: LeagueStatusFilter): string {
  if (status === "all") return "All statuses";
  if (status === "played") return "Played";
  if (status === "simulated") return "Simulated";
  if (status === "manual") return "Manual";
  return "Unplayed";
}

function leagueGameLabel(game: LeagueGame, teamNames: Map<string, string>): string {
  return `${teamLabel(teamNames, game.awayTeamId)} at ${teamLabel(teamNames, game.homeTeamId)}`;
}

function shortSeasonLabel(season: string | undefined): string {
  const match = season?.match(/^(\d{4})-(\d{2})$/);
  return match ? `${match[1].slice(2)}-${match[2]}` : (season ?? "");
}

function calendarTeamCode(team: SourceTeamCatalogEntry | undefined, teamNames: Map<string, string>, teamId: string): string {
  if (!team) return teamLabel(teamNames, teamId);
  const season = shortSeasonLabel(team.season);
  return season ? `${season} ${team.abbr}` : team.abbr;
}

function bracketTeamDisplay(team: SourceTeamCatalogEntry | undefined, teamNames: Map<string, string>, teamId: string): { primary: string; secondary?: string; compact: string; full: string } {
  const fallback = teamLabel(teamNames, teamId);
  if (!team) return { primary: fallback, compact: fallback, full: fallback };

  const seasonPrefix = `${team.season} `;
  const primary = team.shortName.startsWith(seasonPrefix) ? team.shortName.slice(seasonPrefix.length) : team.shortName;
  const season = shortSeasonLabel(team.season);
  const secondary = [season, team.abbr].filter(Boolean).join(" ");
  return {
    primary: primary || team.abbr || fallback,
    secondary: secondary || undefined,
    compact: secondary || primary || fallback,
    full: team.shortName || fallback
  };
}

function opponentTeamId(game: Pick<LeagueGame, "awayTeamId" | "homeTeamId">, teamId: string): string {
  return game.awayTeamId === teamId ? game.homeTeamId : game.awayTeamId;
}

function teamGameScore(game: LeagueGame, teamId: string): number | undefined {
  if (!game.result) return undefined;
  if (game.awayTeamId === teamId) return game.result.awayScore;
  if (game.homeTeamId === teamId) return game.result.homeScore;
  return undefined;
}

function teamGameResultLabel(game: LeagueGame, teamId: string): string {
  if (!game.result) return "Unplayed";
  const teamScoreValue = teamGameScore(game, teamId);
  const opponentScoreValue = teamGameScore(game, opponentTeamId(game, teamId));
  const outcome = game.result.winnerTeamId === teamId ? "W" : game.result.winnerTeamId === "tie" ? "T" : "L";
  return `${outcome} ${teamScoreValue ?? "-"}-${opponentScoreValue ?? "-"}`;
}

function teamLabel(teamNames: Map<string, string>, teamId: string): string {
  return teamNames.get(teamId) ?? teamId;
}

function round(value: number | undefined, digits = 1): string {
  if (value === undefined || Number.isNaN(value)) return "-";
  return value.toFixed(digits);
}

function pct(num: number, den: number): string {
  return den ? `${((num / den) * 100).toFixed(1)}%` : "-";
}

function stat(line: StatLine | undefined, field: string): number {
  if (field === "REB") {
    return Math.max(line?.REB ?? 0, (line?.OREB ?? 0) + (line?.DREB ?? 0));
  }
  return line?.[field] ?? 0;
}

function statPair(line: StatLine | undefined, madeField: string, attemptField: string): string {
  return `${stat(line, madeField)}-${stat(line, attemptField)}`;
}

function statPercent(line: StatLine | undefined, madeField: string, attemptField: string): string {
  return pct(stat(line, madeField), stat(line, attemptField));
}

function sourceValue(value: number | null | undefined): number {
  return value ?? 0;
}

function teamSourceSeasonLine(team: DiceTeamCard): SeasonStatLine {
  const totals = team.source.team.totals;
  const games = sourceValue(team.source.team.wins) + sourceValue(team.source.team.losses);
  return {
    games,
    FGM: sourceValue(totals.fg),
    FGA: sourceValue(totals.fga),
    "3PM": sourceValue(totals.fg3),
    "3PA": sourceValue(totals.fg3a),
    FTM: sourceValue(totals.ft),
    FTA: sourceValue(totals.fta),
    OREB: sourceValue(totals.orb),
    DREB: sourceValue(totals.drb),
    REB: sourceValue(totals.trb),
    AST: sourceValue(totals.ast),
    STL: sourceValue(totals.stl),
    BLK: sourceValue(totals.blk),
    TOV: sourceValue(totals.tov),
    PF: sourceValue(totals.pf),
    PTS: sourceValue(totals.pts)
  };
}

function playerSourceSeasonLine(player: DicePlayerCard): SeasonStatLine {
  const totals = player.source.totals;
  return {
    games: sourceValue(player.source.games),
    FGM: sourceValue(totals.fg),
    FGA: sourceValue(totals.fga),
    "3PM": sourceValue(totals.fg3),
    "3PA": sourceValue(totals.fg3a),
    FTM: sourceValue(totals.ft),
    FTA: sourceValue(totals.fta),
    OREB: sourceValue(totals.orb),
    DREB: sourceValue(totals.drb),
    REB: sourceValue(totals.trb),
    AST: sourceValue(totals.ast),
    STL: sourceValue(totals.stl),
    BLK: sourceValue(totals.blk),
    TOV: sourceValue(totals.tov),
    PF: sourceValue(totals.pf),
    PTS: sourceValue(totals.pts)
  };
}

function emptySeasonLine(): SeasonStatLine {
  return { games: 0 };
}

function seasonLineValue(line: SeasonStatLine | undefined, field: string): number | undefined {
  if (!line) return undefined;
  if (field === "REB" && line.REB === undefined && (line.OREB !== undefined || line.DREB !== undefined)) {
    return (line.OREB ?? 0) + (line.DREB ?? 0);
  }
  return line[field];
}

function seasonLineTotal(line: SeasonStatLine | undefined, field: string): string {
  const value = seasonLineValue(line, field);
  if (value === undefined || Number.isNaN(value)) return "-";
  return Math.round(value).toLocaleString();
}

function seasonLinePct(line: SeasonStatLine | undefined, madeField: string, attemptField: string): string {
  return pct(stat(line, madeField), stat(line, attemptField));
}

function seasonLinePerGame(line: SeasonStatLine | undefined, field: string, digits = 1): string {
  if (!line?.games) return "-";
  return formatNumber((seasonLineValue(line, field) ?? 0) / line.games, digits);
}

function seasonCountMetric(line: SeasonStatLine | undefined, label: string, field: string, displayMode: CardStatDisplayMode): { label: string; value: string; sub?: string } {
  const total = seasonLineTotal(line, field);
  const average = seasonLinePerGame(line, field);
  if (displayMode === "totals") {
    return { label, value: total, sub: average !== "-" ? `${average} /G` : undefined };
  }
  return { label, value: average, sub: total !== "-" ? `${total} total` : undefined };
}

function playerStatsKey(teamId: string, player: string): string {
  return `${teamId}:${player}`;
}

function modifier(value: number | undefined, digits = 2): string {
  if (value === undefined || Number.isNaN(value)) return "-";
  return value.toFixed(digits);
}

function initialsFor(value: string): string {
  const parts = value
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts.at(-1)?.[0] ?? ""}`.toUpperCase();
}

function teamLogoUrl(team: VisualTeam): string | null {
  const seasonEndYear = team.seasonEndYear ?? team.source?.seasonEndYear;
  if (!team.abbr || !seasonEndYear) return null;
  return `https://cdn.ssref.net/req/${sportsReferenceAssetVersion}/tlogo/bbr/${team.abbr}-${seasonEndYear}.png`;
}

function playerSourceId(player: SourcePlayer): string | null {
  if (player.sourceId) return player.sourceId;
  const match = player.sourceUrl?.match(/\/players\/[a-z]\/([a-z0-9]+)\.html$/i);
  return match?.[1] ?? null;
}

function playerPhotoUrl(player: DicePlayerCard): string | null {
  const sourceId = playerSourceId(player.source);
  return sourceId ? `https://www.basketball-reference.com/req/${sportsReferenceAssetVersion}/images/headshots/${sourceId}.jpg` : null;
}

function shotAdjustmentLabel(value: number): string {
  const rounded = Math.abs(value).toFixed(1);
  return value >= 0 ? `-${rounded}` : `+${rounded}`;
}

function signedLabel(value: number, digits = 1): string {
  const rounded = Math.abs(value).toFixed(digits);
  return value >= 0 ? `+${rounded}` : `-${rounded}`;
}

function signedPoints(value: number): string {
  return value === 0 ? "0" : signedLabel(value, 0);
}

function basePlayerUseWeight(player: DicePlayerCard, intensity: SimIntensity): number {
  return intensity === "playoff" ? player.playoffUseWeight : player.useWeight;
}

function basePlayerUsageShare(team: DiceTeamCard, player: DicePlayerCard, intensity: SimIntensity): number {
  const total = team.players.reduce((sum, teammate) => sum + basePlayerUseWeight(teammate, intensity), 0);
  return total > 0 ? basePlayerUseWeight(player, intensity) / total : 0;
}

function playerUsageTargetPct(plan: Required<TeamGamePlanOptions>, team: DiceTeamCard, player: DicePlayerCard, intensity: SimIntensity): number {
  const target = plan.playerUsageTargets[player.id] ?? basePlayerUsageShare(team, player, intensity);
  return Math.round(clampNumber(target, 0, 0.6) * 1000) / 10;
}

function shotProfileLabel(row: MatchupCard["awayPlayerRanges"][number]): string {
  if (row.shotProfileMethod === "sourced-location") return "SRC";
  if (row.shotProfileMethod === "same-player-neighbor-proxy") return "PLY-PXY";
  if (row.shotProfileMethod === "era-role-neighbor-proxy") return "ROLE-PXY";
  return "MANUAL";
}

function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode; variant?: "primary" | "subtle" | "danger" }) {
  const { icon, children, variant = "subtle", className = "", ...rest } = props;
  return (
    <button type="button" className={`btn ${variant} ${className}`} {...rest}>
      {icon}
      <span>{children}</span>
    </button>
  );
}

function ImageFallback({
  src,
  alt,
  className,
  fallback,
  loading = "lazy",
  title
}: {
  src: string | null;
  alt: string;
  className: string;
  fallback: string;
  loading?: "eager" | "lazy";
  title?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const activeSrc = src && failedSrc !== src ? src : null;
  return (
    <span className={`${className} visual-fallback`} title={title ?? alt} aria-label={alt}>
      {activeSrc ? (
        <img
          src={activeSrc}
          alt={alt}
          loading={loading}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedSrc(activeSrc)}
        />
      ) : (
        <span className="visual-fallback-text" aria-hidden="true">
          {fallback}
        </span>
      )}
    </span>
  );
}

function TeamLogo({ team, className = "" }: { team: VisualTeam; className?: string }) {
  return <ImageFallback src={teamLogoUrl(team)} alt={`${team.shortName} logo`} className={`team-logo ${className}`.trim()} fallback={team.abbr} />;
}

function PlayerPhoto({ player, className = "", loading }: { player: DicePlayerCard; className?: string; loading?: "eager" | "lazy" }) {
  return <ImageFallback src={playerPhotoUrl(player)} alt={`${player.name} headshot`} className={`player-photo ${className}`.trim()} fallback={initialsFor(player.name)} loading={loading} />;
}

function PlayerIdentity({ player, name = player?.name, onSelect }: { player?: DicePlayerCard; name?: string; onSelect?: (player: DicePlayerCard) => void }) {
  const cardOpener = useCardOpener();
  if (!player) {
    return <span className="player-table-name">{name}</span>;
  }
  const handleSelect = onSelect ?? (cardOpener ? (selectedPlayer: DicePlayerCard) => cardOpener.openPlayerCard(selectedPlayer.teamId, selectedPlayer) : undefined);
  const content = (
    <span className="player-table-identity">
      <PlayerPhoto player={player} className="player-photo-mini" />
      <span>
        <strong>{player.name}</strong>
        <small>
          {player.source.roster.number ? `#${player.source.roster.number} · ` : ""}
          {player.position}
        </small>
      </span>
    </span>
  );
  if (!handleSelect) return content;
  return (
    <button type="button" className="player-identity-button" onClick={() => handleSelect(player)}>
      {content}
    </button>
  );
}

function TeamIdentityButton({
  team,
  teamId,
  label,
  teamNames,
  className = "standings-team",
  logoClassName = "standings-team-logo"
}: {
  team?: VisualTeam;
  teamId?: string;
  label?: string;
  teamNames?: Map<string, string>;
  className?: string;
  logoClassName?: string;
}) {
  const cardOpener = useCardOpener();
  const resolvedTeamId = team?.id ?? teamId;
  const displayName = label ?? (resolvedTeamId && teamNames ? teamLabel(teamNames, resolvedTeamId) : team?.shortName ?? resolvedTeamId ?? "Team");
  const content = (
    <>
      {team ? <TeamLogo team={team} className={logoClassName} /> : <span className="standings-logo-placeholder" aria-hidden="true" />}
      <span className="standings-team-name">
        <strong>{displayName}</strong>
      </span>
    </>
  );

  if (!resolvedTeamId || !cardOpener) {
    return <span className={className}>{content}</span>;
  }

  return (
    <button type="button" className={`team-identity-button ${className}`} onClick={() => cardOpener.openTeamCard(resolvedTeamId)}>
      {content}
    </button>
  );
}

function TeamTextButton({ team, teamId, teamNames, label }: { team?: DiceTeamCard; teamId?: string; teamNames?: Map<string, string>; label?: string }) {
  const cardOpener = useCardOpener();
  const resolvedTeamId = team?.id ?? teamId;
  const displayName = label ?? team?.shortName ?? (resolvedTeamId && teamNames ? teamLabel(teamNames, resolvedTeamId) : resolvedTeamId ?? "Team");
  if (!cardOpener || (!team && !resolvedTeamId)) return <span>{displayName}</span>;
  return (
    <button type="button" className="team-text-button" onClick={() => (team ? cardOpener.openTeamCard(team) : resolvedTeamId && cardOpener.openTeamCard(resolvedTeamId))}>
      {displayName}
    </button>
  );
}

function PlayerNameButton({ teamId, player, className = "player-name-button" }: { teamId: string; player: string; className?: string }) {
  const cardOpener = useCardOpener();
  if (!cardOpener) return <span className={className}>{player}</span>;
  return (
    <button type="button" className={className} onClick={() => cardOpener.openPlayerCard(teamId, player)}>
      {player}
    </button>
  );
}

function App() {
  const [catalog, setCatalog] = useState<SourceCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadSourceCatalog()
      .then((nextCatalog) => {
        if (active) setCatalog(nextCatalog);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      active = false;
    };
  }, []);

  if (error) {
    return <StartupPanel title="Data Load Failed" message={error} />;
  }

  if (!catalog) {
    return <StartupPanel title="Loading Data" message="Loading local catalog." />;
  }

  return <StudioApp catalog={catalog} />;
}

function StartupPanel({ title, message }: { title: string; message: string }) {
  return (
    <div className="app screen-only">
      <main className="workspace">
        <article className="panel">
          <h2>{title}</h2>
          <p>{message}</p>
        </article>
      </main>
    </div>
  );
}

function StudioApp({ catalog }: { catalog: SourceCatalog }) {
  const sourceTeams = catalog.teams;
  const seasonChoices = useMemo(() => seasonChoicesFor(sourceTeams), [sourceTeams]);
  const defaultSeason = seasonChoices[0]?.season ?? sourceTeams[0].season;
  const teamNames = useMemo(() => new Map(sourceTeams.map((team) => [team.id, team.shortName])), [sourceTeams]);
  const defaultTeams = filterCatalogTeams(sourceTeams, { season: defaultSeason });
  const defaultAwayId = defaultTeams[0]?.id ?? sourceTeams[0].id;
  const defaultHomeId = defaultTeams[1]?.id ?? sourceTeams[0].id;
  const [tab, setTab] = useState<Tab>("library");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [awayId, setAwayId] = useState(defaultAwayId);
  const [homeId, setHomeId] = useState(defaultHomeId);
  const [selectedTeamId, setSelectedTeamId] = useState(defaultAwayId);
  const [tournament, setTournamentState] = useState<LeagueState | null>(null);
  const [seasonLeagueCollection, setSeasonLeagueCollectionState] = useState<SeasonLeagueCollectionState>({ leagues: [], activeLeagueId: null });
  const [seasonLeagueStorageReady, setSeasonLeagueStorageReady] = useState(false);
  const [seasonLeagueDirtyRevision, setSeasonLeagueDirtyRevision] = useState(0);
  const [teamCards, setTeamCards] = useState<Partial<Record<string, DiceTeamCard>>>({});
  const [teamLoadError, setTeamLoadError] = useState<string | null>(null);
  const [matchupOptions, setMatchupOptions] = useState<MatchupOptions>(defaultMatchupOptions);
  const [appStateLoading, setAppStateLoading] = useState(true);
  const [appStateError, setAppStateError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setAppStateLoading(true);
    setAppStateError(null);
    setSeasonLeagueStorageReady(false);
    Promise.all([loadTournament(), loadSeasonLeagueCollection(), loadSeasonLeague()])
      .then(([savedTournament, savedSeasonLeagueCollection, legacySeasonLeague]) => {
        if (!active) return;
        setTournamentState(savedTournament);
        const { collection: savedSeasonLeagues, hasStoredCollection } = savedSeasonLeagueCollection;
        const leagues = [...savedSeasonLeagues.leagues];
        if (!hasStoredCollection && legacySeasonLeague && !leagues.some((league) => league.id === legacySeasonLeague.id)) {
          leagues.unshift(legacySeasonLeague);
        }
        const activeLeagueId =
          (savedSeasonLeagues.activeLeagueId && leagues.some((league) => league.id === savedSeasonLeagues.activeLeagueId) && savedSeasonLeagues.activeLeagueId) ||
          (!hasStoredCollection && legacySeasonLeague?.id) ||
          leagues[0]?.id ||
          null;
        setSeasonLeagueCollectionState({ leagues, activeLeagueId });
        setSeasonLeagueDirtyRevision(!hasStoredCollection && legacySeasonLeague ? 1 : 0);
        setSeasonLeagueStorageReady(true);
      })
      .catch((reason: unknown) => {
        if (active) setAppStateError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setAppStateLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!seasonLeagueStorageReady || seasonLeagueDirtyRevision === 0) return;
    setAppStateError(null);
    void saveSeasonLeagues(seasonLeagueCollection).catch((reason: unknown) => {
      setAppStateError(reason instanceof Error ? reason.message : String(reason));
    });
  }, [seasonLeagueCollection, seasonLeagueDirtyRevision, seasonLeagueStorageReady]);

  const setTournament = useCallback((next: LeagueState | null) => {
    setTournamentState(next);
    setAppStateError(null);
    void saveTournament(next).catch((reason: unknown) => {
      setAppStateError(reason instanceof Error ? reason.message : String(reason));
    });
  }, []);

  const setActiveSeasonLeagueId = useCallback((leagueId: string) => {
    setSeasonLeagueCollectionState((current) => ({
      ...current,
      activeLeagueId: current.leagues.some((league) => league.id === leagueId) ? leagueId : current.activeLeagueId
    }));
    setSeasonLeagueDirtyRevision((current) => current + 1);
  }, []);

  const upsertSeasonLeague = useCallback((next: LeagueState) => {
    setSeasonLeagueCollectionState((current) => {
      const exists = current.leagues.some((league) => league.id === next.id);
      return {
        leagues: exists ? current.leagues.map((league) => (league.id === next.id ? next : league)) : [next, ...current.leagues],
        activeLeagueId: exists ? current.activeLeagueId ?? next.id : next.id
      };
    });
    setSeasonLeagueDirtyRevision((current) => current + 1);
  }, []);

  const deleteSeasonLeague = useCallback((leagueId: string) => {
    setSeasonLeagueCollectionState((current) => {
      const leagues = current.leagues.filter((league) => league.id !== leagueId);
      return {
        leagues,
        activeLeagueId: current.activeLeagueId === leagueId ? leagues[0]?.id ?? null : current.activeLeagueId
      };
    });
    setSeasonLeagueDirtyRevision((current) => current + 1);
  }, []);

  const loadTeam = useCallback(
    async (teamId: string) => {
      const team = await loadDiceTeam(teamId, catalog.leagues);
      setTeamCards((current) => (current[teamId] ? current : { ...current, [teamId]: team }));
      return team;
    },
    [catalog.leagues]
  );

  useEffect(() => {
    let active = true;
    setTeamLoadError(null);
    Promise.all(Array.from(new Set([awayId, homeId, selectedTeamId])).map((teamId) => loadTeam(teamId))).catch((reason: unknown) => {
      if (active) setTeamLoadError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => {
      active = false;
    };
  }, [awayId, homeId, loadTeam, selectedTeamId]);

  const away = teamCards[awayId];
  const home = teamCards[homeId];
  const selectedTeam = teamCards[selectedTeamId];
  const matchup = useMemo(() => (away && home ? buildMatchupCard(away, home, matchupOptions) : null), [away, home, matchupOptions]);
  const seasonLeagues = seasonLeagueCollection.leagues;
  const activeSeasonLeague = useMemo(
    () => seasonLeagues.find((league) => league.id === seasonLeagueCollection.activeLeagueId) ?? null,
    [seasonLeagueCollection.activeLeagueId, seasonLeagues]
  );
  const leagueCardStats = useMemo<LeagueCardStatsContextValue | null>(() => {
    if (tab !== "league" || !activeSeasonLeague) return null;
    const teamStats = aggregateTeamStats(activeSeasonLeague);
    const playerStats = new Map(
      aggregatePlayerStats(activeSeasonLeague).map((row) => [playerStatsKey(row.teamId, row.player), { games: row.games, ...row.totals } as SeasonStatLine])
    );
    const teamRecords = new Map(standings(activeSeasonLeague).map((row) => [row.teamId, standingsRecordLabel(row)]));
    return {
      leagueId: activeSeasonLeague.id,
      leagueName: activeSeasonLeague.name,
      teamStats,
      playerStats,
      teamRecords
    };
  }, [activeSeasonLeague, tab]);
  const [activeTeamCard, setActiveTeamCard] = useState<DiceTeamCard | null>(null);
  const [activePlayerCard, setActivePlayerCard] = useState<{ team: DiceTeamCard; player: DicePlayerCard } | null>(null);
  const [cardLoadError, setCardLoadError] = useState<string | null>(null);

  const openTeamCard = useCallback(
    (team: DiceTeamCard | string) => {
      setCardLoadError(null);
      if (typeof team !== "string") {
        setActiveTeamCard(team);
        return;
      }
      void loadTeam(team)
        .then((loadedTeam) => setActiveTeamCard(loadedTeam))
        .catch((reason: unknown) => setCardLoadError(reason instanceof Error ? reason.message : String(reason)));
    },
    [loadTeam]
  );

  const openPlayerCard = useCallback(
    (team: DiceTeamCard | string, player: DicePlayerCard | string) => {
      setCardLoadError(null);
      const load = async () => {
        const loadedTeam = typeof team === "string" ? await loadTeam(team) : team;
        const loadedPlayer = typeof player === "string" ? loadedTeam.players.find((candidate) => candidate.name === player || candidate.id === player) : player;
        if (!loadedPlayer) throw new Error(`Player card not found for ${player}.`);
        setActivePlayerCard({ team: loadedTeam, player: loadedPlayer });
      };
      void load().catch((reason: unknown) => setCardLoadError(reason instanceof Error ? reason.message : String(reason)));
    },
    [loadTeam]
  );

  const cardOpener = useMemo<CardOpenerContextValue>(() => ({ openTeamCard, openPlayerCard }), [openPlayerCard, openTeamCard]);

  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
    { id: "library", label: "Library", icon: <BookOpen size={18} /> },
    { id: "matchup", label: "Matchup", icon: <FileText size={18} /> },
    { id: "sim", label: "Simulator", icon: <Play size={18} /> },
    { id: "tournament", label: "Tournament", icon: <Trophy size={18} /> },
    { id: "league", label: "League", icon: <CalendarDays size={18} /> }
  ];

  return (
    <>
      <CardOpenerContext.Provider value={cardOpener}>
        <LeagueCardStatsContext.Provider value={leagueCardStats}>
          <div className={`app screen-only ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
            <aside className="sidebar">
              <div className="sidebar-header">
                <div className="brand">
                  <div className="brand-mark" aria-hidden="true">
                    <svg viewBox="0 0 48 48" focusable="false">
                      <rect className="logo-die" x="6" y="6" width="36" height="36" rx="9" />
                      <path className="logo-seam" d="M24 8c5.7 4.3 8.5 9.6 8.5 16S29.7 35.7 24 40" />
                      <path className="logo-seam" d="M8 24h32" />
                      <path className="logo-seam" d="M14.5 12.5c6.4 3.9 12.6 3.9 19 0" />
                      <path className="logo-seam" d="M14.5 35.5c6.4-3.9 12.6-3.9 19 0" />
                      <circle className="logo-pip" cx="17" cy="18" r="2.6" />
                      <circle className="logo-pip" cx="31" cy="30" r="2.6" />
                    </svg>
                  </div>
                  <div className="brand-copy">
                    <h1>Basketball Dice Studio</h1>
                  </div>
                </div>
                <button
                  type="button"
                  className="sidebar-toggle"
                  aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                  aria-expanded={!sidebarCollapsed}
                  title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                  onClick={() => setSidebarCollapsed((current) => !current)}
                >
                  {sidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
                </button>
              </div>
              <nav className="nav">
                {tabs.map((item) => (
                  <button key={item.id} className={tab === item.id ? "active" : ""} title={item.label} aria-label={item.label} onClick={() => setTab(item.id)}>
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                ))}
              </nav>
            </aside>

            <main className="workspace">
            {teamLoadError && (
              <article className="panel">
                <h3>Team Load Failed</h3>
                <p>{teamLoadError}</p>
              </article>
            )}
            {cardLoadError && (
              <article className="panel">
                <h3>Card Load Failed</h3>
                <p>{cardLoadError}</p>
              </article>
            )}
            {appStateError && (
              <article className="panel">
                <h3>App State Failed</h3>
                <p>{appStateError}</p>
              </article>
            )}
            {appStateLoading && <LoadingPanel label="Loading saved tournaments and leagues from SQLite." />}
            {tab === "library" && (
              <Library
                selectedTeamId={selectedTeamId}
                selected={selectedTeam}
                setSelectedTeamId={setSelectedTeamId}
                sourceTeams={sourceTeams}
                seasonChoices={seasonChoices}
                defaultSeason={defaultSeason}
              />
            )}
            {tab === "matchup" && matchup && (
              <MatchupStudio
                awayId={awayId}
                homeId={homeId}
                setAwayId={setAwayId}
                setHomeId={setHomeId}
                matchup={matchup}
                matchupOptions={matchupOptions}
                setMatchupOptions={setMatchupOptions}
                sourceTeams={sourceTeams}
                seasonChoices={seasonChoices}
              />
            )}
            {tab === "matchup" && !matchup && <LoadingPanel label="Loading matchup teams." />}
            {tab === "sim" && away && home && matchup && (
              <Simulator
                awayId={awayId}
                homeId={homeId}
                away={away}
                home={home}
                matchup={matchup}
                matchupOptions={matchupOptions}
                setMatchupOptions={setMatchupOptions}
                setAwayId={setAwayId}
                setHomeId={setHomeId}
                sourceTeams={sourceTeams}
                seasonChoices={seasonChoices}
              />
            )}
            {tab === "sim" && (!away || !home) && <LoadingPanel label="Loading simulator teams." />}
            {tab === "tournament" && (
              <TournamentView
                tournament={tournament}
                setTournament={setTournament}
                seasonChoices={seasonChoices}
                defaultSeason={defaultSeason}
                sourceTeams={sourceTeams}
                teamNames={teamNames}
                loadTeam={loadTeam}
              />
            )}
            {tab === "league" && (
              <SeasonLeagueView
                leagues={seasonLeagues}
                activeLeagueId={seasonLeagueCollection.activeLeagueId}
                league={activeSeasonLeague}
                setActiveLeagueId={setActiveSeasonLeagueId}
                setLeague={upsertSeasonLeague}
                deleteLeague={deleteSeasonLeague}
                seasonChoices={seasonChoices}
                defaultSeason={defaultSeason}
                sourceTeams={sourceTeams}
                teamNames={teamNames}
                loadTeam={loadTeam}
              />
            )}
            </main>
          </div>
          {activeTeamCard && <TeamCardModal team={activeTeamCard} onClose={() => setActiveTeamCard(null)} />}
          {activePlayerCard && <PlayerCardModal team={activePlayerCard.team} player={activePlayerCard.player} onClose={() => setActivePlayerCard(null)} />}
        </LeagueCardStatsContext.Provider>
      </CardOpenerContext.Provider>
    </>
  );
}

function LoadingPanel({ label }: { label: string }) {
  return (
    <article className="panel">
      <h3>Loading</h3>
      <p>{label}</p>
    </article>
  );
}

function CardSeasonStats({
  title,
  displayMode,
  onDisplayModeChange,
  metrics
}: {
  title: string;
  displayMode: CardStatDisplayMode;
  onDisplayModeChange: (value: CardStatDisplayMode) => void;
  metrics: Array<{ label: string; value: string; sub?: string }>;
}) {
  return (
    <section className="card-season-stats">
      <div className="team-card-section-title">
        <h4>{title}</h4>
        <span>{displayMode === "averages" ? "Per game" : "Totals"}</span>
      </div>
      <SegmentedControl<CardStatDisplayMode>
        label="Display"
        value={displayMode}
        options={[
          { value: "averages", label: "Per Game" },
          { value: "totals", label: "Totals" }
        ]}
        onChange={onDisplayModeChange}
      />
      <div className="card-season-stat-grid">
        {metrics.map((metric) => (
          <span key={metric.label}>
            <small>{metric.label}</small>
            <strong>{metric.value}</strong>
            {metric.sub && <em>{metric.sub}</em>}
          </span>
        ))}
      </div>
    </section>
  );
}

function CardStatsToggle({ value, onChange }: { value: CardStatsMode; onChange: (value: CardStatsMode) => void }) {
  return (
    <SegmentedControl<CardStatsMode>
      label="Stats"
      value={value}
      options={[
        { value: "league", label: "League Season" },
        { value: "source", label: "Source Season" }
      ]}
      onChange={onChange}
    />
  );
}

function PlayerCardModal({ team, player, onClose }: { team: DiceTeamCard; player: DicePlayerCard; onClose: () => void }) {
  const leagueCardStats = useLeagueCardStats();
  const hasLeagueStats = Boolean(leagueCardStats?.teamStats[team.id]);
  const [statsMode, setStatsMode] = useState<CardStatsMode>(hasLeagueStats ? "league" : "source");
  const [statDisplayMode, setStatDisplayMode] = useState<CardStatDisplayMode>("averages");
  const totalUseWeight = team.players.reduce((sum, row) => sum + row.useWeight, 0);
  const starterIds = new Set(rotationPlayerGroups(team.players).starters.map((row) => row.id));
  const usePct = totalUseWeight ? (player.useWeight / totalUseWeight) * 100 : 0;
  const starter = starterIds.has(player.id);
  const leaguePlayerLine = leagueCardStats?.playerStats.get(playerStatsKey(team.id, player.name)) ?? emptySeasonLine();
  const sourcePlayerLine = playerSourceSeasonLine(player);
  const activeLine = statsMode === "league" && hasLeagueStats ? leaguePlayerLine : sourcePlayerLine;
  const activeTitle = statsMode === "league" && hasLeagueStats ? `${leagueCardStats?.leagueName ?? "League"} Player Stats` : `${team.season} Source Stats`;

  useEffect(() => {
    setStatsMode(hasLeagueStats ? "league" : "source");
  }, [hasLeagueStats, leagueCardStats?.leagueId, player.id, team.id]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        event.stopPropagation();
        onClose();
      }}
    >
      <article className="panel player-card-modal" role="dialog" aria-modal="true" aria-labelledby="player-card-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="player-card-modal-topline">
          <span>{starter ? "Starter" : "Bench"}</span>
          <TeamLogo team={team} className="player-card-team-logo" />
        </div>
        <div className="player-card-hero">
          <PlayerPhoto player={player} className="player-card-photo-large" loading="eager" />
          <div>
            <h3 id="player-card-title">{player.name}</h3>
            <p>
              {player.source.roster.number ? `#${player.source.roster.number} · ` : ""}
              {player.position} · {team.shortName}
            </p>
            <div className="player-card-tags">
              <span>Use {usePct.toFixed(1)}%</span>
              <span>{Math.round(player.minutes)} minutes</span>
              <span>{Math.round(player.availabilityFactor * 100)}% availability</span>
            </div>
          </div>
        </div>
        {hasLeagueStats && (
          <div className="card-season-controls">
            <CardStatsToggle value={statsMode} onChange={setStatsMode} />
          </div>
        )}
        <CardSeasonStats
          title={activeTitle}
          displayMode={statDisplayMode}
          onDisplayModeChange={setStatDisplayMode}
          metrics={[
            { label: "GP", value: String(activeLine.games) },
            seasonCountMetric(activeLine, "PTS", "PTS", statDisplayMode),
            { label: "FG%", value: seasonLinePct(activeLine, "FGM", "FGA") },
            { label: "3P%", value: seasonLinePct(activeLine, "3PM", "3PA") },
            seasonCountMetric(activeLine, "REB", "REB", statDisplayMode),
            seasonCountMetric(activeLine, "AST", "AST", statDisplayMode),
            seasonCountMetric(activeLine, "STL", "STL", statDisplayMode),
            seasonCountMetric(activeLine, "BLK", "BLK", statDisplayMode),
            seasonCountMetric(activeLine, "TOV", "TOV", statDisplayMode)
          ]}
        />
        <div className="player-card-rating-grid">
          {[
            ["TOV", modifier(player.tov, 1)],
            ["FD", modifier(player.fd, 1)],
            ["3F", modifier(player.threeFrequency, 1)],
            ["2P", modifier(player.p2, 1)],
            ["3P", modifier(player.p3, 1)],
            ["FT", modifier(player.ft, 1)],
            ["And-1", modifier(player.andOneChance, 1)],
            ["ASTw", modifier(player.astWeight, 1)],
            ["REBw", modifier(player.orbWeight + player.drbWeight, 1)]
          ].map(([label, value]) => (
            <span key={label}>
              <small>{label}</small>
              <strong>{value}</strong>
            </span>
          ))}
        </div>
        <div className="player-card-modal-actions">
          {player.source.sourceUrl && (
            <a className="btn subtle" href={player.source.sourceUrl} target="_blank" rel="noreferrer">
              Source
            </a>
          )}
          <Button onClick={onClose}>Close</Button>
        </div>
      </article>
    </div>
  );
}

function TeamCardModal({ team, onClose }: { team: DiceTeamCard; onClose: () => void }) {
  const leagueCardStats = useLeagueCardStats();
  const hasLeagueStats = Boolean(leagueCardStats?.teamStats[team.id]);
  const [statsMode, setStatsMode] = useState<CardStatsMode>(hasLeagueStats ? "league" : "source");
  const [statDisplayMode, setStatDisplayMode] = useState<CardStatDisplayMode>("averages");
  const [activePlayer, setActivePlayer] = useState<DicePlayerCard | null>(null);
  const totalUseWeight = team.players.reduce((sum, player) => sum + player.useWeight, 0);
  const rotation = [...team.players].sort((a, b) => b.minutes - a.minutes).slice(0, 8);
  const sourceRecord = `${team.source.team.wins ?? 0}-${team.source.team.losses ?? 0}`;
  const leagueRecord = leagueCardStats?.teamRecords.get(team.id) ?? "0-0";
  const sourceTeamLine = teamSourceSeasonLine(team);
  const leagueTeamLine = leagueCardStats?.teamStats[team.id] ?? emptySeasonLine();
  const activeLine = statsMode === "league" && hasLeagueStats ? leagueTeamLine : sourceTeamLine;
  const activeRecord = statsMode === "league" && hasLeagueStats ? leagueRecord : sourceRecord;
  const activeTitle = statsMode === "league" && hasLeagueStats ? `${leagueCardStats?.leagueName ?? "League"} Team Stats` : `${team.season} Source Stats`;

  useEffect(() => {
    setStatsMode(hasLeagueStats ? "league" : "source");
  }, [hasLeagueStats, leagueCardStats?.leagueId, team.id]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        event.stopPropagation();
        onClose();
      }}
    >
      <article className="panel team-card-modal" role="dialog" aria-modal="true" aria-labelledby="team-card-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="team-card-topline">
          <span>{statsMode === "league" && hasLeagueStats ? "League Season" : team.season}</span>
          <span>{activeRecord}</span>
        </div>
        <div className="team-card-hero">
          <TeamLogo team={team} className="team-card-logo-large" />
          <div>
            <h3 id="team-card-title">{team.shortName}</h3>
            <p>{team.name}</p>
            <div className="player-card-tags">
              <span>{team.abbr}</span>
              <span>{team.players.length} rotation cards</span>
              <span>{team.source.franchise}</span>
            </div>
          </div>
        </div>
        {hasLeagueStats && (
          <div className="card-season-controls">
            <CardStatsToggle value={statsMode} onChange={setStatsMode} />
          </div>
        )}
        <CardSeasonStats
          title={activeTitle}
          displayMode={statDisplayMode}
          onDisplayModeChange={setStatDisplayMode}
          metrics={[
            { label: "Record", value: activeRecord },
            { label: "GP", value: String(activeLine.games) },
            seasonCountMetric(activeLine, "PTS", "PTS", statDisplayMode),
            { label: "FG%", value: seasonLinePct(activeLine, "FGM", "FGA") },
            { label: "3P%", value: seasonLinePct(activeLine, "3PM", "3PA") },
            seasonCountMetric(activeLine, "REB", "REB", statDisplayMode),
            seasonCountMetric(activeLine, "AST", "AST", statDisplayMode),
            seasonCountMetric(activeLine, "STL", "STL", statDisplayMode),
            seasonCountMetric(activeLine, "BLK", "BLK", statDisplayMode),
            seasonCountMetric(activeLine, "TOV", "TOV", statDisplayMode)
          ]}
        />
        <div className="team-card-section-title">
          <h4>Card Ratings</h4>
          <span>Source model</span>
        </div>
        <MetricGrid
          metrics={[
            ["Pace", formatNumber(team.pace)],
            ["ORtg", formatNumber(team.offensiveRating)],
            ["DRtg", formatNumber(team.defensiveRating)],
            ["ShotQ", modifier(team.shotQuality)],
            ["DEF", modifier(team.defense)],
            ["3PT Tend", modifier(team.threeTendency)],
            ["ORB/DRB", `${modifier(team.orb, 1)} / ${modifier(team.drb, 1)}`],
            ["AST 2/3", `${nRange(team.assistMade2)} / ${nRange(team.assistMade3)}`]
          ]}
        />
        <section className="team-card-rotation">
          <div className="team-card-section-title">
            <h4>Rotation</h4>
            <span>Use %</span>
          </div>
          <div className="team-card-player-list">
            {rotation.map((player) => (
              <div key={player.id} className="team-card-player-row">
                <PlayerIdentity player={player} onSelect={setActivePlayer} />
                <strong>{totalUseWeight ? ((player.useWeight / totalUseWeight) * 100).toFixed(1) : "0.0"}</strong>
              </div>
            ))}
          </div>
        </section>
        <div className="player-card-modal-actions">
          {team.source.source.url && (
            <a className="btn subtle" href={team.source.source.url} target="_blank" rel="noreferrer">
              Source
            </a>
          )}
          <Button onClick={onClose}>Close</Button>
        </div>
      </article>
      {activePlayer && <PlayerCardModal team={team} player={activePlayer} onClose={() => setActivePlayer(null)} />}
    </div>
  );
}

function Library({
  selectedTeamId,
  selected,
  setSelectedTeamId,
  sourceTeams,
  seasonChoices,
  defaultSeason
}: {
  selectedTeamId: string;
  selected: DiceTeamCard | undefined;
  setSelectedTeamId: (id: string) => void;
  sourceTeams: SourceTeamCatalogEntry[];
  seasonChoices: SeasonChoice[];
  defaultSeason: string;
}) {
  const [season, setSeason] = useState(defaultSeason);
  const [query, setQuery] = useState("");
  const [franchise, setFranchise] = useState(allSeasonsValue);
  const [activePlayer, setActivePlayer] = useState<DicePlayerCard | null>(null);
  const [activeTeam, setActiveTeam] = useState<DiceTeamCard | null>(null);
  const franchises = useMemo(() => franchiseChoicesFor(sourceTeams), [sourceTeams]);
  const filteredTeams = useMemo(
    () => filterCatalogTeams(sourceTeams, { season, query, franchise }),
    [franchise, query, season, sourceTeams]
  );
  const visibleTeams = filteredTeams;
  const selectedCatalogTeam = sourceTeams.find((team) => team.id === selectedTeamId);

  useEffect(() => {
    if (filteredTeams.length && !sourceTeams.some((team) => team.id === selectedTeamId)) {
      setSelectedTeamId(filteredTeams[0].id);
    }
  }, [filteredTeams, selectedTeamId, setSelectedTeamId, sourceTeams]);

  useEffect(() => {
    setActivePlayer(null);
    setActiveTeam(null);
  }, [selectedTeamId]);

  if (!selected) {
    return (
      <section className="page">
        <LoadingPanel label="Loading selected team." />
      </section>
    );
  }

  const selectedTeamDerivationNotes = teamDerivationNotes[selected.id] ?? [];
  const selectedPlayerGroups = rotationPlayerGroups(selected.players);

  return (
    <section className="page library-page">
      <header className="page-header">
        <div>
          <h2>Team Library</h2>
          <p>{sourceTeams.length.toLocaleString()} source-derived teams across {seasonChoices.length} seasons.</p>
        </div>
      </header>

      <details className="notes library-derivation-notes">
        <summary>General derivation notes</summary>
        <ul className="notes-list">
          {generalDerivationNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </details>

      <div className="library-layout">
        <aside className="catalog-panel">
          <div className="catalog-filters">
            <label className="search-field">
              Search
              <span>
                <Search size={16} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="team, franchise, season..." />
              </span>
            </label>
            <div className="filter-grid">
              <label>
                Season
                <select value={season} onChange={(event) => setSeason(event.target.value)}>
                  <option value={allSeasonsValue}>All seasons</option>
                  {seasonChoices.map((choice) => (
                    <option key={choice.season} value={choice.season}>
                      {choice.season}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Franchise
                <select value={franchise} onChange={(event) => setFranchise(event.target.value)}>
                  <option value={allSeasonsValue}>All franchises</option>
                  {franchises.map((choice) => (
                    <option key={choice} value={choice}>
                      {choice}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="result-count">
              <ListFilter size={15} />
              <span>
                Showing {filteredTeams.length.toLocaleString()} matches
              </span>
            </div>
          </div>
          <div className="team-list library-list">
            {visibleTeams.map((team) => (
              <TeamCatalogRow key={team.id} team={team} active={team.id === selectedTeamId} onSelect={setSelectedTeamId} />
            ))}
          </div>
        </aside>

        <article className="panel library-detail-panel">
          <div className="panel-title">
            <div className="team-title">
              <button type="button" className="team-card-trigger team-card-trigger-large" aria-label={`Open ${selected.shortName} team card`} onClick={() => setActiveTeam(selected)}>
                <TeamLogo team={selected} className="team-logo-large" />
              </button>
              <div>
                <h3>{selected.name}</h3>
                <p>
                  <a href={selected.source.source.url} target="_blank" rel="noreferrer">
                    {selected.source.source.provider}
                  </a>
                  {" "}tables: {selected.source.source.tableIds.length}
                </p>
              </div>
            </div>
            <span className="badge">{selectedCatalogTeam ? `${selectedCatalogTeam.season} ${selected.abbr}` : selected.abbr}</span>
          </div>

          <MetricGrid
            metrics={[
              ["Pace", formatNumber(selected.pace)],
              ["ORtg", formatNumber(selected.offensiveRating)],
              ["DRtg", formatNumber(selected.defensiveRating)],
              ["ShotQ", modifier(selected.shotQuality)],
              ["DEF", modifier(selected.defense)],
              ["3PT Tend", modifier(selected.threeTendency)],
              ["AST 2/3", `${nRange(selected.assistMade2)} / ${nRange(selected.assistMade3)}`],
              ["Rotation", selected.players.length]
            ]}
          />

          <h4>Derived Rotation Cards</h4>
          {(() => {
            const totalUseWeight = selected.players.reduce((sum, player) => sum + player.useWeight, 0);
            const renderRotationPlayerRow = (player: DicePlayerCard) => (
              <tr key={player.id}>
                <td>
                  <PlayerIdentity player={player} onSelect={setActivePlayer} />
                </td>
                <td>{player.position}</td>
                <td>{Math.round(player.minutes)}</td>
                <td>{((player.useWeight / totalUseWeight) * 100).toFixed(1)}</td>
                <td>{modifier(player.tov, 1)}</td>
                <td>{modifier(player.fd, 1)}</td>
                <td>{modifier(player.threeFrequency, 1)}</td>
                <td>{modifier(player.p2, 1)}</td>
                <td>{modifier(player.p3, 1)}</td>
                <td>{modifier(player.ft, 1)}</td>
                <td>{modifier(player.andOneChance, 1)}</td>
                <td>{modifier(player.astWeight, 1)}</td>
                <td>{modifier(player.orbWeight + player.drbWeight, 1)}</td>
              </tr>
            );
            return (
              <div className="table-wrap">
                <table className="rotation-card-table">
                  <thead>
                    <tr>
                      <th>Starters</th>
                      {rotationCardColumns.map((column) => (
                        <th key={column}>{column}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {selectedPlayerGroups.starters.map(renderRotationPlayerRow)}
                    {selectedPlayerGroups.bench.length > 0 && (
                      <tr className="rotation-group-row">
                        <th scope="row">Bench</th>
                        <td colSpan={rotationCardColumns.length} />
                      </tr>
                    )}
                    {selectedPlayerGroups.bench.map(renderRotationPlayerRow)}
                  </tbody>
                </table>
              </div>
            );
          })()}

          {selectedTeamDerivationNotes.length > 0 && (
            <details className="notes">
              <summary>Team-specific derivation notes</summary>
              <ul className="notes-list">
                {selectedTeamDerivationNotes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </details>
          )}

          <section className="source-coverage">
            <h4>Source Table Coverage</h4>
            <div className="chip-row">
              {selected.source.rawTableSummary
                .filter((table) => table.id)
                .map((table) => (
                  <span className="chip" key={table.id}>
                    {table.id}: {table.rows}
                  </span>
                ))}
            </div>
          </section>
        </article>
      </div>
      {activePlayer && <PlayerCardModal team={selected} player={activePlayer} onClose={() => setActivePlayer(null)} />}
      {activeTeam && <TeamCardModal team={activeTeam} onClose={() => setActiveTeam(null)} />}
    </section>
  );
}

function MatchupStudio({
  awayId,
  homeId,
  setAwayId,
  setHomeId,
  matchup,
  matchupOptions,
  setMatchupOptions,
  sourceTeams,
  seasonChoices
}: {
  awayId: string;
  homeId: string;
  setAwayId: (id: string) => void;
  setHomeId: (id: string) => void;
  matchup: MatchupCard;
  matchupOptions: MatchupOptions;
  setMatchupOptions: (options: MatchupOptions) => void;
  sourceTeams: SourceTeamCatalogEntry[];
  seasonChoices: SeasonChoice[];
}) {
  const expectedLine = useMemo(() => buildExpectedMatchupLine(matchup.away, matchup.home, matchupOptions), [matchup.away, matchup.home, matchupOptions]);

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h2>Matchup</h2>
          <p>Generate source-backed matchup cards and print-ready scoresheets.</p>
        </div>
        <div className="actions">
          <Button icon={<Download size={16} />} onClick={() => void exportGamePacketPdf(matchup)} variant="primary">
            Export All PDF
          </Button>
          <Button icon={<Download size={16} />} onClick={() => void exportGameCardPdf(matchup)}>
            Export Card PDF
          </Button>
          <Button data-testid="export-possession-flow-pdf" icon={<Download size={16} />} onClick={() => void exportPossessionFlowPdf(matchup)}>
            Export Flow PDF
          </Button>
          <Button data-testid="export-scoresheets-pdf" icon={<Download size={16} />} onClick={() => void exportScoresheetsPdf(matchup)}>
            Export Scoresheet PDF
          </Button>
        </div>
      </header>

      <MatchupSetupPanel
        awayId={awayId}
        homeId={homeId}
        setAwayId={setAwayId}
        setHomeId={setHomeId}
        matchup={matchup}
        matchupOptions={matchupOptions}
        setMatchupOptions={setMatchupOptions}
        sourceTeams={sourceTeams}
        seasonChoices={seasonChoices}
      />
      <ExpectedMatchupPanel expected={expectedLine} away={matchup.away} home={matchup.home} />
      <ScreenGameCard matchup={matchup} />
    </section>
  );
}

function MatchupSetupPanel({
  awayId,
  homeId,
  setAwayId,
  setHomeId,
  matchup,
  matchupOptions,
  setMatchupOptions,
  sourceTeams,
  seasonChoices
}: {
  awayId: string;
  homeId: string;
  setAwayId: (id: string) => void;
  setHomeId: (id: string) => void;
  matchup: MatchupCard;
  matchupOptions: MatchupOptions;
  setMatchupOptions: (options: MatchupOptions) => void;
  sourceTeams: SourceTeamCatalogEntry[];
  seasonChoices: SeasonChoice[];
}) {
  return (
    <details className="panel setup-panel">
      <summary>
        <span className="setup-summary-main">
          <strong>Matchup Setup</strong>
          <span>
            {matchup.away.shortName} at {matchup.home.shortName}
          </span>
        </span>
        <span className="setup-summary-meta">{matchup.context.label}</span>
      </summary>
      <div className="setup-panel-body">
        <TeamSelectors
          awayId={awayId}
          homeId={homeId}
          setAwayId={setAwayId}
          setHomeId={setHomeId}
          seasonChoices={seasonChoices}
          sourceTeams={sourceTeams}
        />
        <MatchupOptionsControls matchup={matchup} options={matchupOptions} setOptions={setMatchupOptions} />
      </div>
    </details>
  );
}

function MatchupOptionsControls({
  matchup,
  options,
  setOptions
}: {
  matchup: MatchupCard;
  options: MatchupOptions;
  setOptions: (options: MatchupOptions) => void;
}) {
  const eraContext = options.eraContext ?? ({ mode: "midpoint", blend: 0.5 } satisfies EraContextOptions);
  const awayYear = matchup.away.source.seasonEndYear;
  const homeYear = matchup.home.source.seasonEndYear;
  const lowerSeason = Math.max(minEraContextSeason, Math.min(awayYear, homeYear));
  const upperSeason = Math.min(maxEraContextSeason, Math.max(awayYear, homeYear));
  const midpointSeason = Math.round((awayYear + homeYear) / 2);
  const blendPct = Math.round((eraContext.blend ?? 0.5) * 100);
  const fixedSeason = eraContext.seasonEndYear ?? matchup.eraContext.seasonEndYear ?? midpointSeason;
  const gameplay = options.gameplay ?? {};
  const awayPlan = normalizedTeamGamePlan(gameplay.teamPlans?.[matchup.away.id] ?? gameplay.away);
  const homePlan = normalizedTeamGamePlan(gameplay.teamPlans?.[matchup.home.id] ?? gameplay.home);
  const tempoPct = Math.round((gameplay.tempoMultiplier ?? 1) * 100);
  const setEraContext = (next: EraContextOptions) => setOptions({ ...options, eraContext: next });
  const setEraMode = (mode: EraContextMode) => {
    if (mode === "midpoint") {
      setEraContext({ mode, blend: eraContext.blend ?? 0.5 });
      return;
    }
    if (mode === "fixed-season") {
      setEraContext({ mode, seasonEndYear: clampNumber(fixedSeason, lowerSeason, upperSeason) });
      return;
    }
    setEraContext({ mode });
  };
  const setTempoPct = (tempo: number) => {
    setOptions({
      ...options,
      gameplay: {
        ...gameplay,
        tempoMultiplier: clampNumber(tempo, 85, 115) / 100
      }
    });
  };
  const setPlan = (side: "away" | "home", teamId: string, plan: Required<TeamGamePlanOptions>) => {
    setOptions({
      ...options,
      gameplay: {
        ...gameplay,
        [side]: plan,
        teamPlans: {
          ...(gameplay.teamPlans ?? {}),
          [teamId]: plan
        }
      }
    });
  };
  const resetGameplay = () => {
    setOptions({
      ...options,
      gameplay: {
        tempoMultiplier: 1,
        away: neutralTeamGamePlan,
        home: neutralTeamGamePlan,
        teamPlans: {
          [matchup.away.id]: neutralTeamGamePlan,
          [matchup.home.id]: neutralTeamGamePlan
        }
      }
    });
  };

  return (
    <div className="matchup-options-stack">
      <div className="options-bar">
        <SegmentedControl
          label="Venue"
          value={options.venue}
          options={[
            { value: "home-court", label: "Home court" },
            { value: "neutral", label: "Neutral" }
          ]}
          onChange={(venue) => setOptions({ ...options, venue })}
        />
        <SegmentedControl
          label="Game type"
          value={options.intensity}
          options={[
            { value: "regular", label: "Regular" },
            { value: "playoff", label: "Playoff" }
          ]}
          onChange={(intensity) => setOptions({ ...options, intensity })}
        />
        <SegmentedControl<EraContextMode>
          label="Era"
          value={eraContext.mode}
          options={[
            { value: "midpoint", label: "Midpoint" },
            { value: "older-era", label: "Older" },
            { value: "newer-era", label: "Newer" },
            { value: "away-era", label: "Away" },
            { value: "home-era", label: "Home" },
            { value: "fixed-season", label: "Fixed" }
          ]}
          onChange={setEraMode}
        />
        {eraContext.mode === "midpoint" && (
          <label className="era-slider-control">
            <span>Blend</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={blendPct}
              onChange={(event) => setEraContext({ mode: "midpoint", blend: Number(event.target.value) / 100 })}
            />
            <b>{blendPct}%</b>
          </label>
        )}
        {eraContext.mode === "fixed-season" && (
          <label className="era-number-control">
            <span>Season</span>
            <input
              type="number"
              min={lowerSeason}
              max={upperSeason}
              value={fixedSeason}
              onChange={(event) => {
                const parsed = Number(event.target.value);
                setEraContext({
                  mode: "fixed-season",
                  seasonEndYear: Number.isFinite(parsed) ? clampNumber(Math.round(parsed), lowerSeason, upperSeason) : midpointSeason
                });
              }}
            />
          </label>
        )}
      </div>
      <div className="game-plan-controls">
        <div className="game-plan-header">
          <label className="era-slider-control tempo-control">
            <span>Tempo</span>
            <input type="range" min={85} max={115} step={1} value={tempoPct} onChange={(event) => setTempoPct(Number(event.target.value))} />
            <b>{tempoPct}%</b>
          </label>
          <Button icon={<RotateCcw size={14} />} onClick={resetGameplay}>
            Reset plan
          </Button>
        </div>
        <GamePlanSliders team={matchup.away} label="Away plan" plan={awayPlan} onChange={(plan) => setPlan("away", matchup.away.id, plan)} />
        <PlayerUsageSliders team={matchup.away} plan={awayPlan} intensity={options.intensity} onChange={(plan) => setPlan("away", matchup.away.id, plan)} />
        <GamePlanSliders team={matchup.home} label="Home plan" plan={homePlan} onChange={(plan) => setPlan("home", matchup.home.id, plan)} />
        <PlayerUsageSliders team={matchup.home} plan={homePlan} intensity={options.intensity} onChange={(plan) => setPlan("home", matchup.home.id, plan)} />
      </div>
    </div>
  );
}

function GamePlanSliders({
  team,
  label,
  plan,
  onChange
}: {
  team: VisualTeam;
  label: string;
  plan: Required<TeamGamePlanOptions>;
  onChange: (plan: Required<TeamGamePlanOptions>) => void;
}) {
  const update = (field: keyof Required<TeamGamePlanOptions>, value: number) => onChange({ ...plan, [field]: value });
  return (
    <div className="game-plan-team">
      <div className="game-plan-team-title">
        <TeamLogo team={team} className="team-logo-mini" />
        <span>
          <strong>{label}</strong>
          <small>{team.shortName} style</small>
        </span>
      </div>
      <label className="era-slider-control">
        <span>3PA</span>
        <input type="range" min={-10} max={10} step={1} value={plan.threePointEmphasis} onChange={(event) => update("threePointEmphasis", Number(event.target.value))} />
        <b>{signedPoints(plan.threePointEmphasis)}</b>
      </label>
      <label className="era-slider-control">
        <span>Fouls</span>
        <input type="range" min={-6} max={6} step={1} value={plan.foulPressure} onChange={(event) => update("foulPressure", Number(event.target.value))} />
        <b>{signedPoints(plan.foulPressure)}</b>
      </label>
      <label className="era-slider-control">
        <span>Boards</span>
        <input type="range" min={-6} max={6} step={1} value={plan.crashBoards} onChange={(event) => update("crashBoards", Number(event.target.value))} />
        <b>{signedPoints(plan.crashBoards)}</b>
      </label>
      <label className="era-slider-control">
        <span>Security</span>
        <input type="range" min={-6} max={6} step={1} value={plan.ballSecurity} onChange={(event) => update("ballSecurity", Number(event.target.value))} />
        <b>{signedPoints(plan.ballSecurity)}</b>
      </label>
    </div>
  );
}

function PlayerUsageSliders({
  team,
  plan,
  intensity,
  onChange
}: {
  team: DiceTeamCard;
  plan: Required<TeamGamePlanOptions>;
  intensity: SimIntensity;
  onChange: (plan: Required<TeamGamePlanOptions>) => void;
}) {
  const players = [...team.players].sort((a, b) => basePlayerUsageShare(team, b, intensity) - basePlayerUsageShare(team, a, intensity));
  const adjustedCount = Object.keys(plan.playerUsageTargets).filter((playerId) => team.players.some((player) => player.id === playerId)).length;
  const updatePlayerUsage = (player: DicePlayerCard, targetPct: number) => {
    const target = clampNumber(targetPct / 100, 0, 0.6);
    const baseline = basePlayerUsageShare(team, player, intensity);
    const playerUsageTargets = { ...plan.playerUsageTargets };
    if (Math.abs(target - baseline) < 0.0025) {
      delete playerUsageTargets[player.id];
    } else {
      playerUsageTargets[player.id] = target;
    }
    onChange(normalizedTeamGamePlan({ ...plan, playerUsageTargets }));
  };
  const resetPlayerUsage = (playerId: string) => {
    const playerUsageTargets = { ...plan.playerUsageTargets };
    delete playerUsageTargets[playerId];
    onChange(normalizedTeamGamePlan({ ...plan, playerUsageTargets }));
  };

  return (
    <div className="player-usage-controls">
      <div className="player-usage-header">
        <strong>{team.shortName} Player Usage</strong>
        <span className="badge">{adjustedCount} adjusted</span>
      </div>
      <div className="player-usage-list">
        {players.map((player) => {
          const targetPct = playerUsageTargetPct(plan, team, player, intensity);
          const baselinePct = basePlayerUsageShare(team, player, intensity) * 100;
          const adjusted = plan.playerUsageTargets[player.id] !== undefined;
          return (
            <div key={player.id} className={`player-usage-row ${adjusted ? "adjusted" : ""}`}>
              <span className="player-usage-player">
                <PlayerPhoto player={player} className="player-photo-mini" />
                <span>
                  <strong>{player.name}</strong>
                  <small>
                    {player.position} · Base {formatNumber(baselinePct, 1)}%
                  </small>
                </span>
              </span>
              <label className="era-slider-control player-usage-slider">
                <span>Target</span>
                <input type="range" min={0} max={60} step={0.5} value={targetPct} onChange={(event) => updatePlayerUsage(player, Number(event.target.value))} />
                <b>{formatNumber(targetPct, 1)}%</b>
              </label>
              <Button icon={<RotateCcw size={14} />} disabled={!adjusted} onClick={() => resetPlayerUsage(player.id)}>
                Reset
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ExpectedMatchupPanel({ expected, away, home }: { expected: ExpectedMatchupLine; away: DiceTeamCard; home: DiceTeamCard }) {
  const marginLabel = expected.marginForAway >= 0 ? `${away.shortName} +${formatNumber(expected.marginForAway, 1)}` : `${home.shortName} +${formatNumber(-expected.marginForAway, 1)}`;
  return (
    <article className="panel expected-line-panel">
      <div className="panel-title">
        <div>
          <h3>Expected Line</h3>
          <p>{expected.eraContext.label}</p>
        </div>
        <span className="badge">{expected.possessionsEach} poss/team</span>
      </div>
      <div className="metric-grid expected-line-metrics">
        <div className="metric">
          <span>Projected score</span>
          <strong>
            {formatNumber(expected.away.pts, 1)}-{formatNumber(expected.home.pts, 1)}
          </strong>
        </div>
        <div className="metric">
          <span>Margin</span>
          <strong>{marginLabel}</strong>
        </div>
        <div className="metric">
          <span>Away PPP</span>
          <strong>{formatNumber(expected.away.pointsPerPossession, 2)}</strong>
        </div>
        <div className="metric">
          <span>Home PPP</span>
          <strong>{formatNumber(expected.home.pointsPerPossession, 2)}</strong>
        </div>
      </div>
      <div className="table-wrap expected-line-table">
        <table>
          <thead>
            <tr>
              <th>Team</th>
              <th>PTS</th>
              <th>FGA</th>
              <th>FG%</th>
              <th>3PA</th>
              <th>3P%</th>
              <th>FTA</th>
              <th>FT%</th>
              <th>TOV</th>
              <th>ORB</th>
              <th>AST</th>
            </tr>
          </thead>
          <tbody>
            {[
              { team: away, line: expected.away },
              { team: home, line: expected.home }
            ].map(({ team, line }) => (
              <tr key={team.id}>
                <th scope="row">
                  <TeamIdentityButton team={team} className="standings-team compact-team-identity" />
                </th>
                <td>{formatNumber(line.pts, 1)}</td>
                <td>{formatNumber(line.fga, 1)}</td>
                <td>{formatPct(line.fgPct, 1)}</td>
                <td>{formatNumber(line.threePa, 1)}</td>
                <td>{formatPct(line.threePct, 1)}</td>
                <td>{formatNumber(line.fta, 1)}</td>
                <td>{formatPct(line.ftPct, 1)}</td>
                <td>{formatNumber(line.tov, 1)}</td>
                <td>{formatNumber(line.orb, 1)}</td>
                <td>{formatNumber(line.ast, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="expected-player-grid">
        <ExpectedPlayerLineTable team={away} players={expected.away.players} />
        <ExpectedPlayerLineTable team={home} players={expected.home.players} />
      </div>
    </article>
  );
}

function ExpectedPlayerLineTable({ team, players }: { team: DiceTeamCard; players: ExpectedMatchupLine["away"]["players"] }) {
  const playersById = new Map(team.players.map((player) => [player.id, player]));
  return (
    <section className="expected-player-table">
      <div className="team-card-section-title">
        <h4>{team.shortName} Player Expected Line</h4>
        <span>{players.length} players</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th>USG</th>
              <th>PTS</th>
              <th>FG</th>
              <th>3PT</th>
              <th>FT</th>
              <th>OREB</th>
              <th>AST</th>
              <th>TOV</th>
            </tr>
          </thead>
          <tbody>
            {players.map((line) => (
              <tr key={line.playerId}>
                <th scope="row">
                  <PlayerIdentity player={playersById.get(line.playerId)} name={line.player} />
                </th>
                <td>{formatPct(line.usageShare, 1)}</td>
                <td>{formatNumber(line.pts, 1)}</td>
                <td>
                  {formatNumber(line.fgm, 1)}-{formatNumber(line.fga, 1)}
                </td>
                <td>
                  {formatNumber(line.threePm, 1)}-{formatNumber(line.threePa, 1)}
                </td>
                <td>
                  {formatNumber(line.ftm, 1)}-{formatNumber(line.fta, 1)}
                </td>
                <td>{formatNumber(line.orb, 1)}</td>
                <td>{formatNumber(line.ast, 1)}</td>
                <td>{formatNumber(line.tov, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function traceTeamName(matchup: MatchupCard, teamId: string): string {
  if (teamId === matchup.away.id) return matchup.away.shortName;
  if (teamId === matchup.home.id) return matchup.home.shortName;
  return teamId;
}

function traceScore(score: PossessionTrace["endScore"]): string {
  return `${score.away}-${score.home}`;
}

function formatTraceNumber(value: number | undefined): string {
  return value === undefined ? "-" : value.toFixed(1);
}

function rollTone(result: string): string {
  const normalized = result.toLowerCase();
  if (normalized.includes("made") || normalized === "yes" || normalized === "shot" || normalized.includes("foul draw")) return "good";
  if (normalized.includes("miss") || normalized === "no" || normalized.includes("turnover")) return "plain";
  return "info";
}

type PeriodTraceSummary = {
  index: number;
  label: string;
  count: number;
  startScore: PossessionTrace["startScore"];
  endScore: PossessionTrace["endScore"];
  lastPossessionNumber: number;
};

function periodScore(summary: PeriodTraceSummary): string {
  return `${summary.endScore.away - summary.startScore.away}-${summary.endScore.home - summary.startScore.home}`;
}

function PlayableMatchup({
  matchup,
  matchupOptions,
  title = "In-App Game",
  compact = false,
  onSaveResult
}: {
  matchup: MatchupCard;
  matchupOptions: SimulationOptions;
  title?: string;
  compact?: boolean;
  onSaveResult?: (result: GameResult) => void;
}) {
  const [game, setGame] = useState<TracedGameResult | null>(null);
  const [visibleCount, setVisibleCount] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedPeriodIndex, setSelectedPeriodIndex] = useState<number | null>(null);
  const [followLatestPeriod, setFollowLatestPeriod] = useState(true);
  const [speed, setSpeed] = useState<PlaySpeed>("manual");
  const [watchView, setWatchView] = useState<WatchGameView>("game");
  const [saved, setSaved] = useState(false);
  const cardOpener = useCardOpener();
  const availabilityKey = (matchupOptions.unavailablePlayerIds ?? []).join("|");
  const optionsKey = matchupOptionsKey(matchupOptions);

  useEffect(() => {
    setGame(null);
    setVisibleCount(0);
    setSelectedIndex(0);
    setSelectedPeriodIndex(null);
    setFollowLatestPeriod(true);
    setSpeed("manual");
    setWatchView("game");
    setSaved(false);
  }, [matchup.away.id, matchup.home.id, optionsKey, availabilityKey]);

  useEffect(() => {
    if (!game || speed === "manual" || visibleCount >= game.possessions.length) return;
    const timer = window.setTimeout(() => {
      setVisibleCount((current) => Math.min(game.possessions.length, current + 1));
    }, playSpeedMs[speed]);
    return () => window.clearTimeout(timer);
  }, [game, speed, visibleCount]);

  useEffect(() => {
    if (!game || visibleCount <= 0) return;
    const latestPossession = game.possessions[visibleCount - 1];
    if (!latestPossession) return;

    if (followLatestPeriod) {
      setSelectedIndex(visibleCount - 1);
      setSelectedPeriodIndex(latestPossession.periodIndex);
      return;
    }

    setSelectedIndex((currentIndex) => {
      const currentSelection = game.possessions[currentIndex];
      if (currentSelection && currentIndex < visibleCount && currentSelection.periodIndex === selectedPeriodIndex) return currentIndex;
      const fallbackPossession =
        game.possessions
          .slice(0, visibleCount)
          .filter((possession) => possession.periodIndex === selectedPeriodIndex)
          .at(-1) ?? latestPossession;
      return fallbackPossession.possessionNumber - 1;
    });
  }, [followLatestPeriod, game, selectedPeriodIndex, visibleCount]);

  const startGame = () => {
    const nextGame = simulateTracedGame(matchup.away, matchup.home, Date.now(), matchupOptions);
    setGame(nextGame);
    setVisibleCount(Math.min(1, nextGame.possessions.length));
    setSelectedIndex(0);
    setSelectedPeriodIndex(nextGame.possessions[0]?.periodIndex ?? null);
    setFollowLatestPeriod(true);
    setWatchView("game");
    setSaved(false);
  };

  const visiblePossessions = game?.possessions.slice(0, visibleCount) ?? [];
  const latestVisiblePossession = visiblePossessions.at(-1);
  const periodSummaries = visiblePossessions.reduce<PeriodTraceSummary[]>((summaries, possession) => {
    let summary = summaries.find((entry) => entry.index === possession.periodIndex);
    if (!summary) {
      summary = {
        index: possession.periodIndex,
        label: possession.periodLabel,
        count: 0,
        startScore: possession.startScore,
        endScore: possession.endScore,
        lastPossessionNumber: possession.possessionNumber
      };
      summaries.push(summary);
    }
    summary.count += 1;
    summary.endScore = possession.endScore;
    summary.lastPossessionNumber = possession.possessionNumber;
    return summaries;
  }, []);
  const activePeriodIndex = selectedPeriodIndex ?? latestVisiblePossession?.periodIndex ?? periodSummaries.at(-1)?.index ?? 0;
  const activePeriodSummary = periodSummaries.find((summary) => summary.index === activePeriodIndex) ?? periodSummaries.at(-1);
  const periodPossessions = activePeriodSummary
    ? visiblePossessions.filter((possession) => possession.periodIndex === activePeriodSummary.index).slice().reverse()
    : [];
  const selectedPossessionCandidate = visiblePossessions[selectedIndex] ?? latestVisiblePossession;
  const selectedPossession =
    selectedPossessionCandidate && selectedPossessionCandidate.periodIndex === activePeriodSummary?.index
      ? selectedPossessionCandidate
      : periodPossessions[0] ?? selectedPossessionCandidate;
  const currentScore = latestVisiblePossession?.endScore ?? { away: 0, home: 0 };
  const complete = Boolean(game && visibleCount >= game.possessions.length);
  const canAdvance = Boolean(game && visibleCount < game.possessions.length);
  const liveResult = latestVisiblePossession?.liveResult ?? (complete ? game?.result ?? null : null);
  const showWatchToggle = compact && Boolean(game);
  const watchStatusLabel = latestVisiblePossession ? `${latestVisiblePossession.periodLabel} #${latestVisiblePossession.possessionNumber}` : "Pregame";
  const selectPeriod = (period: PeriodTraceSummary) => {
    const isLatestPeriod = latestVisiblePossession?.periodIndex === period.index;
    setSelectedPeriodIndex(period.index);
    setFollowLatestPeriod(isLatestPeriod);
    setSelectedIndex(period.lastPossessionNumber - 1);
  };
  const selectPossession = (possession: PossessionTrace) => {
    setSelectedIndex(possession.possessionNumber - 1);
    setSelectedPeriodIndex(possession.periodIndex);
    setFollowLatestPeriod(possession.periodIndex === latestVisiblePossession?.periodIndex);
  };

  return (
    <div className={`play-stack ${compact ? "compact-play" : ""}`}>
      <article className="panel play-panel">
        <div className="play-header">
          <div>
            <h3>{title}</h3>
            <p>
              <TeamTextButton team={matchup.away} /> at <TeamTextButton team={matchup.home} />
            </p>
          </div>
          <div className="game-meta-list">
            <span>{matchup.context.label}</span>
            {game && <span>Seed {game.seed}</span>}
          </div>
        </div>

        <div className="live-scoreboard">
          {[matchup.away, matchup.home].map((team) => {
            const score = team.id === matchup.away.id ? currentScore.away : currentScore.home;
            const finalWinner = complete && game?.result.winnerTeamId === team.id;
            return (
              <button key={team.id} type="button" className={`live-score-team ${finalWinner ? "winner" : ""}`} onClick={() => cardOpener?.openTeamCard(team)}>
                <TeamLogo team={team} className="team-logo-score" />
                <span>{team.id === matchup.away.id ? "Away" : "Home"}</span>
                <strong>{team.shortName}</strong>
                <b>{score}</b>
              </button>
            );
          })}
          <div className="live-game-state">
            <span>{latestVisiblePossession?.periodLabel ?? "Pregame"}</span>
            <strong>
              {visibleCount}/{game?.possessions.length ?? 0}
            </strong>
            <small>{complete ? "Final" : latestVisiblePossession ? `${traceTeamName(matchup, latestVisiblePossession.offenseTeamId)} ball` : "Ready"}</small>
          </div>
        </div>

        <div className="play-controls">
          <Button icon={<RotateCcw size={16} />} onClick={startGame} variant="primary">
            New Game
          </Button>
          <Button icon={<SkipForward size={16} />} disabled={!canAdvance} onClick={() => setVisibleCount((current) => Math.min(game?.possessions.length ?? 0, current + 1))}>
            Next
          </Button>
          <SegmentedControl
            label="Pace"
            value={speed}
            options={[
              { value: "manual", label: "Manual" },
              { value: "slow", label: "Slow" },
              { value: "normal", label: "Normal" },
              { value: "fast", label: "Fast" }
            ]}
            onChange={setSpeed}
          />
          {showWatchToggle && (
            <div className="watch-view-switch">
              <SegmentedControl
                label="View"
                value={watchView}
                options={[
                  { value: "game", label: "Game" },
                  { value: "box", label: "Box Score" }
                ]}
                onChange={setWatchView}
              />
            </div>
          )}
          <Button icon={<Pause size={16} />} disabled={speed === "manual"} onClick={() => setSpeed("manual")}>
            Pause
          </Button>
          <Button disabled={!canAdvance} onClick={() => setVisibleCount(game?.possessions.length ?? 0)}>
            Finish
          </Button>
          {onSaveResult && complete && game && (
            <Button
              icon={<FileText size={16} />}
              disabled={saved}
              variant="primary"
              onClick={() => {
                onSaveResult(game.result);
                setSaved(true);
              }}
            >
              {saved ? "Saved" : "Save Result"}
            </Button>
          )}
        </div>
      </article>

      {!game ? (
        <article className="panel empty-play-panel">
          <h3>Ready</h3>
          <Button icon={<Play size={16} />} onClick={startGame} variant="primary">
            Start Game
          </Button>
        </article>
      ) : compact && watchView === "box" ? (
        <LiveBoxScorePanel
          result={liveResult}
          away={matchup.away}
          home={matchup.home}
          possessionLabel={watchStatusLabel}
          visibleCount={visibleCount}
          totalCount={game.possessions.length}
          complete={complete}
        />
      ) : (
        <div className="possession-layout">
          <article className="panel possession-feed-panel">
            <div className="possession-quarter-header">
              <div className="panel-title possession-feed-title">
                <div>
                  <h3>{activePeriodSummary ? `${activePeriodSummary.label} Possessions` : "Possessions"}</h3>
                  <p>
                    {activePeriodSummary
                      ? `${periodScore(activePeriodSummary)} quarter · ${activePeriodSummary.count.toLocaleString()} possessions · latest first`
                      : "Latest first"}
                  </p>
                </div>
                <span className="badge">{visiblePossessions.length.toLocaleString()}</span>
              </div>
              <div className="period-selector" role="tablist" aria-label="Quarter possessions">
                {periodSummaries.map((period) => {
                  const isActive = period.index === activePeriodSummary?.index;
                  const isLatestPeriod = period.index === latestVisiblePossession?.periodIndex;
                  return (
                    <button
                      key={period.index}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      className={`period-tab ${isActive ? "active" : ""} ${isLatestPeriod && !complete ? "live" : ""}`}
                      onClick={() => selectPeriod(period)}
                    >
                      <span>{period.label}</span>
                      <strong>{periodScore(period)}</strong>
                      <small>
                        {period.count} poss{isLatestPeriod && !complete ? " · live" : ""}
                      </small>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="possession-feed">
              {periodPossessions.map((possession) => (
                <button
                  key={possession.id}
                  type="button"
                  className={`possession-item ${possession.possessionNumber - 1 === selectedIndex ? "active" : ""}`}
                  onClick={() => selectPossession(possession)}
                >
                  <span>
                    #{possession.possessionNumber} {possession.periodLabel}
                  </span>
                  <strong>{traceTeamName(matchup, possession.offenseTeamId)}</strong>
                  <small>{possession.summary}</small>
                  <b>{traceScore(possession.endScore)}</b>
                </button>
              ))}
            </div>
          </article>

          <article className="panel roll-detail-panel">
            {selectedPossession ? (
              <>
                <div className="panel-title">
                  <div>
                    <h3>
                      {selectedPossession.periodLabel} #{selectedPossession.possessionNumber}: {traceTeamName(matchup, selectedPossession.offenseTeamId)}
                    </h3>
                    <p>
                      {traceScore(selectedPossession.startScore)} to {traceScore(selectedPossession.endScore)} · {selectedPossession.points} pts
                    </p>
                  </div>
                  <span className="badge">{selectedPossession.summary}</span>
                </div>
                <div className="roll-step-list">
                  {selectedPossession.steps.map((step, index) => (
                    <div key={`${step.label}-${index}`} className={`roll-step ${rollTone(step.result)}`}>
                      <div>
                        <strong>{step.label}</strong>
                        {step.detail && <span>{step.detail}</span>}
                      </div>
                      <div className="roll-values">
                        <span>Roll {formatTraceNumber(step.roll)}</span>
                        <span>Target {formatTraceNumber(step.target)}</span>
                        <b>{step.result}</b>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="box-note">No possession selected.</p>
            )}
          </article>
        </div>
      )}

      {complete && game && !compact && <ResultPanel result={game.result} away={matchup.away} home={matchup.home} />}
    </div>
  );
}

function LiveBoxScorePanel({
  result,
  away,
  home,
  possessionLabel,
  visibleCount,
  totalCount,
  complete
}: {
  result: GameResult | null;
  away: DiceTeamCard;
  home: DiceTeamCard;
  possessionLabel: string;
  visibleCount: number;
  totalCount: number;
  complete: boolean;
}) {
  const [activePlayerCard, setActivePlayerCard] = useState<{ team: DiceTeamCard; player: DicePlayerCard } | null>(null);
  const teams = [away, home];

  return (
    <article className="panel live-box-score-panel">
      <div className="panel-title live-box-score-title">
        <div>
          <h3>Live Box Score</h3>
          <p>
            {complete ? "Final" : possessionLabel} · {visibleCount}/{totalCount} possessions revealed
          </p>
        </div>
        {result && <span className="badge">{result.awayScore}-{result.homeScore}</span>}
      </div>

      {result ? (
        <>
          {result.quarters.length ? <PeriodScoreboard result={result} away={away} home={home} /> : <p className="box-note">No period scoring yet.</p>}
          <TeamComparison result={result} away={away} home={home} />
          <div className="box-score-sections">
            {teams.map((team) => (
              <TeamBoxScore key={team.id} team={team} result={result} onPlayerSelect={(player) => setActivePlayerCard({ team, player })} />
            ))}
          </div>
        </>
      ) : (
        <p className="empty-state">The live box score will appear after the first possession.</p>
      )}

      {activePlayerCard && <PlayerCardModal team={activePlayerCard.team} player={activePlayerCard.player} onClose={() => setActivePlayerCard(null)} />}
    </article>
  );
}

function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented">
      <span>{label}</span>
      <div className="segment-buttons">
        {options.map((option) => (
          <button key={option.value} type="button" className={value === option.value ? "active" : ""} onClick={() => onChange(option.value)}>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function TeamCatalogRow({
  team,
  active,
  onSelect,
  disabled = false
}: {
  team: SourceTeamCatalogEntry;
  active: boolean;
  onSelect: (teamId: string) => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" className={`team-row ${active ? "active" : ""}`} disabled={disabled} aria-pressed={active} onClick={() => onSelect(team.id)}>
      <TeamLogo team={team} className="team-logo-row" />
      <span className="team-meta">
        <strong>{team.shortName}</strong>
        <small>{team.franchise}</small>
      </span>
      <span className="team-secondary">
        <span className="record">{recordLabel(team)}</span>
      </span>
    </button>
  );
}

function TeamSelectors({
  awayId,
  homeId,
  setAwayId,
  setHomeId,
  seasonChoices,
  sourceTeams
}: {
  awayId: string;
  homeId: string;
  setAwayId: (id: string) => void;
  setHomeId: (id: string) => void;
  seasonChoices: SeasonChoice[];
  sourceTeams: SourceTeamCatalogEntry[];
}) {
  const swapTeams = () => {
    setAwayId(homeId);
    setHomeId(awayId);
  };

  return (
    <div className="matchup-selectors">
      <TeamPicker label="Away" selectedTeamId={awayId} excludedTeamId={homeId} teams={sourceTeams} seasonChoices={seasonChoices} onSelect={setAwayId} />
      <div className="selector-tools">
        <Button icon={<ArrowLeftRight size={16} />} onClick={swapTeams}>
          Swap
        </Button>
      </div>
      <TeamPicker label="Home" selectedTeamId={homeId} excludedTeamId={awayId} teams={sourceTeams} seasonChoices={seasonChoices} onSelect={setHomeId} />
    </div>
  );
}

function TeamPicker({
  label,
  selectedTeamId,
  excludedTeamId,
  teams,
  seasonChoices,
  onSelect
}: {
  label: string;
  selectedTeamId: string;
  excludedTeamId?: string;
  teams: SourceTeamCatalogEntry[];
  seasonChoices: SeasonChoice[];
  onSelect: (teamId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [season, setSeason] = useState(allSeasonsValue);
  const cardOpener = useCardOpener();
  const selectedTeam = teams.find((team) => team.id === selectedTeamId);
  const filteredTeams = useMemo(() => filterCatalogTeams(teams, { season, query }), [query, season, teams]);
  const visibleTeams = filteredTeams.filter((team) => team.id !== excludedTeamId).slice(0, maxTeamPickerResults);

  return (
    <section className="team-picker">
      <div className="team-picker-header">
        <span>{label}</span>
        {selectedTeam && <strong>{selectedTeam.shortName}</strong>}
      </div>
      {selectedTeam && (
        <button type="button" className="team-picker-selected team-picker-selected-button" onClick={() => cardOpener?.openTeamCard(selectedTeam.id)}>
          <TeamLogo team={selectedTeam} className="team-logo-selected" />
          <span className="team-picker-selected-main">
            <strong>{selectedTeam.name}</strong>
            <small>
              {selectedTeam.season} · {selectedTeam.franchise}
            </small>
          </span>
          <span className="record">{recordLabel(selectedTeam)}</span>
        </button>
      )}
      <div className="team-picker-controls">
        <label className="search-field compact">
          Search
          <span>
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="team, year, franchise..." />
          </span>
        </label>
        <label>
          Season
          <select value={season} onChange={(event) => setSeason(event.target.value)}>
            <option value={allSeasonsValue}>All seasons</option>
            {seasonChoices.map((choice) => (
              <option key={choice.season} value={choice.season}>
                {choice.season}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="result-count">
        <ListFilter size={15} />
        <span>
          Showing {visibleTeams.length.toLocaleString()} of {filteredTeams.length.toLocaleString()}
        </span>
      </div>
      <div className="team-picker-results">
        {visibleTeams.map((team) => (
          <TeamCatalogRow key={team.id} team={team} active={team.id === selectedTeamId} onSelect={onSelect} />
        ))}
        {!visibleTeams.length && <p className="empty-state">No teams match.</p>}
      </div>
    </section>
  );
}

function ScreenGameCard({ matchup }: { matchup: MatchupCard }) {
  return (
    <div className="card-preview">
      <PrintableGameCard matchup={matchup} />
    </div>
  );
}

function PrintableGameCard({ matchup }: { matchup: MatchupCard }) {
  return (
    <section className="print-page game-card">
      <div className="game-card-title">
        <TeamLogo team={matchup.away} className="team-logo-print" />
        <h2>
          {matchup.away.shortName} at {matchup.home.shortName}
        </h2>
        <TeamLogo team={matchup.home} className="team-logo-print" />
      </div>
      <div className="print-grid two">
        <div className="matchup-table-frame">
          <table className="matchup-card-table matchup-summary-table">
            <tbody>
              <tr>
                <th>Context</th>
                <td>{matchup.context.label}</td>
              </tr>
              <tr>
                <th>Home court</th>
                <td>{matchup.context.venue === "home-court" ? `${matchup.home.shortName} (${matchup.context.homeCourtAdvantagePoints.toFixed(1)} pts)` : "None"}</td>
              </tr>
              <tr>
                <th>Rotation</th>
                <td>{matchup.context.useWeightMode === "playoff-tightened" ? "Playoff tightened" : "Regular"}</td>
              </tr>
              <tr>
                <th>Pace factor</th>
                <td>{matchup.context.paceMultiplier.toFixed(2)}</td>
              </tr>
              <tr>
                <th>Possessions per team</th>
                <td>{matchup.possessionsEach}</td>
              </tr>
              <tr>
                <th>Quarter split</th>
                <td>
                  Q1 {matchup.quarters[0]} / Q2 {matchup.quarters[1]} / Q3 {matchup.quarters[2]} / Q4 {matchup.quarters[3]}
                </td>
              </tr>
              <tr>
                <th>Overtime</th>
                <td>OT {matchup.overtimePossessionsEach} possessions per team</td>
              </tr>
              <tr>
                <th>Loose foul check</th>
                <td>{matchup.looseFoulRange}</td>
              </tr>
              <tr>
                <th>Steal on turnover</th>
                <td>{matchup.stealOnTurnoverRange}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <MatchupStaticPanel matchup={matchup} />
      </div>

      <PlayerRangesTable title={`${matchup.away.shortName} offense vs ${matchup.home.shortName} defense`} team={matchup.away} rows={matchup.awayPlayerRanges} />
      <PlayerRangesTable title={`${matchup.home.shortName} offense vs ${matchup.away.shortName} defense`} team={matchup.home} rows={matchup.homePlayerRanges} />

      <div className="print-break" />
      <h2>Assignment Matrix</h2>
      {[matchup.away, matchup.home].map((team) => (
        <AssignmentMatrix key={team.id} team={team} matchup={matchup} />
      ))}
    </section>
  );
}

function MatchupStaticPanel({ matchup }: { matchup: MatchupCard }) {
  const away = matchup.awayStatic;
  const home = matchup.homeStatic;
  const pair = (awayValue: string, homeValue: string) => (
    <dd>
      <span>{awayValue}</span>
      <span>{homeValue}</span>
    </dd>
  );

  return (
    <section className="matchup-static-panel" aria-label="Matchup modifiers">
      <header className="matchup-static-legend">
        <strong>{matchup.away.shortName}</strong>
        <span>vs</span>
        <strong>{matchup.home.shortName}</strong>
      </header>
      <div className="matchup-static-groups">
        <div className="matchup-static-group">
          <span>Core checks</span>
          <dl>
            <div>
              <dt>ORB</dt>
              {pair(away.ranges.orb, home.ranges.orb)}
            </div>
            <div>
              <dt>BLK</dt>
              {pair(away.ranges.block, home.ranges.block)}
            </div>
            <div>
              <dt>Foul end</dt>
              {pair(away.ranges.foulEndsPossession, home.ranges.foulEndsPossession)}
            </div>
            <div>
              <dt>AST 2</dt>
              {pair(away.ranges.ast2, home.ranges.ast2)}
            </div>
            <div>
              <dt>AST 3</dt>
              {pair(away.ranges.ast3, home.ranges.ast3)}
            </div>
          </dl>
        </div>
        <div className="matchup-static-group">
          <span>ORB by shot</span>
          <dl>
            <div>
              <dt>Rim</dt>
              {pair(away.ranges.orbRim, home.ranges.orbRim)}
            </div>
            <div>
              <dt>Short</dt>
              {pair(away.ranges.orbShortMid, home.ranges.orbShortMid)}
            </div>
            <div>
              <dt>Long</dt>
              {pair(away.ranges.orbLongMid, home.ranges.orbLongMid)}
            </div>
            <div>
              <dt>3P</dt>
              {pair(away.ranges.orbThree, home.ranges.orbThree)}
            </div>
          </dl>
        </div>
        <div className="matchup-static-group">
          <span>Shot adjustments</span>
          <dl>
            <div>
              <dt>Ctx</dt>
              {pair(shotAdjustmentLabel(away.contextShotAdjustment), shotAdjustmentLabel(home.contextShotAdjustment))}
            </div>
            <div>
              <dt>PO</dt>
              {pair(signedLabel(away.playoffLeverageShotAdjustment), signedLabel(home.playoffLeverageShotAdjustment))}
            </div>
            <div>
              <dt>Era</dt>
              {pair(signedLabel(away.eraTalentAdjustment.talentDelta), signedLabel(home.eraTalentAdjustment.talentDelta))}
            </div>
            <div>
              <dt>Def</dt>
              {pair(shotAdjustmentLabel(away.defenseShotAdjustment), shotAdjustmentLabel(home.defenseShotAdjustment))}
            </div>
            <div>
              <dt>Total</dt>
              {pair(shotAdjustmentLabel(away.totalShotAdjustment), shotAdjustmentLabel(home.totalShotAdjustment))}
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}

function PlayerRangesTable({ title, team, rows }: { title: string; team: DiceTeamCard; rows: MatchupCard["awayPlayerRanges"] }) {
  return (
    <>
      <h3>{title}</h3>
      <div className="matchup-table-frame">
        <table className="matchup-card-table matchup-player-ranges-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Use</th>
              <th>TOV</th>
              <th>TOV Type</th>
              <th>Live TOV</th>
              <th>Off Foul TOV</th>
              <th>Foul</th>
              <th>Shot</th>
              <th>Profile</th>
              <th>Conf</th>
              <th>Rim</th>
              <th>Short 2</th>
              <th>Long 2</th>
              <th>3P</th>
              <th>Rim Make</th>
              <th>Short Make</th>
              <th>Long Make</th>
              <th>3P Make</th>
              <th>FT</th>
              <th>And-1</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.player}>
                <td className="matchup-player-cell">
                  <PlayerNameButton teamId={team.id} player={row.player} />
                </td>
                <td>{row.use}</td>
                <td>{row.tov}</td>
                <td>{row.turnoverProfile === "play-by-play" ? "PBP" : "Agg"}</td>
                <td>{row.liveBallTurnover}</td>
                <td>{row.offensiveFoulTurnover}</td>
                <td>{row.foul}</td>
                <td>{row.shot}</td>
                <td>{shotProfileLabel(row)}</td>
                <td>{row.shotProfileConfidence.toFixed(2)}</td>
                <td>{row.rim}</td>
                <td>{row.shortMid}</td>
                <td>{row.longMid}</td>
                <td>{row.three}</td>
                <td>{row.rimMake}</td>
                <td>{row.shortMidMake}</td>
                <td>{row.longMidMake}</td>
                <td>{row.p3}</td>
                <td>{row.ft}</td>
                <td>{row.andOne}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AssignmentMatrix({ team, matchup }: { team: DiceTeamCard; matchup: MatchupCard }) {
  const events = ["Use", "AST", "OREB", "DREB", "STL", "BLK", "PF", "ShootingPF"] as const;
  return (
    <>
      <h3>
        <TeamTextButton team={team} />
      </h3>
      <div className="matchup-table-frame">
        <table className="matchup-card-table matchup-assignment-table">
          <thead>
            <tr>
              <th>Player</th>
              {events.map((event) => (
                <th key={event}>{event === "ShootingPF" ? "Shoot PF" : event}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {team.players.map((player) => (
              <tr key={player.id}>
                <td className="matchup-player-cell">
                  <PlayerIdentity player={player} />
                </td>
                {events.map((event) => (
                  <td key={event}>{matchup.assignments[team.id][event].find((row) => row.label === player.name)?.range ?? "-"}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Simulator({
  awayId,
  homeId,
  away,
  home,
  matchup,
  matchupOptions,
  setMatchupOptions,
  setAwayId,
  setHomeId,
  seasonChoices,
  sourceTeams
}: {
  awayId: string;
  homeId: string;
  away: DiceTeamCard;
  home: DiceTeamCard;
  matchup: MatchupCard;
  matchupOptions: MatchupOptions;
  setMatchupOptions: (options: MatchupOptions) => void;
  setAwayId: (id: string) => void;
  setHomeId: (id: string) => void;
  seasonChoices: SeasonChoice[];
  sourceTeams: SourceTeamCatalogEntry[];
}) {
  const [mode, setMode] = useState<SimulatorMode>("simulate");
  const [simulationRunMode, setSimulationRunMode] = useState<SimulationRunMode>("single");
  const [result, setResult] = useState<GameResult | null>(null);
  const [bulkGames, setBulkGames] = useState(500);
  const [bulk, setBulk] = useState<ReturnType<typeof summarizeSimulations> | null>(null);
  const [takenAwayPlayerId, setTakenAwayPlayerId] = useState("");
  const expectedLine = useMemo(() => buildExpectedMatchupLine(away, home, matchupOptions), [away, home, matchupOptions]);
  const takenAwayPlayer = useMemo(() => {
    for (const team of [away, home]) {
      const player = team.players.find((candidate) => candidate.id === takenAwayPlayerId);
      if (player) return { team, player };
    }
    return null;
  }, [away, home, takenAwayPlayerId]);
  const simulationOptions = useMemo<SimulationOptions>(
    () => ({
      ...matchupOptions,
      unavailablePlayerIds: takenAwayPlayerId ? [takenAwayPlayerId] : []
    }),
    [matchupOptions, takenAwayPlayerId]
  );
  const optionsKey = matchupOptionsKey(matchupOptions);

  useEffect(() => {
    setResult(null);
    setBulk(null);
  }, [away.id, home.id, optionsKey, takenAwayPlayerId]);

  useEffect(() => {
    if (!takenAwayPlayerId) return;
    if ([away, home].some((team) => team.players.some((player) => player.id === takenAwayPlayerId))) return;
    setTakenAwayPlayerId("");
  }, [away, home, takenAwayPlayerId]);

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h2>Simulator</h2>
          <p>Choose a live play-through or instant simulation for the selected matchup.</p>
        </div>
      </header>

      <div className="mode-tabs">
        <button type="button" className={mode === "simulate" ? "active" : ""} onClick={() => setMode("simulate")}>
          <BarChart3 size={16} />
          <span>Simulate</span>
        </button>
        <button type="button" className={mode === "play" ? "active" : ""} onClick={() => setMode("play")}>
          <Play size={16} />
          <span>Play Game</span>
        </button>
      </div>

      <MatchupSetupPanel
        awayId={awayId}
        homeId={homeId}
        setAwayId={setAwayId}
        setHomeId={setHomeId}
        matchup={matchup}
        matchupOptions={matchupOptions}
        setMatchupOptions={setMatchupOptions}
        seasonChoices={seasonChoices}
        sourceTeams={sourceTeams}
      />
      <ExpectedMatchupPanel expected={expectedLine} away={away} home={home} />

      <article className="panel simulation-availability-panel">
        <div className="panel-title">
          <div>
            <h3>Availability</h3>
          </div>
          <span className="badge">{takenAwayPlayer ? "1 unavailable" : "Full rotation"}</span>
        </div>
        <div className="availability-controls">
          <label className="inline-input availability-player-select">
            Take Away
            <select value={takenAwayPlayerId} onChange={(event) => setTakenAwayPlayerId(event.target.value)}>
              <option value="">None</option>
              {[away, home].map((team) => (
                <optgroup key={team.id} label={`${team.shortName} ${team.season}`}>
                  {team.players.map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          {takenAwayPlayer && (
            <span className="badge">
              {takenAwayPlayer.team.shortName}: {takenAwayPlayer.player.name}
            </span>
          )}
        </div>
      </article>

      {mode === "play" ? (
        <PlayableMatchup matchup={matchup} matchupOptions={simulationOptions} title="Play Game" />
      ) : (
        <>
          <article className="panel">
            <div className="panel-title">
              <div>
                <h3>Simulation</h3>
                <p>{simulationRunMode === "single" ? "Run one final score for the selected matchup." : "Summarize repeated games for the selected matchup."}</p>
              </div>
              <SegmentedControl<SimulationRunMode>
                label="Run type"
                value={simulationRunMode}
                options={[
                  { value: "single", label: "Single Game" },
                  { value: "batch", label: "Batch Summary" }
                ]}
                onChange={setSimulationRunMode}
              />
            </div>
            {simulationRunMode === "single" ? (
              <div className="simulation-controls">
                <Button icon={<Play size={16} />} variant="primary" onClick={() => setResult(simulateGame(away, home, Date.now(), "simulated", simulationOptions))}>
                  Sim One
                </Button>
              </div>
            ) : (
              <div className="simulation-controls">
                <label className="inline-input">
                  Games
                  <input type="number" min={1} max={10000} value={bulkGames} onChange={(event) => setBulkGames(Number(event.target.value))} />
                </label>
                <Button icon={<BarChart3 size={16} />} onClick={() => setBulk(summarizeSimulations(away, home, bulkGames, Date.now(), simulationOptions))}>
                  Sim Many
                </Button>
              </div>
            )}
          </article>

          {simulationRunMode === "single" && result && <ResultPanel result={result} away={away} home={home} />}
          {simulationRunMode === "batch" && bulk && (
            <article className="panel">
              <h3>{bulk.games.toLocaleString()} Game Summary</h3>
              <div className="metric-grid">
                {[away, home].map((team) => (
                  <div className="metric" key={team.id}>
                    <span>
                      <TeamTextButton team={team} /> win rate
                    </span>
                    <strong>{pct(bulk.wins[team.id] ?? 0, bulk.games)}</strong>
                  </div>
                ))}
                <div className="metric">
                  <span>OT rate</span>
                  <strong>{pct(bulk.overtimeGames ?? 0, bulk.games)}</strong>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Team</th>
                      <th>PTS</th>
                      <th>FGA</th>
                      <th>3PA</th>
                      <th>FTA</th>
                      <th>REB</th>
                      <th>AST</th>
                      <th>STL</th>
                      <th>BLK</th>
                      <th>TOV</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[away, home].map((team) => (
                      <tr key={team.id}>
                        <td>
                          <TeamIdentityButton team={team} className="standings-team compact-team-identity" />
                        </td>
                        {["PTS", "FGA", "3PA", "FTA", "REB", "AST", "STL", "BLK", "TOV"].map((field) => (
                          <td key={field}>{round(bulk.teams[team.id][field])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          )}
        </>
      )}
    </section>
  );
}

function teamScore(result: GameResult, team: DiceTeamCard): number {
  if (team.id === result.awayTeamId) return result.awayScore;
  if (team.id === result.homeTeamId) return result.homeScore;
  return stat(result.teamStats[team.id], "PTS");
}

function periodLabel(index: number, periodCount: number): string {
  if (index < 4) return `Q${index + 1}`;
  return periodCount === 5 ? "OT" : `OT${index - 3}`;
}

function boxScoreValue(line: StatLine | undefined, column: (typeof boxScoreColumns)[number]): string {
  if (column === "FG") return statPair(line, "FGM", "FGA");
  if (column === "FG%") return statPercent(line, "FGM", "FGA");
  if (column === "3PT") return statPair(line, "3PM", "3PA");
  if (column === "3P%") return statPercent(line, "3PM", "3PA");
  if (column === "FT") return statPair(line, "FTM", "FTA");
  if (column === "FT%") return statPercent(line, "FTM", "FTA");
  return String(stat(line, column));
}

function playerBoxScoreNames(team: DiceTeamCard, result: GameResult): string[] {
  const stats = result.playerStats[team.id] ?? {};
  const rotationNames = team.players.map((player) => player.name);
  const rotationSet = new Set(rotationNames);
  return [...rotationNames.filter((name) => stats[name]), ...Object.keys(stats).filter((name) => !rotationSet.has(name))];
}

function rotationPlayerGroups(players: DicePlayerCard[]): { starters: DicePlayerCard[]; bench: DicePlayerCard[] } {
  const starters = [...players]
    .sort((a, b) => (b.source.gamesStarted ?? 0) - (a.source.gamesStarted ?? 0) || b.minutes - a.minutes)
    .slice(0, 5);
  const starterIds = new Set(starters.map((player) => player.id));
  return {
    starters,
    bench: players.filter((player) => !starterIds.has(player.id))
  };
}

function boxScoreGroups(team: DiceTeamCard, result: GameResult): { starters: string[]; bench: string[] } {
  const names = playerBoxScoreNames(team, result);
  const nameSet = new Set(names);
  const starterNames = rotationPlayerGroups(team.players).starters
    .map((player) => player.name)
    .filter((name) => nameSet.has(name));
  const starterSet = new Set(starterNames);
  return {
    starters: starterNames,
    bench: names.filter((name) => !starterSet.has(name))
  };
}

function ResultPanel({ result, away, home }: { result: GameResult; away: DiceTeamCard; home: DiceTeamCard }) {
  return (
    <article className="panel result-panel">
      <GameResultContent result={result} away={away} home={home} />
    </article>
  );
}

function GameResultContent({ result, away, home, showHeader = true }: { result: GameResult; away: DiceTeamCard; home: DiceTeamCard; showHeader?: boolean }) {
  const teams = [away, home];
  const playedAt = new Date(result.playedAt);
  const [activePlayerCard, setActivePlayerCard] = useState<{ team: DiceTeamCard; player: DicePlayerCard } | null>(null);
  const [activeTeamCard, setActiveTeamCard] = useState<DiceTeamCard | null>(null);
  return (
    <>
      {showHeader && (
        <div className="result-header">
          <div className="final-score-grid">
            {teams.map((team) => {
              const score = teamScore(result, team);
              const winner = result.winnerTeamId === team.id;
              return (
                <button key={team.id} type="button" className={`final-score-card ${winner ? "winner" : ""}`} onClick={() => setActiveTeamCard(team)}>
                  <span className="score-role">{team.id === away.id ? "Away" : "Home"}</span>
                  <TeamLogo team={team} className="team-logo-score" />
                  <div>
                    <strong>{team.shortName}</strong>
                    <span>{team.name}</span>
                  </div>
                  <b>{score}</b>
                </button>
              );
            })}
          </div>
          <div className="game-meta-list">
            <span className={`status ${result.source}`}>{result.source}</span>
            <span>{result.possessionsEach} poss/team</span>
            {result.model && <span>{result.model.modelVersion}</span>}
            {result.model && <span>{result.model.contextLabel}</span>}
            {result.model && (
              <span>
                Exp {formatNumber(result.model.expected.awayScore, 1)}-{formatNumber(result.model.expected.homeScore, 1)}
              </span>
            )}
            <span>{Number.isNaN(playedAt.getTime()) ? "-" : playedAt.toLocaleString()}</span>
          </div>
        </div>
      )}

      {result.quarters.length ? <PeriodScoreboard result={result} away={away} home={home} /> : <p className="box-note">Manual entry has no period scoring.</p>}

      <TeamComparison result={result} away={away} home={home} />
      <ResultAvailabilityEvents result={result} teams={teams} />

      <div className="box-score-sections">
        {teams.map((team) => (
          <TeamBoxScore key={team.id} team={team} result={result} onPlayerSelect={(player) => setActivePlayerCard({ team, player })} />
        ))}
      </div>
      {activePlayerCard && <PlayerCardModal team={activePlayerCard.team} player={activePlayerCard.player} onClose={() => setActivePlayerCard(null)} />}
      {activeTeamCard && <TeamCardModal team={activeTeamCard} onClose={() => setActiveTeamCard(null)} />}
    </>
  );
}

function ResultAvailabilityEvents({ result, teams }: { result: GameResult; teams: DiceTeamCard[] }) {
  const events = result.playerAvailabilityEvents ?? [];
  if (!events.length) return null;
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  return (
    <div className="availability-event-list">
      {events.map((event, index) => {
        const team = teamsById.get(event.teamId);
        const detail =
          event.reason === "fouled-out"
            ? `Fouled out${event.fouls ? ` at ${event.fouls} PF` : ""}${event.periodLabel ? `, ${event.periodLabel}` : ""}`
            : "Taken away";
        return (
          <div key={`${event.playerId}-${event.reason}-${index}`} className="availability-event">
            {team && <TeamLogo team={team} className="team-logo-mini" />}
            <span>
              <strong>{event.player}</strong>
              <small>
                {team?.shortName ?? event.teamId} · {detail}
              </small>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function PeriodScoreboard({ result, away, home }: { result: GameResult; away: DiceTeamCard; home: DiceTeamCard }) {
  return (
    <div className="table-wrap period-scoreboard">
      <table>
        <thead>
          <tr>
            <th>Team</th>
            {result.quarters.map((_, index) => (
              <th key={index}>{periodLabel(index, result.quarters.length)}</th>
            ))}
            <th>Final</th>
          </tr>
        </thead>
        <tbody>
          {[away, home].map((team) => (
            <tr key={team.id}>
              <th scope="row">
                <TeamIdentityButton team={team} className="standings-team compact-team-identity" />
              </th>
              {result.quarters.map((quarter, index) => (
                <td key={index}>{team.id === away.id ? quarter.away : quarter.home}</td>
              ))}
              <td className="strong-cell">{teamScore(result, team)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TeamComparison({ result, away, home }: { result: GameResult; away: DiceTeamCard; home: DiceTeamCard }) {
  const rows: Array<[string, (line: StatLine | undefined) => string]> = [
    ["FG", (line: StatLine | undefined) => statPair(line, "FGM", "FGA")],
    ["FG%", (line: StatLine | undefined) => statPercent(line, "FGM", "FGA")],
    ["3PT", (line: StatLine | undefined) => statPair(line, "3PM", "3PA")],
    ["FT", (line: StatLine | undefined) => statPair(line, "FTM", "FTA")],
    ["REB", (line: StatLine | undefined) => String(stat(line, "REB"))],
    ["AST/TOV", (line: StatLine | undefined) => `${stat(line, "AST")}/${stat(line, "TOV")}`],
    ["STL+BLK", (line: StatLine | undefined) => String(stat(line, "STL") + stat(line, "BLK"))],
    ["PF", (line: StatLine | undefined) => String(stat(line, "PF"))]
  ];

  return (
    <div className="table-wrap team-comparison">
      <table>
        <thead>
          <tr>
            <th>Team</th>
            {rows.map(([label]) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[away, home].map((team) => (
            <tr key={team.id}>
              <th scope="row">
                <TeamIdentityButton team={team} className="standings-team compact-team-identity" />
              </th>
              {rows.map(([label, render]) => (
                <td key={label}>{render(result.teamStats[team.id])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TeamBoxScore({ team, result, onPlayerSelect }: { team: DiceTeamCard; result: GameResult; onPlayerSelect?: (player: DicePlayerCard) => void }) {
  const groups = boxScoreGroups(team, result);
  const playerStats = result.playerStats[team.id] ?? {};
  const teamLine = result.teamStats[team.id] ?? {};
  const playersByName = new Map(team.players.map((player) => [player.name, player]));
  const cardOpener = useCardOpener();
  const renderPlayerRow = (player: string) => (
    <tr key={player}>
      <td className="player-cell">
        <PlayerIdentity player={playersByName.get(player)} name={player} onSelect={onPlayerSelect} />
      </td>
      {boxScoreColumns.map((column) => (
        <td key={column} className="num-cell">
          {boxScoreValue(playerStats[player], column)}
        </td>
      ))}
    </tr>
  );
  return (
    <section className="box-score-team">
      <div className="box-score-team-header">
        <button type="button" className="box-score-team-identity" onClick={() => cardOpener?.openTeamCard(team)}>
          <TeamLogo team={team} className="team-logo-selected" />
          <span>
            <h3>{team.shortName} Box Score</h3>
            <p>{team.name}</p>
          </span>
        </button>
        <span className="badge">{teamScore(result, team)} PTS</span>
      </div>
      <div className="table-wrap box-score-wrap">
        <table className="box-score-table">
          <thead>
            <tr>
              <th className="player-cell">Starters</th>
              {boxScoreColumns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.starters.map(renderPlayerRow)}
            {groups.bench.length > 0 && (
              <tr className="box-score-group-row">
                <th className="player-cell" scope="row">
                  Bench
                </th>
                <td colSpan={boxScoreColumns.length} />
              </tr>
            )}
            {groups.bench.map(renderPlayerRow)}
          </tbody>
          <tfoot>
            <tr>
              <td className="player-cell">Team Totals</td>
              {boxScoreColumns.map((column) => (
                <td key={column} className="num-cell">
                  {boxScoreValue(teamLine, column)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function TournamentView({
  tournament,
  setTournament,
  seasonChoices,
  defaultSeason,
  sourceTeams,
  teamNames,
  loadTeam
}: {
  tournament: LeagueState | null;
  setTournament: (league: LeagueState | null) => void;
  seasonChoices: SeasonChoice[];
  defaultSeason: string;
  sourceTeams: SourceTeamCatalogEntry[];
  teamNames: Map<string, string>;
  loadTeam: (teamId: string) => Promise<DiceTeamCard>;
}) {
  const [name, setName] = useState("Studio Tournament");
  const [season, setSeason] = useState(defaultSeason);
  const [query, setQuery] = useState("");
  const [franchise, setFranchise] = useState(allSeasonsValue);
  const [selected, setSelected] = useState<string[]>(() => filterCatalogTeams(sourceTeams, { season: defaultSeason }).slice(0, 4).map((team) => team.id));
  const [manualGame, setManualGame] = useState<LeagueGame | null>(null);
  const [pendingGameId, setPendingGameId] = useState<string | null>(null);
  const [leagueError, setLeagueError] = useState<string | null>(null);
  const [section, setSection] = useState<CompetitionSection>("schedule");
  const franchises = useMemo(() => franchiseChoicesFor(sourceTeams), [sourceTeams]);
  const sourceTeamsById = useMemo(() => new Map(sourceTeams.map((team) => [team.id, team])), [sourceTeams]);
  const filteredTeams = useMemo(() => filterCatalogTeams(sourceTeams, { season, query, franchise }), [franchise, query, season, sourceTeams]);
  const visibleTeams = filteredTeams.slice(0, maxLibraryResults);
  const selectedEntries = selected
    .map((teamId) => sourceTeamsById.get(teamId))
    .filter((team): team is SourceTeamCatalogEntry => Boolean(team));

  useEffect(() => {
    setSelected((current) => {
      const validIds = new Set(sourceTeams.map((team) => team.id));
      const kept = current.filter((teamId) => validIds.has(teamId)).slice(0, maxLeagueTeams);
      if (kept.length) return kept;
      return filterCatalogTeams(sourceTeams, { season: defaultSeason }).slice(0, Math.min(4, maxLeagueTeams, sourceTeams.length)).map((team) => team.id);
    });
  }, [defaultSeason, sourceTeams]);

  useEffect(() => {
    if (!tournament) setSection("schedule");
  }, [tournament]);

  const toggle = (teamId: string) => {
    setSelected((current) => {
      if (current.includes(teamId)) return current.filter((id) => id !== teamId);
      if (current.length >= maxLeagueTeams) return current;
      return [...current, teamId];
    });
  };

  const simulateGameInLeague = async (game: LeagueGame) => {
    if (!tournament) return;
    setPendingGameId(game.id);
    setLeagueError(null);
    try {
      const [away, home] = await Promise.all([loadTeam(game.awayTeamId), loadTeam(game.homeTeamId)]);
      setTournament(simulateLeagueGameWithTeams(tournament, game.id, away, home));
    } catch (reason) {
      setLeagueError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPendingGameId(null);
    }
  };

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h2>Tournament</h2>
          <p>Create a small double round-robin, then mark games simulated, manual, or unplayed.</p>
        </div>
        {tournament && (
          <Button icon={<RotateCcw size={16} />} variant="danger" onClick={() => setTournament(null)}>
            Reset Tournament
          </Button>
        )}
      </header>

      {!tournament ? (
        <article className="panel">
          <div className="form-row">
            <label>
              Tournament name
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
          </div>
          <div className="league-toolbar">
            <label className="search-field">
              Search
              <span>
                <Search size={16} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="team, year, franchise..." />
              </span>
            </label>
            <div className="filter-grid">
              <label>
                Season
                <select value={season} onChange={(event) => setSeason(event.target.value)}>
                  <option value={allSeasonsValue}>All seasons</option>
                  {seasonChoices.map((choice) => (
                    <option key={choice.season} value={choice.season}>
                      {choice.season}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Franchise
                <select value={franchise} onChange={(event) => setFranchise(event.target.value)}>
                  <option value={allSeasonsValue}>All franchises</option>
                  {franchises.map((choice) => (
                    <option key={choice} value={choice}>
                      {choice}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <div className="selected-team-list">
            {selectedEntries.map((team) => (
              <button key={team.id} type="button" className="selected-team-pill" onClick={() => toggle(team.id)}>
                <TeamLogo team={team} className="selected-team-logo" />
                <strong>{team.shortName}</strong>
                <span>{team.season}</span>
              </button>
            ))}
          </div>
          <div className="result-count">
            <ListFilter size={15} />
            <span>
              {selected.length} selected · showing {visibleTeams.length.toLocaleString()} of {filteredTeams.length.toLocaleString()} matches
            </span>
          </div>
          <div className="team-check-grid catalog-check-grid">
            {visibleTeams.map((team) => (
              <label key={team.id} className={`check-card ${selected.includes(team.id) ? "active" : ""}`}>
                <input
                  type="checkbox"
                  checked={selected.includes(team.id)}
                  disabled={!selected.includes(team.id) && selected.length >= maxLeagueTeams}
                  onChange={() => toggle(team.id)}
                />
                <TeamLogo team={team} className="team-logo-check" />
                <span>
                  <strong>{team.shortName}</strong>
                  <small>
                    {team.season} · {recordLabel(team)}
                  </small>
                </span>
              </label>
            ))}
          </div>
          <Button
            icon={<CalendarDays size={16} />}
            variant="primary"
            disabled={selected.length < 2 || selected.length > maxLeagueTeams}
            onClick={() => setTournament(createTournament(name, selected))}
          >
            Create Schedule
          </Button>
        </article>
      ) : (
        <>
          <div className="mode-tabs league-tabs">
            <button type="button" className={section === "schedule" ? "active" : ""} onClick={() => setSection("schedule")}>
              <CalendarDays size={16} />
              <span>Schedule</span>
            </button>
            <button type="button" className={section === "standings" ? "active" : ""} onClick={() => setSection("standings")}>
              <BarChart3 size={16} />
              <span>Standings</span>
            </button>
            <button type="button" className={section === "leaders" ? "active" : ""} onClick={() => setSection("leaders")}>
              <Trophy size={16} />
              <span>Leaders</span>
            </button>
          </div>
          {leagueError && (
            <article className="panel">
              <h3>League Action Failed</h3>
              <p>{leagueError}</p>
            </article>
          )}
          {section === "schedule" && (
            <article className="panel">
              <h3>Schedule</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Game</th>
                      <th>Status</th>
                      <th>Score</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tournament.games.map((game) => (
                      <tr key={game.id}>
                        <td>
                          <TeamTextButton teamId={game.awayTeamId} teamNames={teamNames} /> at <TeamTextButton teamId={game.homeTeamId} teamNames={teamNames} />
                        </td>
                        <td>
                          <span className={`status ${game.status}`}>{game.status}</span>
                        </td>
                        <td>{game.result ? `${game.result.awayScore}-${game.result.homeScore}` : "-"}</td>
                        <td className="row-actions">
                          <Button data-testid={`sim-${game.id}`} icon={<Play size={14} />} disabled={pendingGameId === game.id} onClick={() => void simulateGameInLeague(game)}>
                            Sim
                          </Button>
                          <Button
                            data-testid={`manual-${game.id}`}
                            icon={<FileText size={14} />}
                            onMouseDown={() => setManualGame(game)}
                            onClick={() => setManualGame(game)}
                          >
                            Manual
                          </Button>
                          <Button data-testid={`unplayed-${game.id}`} icon={<RotateCcw size={14} />} onClick={() => setTournament(markUnplayed(tournament, game.id))}>
                            Unplayed
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          )}
          {section === "standings" && <StandingsTable league={tournament} teamNames={teamNames} sourceTeamsById={sourceTeamsById} />}
          {section === "leaders" && <LeagueLeaders league={tournament} teamNames={teamNames} sourceTeamsById={sourceTeamsById} />}
          {manualGame && (
            <ManualResultFormLoader
              game={manualGame}
              league={tournament}
              setLeague={setTournament}
              onClose={() => setManualGame(null)}
              loadTeam={loadTeam}
            />
          )}
        </>
      )}
    </section>
  );
}

function SeasonLeagueView({
  leagues,
  activeLeagueId,
  league,
  setActiveLeagueId,
  setLeague,
  deleteLeague,
  seasonChoices,
  defaultSeason,
  sourceTeams,
  teamNames,
  loadTeam
}: {
  leagues: LeagueState[];
  activeLeagueId: string | null;
  league: LeagueState | null;
  setActiveLeagueId: (leagueId: string) => void;
  setLeague: (league: LeagueState) => void;
  deleteLeague: (leagueId: string) => void;
  seasonChoices: SeasonChoice[];
  defaultSeason: string;
  sourceTeams: SourceTeamCatalogEntry[];
  teamNames: Map<string, string>;
  loadTeam: (teamId: string) => Promise<DiceTeamCard>;
}) {
  const [name, setName] = useState("NBA Season");
  const [season, setSeason] = useState(defaultSeason);
  const [selected, setSelected] = useState<string[]>(() => seasonRoster(sourceTeams, defaultSeason).slice(0, maxLeagueTeams).map((team) => team.id));
  const [activeSlot, setActiveSlot] = useState(0);
  const [replaceQuery, setReplaceQuery] = useState("");
  const [replaceSeason, setReplaceSeason] = useState(allSeasonsValue);
  const [replaceFranchise, setReplaceFranchise] = useState(allSeasonsValue);
  const [manualGame, setManualGame] = useState<LeagueGame | null>(null);
  const [watchGame, setWatchGame] = useState<ScheduledLeagueGame | null>(null);
  const [infoGame, setInfoGame] = useState<ScheduledLeagueGame | null>(null);
  const [pendingGameId, setPendingGameId] = useState<string | null>(null);
  const [leagueError, setLeagueError] = useState<string | null>(null);
  const [section, setSection] = useState<CompetitionSection>("schedule");
  const [scheduleTeamId, setScheduleTeamId] = useState(allTeamsValue);
  const [scheduleStatus, setScheduleStatus] = useState<LeagueStatusFilter>("all");
  const [scheduleWeekStart, setScheduleWeekStart] = useState("");
  const [focusTeamId, setFocusTeamId] = useState(allTeamsValue);
  const [batchRequest, setBatchRequest] = useState<LeagueBatchSimulationRequest | null>(null);
  const [mode, setMode] = useState<LeagueViewMode>("select");
  const [renamingLeagueId, setRenamingLeagueId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const franchises = useMemo(() => franchiseChoicesFor(sourceTeams), [sourceTeams]);
  const sourceTeamsById = useMemo(() => new Map(sourceTeams.map((team) => [team.id, team])), [sourceTeams]);
  const commitLeague = useCallback((nextLeague: LeagueState) => setLeague(syncLeaguePlayoffs(nextLeague)), [setLeague]);
  const selectedEntries = selected.map((teamId) => sourceTeamsById.get(teamId)).filter((team): team is SourceTeamCatalogEntry => Boolean(team));
  const leagueTeamEntries = (league?.teamIds ?? []).map((teamId) => sourceTeamsById.get(teamId)).filter((team): team is SourceTeamCatalogEntry => Boolean(team));
  const leagueTeamKey = league?.teamIds.join("|") ?? "";
  const replacementTeams = useMemo(
    () => filterCatalogTeams(sourceTeams, { season: replaceSeason, query: replaceQuery, franchise: replaceFranchise }).slice(0, maxTeamPickerResults),
    [replaceFranchise, replaceQuery, replaceSeason, sourceTeams]
  );
  const scheduledGames = useMemo<ScheduledLeagueGame[]>(() => scheduleLeagueGames(league), [league]);
  const regularScheduledGames = useMemo(() => scheduledGames.filter(isRegularSeasonGame), [scheduledGames]);
  const postseasonScheduledGames = useMemo(() => scheduledGames.filter(isPostseasonGame), [scheduledGames]);
  const leagueStandingsRows = useMemo(() => (league ? standings(league) : []), [league]);
  const leagueRecordByTeamId = useMemo(
    () => new Map(leagueStandingsRows.map((row) => [row.teamId, standingsRecordLabel(row)])),
    [leagueStandingsRows]
  );
  const firstScheduleDate = regularScheduledGames[0]?.date ?? "";
  const lastScheduleDate = regularScheduledGames[regularScheduledGames.length - 1]?.date ?? "";
  const firstScheduleWeekStart = firstScheduleDate ? startOfCalendarWeekIso(firstScheduleDate) : "";
  const lastScheduleWeekStart = lastScheduleDate ? startOfCalendarWeekIso(lastScheduleDate) : "";
  const currentLeagueDate = league ? leagueCurrentDate(league, regularScheduledGames) : "";
  const currentWeekEnd = currentLeagueDate ? addDaysIso(currentLeagueDate, 6) : "";
  const currentMonthEnd = currentLeagueDate ? addDaysIso(addMonthsIso(currentLeagueDate, 1), -1) : "";
  const nextLeagueGame = nextUnplayedLeagueGame(regularScheduledGames, currentLeagueDate);
  const nextFocusTeamGame = focusTeamId === allTeamsValue ? null : nextUnplayedLeagueGame(regularScheduledGames, currentLeagueDate, focusTeamId);
  const currentDateGames = currentLeagueDate ? regularScheduledGames.filter((game) => game.date === currentLeagueDate) : [];
  const currentDateFeatureGame = currentDateGames.find((game) => game.status === "unplayed") ?? currentDateGames[0] ?? null;
  const scheduleRangeStart = scheduleWeekStart || (currentLeagueDate ? startOfCalendarWeekIso(currentLeagueDate) : firstScheduleWeekStart);
  const scheduleRangeEnd = scheduleRangeStart ? addDaysIso(scheduleRangeStart, 6) : "";
  const scheduleWeekLabel =
    scheduleRangeStart && scheduleRangeEnd ? `${formatIsoDate(scheduleRangeStart)} through ${formatIsoDate(scheduleRangeEnd)}` : "No scheduled week";
  const scheduleScopeLabel = `${scheduleWeekLabel} · ${scheduleTeamId === allTeamsValue ? "All teams" : teamLabel(teamNames, scheduleTeamId)} · ${leagueStatusFilterLabel(scheduleStatus)}`;
  const filteredScheduleGames = regularScheduledGames.filter((game) => {
    if (scheduleTeamId !== allTeamsValue && game.awayTeamId !== scheduleTeamId && game.homeTeamId !== scheduleTeamId) return false;
    if (scheduleStatus === "played" && !game.result) return false;
    if (scheduleStatus !== "all" && scheduleStatus !== "played" && game.status !== scheduleStatus) return false;
    if (scheduleRangeStart && game.date < scheduleRangeStart) return false;
    if (scheduleRangeEnd && game.date > scheduleRangeEnd) return false;
    return true;
  });
  const filteredUnplayedGames = filteredScheduleGames.filter((game) => game.status === "unplayed");
  const calendarDays = useMemo(() => {
    const grouped = new Map<string, ScheduledLeagueGame[]>();
    for (const game of filteredScheduleGames) {
      grouped.set(game.date, [...(grouped.get(game.date) ?? []), game]);
    }
    return calendarGridDates(scheduleRangeStart, scheduleRangeEnd).map((date) => ({
      date,
      inRange: date >= scheduleRangeStart && date <= scheduleRangeEnd,
      games: grouped.get(date) ?? []
    }));
  }, [filteredScheduleGames, scheduleRangeEnd, scheduleRangeStart]);
  const nextScopedUnplayedDate =
    regularScheduledGames.find((game) => {
      if (game.status !== "unplayed") return false;
      return scheduleTeamId === allTeamsValue || game.awayTeamId === scheduleTeamId || game.homeTeamId === scheduleTeamId;
    })?.date ?? firstScheduleDate;
  const regularSeasonComplete = regularScheduledGames.length > 0 && regularScheduledGames.every((game) => game.status !== "unplayed");
  const postseasonSeeds = useMemo(() => (league ? playoffSeedsForLeague(league, sourceTeamsById) : []), [league, sourceTeamsById]);
  const postseasonChampionTeamId = useMemo(() => (league ? leaguePlayoffChampionTeamId(league) : undefined), [league]);
  const postseasonComplete = Boolean(postseasonChampionTeamId);
  const activeSection: CompetitionSection = postseasonComplete && section === "schedule" ? "leaders" : section;
  const currentRecord = (teamId: string) => leagueRecordByTeamId.get(teamId) ?? "0-0";
  const matchupRecordLabel = (game: Pick<LeagueGame, "awayTeamId" | "homeTeamId">): string =>
    `${currentRecord(game.awayTeamId)} at ${currentRecord(game.homeTeamId)}`;

  useEffect(() => {
    setSelected((current) => {
      const validIds = new Set(sourceTeams.map((team) => team.id));
      const kept = current.filter((teamId) => validIds.has(teamId)).slice(0, maxLeagueTeams);
      if (kept.length) return kept;
      return seasonRoster(sourceTeams, defaultSeason).slice(0, maxLeagueTeams).map((team) => team.id);
    });
  }, [defaultSeason, sourceTeams]);

  useEffect(() => {
    setActiveSlot((current) => Math.min(current, Math.max(0, selected.length - 1)));
  }, [selected.length]);

  useEffect(() => {
    if (!league) setSection("schedule");
  }, [league]);

  useEffect(() => {
    if (mode === "play" && !league) setMode("select");
  }, [league, mode]);

  useEffect(() => {
    if (renamingLeagueId && !leagues.some((savedLeague) => savedLeague.id === renamingLeagueId)) {
      setRenamingLeagueId(null);
      setRenameDraft("");
    }
  }, [leagues, renamingLeagueId]);

  useEffect(() => {
    if (!league) return;
    const persistedFocusTeamId = league.focusTeamId && league.teamIds.includes(league.focusTeamId) ? league.focusTeamId : null;
    setFocusTeamId(persistedFocusTeamId ?? league.teamIds[0] ?? allTeamsValue);
  }, [league?.focusTeamId, league?.id, leagueTeamKey]);

  useEffect(() => {
    if (!league) return;
    const anchorDate = currentLeagueDate || firstScheduleDate;
    const weekStart = anchorDate ? startOfCalendarWeekIso(anchorDate) : "";
    setScheduleTeamId(allTeamsValue);
    setScheduleStatus("all");
    setScheduleWeekStart(weekStart);
    setBatchRequest(null);
  }, [firstScheduleDate, league?.id]);

  useEffect(() => {
    if (!league?.playoffs) return;
    const syncedLeague = syncLeaguePlayoffs(league);
    if (syncedLeague !== league) setLeague(syncedLeague);
  }, [league, setLeague]);

  useEffect(() => {
    if (!postseasonComplete) return;
    if (section === "schedule") setSection("leaders");
    setBatchRequest((current) => (current ? null : current));
  }, [postseasonComplete, section]);

  useEffect(() => {
    setBatchRequest(null);
  }, [scheduleStatus, scheduleTeamId, scheduleWeekStart]);

  const fillFromSeason = (nextSeason: string) => {
    const roster = seasonRoster(sourceTeams, nextSeason).slice(0, maxLeagueTeams);
    setSelected(roster.map((team) => team.id));
    setSeason(nextSeason);
    setActiveSlot(0);
  };

  const applyPreset = (preset: LeaguePreset) => {
    if (preset === "season") {
      fillFromSeason(season);
      return;
    }
    const teams = bestByCanonicalFranchise(sourceTeams, preset === "franchise-best").slice(0, maxLeagueTeams);
    setSelected(teams.map((team) => team.id));
    setActiveSlot(0);
  };

  const replaceSlot = (teamId: string) => {
    setSelected((current) => {
      if (current.some((id, index) => id === teamId && index !== activeSlot)) return current;
      return current.map((id, index) => (index === activeSlot ? teamId : id));
    });
  };

  const simulateGameInLeague = async (game: LeagueGame) => {
    if (!league) return;
    setPendingGameId(game.id);
    setLeagueError(null);
    try {
      const [away, home] = await Promise.all([loadTeam(game.awayTeamId), loadTeam(game.homeTeamId)]);
      const nextLeague = simulateLeagueGameWithTeams(league, game.id, away, home, Date.now(), leagueGameMatchupOptions(game, league));
      const gameDate = scheduledGames.find((scheduledGame) => scheduledGame.id === game.id)?.date;
      commitLeague(isRegularSeasonGame(game) && gameDate && (!league.currentDate || gameDate > league.currentDate) ? setLeagueCurrentDate(nextLeague, gameDate) : nextLeague);
    } catch (reason) {
      setLeagueError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPendingGameId(null);
    }
  };

  const clampScheduleWeekStart = (weekStart: string) => {
    if (!weekStart) return "";
    if (firstScheduleWeekStart && weekStart < firstScheduleWeekStart) return firstScheduleWeekStart;
    if (lastScheduleWeekStart && weekStart > lastScheduleWeekStart) return lastScheduleWeekStart;
    return weekStart;
  };

  const setScheduleWeek = (date: string) => {
    const weekStart = startOfCalendarWeekIso(date);
    setScheduleWeekStart(clampScheduleWeekStart(weekStart));
  };

  const shiftScheduleWeek = (days: number) => {
    setScheduleWeekStart(clampScheduleWeekStart(addDaysIso(scheduleRangeStart || firstScheduleWeekStart, days)));
  };

  const clampAdvanceThroughDate = (date: string) => {
    if (!date) return "";
    return lastScheduleDate && date > lastScheduleDate ? lastScheduleDate : date;
  };

  const unplayedGamesBetween = (startDate: string, endDate: string) => {
    const [start, end] = normalizedDateRange(startDate, endDate);
    return regularScheduledGames.filter((game) => game.status === "unplayed" && game.date >= start && game.date <= end);
  };

  const previewAdvanceThrough = (label: string, throughDate: string, confirmLabel: string) => {
    setLeagueError(null);
    const startDate = currentLeagueDate || firstScheduleDate;
    const boundedThroughDate = clampAdvanceThroughDate(throughDate || startDate);
    if (!startDate || !boundedThroughDate) {
      setLeagueError("This league does not have a playable schedule yet.");
      return;
    }
    if (boundedThroughDate < startDate) {
      setLeagueError("The league clock is already past the selected schedule window.");
      return;
    }
    const games = unplayedGamesBetween(startDate, boundedThroughDate);
    setBatchRequest({
      label,
      games,
      fromDate: startDate,
      throughDate: boundedThroughDate,
      advanceToDate: nextLeagueMorning(boundedThroughDate),
      confirmLabel
    });
  };

  const previewNextLeagueGame = () => {
    setLeagueError(null);
    if (!nextLeagueGame) {
      setLeagueError("No unplayed games remain on the schedule.");
      return;
    }
    setBatchRequest({
      label: `Next league game: ${leagueGameLabel(nextLeagueGame, teamNames)}`,
      games: [nextLeagueGame],
      fromDate: nextLeagueGame.date,
      throughDate: nextLeagueGame.date,
      advanceToDate: nextLeagueGame.date,
      confirmLabel: "Sim Next Game"
    });
  };

  const previewNextFocusTeamGame = () => {
    setLeagueError(null);
    if (focusTeamId === allTeamsValue || !nextFocusTeamGame) {
      setLeagueError("Choose a focus team with an unplayed game.");
      return;
    }
    const startDate = currentLeagueDate && currentLeagueDate <= nextFocusTeamGame.date ? currentLeagueDate : nextFocusTeamGame.date;
    const games = regularScheduledGames.filter((game) => game.status === "unplayed" && game.date >= startDate && game.date < nextFocusTeamGame.date);
    const stopBeforeLabel = leagueGameLabel(nextFocusTeamGame, teamNames);
    setBatchRequest({
      label: `Stop at ${teamLabel(teamNames, focusTeamId)} next game: ${stopBeforeLabel}`,
      games,
      fromDate: startDate,
      throughDate: nextFocusTeamGame.date,
      advanceToDate: nextFocusTeamGame.date,
      confirmLabel: "Advance to Team Game",
      stopBeforeGameId: nextFocusTeamGame.id,
      stopBeforeLabel
    });
  };

  const changeFocusTeam = (teamId: string) => {
    setFocusTeamId(teamId);
    if (!league) return;
    commitLeague(setLeagueFocusTeam(league, teamId === allTeamsValue ? null : teamId));
  };

  const changeLeagueMatchupOptions = (options: MatchupOptions) => {
    if (!league) return;
    commitLeague(setLeagueMatchupOptions(league, options));
    setBatchRequest(null);
  };

  const previewBatchSimulation = () => {
    setLeagueError(null);
    if (!filteredUnplayedGames.length) {
      setLeagueError("No unplayed games match the current schedule filters.");
      return;
    }
    const firstDate = filteredUnplayedGames[0].date ?? "";
    const lastDate = filteredUnplayedGames[filteredUnplayedGames.length - 1].date ?? "";
    setBatchRequest({
      label: `${filteredUnplayedGames.length.toLocaleString()} unplayed games in the current week`,
      games: filteredUnplayedGames,
      fromDate: firstDate,
      throughDate: lastDate,
      confirmLabel: "Sim Week Games"
    });
  };

  const simulateBatchGames = async () => {
    if (!league || !batchRequest) return;
    setPendingGameId("batch");
    setLeagueError(null);
    try {
      const teamIds = Array.from(new Set(batchRequest.games.flatMap((game) => [game.awayTeamId, game.homeTeamId])));
      const cards = new Map(await Promise.all(teamIds.map(async (teamId) => [teamId, await loadTeam(teamId)] as const)));
      let nextLeague = league;
      let seed = Date.now();
      for (const requestedGame of batchRequest.games) {
        if (batchRequest.stopBeforeGameId && requestedGame.id === batchRequest.stopBeforeGameId) continue;
        const game = nextLeague.games.find((row) => row.id === requestedGame.id);
        if (batchRequest.stopBeforeGameId && game?.id === batchRequest.stopBeforeGameId) continue;
        if (!game || game.status !== "unplayed") continue;
        const away = cards.get(game.awayTeamId);
        const home = cards.get(game.homeTeamId);
        if (!away || !home) throw new Error(`Missing team card for ${game.awayTeamId} or ${game.homeTeamId}.`);
        nextLeague = simulateLeagueGameWithTeams(nextLeague, game.id, away, home, seed, leagueGameMatchupOptions(game, nextLeague));
        seed += 1;
      }
      if (batchRequest.advanceToDate) {
        nextLeague = setLeagueCurrentDate(nextLeague, batchRequest.advanceToDate);
        setScheduleWeek(batchRequest.advanceToDate);
      }
      commitLeague(nextLeague);
      setBatchRequest(null);
    } catch (reason) {
      setLeagueError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPendingGameId(null);
    }
  };

  const beginLeagueRename = (targetLeague: LeagueState) => {
    setRenamingLeagueId(targetLeague.id);
    setRenameDraft(targetLeague.name);
    setLeagueError(null);
  };

  const cancelLeagueRename = () => {
    setRenamingLeagueId(null);
    setRenameDraft("");
  };

  const saveLeagueRename = (targetLeague: LeagueState) => {
    const nextName = renameDraft.trim();
    if (!nextName) return;
    if (nextName !== targetLeague.name) {
      commitLeague(renameLeague(targetLeague, nextName));
    }
    cancelLeagueRename();
    setLeagueError(null);
  };

  const selectLeague = (leagueId: string) => {
    setActiveLeagueId(leagueId);
    setMode("play");
    setLeagueError(null);
    setBatchRequest(null);
    setManualGame(null);
    setWatchGame(null);
    setInfoGame(null);
    cancelLeagueRename();
  };

  const createCurrentLeague = () => {
    const nextLeague = createSeasonLeague(
      name.trim() || "NBA Season",
      selectedEntries.map((team) => team.id),
      82,
      seasonStartDateForTeams(selectedEntries)
    );
    setLeague(nextLeague);
    setMode("play");
    cancelLeagueRename();
  };

  const deleteCurrentLeague = () => {
    if (!league) return;
    deleteLeague(league.id);
    setMode("select");
    setBatchRequest(null);
    setLeagueError(null);
    setManualGame(null);
    setWatchGame(null);
    setInfoGame(null);
    cancelLeagueRename();
  };

  const openLeagueMenu = () => {
    setMode("select");
    setBatchRequest(null);
    setLeagueError(null);
    setManualGame(null);
    setWatchGame(null);
    setInfoGame(null);
    cancelLeagueRename();
  };

  const openLeagueBuilder = () => {
    setMode("create");
    setBatchRequest(null);
    setLeagueError(null);
    setManualGame(null);
    setWatchGame(null);
    setInfoGame(null);
    cancelLeagueRename();
  };

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h2>League</h2>
          <p>Select a saved league to play, or create a new season.</p>
        </div>
        <div className="actions">
          {mode !== "select" && (
            <Button icon={<ChevronLeft size={16} />} onClick={openLeagueMenu}>
              Choose League
            </Button>
          )}
          <Button icon={<Plus size={16} />} variant="primary" onClick={openLeagueBuilder}>
            Create League
          </Button>
          {mode === "play" && league && (
            <Button icon={<Trash2 size={16} />} variant="danger" onClick={deleteCurrentLeague}>
              Delete League
            </Button>
          )}
        </div>
      </header>

      {mode === "select" && (
        <article className="panel league-menu-panel">
          <div className="panel-title">
            <div>
              <h3>Your Leagues</h3>
              <p>{leagues.length ? `${leagues.length.toLocaleString()} saved leagues` : "No saved leagues yet."}</p>
            </div>
          </div>
          {leagues.length ? (
            <div className="league-menu-grid">
              {leagues.map((savedLeague) => {
                const savedSchedule = scheduleLeagueGames(savedLeague);
                const savedCurrentDate = leagueCurrentDate(savedLeague, savedSchedule);
                const savedNextGame = nextUnplayedLeagueGame(savedSchedule, savedCurrentDate);
                const isRenaming = renamingLeagueId === savedLeague.id;
                return (
                  <article
                    key={savedLeague.id}
                    className={`league-menu-card ${savedLeague.id === activeLeagueId ? "active" : ""}`}
                  >
                    {isRenaming ? (
                      <form
                        className="league-rename-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          saveLeagueRename(savedLeague);
                        }}
                      >
                        <input
                          aria-label="League name"
                          value={renameDraft}
                          autoFocus
                          onChange={(event) => setRenameDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              event.preventDefault();
                              cancelLeagueRename();
                            }
                          }}
                        />
                        <div className="league-rename-actions">
                          <Button type="submit" icon={<Check size={14} />} variant="primary" disabled={!renameDraft.trim()}>
                            Save
                          </Button>
                          <Button type="button" icon={<X size={14} />} onClick={cancelLeagueRename}>
                            Cancel
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <button type="button" className="league-menu-card-select" onClick={() => selectLeague(savedLeague.id)}>
                          <span className="league-card-main">
                            <strong>{savedLeague.name}</strong>
                            <small>
                              {savedLeague.teamIds.length} teams · {scheduleRangeLabel(savedSchedule)}
                            </small>
                          </span>
                          <span className="league-card-details">
                            <span>
                              <small>Current date</small>
                              <strong>{formatLeagueClock(savedCurrentDate)}</strong>
                            </span>
                            <span>
                              <small>Next game</small>
                              <strong>{savedNextGame ? leagueGameLabel(savedNextGame, teamNames) : "Season complete"}</strong>
                            </span>
                          </span>
                        </button>
                        <div className="league-card-footer">
                          {savedLeague.id === activeLeagueId ? <span className="badge">Last played</span> : <span aria-hidden="true" />}
                          <Button icon={<Pencil size={14} />} onClick={() => beginLeagueRename(savedLeague)}>
                            Rename
                          </Button>
                        </div>
                      </>
                    )}
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">
              <strong>No leagues</strong>
              <p>Create a season to start tracking schedules, standings, and leaders.</p>
            </div>
          )}
        </article>
      )}

      {mode === "create" && (
        <div className="season-builder-layout">
          <article className="panel season-builder-panel">
            <div className="form-row">
              <label>
                League name
                <input value={name} onChange={(event) => setName(event.target.value)} />
              </label>
              <label>
                Base season
                <select value={season} onChange={(event) => fillFromSeason(event.target.value)}>
                  {seasonChoices.map((choice) => (
                    <option key={choice.season} value={choice.season}>
                      {choice.season}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="league-preset-actions">
              <Button icon={<CalendarDays size={16} />} onClick={() => applyPreset("season")}>
                Fill Year
              </Button>
              <Button icon={<Trophy size={16} />} onClick={() => applyPreset("franchise-best")}>
                Franchise Best
              </Button>
              <Button icon={<BarChart3 size={16} />} onClick={() => applyPreset("best-record")}>
                Best Record
              </Button>
            </div>
            <div className="season-summary-row">
              <span className="badge">{selectedEntries.length} teams</span>
              <span>{selectedEntries.length >= 2 ? `${selectedEntries.length * 82 / 2} scheduled games` : "Add at least two teams"}</span>
            </div>
            <div className="league-roster-list">
              {selectedEntries.map((team, index) => (
                <button
                  key={`${team.id}:${index}`}
                  type="button"
                  className={`league-roster-slot ${index === activeSlot ? "active" : ""}`}
                  onClick={() => setActiveSlot(index)}
                >
                  <span className="slot-index">{index + 1}</span>
                  <TeamLogo team={team} className="team-logo-check" />
                  <span className="team-meta">
                    <strong>{team.shortName}</strong>
                    <small>
                      {team.season} · {canonicalFranchise(team)}
                    </small>
                  </span>
                  <span className="record">{recordLabel(team)}</span>
                </button>
              ))}
            </div>
            <div className="actions">
              <Button
                icon={<CalendarDays size={16} />}
                variant="primary"
                disabled={selectedEntries.length < 2 || selectedEntries.length > maxLeagueTeams}
                onClick={createCurrentLeague}
              >
                Create 82-Game Season
              </Button>
              <Button onClick={openLeagueMenu}>Cancel</Button>
            </div>
          </article>

          <article className="panel replace-panel">
            <div className="panel-title">
              <div>
                <h3>Replace Slot</h3>
                <p>{selectedEntries[activeSlot] ? selectedEntries[activeSlot].shortName : "Select a slot"}</p>
              </div>
              <span className="badge">Slot {activeSlot + 1}</span>
            </div>
            <div className="catalog-filters">
              <label className="search-field">
                Search
                <span>
                  <Search size={16} />
                  <input value={replaceQuery} onChange={(event) => setReplaceQuery(event.target.value)} placeholder="team, year, franchise..." />
                </span>
              </label>
              <div className="filter-grid">
                <label>
                  Season
                  <select value={replaceSeason} onChange={(event) => setReplaceSeason(event.target.value)}>
                    <option value={allSeasonsValue}>All seasons</option>
                    {seasonChoices.map((choice) => (
                      <option key={choice.season} value={choice.season}>
                        {choice.season}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Franchise
                  <select value={replaceFranchise} onChange={(event) => setReplaceFranchise(event.target.value)}>
                    <option value={allSeasonsValue}>All franchises</option>
                    {franchises.map((choice) => (
                      <option key={choice} value={choice}>
                        {choice}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="result-count">
                <ListFilter size={15} />
                <span>Showing {replacementTeams.length.toLocaleString()} replacement candidates</span>
              </div>
            </div>
            <div className="team-list replacement-list">
              {replacementTeams.map((team) => {
                const duplicate = selected.some((teamId, index) => teamId === team.id && index !== activeSlot);
                return <TeamCatalogRow key={team.id} team={team} active={selected[activeSlot] === team.id} disabled={duplicate} onSelect={replaceSlot} />;
              })}
            </div>
          </article>
        </div>
      )}

      {mode === "play" && league && (
        <>
          {postseasonComplete && postseasonChampionTeamId ? (
            <LeagueCompletionBanner
              league={league}
              championTeamId={postseasonChampionTeamId}
              teamNames={teamNames}
              sourceTeamsById={sourceTeamsById}
            />
          ) : (
            <article className="panel league-command-center">
              <div className="league-clock">
                <span>League Date</span>
                <strong>{formatLeagueClock(currentLeagueDate)}</strong>
                <small>
                  {currentDateFeatureGame
                    ? `Today: ${leagueGameLabel(currentDateFeatureGame, teamNames)}`
                    : nextLeagueGame
                      ? `Next tip: ${formatIsoDate(nextLeagueGame.date)} · ${leagueGameLabel(nextLeagueGame, teamNames)}`
                      : "No remaining games on the schedule"}
                </small>
              </div>
              <div className="league-command-main">
                <div>
                  {renamingLeagueId === league.id ? (
                    <form
                      className="league-title-edit"
                      onSubmit={(event) => {
                        event.preventDefault();
                        saveLeagueRename(league);
                      }}
                    >
                      <input
                        aria-label="League name"
                        value={renameDraft}
                        autoFocus
                        onChange={(event) => setRenameDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            cancelLeagueRename();
                          }
                        }}
                      />
                      <Button type="submit" icon={<Check size={14} />} variant="primary" disabled={!renameDraft.trim()}>
                        Save
                      </Button>
                      <Button type="button" icon={<X size={14} />} onClick={cancelLeagueRename}>
                        Cancel
                      </Button>
                    </form>
                  ) : (
                    <div className="league-title-row">
                      <h3>{league.name}</h3>
                      <Button icon={<Pencil size={14} />} onClick={() => beginLeagueRename(league)}>
                        Rename
                      </Button>
                    </div>
                  )}
                  <p>
                    {league.teamIds.length.toLocaleString()} teams · {scheduleRangeLabel(regularScheduledGames)}
                  </p>
                </div>
                <div className="league-next-stack">
                  <div>
                    <span>Next game</span>
                    <strong>{nextLeagueGame ? leagueGameLabel(nextLeagueGame, teamNames) : "Season complete"}</strong>
                    <small>{nextLeagueGame ? `${formatIsoDate(nextLeagueGame.date)} · ${matchupRecordLabel(nextLeagueGame)}` : "No unplayed games remain"}</small>
                  </div>
                  <div>
                    <span>Focus team</span>
                    <strong>{focusTeamId === allTeamsValue ? "Choose team" : teamLabel(teamNames, focusTeamId)}</strong>
                    <small>{nextFocusTeamGame ? `${formatIsoDate(nextFocusTeamGame.date)} · ${leagueGameLabel(nextFocusTeamGame, teamNames)} · ${matchupRecordLabel(nextFocusTeamGame)}` : "No remaining game"}</small>
                  </div>
                </div>
              </div>
              <div className="league-advance-bar">
                <label className="league-focus-select">
                  Focus team
                  <select value={focusTeamId} onChange={(event) => changeFocusTeam(event.target.value)}>
                    <option value={allTeamsValue}>Choose team</option>
                    {leagueTeamEntries.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.shortName}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="league-advance-actions">
                  <Button
                    icon={<Play size={16} />}
                    disabled={!nextLeagueGame || Boolean(pendingGameId)}
                    onClick={() => {
                      setSection("schedule");
                      previewNextLeagueGame();
                    }}
                  >
                    Sim Next Game
                  </Button>
                  <Button
                    icon={<SkipForward size={16} />}
                    disabled={!nextFocusTeamGame || Boolean(pendingGameId)}
                    variant="primary"
                    onClick={() => {
                      setSection("schedule");
                      previewNextFocusTeamGame();
                    }}
                  >
                    Sim to Team Game
                  </Button>
                  <Button
                    icon={<CalendarDays size={16} />}
                    disabled={!currentLeagueDate || Boolean(pendingGameId)}
                    onClick={() => {
                      setSection("schedule");
                      previewAdvanceThrough("Advance today", currentLeagueDate, "Sim Day");
                    }}
                  >
                    Sim Day
                  </Button>
                  <Button
                    icon={<CalendarDays size={16} />}
                    disabled={!currentWeekEnd || Boolean(pendingGameId)}
                    onClick={() => {
                      setSection("schedule");
                      previewAdvanceThrough("Advance one week", currentWeekEnd, "Sim Week");
                    }}
                  >
                    Sim Week
                  </Button>
                  <Button
                    icon={<CalendarDays size={16} />}
                    disabled={!currentMonthEnd || Boolean(pendingGameId)}
                    onClick={() => {
                      setSection("schedule");
                      previewAdvanceThrough("Advance one month", currentMonthEnd, "Sim Month");
                    }}
                  >
                    Sim Month
                  </Button>
                </div>
              </div>
            </article>
          )}
          <LeagueModelSettingsPanel league={league} teams={leagueTeamEntries} loadTeam={loadTeam} onChange={changeLeagueMatchupOptions} />
          <div className="mode-tabs league-tabs">
            {!postseasonComplete && (
              <button type="button" className={activeSection === "schedule" ? "active" : ""} onClick={() => setSection("schedule")}>
                <CalendarDays size={16} />
                <span>Schedule</span>
              </button>
            )}
            <button type="button" className={activeSection === "team" ? "active" : ""} onClick={() => setSection("team")}>
              <BookOpen size={16} />
              <span>Team</span>
            </button>
            <button type="button" className={activeSection === "standings" ? "active" : ""} onClick={() => setSection("standings")}>
              <BarChart3 size={16} />
              <span>Standings</span>
            </button>
            <button type="button" className={activeSection === "leaders" ? "active" : ""} onClick={() => setSection("leaders")}>
              <Trophy size={16} />
              <span>Leaders</span>
            </button>
          </div>
          {leagueError && (
            <article className="panel">
              <h3>League Action Failed</h3>
              <p>{leagueError}</p>
            </article>
          )}
          {activeSection === "schedule" && !postseasonComplete && (regularSeasonComplete || league.playoffs ? (
            <LeaguePostseasonPanel
              league={league}
              seeds={postseasonSeeds}
              regularSeasonComplete={regularSeasonComplete}
              postseasonGames={postseasonScheduledGames}
              teamNames={teamNames}
              sourceTeamsById={sourceTeamsById}
              pending={Boolean(pendingGameId)}
              onStart={() => {
                try {
                  commitLeague(startLeaguePlayoffs(league, postseasonSeeds));
                  setLeagueError(null);
                } catch (reason) {
                  setLeagueError(reason instanceof Error ? reason.message : String(reason));
                }
              }}
              onClear={() => commitLeague(clearLeaguePlayoffs(league))}
              onWatch={(game) => setWatchGame(game)}
              onManual={(game) => setManualGame(game)}
              onSim={(game) => void simulateGameInLeague(game)}
              onReset={(game) => commitLeague(markUnplayed(league, game.id))}
              onOpenGame={(game) => setInfoGame(game)}
            />
          ) : (
            <article className="panel schedule-panel">
              <div className="panel-title">
                <div>
                  <h3>Schedule</h3>
                  <p>{scheduleScopeLabel}</p>
                </div>
                <Button icon={<SkipForward size={16} />} disabled={!filteredUnplayedGames.length || Boolean(pendingGameId)} variant="primary" onClick={previewBatchSimulation}>
                  Preview Week
                </Button>
              </div>
              <div className="schedule-controls">
                <label>
                  Team
                  <select value={scheduleTeamId} onChange={(event) => setScheduleTeamId(event.target.value)}>
                    <option value={allTeamsValue}>All teams</option>
                    {leagueTeamEntries.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.shortName}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Status
                  <select value={scheduleStatus} onChange={(event) => setScheduleStatus(event.target.value as LeagueStatusFilter)}>
                    <option value="all">All games</option>
                    <option value="unplayed">Unplayed</option>
                    <option value="played">Played</option>
                    <option value="simulated">Simulated</option>
                    <option value="manual">Manual</option>
                  </select>
                </label>
              </div>
              <div className="schedule-week-toolbar">
                <div className="schedule-week-label">
                  <span>Viewing Week</span>
                  <strong>{scheduleWeekLabel}</strong>
                </div>
                <div className="schedule-window-actions">
                  <Button icon={<ChevronLeft size={16} />} disabled={!scheduleRangeStart || scheduleRangeStart <= firstScheduleWeekStart} onClick={() => shiftScheduleWeek(-7)}>
                    Previous Week
                  </Button>
                  <Button icon={<CalendarDays size={16} />} disabled={!currentLeagueDate} onClick={() => setScheduleWeek(currentLeagueDate)}>
                    Current Week
                  </Button>
                  <Button icon={<SkipForward size={16} />} disabled={!nextScopedUnplayedDate} onClick={() => setScheduleWeek(nextScopedUnplayedDate)}>
                    Next Unplayed
                  </Button>
                  <Button icon={<ChevronRight size={16} />} disabled={!scheduleRangeStart || scheduleRangeStart >= lastScheduleWeekStart} onClick={() => shiftScheduleWeek(7)}>
                    Next Week
                  </Button>
                </div>
              </div>
              <div className="calendar-week-header">
                {weekdayLabels.map((day) => (
                  <span key={day}>{day}</span>
                ))}
              </div>
              {calendarDays.length ? (
                <div className="league-calendar-grid">
                  {calendarDays.map((day) => {
                    const visibleGames = day.games.slice(0, maxCalendarGamesPerDay);
                    const remaining = day.games.length - visibleGames.length;
                    const currentDay = day.date === currentLeagueDate;
                    const pastDay = Boolean(currentLeagueDate && day.date < currentLeagueDate);
                    return (
                      <section
                        key={day.date}
                        className={`calendar-day ${day.inRange ? "" : "outside"} ${day.games.length ? "has-games" : ""} ${currentDay ? "current" : ""} ${pastDay ? "past" : ""}`}
                      >
                        <div className="calendar-day-header">
                          <span>{formatCalendarDay(day.date)}</span>
                          <span className="calendar-day-badges">
                            {currentDay && <strong>Today</strong>}
                            {day.games.length > 0 && <strong>{day.games.length}</strong>}
                          </span>
                        </div>
                        <div className="calendar-game-list">
                          {visibleGames.map((game) => {
                            const awayTeam = sourceTeamsById.get(game.awayTeamId);
                            const homeTeam = sourceTeamsById.get(game.homeTeamId);
                            const played = Boolean(game.result);
                            const gameLabel = leagueGameLabel(game, teamNames);
                            const awayRecord = currentRecord(game.awayTeamId);
                            const homeRecord = currentRecord(game.homeTeamId);
                            const awayCode = calendarTeamCode(awayTeam, teamNames, game.awayTeamId);
                            const homeCode = calendarTeamCode(homeTeam, teamNames, game.homeTeamId);
                            const awayWon = game.result?.winnerTeamId === game.awayTeamId;
                            const homeWon = game.result?.winnerTeamId === game.homeTeamId;
                            return (
                              <div key={game.id} className={`calendar-game-card ${played ? "played" : "unplayed"} ${game.status}`}>
                                <button
                                  type="button"
                                  className="calendar-game-main calendar-game-open"
                                  aria-label={`Open ${gameLabel} details`}
                                  onClick={() => setInfoGame(game)}
                                >
                                  <span className={`calendar-team-row ${awayWon ? "winner" : ""}`}>
                                    {awayTeam && <TeamLogo team={awayTeam} className="team-logo-mini" />}
                                    <span className="calendar-team-copy">
                                      <strong>{awayCode}</strong>
                                      <small>{awayRecord}</small>
                                    </span>
                                    {game.result && <strong className="calendar-team-score">{game.result.awayScore}</strong>}
                                  </span>
                                  <span className={`calendar-team-row ${homeWon ? "winner" : ""}`}>
                                    {homeTeam && <TeamLogo team={homeTeam} className="team-logo-mini" />}
                                    <span className="calendar-team-copy">
                                      <strong>{homeCode}</strong>
                                      <small>{homeRecord}</small>
                                    </span>
                                    {game.result && <strong className="calendar-team-score">{game.result.homeScore}</strong>}
                                  </span>
                                </button>
                                <div className="calendar-game-footer">
                                  {game.result && <span className="calendar-game-note">{game.status === "manual" ? "Manual final" : "Final"}</span>}
                                  <div className="calendar-game-actions" aria-label={`Actions for ${gameLabel}`}>
                                    <Button
                                      className="calendar-icon-button"
                                      data-testid={`watch-${game.id}`}
                                      icon={<Play size={12} />}
                                      aria-label={`Watch ${gameLabel}`}
                                      data-tooltip="Watch"
                                      title="Watch"
                                      disabled={Boolean(pendingGameId)}
                                      onClick={() => setWatchGame(game)}
                                    >
                                      Watch
                                    </Button>
                                    {!played && (
                                      <Button
                                        className="calendar-icon-button"
                                        data-testid={`sim-${game.id}`}
                                        icon={<SkipForward size={12} />}
                                        aria-label={`Sim ${gameLabel}`}
                                        data-tooltip="Sim"
                                        title="Sim"
                                        disabled={Boolean(pendingGameId)}
                                        onClick={() => void simulateGameInLeague(game)}
                                      >
                                        Sim
                                      </Button>
                                    )}
                                    <Button
                                      className="calendar-icon-button"
                                      data-testid={`manual-${game.id}`}
                                      icon={<FileText size={12} />}
                                      aria-label={`Enter manual result for ${gameLabel}`}
                                      data-tooltip="Manual result"
                                      title="Manual result"
                                      disabled={Boolean(pendingGameId)}
                                      onMouseDown={() => setManualGame(game)}
                                      onClick={() => setManualGame(game)}
                                    >
                                      Manual
                                    </Button>
                                    {played && (
                                      <Button
                                        className="calendar-icon-button"
                                        data-testid={`unplayed-${game.id}`}
                                        icon={<RotateCcw size={12} />}
                                        aria-label={`Reset ${gameLabel} to unplayed`}
                                        data-tooltip="Reset to unplayed"
                                        title="Reset to unplayed"
                                        disabled={Boolean(pendingGameId)}
                                        onClick={() => commitLeague(markUnplayed(league, game.id))}
                                      >
                                        Reset
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                          {remaining > 0 && <span className="calendar-more">+{remaining} more</span>}
                        </div>
                      </section>
                    );
                  })}
                </div>
              ) : (
                <p className="empty-state">No games match this calendar window.</p>
              )}
            </article>
          ))}
          {activeSection === "team" && (
            <LeagueTeamDashboard
              league={league}
              teamId={focusTeamId}
              onTeamChange={changeFocusTeam}
              teamNames={teamNames}
              sourceTeamsById={sourceTeamsById}
              scheduledGames={scheduledGames}
              currentLeagueDate={currentLeagueDate}
              onOpenGame={setInfoGame}
            />
          )}
          {activeSection === "standings" && <StandingsTable league={league} teamNames={teamNames} sourceTeamsById={sourceTeamsById} />}
          {activeSection === "leaders" && <LeagueLeaders league={league} teamNames={teamNames} sourceTeamsById={sourceTeamsById} />}
          {manualGame && (
            <ManualResultFormLoader
              game={manualGame}
              league={league}
              setLeague={commitLeague}
              onClose={() => setManualGame(null)}
              loadTeam={loadTeam}
            />
          )}
          {watchGame && (
            <LeagueWatchGameLoader
              game={watchGame}
              league={league}
              setLeague={commitLeague}
              onClose={() => setWatchGame(null)}
              loadTeam={loadTeam}
            />
          )}
          {infoGame && (
            <LeagueGameInfoModal
              game={infoGame}
              league={league}
              teamNames={teamNames}
              sourceTeamsById={sourceTeamsById}
              loadTeam={loadTeam}
              pending={Boolean(pendingGameId)}
              readOnly={postseasonComplete}
              onClose={() => setInfoGame(null)}
              onWatch={() => {
                setWatchGame(infoGame);
                setInfoGame(null);
              }}
              onManual={() => {
                setManualGame(infoGame);
                setInfoGame(null);
              }}
              onSim={() => {
                const game = infoGame;
                setInfoGame(null);
                void simulateGameInLeague(game);
              }}
              onReset={() => {
                commitLeague(markUnplayed(league, infoGame.id));
                setInfoGame(null);
              }}
            />
          )}
          {batchRequest && (
            <div className="modal-backdrop" onMouseDown={() => setBatchRequest(null)}>
              <article className="panel confirm-panel" role="alertdialog" aria-modal="true" aria-labelledby="batch-sim-title" onMouseDown={(event) => event.stopPropagation()}>
                <div className="panel-title">
                  <div>
                    <h3 id="batch-sim-title">Confirm Simulation Window</h3>
                    <p>
                      {batchRequest.label}
                      {batchRequest.fromDate && batchRequest.throughDate
                        ? ` · ${formatIsoDate(batchRequest.fromDate)} through ${formatIsoDate(batchRequest.throughDate)}`
                        : ""}
                    </p>
                  </div>
                  <span className="badge">{batchRequest.games.length ? `${batchRequest.games.length.toLocaleString()} games` : "No games"}</span>
                </div>
                {batchRequest.stopBeforeLabel && <p className="box-note">Stops before {batchRequest.stopBeforeLabel}. That game stays unplayed.</p>}
                {batchRequest.games.length ? (
                  <div className="batch-game-list">
                    {batchRequest.games.map((game) => (
                      <div key={game.id} className="batch-game-row">
                        <span>{formatIsoDate(game.date ?? "")}</span>
                        <strong>{leagueGameLabel(game, teamNames)}</strong>
                        <small>{matchupRecordLabel(game)}</small>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <strong>No scheduled games</strong>
                    <p>{batchRequest.advanceToDate ? `Advance the league clock to ${formatLeagueClock(batchRequest.advanceToDate)}.` : "There is nothing to simulate."}</p>
                  </div>
                )}
                <div className="actions">
                  <Button disabled={Boolean(pendingGameId)} onClick={() => setBatchRequest(null)}>
                    Cancel
                  </Button>
                  <Button icon={<SkipForward size={16} />} disabled={Boolean(pendingGameId)} variant="primary" onClick={() => void simulateBatchGames()}>
                    {batchRequest.confirmLabel ?? "Simulate Listed Games"}
                  </Button>
                </div>
              </article>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function statInputKey(team: DiceTeamCard, player: string): string {
  return `${team.id}:${player}`;
}

function leaguePlayoffChampionTeamId(league: LeagueState): string | undefined {
  const finalsSeries = league.playoffs?.series.find((series) => series.round === 4);
  return finalsSeries ? playoffSeriesState(league, finalsSeries).winnerTeamId : undefined;
}

function LeagueCompletionBanner({
  league,
  championTeamId,
  teamNames,
  sourceTeamsById
}: {
  league: LeagueState;
  championTeamId: string;
  teamNames: Map<string, string>;
  sourceTeamsById: Map<string, SourceTeamCatalogEntry>;
}) {
  const finalSeries = league.playoffs?.series.find((series) => series.round === 4);
  const finalState = finalSeries ? playoffSeriesState(league, finalSeries) : undefined;
  const championFinalWins = finalSeries?.teamAId === championTeamId ? finalState?.winsA : finalState?.winsB;
  const opponentFinalWins = finalSeries?.teamAId === championTeamId ? finalState?.winsB : finalState?.winsA;
  const finalRecord = championFinalWins !== undefined && opponentFinalWins !== undefined ? `${championFinalWins}-${opponentFinalWins}` : "-";
  const championStanding = standings(league).find((row) => row.teamId === championTeamId);
  const championStats = aggregateTeamStats(league)[championTeamId];
  const regularGames = championStats?.games ?? championStanding?.played ?? 0;
  const postseasonPlayed = scheduleLeagueGames(league).filter((game) => isPostseasonGame(game) && game.result).length;

  return (
    <article className="panel league-complete-banner">
      <div className="league-complete-status">
        <span className="badge">Playoffs Complete</span>
        <div>
          <h3>{teamLabel(teamNames, championTeamId)} Champion</h3>
          <p>{league.name}</p>
        </div>
      </div>
      <div className="league-complete-team">
        <Trophy size={28} aria-hidden="true" />
        <TeamIdentityButton
          team={sourceTeamsById.get(championTeamId)}
          teamId={championTeamId}
          teamNames={teamNames}
          className="standings-team league-complete-team-identity"
        />
      </div>
      <div className="league-complete-metrics">
        <div>
          <span>Finals</span>
          <strong>{finalRecord}</strong>
        </div>
        <div>
          <span>Record</span>
          <strong>{standingsRecordLabel(championStanding)}</strong>
        </div>
        <div>
          <span>PPG</span>
          <strong>{round((championStats?.PTS ?? 0) / Math.max(1, regularGames))}</strong>
        </div>
        <div>
          <span>Postseason Games</span>
          <strong>{postseasonPlayed}</strong>
        </div>
      </div>
    </article>
  );
}

function LeaguePostseasonPanel({
  league,
  seeds,
  regularSeasonComplete,
  postseasonGames,
  teamNames,
  sourceTeamsById,
  pending,
  onStart,
  onClear,
  onWatch,
  onManual,
  onSim,
  onReset,
  onOpenGame
}: {
  league: LeagueState;
  seeds: LeaguePlayoffSeed[];
  regularSeasonComplete: boolean;
  postseasonGames: ScheduledLeagueGame[];
  teamNames: Map<string, string>;
  sourceTeamsById: Map<string, SourceTeamCatalogEntry>;
  pending: boolean;
  onStart: () => void;
  onClear: () => void;
  onWatch: (game: ScheduledLeagueGame) => void;
  onManual: (game: ScheduledLeagueGame) => void;
  onSim: (game: ScheduledLeagueGame) => void;
  onReset: (game: ScheduledLeagueGame) => void;
  onOpenGame: (game: ScheduledLeagueGame) => void;
}) {
  const playoffs = league.playoffs;
  const scheduledById = useMemo(() => new Map(postseasonGames.map((game) => [game.id, game])), [postseasonGames]);
  const nextGame = playoffs ? nextPlayablePlayoffGame(league) : undefined;
  const nextScheduledGame = nextGame ? scheduledById.get(nextGame.id) : undefined;
  const seedCountByConference = groupedRows(seeds, (seed) => seed.conference, standingsConferenceOrder);
  const canStart = regularSeasonComplete && seedCountByConference.filter((group) => group.rows.length >= 10).length >= 2;
  const championSeries = playoffs?.series.find((series) => series.round === 4);
  const championTeamId = championSeries ? playoffSeriesState(league, championSeries).winnerTeamId : undefined;
  const playInGroups = groupedRows(playoffs?.playInGames ?? [], (game) => game.conference, standingsConferenceOrder);
  const seriesRounds = Array.from(new Set((playoffs?.series ?? []).map((series) => series.round))).sort((a, b) => a - b);
  const hasPlayoffBracket = seriesRounds.length > 0;
  const [bracketView, setBracketView] = useState<PostseasonBracketView>(hasPlayoffBracket ? "playoffs" : "play-in");
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(null);
  const selectedSeries = playoffs?.series.find((series) => series.id === selectedSeriesId);
  const selectedSeriesState = selectedSeries ? playoffSeriesState(league, selectedSeries) : null;
  const selectedSeriesGames = selectedSeries ? selectedSeries.gameIds.map((gameId) => scheduledById.get(gameId)).filter((game): game is ScheduledLeagueGame => Boolean(game)) : [];

  useEffect(() => {
    if (!playoffs) return;
    setBracketView(hasPlayoffBracket ? "playoffs" : "play-in");
  }, [hasPlayoffBracket, playoffs?.createdAt]);

  useEffect(() => {
    if (selectedSeriesId && !playoffs?.series.some((series) => series.id === selectedSeriesId)) {
      setSelectedSeriesId(null);
    }
  }, [playoffs?.series, selectedSeriesId]);

  const renderGameActions = (game: ScheduledLeagueGame | undefined) => {
    if (!game) return null;
    const played = Boolean(game.result);
    return (
      <div className="postseason-game-actions">
        <Button icon={<Play size={14} />} disabled={pending} onClick={() => onWatch(game)}>
          Watch
        </Button>
        {!played && (
          <Button icon={<SkipForward size={14} />} disabled={pending} onClick={() => onSim(game)}>
            Sim
          </Button>
        )}
        <Button icon={<FileText size={14} />} disabled={pending} onClick={() => onManual(game)}>
          Manual
        </Button>
        {played && (
          <Button icon={<RotateCcw size={14} />} disabled={pending} onClick={() => onReset(game)}>
            Reset
          </Button>
        )}
      </div>
    );
  };

  const openGameFromModal = (game: ScheduledLeagueGame) => {
    setSelectedSeriesId(null);
    onOpenGame(game);
  };

  const renderPostseasonTeam = (teamId: string, seed?: number, wins?: number, game?: ScheduledLeagueGame) => {
    const team = sourceTeamsById.get(teamId);
    const score = game ? teamGameScore(game, teamId) : undefined;
    const wonGame = game?.result?.winnerTeamId === teamId;
    return (
      <span className={`postseason-team-row ${wonGame ? "winner" : ""}`}>
        <span className="postseason-seed">{seed ? seed : "-"}</span>
        <TeamIdentityButton team={team} teamId={teamId} teamNames={teamNames} className="standings-team compact-team-identity" />
        {wins !== undefined && <strong className="postseason-wins">{wins}</strong>}
        {score !== undefined && <strong className="postseason-score">{score}</strong>}
      </span>
    );
  };

  return (
    <article className="panel postseason-panel">
      <div className="panel-title">
        <div>
          <h3>Postseason</h3>
          <p>
            {playoffs
              ? championTeamId
                ? `${teamLabel(teamNames, championTeamId)} champion`
                : nextScheduledGame
                  ? `Next: ${leagueGameLabel(nextScheduledGame, teamNames)}`
                  : "Waiting for the next postseason matchup"
              : regularSeasonComplete
                ? "Play-in tournament ready"
                : "Regular season in progress"}
          </p>
        </div>
        <div className="postseason-header-actions">
          {!playoffs ? (
            <Button icon={<Trophy size={16} />} variant="primary" disabled={!canStart || pending} onClick={onStart}>
              Start Play-In
            </Button>
          ) : (
            <>
              <div className="segmented postseason-view-toggle" aria-label="Postseason bracket view">
                <div className="segment-buttons">
                  <button type="button" className={bracketView === "playoffs" ? "active" : ""} disabled={!hasPlayoffBracket} onClick={() => setBracketView("playoffs")}>
                    Playoffs
                  </button>
                  <button type="button" className={bracketView === "play-in" ? "active" : ""} onClick={() => setBracketView("play-in")}>
                    Play-In
                  </button>
                </div>
              </div>
              {nextScheduledGame && (
                <Button icon={<SkipForward size={16} />} variant="primary" disabled={pending} onClick={() => onSim(nextScheduledGame)}>
                  Sim Next
                </Button>
              )}
              <Button icon={<RotateCcw size={16} />} variant="danger" disabled={pending} onClick={onClear}>
                Reset Postseason
              </Button>
            </>
          )}
        </div>
      </div>

      {!playoffs ? (
        <div className="postseason-start-grid">
          {seedCountByConference.map((group) => (
            <section key={group.label} className="postseason-seed-card">
              <h4>{group.label}</h4>
              <div className="postseason-seed-list">
                {group.rows.slice(0, 10).map((seed) => (
                  <span key={seed.teamId}>
                    <strong>{seed.seed}</strong>
                    <TeamIdentityButton team={sourceTeamsById.get(seed.teamId)} teamId={seed.teamId} teamNames={teamNames} className="standings-team compact-team-identity" />
                  </span>
                ))}
              </div>
            </section>
          ))}
          {!canStart && (
            <div className="empty-state postseason-start-note">
              <strong>{regularSeasonComplete ? "Need two 10-team conferences" : "Finish the regular season"}</strong>
              <p>{regularSeasonComplete ? "Play-in seeding uses conference seeds 7 through 10." : "The play-in unlocks after all regular-season games have results."}</p>
            </div>
          )}
        </div>
      ) : (
        <>
          {bracketView === "playoffs" && hasPlayoffBracket ? (
            <PlayoffBracket
              league={league}
              playoffs={playoffs}
              scheduledById={scheduledById}
              teamNames={teamNames}
              sourceTeamsById={sourceTeamsById}
              onSelectSeries={setSelectedSeriesId}
            />
          ) : bracketView === "playoffs" ? (
            <p className="empty-state">The first round appears after both 8-seed play-in games are complete.</p>
          ) : (
            <PlayInBracket
              groups={playInGroups}
              scheduledById={scheduledById}
              teamNames={teamNames}
              sourceTeamsById={sourceTeamsById}
              renderGameActions={renderGameActions}
              onOpenGame={onOpenGame}
            />
          )}
          {selectedSeries && selectedSeriesState && (
            <PostseasonSeriesModal
              series={selectedSeries}
              state={selectedSeriesState}
              games={selectedSeriesGames}
              nextGame={selectedSeriesState.nextGame ? scheduledById.get(selectedSeriesState.nextGame.id) : undefined}
              teamNames={teamNames}
              renderTeam={renderPostseasonTeam}
              renderGameActions={renderGameActions}
              onOpenGame={openGameFromModal}
              onClose={() => setSelectedSeriesId(null)}
            />
          )}
        </>
      )}
    </article>
  );
}

function playoffRoundDisplayName(round: number): string {
  if (round === 1) return "First Round";
  if (round === 2) return "Conference Semifinals";
  if (round === 3) return "Conference Finals";
  if (round === 4) return "Finals";
  return `Round ${round}`;
}

function conferenceLabelsForPlayoffs(playoffs: NonNullable<LeagueState["playoffs"]>): string[] {
  const seedLabels = groupedRows(playoffs.playoffSeeds ?? playoffs.seeds, (seed) => seed.conference, standingsConferenceOrder)
    .map((group) => group.label)
    .filter((label) => label !== "Other" && label !== "Finals");
  const seriesLabels = groupedRows(
    playoffs.series.filter((series) => series.round < 4),
    (series) => series.conference,
    standingsConferenceOrder
  )
    .map((group) => group.label)
    .filter((label) => label !== "Other" && label !== "Finals");
  return Array.from(new Set([...seedLabels, ...seriesLabels])).slice(0, 2);
}

function PlayoffBracket({
  league,
  playoffs,
  scheduledById,
  teamNames,
  sourceTeamsById,
  onSelectSeries
}: {
  league: LeagueState;
  playoffs: NonNullable<LeagueState["playoffs"]>;
  scheduledById: Map<string, ScheduledLeagueGame>;
  teamNames: Map<string, string>;
  sourceTeamsById: Map<string, SourceTeamCatalogEntry>;
  onSelectSeries: (seriesId: string) => void;
}) {
  const conferences = conferenceLabelsForPlayoffs(playoffs);
  const leftConference = conferences[0];
  const rightConference = conferences[1];
  const finalsSeries = playoffs.series.find((series) => series.round === 4);
  return (
    <section className="postseason-section">
      <div className="team-card-section-title">
        <h4>Playoff Bracket</h4>
        <span>{playoffs.series.length.toLocaleString()} series</span>
      </div>
      <div className="playoff-bracket-layout">
        {leftConference && (
          <ConferenceBracket
            league={league}
            conference={leftConference}
            series={playoffs.series.filter((row) => row.conference === leftConference && row.round < 4)}
            scheduledById={scheduledById}
            teamNames={teamNames}
            sourceTeamsById={sourceTeamsById}
            onSelectSeries={onSelectSeries}
            mirror={false}
          />
        )}
        <section className="playoff-finals-column">
          <h5>Finals</h5>
          <div className="bracket-series-list slot-count-1">
            <BracketSeriesCard
              series={finalsSeries}
              league={league}
              scheduledById={scheduledById}
              teamNames={teamNames}
              sourceTeamsById={sourceTeamsById}
              placeholder="Conference winners"
              onSelectSeries={onSelectSeries}
            />
          </div>
        </section>
        {rightConference && (
          <ConferenceBracket
            league={league}
            conference={rightConference}
            series={playoffs.series.filter((row) => row.conference === rightConference && row.round < 4)}
            scheduledById={scheduledById}
            teamNames={teamNames}
            sourceTeamsById={sourceTeamsById}
            onSelectSeries={onSelectSeries}
            mirror
          />
        )}
      </div>
    </section>
  );
}

function ConferenceBracket({
  league,
  conference,
  series,
  scheduledById,
  teamNames,
  sourceTeamsById,
  onSelectSeries,
  mirror
}: {
  league: LeagueState;
  conference: string;
  series: LeaguePlayoffSeries[];
  scheduledById: Map<string, ScheduledLeagueGame>;
  teamNames: Map<string, string>;
  sourceTeamsById: Map<string, SourceTeamCatalogEntry>;
  onSelectSeries: (seriesId: string) => void;
  mirror: boolean;
}) {
  const rounds = mirror ? [3, 2, 1] : [1, 2, 3];
  return (
    <section className={`playoff-conference-bracket ${mirror ? "mirror" : ""}`}>
      <h4>{conference}</h4>
      <div className="playoff-bracket-grid">
        {rounds.map((round) => {
          const slotCount = round === 1 ? 4 : round === 2 ? 2 : 1;
          const roundSeries = series.filter((row) => row.round === round);
          return (
            <section key={round} className="bracket-round">
              <h5>{playoffRoundDisplayName(round)}</h5>
              <div className={`bracket-series-list slot-count-${slotCount}`}>
                {Array.from({ length: slotCount }, (_, bracketIndex) => (
                  <BracketSeriesCard
                    key={`${conference}:${round}:${bracketIndex}`}
                    series={roundSeries.find((row) => row.bracketIndex === bracketIndex)}
                    league={league}
                    scheduledById={scheduledById}
                    teamNames={teamNames}
                    sourceTeamsById={sourceTeamsById}
                    placeholder={round === 1 ? "Awaiting play-in" : "Awaiting winners"}
                    onSelectSeries={onSelectSeries}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}

function BracketSeriesCard({
  series,
  league,
  scheduledById,
  teamNames,
  sourceTeamsById,
  placeholder,
  onSelectSeries
}: {
  series?: LeaguePlayoffSeries;
  league: LeagueState;
  scheduledById: Map<string, ScheduledLeagueGame>;
  teamNames: Map<string, string>;
  sourceTeamsById: Map<string, SourceTeamCatalogEntry>;
  placeholder: string;
  onSelectSeries: (seriesId: string) => void;
}) {
  if (!series) {
    return (
      <div className="bracket-series-card placeholder">
        <span>{placeholder}</span>
      </div>
    );
  }

  const state = playoffSeriesState(league, series);
  const nextGame = state.nextGame ? scheduledById.get(state.nextGame.id) : undefined;
  const winnerTeam = state.winnerTeamId ? sourceTeamsById.get(state.winnerTeamId) : undefined;
  const status = state.winnerTeamId ? `${bracketTeamDisplay(winnerTeam, teamNames, state.winnerTeamId).compact} advances` : nextGame ? `Next: Game ${nextGame.playoffGameNumber}` : "Series pending";
  return (
    <button type="button" className={`bracket-series-card ${state.winnerTeamId ? "complete" : ""}`} onClick={() => onSelectSeries(series.id)}>
      <span className="bracket-series-meta">
        <span>{series.roundName}</span>
        <strong>{state.winsA}-{state.winsB}</strong>
      </span>
      <span className="bracket-team-stack">
        <BracketTeamLine teamId={series.teamAId} seed={series.seedA} wins={state.winsA} winner={state.winnerTeamId === series.teamAId} teamNames={teamNames} sourceTeamsById={sourceTeamsById} />
        <BracketTeamLine teamId={series.teamBId} seed={series.seedB} wins={state.winsB} winner={state.winnerTeamId === series.teamBId} teamNames={teamNames} sourceTeamsById={sourceTeamsById} />
      </span>
      <small>{status}</small>
    </button>
  );
}

function BracketTeamLine({
  teamId,
  seed,
  wins,
  score,
  winner,
  teamNames,
  sourceTeamsById
}: {
  teamId: string;
  seed?: number;
  wins?: number;
  score?: number;
  winner?: boolean;
  teamNames: Map<string, string>;
  sourceTeamsById: Map<string, SourceTeamCatalogEntry>;
}) {
  const team = sourceTeamsById.get(teamId);
  const display = bracketTeamDisplay(team, teamNames, teamId);
  const displayValue = score ?? wins;
  return (
    <span className={`bracket-team-line ${winner ? "winner" : ""}`} title={display.full}>
      <span className="bracket-seed">{seed ?? "-"}</span>
      {team ? <TeamLogo team={team} className="team-logo-mini" /> : <span className="standings-logo-placeholder" aria-hidden="true" />}
      <span className="bracket-team-copy">
        <strong>{display.primary}</strong>
        {display.secondary && <small>{display.secondary}</small>}
      </span>
      <b>{displayValue ?? "-"}</b>
    </span>
  );
}

function PlayInBracket({
  groups,
  scheduledById,
  teamNames,
  sourceTeamsById,
  renderGameActions,
  onOpenGame
}: {
  groups: Array<{ label: string; rows: NonNullable<LeagueState["playoffs"]>["playInGames"] }>;
  scheduledById: Map<string, ScheduledLeagueGame>;
  teamNames: Map<string, string>;
  sourceTeamsById: Map<string, SourceTeamCatalogEntry>;
  renderGameActions: (game: ScheduledLeagueGame | undefined) => React.ReactNode;
  onOpenGame: (game: ScheduledLeagueGame) => void;
}) {
  return (
    <section className="postseason-section">
      <div className="team-card-section-title">
        <h4>Play-In Tournament</h4>
        <span>{groups.reduce((sum, group) => sum + group.rows.length, 0).toLocaleString()} games</span>
      </div>
      <div className="playin-bracket-grid">
        {groups.map((group) => {
          const sevenEight = group.rows.find((row) => row.kind === "seven-eight");
          const nineTen = group.rows.find((row) => row.kind === "nine-ten");
          const eightSeed = group.rows.find((row) => row.kind === "eight-seed");
          return (
            <section key={group.label} className="playin-conference-bracket">
              <h5>{group.label}</h5>
              <div className="playin-bracket-lane">
                <div className="playin-opening-stack">
                  <PlayInGameCard row={sevenEight} scheduledById={scheduledById} teamNames={teamNames} sourceTeamsById={sourceTeamsById} renderGameActions={renderGameActions} onOpenGame={onOpenGame} />
                  <PlayInGameCard row={nineTen} scheduledById={scheduledById} teamNames={teamNames} sourceTeamsById={sourceTeamsById} renderGameActions={renderGameActions} onOpenGame={onOpenGame} />
                </div>
                <div className="playin-connector" aria-hidden="true" />
                <PlayInGameCard row={eightSeed} scheduledById={scheduledById} teamNames={teamNames} sourceTeamsById={sourceTeamsById} renderGameActions={renderGameActions} onOpenGame={onOpenGame} finalSlot />
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}

function PlayInGameCard({
  row,
  scheduledById,
  teamNames,
  sourceTeamsById,
  renderGameActions,
  onOpenGame,
  finalSlot = false
}: {
  row?: NonNullable<LeagueState["playoffs"]>["playInGames"][number];
  scheduledById: Map<string, ScheduledLeagueGame>;
  teamNames: Map<string, string>;
  sourceTeamsById: Map<string, SourceTeamCatalogEntry>;
  renderGameActions: (game: ScheduledLeagueGame | undefined) => React.ReactNode;
  onOpenGame: (game: ScheduledLeagueGame) => void;
  finalSlot?: boolean;
}) {
  if (!row) {
    return (
      <div className={`playin-game-card placeholder ${finalSlot ? "final-slot" : ""}`}>
        <span>{finalSlot ? "8 Seed Game" : "Awaiting matchup"}</span>
      </div>
    );
  }
  const game = scheduledById.get(row.gameId);
  const winnerTeamId = game?.result?.winnerTeamId && game.result.winnerTeamId !== "tie" ? game.result.winnerTeamId : undefined;
  return (
    <div className={`playin-game-card ${game?.result ? "played" : "unplayed"} ${finalSlot ? "final-slot" : ""}`}>
      <div className="postseason-card-title">
        <span>{playInKindLabel(row.kind)}</span>
        <strong>{game ? formatIsoDate(game.date) : "TBD"}</strong>
      </div>
      <span className="bracket-team-stack">
        <BracketTeamLine teamId={row.awayTeamId} seed={row.awaySeed} score={game ? teamGameScore(game, row.awayTeamId) : undefined} winner={winnerTeamId === row.awayTeamId} teamNames={teamNames} sourceTeamsById={sourceTeamsById} />
        <BracketTeamLine teamId={row.homeTeamId} seed={row.homeSeed} score={game ? teamGameScore(game, row.homeTeamId) : undefined} winner={winnerTeamId === row.homeTeamId} teamNames={teamNames} sourceTeamsById={sourceTeamsById} />
      </span>
      <div className="postseason-card-footer">
        <span>{winnerTeamId ? `${bracketTeamDisplay(sourceTeamsById.get(winnerTeamId), teamNames, winnerTeamId).compact} advances` : "Unplayed"}</span>
        <div className="postseason-game-actions">
          {game && (
            <Button icon={<FileText size={14} />} onClick={() => onOpenGame(game)}>
              {game.result ? "Box Score" : "Details"}
            </Button>
          )}
          {renderGameActions(game)}
        </div>
      </div>
    </div>
  );
}

function PostseasonSeriesModal({
  series,
  state,
  games,
  nextGame,
  teamNames,
  renderTeam,
  renderGameActions,
  onOpenGame,
  onClose
}: {
  series: LeaguePlayoffSeries;
  state: ReturnType<typeof playoffSeriesState>;
  games: ScheduledLeagueGame[];
  nextGame?: ScheduledLeagueGame;
  teamNames: Map<string, string>;
  renderTeam: (teamId: string, seed?: number, wins?: number, game?: ScheduledLeagueGame) => React.ReactNode;
  renderGameActions: (game: ScheduledLeagueGame | undefined) => React.ReactNode;
  onOpenGame: (game: ScheduledLeagueGame) => void;
  onClose: () => void;
}) {
  const winnerLabel = state.winnerTeamId ? `${teamLabel(teamNames, state.winnerTeamId)} wins series` : nextGame ? `Game ${nextGame.playoffGameNumber}` : "Awaiting result";
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <article className="panel postseason-series-modal" role="dialog" aria-modal="true" aria-labelledby="postseason-series-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="panel-title">
          <div>
            <h3 id="postseason-series-title">{series.conference} {series.roundName}</h3>
            <p>{winnerLabel}</p>
          </div>
          <Button onClick={onClose}>Close</Button>
        </div>
        <div className="series-modal-scoreboard">
          {renderTeam(series.teamAId, series.seedA, state.winsA)}
          {renderTeam(series.teamBId, series.seedB, state.winsB)}
        </div>
        <div className="series-modal-games">
          {games.map((game) => {
            const played = Boolean(game.result);
            const playable = !played && nextGame?.id === game.id;
            return (
              <section key={game.id} className={`series-modal-game ${played ? "played" : playable ? "next" : "pending"}`}>
                <div className="series-modal-game-header">
                  <span>Game {game.playoffGameNumber ?? "-"}</span>
                  <strong>{formatIsoDate(game.date)}</strong>
                  <em>{played ? "Final" : playable ? "Next" : "If necessary"}</em>
                </div>
                <div className="series-modal-scoreline">
                  <span className={game.result?.winnerTeamId === game.awayTeamId ? "winner" : ""}>
                    {teamLabel(teamNames, game.awayTeamId)}
                    <b>{game.result?.awayScore ?? "-"}</b>
                  </span>
                  <span className={game.result?.winnerTeamId === game.homeTeamId ? "winner" : ""}>
                    {teamLabel(teamNames, game.homeTeamId)}
                    <b>{game.result?.homeScore ?? "-"}</b>
                  </span>
                </div>
                <div className="series-modal-game-actions">
                  <Button icon={<FileText size={14} />} onClick={() => onOpenGame(game)}>
                    {played ? "Box Score" : "Details"}
                  </Button>
                  {(played || playable) && renderGameActions(game)}
                </div>
              </section>
            );
          })}
        </div>
      </article>
    </div>
  );
}

function playInKindLabel(kind: "seven-eight" | "nine-ten" | "eight-seed"): string {
  if (kind === "seven-eight") return "7/8 Game";
  if (kind === "nine-ten") return "9/10 Game";
  return "8 Seed Game";
}

function LeagueTeamDashboard({
  league,
  teamId,
  onTeamChange,
  teamNames,
  sourceTeamsById,
  scheduledGames,
  currentLeagueDate,
  onOpenGame
}: {
  league: LeagueState;
  teamId: string;
  onTeamChange: (teamId: string) => void;
  teamNames: Map<string, string>;
  sourceTeamsById: Map<string, SourceTeamCatalogEntry>;
  scheduledGames: ScheduledLeagueGame[];
  currentLeagueDate: string;
  onOpenGame: (game: ScheduledLeagueGame) => void;
}) {
  const selectedTeamId = teamId !== allTeamsValue && league.teamIds.includes(teamId) ? teamId : "";
  const team = selectedTeamId ? sourceTeamsById.get(selectedTeamId) : undefined;
  const rows = useMemo(() => standings(league), [league]);
  const row = selectedTeamId ? rows.find((standing) => standing.teamId === selectedTeamId) : undefined;
  const leader = rows[0];
  const teamStats = useMemo(() => aggregateTeamStats(league), [league]);
  const playerStats = useMemo(() => aggregatePlayerStats(league), [league]);
  const teamLine = selectedTeamId ? teamStats[selectedTeamId] ?? emptySeasonLine() : emptySeasonLine();
  const teamGames = selectedTeamId ? scheduledGames.filter((game) => game.awayTeamId === selectedTeamId || game.homeTeamId === selectedTeamId) : [];
  const completedTeamGames = teamGames.filter((game) => game.result);
  const upcomingTeamGames = teamGames.filter((game) => game.status === "unplayed" && (!currentLeagueDate || game.date >= currentLeagueDate));
  const upcomingFallbackGames = teamGames.filter((game) => game.status === "unplayed");
  const visibleUpcomingGames = (upcomingTeamGames.length ? upcomingTeamGames : upcomingFallbackGames).slice(0, 6);
  const recentResults = [...completedTeamGames].reverse().slice(0, 6);
  const lastTenGames = completedTeamGames.slice(-10);
  const playerRows = playerStats.filter((player) => player.teamId === selectedTeamId).slice(0, 12);
  const alignment = standingsAlignmentForTeam(team);
  const played = row?.played ?? 0;
  const differentialPerGame = played ? (row?.differential ?? 0) / played : null;
  const lastTenRecord = recordForGames(lastTenGames, selectedTeamId);
  const homeRecord = recordForGames(completedTeamGames.filter((game) => game.homeTeamId === selectedTeamId), selectedTeamId);
  const awayRecord = recordForGames(completedTeamGames.filter((game) => game.awayTeamId === selectedTeamId), selectedTeamId);

  return (
    <article className="panel league-team-dashboard">
      <div className="panel-title">
        <div>
          <h3>Team</h3>
          <p>{selectedTeamId ? `${teamLabel(teamNames, selectedTeamId)} league profile` : "Select a focus team to inspect."}</p>
        </div>
        <label className="league-team-select">
          Team
          <select value={selectedTeamId || allTeamsValue} onChange={(event) => onTeamChange(event.target.value)}>
            <option value={allTeamsValue}>Choose team</option>
            {league.teamIds.map((id) => {
              const entry = sourceTeamsById.get(id);
              return (
                <option key={id} value={id}>
                  {entry?.shortName ?? teamLabel(teamNames, id)}
                </option>
              );
            })}
          </select>
        </label>
      </div>

      {!selectedTeamId ? (
        <div className="empty-state">
          <strong>No team selected</strong>
          <p>Choose a team to see standings context, season stats, player production, and schedule detail.</p>
        </div>
      ) : (
        <>
          <div className="league-team-hero">
            {team && <TeamLogo team={team} className="team-logo-large" />}
            <div>
              <h3>{teamLabel(teamNames, selectedTeamId)}</h3>
              <p>{team ? `${team.season} · ${team.franchise}` : selectedTeamId}</p>
              <div className="player-card-tags">
                <span>{alignment.conference}</span>
                <span>{alignment.division}</span>
                <span>{standingsRecordLabel(row)}</span>
              </div>
            </div>
          </div>

          <MetricGrid
            metrics={[
              ["Record", standingsRecordLabel(row)],
              ["GP", played],
              ["Win %", row ? row.winPct.toFixed(3) : "-"],
              ["GB", formatGamesBack(row ?? leader, leader)],
              ["Last 10", lastTenRecord],
              ["Home/Away", `${homeRecord} / ${awayRecord}`],
              ["PPG", seasonLinePerGame(teamLine, "PTS")],
              ["OPP PPG", played ? formatNumber((row?.pointsAgainst ?? 0) / played, 1) : "-"],
              ["Diff/G", differentialPerGame === null ? "-" : `${differentialPerGame > 0 ? "+" : ""}${formatNumber(differentialPerGame, 1)}`],
              ["FG%", seasonLinePct(teamLine, "FGM", "FGA")],
              ["3P%", seasonLinePct(teamLine, "3PM", "3PA")],
              ["RPG", seasonLinePerGame(teamLine, "REB")]
            ]}
          />

          <div className="league-team-detail-grid">
            <section className="league-team-section">
              <div className="team-card-section-title">
                <h4>Recent Results</h4>
                <span>{recentResults.length.toLocaleString()} shown</span>
              </div>
              <LeagueTeamGameList games={recentResults} teamId={selectedTeamId} teamNames={teamNames} sourceTeamsById={sourceTeamsById} onOpenGame={onOpenGame} emptyLabel="No completed games yet." />
            </section>

            <section className="league-team-section">
              <div className="team-card-section-title">
                <h4>Upcoming</h4>
                <span>{visibleUpcomingGames.length.toLocaleString()} shown</span>
              </div>
              <LeagueTeamGameList games={visibleUpcomingGames} teamId={selectedTeamId} teamNames={teamNames} sourceTeamsById={sourceTeamsById} onOpenGame={onOpenGame} emptyLabel="No remaining games." />
            </section>

            <section className="league-team-section league-team-section-wide">
              <div className="team-card-section-title">
                <h4>Player Production</h4>
                <span>Per game</span>
              </div>
              {playerRows.length ? (
                <div className="table-wrap">
                  <table className="leaders-table league-team-player-table">
                    <thead>
                      <tr>
                        <th>Player</th>
                        <th className="numeric-cell">GP</th>
                        <th className="numeric-cell">PTS</th>
                        <th className="numeric-cell">REB</th>
                        <th className="numeric-cell">AST</th>
                        <th className="numeric-cell">STL</th>
                        <th className="numeric-cell">BLK</th>
                        <th className="numeric-cell">FG%</th>
                        <th className="numeric-cell">3P%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {playerRows.map((player) => (
                        <tr key={`${player.teamId}:${player.player}`}>
                          <td>
                            <PlayerNameButton teamId={player.teamId} player={player.player} />
                          </td>
                          <td className="numeric-cell">{player.games}</td>
                          {leaderStatFields.map((field) => (
                            <td className="numeric-cell" key={field}>
                              {round(player.perGame[field])}
                            </td>
                          ))}
                          <td className="numeric-cell">{pct(player.totals.FGM ?? 0, player.totals.FGA ?? 0)}</td>
                          <td className="numeric-cell">{pct(player.totals["3PM"] ?? 0, player.totals["3PA"] ?? 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="empty-state">No player stats have been recorded for this league team yet.</p>
              )}
            </section>
          </div>
        </>
      )}
    </article>
  );
}

function recordForGames(games: LeagueGame[], teamId: string): string {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (const game of games) {
    if (!game.result) continue;
    if (game.result.winnerTeamId === teamId) wins += 1;
    else if (game.result.winnerTeamId === "tie") ties += 1;
    else losses += 1;
  }
  return `${wins}-${losses}${ties ? `-${ties}` : ""}`;
}

function LeagueTeamGameList({
  games,
  teamId,
  teamNames,
  sourceTeamsById,
  onOpenGame,
  emptyLabel
}: {
  games: ScheduledLeagueGame[];
  teamId: string;
  teamNames: Map<string, string>;
  sourceTeamsById: Map<string, SourceTeamCatalogEntry>;
  onOpenGame: (game: ScheduledLeagueGame) => void;
  emptyLabel: string;
}) {
  if (!games.length) return <p className="empty-state">{emptyLabel}</p>;
  return (
    <div className="league-team-game-list">
      {games.map((game) => {
        const opponentId = opponentTeamId(game, teamId);
        const opponent = sourceTeamsById.get(opponentId);
        const venue = game.homeTeamId === teamId ? "vs" : "at";
        return (
          <button key={game.id} type="button" className="league-team-game-row" onClick={() => onOpenGame(game)}>
            <span>{formatIsoDate(game.date)}</span>
            <span className="league-team-game-opponent">
              {opponent && <TeamLogo team={opponent} className="team-logo-mini" />}
              <strong>
                {venue} {teamLabel(teamNames, opponentId)}
              </strong>
            </span>
            <span className={game.result ? (game.result.winnerTeamId === teamId ? "result-win" : "result-loss") : "result-pending"}>{teamGameResultLabel(game, teamId)}</span>
          </button>
        );
      })}
    </div>
  );
}

function initialManualInputs(game: LeagueGame, away: DiceTeamCard, home: DiceTeamCard): Record<string, Record<string, number>> {
  const inputs: Record<string, Record<string, number>> = {};
  for (const team of [away, home]) {
    for (const player of team.players) {
      const line = game.result?.playerStats[team.id]?.[player.name];
      inputs[statInputKey(team, player.name)] = Object.fromEntries(statColumns.map((field) => [field, line?.[field] ?? 0]));
    }
  }
  return inputs;
}

function valueAsNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/[^0-9.-]+/g, "");
  if (!cleaned) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function matchTeamFromText(text: string, away: DiceTeamCard, home: DiceTeamCard): DiceTeamCard | null {
  const normalized = normalizeText(text);
  for (const team of [away, home]) {
    const candidates = [team.id, team.name, team.shortName, team.abbr].map(normalizeText).filter(Boolean);
    if (candidates.some((candidate) => normalized.includes(candidate))) return team;
  }
  return null;
}

function matchPlayerFromText(text: string, team: DiceTeamCard): string | null {
  const normalized = normalizeText(text);
  const match = team.players.find((player) => {
    const playerName = normalizeText(player.name);
    const parts = playerName.split(" ").filter(Boolean);
    return normalized.includes(playerName) || (parts.length > 1 && normalized.includes(parts.at(-1) ?? ""));
  });
  return match?.name ?? null;
}

function rowsFromDelimitedText(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const delimiter = text.includes("\t") ? "\t" : ",";
  return lines.map((line) => line.split(delimiter).map((cell) => cell.trim()));
}

function parseScorecardRows(rows: unknown[][], sourceName: string, away: DiceTeamCard, home: DiceTeamCard): ParsedScorecard {
  const warnings: string[] = [];
  const playerInputs: Record<string, Record<string, number>> = initialManualInputs({ id: "", awayTeamId: away.id, homeTeamId: home.id, status: "unplayed" }, away, home);
  let awayScore: number | undefined;
  let homeScore: number | undefined;
  let rowsParsed = 0;
  const header = (rows[0] ?? []).map((cell) => normalizeText(String(cell ?? "")));
  const hasHeader = header.some((cell) => ["team", "club", "player", "name", ...statColumns.map(normalizeText)].includes(cell));
  const dataRows = rows.slice(hasHeader ? 1 : 0);
  const indexFor = (...names: string[]) => header.findIndex((cell) => names.some((name) => cell === normalizeText(name) || cell.includes(normalizeText(name))));
  const teamIndex = indexFor("team", "club");
  const playerIndex = indexFor("player", "name");
  const statIndexes = Object.fromEntries(statColumns.map((field) => [field, indexFor(field)]));
  const awayScoreIndex = indexFor("away score", "away final");
  const homeScoreIndex = indexFor("home score", "home final");

  for (const rawRow of dataRows) {
    const row = rawRow.map((cell) => String(cell ?? "").trim());
    const rowText = row.join(" ");
    if (!rowText.trim()) continue;
    if (awayScoreIndex >= 0) awayScore = valueAsNumber(row[awayScoreIndex]) ?? awayScore;
    if (homeScoreIndex >= 0) homeScore = valueAsNumber(row[homeScoreIndex]) ?? homeScore;

    const explicitTeamText = teamIndex >= 0 ? row[teamIndex] : rowText;
    let team = matchTeamFromText(explicitTeamText, away, home);
    let player = team ? matchPlayerFromText(playerIndex >= 0 ? row[playerIndex] : rowText, team) : null;
    if (!team || !player) {
      for (const candidateTeam of [away, home]) {
        const candidatePlayer = matchPlayerFromText(playerIndex >= 0 ? row[playerIndex] : rowText, candidateTeam);
        if (candidatePlayer) {
          team = candidateTeam;
          player = candidatePlayer;
          break;
        }
      }
    }

    const ptsIndex = statIndexes.PTS;
    if (team && !player && ptsIndex >= 0) {
      const score = valueAsNumber(row[ptsIndex]);
      if (score !== undefined) {
        if (team.id === away.id) awayScore = score;
        if (team.id === home.id) homeScore = score;
      }
    }

    if (team && player) {
      const key = statInputKey(team, player);
      const nextLine = { ...(playerInputs[key] ?? {}) };
      if (Object.values(statIndexes).some((column) => column >= 0)) {
        for (const field of statColumns) {
          const column = statIndexes[field];
          if (column >= 0) nextLine[field] = valueAsNumber(row[column]) ?? nextLine[field] ?? 0;
        }
      } else {
        const numbers = rowText.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
        statColumns.forEach((field, index) => {
          nextLine[field] = numbers[index] ?? nextLine[field] ?? 0;
        });
      }
      playerInputs[key] = nextLine;
      rowsParsed += 1;
    }
  }

  const awayPlayerPoints = Object.entries(playerInputs)
    .filter(([key]) => key.startsWith(`${away.id}:`))
    .reduce((sum, [, line]) => sum + (line.PTS ?? 0), 0);
  const homePlayerPoints = Object.entries(playerInputs)
    .filter(([key]) => key.startsWith(`${home.id}:`))
    .reduce((sum, [, line]) => sum + (line.PTS ?? 0), 0);
  awayScore ??= awayPlayerPoints || undefined;
  homeScore ??= homePlayerPoints || undefined;
  if (!rowsParsed) warnings.push("No player rows were confidently matched. Use CSV/TSV columns named Team, Player, PTS, REB, AST, STL, BLK, TOV, PF for best results.");
  if (awayScore === undefined || homeScore === undefined) warnings.push("Final score was not fully detected. Review the score fields before saving.");

  return { sourceName, awayScore, homeScore, playerInputs, warnings, rowsParsed };
}

async function parseScorecardFile(file: File, away: DiceTeamCard, home: DiceTeamCard): Promise<ParsedScorecard> {
  const lowerName = file.name.toLowerCase();
  if (file.type.startsWith("image/")) {
    const imagePreviewUrl = URL.createObjectURL(file);
    try {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng");
      const recognized = await worker.recognize(file);
      await worker.terminate();
      const parsed = parseScorecardRows(rowsFromDelimitedText(recognized.data.text), file.name, away, home);
      parsed.imagePreviewUrl = imagePreviewUrl;
      if (!parsed.rowsParsed) parsed.warnings.push("OCR completed, but no player stat rows were confidently matched. Review the image and parsed fields before saving.");
      return parsed;
    } catch (reason) {
      return {
        sourceName: file.name,
        playerInputs: initialManualInputs({ id: "", awayTeamId: away.id, homeTeamId: home.id, status: "unplayed" }, away, home),
        rowsParsed: 0,
        warnings: [`Photo OCR failed: ${reason instanceof Error ? reason.message : String(reason)}. You can still paste OCR text or use CSV/TSV/XLSX.`],
        imagePreviewUrl
      };
    }
  }
  if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, blankrows: false });
    return parseScorecardRows(rows, file.name, away, home);
  }
  const text = await file.text();
  if (lowerName.endsWith(".json")) {
    const json = JSON.parse(text) as unknown;
    if (Array.isArray(json)) return parseScorecardRows(json as unknown[][], file.name, away, home);
    if (json && typeof json === "object") {
      const record = json as { awayScore?: unknown; homeScore?: unknown; rows?: unknown };
      const parsed = Array.isArray(record.rows) ? parseScorecardRows(record.rows as unknown[][], file.name, away, home) : parseScorecardRows([], file.name, away, home);
      parsed.awayScore = valueAsNumber(record.awayScore) ?? parsed.awayScore;
      parsed.homeScore = valueAsNumber(record.homeScore) ?? parsed.homeScore;
      return parsed;
    }
  }
  return parseScorecardRows(rowsFromDelimitedText(text), file.name, away, home);
}

function LeagueGameInfoModal({
  game,
  league,
  teamNames,
  sourceTeamsById,
  loadTeam,
  pending,
  readOnly = false,
  onClose,
  onWatch,
  onManual,
  onSim,
  onReset
}: {
  game: ScheduledLeagueGame;
  league: LeagueState;
  teamNames: Map<string, string>;
  sourceTeamsById: Map<string, SourceTeamCatalogEntry>;
  loadTeam: (teamId: string) => Promise<DiceTeamCard>;
  pending: boolean;
  readOnly?: boolean;
  onClose: () => void;
  onWatch: () => void;
  onManual: () => void;
  onSim: () => void;
  onReset: () => void;
}) {
  const [activeTeamCard, setActiveTeamCard] = useState<DiceTeamCard | null>(null);
  const [teamCardLoadingId, setTeamCardLoadingId] = useState<string | null>(null);
  const [teamCardError, setTeamCardError] = useState<string | null>(null);
  const [boxScoreTeams, setBoxScoreTeams] = useState<{ away: DiceTeamCard; home: DiceTeamCard } | null>(null);
  const [boxScoreError, setBoxScoreError] = useState<string | null>(null);
  const awayTeam = sourceTeamsById.get(game.awayTeamId);
  const homeTeam = sourceTeamsById.get(game.homeTeamId);
  const leagueRows = new Map(standings(league).map((row) => [row.teamId, row]));
  const leagueRecord = (teamId: string): string => {
    const row = leagueRows.get(teamId);
    return standingsRecordLabel(row);
  };
  const winnerLabel = game.result?.winnerTeamId && game.result.winnerTeamId !== "tie" ? teamLabel(teamNames, game.result.winnerTeamId) : game.result?.winnerTeamId === "tie" ? "Tie" : "-";

  const openTeamCard = async (teamId: string) => {
    setTeamCardError(null);
    setTeamCardLoadingId(teamId);
    try {
      setActiveTeamCard(await loadTeam(teamId));
    } catch (reason) {
      setTeamCardError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setTeamCardLoadingId(null);
    }
  };

  useEffect(() => {
    if (!game.result) {
      setBoxScoreTeams(null);
      setBoxScoreError(null);
      return;
    }
    let active = true;
    setBoxScoreTeams(null);
    setBoxScoreError(null);
    Promise.all([loadTeam(game.awayTeamId), loadTeam(game.homeTeamId)])
      .then(([away, home]) => {
        if (active) setBoxScoreTeams({ away, home });
      })
      .catch((reason: unknown) => {
        if (active) setBoxScoreError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      active = false;
    };
  }, [game.awayTeamId, game.homeTeamId, game.id, game.result, loadTeam]);

  const renderTeam = (role: "Away" | "Home", teamId: string, team?: SourceTeamCatalogEntry) => (
    <button type="button" className="game-info-team" aria-label={`Open ${teamLabel(teamNames, teamId)} team card`} onClick={() => void openTeamCard(teamId)}>
      <div className="game-info-team-heading">
        {team && <TeamLogo team={team} className="team-logo-score" />}
        <span>
          <small>{role}</small>
          <strong>{teamLabel(teamNames, teamId)}</strong>
        </span>
        <b>{role === "Away" ? game.result?.awayScore ?? "-" : game.result?.homeScore ?? "-"}</b>
      </div>
      <div className="game-info-team-meta">
        <span>{team ? `${team.season} · ${team.franchise}` : teamId}</span>
        <span>Source {team ? recordLabel(team) : "-"}</span>
        <span>Current {leagueRecord(teamId)}</span>
      </div>
      {teamCardLoadingId === teamId && <span className="game-info-team-loading">Loading card...</span>}
    </button>
  );

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <article className="panel game-info-panel" role="dialog" aria-modal="true" aria-labelledby="game-info-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="panel-title">
          <div>
            <h3 id="game-info-title">{leagueGameLabel(game, teamNames)}</h3>
            <p>
              {formatIsoDate(game.date)} · Game {game.sequence.toLocaleString()}
            </p>
          </div>
          <Button onClick={onClose}>Close</Button>
        </div>

        <div className="game-info-matchup">
          {renderTeam("Away", game.awayTeamId, awayTeam)}
          {renderTeam("Home", game.homeTeamId, homeTeam)}
        </div>
        {teamCardError && <p className="form-error">{teamCardError}</p>}

        <div className="game-info-detail-grid">
          <div>
            <span>Status</span>
            <strong className={`status ${game.status}`}>{game.status}</strong>
          </div>
          <div>
            <span>Round</span>
            <strong>{game.round ?? "-"}</strong>
          </div>
          <div>
            <span>Score</span>
            <strong>{game.result ? `${game.result.awayScore}-${game.result.homeScore}` : "-"}</strong>
          </div>
          <div>
            <span>Winner</span>
            <strong>{winnerLabel}</strong>
          </div>
        </div>

        {game.result && (
          <section className="game-info-box-score result-panel">
            <div className="team-card-section-title">
              <h4>Full Box Score</h4>
              <span>{game.result.source}</span>
            </div>
            {boxScoreError && <p className="form-error">{boxScoreError}</p>}
            {!boxScoreError && !boxScoreTeams && <p className="empty-state">Loading full box score.</p>}
            {boxScoreTeams && <GameResultContent result={game.result} away={boxScoreTeams.away} home={boxScoreTeams.home} showHeader={false} />}
          </section>
        )}

        {!readOnly && (
          <div className="actions">
            <Button icon={<Play size={16} />} disabled={pending} onClick={onWatch}>
              Watch
            </Button>
            <Button icon={<Play size={16} />} disabled={pending || game.status !== "unplayed"} onClick={onSim}>
              Sim
            </Button>
            <Button icon={<FileText size={16} />} disabled={pending} onClick={onManual}>
              Manual
            </Button>
            <Button icon={<RotateCcw size={16} />} disabled={pending} onClick={onReset}>
              Reset
            </Button>
          </div>
        )}
      </article>
      {activeTeamCard && <TeamCardModal team={activeTeamCard} onClose={() => setActiveTeamCard(null)} />}
    </div>
  );
}

function LeagueModelSettingsPanel({
  league,
  teams,
  loadTeam,
  onChange
}: {
  league: LeagueState;
  teams: SourceTeamCatalogEntry[];
  loadTeam: (teamId: string) => Promise<DiceTeamCard>;
  onChange: (options: MatchupOptions) => void;
}) {
  const options = defaultLeagueMatchupOptions(league);
  const eraContext = options.eraContext ?? ({ mode: "midpoint", blend: 0.5 } satisfies EraContextOptions);
  const gameplay = options.gameplay ?? {};
  const blendPct = Math.round((eraContext.blend ?? 0.5) * 100);
  const fixedSeason = eraContext.seasonEndYear ?? Math.round((minEraContextSeason + maxEraContextSeason) / 2);
  const tempoPct = Math.round((gameplay.tempoMultiplier ?? 1) * 100);
  const [activeTeamId, setActiveTeamId] = useState(league.focusTeamId ?? league.teamIds[0] ?? "");
  const [activeTeamCard, setActiveTeamCard] = useState<DiceTeamCard | null>(null);
  const [activeTeamLoadError, setActiveTeamLoadError] = useState<string | null>(null);
  const activeTeam = teams.find((team) => team.id === activeTeamId) ?? teams[0];
  const activeVisualTeam = activeTeamCard ?? activeTeam;
  const activePlan = normalizedTeamGamePlan(activeTeam ? gameplay.teamPlans?.[activeTeam.id] : undefined);
  const adjustedTeamCount = league.teamIds.filter((teamId) => !isNeutralTeamGamePlan(gameplay.teamPlans?.[teamId])).length;
  const activePlanAdjusted = !isNeutralTeamGamePlan(activePlan);
  const setOptions = (next: MatchupOptions) => onChange(next);
  const setEraContext = (next: EraContextOptions) => setOptions({ ...options, eraContext: next });
  const setEraMode = (mode: EraContextMode) => {
    if (mode === "midpoint") {
      setEraContext({ mode, blend: eraContext.blend ?? 0.5 });
      return;
    }
    if (mode === "fixed-season") {
      setEraContext({ mode, seasonEndYear: clampNumber(fixedSeason, minEraContextSeason, maxEraContextSeason) });
      return;
    }
    setEraContext({ mode });
  };
  const setTempoPct = (tempo: number) => {
    setOptions({
      ...options,
      gameplay: {
        ...gameplay,
        tempoMultiplier: clampNumber(tempo, 85, 115) / 100
      }
    });
  };
  const setTeamPlan = (teamId: string, plan: Required<TeamGamePlanOptions>) => {
    const nextTeamPlans = { ...(gameplay.teamPlans ?? {}) };
    const normalized = normalizedTeamGamePlan(plan);
    if (isNeutralTeamGamePlan(normalized)) {
      delete nextTeamPlans[teamId];
    } else {
      nextTeamPlans[teamId] = normalized;
    }
    setOptions({
      ...options,
      gameplay: {
        ...gameplay,
        teamPlans: Object.keys(nextTeamPlans).length ? nextTeamPlans : undefined
      }
    });
  };
  const resetAllGamePlans = () => {
    setOptions({
      ...options,
      gameplay: {
        tempoMultiplier: 1
      }
    });
  };

  useEffect(() => {
    if (activeTeamId && league.teamIds.includes(activeTeamId)) return;
    setActiveTeamId(league.focusTeamId ?? league.teamIds[0] ?? "");
  }, [activeTeamId, league.focusTeamId, league.teamIds]);

  useEffect(() => {
    if (!activeTeam) {
      setActiveTeamCard(null);
      setActiveTeamLoadError(null);
      return;
    }
    let mounted = true;
    setActiveTeamCard(null);
    setActiveTeamLoadError(null);
    loadTeam(activeTeam.id)
      .then((teamCard) => {
        if (mounted) setActiveTeamCard(teamCard);
      })
      .catch((reason: unknown) => {
        if (mounted) setActiveTeamLoadError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      mounted = false;
    };
  }, [activeTeam?.id, loadTeam]);

  return (
    <details className="panel setup-panel league-model-settings">
      <summary>
        <span className="setup-summary-main">
          <strong>Model Settings</strong>
          <span>{league.name}</span>
        </span>
        <span className="setup-summary-meta">
          {eraContext.mode === "midpoint" ? `Midpoint ${blendPct}%` : eraContext.mode.replace("-", " ")} · {tempoPct}% · {adjustedTeamCount} plans
        </span>
      </summary>
      <div className="setup-panel-body">
        <div className="options-bar">
          <SegmentedControl
            label="Venue"
            value={options.venue}
            options={[
              { value: "home-court", label: "Home court" },
              { value: "neutral", label: "Neutral" }
            ]}
            onChange={(venue) => setOptions({ ...options, venue })}
          />
          <SegmentedControl
            label="Game type"
            value={options.intensity}
            options={[
              { value: "regular", label: "Regular" },
              { value: "playoff", label: "Playoff" }
            ]}
            onChange={(intensity) => setOptions({ ...options, intensity })}
          />
          <SegmentedControl<EraContextMode>
            label="Era"
            value={eraContext.mode}
            options={[
              { value: "midpoint", label: "Midpoint" },
              { value: "older-era", label: "Older" },
              { value: "newer-era", label: "Newer" },
              { value: "away-era", label: "Away" },
              { value: "home-era", label: "Home" },
              { value: "fixed-season", label: "Fixed" }
            ]}
            onChange={setEraMode}
          />
          {eraContext.mode === "midpoint" && (
            <label className="era-slider-control">
              <span>Blend</span>
              <input type="range" min={0} max={100} step={5} value={blendPct} onChange={(event) => setEraContext({ mode: "midpoint", blend: Number(event.target.value) / 100 })} />
              <b>{blendPct}%</b>
            </label>
          )}
          {eraContext.mode === "fixed-season" && (
            <label className="era-number-control">
              <span>Season</span>
              <input
                type="number"
                min={minEraContextSeason}
                max={maxEraContextSeason}
                value={fixedSeason}
                onChange={(event) => {
                  const parsed = Number(event.target.value);
                  setEraContext({
                    mode: "fixed-season",
                    seasonEndYear: Number.isFinite(parsed) ? clampNumber(Math.round(parsed), minEraContextSeason, maxEraContextSeason) : fixedSeason
                  });
                }}
              />
            </label>
          )}
          <label className="era-slider-control tempo-control">
            <span>Tempo</span>
            <input
              type="range"
              min={85}
              max={115}
              step={1}
              value={tempoPct}
              onChange={(event) => setTempoPct(Number(event.target.value))}
            />
            <b>{tempoPct}%</b>
          </label>
        </div>
        {activeTeam && (
          <div className="game-plan-controls league-game-plan-controls">
            <div className="game-plan-header league-game-plan-header">
              <label className="inline-input league-plan-team-select">
                Team
                <select value={activeTeam.id} onChange={(event) => setActiveTeamId(event.target.value)}>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.shortName}
                    </option>
                  ))}
                </select>
              </label>
              <div className="league-plan-actions">
                <span className="badge">{activePlanAdjusted ? "Custom plan" : "Neutral plan"}</span>
                <Button icon={<RotateCcw size={14} />} disabled={!activePlanAdjusted} onClick={() => setTeamPlan(activeTeam.id, neutralTeamGamePlan)}>
                  Reset Team
                </Button>
                <Button icon={<RotateCcw size={14} />} disabled={tempoPct === 100 && adjustedTeamCount === 0} onClick={resetAllGamePlans}>
                  Reset All
                </Button>
              </div>
            </div>
            <GamePlanSliders team={activeVisualTeam} label="Team plan" plan={activePlan} onChange={(plan) => setTeamPlan(activeTeam.id, plan)} />
            {activeTeamLoadError && <p className="form-error">{activeTeamLoadError}</p>}
            {!activeTeamLoadError && !activeTeamCard && <p className="empty-state">Loading roster.</p>}
            {activeTeamCard && <PlayerUsageSliders team={activeTeamCard} plan={activePlan} intensity={options.intensity} onChange={(plan) => setTeamPlan(activeTeam.id, plan)} />}
          </div>
        )}
      </div>
    </details>
  );
}

function LeagueWatchGameLoader({
  game,
  league,
  setLeague,
  onClose,
  loadTeam
}: {
  game: LeagueGame;
  league: LeagueState;
  setLeague: (league: LeagueState) => void;
  onClose: () => void;
  loadTeam: (teamId: string) => Promise<DiceTeamCard>;
}) {
  const [teams, setTeams] = useState<{ away: DiceTeamCard; home: DiceTeamCard } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const leagueRows = useMemo(() => new Map(standings(league).map((row) => [row.teamId, row])), [league]);
  const leagueRecord = (teamId: string) => standingsRecordLabel(leagueRows.get(teamId));
  const matchupOptions = leagueGameMatchupOptions(game, league);

  useEffect(() => {
    let active = true;
    setTeams(null);
    setError(null);
    Promise.all([loadTeam(game.awayTeamId), loadTeam(game.homeTeamId)])
      .then(([away, home]) => {
        if (active) setTeams({ away, home });
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      active = false;
    };
  }, [game.awayTeamId, game.homeTeamId, loadTeam]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <article className="panel watch-panel" onMouseDown={(event) => event.stopPropagation()}>
        <div className="panel-title">
          <div>
            <h3>Watch Scheduled Game</h3>
            <p>{teams ? `${teams.away.shortName} (${leagueRecord(teams.away.id)}) at ${teams.home.shortName} (${leagueRecord(teams.home.id)})` : "Loading matchup."}</p>
          </div>
          <Button onClick={onClose}>Close</Button>
        </div>
        {error && (
          <div className="empty-state">
            <strong>Watch Failed</strong>
            <p>{error}</p>
          </div>
        )}
        {!error && !teams && <p className="empty-state">Loading scheduled game teams.</p>}
        {teams && (
          <PlayableMatchup
            matchup={buildMatchupCard(teams.away, teams.home, matchupOptions)}
            matchupOptions={matchupOptions}
            title="Watch Game"
            compact
            onSaveResult={(result) => setLeague(setSimulatedLeagueResult(league, game.id, result))}
          />
        )}
      </article>
    </div>
  );
}

function ManualResultFormLoader({
  game,
  league,
  setLeague,
  onClose,
  loadTeam
}: {
  game: LeagueGame;
  league: LeagueState;
  setLeague: (league: LeagueState) => void;
  onClose: () => void;
  loadTeam: (teamId: string) => Promise<DiceTeamCard>;
}) {
  const [teams, setTeams] = useState<{ away: DiceTeamCard; home: DiceTeamCard } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setTeams(null);
    setError(null);
    Promise.all([loadTeam(game.awayTeamId), loadTeam(game.homeTeamId)])
      .then(([away, home]) => {
        if (active) setTeams({ away, home });
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      active = false;
    };
  }, [game.awayTeamId, game.homeTeamId, loadTeam]);

  if (error) {
    return (
      <div className="modal-backdrop" onMouseDown={onClose}>
        <article className="panel confirm-panel" onMouseDown={(event) => event.stopPropagation()}>
          <h3>Manual Result Failed</h3>
          <p>{error}</p>
          <Button onClick={onClose}>Close</Button>
        </article>
      </div>
    );
  }

  if (!teams) {
    return (
      <div className="modal-backdrop" onMouseDown={onClose}>
        <article className="panel confirm-panel" onMouseDown={(event) => event.stopPropagation()}>
          <h3>Loading</h3>
          <p>Loading manual result teams.</p>
        </article>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <ManualResultForm game={game} league={league} setLeague={setLeague} onClose={onClose} away={teams.away} home={teams.home} />
    </div>
  );
}

function ManualResultForm({
  game,
  league,
  setLeague,
  onClose,
  away,
  home
}: {
  game: LeagueGame;
  league: LeagueState;
  setLeague: (league: LeagueState) => void;
  onClose: () => void;
  away: DiceTeamCard;
  home: DiceTeamCard;
}) {
  const [awayScore, setAwayScore] = useState(game.result?.awayScore ?? 0);
  const [homeScore, setHomeScore] = useState(game.result?.homeScore ?? 0);
  const [playerInputs, setPlayerInputs] = useState<Record<string, Record<string, number>>>(() => initialManualInputs(game, away, home));
  const [manualError, setManualError] = useState<string | null>(null);
  const [parsedScorecard, setParsedScorecard] = useState<ParsedScorecard | null>(null);
  const [parseBusy, setParseBusy] = useState(false);
  const [parseText, setParseText] = useState("");
  const [activePlayerCard, setActivePlayerCard] = useState<{ team: DiceTeamCard; player: DicePlayerCard } | null>(null);
  const leagueRows = useMemo(() => new Map(standings(league).map((row) => [row.teamId, row])), [league]);
  const leagueRecord = (teamId: string) => standingsRecordLabel(leagueRows.get(teamId));
  const matchupOptions = leagueGameMatchupOptions(game, league);

  const update = (team: DiceTeamCard, player: string, field: string, value: number) => {
    const key = statInputKey(team, player);
    setPlayerInputs((current) => ({
      ...current,
      [key]: {
        ...(current[key] ?? {}),
        [field]: value
      }
    }));
  };

  const applyParsedScorecard = (parsed: ParsedScorecard) => {
    if (parsed.awayScore !== undefined) setAwayScore(parsed.awayScore);
    if (parsed.homeScore !== undefined) setHomeScore(parsed.homeScore);
    setPlayerInputs((current) => ({ ...current, ...parsed.playerInputs }));
  };

  const parseFile = async (file: File | null) => {
    if (!file) return;
    setManualError(null);
    setParseBusy(true);
    try {
      const parsed = await parseScorecardFile(file, away, home);
      setParsedScorecard(parsed);
    } catch (reason) {
      setManualError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setParseBusy(false);
    }
  };

  const parsePastedText = () => {
    setManualError(null);
    try {
      setParsedScorecard(parseScorecardRows(rowsFromDelimitedText(parseText), "Pasted text", away, home));
    } catch (reason) {
      setManualError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const submit = () => {
    setManualError(null);
    let result: GameResult;
    try {
      result = createManualResult(away, home, awayScore, homeScore, matchupOptions);
    } catch (reason) {
      setManualError(reason instanceof Error ? reason.message : String(reason));
      return;
    }
    for (const team of [away, home]) {
      const teamLine: StatLine = result.teamStats[team.id];
      for (const player of team.players) {
        const key = `${team.id}:${player.name}`;
        const input = playerInputs[key] ?? {};
        const line = result.playerStats[team.id][player.name];
        for (const field of statColumns) {
          line[field] = input[field] ?? 0;
          teamLine[field] = (teamLine[field] ?? 0) + line[field];
        }
      }
      teamLine.PTS = team.id === away.id ? awayScore : homeScore;
    }
    setLeague(setManualLeagueResult(league, game.id, result));
    onClose();
  };

  return (
    <article className="panel manual-panel" onMouseDown={(event) => event.stopPropagation()}>
      <div className="panel-title">
        <div>
          <h3>
            Manual Result: {away.shortName} at {home.shortName}
          </h3>
          <p>
            {away.shortName} {leagueRecord(away.id)} at {home.shortName} {leagueRecord(home.id)} · Import a scorecard, review parsed values, then save the final result.
          </p>
        </div>
        <Button onClick={onClose}>Close</Button>
      </div>
      <section className="scorecard-import">
        <label>
          Scorecard file
          <input
            type="file"
            accept=".csv,.tsv,.txt,.json,.xlsx,.xls,image/*"
            onChange={(event) => {
              void parseFile(event.target.files?.[0] ?? null);
              event.currentTarget.value = "";
            }}
          />
        </label>
        <label>
          Paste OCR or scorecard text
          <textarea value={parseText} onChange={(event) => setParseText(event.target.value)} placeholder="Team, Player, PTS, REB, AST, STL, BLK, TOV, PF" />
        </label>
        <div className="actions">
          <Button disabled={!parseText.trim() || parseBusy} onClick={parsePastedText}>
            Parse Text
          </Button>
        </div>
      </section>
      {parsedScorecard && (
        <section className="scorecard-preview">
          <div className="panel-title">
            <div>
              <h4>Parsed Scorecard</h4>
              <p>
                {parsedScorecard.sourceName} · {parsedScorecard.rowsParsed} matched player rows
              </p>
            </div>
            <Button disabled={parseBusy} variant="primary" onClick={() => applyParsedScorecard(parsedScorecard)}>
              Apply Parsed Data
            </Button>
          </div>
          {parsedScorecard.imagePreviewUrl && <img className="scorecard-image-preview" src={parsedScorecard.imagePreviewUrl} alt="Uploaded scorecard preview" />}
          <div className="scorecard-preview-grid">
            <span>{away.shortName}</span>
            <strong>{parsedScorecard.awayScore ?? "-"}</strong>
            <span>{home.shortName}</span>
            <strong>{parsedScorecard.homeScore ?? "-"}</strong>
          </div>
          {parsedScorecard.warnings.length > 0 && (
            <ul className="parse-warnings">
              {parsedScorecard.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
        </section>
      )}
      <div className="score-inputs">
        <label>
          {away.shortName}
          <input data-testid="manual-away-score" type="number" min={0} value={awayScore} onChange={(event) => setAwayScore(Number(event.target.value))} />
        </label>
        <label>
          {home.shortName}
          <input data-testid="manual-home-score" type="number" min={0} value={homeScore} onChange={(event) => setHomeScore(Number(event.target.value))} />
        </label>
      </div>
      {manualError && <p className="form-error">{manualError}</p>}
      {[away, home].map((team) => (
        <div key={team.id}>
          <h4>{team.shortName} player stats</h4>
          <div className="manual-grid">
            <div className="manual-head">Player</div>
            {statColumns.map((field) => (
              <div className="manual-head" key={field}>
                {field}
              </div>
            ))}
            {team.players.map((player) => (
              <ManualPlayerRow
                key={player.id}
                team={team}
                player={player}
                values={playerInputs[statInputKey(team, player.name)] ?? {}}
                update={update}
                onPlayerSelect={(selectedPlayer) => setActivePlayerCard({ team, player: selectedPlayer })}
              />
            ))}
          </div>
        </div>
      ))}
      {activePlayerCard && <PlayerCardModal team={activePlayerCard.team} player={activePlayerCard.player} onClose={() => setActivePlayerCard(null)} />}
      <Button data-testid="save-manual-result" icon={<FileText size={16} />} variant="primary" onMouseDown={submit} onClick={submit}>
        Save Manual Result
      </Button>
    </article>
  );
}

function ManualPlayerRow({
  team,
  player,
  values,
  update,
  onPlayerSelect
}: {
  team: DiceTeamCard;
  player: DicePlayerCard;
  values: Record<string, number>;
  update: (team: DiceTeamCard, player: string, field: string, value: number) => void;
  onPlayerSelect?: (player: DicePlayerCard) => void;
}) {
  return (
    <>
      <div className="manual-player">
        <PlayerIdentity player={player} onSelect={onPlayerSelect} />
      </div>
      {statColumns.map((field) => (
        <input key={field} type="number" min={0} value={values[field] ?? 0} onChange={(event) => update(team, player.name, field, Number(event.target.value))} />
      ))}
    </>
  );
}

function StandingsTable({
  league,
  teamNames,
  sourceTeamsById
}: {
  league: LeagueState;
  teamNames: Map<string, string>;
  sourceTeamsById: Map<string, SourceTeamCatalogEntry>;
}) {
  const [view, setView] = useState<StandingsView>("conference");
  const rows = useMemo(() => standings(league), [league]);
  const seedsByTeamId = useMemo(() => conferenceSeedMap(rows, sourceTeamsById), [rows, sourceTeamsById]);
  const standingsSubtitle =
    view === "overall" ? "Overall table sorted by record" : view === "conference" ? "Grouped by conference and sorted by record" : "Grouped by division and sorted by record";
  const groups = useMemo<StandingsGroup[]>(() => {
    if (view === "overall") return [{ label: "Overall", rows }];
    if (view === "conference") {
      return groupedStandingsRows(
        rows,
        (row) => standingsAlignmentForTeam(sourceTeamsById.get(row.teamId)).conference,
        standingsConferenceOrder
      );
    }
    return groupedStandingsRows(
      rows,
      (row) => standingsAlignmentForTeam(sourceTeamsById.get(row.teamId)).division,
      standingsDivisionOrder
    );
  }, [rows, sourceTeamsById, view]);

  return (
    <article className="panel standings-panel">
      <div className="panel-title standings-title">
        <div>
          <h3>{league.name} Standings</h3>
          <p>{standingsSubtitle}</p>
        </div>
      </div>
      <div className="standings-toolbar">
        <div className="segmented">
          <span>View</span>
          <div className="segment-buttons">
            <button type="button" className={view === "conference" ? "active" : ""} onClick={() => setView("conference")}>
              Conference
            </button>
            <button type="button" className={view === "division" ? "active" : ""} onClick={() => setView("division")}>
              Division
            </button>
            <button type="button" className={view === "overall" ? "active" : ""} onClick={() => setView("overall")}>
              Overall
            </button>
          </div>
        </div>
        {view === "conference" && (
          <div className="standings-seed-legend" aria-label="Playoff seed key">
            <span className="seed-key playoff">1-6 Playoff</span>
            <span className="seed-key play-in">7-10 Play-in</span>
          </div>
        )}
      </div>
      <div className={`standings-group-grid ${view}`}>
        {groups.map((group) => (
          <section className="standings-group" key={group.label}>
            <h4>
              {group.label}
              <span>{group.rows.length.toLocaleString()} teams</span>
            </h4>
            <StandingsRowsTable
              rows={group.rows}
              teamNames={teamNames}
              sourceTeamsById={sourceTeamsById}
              seedsByTeamId={seedsByTeamId}
              showPlayoffIndicators={view === "conference"}
            />
          </section>
        ))}
      </div>
    </article>
  );
}

function StandingsRowsTable({
  rows,
  teamNames,
  sourceTeamsById,
  seedsByTeamId,
  showPlayoffIndicators
}: {
  rows: StandingRow[];
  teamNames: Map<string, string>;
  sourceTeamsById: Map<string, SourceTeamCatalogEntry>;
  seedsByTeamId: Map<string, StandingsSeed>;
  showPlayoffIndicators: boolean;
}) {
  const leader = rows[0];

  return (
    <div className="table-wrap">
      <table className="standings-table">
        <thead>
          <tr>
            <th className="standings-rank">#</th>
            <th>Team</th>
            <th className="numeric-cell">GP</th>
            <th className="numeric-cell">W</th>
            <th className="numeric-cell">L</th>
            <th className="numeric-cell">Pct</th>
            <th className="numeric-cell">GB</th>
            <th className="numeric-cell">PF</th>
            <th className="numeric-cell">PA</th>
            <th className="numeric-cell">Diff</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const team = sourceTeamsById.get(row.teamId);
            const seed = showPlayoffIndicators ? seedsByTeamId.get(row.teamId) : undefined;
            return (
              <tr key={row.teamId} className={seed ? `standings-row seed-${seed.status}` : undefined}>
                <td className="standings-rank">{index + 1}</td>
                <td className="standings-team-cell">
                  <TeamIdentityButton team={team} teamId={row.teamId} teamNames={teamNames} />
                </td>
                <td className="numeric-cell">{row.played}</td>
                <td className="numeric-cell">{row.wins}</td>
                <td className="numeric-cell">{row.losses}</td>
                <td className="numeric-cell">{row.winPct.toFixed(3)}</td>
                <td className="numeric-cell">{formatGamesBack(row, leader)}</td>
                <td className="numeric-cell">{row.pointsFor}</td>
                <td className="numeric-cell">{row.pointsAgainst}</td>
                <td className="numeric-cell">{formatDifferential(row.differential)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatGamesBack(row: StandingRow, leader?: StandingRow): string {
  if (!leader || row.teamId === leader.teamId) return "-";
  const gamesBack = (leader.wins - row.wins + row.losses - leader.losses) / 2;
  if (gamesBack <= 0) return "-";
  return Number.isInteger(gamesBack) ? gamesBack.toFixed(0) : gamesBack.toFixed(1);
}

function formatDifferential(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

function LeaderTeamIdentity({
  teamId,
  teamNames,
  sourceTeamsById
}: {
  teamId: string;
  teamNames: Map<string, string>;
  sourceTeamsById: Map<string, SourceTeamCatalogEntry>;
}) {
  const team = sourceTeamsById.get(teamId);

  return (
    <TeamIdentityButton team={team} teamId={teamId} teamNames={teamNames} className="standings-team leader-team" />
  );
}

function SortableHeader<Key extends string>({
  label,
  sortKey,
  sort,
  defaultDirection,
  onSort,
  className
}: {
  label: string;
  sortKey: Key;
  sort: SortState<Key>;
  defaultDirection: SortDirection;
  onSort: (key: Key, defaultDirection: SortDirection) => void;
  className?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <th className={className} aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className={`sort-header ${active ? "active" : ""}`} onClick={() => onSort(sortKey, defaultDirection)}>
        <span>{label}</span>
        <span className="sort-indicator" aria-hidden="true">
          {active ? (sort.direction === "asc" ? "^" : "v") : ""}
        </span>
      </button>
    </th>
  );
}

function LeagueLeaders({
  league,
  teamNames,
  sourceTeamsById
}: {
  league: LeagueState;
  teamNames: Map<string, string>;
  sourceTeamsById: Map<string, SourceTeamCatalogEntry>;
}) {
  const [view, setView] = useState<StandingsView>("conference");
  const [leaderView, setLeaderView] = useState<LeaderTableView>("teams");
  const [teamSort, setTeamSort] = useState<SortState<TeamLeaderSortKey>>({ key: "PTS", direction: "desc" });
  const [playerSort, setPlayerSort] = useState<SortState<PlayerLeaderSortKey>>({ key: "PTS", direction: "desc" });
  const teamStats = useMemo(() => aggregateTeamStats(league), [league]);
  const playerStats = useMemo(() => aggregatePlayerStats(league), [league]);
  const teamRows = useMemo<TeamLeaderRow[]>(
    () => Object.entries(teamStats).map(([teamId, line]) => ({ teamId, line })),
    [teamStats]
  );
  const sortedTeamRows = useMemo(() => sortTeamLeaderRows(teamRows, teamSort, teamNames), [teamNames, teamRows, teamSort]);
  const sortedPlayerRows = useMemo(() => sortPlayerLeaderRows(playerStats, playerSort, teamNames), [playerSort, playerStats, teamNames]);
  const groups = useMemo(() => leagueLeaderGroups(view, sortedTeamRows, sortedPlayerRows, sourceTeamsById), [sortedPlayerRows, sourceTeamsById, sortedTeamRows, view]);
  const setTeamLeaderSort = (key: TeamLeaderSortKey, defaultDirection: SortDirection) => setTeamSort((current) => nextSortState(current, key, defaultDirection));
  const setPlayerLeaderSort = (key: PlayerLeaderSortKey, defaultDirection: SortDirection) => setPlayerSort((current) => nextSortState(current, key, defaultDirection));

  return (
    <>
      <article className="panel leaders-panel">
        <div className="panel-title">
          <div>
            <h3>League Leaders</h3>
            <p>Averages and totals are based on saved league box scores.</p>
          </div>
        </div>
        <div className="standings-toolbar">
          <div className="segmented">
            <span>View</span>
            <div className="segment-buttons">
              <button type="button" className={view === "conference" ? "active" : ""} onClick={() => setView("conference")}>
                Conference
              </button>
              <button type="button" className={view === "division" ? "active" : ""} onClick={() => setView("division")}>
                Division
              </button>
              <button type="button" className={view === "overall" ? "active" : ""} onClick={() => setView("overall")}>
                Overall
              </button>
            </div>
          </div>
          <div className="segmented">
            <span>Leaders</span>
            <div className="segment-buttons">
              <button type="button" className={leaderView === "teams" ? "active" : ""} onClick={() => setLeaderView("teams")}>
                Teams
              </button>
              <button type="button" className={leaderView === "players" ? "active" : ""} onClick={() => setLeaderView("players")}>
                Players
              </button>
            </div>
          </div>
        </div>
      </article>
      <div className={`leader-group-stack ${view}`}>
        {groups.map((group) => (
          <section className="panel leader-group" key={group.label}>
            <h4>
              {group.label}
              <span>
                {group.teamRows.length.toLocaleString()} teams · {group.playerRows.length.toLocaleString()} players
              </span>
            </h4>
            <div className="leader-table-block">
              <h5>{leaderView === "teams" ? "Team Leaders" : "Player Leaders"}</h5>
              <div className="table-wrap">
                {leaderView === "teams" ? (
                  <table className="leaders-table">
                  <thead>
                    <tr>
                      <th className="standings-rank">#</th>
                      <SortableHeader label="Team" sortKey="team" sort={teamSort} defaultDirection="asc" onSort={setTeamLeaderSort} />
                      <SortableHeader label="GP" sortKey="games" sort={teamSort} defaultDirection="desc" onSort={setTeamLeaderSort} className="numeric-cell" />
                      <SortableHeader label="PPG" sortKey="PTS" sort={teamSort} defaultDirection="desc" onSort={setTeamLeaderSort} className="numeric-cell" />
                      <SortableHeader label="RPG" sortKey="REB" sort={teamSort} defaultDirection="desc" onSort={setTeamLeaderSort} className="numeric-cell" />
                      <SortableHeader label="APG" sortKey="AST" sort={teamSort} defaultDirection="desc" onSort={setTeamLeaderSort} className="numeric-cell" />
                      <SortableHeader label="SPG" sortKey="STL" sort={teamSort} defaultDirection="desc" onSort={setTeamLeaderSort} className="numeric-cell" />
                      <SortableHeader label="BPG" sortKey="BLK" sort={teamSort} defaultDirection="desc" onSort={setTeamLeaderSort} className="numeric-cell" />
                    </tr>
                  </thead>
                  <tbody>
                    {group.teamRows.map(({ teamId, line }, index) => (
                      <tr key={teamId}>
                        <td className="standings-rank">{index + 1}</td>
                        <td className="leader-team-cell">
                          <LeaderTeamIdentity teamId={teamId} teamNames={teamNames} sourceTeamsById={sourceTeamsById} />
                        </td>
                        <td className="numeric-cell">{line.games}</td>
                        {leaderStatFields.map((field) => (
                          <td className="numeric-cell" key={field}>
                            {round((line[field] ?? 0) / Math.max(1, line.games))}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                ) : (
                  <table className="leaders-table player-leaders-table">
                  <thead>
                    <tr>
                      <th className="standings-rank">#</th>
                      <SortableHeader label="Player" sortKey="player" sort={playerSort} defaultDirection="asc" onSort={setPlayerLeaderSort} />
                      <SortableHeader label="Team" sortKey="team" sort={playerSort} defaultDirection="asc" onSort={setPlayerLeaderSort} />
                      <SortableHeader label="GP" sortKey="games" sort={playerSort} defaultDirection="desc" onSort={setPlayerLeaderSort} className="numeric-cell" />
                      <SortableHeader label="PTS" sortKey="PTS" sort={playerSort} defaultDirection="desc" onSort={setPlayerLeaderSort} className="numeric-cell" />
                      <SortableHeader label="REB" sortKey="REB" sort={playerSort} defaultDirection="desc" onSort={setPlayerLeaderSort} className="numeric-cell" />
                      <SortableHeader label="AST" sortKey="AST" sort={playerSort} defaultDirection="desc" onSort={setPlayerLeaderSort} className="numeric-cell" />
                      <SortableHeader label="STL" sortKey="STL" sort={playerSort} defaultDirection="desc" onSort={setPlayerLeaderSort} className="numeric-cell" />
                      <SortableHeader label="BLK" sortKey="BLK" sort={playerSort} defaultDirection="desc" onSort={setPlayerLeaderSort} className="numeric-cell" />
                    </tr>
                  </thead>
                  <tbody>
                    {group.playerRows.slice(0, 30).map((row, index) => (
                      <tr key={`${row.teamId}:${row.player}`}>
                        <td className="standings-rank">{index + 1}</td>
                        <td className="leader-player-cell">
                          <PlayerNameButton teamId={row.teamId} player={row.player} />
                        </td>
                        <td className="leader-team-cell">
                          <LeaderTeamIdentity teamId={row.teamId} teamNames={teamNames} sourceTeamsById={sourceTeamsById} />
                        </td>
                        <td className="numeric-cell">{row.games}</td>
                        {leaderStatFields.map((field) => (
                          <td className="numeric-cell" key={field}>
                            {round(row.perGame[field])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                )}
              </div>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

function MetricGrid({ metrics }: { metrics: Array<[string, React.ReactNode]> }) {
  return (
    <div className="metric-grid">
      {metrics.map(([label, value]) => (
        <div className="metric" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
