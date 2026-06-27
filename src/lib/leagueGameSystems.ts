import { aggregatePlayerStats, aggregateTeamStats, playoffSeriesState, standings } from "./league";
import type { DiceTeamCard, GameResult, LeagueGame, LeaguePlayoffSeries, LeagueState, SourceTeamCatalogEntry, StatLine, TeamGamePlanOptions } from "./types";
import type { LeagueGameScope } from "./league";

export type TeamNameLookup =
  | Map<string, string>
  | Record<string, string>
  | Array<Pick<SourceTeamCatalogEntry, "id" | "name" | "shortName" | "abbr">>
  | Array<Pick<DiceTeamCard, "id" | "name" | "shortName" | "abbr">>;

export type SignalTone = "positive" | "neutral" | "warning" | "negative";

export type TeamIdentityDimension = "pace" | "shotDiet" | "starReliance" | "glass" | "defense";

export interface TeamIdentityBadge {
  dimension: TeamIdentityDimension;
  label: string;
  value: string;
  detail: string;
  tone: SignalTone;
  score: number;
}

export interface TeamIdentityCard {
  teamId: string;
  teamName: string;
  sampleGames: number;
  badges: Record<TeamIdentityDimension, TeamIdentityBadge>;
  strengths: string[];
  concerns: string[];
  metrics: {
    pointsPerGame: number;
    pointsAllowedPerGame: number;
    paceProxy: number;
    threeAttemptRate: number;
    freeThrowRate: number;
    reboundMargin: number;
    turnoverRate: number;
    topScorerShare: number;
    topPlayerLoadShare: number;
  };
}

export interface TeamIdentityOptions {
  scope?: LeagueGameScope;
  teamNames?: TeamNameLookup;
}

export type RestPressureLevel = "unknown" | "rested" | "normal" | "tight" | "back-to-back" | "schedule-crunch";

export interface TeamRestPressure {
  teamId: string;
  gameId?: string;
  date?: string;
  previousGameId?: string;
  previousDate?: string;
  nextGameId?: string;
  nextDate?: string;
  daysSincePrevious?: number;
  restDays?: number;
  isBackToBack: boolean;
  gamesInFourDays: number;
  gamesInSevenDays: number;
  currentStretchLength: number;
  pressureScore: number;
  level: RestPressureLevel;
  label: string;
  detail: string;
  flags: string[];
}

export interface GameRestPressure {
  gameId: string;
  date?: string;
  away: TeamRestPressure;
  home: TeamRestPressure;
}

export interface PeriodSwingRow {
  periodIndex: number;
  periodLabel: string;
  awayScore: number;
  homeScore: number;
  awayCumulative: number;
  homeCumulative: number;
  periodMarginForAway: number;
  cumulativeMarginForAway: number;
  swingTeamId?: string;
  swingPoints: number;
  leadChange: boolean;
  winProbabilityAway: number;
  winProbabilityHome: number;
  narrative: string;
}

export interface GameTurningPoint {
  periodIndex?: number;
  periodLabel?: string;
  teamId?: string;
  title: string;
  detail: string;
  swingPoints: number;
  winProbabilityChange: number;
}

export interface GameMomentumReport {
  resultId: string;
  rows: PeriodSwingRow[];
  winnerTeamId?: string;
  finalMargin: number;
  finalWinProbability: number;
  leverageScore: number;
  leverageLabel: string;
  turningPoint: GameTurningPoint;
  maxLeadForAway: number;
  maxLeadForHome: number;
  leadChanges: number;
}

export interface MomentumOptions {
  teamNames?: TeamNameLookup;
}

export type CoachGradeLetter = "A+" | "A" | "A-" | "B+" | "B" | "B-" | "C+" | "C" | "C-" | "D+" | "D" | "F";

export interface CoachPlanFitInput {
  targetThreeAttemptRate?: number;
  targetFreeThrowRate?: number;
  maxTurnovers?: number;
  minReboundMargin?: number;
  targetPace?: number;
  targetAssists?: number;
  priorities?: Array<"tempo" | "threes" | "freeThrows" | "boards" | "ballSecurity">;
}

export interface CoachGradeFactor {
  key: "score" | "turnovers" | "rebounding" | "threes" | "freeThrows" | "planFit";
  label: string;
  score: number;
  maxScore: number;
  value: string;
  target?: string;
  detail: string;
  tone: SignalTone;
}

export interface TeamPostgameGrade {
  teamId: string;
  opponentTeamId: string;
  numericScore: number;
  letter: CoachGradeLetter;
  outcome: "win" | "loss" | "tie";
  summary: string;
  factors: CoachGradeFactor[];
}

export interface SeriesAdjustmentItem {
  id: string;
  priority: "high" | "medium" | "low";
  area: "tempo" | "shotProfile" | "ballSecurity" | "rebounding" | "defense" | "freeThrows" | "rotation" | "confidence";
  title: string;
  detail: string;
  metric?: string;
}

export interface SeriesAdjustmentTeamPlan {
  teamId: string;
  teamName: string;
  wins: number;
  losses: number;
  statusLabel: string;
  metrics: {
    pointsPerGame: number;
    pointsAllowedPerGame: number;
    reboundMargin: number;
    turnoverMargin: number;
    threeAttemptRate: number;
    opponentThreeAttemptRate: number;
    freeThrowRate: number;
    opponentFreeThrowRate: number;
    topPlayerLoadShare: number;
  };
  items: SeriesAdjustmentItem[];
}

export interface SeriesAdjustmentReport {
  seriesId: string;
  roundName: string;
  completedGames: number;
  leaderTeamId?: string;
  teams: [SeriesAdjustmentTeamPlan, SeriesAdjustmentTeamPlan];
}

export interface SeriesAdjustmentOptions {
  teamNames?: TeamNameLookup;
  maxItemsPerTeam?: number;
}

export type NewspaperSection = "front-page" | "standings" | "box-score" | "leaders" | "schedule" | "playoffs" | "awards";

export interface LeagueNewspaperItem {
  id: string;
  section: NewspaperSection;
  headline: string;
  detail: string;
  date?: string;
  teamIds: string[];
  gameId?: string;
  priority: number;
  tone: SignalTone;
}

export interface LeagueNewspaperOptions {
  teamNames?: TeamNameLookup;
  currentDate?: string;
  windowDays?: number;
  maxItems?: number;
}

export type AchievementTier = "bronze" | "silver" | "gold" | "platinum";

export interface LeagueAchievementProgress {
  current: number;
  target: number;
}

export interface LeagueAchievementRecord {
  id: string;
  code: string;
  title: string;
  detail: string;
  tier: AchievementTier;
  unlockedAt: string;
  teamId?: string;
  player?: string;
  gameId?: string;
  value?: number;
  progress?: LeagueAchievementProgress;
}

export interface LeagueAchievementOptions {
  teamNames?: TeamNameLookup;
  now?: string;
}

export interface LeagueChallenge {
  id: string;
  title: string;
  detail: string;
  teamIds: string[];
  gameId?: string;
  priority: "high" | "medium" | "low";
  category: "schedule" | "upset" | "rivalry" | "streak" | "playoffs" | "stat";
}

export interface LeagueChallengeOptions {
  teamNames?: TeamNameLookup;
  maxItems?: number;
}

export type ScenarioChallengeDifficulty = "starter" | "standard" | "hard" | "legend";
export type ScenarioObjectiveKind = "win" | "margin" | "team-stat" | "opponent-stat" | "streak" | "series" | "ranking";
export type ScenarioObjectiveComparator = "gte" | "lte" | "eq";

export interface ScenarioObjectiveScore {
  current: number;
  target: number;
  progress: number;
  points: number;
  maxPoints: number;
  completed: boolean;
}

export interface ScenarioObjective {
  id: string;
  kind: ScenarioObjectiveKind;
  label: string;
  detail: string;
  comparator: ScenarioObjectiveComparator;
  score: ScenarioObjectiveScore;
  teamId?: string;
  opponentTeamId?: string;
  gameId?: string;
  stat?: string;
}

export interface ScenarioEntryGame {
  gameId: string;
  date?: string;
  teamIds: [string, string];
  label: string;
  reason: string;
  priority: "primary" | "secondary" | "fallback";
}

export interface ScenarioChallengeCard {
  id: string;
  title: string;
  hook: string;
  detail: string;
  category: LeagueChallenge["category"] | "coach" | "scenario" | "world";
  difficulty: ScenarioChallengeDifficulty;
  tone: SignalTone;
  priority: "high" | "medium" | "low";
  teamIds: string[];
  seedChallengeId?: string;
  recommendedEntryGames: ScenarioEntryGame[];
  objectives: ScenarioObjective[];
  scoring: {
    points: number;
    maxPoints: number;
    progress: number;
    completionLabel: string;
  };
}

export interface ScenarioChallengeOptions extends LeagueChallengeOptions {
  maxEntryGames?: number;
  includeBaseChallenges?: boolean;
}

export type AdaptiveGamePlanReasonType = "recent-form" | "head-to-head" | "own-identity" | "opponent-identity" | "schedule";

export interface AdaptiveGamePlanReason {
  type: AdaptiveGamePlanReasonType;
  label: string;
  detail: string;
  effect: TeamGamePlanOptions;
  weight: number;
  tone: SignalTone;
}

export interface AdaptiveGamePlanSuggestion {
  teamId: string;
  teamName: string;
  opponentTeamId: string;
  opponentTeamName: string;
  suggestedPlan: TeamGamePlanOptions;
  confidence: number;
  summary: string;
  reasons: AdaptiveGamePlanReason[];
  metrics: {
    recentGames: number;
    recentWins: number;
    recentLosses: number;
    recentNetRating: number;
    headToHeadGames: number;
    headToHeadWins: number;
    headToHeadLosses: number;
    turnoverRate: number;
    reboundMargin: number;
    threeAttemptRate: number;
    freeThrowRate: number;
  };
}

export interface AdaptiveGamePlanReport {
  gameId?: string;
  date?: string;
  generatedFor: "game" | "league";
  teamIds: string[];
  suggestedPlans: Record<string, TeamGamePlanOptions>;
  suggestions: Record<string, AdaptiveGamePlanSuggestion>;
}

export interface AdaptiveGamePlanOptions {
  gameOrId?: LeagueGame | string;
  teamNames?: TeamNameLookup;
  recentGameLimit?: number;
}

export type CoachProgressionTraitCategory = "execution" | "tactics" | "resilience" | "postseason" | "identity";

export interface CoachProgressionBadge {
  id: string;
  label: string;
  category: CoachProgressionTraitCategory;
  tier: AchievementTier;
  tone: SignalTone;
  detail: string;
  progress: LeagueAchievementProgress;
  unlocked: boolean;
  evidence: string[];
}

export interface CoachProgressionOptions {
  teamNames?: TeamNameLookup;
  grades?: TeamPostgameGrade[];
  plansByGameId?: Record<string, Record<string, TeamGamePlanOptions>>;
  currentPlans?: Record<string, TeamGamePlanOptions>;
}

export interface CoachProgressionProfile {
  teamId: string;
  teamName: string;
  level: number;
  xp: number;
  gradeAverage: number;
  gradeTrend: number;
  summary: string;
  record: {
    wins: number;
    losses: number;
    ties: number;
    games: number;
    winPct: number;
  };
  postseason: {
    wins: number;
    losses: number;
    seriesWins: number;
    seriesLosses: number;
    highestRound: number;
    highestRoundName?: string;
    champion: boolean;
    activeSeriesId?: string;
  };
  planProfile: {
    dominantStyle: string;
    gamesTracked: number;
    averagePlan: TeamGamePlanOptions;
  };
  badges: CoachProgressionBadge[];
  unlockedBadges: CoachProgressionBadge[];
  lockedBadges: CoachProgressionBadge[];
}

export type PowerRankingTrend = "surging" | "rising" | "steady" | "sliding" | "reeling";
export type FanPressureLevel = "low" | "normal" | "elevated" | "hot-seat" | "crisis";
export type RivalryHeatLevel = "warm" | "heated" | "volatile" | "classic";
export type WorldMediaNarrativeType = "power-ranking" | "fan-pressure" | "rivalry" | "playoffs" | "form" | "weekly";

export interface LeaguePowerRankingRow {
  rank: number;
  teamId: string;
  teamName: string;
  rating: number;
  recordLabel: string;
  winPct: number;
  differentialPerGame: number;
  recentForm: string;
  trend: PowerRankingTrend;
  tags: string[];
}

export interface FanPressureItem {
  teamId: string;
  teamName: string;
  pressureScore: number;
  level: FanPressureLevel;
  headline: string;
  detail: string;
  drivers: string[];
  tone: SignalTone;
}

export interface RivalryHeatItem {
  pairKey: string;
  teamIds: [string, string];
  labels: [string, string];
  heatScore: number;
  level: RivalryHeatLevel;
  meetings: number;
  completedMeetings: number;
  nextGameId?: string;
  lastGameId?: string;
  detail: string;
  tone: SignalTone;
}

export interface WorldMediaNarrativeItem {
  id: string;
  type: WorldMediaNarrativeType;
  headline: string;
  detail: string;
  teamIds: string[];
  gameId?: string;
  priority: number;
  tone: SignalTone;
}

export interface LeagueWorldSimulationOptions extends LeagueNewspaperOptions {
  maxPowerRankings?: number;
  maxFanPressureItems?: number;
  maxRivalries?: number;
  maxNarratives?: number;
}

export interface LeagueWorldSimulationReport {
  generatedAt: string;
  powerRankings: LeaguePowerRankingRow[];
  fanPressure: FanPressureItem[];
  rivalryHeat: RivalryHeatItem[];
  narratives: WorldMediaNarrativeItem[];
  newspaper: LeagueNewspaperItem[];
}

export interface HeadToHeadTeamState {
  teamId: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
}

export interface RivalryMeetingSummary {
  gameId: string;
  date?: string;
  winnerTeamId?: string;
  awayTeamId: string;
  homeTeamId: string;
  awayScore: number;
  homeScore: number;
  margin: number;
}

export interface UpsetSignal {
  favoriteTeamId: string;
  underdogTeamId: string;
  basis: "playoff-seed" | "standings";
  favoriteRank: number;
  underdogRank: number;
  upsetWinnerTeamId?: string;
  label: string;
  detail: string;
}

export interface RivalrySignalReport {
  pairKey: string;
  teamIds: [string, string];
  gameId?: string;
  meetings: number;
  completedMeetings: number;
  headToHead: [HeadToHeadTeamState, HeadToHeadTeamState];
  lastMeeting?: RivalryMeetingSummary;
  rematchLabel: string;
  revengeTeamId?: string;
  seedUpset?: UpsetSignal;
  upsetOpportunity?: UpsetSignal;
  notes: string[];
}

export interface RivalrySignalOptions {
  teamNames?: TeamNameLookup;
}

export interface ShareableLeagueReportOptions {
  teamNames?: TeamNameLookup;
  title?: string;
  maxStandingsRows?: number;
  maxNewsItems?: number;
  includeStyles?: boolean;
}

interface TeamGameSplit {
  games: number;
  pointsFor: number;
  pointsAgainst: number;
  reboundsFor: number;
  reboundsAgainst: number;
  turnoversFor: number;
  turnoversAgainst: number;
  possessions: number;
  teamStats: StatLine;
  opponentStats: StatLine;
}

