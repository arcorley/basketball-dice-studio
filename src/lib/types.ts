export type StatLine = Record<string, number>;

export type SourceCellNumber = number | null;
export type ShotZone = "rim" | "shortMid" | "longMid" | "three";
export type TurnoverProfileSource = "play-by-play" | "aggregate";
export type ShotLocationProfileMethod = "sourced-location" | "same-player-neighbor-proxy" | "era-role-neighbor-proxy" | "manual-audit";
export type SimVenue = "home-court" | "neutral";
export type SimIntensity = "regular" | "playoff";

export interface MatchupOptions {
  venue: SimVenue;
  intensity: SimIntensity;
}

export interface MatchupContext {
  label: string;
  venue: SimVenue;
  intensity: SimIntensity;
  homeCourtAdvantagePoints: number;
  awayShotContextAdjustment: number;
  homeShotContextAdjustment: number;
  paceMultiplier: number;
  useWeightMode: "regular" | "playoff-tightened";
}

export interface SourceShotLocationProfile {
  method: ShotLocationProfileMethod;
  modelVersion: string;
  confidence: number;
  sourceRefs: string[];
  sourcePlayerSeasons: string[];
  neighborCount: number;
  sourceFga: number;
  qualityWarnings: string[];
  pctFga00_03: SourceCellNumber;
  pctFga03_10: SourceCellNumber;
  pctFga10_16: SourceCellNumber;
  pctFga16_xx: SourceCellNumber;
  pctFga3p: SourceCellNumber;
  fgPct00_03: SourceCellNumber;
  fgPct03_10: SourceCellNumber;
  fgPct10_16: SourceCellNumber;
  fgPct16_xx: SourceCellNumber;
  fgPct3p: SourceCellNumber;
}

export interface SourcePlayer {
  sourceId?: string;
  sourceUrl?: string;
  name: string;
  position: string;
  age: SourceCellNumber;
  games: SourceCellNumber;
  gamesStarted: SourceCellNumber;
  minutes: SourceCellNumber;
  perGame: {
    mp: SourceCellNumber;
    pts: SourceCellNumber;
    trb: SourceCellNumber;
    ast: SourceCellNumber;
    stl: SourceCellNumber;
    blk: SourceCellNumber;
    tov: SourceCellNumber;
    pf: SourceCellNumber;
    fga: SourceCellNumber;
    fg3a: SourceCellNumber;
    fta: SourceCellNumber;
  };
  totals: {
    fg: SourceCellNumber;
    fga: SourceCellNumber;
    fgPct: SourceCellNumber;
    fg3: SourceCellNumber;
    fg3a: SourceCellNumber;
    fg3Pct: SourceCellNumber;
    fg2: SourceCellNumber;
    fg2a: SourceCellNumber;
    fg2Pct: SourceCellNumber;
    ft: SourceCellNumber;
    fta: SourceCellNumber;
    ftPct: SourceCellNumber;
    orb: SourceCellNumber;
    drb: SourceCellNumber;
    trb: SourceCellNumber;
    ast: SourceCellNumber;
    stl: SourceCellNumber;
    blk: SourceCellNumber;
    tov: SourceCellNumber;
    pf: SourceCellNumber;
    pts: SourceCellNumber;
  };
  per100: {
    fga: SourceCellNumber;
    fg3a: SourceCellNumber;
    fta: SourceCellNumber;
    orb: SourceCellNumber;
    drb: SourceCellNumber;
    trb: SourceCellNumber;
    ast: SourceCellNumber;
    stl: SourceCellNumber;
    blk: SourceCellNumber;
    tov: SourceCellNumber;
    pf: SourceCellNumber;
    pts: SourceCellNumber;
    offRtg: SourceCellNumber;
    defRtg: SourceCellNumber;
  };
  advanced: {
    usagePct: SourceCellNumber;
    tsPct: SourceCellNumber;
    threeAttemptRate: SourceCellNumber;
    freeThrowRate: SourceCellNumber;
    orbPct: SourceCellNumber;
    drbPct: SourceCellNumber;
    trbPct: SourceCellNumber;
    astPct: SourceCellNumber;
    stlPct: SourceCellNumber;
    blkPct: SourceCellNumber;
    tovPct: SourceCellNumber;
    ows: SourceCellNumber;
    dws: SourceCellNumber;
    ws: SourceCellNumber;
    obpm: SourceCellNumber;
    dbpm: SourceCellNumber;
    bpm: SourceCellNumber;
  };
  shooting: {
    avgDistance: SourceCellNumber;
    pctFga2p: SourceCellNumber;
    pctFga00_03: SourceCellNumber;
    pctFga03_10: SourceCellNumber;
    pctFga10_16: SourceCellNumber;
    pctFga16_xx: SourceCellNumber;
    pctFga3p: SourceCellNumber;
    fgPct2p: SourceCellNumber;
    fgPct00_03: SourceCellNumber;
    fgPct03_10: SourceCellNumber;
    fgPct10_16: SourceCellNumber;
    fgPct16_xx: SourceCellNumber;
    fgPct3p: SourceCellNumber;
    pctAst2p: SourceCellNumber;
    pctAst3p: SourceCellNumber;
    pctFgaDunk: SourceCellNumber;
    fgDunk: SourceCellNumber;
    pctCorner3: SourceCellNumber;
    corner3Pct: SourceCellNumber;
  };
  shotLocationProfile: SourceShotLocationProfile | null;
  playByPlay: {
    plusMinusOn: SourceCellNumber;
    plusMinusNet: SourceCellNumber;
    badPassTurnovers: SourceCellNumber;
    lostBallTurnovers: SourceCellNumber;
    shootingFouls: SourceCellNumber;
    offensiveFouls: SourceCellNumber;
    drawnShooting: SourceCellNumber;
    drawnOffensive: SourceCellNumber;
    assistedPoints: SourceCellNumber;
    andOnes: SourceCellNumber;
    ownShotsBlocked: SourceCellNumber;
  };
  postseason?: SourcePlayerPostseasonProfile | null;
  roster: {
    number: string;
    height: string;
    weight: SourceCellNumber;
    birthDate: string;
    college: string;
  };
}

