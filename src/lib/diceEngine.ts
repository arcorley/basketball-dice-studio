import type {
  AssignmentEvent,
  DicePlayerCard,
  DiceTeamCard,
  GameResult,
  MatchupCard,
  PlayerRangeRow,
  RangeRow,
  StatLine,
  TeamMatchupStatic
} from "./types";
import { SeededRandom } from "./random";
import { calibration as cardCalibration } from "./teamCards";

export const simParams = {
  globalShotMod: -1,
  globalFdMod: 1,
  globalTovMod: 0,
  tovScale: 1,
  fdScale: 1,
  threeMod: 0,
  orbBase: 27,
  astMod: 0,
  blockBase: 7,
  stealTurnoverPct: 60,
  nonshootFoulChance: 7,
  defenseShotDivisor: 2,
  maxOrbExtensions: 2
};

const statFields = ["PTS", "FGM", "FGA", "3PM", "3PA", "FTM", "FTA", "OREB", "DREB", "REB", "AST", "STL", "BLK", "TOV", "PF"];
type MatchupPlayerProfile = Pick<DicePlayerCard, "tov" | "fd" | "threeFrequency" | "p2" | "p3" | "ft">;

const matchupProfileCache = new Map<string, MatchupPlayerProfile>();

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function pctRoll(rng: SeededRandom, chance: number): boolean {
  return rng.next() * 100 < chance;
}

function safeRange(start: number, end: number): string {
  if (end < start || end <= 0) return "-";
  const safeStart = Math.max(1, start);
  const safeEnd = Math.min(100, end);
  if (safeEnd < safeStart) return "-";
  return `${String(safeStart).padStart(2, "0")}-${safeEnd === 100 ? "100" : String(safeEnd).padStart(2, "0")}`;
}

export function nRange(value: number): string {
  const rounded = Math.round(value);
  if (rounded <= 0) return "-";
  return safeRange(1, Math.min(100, rounded));
}

export function quarterSplit(possessionsEach: number): [number, number, number, number] {
  const quarters = [0, 0, 0, 0] as [number, number, number, number];
  quarters.fill(Math.floor(possessionsEach / 4));
  for (let index = 0; index < possessionsEach % 4; index += 1) {
    quarters[index] += 1;
  }
  return quarters;
}

function defenseShotAdjustment(defense: number): number {
  return defense / simParams.defenseShotDivisor;
}

function requiredNumber(value: number | null | undefined, label: string): number {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    throw new Error(`Missing required Basketball Reference value: ${label}`);
  }
  return value;
}

function matchupContext(offense: DiceTeamCard, defense: DiceTeamCard): DiceTeamCard["calibration"]["leagueAverages"] {
  const offenseContext = offense.calibration.leagueAverages;
  const defenseContext = defense.calibration.leagueAverages;
  return Object.fromEntries(
    (Object.keys(offenseContext) as Array<keyof typeof offenseContext>).map((key) => [key, (offenseContext[key] + defenseContext[key]) / 2])
  ) as DiceTeamCard["calibration"]["leagueAverages"];
}

function translatedRate(
  observedPct: number,
  attempts: number,
  sourceLeaguePct: number,
  contextPct: number,
  regressionAttempts: number,
  dampening: number
): number {
  const reliability = attempts / (attempts + regressionAttempts);
  return clamp(contextPct + (observedPct - sourceLeaguePct) * reliability * dampening, 0.01, 0.99);
}

function matchupThreeRate(offense: DiceTeamCard, defense: DiceTeamCard, player: DicePlayerCard): number {
  const fga = requiredNumber(player.source.totals.fga, `${player.name} FGA`);
  const fg3a = requiredNumber(player.source.totals.fg3a, `${player.name} 3PA`);
  if (fga === 0) return 0;

  const context = matchupContext(offense, defense);
  const rawPlayerRate = fg3a / fga;
  const rawTeamRate = requiredNumber(offense.source.team.threeAttemptRate, `${offense.id} 3PA/FGA`);
  if (rawTeamRate <= 0) {
    throw new Error(`${offense.id} has invalid sourced team 3PA/FGA.`);
  }
  const translatedTeamRate = clamp(
    context.threeAttemptRate + (rawTeamRate - offense.calibration.leagueAverages.threeAttemptRate) * 0.55,
    0.02,
    0.65
  );
  const playerRoleWithinTeam = rawPlayerRate / rawTeamRate;
  const translatedRoleRate = clamp(translatedTeamRate * playerRoleWithinTeam, 0, 0.95);
  return clamp(rawPlayerRate * (1 - cardCalibration.threeEraAdaptation) + translatedRoleRate * cardCalibration.threeEraAdaptation, 0, 0.95);
}