const emptySplit = (): TeamGameSplit => ({
  games: 0,
  pointsFor: 0,
  pointsAgainst: 0,
  reboundsFor: 0,
  reboundsAgainst: 0,
  turnoversFor: 0,
  turnoversAgainst: 0,
  possessions: 0,
  teamStats: {},
  opponentStats: {}
});

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundTo(value: number, digits = 1): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function pct(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(digits)}%`;
}

function signed(value: number, digits = 1): string {
  const rounded = roundTo(value, digits);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function stat(line: StatLine | undefined, field: string): number {
  if (!line) return 0;
  if (field === "REB") return Math.max(line.REB ?? 0, (line.OREB ?? 0) + (line.DREB ?? 0));
  return line[field] ?? 0;
}

function addStats(target: StatLine, line: StatLine | undefined): void {
  if (!line) return;
  for (const [field, value] of Object.entries(line)) {
    target[field] = (target[field] ?? 0) + value;
  }
  if (line.REB === undefined && (line.OREB !== undefined || line.DREB !== undefined)) {
    target.REB = Math.max(target.REB ?? 0, (target.OREB ?? 0) + (target.DREB ?? 0));
  }
}

function opponentTeamId(game: Pick<LeagueGame, "awayTeamId" | "homeTeamId">, teamId: string): string {
  return game.awayTeamId === teamId ? game.homeTeamId : game.awayTeamId;
}

function resultTeamScore(result: GameResult, teamId: string): number {
  if (teamId === result.awayTeamId) return result.awayScore;
  if (teamId === result.homeTeamId) return result.homeScore;
  return stat(result.teamStats[teamId], "PTS");
}

function resultOpponentId(result: GameResult, teamId: string): string {
  return teamId === result.awayTeamId ? result.homeTeamId : result.awayTeamId;
}

function resultOutcome(result: GameResult, teamId: string): "win" | "loss" | "tie" {
  if (result.winnerTeamId === "tie") return "tie";
  return result.winnerTeamId === teamId ? "win" : "loss";
}

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

function lookupTeamName(teamId: string, teamNames?: TeamNameLookup): string {
  if (!teamNames) return teamId;
  if (teamNames instanceof Map) return teamNames.get(teamId) ?? teamId;
  if (Array.isArray(teamNames)) {
    const found = teamNames.find((team) => team.id === teamId);
    return found?.shortName || found?.name || found?.abbr || teamId;
  }
  return teamNames[teamId] ?? teamId;
}

function teamPairKey(teamAId: string, teamBId: string): string {
  return [teamAId, teamBId].sort().join("|");
}

function compareGames(a: LeagueGame, b: LeagueGame): number {
  return (a.date ?? "").localeCompare(b.date ?? "") || (a.sequence ?? 0) - (b.sequence ?? 0) || a.id.localeCompare(b.id);
}

function parseIsoDate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function daysBetween(start: string | undefined, end: string | undefined): number | undefined {
  const startTime = parseIsoDate(start);
  const endTime = parseIsoDate(end);
  if (startTime === undefined || endTime === undefined) return undefined;
  return Math.round((endTime - startTime) / 86_400_000);
}

function dateWithinWindow(date: string | undefined, endDate: string | undefined, days: number): boolean {
  const diff = daysBetween(date, endDate);
  return diff !== undefined && diff >= 0 && diff < days;
}

function formatDate(value: string | undefined): string {
  return value || "No date";
}

function periodLabel(index: number, periodCount: number): string {
  if (index < 4) return `Q${index + 1}`;
  return periodCount === 5 ? "OT" : `OT${index - 3}`;
}

function logistic(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function winProbabilityAway(marginForAway: number, periodsRemaining: number): number {
  const uncertainty = 4 + periodsRemaining * 5.5;
  return clamp(logistic(marginForAway / uncertainty), 0.02, 0.98);
}

function letterGrade(score: number): CoachGradeLetter {
  if (score >= 97) return "A+";
  if (score >= 93) return "A";
  if (score >= 90) return "A-";
  if (score >= 87) return "B+";
  if (score >= 83) return "B";
  if (score >= 80) return "B-";
  if (score >= 77) return "C+";
  if (score >= 73) return "C";
  if (score >= 70) return "C-";
  if (score >= 67) return "D+";
  if (score >= 60) return "D";
  return "F";
}

function toneFromScore(score: number, maxScore: number): SignalTone {
  const share = maxScore > 0 ? score / maxScore : 0;
  if (share >= 0.78) return "positive";
  if (share >= 0.58) return "neutral";
  if (share >= 0.4) return "warning";
  return "negative";
}

function teamGameSplits(league: LeagueState, scope: LeagueGameScope = "regular"): Record<string, TeamGameSplit> {
  const splits: Record<string, TeamGameSplit> = Object.fromEntries(league.teamIds.map((teamId) => [teamId, emptySplit()]));

  for (const game of gamesForScope(league.games, scope)) {
    if (!game.result) continue;
    for (const teamId of [game.awayTeamId, game.homeTeamId]) {
      const opponentId = opponentTeamId(game, teamId);
      const split = splits[teamId] ?? emptySplit();
      const teamLine = game.result.teamStats[teamId] ?? {};
      const opponentLine = game.result.teamStats[opponentId] ?? {};
      const pointsFor = resultTeamScore(game.result, teamId);
      const pointsAgainst = resultTeamScore(game.result, opponentId);

      split.games += 1;
      split.pointsFor += pointsFor;
      split.pointsAgainst += pointsAgainst;
      split.reboundsFor += stat(teamLine, "REB");
      split.reboundsAgainst += stat(opponentLine, "REB");
      split.turnoversFor += stat(teamLine, "TOV");
      split.turnoversAgainst += stat(opponentLine, "TOV");
      split.possessions += game.result.possessionsEach || estimatedPossessions(teamLine);
      addStats(split.teamStats, teamLine);
      addStats(split.opponentStats, opponentLine);
      splits[teamId] = split;
    }
  }

  return splits;
}

function estimatedPossessions(line: StatLine | undefined): number {
  return stat(line, "FGA") + stat(line, "TOV") + stat(line, "FTA") * 0.44 - stat(line, "OREB");
}

function playerLoad(line: StatLine): number {
  return stat(line, "FGA") + stat(line, "FTA") * 0.44 + stat(line, "TOV");
}

function topPlayerLoadShareFromRows(rows: ReturnType<typeof aggregatePlayerStats>, teamId: string): number {
  const teamRows = rows.filter((row) => row.teamId === teamId && row.games > 0);
  const loads = teamRows.map((row) => playerLoad(row.totals));
  const totalLoad = loads.reduce((sum, value) => sum + value, 0);
  return totalLoad > 0 ? Math.max(...loads) / totalLoad : 0;
}

function topScorerShareFromRows(rows: ReturnType<typeof aggregatePlayerStats>, teamId: string): number {
  const teamRows = rows.filter((row) => row.teamId === teamId && row.games > 0);
  const points = teamRows.map((row) => stat(row.totals, "PTS"));
  const totalPoints = points.reduce((sum, value) => sum + value, 0);
  return totalPoints > 0 ? Math.max(...points) / totalPoints : 0;
}

function classifyPace(pace: number, leaguePace: number): TeamIdentityBadge {
  const diff = pace - leaguePace;
  const label = diff >= 4 ? "Track meet" : diff >= 1.5 ? "Fast" : diff <= -4 ? "Grind" : diff <= -1.5 ? "Deliberate" : "Balanced";
  return {
    dimension: "pace",
    label,
    value: `${roundTo(pace, 1)} poss/g`,
    detail: `${signed(diff, 1)} versus league game pace`,
    tone: diff >= 1.5 ? "positive" : diff <= -3 ? "warning" : "neutral",
    score: diff
  };
}

function classifyShotDiet(threeRate: number, freeThrowRate: number): TeamIdentityBadge {
  let label = "Balanced diet";
  if (threeRate >= 0.43) label = "Arc-heavy";
  else if (threeRate >= 0.36) label = "Modern spacing";
  else if (freeThrowRate >= 0.31) label = "Paint pressure";
  else if (threeRate <= 0.24) label = "Two-point leaning";

  return {
    dimension: "shotDiet",
    label,
    value: `${pct(threeRate)} 3PA/FGA`,
    detail: `${pct(freeThrowRate)} FTA/FGA free throw pressure`,
    tone: threeRate >= 0.36 || freeThrowRate >= 0.31 ? "positive" : threeRate <= 0.2 ? "warning" : "neutral",
    score: threeRate + freeThrowRate * 0.5
  };
}

function classifyStarReliance(loadShare: number, scorerShare: number): TeamIdentityBadge {
  const reliance = Math.max(loadShare, scorerShare);
  const label = reliance >= 0.36 ? "Star-driven" : reliance >= 0.29 ? "Primary option" : reliance <= 0.21 ? "Committee" : "Shared creation";
  return {
    dimension: "starReliance",
    label,
    value: `${pct(reliance)} top share`,
    detail: `${pct(loadShare)} shot load, ${pct(scorerShare)} scoring`,
    tone: reliance >= 0.38 ? "warning" : reliance <= 0.24 ? "positive" : "neutral",
    score: reliance
  };
}

function classifyGlass(reboundMargin: number): TeamIdentityBadge {
  const label = reboundMargin >= 5 ? "Glass bully" : reboundMargin >= 2 ? "Plus glass" : reboundMargin <= -5 ? "Leaks boards" : reboundMargin <= -2 ? "Minus glass" : "Even glass";
  return {
    dimension: "glass",
    label,
    value: `${signed(reboundMargin, 1)} reb/g`,
    detail: "Rebound margin from saved games",
    tone: reboundMargin >= 2 ? "positive" : reboundMargin <= -2 ? "warning" : "neutral",
    score: reboundMargin
  };
}

function classifyDefense(pointsAllowed: number, leagueAllowed: number, turnoverMargin: number): TeamIdentityBadge {
  const diff = pointsAllowed - leagueAllowed;
  const label = diff <= -8 ? "Clamp defense" : diff <= -3 ? "Stingy" : diff >= 8 ? "Needs stops" : diff >= 3 ? "Soft spots" : "Middle pack";
  return {
    dimension: "defense",
    label,
    value: `${roundTo(pointsAllowed, 1)} opp ppg`,
    detail: `${signed(-diff, 1)} scoring prevention, ${signed(turnoverMargin, 1)} TOV margin`,
    tone: diff <= -3 ? "positive" : diff >= 3 ? "warning" : "neutral",
    score: -diff + turnoverMargin * 0.8
  };
}

function needsGamesBadge(dimension: TeamIdentityDimension, label: string): TeamIdentityBadge {
  return {
    dimension,
    label,
    value: "Needs games",
    detail: "Save or simulate a result to unlock this read.",
    tone: "neutral",
    score: 0
  };
}

function pendingIdentityBadges(): Record<TeamIdentityDimension, TeamIdentityBadge> {
  return {
    pace: needsGamesBadge("pace", "Pace read"),
    shotDiet: needsGamesBadge("shotDiet", "Shot diet"),
    starReliance: needsGamesBadge("starReliance", "Usage read"),
    glass: needsGamesBadge("glass", "Glass read"),
    defense: needsGamesBadge("defense", "Defense read")
  };
}

function identityStrengths(card: TeamIdentityCard): string[] {
  return Object.values(card.badges)
    .filter((badge) => badge.tone === "positive")
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((badge) => `${badge.label}: ${badge.detail}`);
}

function identityConcerns(card: TeamIdentityCard): string[] {
  return Object.values(card.badges)
    .filter((badge) => badge.tone === "warning" || badge.tone === "negative")
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((badge) => `${badge.label}: ${badge.detail}`);
}

export function buildTeamIdentityCard(league: LeagueState, teamId: string, options: TeamIdentityOptions = {}): TeamIdentityCard {
  const scope = options.scope ?? "regular";
  const splits = teamGameSplits(league, scope);
  const split = splits[teamId] ?? emptySplit();
  const allSplits = Object.values(splits).filter((row) => row.games > 0);
  const playerRows = aggregatePlayerStats(league, scope);
  const leagueGames = allSplits.reduce((sum, row) => sum + row.games, 0);
  const leaguePace = leagueGames ? allSplits.reduce((sum, row) => sum + row.possessions, 0) / leagueGames : 0;
  const leagueAllowed = leagueGames ? allSplits.reduce((sum, row) => sum + row.pointsAgainst, 0) / leagueGames : 0;
  if (split.games === 0) {
    return {
      teamId,
      teamName: lookupTeamName(teamId, options.teamNames),
      sampleGames: 0,
      badges: pendingIdentityBadges(),
      strengths: [],
      concerns: [],
      metrics: {
        pointsPerGame: 0,
        pointsAllowedPerGame: 0,
        paceProxy: 0,
        threeAttemptRate: 0,
        freeThrowRate: 0,
        reboundMargin: 0,
        turnoverRate: 0,
        topScorerShare: 0,
        topPlayerLoadShare: 0
      }
    };
  }
  const games = Math.max(1, split.games);
  const paceProxy = split.games ? split.possessions / split.games : 0;
  const pointsPerGame = split.pointsFor / games;
  const pointsAllowedPerGame = split.pointsAgainst / games;
  const reboundMargin = (split.reboundsFor - split.reboundsAgainst) / games;
  const turnoverMargin = (split.turnoversAgainst - split.turnoversFor) / games;
  const turnoverRate = rate(stat(split.teamStats, "TOV"), stat(split.teamStats, "FGA") + stat(split.teamStats, "FTA") * 0.44 + stat(split.teamStats, "TOV"));
  const threeAttemptRate = rate(stat(split.teamStats, "3PA"), stat(split.teamStats, "FGA"));
  const freeThrowRate = rate(stat(split.teamStats, "FTA"), stat(split.teamStats, "FGA"));
  const topPlayerLoadShare = topPlayerLoadShareFromRows(playerRows, teamId);
  const topScorerShare = topScorerShareFromRows(playerRows, teamId);
  const badges = {
    pace: classifyPace(paceProxy, leaguePace),
    shotDiet: classifyShotDiet(threeAttemptRate, freeThrowRate),
    starReliance: classifyStarReliance(topPlayerLoadShare, topScorerShare),
    glass: classifyGlass(reboundMargin),
    defense: classifyDefense(pointsAllowedPerGame, leagueAllowed, turnoverMargin)
  } satisfies Record<TeamIdentityDimension, TeamIdentityBadge>;

  const card: TeamIdentityCard = {
    teamId,
    teamName: lookupTeamName(teamId, options.teamNames),
    sampleGames: split.games,
    badges,
    strengths: [],
    concerns: [],
    metrics: {
      pointsPerGame: roundTo(pointsPerGame, 1),
      pointsAllowedPerGame: roundTo(pointsAllowedPerGame, 1),
      paceProxy: roundTo(paceProxy, 1),
      threeAttemptRate: roundTo(threeAttemptRate, 3),
      freeThrowRate: roundTo(freeThrowRate, 3),
      reboundMargin: roundTo(reboundMargin, 1),
      turnoverRate: roundTo(turnoverRate, 3),
      topScorerShare: roundTo(topScorerShare, 3),
      topPlayerLoadShare: roundTo(topPlayerLoadShare, 3)
    }
  };

  return {
    ...card,
    strengths: identityStrengths(card),
    concerns: identityConcerns(card)
  };
}

export function buildLeagueTeamIdentityCards(league: LeagueState, options: TeamIdentityOptions = {}): TeamIdentityCard[] {
  return league.teamIds.map((teamId) => buildTeamIdentityCard(league, teamId, options));
}

function resolveLeagueGame(league: LeagueState, gameOrId?: LeagueGame | string, teamId?: string): LeagueGame | undefined {
  if (typeof gameOrId === "string") return league.games.find((game) => game.id === gameOrId);
  if (gameOrId) return gameOrId;
  const games = teamId ? league.games.filter((game) => game.awayTeamId === teamId || game.homeTeamId === teamId) : league.games;
  const currentDate = league.currentDate;
  return games
    .slice()
    .sort(compareGames)
    .find((game) => game.status === "unplayed" && (!currentDate || !game.date || game.date >= currentDate));
}

function teamScheduleGames(league: LeagueState, teamId: string): LeagueGame[] {
  return league.games.filter((game) => game.awayTeamId === teamId || game.homeTeamId === teamId).sort(compareGames);
}

export function deriveTeamRestPressure(league: LeagueState, teamId: string, gameOrId?: LeagueGame | string): TeamRestPressure {
  const game = resolveLeagueGame(league, gameOrId, teamId);
  if (!game) {
    return {
      teamId,
      isBackToBack: false,
      gamesInFourDays: 0,
      gamesInSevenDays: 0,
      currentStretchLength: 0,
      pressureScore: 0,
      level: "unknown",
      label: "No scheduled game",
      detail: "No matching game was found for this team.",
      flags: []
    };
  }

  const datedGames = teamScheduleGames(league, teamId).filter((row) => row.date);
  if (!game.date) {
    return {
      teamId,
      gameId: game.id,
      isBackToBack: false,
      gamesInFourDays: 0,
      gamesInSevenDays: 0,
      currentStretchLength: 0,
      pressureScore: 0,
      level: "unknown",
      label: "Date needed",
      detail: "Rest pressure needs scheduled dates.",
      flags: ["missing-date"]
    };
  }

  const previous = datedGames.filter((row) => row.id !== game.id && (row.date ?? "") < game.date!).at(-1);
  const next = datedGames.find((row) => row.id !== game.id && (row.date ?? "") > game.date!);
  const daysSincePrevious = daysBetween(previous?.date, game.date);
  const restDays = daysSincePrevious === undefined ? undefined : Math.max(0, daysSincePrevious - 1);
  const gamesInFourDays = datedGames.filter((row) => row.date && row.date <= game.date! && dateWithinWindow(row.date, game.date, 4)).length;
  const gamesInSevenDays = datedGames.filter((row) => row.date && row.date <= game.date! && dateWithinWindow(row.date, game.date, 7)).length;
  let currentStretchLength = 1;
  let cursor = previous;
  let cursorDate = game.date;
  while (cursor?.date) {
    const diff = daysBetween(cursor.date, cursorDate);
    if (diff === undefined || diff > 2) break;
    currentStretchLength += 1;
    cursorDate = cursor.date;
    cursor = datedGames.filter((row) => row.id !== cursor?.id && (row.date ?? "") < cursorDate).at(-1);
  }

  const isBackToBack = daysSincePrevious === 1;
  const flags: string[] = [];
  if (isBackToBack) flags.push("back-to-back");
  if (gamesInFourDays >= 3) flags.push("three-in-four");
  if (gamesInSevenDays >= 5) flags.push("five-in-seven");
  if (restDays !== undefined && restDays >= 3) flags.push("extended-rest");
  if (currentStretchLength >= 4) flags.push("long-stretch");

  const pressureScore =
    (isBackToBack ? 4 : 0) +
    (gamesInFourDays >= 3 ? 3 : gamesInFourDays === 2 ? 1 : 0) +
    (gamesInSevenDays >= 5 ? 3 : gamesInSevenDays === 4 ? 2 : 0) +
    (currentStretchLength >= 4 ? 2 : 0) -
    (restDays !== undefined && restDays >= 3 ? 2 : 0);
  const level: RestPressureLevel =
    pressureScore >= 7 ? "schedule-crunch" : isBackToBack ? "back-to-back" : pressureScore >= 3 ? "tight" : pressureScore <= -1 ? "rested" : "normal";
  const label =
    level === "schedule-crunch"
      ? "Schedule crunch"
      : level === "back-to-back"
        ? "Back-to-back"
        : level === "tight"
          ? "Tight rest"
          : level === "rested"
            ? "Rest advantage"
            : "Normal rest";
  const restDetail = restDays === undefined ? "No prior dated game" : `${restDays} rest day${restDays === 1 ? "" : "s"}`;

  return {
    teamId,
    gameId: game.id,
    date: game.date,
    previousGameId: previous?.id,
    previousDate: previous?.date,
    nextGameId: next?.id,
    nextDate: next?.date,
    daysSincePrevious,
    restDays,
    isBackToBack,
    gamesInFourDays,
    gamesInSevenDays,
    currentStretchLength,
    pressureScore,
    level,
    label,
    detail: `${restDetail}; ${gamesInFourDays} in 4 days, ${gamesInSevenDays} in 7 days.`,
    flags
  };
}

export function deriveGameRestPressure(league: LeagueState, gameOrId: LeagueGame | string): GameRestPressure {
  const game = resolveLeagueGame(league, gameOrId);
  if (!game) {
    throw new Error("Game not found.");
  }
  return {
    gameId: game.id,
    date: game.date,
    away: deriveTeamRestPressure(league, game.awayTeamId, game),
    home: deriveTeamRestPressure(league, game.homeTeamId, game)
  };
}

export function analyzeGameMomentum(result: GameResult, options: MomentumOptions = {}): GameMomentumReport {
  let awayCumulative = 0;
  let homeCumulative = 0;
  let previousMargin = 0;
  let previousAwayProbability = 0.5;
  let leadChanges = 0;
  let maxLeadForAway = 0;
  let maxLeadForHome = 0;

  const rows: PeriodSwingRow[] = result.quarters.map((period, index) => {
    awayCumulative += period.away;
    homeCumulative += period.home;
    const periodMarginForAway = period.away - period.home;
    const cumulativeMarginForAway = awayCumulative - homeCumulative;
    const periodsRemaining = Math.max(0, result.quarters.length - index - 1);
    const probabilityAway =
      periodsRemaining === 0
        ? result.winnerTeamId === "tie"
          ? 0.5
          : result.winnerTeamId === result.awayTeamId
            ? 0.99
            : 0.01
        : winProbabilityAway(cumulativeMarginForAway, periodsRemaining);
    const leadChange = previousMargin !== 0 && cumulativeMarginForAway !== 0 && Math.sign(previousMargin) !== Math.sign(cumulativeMarginForAway);
    if (leadChange) leadChanges += 1;
    maxLeadForAway = Math.max(maxLeadForAway, cumulativeMarginForAway);
    maxLeadForHome = Math.max(maxLeadForHome, -cumulativeMarginForAway);

    const swingTeamId = periodMarginForAway === 0 ? undefined : periodMarginForAway > 0 ? result.awayTeamId : result.homeTeamId;
    const row: PeriodSwingRow = {
      periodIndex: index,
      periodLabel: periodLabel(index, result.quarters.length),
      awayScore: period.away,
      homeScore: period.home,
      awayCumulative,
      homeCumulative,
      periodMarginForAway,
      cumulativeMarginForAway,
      swingTeamId,
      swingPoints: Math.abs(periodMarginForAway),
      leadChange,
      winProbabilityAway: roundTo(probabilityAway, 3),
      winProbabilityHome: roundTo(1 - probabilityAway, 3),
      narrative: swingTeamId
        ? `${lookupTeamName(swingTeamId, options.teamNames)} won the period by ${Math.abs(periodMarginForAway)}.`
        : "The period played even."
    };

    previousMargin = cumulativeMarginForAway;
    previousAwayProbability = probabilityAway;
    return row;
  });

  const turningPointRow = rows
    .map((row, index) => {
      const beforeProbability = index === 0 ? 0.5 : rows[index - 1].winProbabilityAway;
      return {
        row,
        probabilityChange: Math.abs(row.winProbabilityAway - beforeProbability)
      };
    })
    .sort((a, b) => b.probabilityChange - a.probabilityChange || b.row.swingPoints - a.row.swingPoints)[0];

  const winnerTeamId = result.winnerTeamId === "tie" ? undefined : result.winnerTeamId;
  const finalMargin = Math.abs(result.awayScore - result.homeScore);
  const closeness = clamp(1 - finalMargin / 25, 0, 1);
  const leverageScore = roundTo(clamp(closeness * 65 + leadChanges * 10 + (result.quarters.length > 4 ? 12 : 0), 0, 100), 0);
  const leverageLabel = leverageScore >= 80 ? "High leverage" : leverageScore >= 55 ? "Swing game" : leverageScore >= 30 ? "Controlled finish" : "Low drama";
  const finalAwayProbability = rows.at(-1)?.winProbabilityAway ?? previousAwayProbability;
  const finalWinProbability = winnerTeamId === result.homeTeamId ? 1 - finalAwayProbability : winnerTeamId === result.awayTeamId ? finalAwayProbability : 0.5;

  return {
    resultId: result.id,
    rows,
    winnerTeamId,
    finalMargin,
    finalWinProbability: roundTo(finalWinProbability, 3),
    leverageScore,
    leverageLabel,
    turningPoint: turningPointRow
      ? {
          periodIndex: turningPointRow.row.periodIndex,
          periodLabel: turningPointRow.row.periodLabel,
          teamId: turningPointRow.row.swingTeamId,
          title: `${turningPointRow.row.periodLabel} swing`,
          detail: turningPointRow.row.narrative,
          swingPoints: turningPointRow.row.swingPoints,
          winProbabilityChange: roundTo(turningPointRow.probabilityChange, 3)
        }
      : {
          title: "No period data",
          detail: "Manual result has no period scoring to analyze.",
          swingPoints: 0,
          winProbabilityChange: 0
        },
    maxLeadForAway,
    maxLeadForHome,
    leadChanges
  };
}

function gradeFactor(args: Omit<CoachGradeFactor, "score" | "tone"> & { rawScore: number }): CoachGradeFactor {
  const score = roundTo(clamp(args.rawScore, 0, args.maxScore), 1);
  return {
    key: args.key,
    label: args.label,
    score,
    maxScore: args.maxScore,
    value: args.value,
    target: args.target,
    detail: args.detail,
    tone: toneFromScore(score, args.maxScore)
  };
}

function planFitScore(result: GameResult, teamId: string, teamLine: StatLine, opponentLine: StatLine, plan?: CoachPlanFitInput): CoachGradeFactor {
  if (!plan) {
    return gradeFactor({
      key: "planFit",
      label: "Plan fit",
      maxScore: 12,
      rawScore: 9,
      value: "No plan",
      detail: "No explicit plan inputs were provided."
    });
  }

  const checks: number[] = [];
  const details: string[] = [];
  if (plan.targetThreeAttemptRate !== undefined) {
    const actual = rate(stat(teamLine, "3PA"), stat(teamLine, "FGA"));
    checks.push(1 - Math.min(1, Math.abs(actual - plan.targetThreeAttemptRate) / 0.16));
    details.push(`3PA rate ${pct(actual)} vs ${pct(plan.targetThreeAttemptRate)}`);
  }
  if (plan.targetFreeThrowRate !== undefined) {
    const actual = rate(stat(teamLine, "FTA"), stat(teamLine, "FGA"));
    checks.push(1 - Math.min(1, Math.abs(actual - plan.targetFreeThrowRate) / 0.18));
    details.push(`FTA rate ${pct(actual)} vs ${pct(plan.targetFreeThrowRate)}`);
  }
  if (plan.maxTurnovers !== undefined) {
    const turnovers = stat(teamLine, "TOV");
    checks.push(turnovers <= plan.maxTurnovers ? 1 : Math.max(0, 1 - (turnovers - plan.maxTurnovers) / 10));
    details.push(`${turnovers} TOV vs max ${plan.maxTurnovers}`);
  }
  if (plan.minReboundMargin !== undefined) {
    const margin = stat(teamLine, "REB") - stat(opponentLine, "REB");
    checks.push(margin >= plan.minReboundMargin ? 1 : Math.max(0, 1 - (plan.minReboundMargin - margin) / 10));
    details.push(`${signed(margin, 0)} rebound margin vs ${signed(plan.minReboundMargin, 0)}`);
  }
  if (plan.targetPace !== undefined) {
    const actual = result.possessionsEach || estimatedPossessions(teamLine);
    checks.push(1 - Math.min(1, Math.abs(actual - plan.targetPace) / 12));
    details.push(`${roundTo(actual, 1)} pace vs ${roundTo(plan.targetPace, 1)}`);
  }
  if (plan.targetAssists !== undefined) {
    const assists = stat(teamLine, "AST");
    checks.push(assists >= plan.targetAssists ? 1 : Math.max(0, 1 - (plan.targetAssists - assists) / 10));
    details.push(`${assists} AST vs ${plan.targetAssists}`);
  }

  if (!checks.length) {
    return gradeFactor({
      key: "planFit",
      label: "Plan fit",
      maxScore: 12,
      rawScore: 9,
      value: "Plan noted",
      detail: "Plan priorities were supplied without numeric targets."
    });
  }

  const fit = checks.reduce((sum, value) => sum + value, 0) / checks.length;
  return gradeFactor({
    key: "planFit",
    label: "Plan fit",
    maxScore: 12,
    rawScore: fit * 12,
    value: pct(fit, 0),
    detail: `${teamId}: ${details.slice(0, 2).join("; ")}`
  });
}

export function gradeTeamPostgame(result: GameResult, teamId: string, plan?: CoachPlanFitInput): TeamPostgameGrade {
  const opponentId = resultOpponentId(result, teamId);
  const teamLine = result.teamStats[teamId] ?? {};
  const opponentLine = result.teamStats[opponentId] ?? {};
  const margin = resultTeamScore(result, teamId) - resultTeamScore(result, opponentId);
  const outcome = resultOutcome(result, teamId);
  const turnovers = stat(teamLine, "TOV");
  const opponentTurnovers = stat(opponentLine, "TOV");
  const reboundMargin = stat(teamLine, "REB") - stat(opponentLine, "REB");
  const threeRate = rate(stat(teamLine, "3PA"), stat(teamLine, "FGA"));
  const threePct = rate(stat(teamLine, "3PM"), stat(teamLine, "3PA"));
  const opponentThreePct = rate(stat(opponentLine, "3PM"), stat(opponentLine, "3PA"));
  const freeThrowRate = rate(stat(teamLine, "FTA"), stat(teamLine, "FGA"));
  const freeThrowMakes = stat(teamLine, "FTM");
  const opponentFreeThrowMakes = stat(opponentLine, "FTM");

  const factors: CoachGradeFactor[] = [
    gradeFactor({
      key: "score",
      label: "Scoreboard",
      maxScore: 28,
      rawScore: outcome === "win" ? 20 + clamp(margin, 0, 20) * 0.4 : outcome === "tie" ? 16 : 12 + clamp(margin, -30, 0) * 0.25,
      value: signed(margin, 0),
      detail: outcome === "win" ? "Won the result." : outcome === "tie" ? "Finished level." : "Lost the result."
    }),
    gradeFactor({
      key: "turnovers",
      label: "Ball security",
      maxScore: 15,
      rawScore: 9 + (opponentTurnovers - turnovers) * 1.1 + (plan?.maxTurnovers !== undefined && turnovers <= plan.maxTurnovers ? 1.5 : 0),
      value: `${turnovers} TOV`,
      target: plan?.maxTurnovers === undefined ? undefined : `Max ${plan.maxTurnovers}`,
      detail: `${signed(opponentTurnovers - turnovers, 0)} turnover margin`
    }),
    gradeFactor({
      key: "rebounding",
      label: "Glass",
      maxScore: 15,
      rawScore: 8 + reboundMargin * 0.8,
      value: signed(reboundMargin, 0),
      target: plan?.minReboundMargin === undefined ? undefined : signed(plan.minReboundMargin, 0),
      detail: "Total rebound margin"
    }),
    gradeFactor({
      key: "threes",
      label: "Three-point plan",
      maxScore: 15,
      rawScore: 6 + (threePct - opponentThreePct) * 20 + threeRate * 8,
      value: `${stat(teamLine, "3PM")}-${stat(teamLine, "3PA")}`,
      target: plan?.targetThreeAttemptRate === undefined ? undefined : pct(plan.targetThreeAttemptRate),
      detail: `${pct(threeRate)} attempt rate, ${pct(threePct)} accuracy`
    }),
    gradeFactor({
      key: "freeThrows",
      label: "Free throws",
      maxScore: 15,
      rawScore: 7 + (freeThrowMakes - opponentFreeThrowMakes) * 0.7 + freeThrowRate * 8,
      value: `${stat(teamLine, "FTM")}-${stat(teamLine, "FTA")}`,
      target: plan?.targetFreeThrowRate === undefined ? undefined : pct(plan.targetFreeThrowRate),
      detail: `${pct(freeThrowRate)} FTA/FGA, ${signed(freeThrowMakes - opponentFreeThrowMakes, 0)} makes`
    }),
    planFitScore(result, teamId, teamLine, opponentLine, plan)
  ];

  const score = roundTo((factors.reduce((sum, factor) => sum + factor.score, 0) / factors.reduce((sum, factor) => sum + factor.maxScore, 0)) * 100, 0);
  const best = factors.slice().sort((a, b) => b.score / b.maxScore - a.score / a.maxScore)[0];
  const worst = factors.slice().sort((a, b) => a.score / a.maxScore - b.score / b.maxScore)[0];

  return {
    teamId,
    opponentTeamId: opponentId,
    numericScore: score,
    letter: letterGrade(score),
    outcome,
    summary: `${best?.label ?? "Execution"} carried the grade; ${worst?.label ?? "one area"} needs the next adjustment.`,
    factors
  };
}

function aggregateResultsForTeam(games: LeagueGame[], teamId: string): TeamGameSplit {
  const split = emptySplit();
  for (const game of games) {
    if (!game.result) continue;
    const opponentId = opponentTeamId(game, teamId);
    const teamLine = game.result.teamStats[teamId] ?? {};
    const opponentLine = game.result.teamStats[opponentId] ?? {};
    split.games += 1;
    split.pointsFor += resultTeamScore(game.result, teamId);
    split.pointsAgainst += resultTeamScore(game.result, opponentId);
    split.reboundsFor += stat(teamLine, "REB");
    split.reboundsAgainst += stat(opponentLine, "REB");
    split.turnoversFor += stat(teamLine, "TOV");
    split.turnoversAgainst += stat(opponentLine, "TOV");
    split.possessions += game.result.possessionsEach || estimatedPossessions(teamLine);
    addStats(split.teamStats, teamLine);
    addStats(split.opponentStats, opponentLine);
  }
  return split;
}

function topPlayerLoadShareFromGames(games: LeagueGame[], teamId: string): number {
  const loads = new Map<string, number>();
  for (const game of games) {
    if (!game.result) continue;
    for (const [player, line] of Object.entries(game.result.playerStats[teamId] ?? {})) {
      loads.set(player, (loads.get(player) ?? 0) + playerLoad(line));
    }
  }
  const values = Array.from(loads.values());
  const total = values.reduce((sum, value) => sum + value, 0);
  return total > 0 ? Math.max(...values) / total : 0;
}

function seriesRecordLabel(wins: number, losses: number): string {
  if (wins === losses) return `${wins}-${losses}, even`;
  return wins > losses ? `up ${wins}-${losses}` : `down ${losses}-${wins}`;
}

function seriesItems(teamName: string, metrics: SeriesAdjustmentTeamPlan["metrics"], wins: number, losses: number): SeriesAdjustmentItem[] {
  const items: SeriesAdjustmentItem[] = [];
  if (losses > wins) {
    items.push({
      id: "urgency",
      priority: "high",
      area: "rotation",
      title: "Shorten the first-half experiment window",
      detail: `${teamName} is ${seriesRecordLabel(wins, losses)} and needs the best groups earlier.`,
      metric: `${wins}-${losses}`
    });
  }
  if (metrics.turnoverMargin < -2) {
    items.push({
      id: "turnovers",
      priority: "high",
      area: "ballSecurity",
      title: "Simplify initiation",
      detail: "Use safer entries and fewer low-clock bailout actions until the turnover margin stabilizes.",
      metric: `${signed(metrics.turnoverMargin)} TOV margin/g`
    });
  }
  if (metrics.reboundMargin < -3) {
    items.push({
      id: "rebounding",
      priority: "high",
      area: "rebounding",
      title: "Send a second body to the glass",
      detail: "The series is tilting on extra possessions; trade some leak-outs for blockouts.",
      metric: `${signed(metrics.reboundMargin)} REB/g`
    });
  }
  if (metrics.opponentThreeAttemptRate >= 0.39) {
    items.push({
      id: "opponent-threes",
      priority: "medium",
      area: "defense",
      title: "Run shooters off the line",
      detail: "The opponent is getting a high-volume three-point diet.",
      metric: `${pct(metrics.opponentThreeAttemptRate)} opp 3PA/FGA`
    });
  }
  if (metrics.threeAttemptRate < 0.28) {
    items.push({
      id: "own-threes",
      priority: "medium",
      area: "shotProfile",
      title: "Add early-clock spacing possessions",
      detail: "The shot chart needs more threes before the defense is fully loaded.",
      metric: `${pct(metrics.threeAttemptRate)} 3PA/FGA`
    });
  }
  if (metrics.freeThrowRate + 0.08 < metrics.opponentFreeThrowRate) {
    items.push({
      id: "free-throws",
      priority: "medium",
      area: "freeThrows",
      title: "Pressure the rim before hunting jumpers",
      detail: "The free throw gap suggests the opponent is dictating physicality.",
      metric: `${pct(metrics.freeThrowRate)} vs ${pct(metrics.opponentFreeThrowRate)} FTA/FGA`
    });
  }
  if (metrics.topPlayerLoadShare >= 0.38) {
    items.push({
      id: "load-balance",
      priority: "low",
      area: "rotation",
      title: "Build a second-side release valve",
      detail: "The top option is carrying a heavy load; prepare counters before traps arrive.",
      metric: `${pct(metrics.topPlayerLoadShare)} top load`
    });
  }
  if (!items.length) {
    items.push({
      id: "stay-ready",
      priority: wins >= losses ? "low" : "medium",
      area: "confidence",
      title: wins >= losses ? "Keep the base plan, prepare counters" : "Find one controllable edge",
      detail: wins >= losses ? "The profile is stable enough to force the opponent to adjust first." : "No single stat is breaking the series, so prioritize execution and matchup clarity."
    });
  }
  return items;
}

export function recommendSeriesAdjustments(league: LeagueState, series: LeaguePlayoffSeries, options: SeriesAdjustmentOptions = {}): SeriesAdjustmentReport {
  const state = playoffSeriesState(league, series);
  const games = state.completedGames;
  const teamIds: [string, string] = [series.teamAId, series.teamBId];
  const maxItems = options.maxItemsPerTeam ?? 4;

  const plans = teamIds.map((teamId) => {
    const opponentId = teamId === series.teamAId ? series.teamBId : series.teamAId;
    const split = aggregateResultsForTeam(games, teamId);
    const gamesCount = Math.max(1, split.games);
    const wins = teamId === series.teamAId ? state.winsA : state.winsB;
    const losses = teamId === series.teamAId ? state.winsB : state.winsA;
    const metrics = {
      pointsPerGame: roundTo(split.pointsFor / gamesCount, 1),
      pointsAllowedPerGame: roundTo(split.pointsAgainst / gamesCount, 1),
      reboundMargin: roundTo((split.reboundsFor - split.reboundsAgainst) / gamesCount, 1),
      turnoverMargin: roundTo((split.turnoversAgainst - split.turnoversFor) / gamesCount, 1),
      threeAttemptRate: roundTo(rate(stat(split.teamStats, "3PA"), stat(split.teamStats, "FGA")), 3),
      opponentThreeAttemptRate: roundTo(rate(stat(split.opponentStats, "3PA"), stat(split.opponentStats, "FGA")), 3),
      freeThrowRate: roundTo(rate(stat(split.teamStats, "FTA"), stat(split.teamStats, "FGA")), 3),
      opponentFreeThrowRate: roundTo(rate(stat(split.opponentStats, "FTA"), stat(split.opponentStats, "FGA")), 3),
      topPlayerLoadShare: roundTo(topPlayerLoadShareFromGames(games, teamId), 3)
    };
    const teamName = lookupTeamName(teamId, options.teamNames);
    return {
      teamId,
      teamName,
      wins,
      losses,
      statusLabel: seriesRecordLabel(wins, losses),
      metrics,
      items: seriesItems(teamName, metrics, wins, losses).slice(0, maxItems),
      opponentId
    };
  });

  const leaderTeamId = state.winsA === state.winsB ? undefined : state.winsA > state.winsB ? series.teamAId : series.teamBId;
  return {
    seriesId: series.id,
    roundName: series.roundName,
    completedGames: games.length,
    leaderTeamId,
    teams: [plans[0], plans[1]]
  };
}

function completedGames(league: LeagueState): LeagueGame[] {
  return league.games.filter((game) => game.result).sort(compareGames);
}

function recentCompletedGames(league: LeagueState, currentDate: string | undefined, windowDays: number): LeagueGame[] {
  const games = completedGames(league);
  const anchor = currentDate ?? games.at(-1)?.date;
  if (!anchor) return games;
  return games.filter((game) => dateWithinWindow(game.date, anchor, windowDays));
}

function teamStreak(league: LeagueState, teamId: string): number {
  const games = teamScheduleGames(league, teamId)
    .filter((game) => game.result)
    .sort(compareGames)
    .reverse();
  let streak = 0;
  let direction: "win" | "loss" | "tie" | undefined;
  for (const game of games) {
    const outcome = game.result ? resultOutcome(game.result, teamId) : "tie";
    if (!direction) direction = outcome;
    if (outcome !== direction) break;
    streak += 1;
  }
  return direction === "loss" ? -streak : direction === "tie" ? 0 : streak;
}

function gameScoreline(game: LeagueGame): string {
  return game.result ? `${game.result.awayScore}-${game.result.homeScore}` : "Unplayed";
}

function leaderPlayerRows(league: LeagueState): ReturnType<typeof aggregatePlayerStats> {
  return aggregatePlayerStats(league).filter((row) => row.games > 0);
}

export function buildLeagueNewspaper(league: LeagueState, options: LeagueNewspaperOptions = {}): LeagueNewspaperItem[] {
  const items: LeagueNewspaperItem[] = [];
  const teamNames = options.teamNames;
  const maxItems = options.maxItems ?? 10;
  const windowDays = options.windowDays ?? 7;
  const rows = standings(league);
  const recentGames = recentCompletedGames(league, options.currentDate ?? league.currentDate, windowDays);
  const allCompleted = completedGames(league);
  const latest = allCompleted.at(-1);

  const leader = rows[0];
  if (leader && leader.played > 0) {
    items.push({
      id: `standings-leader-${leader.teamId}`,
      section: "standings",
      headline: `${lookupTeamName(leader.teamId, teamNames)} sets the pace`,
      detail: `${leader.wins}-${leader.losses}${leader.ties ? `-${leader.ties}` : ""}, ${signed(leader.differential, 0)} point differential`,
      teamIds: [leader.teamId],
      priority: 90,
      tone: "positive"
    });
  }

  const hottest = rows
    .map((row) => ({ row, streak: teamStreak(league, row.teamId) }))
    .filter((row) => row.streak >= 3)
    .sort((a, b) => b.streak - a.streak)[0];
  if (hottest) {
    items.push({
      id: `streak-${hottest.row.teamId}`,
      section: "front-page",
      headline: `${lookupTeamName(hottest.row.teamId, teamNames)} is rolling`,
      detail: `${hottest.streak} straight wins entering the next slate.`,
      teamIds: [hottest.row.teamId],
      priority: 86,
      tone: "positive"
    });
  }

  if (latest?.result) {
    const winnerId = latest.result.winnerTeamId === "tie" ? undefined : latest.result.winnerTeamId;
    const margin = Math.abs(latest.result.awayScore - latest.result.homeScore);
    items.push({
      id: `latest-${latest.id}`,
      section: "box-score",
      headline: winnerId ? `${lookupTeamName(winnerId, teamNames)} closes ${gameScoreline(latest)}` : `Tie saved at ${gameScoreline(latest)}`,
      detail: `${formatDate(latest.date)}: ${lookupTeamName(latest.awayTeamId, teamNames)} at ${lookupTeamName(latest.homeTeamId, teamNames)}${margin <= 5 ? " in a close one" : ""}.`,
      date: latest.date,
      teamIds: [latest.awayTeamId, latest.homeTeamId],
      gameId: latest.id,
      priority: 82,
      tone: margin <= 5 ? "warning" : "neutral"
    });
  }

  const scoringLeader = leaderPlayerRows(league).sort((a, b) => (b.perGame.PTS ?? 0) - (a.perGame.PTS ?? 0))[0];
  if (scoringLeader) {
    items.push({
      id: `scoring-leader-${scoringLeader.teamId}-${scoringLeader.player}`,
      section: "leaders",
      headline: `${scoringLeader.player} leads the scoring race`,
      detail: `${lookupTeamName(scoringLeader.teamId, teamNames)} guard/forward is at ${roundTo(scoringLeader.perGame.PTS ?? 0, 1)} points per game.`,
      teamIds: [scoringLeader.teamId],
      priority: 72,
      tone: "positive"
    });
  }

  const teamStats = aggregateTeamStats(league);
  const bestOffense = Object.entries(teamStats)
    .filter(([, line]) => line.games > 0)
    .sort((a, b) => (stat(b[1], "PTS") / Math.max(1, b[1].games)) - (stat(a[1], "PTS") / Math.max(1, a[1].games)))[0];
  if (bestOffense) {
    items.push({
      id: `best-offense-${bestOffense[0]}`,
      section: "leaders",
      headline: `${lookupTeamName(bestOffense[0], teamNames)} owns the top attack`,
      detail: `${roundTo(stat(bestOffense[1], "PTS") / Math.max(1, bestOffense[1].games), 1)} points per game through saved results.`,
      teamIds: [bestOffense[0]],
      priority: 64,
      tone: "positive"
    });
  }

  for (const game of recentGames) {
    if (!game.result || game.result.winnerTeamId === "tie") continue;
    const upset = buildUpsetSignal(league, game, game.result.winnerTeamId, teamNames);
    if (!upset) continue;
    items.push({
      id: `upset-${game.id}`,
      section: "front-page",
      headline: `${lookupTeamName(upset.underdogTeamId, teamNames)} springs an upset`,
      detail: upset.detail,
      date: game.date,
      teamIds: [game.awayTeamId, game.homeTeamId],
      gameId: game.id,
      priority: 88,
      tone: "warning"
    });
  }

  const upcoming = league.games
    .filter((game) => game.status === "unplayed")
    .sort(compareGames)
    .find((game) => !league.currentDate || !game.date || game.date >= league.currentDate);
  if (upcoming) {
    items.push({
      id: `upcoming-${upcoming.id}`,
      section: "schedule",
      headline: `${lookupTeamName(upcoming.awayTeamId, teamNames)} visits ${lookupTeamName(upcoming.homeTeamId, teamNames)}`,
      detail: `${formatDate(upcoming.date)} next on the league calendar.`,
      date: upcoming.date,
      teamIds: [upcoming.awayTeamId, upcoming.homeTeamId],
      gameId: upcoming.id,
      priority: 55,
      tone: "neutral"
    });
  }

  for (const series of league.playoffs?.series ?? []) {
    const state = playoffSeriesState(league, series);
    if (!state.completedGames.length) continue;
    const leaderTeamId = state.winsA === state.winsB ? undefined : state.winsA > state.winsB ? series.teamAId : series.teamBId;
    items.push({
      id: `series-${series.id}`,
      section: "playoffs",
      headline: leaderTeamId ? `${lookupTeamName(leaderTeamId, teamNames)} leads ${series.roundName}` : `${series.roundName} tied`,
      detail: `${lookupTeamName(series.teamAId, teamNames)} ${state.winsA}, ${lookupTeamName(series.teamBId, teamNames)} ${state.winsB}.`,
      teamIds: [series.teamAId, series.teamBId],
      priority: 78,
      tone: "warning"
    });
  }

  return items
    .sort((a, b) => b.priority - a.priority || (b.date ?? "").localeCompare(a.date ?? "") || a.id.localeCompare(b.id))
    .slice(0, maxItems);
}

function achievementTimestamp(league: LeagueState, now?: string, game?: LeagueGame): string {
  return game?.date ?? game?.result?.playedAt ?? now ?? league.updatedAt;
}

function preserveAchievement(
  record: LeagueAchievementRecord,
  previous: Map<string, LeagueAchievementRecord>
): LeagueAchievementRecord {
  const existing = previous.get(record.id);
  return existing ? { ...record, unlockedAt: existing.unlockedAt } : record;
}

export function deriveLeagueAchievements(
  league: LeagueState,
  previousRecords: readonly LeagueAchievementRecord[] = [],
  options: LeagueAchievementOptions = {}
): LeagueAchievementRecord[] {
  const previous = new Map(previousRecords.map((record) => [record.id, record]));
  const records: LeagueAchievementRecord[] = [];
  const push = (record: LeagueAchievementRecord) => {
    records.push(preserveAchievement(record, previous));
  };
  const games = completedGames(league);
  const firstGame = games[0];
  const teamNames = options.teamNames;

  if (firstGame) {
    push({
      id: "first-result",
      code: "FIRST_RESULT",
      title: "Opening Tip",
      detail: `First result saved: ${lookupTeamName(firstGame.awayTeamId, teamNames)} at ${lookupTeamName(firstGame.homeTeamId, teamNames)}.`,
      tier: "bronze",
      unlockedAt: achievementTimestamp(league, options.now, firstGame),
      gameId: firstGame.id
    });
  }

  const scheduledGames = league.games.filter((game) => game.date).length;
  if (scheduledGames >= Math.max(1, league.teamIds.length)) {
    push({
      id: "schedule-built",
      code: "SCHEDULE_BUILT",
      title: "Schedule Maker",
      detail: `${scheduledGames} dated games are on the calendar.`,
      tier: "bronze",
      unlockedAt: options.now ?? league.createdAt,
      value: scheduledGames
    });
  }

  const regularGames = gamesForScope(league.games, "regular");
  if (regularGames.length > 0 && regularGames.every((game) => game.result)) {
    push({
      id: "regular-season-complete",
      code: "REGULAR_SEASON_COMPLETE",
      title: "82-Game Mindset",
      detail: "Every regular-season game on the schedule has a saved result.",
      tier: "gold",
      unlockedAt: options.now ?? league.updatedAt,
      value: regularGames.length
    });
  }

  for (const game of games) {
    if (!game.result) continue;
    const winnerId = game.result.winnerTeamId === "tie" ? undefined : game.result.winnerTeamId;
    const highTeamId = game.result.awayScore >= game.result.homeScore ? game.awayTeamId : game.homeTeamId;
    const highScore = Math.max(game.result.awayScore, game.result.homeScore);
    const margin = Math.abs(game.result.awayScore - game.result.homeScore);
    if (highScore >= 140) {
      push({
        id: `team-140-${game.id}-${highTeamId}`,
        code: "TEAM_140",
        title: "Scoreboard Heat",
        detail: `${lookupTeamName(highTeamId, teamNames)} scored ${highScore}.`,
        tier: "silver",
        unlockedAt: achievementTimestamp(league, options.now, game),
        teamId: highTeamId,
        gameId: game.id,
        value: highScore
      });
    }
    if (margin <= 3) {
      push({
        id: `close-game-${game.id}`,
        code: "CLOSE_GAME",
        title: "Last Possession Feel",
        detail: `${lookupTeamName(game.awayTeamId, teamNames)} and ${lookupTeamName(game.homeTeamId, teamNames)} finished within ${margin}.`,
        tier: "bronze",
        unlockedAt: achievementTimestamp(league, options.now, game),
        gameId: game.id,
        value: margin
      });
    }
    if (game.result.quarters.length > 4) {
      push({
        id: `overtime-${game.id}`,
        code: "OVERTIME",
        title: "Bonus Basketball",
        detail: `${lookupTeamName(game.awayTeamId, teamNames)} at ${lookupTeamName(game.homeTeamId, teamNames)} went beyond regulation.`,
        tier: "silver",
        unlockedAt: achievementTimestamp(league, options.now, game),
        gameId: game.id,
        value: game.result.quarters.length - 4
      });
    }
    if (winnerId) {
      const upset = buildUpsetSignal(league, game, winnerId, teamNames);
      if (upset) {
        push({
          id: `upset-${game.id}`,
          code: "UPSET_WIN",
          title: "Bracket Breaker",
          detail: upset.detail,
          tier: "silver",
          unlockedAt: achievementTimestamp(league, options.now, game),
          teamId: winnerId,
          gameId: game.id
        });
      }
    }

    for (const [teamId, playerLines] of Object.entries(game.result.playerStats)) {
      for (const [player, line] of Object.entries(playerLines)) {
        if (stat(line, "PTS") >= 40) {
          push({
            id: `player-40-${game.id}-${teamId}-${player}`,
            code: "PLAYER_40",
            title: "Forty Piece",
            detail: `${player} scored ${stat(line, "PTS")} for ${lookupTeamName(teamId, teamNames)}.`,
            tier: "silver",
            unlockedAt: achievementTimestamp(league, options.now, game),
            teamId,
            player,
            gameId: game.id,
            value: stat(line, "PTS")
          });
        }
        const doubleDigits = ["PTS", "REB", "AST", "STL", "BLK"].filter((field) => stat(line, field) >= 10);
        if (doubleDigits.length >= 3) {
          push({
            id: `triple-double-${game.id}-${teamId}-${player}`,
            code: "TRIPLE_DOUBLE",
            title: "Triple Double",
            detail: `${player} reached double digits in ${doubleDigits.slice(0, 3).join(", ")}.`,
            tier: "gold",
            unlockedAt: achievementTimestamp(league, options.now, game),
            teamId,
            player,
            gameId: game.id,
            value: doubleDigits.length
          });
        }
      }
    }
  }

  for (const teamId of league.teamIds) {
    const streak = teamStreak(league, teamId);
    if (streak >= 5) {
      push({
        id: `win-streak-5-${teamId}`,
        code: "WIN_STREAK_5",
        title: "Five Straight",
        detail: `${lookupTeamName(teamId, teamNames)} has won ${streak} in a row.`,
        tier: "gold",
        unlockedAt: options.now ?? league.updatedAt,
        teamId,
        value: streak
      });
    }
  }

  const finals = league.playoffs?.series.filter((series) => series.round === 4).sort((a, b) => b.bracketIndex - a.bracketIndex)[0];
  const championTeamId = finals ? playoffSeriesState(league, finals).winnerTeamId : undefined;
  if (championTeamId) {
    push({
      id: `champion-${championTeamId}`,
      code: "LEAGUE_CHAMPION",
      title: "Champion Crowned",
      detail: `${lookupTeamName(championTeamId, teamNames)} won the league title.`,
      tier: "platinum",
      unlockedAt: options.now ?? league.updatedAt,
      teamId: championTeamId
    });
  }

  for (const record of previousRecords) {
    if (!records.some((next) => next.id === record.id)) records.push(record);
  }

  return records.sort((a, b) => a.unlockedAt.localeCompare(b.unlockedAt) || a.id.localeCompare(b.id));
}

function playoffSeedMap(league: LeagueState): Map<string, number> {
  return new Map((league.playoffs?.playoffSeeds ?? league.playoffs?.seeds ?? []).map((seed) => [seed.teamId, seed.seed]));
}

function standingsRankMap(league: LeagueState): Map<string, number> {
  return new Map(standings(league).map((row, index) => [row.teamId, index + 1]));
}

function buildUpsetSignal(league: LeagueState, game: LeagueGame, winnerTeamId?: string, teamNames?: TeamNameLookup): UpsetSignal | undefined {
  const seedRanks = playoffSeedMap(league);
  const awaySeed = seedRanks.get(game.awayTeamId);
  const homeSeed = seedRanks.get(game.homeTeamId);
  if (awaySeed !== undefined && homeSeed !== undefined && awaySeed !== homeSeed) {
    const favoriteTeamId = awaySeed < homeSeed ? game.awayTeamId : game.homeTeamId;
    const underdogTeamId = favoriteTeamId === game.awayTeamId ? game.homeTeamId : game.awayTeamId;
    const favoriteRank = Math.min(awaySeed, homeSeed);
    const underdogRank = Math.max(awaySeed, homeSeed);
    if (!winnerTeamId || winnerTeamId === underdogTeamId) {
      return {
        favoriteTeamId,
        underdogTeamId,
        basis: "playoff-seed",
        favoriteRank,
        underdogRank,
        upsetWinnerTeamId: winnerTeamId,
        label: winnerTeamId ? "Seed upset" : "Upset watch",
        detail: `${lookupTeamName(underdogTeamId, teamNames)} seed ${underdogRank} challenged seed ${favoriteRank} ${lookupTeamName(favoriteTeamId, teamNames)}.`
      };
    }
    return undefined;
  }

  const ranks = standingsRankMap(league);
  const awayRank = ranks.get(game.awayTeamId);
  const homeRank = ranks.get(game.homeTeamId);
  if (awayRank === undefined || homeRank === undefined || Math.abs(awayRank - homeRank) < 4) return undefined;
  const favoriteTeamId = awayRank < homeRank ? game.awayTeamId : game.homeTeamId;
  const underdogTeamId = favoriteTeamId === game.awayTeamId ? game.homeTeamId : game.awayTeamId;
  const favoriteRank = Math.min(awayRank, homeRank);
  const underdogRank = Math.max(awayRank, homeRank);
  if (winnerTeamId && winnerTeamId !== underdogTeamId) return undefined;
  return {
    favoriteTeamId,
    underdogTeamId,
    basis: "standings",
    favoriteRank,
    underdogRank,
    upsetWinnerTeamId: winnerTeamId,
    label: winnerTeamId ? "Standings upset" : "Upset watch",
    detail: `${lookupTeamName(underdogTeamId, teamNames)} rank ${underdogRank} challenged rank ${favoriteRank} ${lookupTeamName(favoriteTeamId, teamNames)}.`
  };
}

function meetingSummary(game: LeagueGame): RivalryMeetingSummary | undefined {
  if (!game.result) return undefined;
  return {
    gameId: game.id,
    date: game.date,
    winnerTeamId: game.result.winnerTeamId === "tie" ? undefined : game.result.winnerTeamId,
    awayTeamId: game.awayTeamId,
    homeTeamId: game.homeTeamId,
    awayScore: game.result.awayScore,
    homeScore: game.result.homeScore,
    margin: Math.abs(game.result.awayScore - game.result.homeScore)
  };
}

export function detectRivalrySignals(league: LeagueState, gameOrId: LeagueGame | string, options: RivalrySignalOptions = {}): RivalrySignalReport {
  const game = resolveLeagueGame(league, gameOrId);
  if (!game) throw new Error("Game not found.");

  const teamIds: [string, string] = [game.awayTeamId, game.homeTeamId];
  const pairKey = teamPairKey(teamIds[0], teamIds[1]);
  const meetings = league.games.filter((row) => teamPairKey(row.awayTeamId, row.homeTeamId) === pairKey).sort(compareGames);
  const completed = meetings.filter((row) => row.result);
  const priorCompleted = completed.filter((row) => row.id !== game.id && compareGames(row, game) < 0);
  const lastCompletedMeeting = priorCompleted.at(-1) ?? completed.filter((row) => row.id !== game.id).at(-1);
  const lastMeeting = lastCompletedMeeting ? meetingSummary(lastCompletedMeeting) : undefined;
  const states: [HeadToHeadTeamState, HeadToHeadTeamState] = teamIds.map((teamId) => ({
    teamId,
    wins: 0,
    losses: 0,
    ties: 0,
    pointsFor: 0,
    pointsAgainst: 0
  })) as [HeadToHeadTeamState, HeadToHeadTeamState];

  for (const row of completed) {
    if (!row.result) continue;
    for (const state of states) {
      const opponentId = opponentTeamId(row, state.teamId);
      state.pointsFor += resultTeamScore(row.result, state.teamId);
      state.pointsAgainst += resultTeamScore(row.result, opponentId);
      const outcome = resultOutcome(row.result, state.teamId);
      if (outcome === "win") state.wins += 1;
      else if (outcome === "loss") state.losses += 1;
      else state.ties += 1;
    }
  }

  const revengeTeamId = lastMeeting?.winnerTeamId ? teamIds.find((teamId) => teamId !== lastMeeting.winnerTeamId) : undefined;
  const seedUpset = game.result && game.result.winnerTeamId !== "tie" ? buildUpsetSignal(league, game, game.result.winnerTeamId, options.teamNames) : undefined;
  const upsetOpportunity = game.result ? undefined : buildUpsetSignal(league, game, undefined, options.teamNames);
  const notes: string[] = [];
  if (priorCompleted.length > 0) notes.push(`${priorCompleted.length} prior completed meeting${priorCompleted.length === 1 ? "" : "s"}.`);
  if (revengeTeamId) notes.push(`${lookupTeamName(revengeTeamId, options.teamNames)} has the revenge angle.`);
  if (seedUpset) notes.push(seedUpset.label);
  if (upsetOpportunity) notes.push(upsetOpportunity.label);

  return {
    pairKey,
    teamIds,
    gameId: game.id,
    meetings: meetings.length,
    completedMeetings: completed.length,
    headToHead: states,
    lastMeeting,
    rematchLabel: priorCompleted.length ? `Rematch ${priorCompleted.length + 1}` : "First meeting",
    revengeTeamId,
    seedUpset,
    upsetOpportunity,
    notes
  };
}

export function buildLeagueChallenges(league: LeagueState, options: LeagueChallengeOptions = {}): LeagueChallenge[] {
  const teamNames = options.teamNames;
  const maxItems = options.maxItems ?? 8;
  const challenges: LeagueChallenge[] = [];
  const nextGame = league.games
    .filter((game) => game.status === "unplayed")
    .sort(compareGames)
    .find((game) => !league.currentDate || !game.date || game.date >= league.currentDate);

  if (nextGame) {
    challenges.push({
      id: `next-game-${nextGame.id}`,
      title: "Play the next game",
      detail: `${lookupTeamName(nextGame.awayTeamId, teamNames)} at ${lookupTeamName(nextGame.homeTeamId, teamNames)}${nextGame.date ? ` on ${nextGame.date}` : ""}.`,
      teamIds: [nextGame.awayTeamId, nextGame.homeTeamId],
      gameId: nextGame.id,
      priority: "high",
      category: "schedule"
    });

    const rivalry = detectRivalrySignals(league, nextGame, { teamNames });
    if (rivalry.completedMeetings > 0) {
      challenges.push({
        id: `rivalry-${nextGame.id}`,
        title: rivalry.rematchLabel,
        detail: rivalry.revengeTeamId
          ? `${lookupTeamName(rivalry.revengeTeamId, teamNames)} can answer the last meeting.`
          : "Add another chapter to the head-to-head.",
        teamIds: rivalry.teamIds,
        gameId: nextGame.id,
        priority: "medium",
        category: "rivalry"
      });
    }

    if (rivalry.upsetOpportunity) {
      challenges.push({
        id: `upset-watch-${nextGame.id}`,
        title: "Upset watch",
        detail: rivalry.upsetOpportunity.detail,
        teamIds: [rivalry.upsetOpportunity.favoriteTeamId, rivalry.upsetOpportunity.underdogTeamId],
        gameId: nextGame.id,
        priority: "medium",
        category: "upset"
      });
    }
  }

  for (const row of standings(league)) {
    const streak = teamStreak(league, row.teamId);
    if (streak >= 3) {
      challenges.push({
        id: `extend-streak-${row.teamId}`,
        title: "Extend the streak",
        detail: `${lookupTeamName(row.teamId, teamNames)} has won ${streak} straight.`,
        teamIds: [row.teamId],
        priority: "medium",
        category: "streak"
      });
    } else if (streak <= -3) {
      challenges.push({
        id: `stop-skid-${row.teamId}`,
        title: "Stop the skid",
        detail: `${lookupTeamName(row.teamId, teamNames)} has dropped ${Math.abs(streak)} straight.`,
        teamIds: [row.teamId],
        priority: "medium",
        category: "streak"
      });
    }
  }

  for (const series of league.playoffs?.series ?? []) {
    const state = playoffSeriesState(league, series);
    if (state.status === "complete" || !state.completedGames.length) continue;
    const trailingTeamId = state.winsA === state.winsB ? undefined : state.winsA < state.winsB ? series.teamAId : series.teamBId;
    if (trailingTeamId) {
      challenges.push({
        id: `series-response-${series.id}-${trailingTeamId}`,
        title: "Find the series response",
        detail: `${lookupTeamName(trailingTeamId, teamNames)} is down ${Math.max(state.winsA, state.winsB)}-${Math.min(state.winsA, state.winsB)} in ${series.roundName}.`,
        teamIds: [series.teamAId, series.teamBId],
        gameId: state.nextGame?.id,
        priority: "high",
        category: "playoffs"
      });
    }
  }

  const priorityWeight: Record<LeagueChallenge["priority"], number> = { high: 3, medium: 2, low: 1 };
  return challenges
    .sort((a, b) => priorityWeight[b.priority] - priorityWeight[a.priority] || a.id.localeCompare(b.id))
    .slice(0, maxItems);
}

function objectiveScore(current: number, target: number, comparator: ScenarioObjectiveComparator, maxPoints: number): ScenarioObjectiveScore {
  const completed = comparator === "eq" ? current === target : comparator === "gte" ? current >= target : current <= target;
  const progress =
    comparator === "eq"
      ? completed
        ? 1
        : 0
      : comparator === "gte"
        ? target <= 0
          ? completed
            ? 1
            : 0
          : clamp(current / target, 0, 1)
        : completed
          ? 1
          : target <= 0
            ? 0
            : clamp(target / Math.max(target, current), 0, 1);

  return {
    current: roundTo(current, 2),
    target: roundTo(target, 2),
    progress: roundTo(progress, 3),
    points: roundTo(maxPoints * progress, 0),
    maxPoints,
    completed
  };
}

function scenarioObjective(args: Omit<ScenarioObjective, "score"> & { current: number; target: number; maxPoints: number }): ScenarioObjective {
  return {
    id: args.id,
    kind: args.kind,
    label: args.label,
    detail: args.detail,
    comparator: args.comparator,
    teamId: args.teamId,
    opponentTeamId: args.opponentTeamId,
    gameId: args.gameId,
    stat: args.stat,
    score: objectiveScore(args.current, args.target, args.comparator, args.maxPoints)
  };
}

function scenarioScoring(objectives: ScenarioObjective[]): ScenarioChallengeCard["scoring"] {
  const points = objectives.reduce((sum, objective) => sum + objective.score.points, 0);
  const maxPoints = objectives.reduce((sum, objective) => sum + objective.score.maxPoints, 0);
  const progress = maxPoints ? points / maxPoints : 0;
  const completed = objectives.filter((objective) => objective.score.completed).length;
  return {
    points,
    maxPoints,
    progress: roundTo(progress, 3),
    completionLabel: `${completed}/${objectives.length} objectives`
  };
}

function scenarioDifficulty(category: ScenarioChallengeCard["category"], objectives: ScenarioObjective[]): ScenarioChallengeDifficulty {
  if (category === "playoffs" || objectives.some((objective) => objective.score.maxPoints >= 70)) return "legend";
  if (category === "upset" || category === "rivalry") return "hard";
  if (objectives.length >= 3) return "standard";
  return "starter";
}

function scenarioEntryGames(
  league: LeagueState,
  teamIds: string[],
  teamNames: TeamNameLookup | undefined,
  limit: number,
  preferredGameId?: string
): ScenarioEntryGame[] {
  const teamSet = new Set(teamIds);
  const upcoming = league.games
    .filter((game) => game.status === "unplayed")
    .filter((game) => !league.currentDate || !game.date || game.date >= league.currentDate)
    .map((game) => {
      const matchCount = [game.awayTeamId, game.homeTeamId].filter((teamId) => teamSet.has(teamId)).length;
      return {
        game,
        matchCount,
        score: (game.id === preferredGameId ? 20 : 0) + matchCount * 5
      };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || compareGames(a.game, b.game))
    .slice(0, limit);

  return upcoming.map(({ game, matchCount }, index) => ({
    gameId: game.id,
    date: game.date,
    teamIds: [game.awayTeamId, game.homeTeamId],
    label: `${lookupTeamName(game.awayTeamId, teamNames)} at ${lookupTeamName(game.homeTeamId, teamNames)}`,
    reason:
      game.id === preferredGameId
        ? "Primary scenario entry"
        : matchCount === 2
          ? "Direct matchup fit"
          : "Team storyline fit",
    priority: index === 0 ? "primary" : matchCount === 2 ? "secondary" : "fallback"
  }));
}

function resultWinCurrent(game: LeagueGame | undefined, teamId: string | undefined): number {
  if (!game?.result || !teamId) return 0;
  return game.result.winnerTeamId === teamId ? 1 : 0;
}

function marginForTeam(game: LeagueGame | undefined, teamId: string | undefined): number {
  if (!game?.result || !teamId) return 0;
  const opponentId = opponentTeamId(game, teamId);
  return resultTeamScore(game.result, teamId) - resultTeamScore(game.result, opponentId);
}

function teamRecordFromGames(games: LeagueGame[], teamId: string): { wins: number; losses: number; ties: number; games: number } {
  const record = { wins: 0, losses: 0, ties: 0, games: 0 };
  for (const game of games) {
    if (!game.result || (game.awayTeamId !== teamId && game.homeTeamId !== teamId)) continue;
    const outcome = resultOutcome(game.result, teamId);
    record.games += 1;
    if (outcome === "win") record.wins += 1;
    else if (outcome === "loss") record.losses += 1;
    else record.ties += 1;
  }
  return record;
}

function buildScenarioCardFromChallenge(league: LeagueState, challenge: LeagueChallenge, options: ScenarioChallengeOptions): ScenarioChallengeCard {
  const teamNames = options.teamNames;
  const entryLimit = options.maxEntryGames ?? 3;
  const game = challenge.gameId ? resolveLeagueGame(league, challenge.gameId) : undefined;
  const upsetSignal = game && !game.result ? buildUpsetSignal(league, game, undefined, teamNames) : undefined;
  const focusTeamId = upsetSignal?.underdogTeamId ?? challenge.teamIds[0];
  const opponentId = game && focusTeamId ? opponentTeamId(game, focusTeamId) : challenge.teamIds.find((teamId) => teamId !== focusTeamId);
  const objectives: ScenarioObjective[] = [];

  if (game && focusTeamId) {
    objectives.push(
      scenarioObjective({
        id: `${challenge.id}-win`,
        kind: "win",
        label: challenge.category === "upset" ? "Win as the underdog" : "Win the entry game",
        detail: `${lookupTeamName(focusTeamId, teamNames)} must finish the assignment.`,
        comparator: "gte",
        current: resultWinCurrent(game, focusTeamId),
        target: 1,
        maxPoints: challenge.category === "upset" ? 70 : 50,
        teamId: focusTeamId,
        opponentTeamId: opponentId,
        gameId: game.id
      })
    );
  }

  if (challenge.category === "rivalry" && game) {
    const rivalry = detectRivalrySignals(league, game, { teamNames });
    const lastMargin = rivalry.lastMeeting?.margin ?? 0;
    objectives.push(
      scenarioObjective({
        id: `${challenge.id}-rivalry-margin`,
        kind: "margin",
        label: "Flip the rivalry pressure",
        detail: lastMargin ? `Match or beat the last meeting margin of ${lastMargin}.` : "Create a clear head-to-head marker.",
        comparator: "gte",
        current: Math.max(0, marginForTeam(game, focusTeamId)),
        target: Math.max(1, lastMargin),
        maxPoints: 35,
        teamId: focusTeamId,
        opponentTeamId: opponentId,
        gameId: game.id
      })
    );
  }

  if (challenge.category === "streak" && focusTeamId) {
    const streak = teamStreak(league, focusTeamId);
    objectives.push(
      scenarioObjective({
        id: `${challenge.id}-streak`,
        kind: "streak",
        label: streak >= 0 ? "Extend the run" : "Stop the slide",
        detail: streak >= 0 ? `Push the win streak past ${streak}.` : `End a ${Math.abs(streak)} game skid.`,
        comparator: "gte",
        current: streak >= 0 ? streak : 0,
        target: streak >= 0 ? streak + 1 : 1,
        maxPoints: 40,
        teamId: focusTeamId
      })
    );
  }

  if (challenge.category === "playoffs" && game?.playoffSeriesId) {
    const series = league.playoffs?.series.find((row) => row.id === game.playoffSeriesId);
    if (series && focusTeamId) {
      const state = playoffSeriesState(league, series);
      const currentWins = focusTeamId === series.teamAId ? state.winsA : state.winsB;
      objectives.push(
        scenarioObjective({
          id: `${challenge.id}-series`,
          kind: "series",
          label: "Move toward four wins",
          detail: `${series.roundName}: bank series wins before the opponent closes the door.`,
          comparator: "gte",
          current: currentWins,
          target: 4,
          maxPoints: 60,
          teamId: focusTeamId,
          opponentTeamId: opponentId,
          gameId: game.id
        })
      );
    }
  }

  if (focusTeamId) {
    const identity = buildTeamIdentityCard(league, focusTeamId, { teamNames, scope: "all" });
    if (identity.sampleGames > 0 && identity.metrics.turnoverRate > 0) {
      objectives.push(
        scenarioObjective({
          id: `${challenge.id}-security`,
          kind: "team-stat",
          label: "Keep the offense organized",
          detail: `Enter with a turnover profile at or below ${pct(0.14)}.`,
          comparator: "lte",
          current: identity.metrics.turnoverRate,
          target: 0.14,
          maxPoints: 25,
          teamId: focusTeamId,
          stat: "TOV rate"
        })
      );
    }
  }

  if (!objectives.length) {
    objectives.push(
      scenarioObjective({
        id: `${challenge.id}-play`,
        kind: "win",
        label: "Create the result",
        detail: "Play or simulate the recommended entry game.",
        comparator: "gte",
        current: game?.result ? 1 : 0,
        target: 1,
        maxPoints: 25,
        teamId: focusTeamId,
        opponentTeamId: opponentId,
        gameId: game?.id
      })
    );
  }

  const category = challenge.category;
  return {
    id: `scenario-${challenge.id}`,
    title: challenge.title,
    hook:
      category === "upset"
        ? "Tilt the league narrative in one night."
        : category === "playoffs"
          ? "Survive the adjustment window."
          : category === "rivalry"
            ? "Make the rematch matter."
            : "Turn a league prompt into a scored challenge.",
    detail: challenge.detail,
    category,
    difficulty: scenarioDifficulty(category, objectives),
    tone: challenge.priority === "high" ? "warning" : category === "upset" ? "warning" : "neutral",
    priority: challenge.priority,
    teamIds: challenge.teamIds,
    seedChallengeId: challenge.id,
    recommendedEntryGames: scenarioEntryGames(league, challenge.teamIds, teamNames, entryLimit, challenge.gameId),
    objectives,
    scoring: scenarioScoring(objectives)
  };
}

export function buildScenarioChallengeCards(league: LeagueState, options: ScenarioChallengeOptions = {}): ScenarioChallengeCard[] {
  const maxItems = options.maxItems ?? 10;
  const cards: ScenarioChallengeCard[] = [];
  const includeBase = options.includeBaseChallenges ?? true;

  if (includeBase) {
    for (const challenge of buildLeagueChallenges(league, { teamNames: options.teamNames, maxItems: maxItems * 2 })) {
      cards.push(buildScenarioCardFromChallenge(league, challenge, options));
    }
  }

  const rows = standings(league);
  const topTwo = rows.filter((row) => row.played > 0).slice(0, 2);
  if (topTwo.length === 2) {
    const chaser = topTwo[1];
    const objectives = [
      scenarioObjective({
        id: `top-seed-${chaser.teamId}-rank`,
        kind: "ranking",
        label: "Reach the top seed line",
        detail: `${lookupTeamName(chaser.teamId, options.teamNames)} is chasing ${lookupTeamName(topTwo[0].teamId, options.teamNames)}.`,
        comparator: "lte",
        current: rows.findIndex((row) => row.teamId === chaser.teamId) + 1,
        target: 1,
        maxPoints: 60,
        teamId: chaser.teamId
      }),
      scenarioObjective({
        id: `top-seed-${chaser.teamId}-winpct`,
        kind: "ranking",
        label: "Close the win percentage gap",
        detail: "Keep pressure on the leader through the next playable window.",
        comparator: "gte",
        current: chaser.winPct,
        target: topTwo[0].winPct,
        maxPoints: 35,
        teamId: chaser.teamId
      })
    ];
    cards.push({
      id: `scenario-top-seed-${chaser.teamId}`,
      title: "Top seed chase",
      hook: "Turn the standings race into a scored mini-campaign.",
      detail: `${lookupTeamName(chaser.teamId, options.teamNames)} needs a clean week to pressure ${lookupTeamName(topTwo[0].teamId, options.teamNames)}.`,
      category: "scenario",
      difficulty: "hard",
      tone: "positive",
      priority: "medium",
      teamIds: [chaser.teamId, topTwo[0].teamId],
      recommendedEntryGames: scenarioEntryGames(league, [chaser.teamId, topTwo[0].teamId], options.teamNames, options.maxEntryGames ?? 3),
      objectives,
      scoring: scenarioScoring(objectives)
    });
  }

  const scoringLeader = leaderPlayerRows(league).sort((a, b) => (b.perGame.PTS ?? 0) - (a.perGame.PTS ?? 0))[0];
  if (scoringLeader) {
    const objectives = [
      scenarioObjective({
        id: `scoring-leader-${scoringLeader.teamId}-${scoringLeader.player}`,
        kind: "team-stat",
        label: "Keep the star engine hot",
        detail: `${scoringLeader.player} is at ${roundTo(scoringLeader.perGame.PTS ?? 0, 1)} points per game.`,
        comparator: "gte",
        current: scoringLeader.perGame.PTS ?? 0,
        target: 30,
        maxPoints: 45,
        teamId: scoringLeader.teamId,
        stat: "PTS"
      })
    ];
    cards.push({
      id: `scenario-scoring-crown-${scoringLeader.teamId}-${scoringLeader.player}`,
      title: "Scoring crown pressure",
      hook: "Feature the league's hottest scorer without letting the plan flatten.",
      detail: `${lookupTeamName(scoringLeader.teamId, options.teamNames)} can build a showcase game around ${scoringLeader.player}.`,
      category: "stat",
      difficulty: "standard",
      tone: "positive",
      priority: "low",
      teamIds: [scoringLeader.teamId],
      recommendedEntryGames: scenarioEntryGames(league, [scoringLeader.teamId], options.teamNames, options.maxEntryGames ?? 3),
      objectives,
      scoring: scenarioScoring(objectives)
    });
  }

  const priorityWeight: Record<ScenarioChallengeCard["priority"], number> = { high: 3, medium: 2, low: 1 };
  const difficultyWeight: Record<ScenarioChallengeDifficulty, number> = { legend: 4, hard: 3, standard: 2, starter: 1 };
  return cards
    .filter((card, index, array) => array.findIndex((row) => row.id === card.id) === index)
    .sort(
      (a, b) =>
        priorityWeight[b.priority] - priorityWeight[a.priority] ||
        difficultyWeight[b.difficulty] - difficultyWeight[a.difficulty] ||
        b.scoring.maxPoints - a.scoring.maxPoints ||
        a.id.localeCompare(b.id)
    )
    .slice(0, maxItems);
}

const neutralGamePlan: Required<TeamGamePlanOptions> = {
  usageConcentration: 1,
  playerUsageTargets: {},
  threePointEmphasis: 0,
  foulPressure: 0,
  crashBoards: 0,
  ballSecurity: 0
};

function normalizeGamePlan(plan: TeamGamePlanOptions | undefined): Required<TeamGamePlanOptions> {
  return {
    usageConcentration: clamp(plan?.usageConcentration ?? neutralGamePlan.usageConcentration, 0.7, 1.4),
    playerUsageTargets: plan?.playerUsageTargets ?? {},
    threePointEmphasis: clamp(plan?.threePointEmphasis ?? neutralGamePlan.threePointEmphasis, -10, 10),
    foulPressure: clamp(plan?.foulPressure ?? neutralGamePlan.foulPressure, -6, 6),
    crashBoards: clamp(plan?.crashBoards ?? neutralGamePlan.crashBoards, -6, 6),
    ballSecurity: clamp(plan?.ballSecurity ?? neutralGamePlan.ballSecurity, -6, 6)
  };
}

function applyPlanEffect(plan: Required<TeamGamePlanOptions>, effect: TeamGamePlanOptions): Required<TeamGamePlanOptions> {
  return normalizeGamePlan({
    usageConcentration: plan.usageConcentration + (effect.usageConcentration ?? 0),
    playerUsageTargets: plan.playerUsageTargets,
    threePointEmphasis: plan.threePointEmphasis + (effect.threePointEmphasis ?? 0),
    foulPressure: plan.foulPressure + (effect.foulPressure ?? 0),
    crashBoards: plan.crashBoards + (effect.crashBoards ?? 0),
    ballSecurity: plan.ballSecurity + (effect.ballSecurity ?? 0)
  });
}

function recentTeamGames(league: LeagueState, teamId: string, limit: number): LeagueGame[] {
  return teamScheduleGames(league, teamId)
    .filter((game) => game.result)
    .sort(compareGames)
    .reverse()
    .slice(0, limit)
    .reverse();
}

function headToHeadCompletedGames(league: LeagueState, teamAId: string, teamBId: string): LeagueGame[] {
  const pairKey = teamPairKey(teamAId, teamBId);
  return league.games.filter((game) => game.result && teamPairKey(game.awayTeamId, game.homeTeamId) === pairKey).sort(compareGames);
}

function planMetricsFromSplit(split: TeamGameSplit): AdaptiveGamePlanSuggestion["metrics"] {
  const games = Math.max(1, split.games);
  return {
    recentGames: split.games,
    recentWins: 0,
    recentLosses: 0,
    recentNetRating: roundTo((split.pointsFor - split.pointsAgainst) / games, 1),
    headToHeadGames: 0,
    headToHeadWins: 0,
    headToHeadLosses: 0,
    turnoverRate: roundTo(rate(stat(split.teamStats, "TOV"), stat(split.teamStats, "FGA") + stat(split.teamStats, "FTA") * 0.44 + stat(split.teamStats, "TOV")), 3),
    reboundMargin: roundTo((split.reboundsFor - split.reboundsAgainst) / games, 1),
    threeAttemptRate: roundTo(rate(stat(split.teamStats, "3PA"), stat(split.teamStats, "FGA")), 3),
    freeThrowRate: roundTo(rate(stat(split.teamStats, "FTA"), stat(split.teamStats, "FGA")), 3)
  };
}

function adaptiveSuggestionForTeam(
  league: LeagueState,
  teamId: string,
  opponentId: string,
  options: AdaptiveGamePlanOptions
): AdaptiveGamePlanSuggestion {
  const recentLimit = options.recentGameLimit ?? 5;
  const teamNames = options.teamNames;
  const recentGames = recentTeamGames(league, teamId, recentLimit);
  const recentSplit = aggregateResultsForTeam(recentGames, teamId);
  const recentRecord = teamRecordFromGames(recentGames, teamId);
  const headToHeadGames = headToHeadCompletedGames(league, teamId, opponentId);
  const headToHeadSplit = aggregateResultsForTeam(headToHeadGames, teamId);
  const headToHeadRecord = teamRecordFromGames(headToHeadGames, teamId);
  const ownIdentity = buildTeamIdentityCard(league, teamId, { teamNames, scope: "all" });
  const opponentIdentity = buildTeamIdentityCard(league, opponentId, { teamNames, scope: "all" });
  const metrics = {
    ...planMetricsFromSplit(recentSplit),
    recentWins: recentRecord.wins,
    recentLosses: recentRecord.losses,
    headToHeadGames: headToHeadRecord.games,
    headToHeadWins: headToHeadRecord.wins,
    headToHeadLosses: headToHeadRecord.losses
  };
  const reasons: AdaptiveGamePlanReason[] = [];
  let plan = normalizeGamePlan(undefined);
  const addReason = (reason: AdaptiveGamePlanReason) => {
    reasons.push(reason);
    plan = applyPlanEffect(plan, reason.effect);
  };

  if (recentRecord.losses >= 2 && recentRecord.losses > recentRecord.wins) {
    addReason({
      type: "recent-form",
      label: "Stabilize recent form",
      detail: `${lookupTeamName(teamId, teamNames)} is ${recentRecord.wins}-${recentRecord.losses} over the last ${recentRecord.games}.`,
      effect: { usageConcentration: -0.04, ballSecurity: 2 },
      weight: 18,
      tone: "warning"
    });
  }
  if (metrics.turnoverRate >= 0.145) {
    addReason({
      type: "recent-form",
      label: "Protect possessions",
      detail: `Recent turnover rate is ${pct(metrics.turnoverRate)}.`,
      effect: { usageConcentration: -0.04, ballSecurity: 3 },
      weight: 20,
      tone: "warning"
    });
  }
  if (metrics.reboundMargin <= -3) {
    addReason({
      type: "recent-form",
      label: "Recover the glass",
      detail: `Recent rebound margin is ${signed(metrics.reboundMargin)} per game.`,
      effect: { crashBoards: 3, ballSecurity: -1 },
      weight: 16,
      tone: "warning"
    });
  }
  if (headToHeadRecord.losses > headToHeadRecord.wins && headToHeadRecord.games > 0) {
    const h2hReboundMargin = headToHeadSplit.games ? (headToHeadSplit.reboundsFor - headToHeadSplit.reboundsAgainst) / headToHeadSplit.games : 0;
    addReason({
      type: "head-to-head",
      label: "Counter the matchup history",
      detail: `${lookupTeamName(teamId, teamNames)} is ${headToHeadRecord.wins}-${headToHeadRecord.losses} head-to-head.`,
      effect: h2hReboundMargin < 0 ? { crashBoards: 2, foulPressure: 1 } : { threePointEmphasis: 2, ballSecurity: 1 },
      weight: 18,
      tone: "warning"
    });
  }
  if (ownIdentity.metrics.threeAttemptRate >= 0.36) {
    addReason({
      type: "own-identity",
      label: "Lean into spacing",
      detail: `${lookupTeamName(teamId, teamNames)} already owns a ${pct(ownIdentity.metrics.threeAttemptRate)} 3PA/FGA profile.`,
      effect: { threePointEmphasis: 3, crashBoards: -1 },
      weight: 14,
      tone: "positive"
    });
  } else if (ownIdentity.metrics.freeThrowRate >= 0.28) {
    addReason({
      type: "own-identity",
      label: "Keep pressure on the rim",
      detail: `${lookupTeamName(teamId, teamNames)} creates free throws at ${pct(ownIdentity.metrics.freeThrowRate)} of FGA.`,
      effect: { foulPressure: 3, crashBoards: 1 },
      weight: 14,
      tone: "positive"
    });
  }
  if (ownIdentity.metrics.topPlayerLoadShare >= 0.36) {
    addReason({
      type: "own-identity",
      label: "Protect the primary option",
      detail: `Top player load is ${pct(ownIdentity.metrics.topPlayerLoadShare)}.`,
      effect: { usageConcentration: -0.03, ballSecurity: 1 },
      weight: 10,
      tone: "neutral"
    });
  }
  if (opponentIdentity.badges.defense.tone === "positive") {
    addReason({
      type: "opponent-identity",
      label: "Stretch a strong defense",
      detail: `${lookupTeamName(opponentId, teamNames)} profiles as ${opponentIdentity.badges.defense.label.toLowerCase()}.`,
      effect: { threePointEmphasis: 2, foulPressure: 1 },
      weight: 16,
      tone: "warning"
    });
  }
  if (opponentIdentity.badges.glass.tone === "positive") {
    addReason({
      type: "opponent-identity",
      label: "Do not concede the glass",
      detail: `${lookupTeamName(opponentId, teamNames)} has a ${opponentIdentity.badges.glass.value} rebound profile.`,
      effect: { crashBoards: 2 },
      weight: 12,
      tone: "warning"
    });
  }
  if (!reasons.length) {
    addReason({
      type: "own-identity",
      label: "Stay balanced",
      detail: "No strong matchup signal overrides the base plan.",
      effect: {},
      weight: 8,
      tone: "neutral"
    });
  }

  const confidence = clamp(0.34 + reasons.reduce((sum, reason) => sum + reason.weight, 0) / 100, 0.35, 0.92);
  const strongest = reasons.slice().sort((a, b) => b.weight - a.weight)[0];

  return {
    teamId,
    teamName: lookupTeamName(teamId, teamNames),
    opponentTeamId: opponentId,
    opponentTeamName: lookupTeamName(opponentId, teamNames),
    suggestedPlan: plan,
    confidence: roundTo(confidence, 2),
    summary: strongest ? `${strongest.label}: ${strongest.detail}` : "Balanced plan suggested.",
    reasons,
    metrics
  };
}

export function suggestOpponentAdaptiveGamePlans(league: LeagueState, options: AdaptiveGamePlanOptions = {}): AdaptiveGamePlanReport {
  const game = resolveLeagueGame(league, options.gameOrId);
  const suggestions: Record<string, AdaptiveGamePlanSuggestion> = {};
  const teamIds: string[] = [];

  if (game) {
    for (const [teamId, opponentId] of [
      [game.awayTeamId, game.homeTeamId],
      [game.homeTeamId, game.awayTeamId]
    ] as Array<[string, string]>) {
      suggestions[teamId] = adaptiveSuggestionForTeam(league, teamId, opponentId, options);
      teamIds.push(teamId);
    }
    return {
      gameId: game.id,
      date: game.date,
      generatedFor: "game",
      teamIds,
      suggestedPlans: Object.fromEntries(Object.entries(suggestions).map(([teamId, suggestion]) => [teamId, suggestion.suggestedPlan])),
      suggestions
    };
  }

  for (const teamId of league.teamIds) {
    const nextGame = resolveLeagueGame(league, undefined, teamId);
    if (!nextGame) continue;
    const opponentId = opponentTeamId(nextGame, teamId);
    suggestions[teamId] = adaptiveSuggestionForTeam(league, teamId, opponentId, options);
    teamIds.push(teamId);
  }

  return {
    generatedFor: "league",
    teamIds,
    suggestedPlans: Object.fromEntries(Object.entries(suggestions).map(([teamId, suggestion]) => [teamId, suggestion.suggestedPlan])),
    suggestions
  };
}

function planFitFromGamePlan(plan: TeamGamePlanOptions | undefined): CoachPlanFitInput | undefined {
  if (!plan) return undefined;
  const normalized = normalizeGamePlan(plan);
  const priorities: CoachPlanFitInput["priorities"] = [];
  if (normalized.threePointEmphasis >= 2) priorities.push("threes");
  if (normalized.foulPressure >= 2) priorities.push("freeThrows");
  if (normalized.crashBoards >= 2) priorities.push("boards");
  if (normalized.ballSecurity >= 2) priorities.push("ballSecurity");
  if (!priorities.length && normalized.usageConcentration < 0.96) priorities.push("ballSecurity");
  return {
    targetThreeAttemptRate: clamp(0.34 + normalized.threePointEmphasis * 0.015, 0.18, 0.55),
    targetFreeThrowRate: clamp(0.24 + normalized.foulPressure * 0.015, 0.12, 0.42),
    maxTurnovers: Math.round(clamp(14 - normalized.ballSecurity * 0.8 + Math.max(0, normalized.usageConcentration - 1) * 4, 8, 20)),
    minReboundMargin: roundTo(normalized.crashBoards * 0.7, 0),
    priorities
  };
}

function planForCoachGame(league: LeagueState, game: LeagueGame, teamId: string, options: CoachProgressionOptions): TeamGamePlanOptions | undefined {
  return (
    options.plansByGameId?.[game.id]?.[teamId] ??
    options.currentPlans?.[teamId] ??
    league.matchupOptions?.gameplay?.teamPlans?.[teamId] ??
    (teamId === game.awayTeamId ? league.matchupOptions?.gameplay?.away : undefined) ??
    (teamId === game.homeTeamId ? league.matchupOptions?.gameplay?.home : undefined)
  );
}

function averageGamePlan(plans: TeamGamePlanOptions[]): TeamGamePlanOptions {
  if (!plans.length) return neutralGamePlan;
  const normalized = plans.map(normalizeGamePlan);
  const count = normalized.length;
  return {
    usageConcentration: roundTo(normalized.reduce((sum, plan) => sum + plan.usageConcentration, 0) / count, 2),
    playerUsageTargets: {},
    threePointEmphasis: roundTo(normalized.reduce((sum, plan) => sum + plan.threePointEmphasis, 0) / count, 1),
    foulPressure: roundTo(normalized.reduce((sum, plan) => sum + plan.foulPressure, 0) / count, 1),
    crashBoards: roundTo(normalized.reduce((sum, plan) => sum + plan.crashBoards, 0) / count, 1),
    ballSecurity: roundTo(normalized.reduce((sum, plan) => sum + plan.ballSecurity, 0) / count, 1)
  };
}

function dominantPlanStyle(plan: TeamGamePlanOptions): string {
  const normalized = normalizeGamePlan(plan);
  const entries = [
    { label: "Star Gravity", value: (normalized.usageConcentration - 1) * 10 },
    { label: "Hunt Threes", value: normalized.threePointEmphasis },
    { label: "Foul Pressure", value: normalized.foulPressure },
    { label: "Crash Glass", value: normalized.crashBoards },
    { label: "Protect Ball", value: normalized.ballSecurity }
  ].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  return Math.abs(entries[0].value) < 1 ? "Balanced" : entries[0].label;
}

function averageGradeScore(grades: TeamPostgameGrade[]): number {
  return grades.length ? roundTo(grades.reduce((sum, grade) => sum + grade.numericScore, 0) / grades.length, 1) : 0;
}

function averageFactorScore(grades: TeamPostgameGrade[], key: CoachGradeFactor["key"]): number {
  const factors = grades.flatMap((grade) => grade.factors.filter((factor) => factor.key === key));
  return factors.length ? factors.reduce((sum, factor) => sum + factor.score / factor.maxScore, 0) / factors.length : 0;
}

function coachBadge(args: Omit<CoachProgressionBadge, "progress" | "unlocked"> & { current: number; target: number }): CoachProgressionBadge {
  const current = roundTo(args.current, 2);
  const target = roundTo(args.target, 2);
  return {
    id: args.id,
    label: args.label,
    category: args.category,
    tier: args.tier,
    tone: args.tone,
    detail: args.detail,
    evidence: args.evidence,
    progress: { current, target },
    unlocked: current >= target
  };
}

function postseasonSnapshot(league: LeagueState, teamId: string): CoachProgressionProfile["postseason"] {
  let wins = 0;
  let losses = 0;
  let seriesWins = 0;
  let seriesLosses = 0;
  let highestRound = 0;
  let highestRoundName: string | undefined;
  let activeSeriesId: string | undefined;
  let champion = false;

  for (const series of league.playoffs?.series ?? []) {
    if (series.teamAId !== teamId && series.teamBId !== teamId) continue;
    const state = playoffSeriesState(league, series);
    const teamWins = teamId === series.teamAId ? state.winsA : state.winsB;
    const teamLosses = teamId === series.teamAId ? state.winsB : state.winsA;
    wins += teamWins;
    losses += teamLosses;
    if (series.round > highestRound) {
      highestRound = series.round;
      highestRoundName = series.roundName;
    }
    if (state.status === "complete") {
      if (state.winnerTeamId === teamId) {
        seriesWins += 1;
        if (series.round === 4) champion = true;
      } else {
        seriesLosses += 1;
      }
    } else {
      activeSeriesId = series.id;
    }
  }

  return { wins, losses, seriesWins, seriesLosses, highestRound, highestRoundName, champion, activeSeriesId };
}

export function deriveCoachProgressionProfile(league: LeagueState, teamId: string, options: CoachProgressionOptions = {}): CoachProgressionProfile {
  const teamGames = teamScheduleGames(league, teamId).filter((game) => game.result);
  const record = teamRecordFromGames(teamGames, teamId);
  const plans = teamGames.map((game) => planForCoachGame(league, game, teamId, options)).filter((plan): plan is TeamGamePlanOptions => Boolean(plan));
  const grades =
    options.grades?.filter((grade) => grade.teamId === teamId) ??
    teamGames
      .filter((game): game is LeagueGame & { result: GameResult } => Boolean(game.result))
      .map((game) => gradeTeamPostgame(game.result, teamId, planFitFromGamePlan(planForCoachGame(league, game, teamId, options))));
  const gradeAverage = averageGradeScore(grades);
  const recentGrades = grades.slice(-3);
  const priorGrades = grades.slice(0, Math.max(0, grades.length - recentGrades.length));
  const gradeTrend = roundTo(averageGradeScore(recentGrades) - averageGradeScore(priorGrades), 1);
  const avgPlan = averageGamePlan(plans);
  const postseason = postseasonSnapshot(league, teamId);
  const responseWins = teamGames.reduce((count, game, index) => {
    if (!game.result || index === 0) return count;
    const previous = teamGames[index - 1];
    return previous.result && resultOutcome(previous.result, teamId) === "loss" && resultOutcome(game.result, teamId) === "win" ? count + 1 : count;
  }, 0);
  const badges: CoachProgressionBadge[] = [
    coachBadge({
      id: `${teamId}-bench-foundation`,
      label: "Bench Foundation",
      category: "identity",
      tier: "bronze",
      tone: "positive",
      detail: "Log a first coached result.",
      evidence: [`${record.games} completed game${record.games === 1 ? "" : "s"}`],
      current: record.games,
      target: 1
    }),
    coachBadge({
      id: `${teamId}-winning-habits`,
      label: "Winning Habits",
      category: "execution",
      tier: "silver",
      tone: record.wins >= 5 ? "positive" : "neutral",
      detail: "Stack five wins with this team.",
      evidence: [`${record.wins}-${record.losses}${record.ties ? `-${record.ties}` : ""} record`],
      current: record.wins,
      target: 5
    }),
    coachBadge({
      id: `${teamId}-grade-standard`,
      label: "B+ Standard",
      category: "execution",
      tier: "silver",
      tone: gradeAverage >= 87 ? "positive" : "neutral",
      detail: "Maintain a B+ average coach grade.",
      evidence: [`${gradeAverage || 0} average grade across ${grades.length} graded games`],
      current: gradeAverage,
      target: 87
    }),
    coachBadge({
      id: `${teamId}-response-coach`,
      label: "Response Coach",
      category: "resilience",
      tier: "silver",
      tone: responseWins >= 2 ? "positive" : "neutral",
      detail: "Win two games directly after losses.",
      evidence: [`${responseWins} response win${responseWins === 1 ? "" : "s"}`],
      current: responseWins,
      target: 2
    }),
    coachBadge({
      id: `${teamId}-arc-architect`,
      label: "Arc Architect",
      category: "tactics",
      tier: "bronze",
      tone: "neutral",
      detail: "Pair a three-point plan with strong execution.",
      evidence: [`${roundTo(normalizeGamePlan(avgPlan).threePointEmphasis, 1)} average 3P emphasis`, `${pct(averageFactorScore(grades, "threes"), 0)} three-point factor`],
      current: normalizeGamePlan(avgPlan).threePointEmphasis >= 2 && averageFactorScore(grades, "threes") >= 0.68 ? 1 : 0,
      target: 1
    }),
    coachBadge({
      id: `${teamId}-glass-worker`,
      label: "Glass Worker",
      category: "tactics",
      tier: "bronze",
      tone: "neutral",
      detail: "Commit to offensive boards without losing the game state.",
      evidence: [`${roundTo(normalizeGamePlan(avgPlan).crashBoards, 1)} average crash boards`, `${pct(averageFactorScore(grades, "rebounding"), 0)} rebounding factor`],
      current: normalizeGamePlan(avgPlan).crashBoards >= 2 && averageFactorScore(grades, "rebounding") >= 0.68 ? 1 : 0,
      target: 1
    }),
    coachBadge({
      id: `${teamId}-security-coach`,
      label: "Security Coach",
      category: "tactics",
      tier: "bronze",
      tone: "neutral",
      detail: "Make ball security a repeatable identity.",
      evidence: [`${roundTo(normalizeGamePlan(avgPlan).ballSecurity, 1)} average ball security`, `${pct(averageFactorScore(grades, "turnovers"), 0)} turnover factor`],
      current: normalizeGamePlan(avgPlan).ballSecurity >= 2 && averageFactorScore(grades, "turnovers") >= 0.68 ? 1 : 0,
      target: 1
    }),
    coachBadge({
      id: `${teamId}-playoff-tested`,
      label: "Playoff Tested",
      category: "postseason",
      tier: "gold",
      tone: postseason.wins > 0 ? "positive" : "neutral",
      detail: "Win a postseason game.",
      evidence: [`${postseason.wins}-${postseason.losses} postseason record`],
      current: postseason.wins,
      target: 1
    }),
    coachBadge({
      id: `${teamId}-series-closer`,
      label: "Series Closer",
      category: "postseason",
      tier: "gold",
      tone: postseason.seriesWins > 0 ? "positive" : "neutral",
      detail: "Close a playoff series.",
      evidence: [`${postseason.seriesWins} series win${postseason.seriesWins === 1 ? "" : "s"}`],
      current: postseason.seriesWins,
      target: 1
    }),
    coachBadge({
      id: `${teamId}-champion`,
      label: "Champion Coach",
      category: "postseason",
      tier: "platinum",
      tone: postseason.champion ? "positive" : "neutral",
      detail: "Win the league title.",
      evidence: [postseason.champion ? "League champion" : "Title not yet secured"],
      current: postseason.champion ? 1 : 0,
      target: 1
    })
  ];
  const unlockedBadges = badges.filter((badge) => badge.unlocked);
  const lockedBadges = badges.filter((badge) => !badge.unlocked);
  const tierXp: Record<AchievementTier, number> = { bronze: 35, silver: 60, gold: 100, platinum: 160 };
  const xp = roundTo(record.wins * 20 + record.ties * 8 + gradeAverage * Math.max(1, grades.length) * 0.25 + unlockedBadges.reduce((sum, badge) => sum + tierXp[badge.tier], 0), 0);
  const level = Math.max(1, Math.floor(xp / 120) + 1);
  const winPct = record.games ? (record.wins + record.ties * 0.5) / record.games : 0;

  return {
    teamId,
    teamName: lookupTeamName(teamId, options.teamNames),
    level,
    xp,
    gradeAverage,
    gradeTrend,
    summary: `${dominantPlanStyle(avgPlan)} profile, ${record.wins}-${record.losses}${record.ties ? `-${record.ties}` : ""} record, ${unlockedBadges.length} badges unlocked.`,
    record: {
      ...record,
      winPct: roundTo(winPct, 3)
    },
    postseason,
    planProfile: {
      dominantStyle: dominantPlanStyle(avgPlan),
      gamesTracked: plans.length,
      averagePlan: avgPlan
    },
    badges,
    unlockedBadges,
    lockedBadges
  };
}

export function deriveLeagueCoachProgressionProfiles(league: LeagueState, options: CoachProgressionOptions = {}): CoachProgressionProfile[] {
  return league.teamIds.map((teamId) => deriveCoachProgressionProfile(league, teamId, options));
}

function recordLabel(wins: number, losses: number, ties = 0): string {
  return `${wins}-${losses}${ties ? `-${ties}` : ""}`;
}

function powerRankingTrend(winPct: number, recentWinPct: number, streak: number): PowerRankingTrend {
  const diff = recentWinPct - winPct;
  if (streak >= 4 || diff >= 0.28) return "surging";
  if (streak >= 2 || diff >= 0.12) return "rising";
  if (streak <= -4 || diff <= -0.28) return "reeling";
  if (streak <= -2 || diff <= -0.12) return "sliding";
  return "steady";
}

export function buildLeaguePowerRankings(league: LeagueState, options: LeagueWorldSimulationOptions = {}): LeaguePowerRankingRow[] {
  const maxItems = options.maxPowerRankings ?? league.teamIds.length;
  const rows = standings(league);
  const postseasonWins = new Map<string, number>();
  for (const series of league.playoffs?.series ?? []) {
    const state = playoffSeriesState(league, series);
    postseasonWins.set(series.teamAId, (postseasonWins.get(series.teamAId) ?? 0) + state.winsA);
    postseasonWins.set(series.teamBId, (postseasonWins.get(series.teamBId) ?? 0) + state.winsB);
  }

  return rows
    .map((row) => {
      const recentGames = recentTeamGames(league, row.teamId, 5);
      const recentRecord = teamRecordFromGames(recentGames, row.teamId);
      const recentWinPct = recentRecord.games ? (recentRecord.wins + recentRecord.ties * 0.5) / recentRecord.games : row.winPct;
      const differentialPerGame = row.played ? row.differential / row.played : 0;
      const streak = teamStreak(league, row.teamId);
      const trend = powerRankingTrend(row.winPct, recentWinPct, streak);
      const rating = roundTo(row.winPct * 70 + recentWinPct * 18 + differentialPerGame * 1.25 + streak * 1.8 + (postseasonWins.get(row.teamId) ?? 0) * 4, 1);
      const tags = [
        trend === "surging" || trend === "rising" ? "Form team" : "",
        differentialPerGame >= 6 ? "Point diff monster" : "",
        (postseasonWins.get(row.teamId) ?? 0) > 0 ? "Postseason proven" : "",
        streak <= -3 ? "Needs response" : ""
      ].filter(Boolean);
      return {
        rank: 0,
        teamId: row.teamId,
        teamName: lookupTeamName(row.teamId, options.teamNames),
        rating,
        recordLabel: recordLabel(row.wins, row.losses, row.ties),
        winPct: roundTo(row.winPct, 3),
        differentialPerGame: roundTo(differentialPerGame, 1),
        recentForm: recordLabel(recentRecord.wins, recentRecord.losses, recentRecord.ties),
        trend,
        tags
      };
    })
    .sort((a, b) => b.rating - a.rating || a.teamName.localeCompare(b.teamName))
    .map((row, index) => ({ ...row, rank: index + 1 }))
    .slice(0, maxItems);
}

function fanPressureLevel(score: number): FanPressureLevel {
  if (score >= 78) return "crisis";
  if (score >= 60) return "hot-seat";
  if (score >= 42) return "elevated";
  if (score >= 22) return "normal";
  return "low";
}

export function buildLeagueFanPressure(league: LeagueState, options: LeagueWorldSimulationOptions = {}): FanPressureItem[] {
  const maxItems = options.maxFanPressureItems ?? 6;
  const rows = standings(league);
  const rankMap = new Map(rows.map((row, index) => [row.teamId, index + 1]));
  const teamCount = Math.max(1, rows.length);
  const items = rows.map((row) => {
    const rank = rankMap.get(row.teamId) ?? teamCount;
    const lossPct = row.played ? row.losses / row.played : 0;
    const differentialPerGame = row.played ? row.differential / row.played : 0;
    const streak = teamStreak(league, row.teamId);
    const postseason = postseasonSnapshot(league, row.teamId);
    const drivers: string[] = [];
    let score = lossPct * 38 + Math.max(0, -differentialPerGame) * 2.2 + Math.max(0, -streak) * 9;
    if (rank > teamCount * 0.66) {
      score += 12;
      drivers.push(`Rank ${rank} of ${teamCount}`);
    }
    if (differentialPerGame < -4) drivers.push(`${signed(differentialPerGame)} differential per game`);
    if (streak <= -2) drivers.push(`${Math.abs(streak)} game skid`);
    if (postseason.activeSeriesId && postseason.losses > postseason.wins) {
      score += 18;
      drivers.push("Trailing in active postseason series");
    }
    if (!drivers.length) drivers.push(row.played ? "Expectations stable" : "No results yet");
    const pressureScore = roundTo(clamp(score, 0, 100), 0);
    const level = fanPressureLevel(pressureScore);
    return {
      teamId: row.teamId,
      teamName: lookupTeamName(row.teamId, options.teamNames),
      pressureScore,
      level,
      headline:
        level === "crisis"
          ? `${lookupTeamName(row.teamId, options.teamNames)} faces crisis noise`
          : level === "hot-seat"
            ? `${lookupTeamName(row.teamId, options.teamNames)} pressure is rising`
            : `${lookupTeamName(row.teamId, options.teamNames)} pressure check`,
      detail: `${recordLabel(row.wins, row.losses, row.ties)} record, ${signed(differentialPerGame)} differential per game.`,
      drivers,
      tone: level === "crisis" || level === "hot-seat" ? "negative" : level === "elevated" ? "warning" : "neutral"
    } satisfies FanPressureItem;
  });

  return items.sort((a, b) => b.pressureScore - a.pressureScore || a.teamName.localeCompare(b.teamName)).slice(0, maxItems);
}

function rivalryHeatLevel(score: number): RivalryHeatLevel {
  if (score >= 78) return "classic";
  if (score >= 55) return "volatile";
  if (score >= 32) return "heated";
  return "warm";
}

export function buildLeagueRivalryHeat(league: LeagueState, options: LeagueWorldSimulationOptions = {}): RivalryHeatItem[] {
  const maxItems = options.maxRivalries ?? 6;
  const pairs = new Map<string, LeagueGame[]>();
  for (const game of league.games) {
    const key = teamPairKey(game.awayTeamId, game.homeTeamId);
    pairs.set(key, [...(pairs.get(key) ?? []), game]);
  }

  return Array.from(pairs.entries())
    .map(([pairKey, games]) => {
      const sorted = games.sort(compareGames);
      const first = sorted[0];
      const teamIds: [string, string] = [first.awayTeamId, first.homeTeamId].sort() as [string, string];
      const completed = sorted.filter((game) => game.result);
      const next = sorted.find((game) => game.status === "unplayed");
      const closeGames = completed.filter((game) => game.result && Math.abs(game.result.awayScore - game.result.homeScore) <= 6).length;
      const playoffGames = sorted.filter((game) => game.stage === "playoffs").length;
      const records = teamIds.map((teamId) => teamRecordFromGames(completed, teamId));
      const splitSeries = records[0].wins > 0 && records[1].wins > 0;
      const heatScore = roundTo(clamp(completed.length * 10 + closeGames * 9 + playoffGames * 18 + (splitSeries ? 12 : 0) + (next ? 10 : 0), 0, 100), 0);
      const level = rivalryHeatLevel(heatScore);
      return {
        pairKey,
        teamIds,
        labels: [lookupTeamName(teamIds[0], options.teamNames), lookupTeamName(teamIds[1], options.teamNames)] as [string, string],
        heatScore,
        level,
        meetings: sorted.length,
        completedMeetings: completed.length,
        nextGameId: next?.id,
        lastGameId: completed.at(-1)?.id,
        detail: `${completed.length} completed meeting${completed.length === 1 ? "" : "s"}, ${closeGames} close finish${closeGames === 1 ? "" : "es"}${playoffGames ? `, ${playoffGames} playoff game${playoffGames === 1 ? "" : "s"}` : ""}.`,
        tone: level === "classic" || level === "volatile" ? "warning" : "neutral"
      } satisfies RivalryHeatItem;
    })
    .filter((item) => item.completedMeetings > 0 || item.nextGameId)
    .sort((a, b) => b.heatScore - a.heatScore || a.pairKey.localeCompare(b.pairKey))
    .slice(0, maxItems);
}

export function buildWeeklyMediaNarratives(league: LeagueState, options: LeagueWorldSimulationOptions = {}): WorldMediaNarrativeItem[] {
  const maxItems = options.maxNarratives ?? 8;
  const narratives: WorldMediaNarrativeItem[] = [];
  const power = buildLeaguePowerRankings(league, { ...options, maxPowerRankings: 3 });
  const pressure = buildLeagueFanPressure(league, { ...options, maxFanPressureItems: 2 });
  const rivalries = buildLeagueRivalryHeat(league, { ...options, maxRivalries: 2 });
  const newspaper = buildLeagueNewspaper(league, { ...options, maxItems: options.maxItems ?? 4 });

  for (const row of power.slice(0, 2)) {
    narratives.push({
      id: `power-${row.teamId}`,
      type: "power-ranking",
      headline: `${row.teamName} sits #${row.rank} in the power table`,
      detail: `${row.recordLabel}, ${row.trend}, ${signed(row.differentialPerGame)} differential per game.`,
      teamIds: [row.teamId],
      priority: 84 - row.rank,
      tone: row.trend === "surging" || row.trend === "rising" ? "positive" : row.trend === "reeling" || row.trend === "sliding" ? "warning" : "neutral"
    });
  }

  for (const item of pressure) {
    if (item.level === "low" || item.level === "normal") continue;
    narratives.push({
      id: `pressure-${item.teamId}`,
      type: "fan-pressure",
      headline: item.headline,
      detail: `${item.detail} Drivers: ${item.drivers.slice(0, 2).join("; ")}.`,
      teamIds: [item.teamId],
      priority: 76 + item.pressureScore / 10,
      tone: item.tone
    });
  }

  for (const item of rivalries) {
    narratives.push({
      id: `rivalry-heat-${item.pairKey}`,
      type: "rivalry",
      headline: `${item.labels[0]}-${item.labels[1]} heat check`,
      detail: item.nextGameId ? `${item.detail} Next meeting is on the board.` : item.detail,
      teamIds: item.teamIds,
      gameId: item.nextGameId ?? item.lastGameId,
      priority: 70 + item.heatScore / 10,
      tone: item.tone
    });
  }

  for (const item of newspaper) {
    narratives.push({
      id: `news-${item.id}`,
      type: item.section === "playoffs" ? "playoffs" : "weekly",
      headline: item.headline,
      detail: item.detail,
      teamIds: item.teamIds,
      gameId: item.gameId,
      priority: item.priority,
      tone: item.tone
    });
  }

  return narratives
    .filter((item, index, array) => array.findIndex((row) => row.id === item.id) === index)
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
    .slice(0, maxItems);
}