export interface SourcePlayerPostseasonProfile {
  games: SourceCellNumber;
  gamesStarted: SourceCellNumber;
  minutes: SourceCellNumber;
  perGame: SourcePlayer["perGame"];
  totals: SourcePlayer["totals"];
  per100: SourcePlayer["per100"];
  advanced: SourcePlayer["advanced"];
  shooting: SourcePlayer["shooting"];
  playByPlay: SourcePlayer["playByPlay"];
}

export interface SourceTeam {
  id: string;
  name: string;
  shortName: string;
  franchise: string;
  abbr: string;
  season: string;
  seasonEndYear: number;
  source: {
    provider: string;
    url: string;
    fetchedAt: string;
    pageTitle: string;
    h1: string;
    tableIds: string[];
  };
  team: {
    wins: SourceCellNumber;
    losses: SourceCellNumber;
    pace: SourceCellNumber;
    offensiveRating: SourceCellNumber;
    defensiveRating: SourceCellNumber;
    expectedWins: SourceCellNumber;
    expectedLosses: SourceCellNumber;
    simpleRating: SourceCellNumber;
    strengthOfSchedule: SourceCellNumber;
    marginOfVictory: SourceCellNumber;
    efgPct: SourceCellNumber;
    turnoverPct: SourceCellNumber;
    offensiveReboundPct: SourceCellNumber;
    freeThrowAttemptRate: SourceCellNumber;
    freeThrowRate: SourceCellNumber;
    opponentEfgPct: SourceCellNumber;
    opponentTurnoverPct: SourceCellNumber;
    defensiveReboundPct: SourceCellNumber;
    opponentFreeThrowAttemptRate: SourceCellNumber;
    opponentFreeThrowRate: SourceCellNumber;
    threeAttemptRate: SourceCellNumber;
    totals: Record<string, SourceCellNumber>;
    opponentTotals: Record<string, SourceCellNumber>;
  };
  players: SourcePlayer[];
  rawTableSummary: Array<{
    id: string;
    caption: string;
    rows: number;
    headers: string[];
  }>;
}

export interface SourceLeagueTeam {
  name: string;
  wins: SourceCellNumber;
  losses: SourceCellNumber;
  pace: SourceCellNumber;
  offensiveRating: SourceCellNumber;
  defensiveRating: SourceCellNumber;
  netRating: SourceCellNumber;
  simpleRating: SourceCellNumber;
  marginOfVictory: SourceCellNumber;
  efgPct: SourceCellNumber;
  turnoverPct: SourceCellNumber;
  offensiveReboundPct: SourceCellNumber;
  freeThrowRate: SourceCellNumber;
  freeThrowAttemptRate: SourceCellNumber;
  opponentEfgPct: SourceCellNumber;
  opponentTurnoverPct: SourceCellNumber;
  defensiveReboundPct: SourceCellNumber;
  opponentFreeThrowAttemptRate: SourceCellNumber;
  opponentFreeThrowRate: SourceCellNumber;
  threeAttemptRate: SourceCellNumber;
  fg2Pct: SourceCellNumber;
  fg3Pct: SourceCellNumber;
  ftPct: SourceCellNumber;
}