function matchupFreeThrowAttemptRate(offense: DiceTeamCard, defense: DiceTeamCard, player: DicePlayerCard): number {
  const context = matchupContext(offense, defense);
  const playerFtaPerFga = player.calibration.rawFreeThrowAttemptRate;
  if (playerFtaPerFga === 0) return 0;

  const eraTranslatedRate = clamp(
    context.freeThrowAttemptRate + (playerFtaPerFga - offense.calibration.leagueAverages.freeThrowAttemptRate) * 0.78,
    0,
    0.9
  );
  return clamp(playerFtaPerFga * (1 - cardCalibration.foulEraAdaptation) + eraTranslatedRate * cardCalibration.foulEraAdaptation, 0, 0.9);
}

function matchupPlayerProfile(
  offense: DiceTeamCard,
  defense: DiceTeamCard,
  player: DicePlayerCard
): MatchupPlayerProfile {
  const cacheKey = `${offense.id}|${defense.id}|${player.id}`;
  const cached = matchupProfileCache.get(cacheKey);
  if (cached) return cached;

  const context = matchupContext(offense, defense);
  const sourceLeague = offense.calibration.leagueAverages;
  const fg2a = requiredNumber(player.source.totals.fg2a, `${player.name} 2PA`);
  const fg3a = requiredNumber(player.source.totals.fg3a, `${player.name} 3PA`);
  const fta = requiredNumber(player.source.totals.fta, `${player.name} FTA`);

  const p2 = translatedRate(
    player.calibration.rawTwoPointPct,
    fg2a,
    sourceLeague.fg2Pct,
    context.fg2Pct,
    cardCalibration.regressionAttempts.twoPoint,
    cardCalibration.playerRelativeShootingDampening
  );
  const p3 =
    player.calibration.rawThreePointPct === null
      ? 0.01
      : translatedRate(
          player.calibration.rawThreePointPct,
          fg3a,
          sourceLeague.fg3Pct,
          context.fg3Pct,
          cardCalibration.regressionAttempts.threePoint,
          cardCalibration.playerThreeRelativeDampening
        );
  const ft =
    player.calibration.rawFreeThrowPct === null
      ? 0.01
      : translatedRate(player.calibration.rawFreeThrowPct, fta, sourceLeague.ftPct, context.ftPct, cardCalibration.regressionAttempts.freeThrow, 1);

  const profile = {
    tov: player.tov,
    fd: clamp(matchupFreeThrowAttemptRate(offense, defense, player) * 39, 0, 22),
    threeFrequency: clamp(matchupThreeRate(offense, defense, player) * 100, 0, 95),
    p2: clamp(p2 * 100, 1, 99),
    p3: clamp(p3 * 100, 1, 99),
    ft: clamp(ft * 100, 1, 99)
  };
  matchupProfileCache.set(cacheKey, profile);
  return profile;
}

function matchupOffensiveReboundChance(offense: DiceTeamCard, defense: DiceTeamCard): number {
  const offenseOrbPct = requiredNumber(offense.source.team.offensiveReboundPct, `${offense.id} offensive rebound percentage`);
  const opponentAllowedOrbPct = 100 - requiredNumber(defense.source.team.defensiveReboundPct, `${defense.id} defensive rebound percentage`);
  return clamp((offenseOrbPct + opponentAllowedOrbPct) / 2, 5, 45);
}

function assignmentWeight(player: DicePlayerCard, event: AssignmentEvent): number {
  switch (event) {
    case "Use":
      return player.useWeight;
    case "AST":
      return player.astWeight;
    case "OREB":
      return player.orbWeight;
    case "DREB":
      return player.drbWeight;
    case "STL":
      return player.stlWeight;
    case "BLK":
      return player.blkWeight;
    case "PF":
      return player.pfWeight;
  }
}

