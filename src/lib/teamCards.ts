import type { DicePlayerCard, DiceTeamCard, SourcePlayer, SourceTeam } from "./types";

const fallbackPace = 98;
const fallbackRating = 113;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(Number.isFinite(value) ? value : 0);
}

function nz(value: number | null | undefined, fallback = 0): number {
  return value === null || value === undefined || Number.isNaN(value) ? fallback : value;
}

function pctToD100(value: number | null | undefined, fallback: number): number {
  if (value === null || value === undefined || Number.isNaN(value)) return fallback;
  return clamp(round(value * 100), 1, 99);
}

function average(teams: SourceTeam[], pick: (team: SourceTeam) => number | null): number {
  const values = teams.map(pick).filter((value): value is number => value !== null && Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function rotationPlayers(players: SourcePlayer[]): SourcePlayer[] {
  const sorted = [...players].sort((a, b) => nz(b.minutes) - nz(a.minutes));
  const topMinutes = sorted.filter((player) => nz(player.minutes) >= 300);
  const core = topMinutes.length >= 8 ? topMinutes : sorted.slice(0, Math.min(10, sorted.length));
  return core.slice(0, 12);
}

function loadWeight(player: SourcePlayer): number {
  const usage = nz(player.advanced.usagePct, 12);
  const minutes = nz(player.minutes, 1);
  const playmaking = nz(player.totals.ast) * 0.18;
  return Math.max(0.1, usage * minutes + playmaking);
}

function playerCard(teamId: string, player: SourcePlayer): DicePlayerCard {
  const fga = nz(player.totals.fga);
  const fg3a = nz(player.totals.fg3a);
  const fg2Pct = player.totals.fg2Pct ?? player.shooting.fgPct2p;
  const fg3Pct = player.totals.fg3Pct ?? player.shooting.fgPct3p;
  const ftPct = player.totals.ftPct;
  const threeRate = player.shooting.pctFga3p ?? (fga > 0 ? fg3a / fga : player.advanced.threeAttemptRate);
  const ftaPer100 = nz(player.per100.fta, nz(player.perGame.fta) * 2.1);
  const drawn = nz(player.playByPlay.drawnShooting) / Math.max(1, nz(player.games, 82));
  const tovPer100 = nz(player.per100.tov, nz(player.perGame.tov) * 2.1);
  const tovPct = nz(player.advanced.tovPct, 10);

  return {
    id: `${teamId}:${player.name}`,
    teamId,
    name: player.name,
    position: player.position,
    minutes: nz(player.minutes),
    useWeight: loadWeight(player),
    tov: clamp(round(tovPer100 * 1.25 + tovPct * 0.12), 1, 22),
    fd: clamp(round(ftaPer100 * 1.1 + drawn * 0.6), 1, 22),
    threeFrequency: clamp(round(nz(threeRate, 0.25) * 100), 0, 95),
    p2: pctToD100(fg2Pct, pctToD100(player.totals.fgPct, 46)),
    p3: pctToD100(fg3Pct, player.totals.fg3a ? 34 : 1),
    ft: pctToD100(ftPct, 72),
    astWeight: Math.max(0, nz(player.totals.ast)),
    orbWeight: Math.max(0, nz(player.totals.orb)),
    drbWeight: Math.max(0, nz(player.totals.drb)),
    stlWeight: Math.max(0, nz(player.totals.stl)),
    blkWeight: Math.max(0, nz(player.totals.blk)),
    pfWeight: Math.max(0, nz(player.totals.pf)),
    source: player
  };
}

export function buildDiceTeamCards(sourceTeams: SourceTeam[]): DiceTeamCard[] {
  const baselines = {
    offensiveRating: average(sourceTeams, (team) => team.team.offensiveRating),
    defensiveRating: average(sourceTeams, (team) => team.team.defensiveRating),
    efgPct: average(sourceTeams, (team) => team.team.efgPct),
    opponentEfgPct: average(sourceTeams, (team) => team.team.opponentEfgPct),
    turnoverPct: average(sourceTeams, (team) => team.team.turnoverPct),
    opponentTurnoverPct: average(sourceTeams, (team) => team.team.opponentTurnoverPct),
    freeThrowRate: average(sourceTeams, (team) => team.team.freeThrowRate),
    opponentFreeThrowRate: average(sourceTeams, (team) => team.team.opponentFreeThrowRate),
    threeAttemptRate: average(sourceTeams, (team) => team.team.threeAttemptRate),
    offensiveReboundPct: average(sourceTeams, (team) => team.team.offensiveReboundPct),
    defensiveReboundPct: average(sourceTeams, (team) => team.team.defensiveReboundPct)
  };

  return sourceTeams.map((source) => {
    const team = source.team;
    const fg = nz(team.totals.fg, 1);
    const astRate = clamp(round((nz(team.totals.ast) / Math.max(1, fg)) * 100), 15, 95);
    const players = rotationPlayers(source.players).map((player) => playerCard(source.id, player));
    const shotQualityRaw =
      (nz(team.offensiveRating, fallbackRating) - baselines.offensiveRating) * 0.22 +
      (nz(team.efgPct, baselines.efgPct) - baselines.efgPct) * 120;
    const defenseRaw =
      (baselines.defensiveRating - nz(team.defensiveRating, fallbackRating)) * 0.28 +
      (baselines.opponentEfgPct - nz(team.opponentEfgPct, baselines.opponentEfgPct)) * 100;

    return {
      id: source.id,
      name: source.name,
      shortName: source.shortName,
      abbr: source.abbr,
      season: source.season,
      pace: nz(team.pace, fallbackPace),
      offensiveRating: nz(team.offensiveRating, fallbackRating),
      defensiveRating: nz(team.defensiveRating, fallbackRating),
      shotQuality: clamp(round(shotQualityRaw), -6, 6),
      defense: clamp(round(defenseRaw), -8, 8),
      toPress: clamp(round((nz(team.opponentTurnoverPct, baselines.opponentTurnoverPct) - baselines.opponentTurnoverPct) * 0.75), -5, 5),
      toProtect: clamp(round((baselines.turnoverPct - nz(team.turnoverPct, baselines.turnoverPct)) * 0.75), -5, 5),
      foulDraw: clamp(round((nz(team.freeThrowRate, baselines.freeThrowRate) - baselines.freeThrowRate) * 16), -5, 5),
      foulDiscipline: clamp(round((baselines.opponentFreeThrowRate - nz(team.opponentFreeThrowRate, baselines.opponentFreeThrowRate)) * 16), -5, 5),
      threeTendency: clamp(round((nz(team.threeAttemptRate, baselines.threeAttemptRate) - baselines.threeAttemptRate) * 18), -8, 8),
      orb: clamp(round((nz(team.offensiveReboundPct, baselines.offensiveReboundPct) - baselines.offensiveReboundPct) * 0.38), -7, 7),
      drb: clamp(round((nz(team.defensiveReboundPct, baselines.defensiveReboundPct) - baselines.defensiveReboundPct) * 0.38), -7, 7),
      assistMade2: astRate,
      assistMade3: clamp(astRate + 8, 0, 95),
      players,
      source
    };
  });
}

export const derivationNotes = [
  "Pace, offensive rating, defensive rating, eFG%, turnover rates, rebound rates, free throw rate, and 3PA rate come from Basketball Reference team misc tables.",
  "Player usage weights combine Basketball Reference usage percentage, minutes, and a small playmaking component so high-minute creators dominate action rolls without excluding specialists.",
  "Shot, free throw, rebound, steal, block, turnover, foul, and assist weights come from source totals, per-100 possession stats, advanced percentages, shooting tables, and play-by-play tables when available.",
  "Team modifier baselines are computed from the current source library. Adding league-average source pages is the next calibration upgrade."
];
