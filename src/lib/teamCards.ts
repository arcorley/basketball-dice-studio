import type { DicePlayerCard, DiceTeamCard, SourceLeague, SourcePlayer, SourcePlayerPostseasonProfile, SourceTeam, TurnoverProfileSource } from "./types";

type NeutralContext = SourceLeague["averages"];

export const calibration = {
  shotQualityScale: 1.85,
  defenseScale: 2.25,
  turnoverScale: 0.75,
  foulScale: 0.75,
  reboundScale: 1.65,
  threeTendencyScale: 1.25,
  paceEraBlend: 0.6,
  threeEraAdaptation: 0.12,
  foulEraAdaptation: 0.35,
  playerRelativeShootingDampening: 0.92,
  playerThreeRelativeDampening: 0.82,
  regressionAttempts: {
    twoPoint: 220,
    threePoint: 170,
    freeThrow: 80
  }
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(Number.isFinite(value) ? value : 0);
}

function roundTo(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function modifier(value: number, min: number, max: number): number {
  return roundTo(clamp(value, min, max), 2);
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value);
}

function required(value: number | null | undefined, label: string): number {
  if (!isFiniteNumber(value)) {
    throw new Error(`Missing required Basketball Reference value: ${label}`);
  }
  return value;
}

function requiredPositive(value: number | null | undefined, label: string): number {
  const out = required(value, label);
  if (out <= 0) {
    throw new Error(`Expected positive Basketball Reference value: ${label}`);
  }
  return out;
}

function sourcedRate(makes: number | null | undefined, attempts: number | null | undefined, label: string): number | null {
  const sourceAttempts = required(attempts, `${label} attempts`);
  if (sourceAttempts === 0) return null;
  return required(makes, `${label} makes`) / sourceAttempts;
}

function pctToD100(value: number): number {
  return modifier(value * 100, 1, 99);
}