export function assignmentRows(team: DiceTeamCard, event: AssignmentEvent): RangeRow[] {
  const items = team.players
    .map((player) => ({ player, weight: assignmentWeight(player, event) }))
    .filter((item) => item.weight > 0);
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) return [];

  const exact = items.map((item, index) => {
    const raw = (item.weight * 100) / total;
    return {
      index,
      player: item.player,
      weight: item.weight,
      count: Math.floor(raw),
      remainder: raw - Math.floor(raw)
    };
  });

  let remaining = 100 - exact.reduce((sum, item) => sum + item.count, 0);
  [...exact]
    .sort((a, b) => b.remainder - a.remainder || b.weight - a.weight)
    .slice(0, remaining)
    .forEach((item) => {
      item.count += 1;
    });

  remaining = 100 - exact.reduce((sum, item) => sum + item.count, 0);
  if (remaining > 0 && exact[0]) exact[0].count += remaining;

  let start = 1;
  return exact
    .sort((a, b) => a.index - b.index)
    .filter((item) => item.count > 0)
    .map((item) => {
      const end = start + item.count - 1;
      const row = {
        label: item.player.name,
        range: safeRange(start, end),
        weight: item.weight
      };
      start = end + 1;
      return row;
    });
}

function useRangeMap(team: DiceTeamCard): Map<string, string> {
  return new Map(assignmentRows(team, "Use").map((row) => [row.label, row.range]));
}

function sideStatic(offense: DiceTeamCard, defense: DiceTeamCard): TeamMatchupStatic {
  const defAdj = defenseShotAdjustment(defense.defense);
  const orbChance = matchupOffensiveReboundChance(offense, defense);
  const blockChance = clamp(simParams.blockBase + defense.defense, 0, 40);
  const astMade2 = clamp(offense.assistMade2 + simParams.astMod, 0, 95);
  const astMade3 = clamp(offense.assistMade3 + simParams.astMod, 0, 95);
  return {
    offense: offense.id,
    defense: defense.id,
    orbChance,
    blockChance,
    astMade2,
    astMade3,
    defenseShotAdjustment: defAdj,
    ranges: {
      orb: nRange(orbChance),
      block: nRange(blockChance),
      ast2: nRange(astMade2),
      ast3: nRange(astMade3)
    }
  };
}

export function playerRanges(offense: DiceTeamCard, defense: DiceTeamCard): PlayerRangeRow[] {
  const uses = useRangeMap(offense);
  const defAdj = defenseShotAdjustment(defense.defense);

  return offense.players.map((player) => {
    const profile = matchupPlayerProfile(offense, defense, player);
    const tov = clamp((profile.tov + defense.toPress - offense.toProtect + simParams.globalTovMod) * simParams.tovScale, 0, 40);
    const fd = clamp((profile.fd + offense.foulDraw - defense.foulDiscipline + simParams.globalFdMod) * simParams.fdScale, 0, 40);
    const three = clamp(profile.threeFrequency + offense.threeTendency + simParams.threeMod, 0, 95);
    const p2 = clamp(profile.p2 + offense.shotQuality - defAdj + simParams.globalShotMod, 1, 99);
    const p3 = clamp(profile.p3 + offense.shotQuality - defAdj + simParams.globalShotMod, 1, 99);
    const rangeTov = Math.round(tov);
    const rangeFd = Math.round(fd);

    return {
      player: player.name,
      use: uses.get(player.name) ?? "-",
      tov: safeRange(1, rangeTov),
      foul: safeRange(rangeTov + 1, rangeTov + rangeFd),
      shot: safeRange(rangeTov + rangeFd + 1, 100),
      three: nRange(three),
      p2: nRange(p2),
      p3: nRange(p3),
      ft: nRange(profile.ft),
      raw: { tov, fd, three, p2, p3, ft: profile.ft }
    };
  });
}