export interface SourceLeagueDistribution {
  mean: number;
  stdev: number;
  min: number;
  max: number;
}

export interface SourceLeagueStrength {
  teamCount: number;
  qualifiedPlayerCount: number;
  qualifiedPlayersPerTeam: number;
  effectiveRotationDepth: number;
  depthZ: number;
  qualifiedPlayersPerTeamZ: number;
  teamCountZ: number;
  leagueStrengthZ: number;
  talentPointsPer100: number;
  modelVersion: string;
}

export interface SourceLeague {
  season: string;
  seasonEndYear: number;
  source: {
    provider: string;
    url: string;
    fetchedAt: string;
    pageTitle: string;
    h1: string;
    tableIds: string[];
  };
  averages: {
    pace: number;
    offensiveRating: number;
    defensiveRating: number;
    simpleRating: number;
    marginOfVictory: number;
    efgPct: number;
    turnoverPct: number;
    offensiveReboundPct: number;
    freeThrowRate: number;
    freeThrowAttemptRate: number;
    opponentEfgPct: number;
    opponentTurnoverPct: number;
    defensiveReboundPct: number;
    opponentFreeThrowAttemptRate: number;
    opponentFreeThrowRate: number;
    threeAttemptRate: number;
    fg2Pct: number;
    fg3Pct: number;
    ftPct: number;
  };
  distributions: Record<string, SourceLeagueDistribution>;
  playerDistributions: Record<string, SourceLeagueDistribution>;
  strength: SourceLeagueStrength;
  qualifiedPlayerCount: number;
  teams: SourceLeagueTeam[];
}

export interface GeneratedSourceData {
  generatedAt: string;
  manifestVersion: string;
  sourceProvider: string;
  teams: SourceTeam[];
  leagues: SourceLeague[];
}

export interface SourceTeamCatalogEntry {
  id: string;
  name: string;
  shortName: string;
  franchise: string;
  abbr: string;
  season: string;
  seasonEndYear: number;
  team: {
    wins: SourceCellNumber;
    losses: SourceCellNumber;
  };
}

export interface SourceCatalog {
  generatedAt: string;
  manifestVersion: string;
  sourceProvider: string;
  teams: SourceTeamCatalogEntry[];
  leagues: SourceLeague[];
}

export interface DicePlayerCard {
  id: string;
  teamId: string;
  name: string;
  position: string;
  minutes: number;
  useWeight: number;
  playoffUseWeight: number;
  playoffWeightSource: "postseason" | "healthy-regular";
  postseasonGames: number | null;
  availabilityFactor: number;
  tov: number;
  fd: number;
  threeFrequency: number;
  p2: number;
  p3: number;
  ft: number;
  andOneChance: number;
  turnoverProfile: TurnoverProfileSource;
  liveBallTurnoverChance: number;
  offensiveFoulTurnoverChance: number;
  astWeight: number;
  orbWeight: number;
  drbWeight: number;
  stlWeight: number;
  blkWeight: number;
  pfWeight: number;
  shootingFoulWeight: number;
  playoffAstWeight: number;
  playoffOrbWeight: number;
  playoffDrbWeight: number;
  playoffStlWeight: number;
  playoffBlkWeight: number;
  playoffPfWeight: number;
  playoffShootingFoulWeight: number;
  calibration: {
    offensiveImpact: number;
    defensiveImpact: number;
    rawThreeRate: number;
    translatedThreeRate: number;
    rawFreeThrowAttemptRate: number;
    translatedFreeThrowAttemptRate: number;
    rawTwoPointPct: number;
    translatedTwoPointPct: number;
    rawThreePointPct: number | null;
    translatedThreePointPct: number;
    rawFreeThrowPct: number | null;
    translatedFreeThrowPct: number;
  };
  source: SourcePlayer;
}

export interface DiceTeamCard {
  id: string;
  name: string;
  shortName: string;
  abbr: string;
  season: string;
  pace: number;
  offensiveRating: number;
  defensiveRating: number;
  shotQuality: number;
  defense: number;
  toPress: number;
  toProtect: number;
  foulDraw: number;
  foulDiscipline: number;
  threeTendency: number;
  orb: number;
  drb: number;
  assistMade2: number;
  assistMade3: number;
  players: DicePlayerCard[];
  calibration: {
    leagueSeason: string;
    leagueAverages: SourceLeague["averages"];
    leagueStrength: SourceLeagueStrength;
    playerOffenseSignal: number;
    playerDefenseSignal: number;
    teamOffenseSignal: number;
    teamDefenseSignal: number;
  };
  source: SourceTeam;
}