export function buildLeagueWorldSimulation(league: LeagueState, options: LeagueWorldSimulationOptions = {}): LeagueWorldSimulationReport {
  return {
    generatedAt: options.currentDate ?? league.currentDate ?? league.updatedAt,
    powerRankings: buildLeaguePowerRankings(league, options),
    fanPressure: buildLeagueFanPressure(league, options),
    rivalryHeat: buildLeagueRivalryHeat(league, options),
    narratives: buildWeeklyMediaNarratives(league, options),
    newspaper: buildLeagueNewspaper(league, options)
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function htmlList(items: string[]): string {
  return items.length ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "<p>No items yet.</p>";
}

export function buildLeagueShareHtml(league: LeagueState, options: ShareableLeagueReportOptions = {}): string {
  const teamNames = options.teamNames;
  const title = options.title ?? league.name;
  const maxStandingsRows = options.maxStandingsRows ?? 8;
  const maxNewsItems = options.maxNewsItems ?? 6;
  const rows = standings(league).slice(0, maxStandingsRows);
  const news = buildLeagueNewspaper(league, { teamNames, maxItems: maxNewsItems });
  const playerLeader = leaderPlayerRows(league).sort((a, b) => (b.perGame.PTS ?? 0) - (a.perGame.PTS ?? 0))[0];
  const completedCount = league.games.filter((game) => game.result).length;
  const totalCount = league.games.length;
  const achievements = deriveLeagueAchievements(league, [], { teamNames }).slice(-4);
  const styles = options.includeStyles === false ? "" : `<style>
body{font-family:Inter,Arial,sans-serif;margin:24px;color:#151515;background:#fff}
.league-report{max-width:840px;margin:0 auto}
h1{font-size:28px;margin:0 0 4px}
h2{font-size:16px;margin:22px 0 8px}
.meta{color:#666;margin:0 0 18px}
table{width:100%;border-collapse:collapse}
th,td{border-bottom:1px solid #ddd;padding:6px 4px;text-align:left}
th:last-child,td:last-child{text-align:right}
li{margin:6px 0}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
@media(max-width:700px){.grid{grid-template-columns:1fr}}
</style>`;
  const standingsRows = rows
    .map(
      (row, index) =>
        `<tr><td>${index + 1}</td><td>${escapeHtml(lookupTeamName(row.teamId, teamNames))}</td><td>${row.wins}-${row.losses}${row.ties ? `-${row.ties}` : ""}</td><td>${pct(row.winPct, 1)}</td><td>${signed(row.differential, 0)}</td></tr>`
    )
    .join("");
  const newsItems = news.map((item) => `${item.headline} - ${item.detail}`);
  const achievementItems = achievements.map((item) => `${item.title}: ${item.detail}`);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
${styles}
</head>
<body>
<main class="league-report">
<h1>${escapeHtml(title)}</h1>
<p class="meta">${completedCount} of ${totalCount} games completed${league.currentDate ? ` through ${escapeHtml(league.currentDate)}` : ""}</p>
<section>
<h2>Standings</h2>
<table><thead><tr><th>#</th><th>Team</th><th>Record</th><th>Win%</th><th>Diff</th></tr></thead><tbody>${standingsRows}</tbody></table>
</section>
<div class="grid">
<section>
<h2>Headlines</h2>
${htmlList(newsItems)}
</section>
<section>
<h2>League Leaders</h2>
${htmlList(playerLeader ? [`Scoring: ${playerLeader.player}, ${roundTo(playerLeader.perGame.PTS ?? 0, 1)} PPG (${lookupTeamName(playerLeader.teamId, teamNames)})`] : [])}
</section>
</div>
<section>
<h2>Achievements</h2>
${htmlList(achievementItems)}
</section>
</main>
</body>
</html>`;
}