export function buildMatchupCard(away: DiceTeamCard, home: DiceTeamCard): MatchupCard {
  const possessionsEach = Math.round((away.pace + home.pace) / 2);
  const events: AssignmentEvent[] = ["Use", "AST", "OREB", "DREB", "STL", "BLK", "PF"];

  return {
    away,
    home,
    possessionsEach,
    quarters: quarterSplit(possessionsEach),
    looseFoulRange: nRange(simParams.nonshootFoulChance),
    stealOnTurnoverRange: nRange(simParams.stealTurnoverPct),
    awayStatic: sideStatic(away, home),
    homeStatic: sideStatic(home, away),
    awayPlayerRanges: playerRanges(away, home),
    homePlayerRanges: playerRanges(home, away),
    assignments: {
      [away.id]: Object.fromEntries(events.map((event) => [event, assignmentRows(away, event)])) as Record<AssignmentEvent, RangeRow[]>,
      [home.id]: Object.fromEntries(events.map((event) => [event, assignmentRows(home, event)])) as Record<AssignmentEvent, RangeRow[]>
    }
  };
}

function weightedChoice(players: DicePlayerCard[], event: AssignmentEvent, rng: SeededRandom, excludeName = ""): DicePlayerCard | undefined {
  const items = players
    .filter((player) => player.name !== excludeName)
    .map((player) => ({ player, weight: assignmentWeight(player, event) }))
    .filter((item) => item.weight > 0);
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) return undefined;

  let roll = rng.next() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return item.player;
  }
  return items.at(-1)?.player;
}

function selectOffensivePlayer(team: DiceTeamCard, rng: SeededRandom): DicePlayerCard {
  const total = team.players.reduce((sum, player) => sum + player.useWeight, 0);
  let roll = rng.next() * total;
  for (const player of team.players) {
    roll -= player.useWeight;
    if (roll <= 0) return player;
  }
  return team.players.at(-1) as DicePlayerCard;
}

function emptyTeamStats(): StatLine {
  return Object.fromEntries([...statFields, "poss", "nonshooting_fouls_drawn"].map((field) => [field, 0]));
}

function emptyPlayerStats(team: DiceTeamCard): Record<string, StatLine> {
  return Object.fromEntries(team.players.map((player) => [player.name, Object.fromEntries(statFields.map((field) => [field, 0]))]));
}

function add(statLine: StatLine, field: string, amount = 1): void {
  statLine[field] = (statLine[field] ?? 0) + amount;
}