function average(values: number[], label: string): number {
  if (!values.length) throw new Error(`No values available for ${label}`);
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function neutralContext(leagues: SourceLeague[]): NeutralContext {
  if (!leagues.length) {
    throw new Error("League source data is required for era-normalized cards.");
  }

  const keys = Object.keys(leagues[0].averages) as Array<keyof NeutralContext>;
  return Object.fromEntries(
    keys.map((key) => [key, average(leagues.map((league) => required(league.averages[key], `${league.season} ${key}`)), `neutral ${key}`)])
  ) as NeutralContext;
}

function leagueMap(leagues: SourceLeague[]): Map<number, SourceLeague> {
  return new Map(leagues.map((league) => [league.seasonEndYear, league]));
}

function leagueFor(source: SourceTeam, leaguesByYear: Map<number, SourceLeague>): SourceLeague {
  const league = leaguesByYear.get(source.seasonEndYear);
  if (!league) {
    throw new Error(`Missing league source data for ${source.season}.`);
  }
  if (!league.strength || !isFiniteNumber(league.strength.talentPointsPer100)) {
    throw new Error(`Missing league-strength source data for ${source.season}.`);
  }
  return league;
}

function zScore(value: number, league: SourceLeague, metric: string): number {
  const distribution = league.distributions[metric];
  if (!distribution) {
    throw new Error(`Missing ${league.season} distribution for ${metric}.`);
  }
  if (!Number.isFinite(distribution.stdev) || distribution.stdev <= 0) {
    throw new Error(`Invalid ${league.season} distribution stdev for ${metric}.`);
  }
  return (value - distribution.mean) / distribution.stdev;
}

function playerZScore(value: number, league: SourceLeague, metric: string): number {
  const distribution = league.playerDistributions[metric];
  if (!distribution) {
    throw new Error(`Missing ${league.season} player distribution for ${metric}.`);
  }
  if (!Number.isFinite(distribution.stdev) || distribution.stdev <= 0) {
    throw new Error(`Invalid ${league.season} player distribution stdev for ${metric}.`);
  }
  return (value - distribution.mean) / distribution.stdev;
}

function weightedMean(items: Array<[number, number]>): number {
  const totalWeight = items.reduce((sum, [, weight]) => sum + weight, 0);
  if (totalWeight <= 0) throw new Error("Weighted mean requires positive weights.");
  return items.reduce((sum, [value, weight]) => sum + value * weight, 0) / totalWeight;
}

function playerOffensiveImpact(player: SourcePlayer, league: SourceLeague): number {
  return weightedMean([
    [playerZScore(required(player.advanced.obpm, `${player.name} OBPM`), league, "offensiveBoxPlusMinus"), 0.34],
    [playerZScore(required(player.advanced.tsPct, `${player.name} TS%`), league, "trueShootingPct"), 0.2],
    [playerZScore(required(player.advanced.usagePct, `${player.name} usage percentage`), league, "usagePct"), 0.14],
    [playerZScore(required(player.advanced.astPct, `${player.name} assist percentage`), league, "assistPct"), 0.14],
    [-playerZScore(required(player.advanced.tovPct, `${player.name} turnover percentage`), league, "turnoverPct"), 0.1],
    [playerZScore(required(player.advanced.ows, `${player.name} offensive win shares`), league, "offensiveWinShares"), 0.08]
  ]);
}

function playerDefensiveImpact(player: SourcePlayer, league: SourceLeague): number {
  return weightedMean([
    [playerZScore(required(player.advanced.dbpm, `${player.name} DBPM`), league, "defensiveBoxPlusMinus"), 0.36],
    [playerZScore(required(player.advanced.dws, `${player.name} defensive win shares`), league, "defensiveWinShares"), 0.18],
    [playerZScore(required(player.advanced.stlPct, `${player.name} steal percentage`), league, "stealPct"), 0.14],
    [playerZScore(required(player.advanced.blkPct, `${player.name} block percentage`), league, "blockPct"), 0.14],
    [playerZScore(required(player.advanced.drbPct, `${player.name} defensive rebound percentage`), league, "defensiveReboundPct"), 0.1],
    [playerZScore(required(player.advanced.bpm, `${player.name} BPM`), league, "boxPlusMinus"), 0.08]
  ]);
}

function teamPlayerSignals(players: SourcePlayer[], league: SourceLeague, teamGames: number): { offense: number; defense: number } {
  const weightedOffense = players.map((player) => [playerOffensiveImpact(player, league), seasonMinutesPerTeamGame(player, teamGames)] as [number, number]);
  const weightedDefense = players.map((player) => [playerDefensiveImpact(player, league), seasonMinutesPerTeamGame(player, teamGames)] as [number, number]);
  return {
    offense: weightedMean(weightedOffense),
    defense: weightedMean(weightedDefense)
  };
}

function translatedPct(
  observedPct: number,
  attempts: number,
  sourceLeaguePct: number,
  neutralPct: number,
  regressionAttempts: number,
  dampening: number
): number {
  const reliability = attempts / (attempts + regressionAttempts);
  return clamp(neutralPct + (observedPct - sourceLeaguePct) * reliability * dampening, 0.01, 0.99);
}

function translatedTeamPace(source: SourceTeam, league: SourceLeague, neutral: NeutralContext): number {
  const pace = required(source.team.pace, `${source.id} pace`);
  return neutral.pace + (pace - league.averages.pace) * calibration.paceEraBlend;
}

function rotationPlayers(players: SourcePlayer[]): SourcePlayer[] {
  const sorted = [...players].sort((a, b) => required(b.minutes, `${b.name} minutes`) - required(a.minutes, `${a.name} minutes`));
  const topMinutes = sorted.filter((player) => required(player.minutes, `${player.name} minutes`) >= 300);
  const core = topMinutes.length >= 8 ? topMinutes : sorted.slice(0, Math.min(10, sorted.length));
  return core.slice(0, 12);
}

function teamGames(source: SourceTeam): number {
  return requiredPositive(required(source.team.wins, `${source.id} wins`) + required(source.team.losses, `${source.id} losses`), `${source.id} team games`);
}

function seasonTotalPerTeamGame(player: SourcePlayer, field: keyof SourcePlayer["totals"], teamGameCount: number): number {
  return required(player.totals[field], `${player.name} ${field}`) / teamGameCount;
}

function seasonMinutesPerTeamGame(player: SourcePlayer, teamGameCount: number): number {
  return required(player.minutes, `${player.name} minutes`) / teamGameCount;
}

type PlayerWeightProfile = Pick<SourcePlayer, "games" | "totals" | "playByPlay"> | SourcePlayerPostseasonProfile;
type PlayoffWeightProfile = { source: DicePlayerCard["playoffWeightSource"]; profile: PlayerWeightProfile };

function profileGames(profile: PlayerWeightProfile, playerName: string): number {
  return requiredPositive(required(profile.games, `${playerName} games`), `${playerName} games`);
}

function playerGames(player: SourcePlayer): number {
  return profileGames(player, player.name);
}

function profileTotalPerGame(profile: PlayerWeightProfile, field: keyof SourcePlayer["totals"], playerName: string): number {
  return required(profile.totals[field], `${playerName} ${field}`) / profileGames(profile, playerName);
}

function activeTotalPerGame(player: SourcePlayer, field: keyof SourcePlayer["totals"]): number {
  return profileTotalPerGame(player, field, player.name);
}

function loadWeight(player: SourcePlayer, teamGameCount: number): number {
  const fga = seasonTotalPerTeamGame(player, "fga", teamGameCount);
  const fta = seasonTotalPerTeamGame(player, "fta", teamGameCount);
  const tov = seasonTotalPerTeamGame(player, "tov", teamGameCount);
  return Math.max(0.1, fga + 0.44 * fta + tov);
}

function profileLoadWeight(profile: PlayerWeightProfile, playerName: string): number {
  const fga = profileTotalPerGame(profile, "fga", playerName);
  const fta = profileTotalPerGame(profile, "fta", playerName);
  const tov = profileTotalPerGame(profile, "tov", playerName);
  return Math.max(0.1, fga + 0.44 * fta + tov);
}

function playoffWeightProfile(player: SourcePlayer): PlayoffWeightProfile {
  const postseason = player.postseason;
  if (postseason && isFiniteNumber(postseason.games) && postseason.games > 0) {
    return { source: "postseason", profile: postseason };
  }
  return { source: "healthy-regular", profile: player };
}

function sourcedAndOnes(player: SourcePlayer): number | null {
  const andOnes = player.playByPlay.andOnes;
  if (!isFiniteNumber(andOnes)) return null;
  return Math.max(0, andOnes);
}

function shootingFoulBranchFta(player: SourcePlayer): number {
  const fta = required(player.totals.fta, `${player.name} FTA`);
  const andOnes = sourcedAndOnes(player);
  return andOnes === null ? fta : Math.max(0, fta - andOnes);
}

function andOneChance(player: SourcePlayer): number {
  const andOnes = sourcedAndOnes(player);
  if (andOnes === null) return 0;

  const madeFieldGoals = required(player.totals.fg, `${player.name} made field goals`);
  if (madeFieldGoals === 0) return 0;
  return modifier((andOnes / madeFieldGoals) * 100, 0, 35);
}

function turnoverProfile(player: SourcePlayer): {
  turnoverProfile: TurnoverProfileSource;
  liveBallTurnoverChance: number;
  offensiveFoulTurnoverChance: number;
} {
  const turnovers = required(player.totals.tov, `${player.name} turnovers`);
  if (turnovers <= 0) {
    return {
      turnoverProfile: "aggregate",
      liveBallTurnoverChance: 0,
      offensiveFoulTurnoverChance: 0
    };
  }

  const badPass = player.playByPlay.badPassTurnovers;
  const lostBall = player.playByPlay.lostBallTurnovers;
  const offensiveFouls = player.playByPlay.offensiveFouls;
  if (isFiniteNumber(badPass) && isFiniteNumber(lostBall) && isFiniteNumber(offensiveFouls)) {
    const liveBall = Math.max(0, badPass) + Math.max(0, lostBall);
    const offensive = Math.max(0, offensiveFouls);
    const scale = liveBall + offensive > turnovers ? turnovers / (liveBall + offensive) : 1;
    return {
      turnoverProfile: "play-by-play",
      liveBallTurnoverChance: modifier(((liveBall * scale) / turnovers) * 100, 0, 100),
      offensiveFoulTurnoverChance: modifier(((offensive * scale) / turnovers) * 100, 0, 100)
    };
  }

  return {
    turnoverProfile: "aggregate",
    liveBallTurnoverChance: 60,
    offensiveFoulTurnoverChance: 0
  };
}

function shootingFoulWeight(profile: PlayerWeightProfile, denominatorGames: number, playerName: string): number {
  const shootingFouls = profile.playByPlay.shootingFouls;
  if (isFiniteNumber(shootingFouls)) {
    return Math.max(0, shootingFouls / denominatorGames);
  }
  return Math.max(0, required(profile.totals.pf, `${playerName} personal fouls`) / denominatorGames);
}

function translatedPlayerThreeRate(source: SourceTeam, player: SourcePlayer, league: SourceLeague, neutral: NeutralContext): number {
  const fga = required(player.totals.fga, `${player.name} FGA`);
  const fg3a = required(player.totals.fg3a, `${player.name} 3PA`);
  if (fga === 0) return 0;

  const rawPlayerRate = fg3a / fga;
  const rawTeamRate = requiredPositive(source.team.threeAttemptRate, `${source.id} 3PA/FGA`);
  const translatedTeamRate = clamp(
    neutral.threeAttemptRate + (rawTeamRate - league.averages.threeAttemptRate) * 0.55,
    0.02,
    0.65
  );
  const playerRoleWithinTeam = rawPlayerRate / rawTeamRate;
  const translatedRoleRate = clamp(translatedTeamRate * playerRoleWithinTeam, 0, 0.95);
  return clamp(rawPlayerRate * (1 - calibration.threeEraAdaptation) + translatedRoleRate * calibration.threeEraAdaptation, 0, 0.95);
}

function sourcedShootingFoulSignal(player: SourcePlayer): number | null {
  const fga = required(player.totals.fga, `${player.name} FGA`);
  const fta = shootingFoulBranchFta(player);
  const drawnShooting = player.playByPlay.drawnShooting;
  if (fga <= 0) {
    if (fta > 0 || (isFiniteNumber(drawnShooting) && drawnShooting > 0)) {
      throw new Error(`${player.name} has foul-draw data without sourced FGA.`);
    }
    return 0;
  }

  const ftaPerFga = fta / fga;
  if (!isFiniteNumber(drawnShooting)) return ftaPerFga;

  const andOnes = sourcedAndOnes(player) ?? 0;
  const shootingFoulTripsPerFga = Math.max(0, drawnShooting - andOnes) / fga;
  const shootingFoulFtaEquivalent = shootingFoulTripsPerFga * 2;
  return weightedMean([
    [ftaPerFga, 0.72],
    [shootingFoulFtaEquivalent, 0.28]
  ]);
}

function translatedPlayerFtaRate(player: SourcePlayer, league: SourceLeague, neutral: NeutralContext): number {
  const playerFtaPerFga = sourcedShootingFoulSignal(player);
  if (playerFtaPerFga === null) {
    throw new Error(`Missing Basketball Reference foul-draw signal for ${player.name}.`);
  }
  if (playerFtaPerFga === 0) return 0;

  const eraTranslatedRate = clamp(
    neutral.freeThrowAttemptRate + (playerFtaPerFga - league.averages.freeThrowAttemptRate) * 0.78,
    0,
    0.9
  );
  return clamp(playerFtaPerFga * (1 - calibration.foulEraAdaptation) + eraTranslatedRate * calibration.foulEraAdaptation, 0, 0.9);
}

function playerCard(source: SourceTeam, player: SourcePlayer, league: SourceLeague, neutral: NeutralContext, teamGameCount: number): DicePlayerCard {
  const teamId = source.id;
  const fga = required(player.totals.fga, `${player.name} FGA`);
  const fg3a = required(player.totals.fg3a, `${player.name} 3PA`);
  const fg2a = required(player.totals.fg2a, `${player.name} 2PA`);
  const fta = required(player.totals.fta, `${player.name} FTA`);
  const fg2Pct = sourcedRate(player.totals.fg2, fg2a, `${player.name} 2P%`);
  const fg3Pct = sourcedRate(player.totals.fg3, fg3a, `${player.name} 3P%`);
  const ftPct = sourcedRate(player.totals.ft, fta, `${player.name} FT%`);
  const tovPer100 = required(player.per100.tov, `${player.name} turnovers per 100`);
  const tovPct = required(player.advanced.tovPct, `${player.name} turnover percentage`);

  if (fga > 0 && fg2Pct === null) {
    throw new Error(`${player.name} is in the rotation without sourced 2P attempts.`);
  }

  const p2Pct = translatedPct(
    required(fg2Pct, `${player.name} 2P%`),
    fg2a,
    league.averages.fg2Pct,
    neutral.fg2Pct,
    calibration.regressionAttempts.twoPoint,
    calibration.playerRelativeShootingDampening
  );
  const p3Pct =
    fg3Pct === null
      ? 0.01
      : translatedPct(
          fg3Pct,
          fg3a,
          league.averages.fg3Pct,
          neutral.fg3Pct,
          calibration.regressionAttempts.threePoint,
          calibration.playerThreeRelativeDampening
        );
  const ftMakePct =
    ftPct === null
      ? 0.01
      : translatedPct(ftPct, fta, league.averages.ftPct, neutral.ftPct, calibration.regressionAttempts.freeThrow, 1);
  const rawThreeRate = fga > 0 ? fg3a / fga : 0;
  const translatedThreeRate = translatedPlayerThreeRate(source, player, league, neutral);
  const rawFtaRate = fga > 0 ? shootingFoulBranchFta(player) / fga : 0;
  const translatedFtaRate = translatedPlayerFtaRate(player, league, neutral);
  const offensiveImpact = playerOffensiveImpact(player, league);
  const defensiveImpact = playerDefensiveImpact(player, league);
  const turnover = turnoverProfile(player);
  const gamesPlayed = playerGames(player);
  const impactUseMultiplier = clamp(1 + offensiveImpact * 0.045, 0.75, 1.28);
  const playoffWeights = playoffWeightProfile(player);
  const playoffGames = profileGames(playoffWeights.profile, player.name);

  return {
    id: `${teamId}:${player.name}`,
    teamId,
    name: player.name,
    position: player.position,
    minutes: required(player.minutes, `${player.name} minutes`),
    useWeight: loadWeight(player, teamGameCount) * impactUseMultiplier,
    playoffUseWeight: profileLoadWeight(playoffWeights.profile, player.name) * impactUseMultiplier,
    playoffWeightSource: playoffWeights.source,
    postseasonGames: playoffWeights.source === "postseason" ? playoffGames : null,
    availabilityFactor: clamp(gamesPlayed / teamGameCount, 0, 1),
    tov: modifier(tovPer100 * 0.9 + tovPct * 0.8, 1, 24),
    fd: modifier(translatedFtaRate * 39, 0, 22),
    threeFrequency: modifier(translatedThreeRate * 100, 0, 95),
    p2: pctToD100(p2Pct),
    p3: pctToD100(p3Pct),
    ft: pctToD100(ftMakePct),
    andOneChance: andOneChance(player),
    turnoverProfile: turnover.turnoverProfile,
    liveBallTurnoverChance: turnover.liveBallTurnoverChance,
    offensiveFoulTurnoverChance: turnover.offensiveFoulTurnoverChance,
    astWeight: Math.max(0, seasonTotalPerTeamGame(player, "ast", teamGameCount)),
    orbWeight: Math.max(0, seasonTotalPerTeamGame(player, "orb", teamGameCount)),
    drbWeight: Math.max(0, seasonTotalPerTeamGame(player, "drb", teamGameCount)),
    stlWeight: Math.max(0, seasonTotalPerTeamGame(player, "stl", teamGameCount)),
    blkWeight: Math.max(0, seasonTotalPerTeamGame(player, "blk", teamGameCount)),
    pfWeight: Math.max(0, seasonTotalPerTeamGame(player, "pf", teamGameCount)),
    shootingFoulWeight: shootingFoulWeight(player, teamGameCount, player.name),
    playoffAstWeight: Math.max(0, profileTotalPerGame(playoffWeights.profile, "ast", player.name)),
    playoffOrbWeight: Math.max(0, profileTotalPerGame(playoffWeights.profile, "orb", player.name)),
    playoffDrbWeight: Math.max(0, profileTotalPerGame(playoffWeights.profile, "drb", player.name)),
    playoffStlWeight: Math.max(0, profileTotalPerGame(playoffWeights.profile, "stl", player.name)),
    playoffBlkWeight: Math.max(0, profileTotalPerGame(playoffWeights.profile, "blk", player.name)),
    playoffPfWeight: Math.max(0, profileTotalPerGame(playoffWeights.profile, "pf", player.name)),
    playoffShootingFoulWeight: shootingFoulWeight(playoffWeights.profile, playoffGames, player.name),
    calibration: {
      offensiveImpact,
      defensiveImpact,
      rawThreeRate,
      translatedThreeRate,
      rawFreeThrowAttemptRate: rawFtaRate,
      translatedFreeThrowAttemptRate: translatedFtaRate,
      rawTwoPointPct: required(fg2Pct, `${player.name} 2P%`),
      translatedTwoPointPct: p2Pct,
      rawThreePointPct: fg3Pct,
      translatedThreePointPct: p3Pct,
      rawFreeThrowPct: ftPct,
      translatedFreeThrowPct: ftMakePct
    },
    source: player
  };
}

export function buildDiceTeamCards(sourceTeams: SourceTeam[], leagues: SourceLeague[]): DiceTeamCard[] {
  const neutral = neutralContext(leagues);
  const leaguesByYear = leagueMap(leagues);

  return sourceTeams.map((source) => {
    const league = leagueFor(source, leaguesByYear);
    const team = source.team;
    const gameCount = teamGames(source);
    const fg = requiredPositive(team.totals.fg, `${source.id} team FG`);
    const astRate = modifier((required(team.totals.ast, `${source.id} team assists`) / fg) * 100, 15, 95);
    const rotation = rotationPlayers(source.players);
    const playerSignals = teamPlayerSignals(rotation, league, gameCount);
    const players = rotation.map((player) => playerCard(source, player, league, neutral, gameCount));

    const offenseZ = weightedMean([
      [zScore(required(team.offensiveRating, `${source.id} ORtg`), league, "offensiveRating"), 0.36],
      [zScore(required(team.efgPct, `${source.id} eFG%`), league, "efgPct"), 0.2],
      [zScore(required(team.simpleRating, `${source.id} SRS`), league, "simpleRating"), 0.16],
      [required(team.simpleRating, `${source.id} SRS`) / 5, 0.11],
      [playerSignals.offense, 0.17]
    ]);
    const defenseZ = weightedMean([
      [-zScore(required(team.defensiveRating, `${source.id} DRtg`), league, "defensiveRating"), 0.35],
      [-zScore(required(team.opponentEfgPct, `${source.id} opponent eFG%`), league, "opponentEfgPct"), 0.2],
      [zScore(required(team.simpleRating, `${source.id} SRS`), league, "simpleRating"), 0.15],
      [required(team.simpleRating, `${source.id} SRS`) / 5, 0.1],
      [playerSignals.defense, 0.2]
    ]);

    return {
      id: source.id,
      name: source.name,
      shortName: source.shortName,
      abbr: source.abbr,
      season: source.season,
      pace: translatedTeamPace(source, league, neutral),
      offensiveRating: required(team.offensiveRating, `${source.id} ORtg`),
      defensiveRating: required(team.defensiveRating, `${source.id} DRtg`),
      shotQuality: modifier(offenseZ * calibration.shotQualityScale, -6, 6),
      defense: modifier(defenseZ * calibration.defenseScale, -8, 8),
      toPress: modifier(zScore(required(team.opponentTurnoverPct, `${source.id} opponent TOV%`), league, "opponentTurnoverPct") * calibration.turnoverScale, -5, 5),
      toProtect: modifier(-zScore(required(team.turnoverPct, `${source.id} TOV%`), league, "turnoverPct") * calibration.turnoverScale, -5, 5),
      foulDraw: modifier(zScore(required(team.freeThrowAttemptRate, `${source.id} FTA/FGA`), league, "freeThrowAttemptRate") * calibration.foulScale, -5, 5),
      foulDiscipline: modifier(
        -zScore(required(team.opponentFreeThrowAttemptRate, `${source.id} opponent FTA/FGA`), league, "opponentFreeThrowAttemptRate") * calibration.foulScale,
        -5,
        5
      ),
      threeTendency: modifier(zScore(required(team.threeAttemptRate, `${source.id} 3PA/FGA`), league, "threeAttemptRate") * calibration.threeTendencyScale, -8, 8),
      orb: modifier(zScore(required(team.offensiveReboundPct, `${source.id} ORB%`), league, "offensiveReboundPct") * calibration.reboundScale, -7, 7),
      drb: modifier(zScore(required(team.defensiveReboundPct, `${source.id} DRB%`), league, "defensiveReboundPct") * calibration.reboundScale, -7, 7),
      assistMade2: astRate,
      assistMade3: clamp(astRate + 8, 0, 95),
      players,
      calibration: {
        leagueSeason: league.season,
        leagueAverages: league.averages,
        leagueStrength: league.strength,
        playerOffenseSignal: playerSignals.offense,
        playerDefenseSignal: playerSignals.defense,
        teamOffenseSignal: offenseZ,
        teamDefenseSignal: defenseZ
      },
      source
    };
  });
}

export const generalDerivationNotes = [
  "Team modifiers use full Basketball Reference league distributions for that team season, not the current app library average.",
  "Player impact uses season-level Basketball Reference player advanced distributions for OBPM, DBPM, BPM, usage, TS%, assist, rebound, steal, block, turnover, and FTA/FGA context.",
  "Individual players drive possession usage and action ranges through sourced season contribution per team game, usage context, makes, attempts, FTA/FGA, drawn shooting fouls when Basketball Reference provides them, TOV%, per-100 stats, assists, rebounds, steals, blocks, and fouls.",
  "Matchup cards translate shooting, 3PA share, FT%, and foul draw against the two teams' averaged league environments, so same-era matchups preserve that season and cross-era matchups meet at a midpoint context.",
  "Player shot making is era-relative and volume-regressed from sourced makes and attempts; missing percentages are only accepted when the player had zero sourced attempts.",
  "Foul draw uses sourced FTA/FGA against that season's league FTA/FGA, then team FTA/FGA and opponent FTA/FGA z-scores adjust the matchup.",
  "Turnover and drawn-foul action ranges are matchup-scaled to sourced offense rates blended with opponent allowed rates; cross-era matchups retain more of each offense's own style before applying opponent pressure, preserving individual player distribution inside the team target.",
  "3PA checks are matchup-scaled from offense 3PA rate and opponent allowed 3PA rate after both are translated into the matchup era context.",
  "Regular context uses season-contribution player weights from totals per team game; playoff context uses sourced postseason player profiles when available, otherwise active-game regular profiles, so playoff rotations and individual form are not inferred from missed regular-season games.",
  "Matchup cards split shot attempts into rim, short-mid, long-mid, and 3P zones with zone-specific make ranges from either sourced Basketball Reference distance tables or explicit provenance-labeled shot-location proxies.",
  "Pre-1996-97 shot-location profiles use same-player sourced neighbor seasons when enough later FGA exists, then role/size/usage/stat neighbors when same-player samples are too thin; generated profiles preserve sourced 3PA/FGA and reconcile weighted 2P zone makes back to sourced 2P%.",
  "Sourced 2P distance buckets are normalized inside the known 2P share when Basketball Reference leaves an unclassified distance remainder, preserving the sourced 2P/3P split without inserting default zone values.",
  "Cross-era matchups apply a small league-strength scalar from full-season roster depth, qualified player depth per team, and league team count. Same-season matchups get a zero era-talent adjustment.",
  "Playoff context adds a small precomputed top-end leverage adjustment from the offense's top rotation offensive impact against the defense's top rotation defensive impact, so concentrated two-way stars matter more without changing regular-season cards.",
  "When Basketball Reference play-by-play tables provide and-one counts, those free throws are modeled on made field goals instead of as separate no-FGA foul possessions.",
  "Drawn-foul branches use a source-derived foul-end check from the possession equation FGA + weighted FTA - ORB + TOV, letting bonus and continuation free throws preserve realistic shot volume.",
  "When sourced Basketball Reference play-by-play turnover types exist, player turnovers split into live-ball steal chances, offensive-foul turnovers, and dead-ball turnovers; older aggregate profiles keep the prior sourced-TOV structure with an explicit aggregate label.",
  "Shooting fouls and and-ones use shooting-foul assignment weights when Basketball Reference play-by-play data provides them, otherwise they use sourced personal fouls.",
  "Offensive rebound checks use an era-gap-aware sourced matchup rate: offense ORB% blended with opponent allowed ORB% from defensive rebound percentage, retaining more offense identity as teams get farther apart in time.",
  "SRS, margin context through league distributions, offensive rating, defensive rating, eFG%, turnovers, rebounding, and 3PA rate all contribute to static card modifiers.",
  "Team-level matchup modifiers are preserved as decimal values in the simulator and rounded only when converted into printable d100 ranges."
];

export const teamDerivationNotes: Record<string, string[]> = {
  // Add team/year-specific derivation nuances keyed by DiceTeamCard.id, e.g. "1993-94-hou".
};

export const derivationNotes = generalDerivationNotes;