export interface RangeRow {
  label: string;
  range: string;
  weight: number;
}

export interface PlayerRangeRow {
  player: string;
  use: string;
  tov: string;
  foul: string;
  shot: string;
  shotProfile: "location" | "two-three";
  shotProfileMethod: ShotLocationProfileMethod;
  shotProfileConfidence: number;
  turnoverProfile: TurnoverProfileSource;
  liveBallTurnover: string;
  offensiveFoulTurnover: string;
  rim: string;
  shortMid: string;
  longMid: string;
  three: string;
  rimMake: string;
  shortMidMake: string;
  longMidMake: string;
  p2: string;
  p3: string;
  ft: string;
  andOne: string;
  raw: {
    tov: number;
    fd: number;
    liveBallTurnover: number;
    offensiveFoulTurnover: number;
    shotZones: Record<ShotZone, number>;
    shotMakes: Record<ShotZone, number>;
    three: number;
    p2: number;
    p3: number;
    ft: number;
    andOne: number;
  };
}

export interface MatchupCard {
  away: DiceTeamCard;
  home: DiceTeamCard;
  options: MatchupOptions;
  context: MatchupContext;
  possessionsEach: number;
  quarters: [number, number, number, number];
  overtimePossessionsEach: number;
  looseFoulRange: string;
  stealOnTurnoverRange: string;
  awayStatic: TeamMatchupStatic;
  homeStatic: TeamMatchupStatic;
  awayPlayerRanges: PlayerRangeRow[];
  homePlayerRanges: PlayerRangeRow[];
  assignments: Record<string, Record<AssignmentEvent, RangeRow[]>>;
}

export type AssignmentEvent = "Use" | "AST" | "OREB" | "DREB" | "STL" | "BLK" | "PF" | "ShootingPF";

export interface TeamMatchupStatic {
  offense: string;
  defense: string;
  orbChance: number;
  orbByShotZone: Record<ShotZone, number>;
  blockChance: number;
  astMade2: number;
  astMade3: number;
  turnoverTargetChance: number;
  foulDrawTargetChance: number;
  threeAttemptTargetChance: number;
  turnoverScale: number;
  foulDrawScale: number;
  threeAttemptScale: number;
  foulEndsPossessionChance: number;
  defenseShotAdjustment: number;
  contextShotAdjustment: number;
  playoffLeverageShotAdjustment: number;
  eraTalentAdjustment: {
    talentDelta: number;
    shotMakeAdjustment: number;
    turnoverAdjustment: number;
    reboundAdjustment: number;
  };
  totalShotAdjustment: number;
  ranges: {
    orb: string;
    orbRim: string;
    orbShortMid: string;
    orbLongMid: string;
    orbThree: string;
    block: string;
    ast2: string;
    ast3: string;
    foulEndsPossession: string;
  };
}

export interface GameResult {
  id: string;
  awayTeamId: string;
  homeTeamId: string;
  awayScore: number;
  homeScore: number;
  winnerTeamId: string | "tie";
  possessionsEach: number;
  quarters: Array<{ away: number; home: number }>;
  teamStats: Record<string, StatLine>;
  playerStats: Record<string, Record<string, StatLine>>;
  source: "simulated" | "manual";
  playedAt: string;
}

export interface RollTraceStep {
  label: string;
  roll?: number;
  target?: number;
  result: string;
  detail?: string;
}

export interface PossessionTrace {
  id: string;
  periodIndex: number;
  periodLabel: string;
  possessionNumber: number;
  side: "away" | "home";
  offenseTeamId: string;
  defenseTeamId: string;
  startScore: {
    away: number;
    home: number;
  };
  endScore: {
    away: number;
    home: number;
  };
  points: number;
  summary: string;
  steps: RollTraceStep[];
}

export interface TracedGameResult {
  seed: number;
  result: GameResult;
  possessions: PossessionTrace[];
}

export interface LeagueGame {
  id: string;
  awayTeamId: string;
  homeTeamId: string;
  date?: string;
  round?: number;
  sequence?: number;
  status: "unplayed" | "simulated" | "manual";
  result?: GameResult;
}

export interface LeagueState {
  id: string;
  name: string;
  teamIds: string[];
  games: LeagueGame[];
  createdAt: string;
  updatedAt: string;
}