function resolvePossession(
  offense: DiceTeamCard,
  defense: DiceTeamCard,
  offensePlayerStats: Record<string, StatLine>,
  defensePlayerStats: Record<string, StatLine>,
  offenseTeamStats: StatLine,
  defenseTeamStats: StatLine,
  rng: SeededRandom
): void {
  add(offenseTeamStats, "poss");
  let extensions = 0;

  while (true) {
    if (simParams.nonshootFoulChance > 0 && pctRoll(rng, simParams.nonshootFoulChance)) {
      const fouler = weightedChoice(defense.players, "PF", rng);
      if (fouler) {
        add(defensePlayerStats[fouler.name], "PF");
        add(defenseTeamStats, "PF");
        add(offenseTeamStats, "nonshooting_fouls_drawn");
      }
    }

    const shooter = selectOffensivePlayer(offense, rng);
    const shooterProfile = matchupPlayerProfile(offense, defense, shooter);
    const effectiveTov = clamp((shooterProfile.tov + defense.toPress - offense.toProtect + simParams.globalTovMod) * simParams.tovScale, 0, 40);
    const effectiveFd = clamp((shooterProfile.fd + offense.foulDraw - defense.foulDiscipline + simParams.globalFdMod) * simParams.fdScale, 0, 40);
    const actionRoll = rng.next() * 100;

    if (actionRoll < effectiveTov) {
      add(offensePlayerStats[shooter.name], "TOV");
      add(offenseTeamStats, "TOV");
      if (pctRoll(rng, simParams.stealTurnoverPct)) {
        const stealer = weightedChoice(defense.players, "STL", rng);
        if (stealer) {
          add(defensePlayerStats[stealer.name], "STL");
          add(defenseTeamStats, "STL");
        }
      }
      return;
    }

    if (actionRoll < effectiveTov + effectiveFd) {
      const fouler = weightedChoice(defense.players, "PF", rng);
      if (fouler) {
        add(defensePlayerStats[fouler.name], "PF");
        add(defenseTeamStats, "PF");
      }
      for (let shot = 0; shot < 2; shot += 1) {
        add(offensePlayerStats[shooter.name], "FTA");
        add(offenseTeamStats, "FTA");
        if (pctRoll(rng, shooterProfile.ft)) {
          add(offensePlayerStats[shooter.name], "FTM");
          add(offensePlayerStats[shooter.name], "PTS");
          add(offenseTeamStats, "FTM");
          add(offenseTeamStats, "PTS");
        }
      }
      return;
    }

    const threeChance = clamp(shooterProfile.threeFrequency + offense.threeTendency + simParams.threeMod, 0, 95);
    const isThree = pctRoll(rng, threeChance);
    const defAdj = defenseShotAdjustment(defense.defense);
    const makeNumber = clamp((isThree ? shooterProfile.p3 : shooterProfile.p2) + offense.shotQuality - defAdj + simParams.globalShotMod, 1, 99);

    add(offensePlayerStats[shooter.name], "FGA");
    add(offenseTeamStats, "FGA");
    if (isThree) {
      add(offensePlayerStats[shooter.name], "3PA");
      add(offenseTeamStats, "3PA");
    }

    if (pctRoll(rng, makeNumber)) {
      add(offensePlayerStats[shooter.name], "FGM");
      add(offenseTeamStats, "FGM");
      if (isThree) {
        add(offensePlayerStats[shooter.name], "3PM");
        add(offensePlayerStats[shooter.name], "PTS", 3);
        add(offenseTeamStats, "3PM");
        add(offenseTeamStats, "PTS", 3);
      } else {
        add(offensePlayerStats[shooter.name], "PTS", 2);
        add(offenseTeamStats, "PTS", 2);
      }

      const assistChance = isThree ? offense.assistMade3 : offense.assistMade2;
      if (pctRoll(rng, clamp(assistChance + simParams.astMod, 0, 95))) {
        const passer = weightedChoice(offense.players, "AST", rng, shooter.name);
        if (passer) {
          add(offensePlayerStats[passer.name], "AST");
          add(offenseTeamStats, "AST");
        }
      }
      return;
    }

    if (!isThree && pctRoll(rng, clamp(simParams.blockBase + defense.defense, 0, 40))) {
      const blocker = weightedChoice(defense.players, "BLK", rng);
      if (blocker) {
        add(defensePlayerStats[blocker.name], "BLK");
        add(defenseTeamStats, "BLK");
      }
    }

    const orbChance = matchupOffensiveReboundChance(offense, defense);
    if (pctRoll(rng, orbChance) && extensions < simParams.maxOrbExtensions) {
      const rebounder = weightedChoice(offense.players, "OREB", rng);
      if (rebounder) {
        add(offensePlayerStats[rebounder.name], "OREB");
        add(offenseTeamStats, "OREB");
      }
      extensions += 1;
      continue;
    }

    const rebounder = weightedChoice(defense.players, "DREB", rng);
    if (rebounder) {
      add(defensePlayerStats[rebounder.name], "DREB");
      add(defenseTeamStats, "DREB");
    }
    return;
  }
}

function finalizePlayerStats(stats: Record<string, StatLine>): void {
  for (const playerStats of Object.values(stats)) {
    playerStats.REB = (playerStats.OREB ?? 0) + (playerStats.DREB ?? 0);
  }
}

export function simulateGame(away: DiceTeamCard, home: DiceTeamCard, seed = Date.now(), source: "simulated" | "manual" = "simulated"): GameResult {
  const rng = new SeededRandom(seed);
  const matchup = buildMatchupCard(away, home);
  const awayTeamStats = emptyTeamStats();
  const homeTeamStats = emptyTeamStats();
  const awayPlayerStats = emptyPlayerStats(away);
  const homePlayerStats = emptyPlayerStats(home);
  const quarters: Array<{ away: number; home: number }> = [];

  for (const possessions of matchup.quarters) {
    const awayBefore = awayTeamStats.PTS;
    const homeBefore = homeTeamStats.PTS;
    for (let possession = 0; possession < possessions; possession += 1) {
      resolvePossession(away, home, awayPlayerStats, homePlayerStats, awayTeamStats, homeTeamStats, rng);
      resolvePossession(home, away, homePlayerStats, awayPlayerStats, homeTeamStats, awayTeamStats, rng);
    }
    quarters.push({
      away: awayTeamStats.PTS - awayBefore,
      home: homeTeamStats.PTS - homeBefore
    });
  }

  finalizePlayerStats(awayPlayerStats);
  finalizePlayerStats(homePlayerStats);

  const winnerTeamId = awayTeamStats.PTS > homeTeamStats.PTS ? away.id : homeTeamStats.PTS > awayTeamStats.PTS ? home.id : "tie";

  return {
    id: `game-${seed}-${away.id}-at-${home.id}`,
    awayTeamId: away.id,
    homeTeamId: home.id,
    awayScore: awayTeamStats.PTS,
    homeScore: homeTeamStats.PTS,
    winnerTeamId,
    possessionsEach: matchup.possessionsEach,
    quarters,
    teamStats: {
      [away.id]: awayTeamStats,
      [home.id]: homeTeamStats
    },
    playerStats: {
      [away.id]: awayPlayerStats,
      [home.id]: homePlayerStats
    },
    source,
    playedAt: new Date().toISOString()
  };
}

export function summarizeSimulations(away: DiceTeamCard, home: DiceTeamCard, games: number, seed = Date.now()) {
  const rng = new SeededRandom(seed);
  const teamTotals: Record<string, StatLine[]> = { [away.id]: [], [home.id]: [] };
  const playerTotals: Record<string, Record<string, StatLine[]>> = { [away.id]: {}, [home.id]: {} };
  const wins: Record<string, number> = { [away.id]: 0, [home.id]: 0, tie: 0 };

  for (let index = 0; index < games; index += 1) {
    const result = simulateGame(away, home, rng.pickSeed());
    wins[result.winnerTeamId] = (wins[result.winnerTeamId] ?? 0) + 1;
    for (const team of [away, home]) {
      teamTotals[team.id].push(result.teamStats[team.id]);
      for (const [player, line] of Object.entries(result.playerStats[team.id])) {
        playerTotals[team.id][player] ??= [];
        playerTotals[team.id][player].push(line);
      }
    }
  }

  const averageLine = (lines: StatLine[]) => {
    const out: StatLine = {};
    for (const field of [...statFields, "poss", "nonshooting_fouls_drawn"]) {
      out[field] = lines.reduce((sum, line) => sum + (line[field] ?? 0), 0) / Math.max(1, lines.length);
    }
    return out;
  };

  return {
    games,
    wins,
    teams: {
      [away.id]: averageLine(teamTotals[away.id]),
      [home.id]: averageLine(teamTotals[home.id])
    },
    players: Object.fromEntries(
      [away, home].map((team) => [
        team.id,
        Object.fromEntries(Object.entries(playerTotals[team.id]).map(([player, lines]) => [player, averageLine(lines)]))
      ])
    ) as Record<string, Record<string, StatLine>>
  };
}

export function createManualResult(away: DiceTeamCard, home: DiceTeamCard, awayScore: number, homeScore: number): GameResult {
  const awayStats = emptyTeamStats();
  const homeStats = emptyTeamStats();
  awayStats.PTS = awayScore;
  homeStats.PTS = homeScore;
  return {
    id: `manual-${Date.now()}-${away.id}-at-${home.id}`,
    awayTeamId: away.id,
    homeTeamId: home.id,
    awayScore,
    homeScore,
    winnerTeamId: awayScore > homeScore ? away.id : homeScore > awayScore ? home.id : "tie",
    possessionsEach: Math.round((away.pace + home.pace) / 2),
    quarters: [],
    teamStats: {
      [away.id]: awayStats,
      [home.id]: homeStats
    },
    playerStats: {
      [away.id]: emptyPlayerStats(away),
      [home.id]: emptyPlayerStats(home)
    },
    source: "manual",
    playedAt: new Date().toISOString()
  };
}
