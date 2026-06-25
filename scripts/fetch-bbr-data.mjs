#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const rawDir = path.join(root, "src", "data", "bbr", "raw");

const argValues = new Map(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith("--") && arg.includes("="))
    .map((arg) => {
      const [key, ...rest] = arg.slice(2).split("=");
      return [key, rest.join("=")];
    })
);
const flags = new Set(process.argv.slice(2).filter((arg) => arg.startsWith("--") && !arg.includes("=")).map((arg) => arg.slice(2)));
const manifestPath = path.resolve(argValues.get("manifest") ?? path.join(root, "data", "source-manifest.json"));
const generatedPath = path.resolve(argValues.get("output") ?? path.join(root, "data", "teams.generated.json"));
const session = argValues.get("session") ?? "basketball-dice-bbr";
const useCache = process.argv.includes("--use-cache");
const fetchOnly = flags.has("fetch-only");
const teamsOnly = flags.has("teams-only");
const leaguesOnly = flags.has("leagues-only");
const startYear = argValues.has("start-year") ? Number(argValues.get("start-year")) : null;
const endYear = argValues.has("end-year") ? Number(argValues.get("end-year")) : null;
const teamOffset = argValues.has("team-offset") ? Number(argValues.get("team-offset")) : 0;
const teamLimit = argValues.has("team-limit") ? Number(argValues.get("team-limit")) : Infinity;

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

function inYearRange(item) {
  if (startYear !== null && item.seasonEndYear < startYear) return false;
  if (endYear !== null && item.seasonEndYear > endYear) return false;
  return true;
}

if ([startYear, endYear, teamOffset, teamLimit].some((value) => value !== null && value !== Infinity && (!Number.isFinite(value) || value < 0))) {
  throw new Error(
    "Usage: node scripts/fetch-bbr-data.mjs [--use-cache] [--fetch-only] [--teams-only] [--leagues-only] [--session=name] [--manifest=data/source-manifest.json] [--output=data/teams.generated.json] [--start-year=1990] [--end-year=2025] [--team-offset=0] [--team-limit=100]"
  );
}

if (teamsOnly && leaguesOnly) {
  throw new Error("--teams-only and --leagues-only cannot be used together.");
}

const selectedTeams = leaguesOnly
  ? []
  : manifest.teams.filter(inYearRange).slice(teamOffset, teamLimit === Infinity ? undefined : teamOffset + teamLimit);
const selectedLeagues = teamsOnly ? [] : (manifest.leagueSources ?? []).filter(inYearRange);

function runAgentBrowser(args, input = undefined, options = {}) {
  const result = spawnSync("agent-browser", args, {
    input,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 50,
    timeout: 300000,
    ...options
  });

  if (result.error) {
    throw result.error;
  }

  return {
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  };
}

function closeAgentBrowserSession() {
  spawnSync("agent-browser", ["--session", session, "close"], {
    encoding: "utf8",
    timeout: 15000,
    maxBuffer: 1024 * 1024
  });
}

process.once("exit", closeAgentBrowserSession);

function evalPage(expression) {
  const result = runAgentBrowser(["--session", session, "eval", "--stdin"], expression);
  if (result.status !== 0) {
    throw new Error(result.stderr || "agent-browser eval failed");
  }
  return JSON.parse(result.stdout);
}

function normalizeTableMap(tables) {
  return Object.fromEntries(tables.filter((table) => table.id).map((table) => [table.id, table]));
}

function num(value) {
  if (value === undefined || value === null || value === "") return null;
  const cleaned = String(value).replace(/[$,%]/g, "").trim();
  if (cleaned === "" || cleaned === "-") return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function cell(row, key) {
  return row?.[key]?.text ?? "";
}

function href(row, key) {
  return row?.[key]?.href ?? "";
}

function playerSourceId(url) {
  const match = String(url).match(/\/players\/[^/]+\/([^/.]+)\.html$/);
  return match?.[1] ?? "";
}

function firstRow(table) {
  return table?.rows?.[0] ?? {};
}

function cleanTeamName(name) {
  return String(name).replace(/\*/g, "").trim();
}

function cleanPlayerName(name) {
  return String(name).replace(/\*/g, "").trim();
}

function playerRowKey(row, nameKey = "name_display") {
  const sourceUrl = href(row, nameKey) || href(row, "player");
  return playerSourceId(sourceUrl) || cleanPlayerName(cell(row, nameKey) || cell(row, "player"));
}

function sumRows(rows, key) {
  return rows.reduce((sum, row) => sum + (num(cell(row, key)) ?? 0), 0);
}

function ratio(numerator, denominator) {
  if (numerator === null || numerator === undefined || denominator === null || denominator === undefined) return null;
  return denominator > 0 ? numerator / denominator : null;
}

function values(rows, key) {
  return rows.map((row) => num(cell(row, key))).filter((value) => value !== null && Number.isFinite(value));
}

function mean(items) {
  if (!items.length) return null;
  return items.reduce((sum, value) => sum + value, 0) / items.length;
}

function stdev(items) {
  if (items.length <= 1) return 0;
  const avg = mean(items);
  return Math.sqrt(items.reduce((sum, value) => sum + (value - avg) ** 2, 0) / items.length);
}

function distribution(rows, key) {
  const items = values(rows, key);
  return {
    mean: mean(items),
    stdev: stdev(items),
    min: Math.min(...items),
    max: Math.max(...items)
  };
}

function weightedDistribution(rows, key, weightKey = "mp", minWeight = 0) {
  const items = rows
    .map((row) => ({ value: num(cell(row, key)), weight: num(cell(row, weightKey)) }))
    .filter((item) => item.value !== null && item.weight !== null && Number.isFinite(item.value) && Number.isFinite(item.weight) && item.weight >= minWeight);
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  if (!items.length || totalWeight <= 0) {
    throw new Error(`No weighted values for ${key}`);
  }
  const avg = items.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight;
  return {
    mean: avg,
    stdev: Math.sqrt(items.reduce((sum, item) => sum + item.weight * (item.value - avg) ** 2, 0) / totalWeight),
    min: Math.min(...items.map((item) => item.value)),
    max: Math.max(...items.map((item) => item.value))
  };
}

function requireNumber(value, label) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    throw new Error(`Missing required source value: ${label}`);
  }
  return value;
}

function derivePct(makes, attempts, label) {
  if (attempts === 0) return null;
  const value = ratio(makes, attempts);
  if (value === null) throw new Error(`Cannot derive ${label}`);
  return value;
}

function opponentTotalsFromTeamAndOpponent(table) {
  return table?.rows?.find((row) => cell(row, "opp_fg") || cell(row, "opp_fga") || cell(row, "opp_pts")) ?? {};
}

function playerStatProfile(perGame = {}, totals = {}, perPoss = {}, advanced = {}, shooting = {}, pbp = {}) {
  if (!playerRowKey(perGame)) return null;
  return {
    games: num(cell(perGame, "games")),
    gamesStarted: num(cell(perGame, "games_started")),
    minutes: num(cell(totals, "mp")),
    perGame: {
      mp: num(cell(perGame, "mp_per_g")),
      pts: num(cell(perGame, "pts_per_g")),
      trb: num(cell(perGame, "trb_per_g")),
      ast: num(cell(perGame, "ast_per_g")),
      stl: num(cell(perGame, "stl_per_g")),
      blk: num(cell(perGame, "blk_per_g")),
      tov: num(cell(perGame, "tov_per_g")),
      pf: num(cell(perGame, "pf_per_g")),
      fga: num(cell(perGame, "fga_per_g")),
      fg3a: num(cell(perGame, "fg3a_per_g")),
      fta: num(cell(perGame, "fta_per_g"))
    },
    totals: {
      fg: num(cell(totals, "fg")),
      fga: num(cell(totals, "fga")),
      fgPct: num(cell(totals, "fg_pct")),
      fg3: num(cell(totals, "fg3")),
      fg3a: num(cell(totals, "fg3a")),
      fg3Pct: num(cell(totals, "fg3_pct")),
      fg2: num(cell(totals, "fg2")),
      fg2a: num(cell(totals, "fg2a")),
      fg2Pct: num(cell(totals, "fg2_pct")),
      ft: num(cell(totals, "ft")),
      fta: num(cell(totals, "fta")),
      ftPct: num(cell(totals, "ft_pct")),
      orb: num(cell(totals, "orb")),
      drb: num(cell(totals, "drb")),
      trb: num(cell(totals, "trb")),
      ast: num(cell(totals, "ast")),
      stl: num(cell(totals, "stl")),
      blk: num(cell(totals, "blk")),
      tov: num(cell(totals, "tov")),
      pf: num(cell(totals, "pf")),
      pts: num(cell(totals, "pts"))
    },
    per100: {
      fga: num(cell(perPoss, "fga_per_poss")),
      fg3a: num(cell(perPoss, "fg3a_per_poss")),
      fta: num(cell(perPoss, "fta_per_poss")),
      orb: num(cell(perPoss, "orb_per_poss")),
      drb: num(cell(perPoss, "drb_per_poss")),
      trb: num(cell(perPoss, "trb_per_poss")),
      ast: num(cell(perPoss, "ast_per_poss")),
      stl: num(cell(perPoss, "stl_per_poss")),
      blk: num(cell(perPoss, "blk_per_poss")),
      tov: num(cell(perPoss, "tov_per_poss")),
      pf: num(cell(perPoss, "pf_per_poss")),
      pts: num(cell(perPoss, "pts_per_poss")),
      offRtg: num(cell(perPoss, "off_rtg")),
      defRtg: num(cell(perPoss, "def_rtg"))
    },
    advanced: {
      usagePct: num(cell(advanced, "usg_pct")),
      tsPct: num(cell(advanced, "ts_pct")),
      threeAttemptRate: num(cell(advanced, "fg3a_per_fga_pct")),
      freeThrowRate: num(cell(advanced, "fta_per_fga_pct")),
      orbPct: num(cell(advanced, "orb_pct")),
      drbPct: num(cell(advanced, "drb_pct")),
      trbPct: num(cell(advanced, "trb_pct")),
      astPct: num(cell(advanced, "ast_pct")),
      stlPct: num(cell(advanced, "stl_pct")),
      blkPct: num(cell(advanced, "blk_pct")),
      tovPct: num(cell(advanced, "tov_pct")),
      ows: num(cell(advanced, "ows")),
      dws: num(cell(advanced, "dws")),
      ws: num(cell(advanced, "ws")),
      obpm: num(cell(advanced, "obpm")),
      dbpm: num(cell(advanced, "dbpm")),
      bpm: num(cell(advanced, "bpm"))
    },
    shooting: {
      avgDistance: num(cell(shooting, "avg_dist")),
      pctFga2p: num(cell(shooting, "pct_fga_fg2a")),
      pctFga00_03: num(cell(shooting, "pct_fga_00_03")),
      pctFga03_10: num(cell(shooting, "pct_fga_03_10")),
      pctFga10_16: num(cell(shooting, "pct_fga_10_16")),
      pctFga16_xx: num(cell(shooting, "pct_fga_16_xx")),
      pctFga3p: num(cell(shooting, "pct_fga_fg3a")),
      fgPct2p: num(cell(shooting, "fg_pct_fg2a")),
      fgPct00_03: num(cell(shooting, "fg_pct_00_03")),
      fgPct03_10: num(cell(shooting, "fg_pct_03_10")),
      fgPct10_16: num(cell(shooting, "fg_pct_10_16")),
      fgPct16_xx: num(cell(shooting, "fg_pct_16_xx")),
      fgPct3p: num(cell(shooting, "fg_pct_fg3a")),
      pctAst2p: num(cell(shooting, "pct_ast_fg2")),
      pctAst3p: num(cell(shooting, "pct_ast_fg3")),
      pctFgaDunk: num(cell(shooting, "pct_fga_dunk")),
      fgDunk: num(cell(shooting, "fg_dunk")),
      pctCorner3: num(cell(shooting, "pct_fg3a_corner3")),
      corner3Pct: num(cell(shooting, "fg_pct_corner3"))
    },
    playByPlay: {
      plusMinusOn: num(cell(pbp, "plus_minus_on")),
      plusMinusNet: num(cell(pbp, "plus_minus_net")),
      badPassTurnovers: num(cell(pbp, "tov_bad_pass")),
      lostBallTurnovers: num(cell(pbp, "tov_lost_ball")),
      shootingFouls: num(cell(pbp, "fouls_shooting")),
      offensiveFouls: num(cell(pbp, "fouls_offensive")),
      drawnShooting: num(cell(pbp, "drawn_shooting")),
      drawnOffensive: num(cell(pbp, "drawn_offensive")),
      assistedPoints: num(cell(pbp, "astd_pts")),
      andOnes: num(cell(pbp, "and1s")),
      ownShotsBlocked: num(cell(pbp, "own_shots_blk"))
    }
  };
}

function normalizeTeam(def, page) {
  const tableMap = normalizeTableMap(page.tables);
  const requiredTables = ["team_misc", "team_and_opponent", "per_game_stats", "totals_stats", "per_poss", "advanced", "roster"];
  const missing = requiredTables.filter((tableId) => !tableMap[tableId]?.rows?.length);
  if (missing.length) {
    throw new Error(`Missing required team tables for ${def.id}: ${missing.join(", ")}`);
  }

  const teamMisc = firstRow(tableMap.team_misc);
  const teamTotals = firstRow(tableMap.team_and_opponent);
  const opponentTotals = opponentTotalsFromTeamAndOpponent(tableMap.team_and_opponent);
  const perGameRows = tableMap.per_game_stats?.rows ?? [];
  const totalsRows = tableMap.totals_stats?.rows ?? [];
  const perPossRows = tableMap.per_poss?.rows ?? [];
  const advancedRows = tableMap.advanced?.rows ?? [];
  const shootingRows = tableMap.shooting?.rows ?? [];
  const pbpRows = tableMap.pbp_stats?.rows ?? [];
  const postPerGameRows = tableMap.per_game_stats_post?.rows ?? [];
  const postTotalsRows = tableMap.totals_stats_post?.rows ?? [];
  const postPerPossRows = tableMap.per_poss_post?.rows ?? [];
  const postAdvancedRows = tableMap.advanced_post?.rows ?? [];
  const postShootingRows = tableMap.shooting_post?.rows ?? [];
  const postPbpRows = tableMap.pbp_stats_post?.rows ?? [];
  const rosterRows = tableMap.roster?.rows ?? [];

  const byPlayerKey = (rows, nameKey = "name_display") =>
    new Map(rows.map((row) => [playerRowKey(row, nameKey), row]).filter(([key]) => key));

  const totalsByPlayer = byPlayerKey(totalsRows);
  const perPossByPlayer = byPlayerKey(perPossRows);
  const advancedByPlayer = byPlayerKey(advancedRows);
  const shootingByPlayer = byPlayerKey(shootingRows);
  const pbpByPlayer = byPlayerKey(pbpRows);
  const postPerGameByPlayer = byPlayerKey(postPerGameRows);
  const postTotalsByPlayer = byPlayerKey(postTotalsRows);
  const postPerPossByPlayer = byPlayerKey(postPerPossRows);
  const postAdvancedByPlayer = byPlayerKey(postAdvancedRows);
  const postShootingByPlayer = byPlayerKey(postShootingRows);
  const postPbpByPlayer = byPlayerKey(postPbpRows);
  const rosterByPlayer = byPlayerKey(rosterRows, "player");

  const players = perGameRows
    .map((perGame) => {
      const playerKey = playerRowKey(perGame);
      const name = cleanPlayerName(cell(perGame, "name_display"));
      const totals = totalsByPlayer.get(playerKey) ?? {};
      const perPoss = perPossByPlayer.get(playerKey) ?? {};
      const advanced = advancedByPlayer.get(playerKey) ?? {};
      const shooting = shootingByPlayer.get(playerKey) ?? {};
      const pbp = pbpByPlayer.get(playerKey) ?? {};
      const roster = rosterByPlayer.get(playerKey) ?? {};
      const sourceUrl = href(perGame, "name_display") || href(totals, "name_display") || href(roster, "player");
      const postseason = playerStatProfile(
        postPerGameByPlayer.get(playerKey),
        postTotalsByPlayer.get(playerKey),
        postPerPossByPlayer.get(playerKey),
        postAdvancedByPlayer.get(playerKey),
        postShootingByPlayer.get(playerKey),
        postPbpByPlayer.get(playerKey)
      );

      return {
        sourceId: playerSourceId(sourceUrl),
        sourceUrl,
        name,
        position: cell(perGame, "pos") || cell(roster, "pos"),
        age: num(cell(perGame, "age")),
        games: num(cell(perGame, "games")),
        gamesStarted: num(cell(perGame, "games_started")),
        minutes: num(cell(totals, "mp")),
        perGame: {
          mp: num(cell(perGame, "mp_per_g")),
          pts: num(cell(perGame, "pts_per_g")),
          trb: num(cell(perGame, "trb_per_g")),
          ast: num(cell(perGame, "ast_per_g")),
          stl: num(cell(perGame, "stl_per_g")),
          blk: num(cell(perGame, "blk_per_g")),
          tov: num(cell(perGame, "tov_per_g")),
          pf: num(cell(perGame, "pf_per_g")),
          fga: num(cell(perGame, "fga_per_g")),
          fg3a: num(cell(perGame, "fg3a_per_g")),
          fta: num(cell(perGame, "fta_per_g"))
        },
        totals: {
          fg: num(cell(totals, "fg")),
          fga: num(cell(totals, "fga")),
          fgPct: num(cell(totals, "fg_pct")),
          fg3: num(cell(totals, "fg3")),
          fg3a: num(cell(totals, "fg3a")),
          fg3Pct: num(cell(totals, "fg3_pct")),
          fg2: num(cell(totals, "fg2")),
          fg2a: num(cell(totals, "fg2a")),
          fg2Pct: num(cell(totals, "fg2_pct")),
          ft: num(cell(totals, "ft")),
          fta: num(cell(totals, "fta")),
          ftPct: num(cell(totals, "ft_pct")),
          orb: num(cell(totals, "orb")),
          drb: num(cell(totals, "drb")),
          trb: num(cell(totals, "trb")),
          ast: num(cell(totals, "ast")),
          stl: num(cell(totals, "stl")),
          blk: num(cell(totals, "blk")),
          tov: num(cell(totals, "tov")),
          pf: num(cell(totals, "pf")),
          pts: num(cell(totals, "pts"))
        },
        per100: {
          fga: num(cell(perPoss, "fga_per_poss")),
          fg3a: num(cell(perPoss, "fg3a_per_poss")),
          fta: num(cell(perPoss, "fta_per_poss")),
          orb: num(cell(perPoss, "orb_per_poss")),
          drb: num(cell(perPoss, "drb_per_poss")),
          trb: num(cell(perPoss, "trb_per_poss")),
          ast: num(cell(perPoss, "ast_per_poss")),
          stl: num(cell(perPoss, "stl_per_poss")),
          blk: num(cell(perPoss, "blk_per_poss")),
          tov: num(cell(perPoss, "tov_per_poss")),
          pf: num(cell(perPoss, "pf_per_poss")),
          pts: num(cell(perPoss, "pts_per_poss")),
          offRtg: num(cell(perPoss, "off_rtg")),
          defRtg: num(cell(perPoss, "def_rtg"))
        },
        advanced: {
          usagePct: num(cell(advanced, "usg_pct")),
          tsPct: num(cell(advanced, "ts_pct")),
          threeAttemptRate: num(cell(advanced, "fg3a_per_fga_pct")),
          freeThrowRate: num(cell(advanced, "fta_per_fga_pct")),
          orbPct: num(cell(advanced, "orb_pct")),
          drbPct: num(cell(advanced, "drb_pct")),
          trbPct: num(cell(advanced, "trb_pct")),
          astPct: num(cell(advanced, "ast_pct")),
          stlPct: num(cell(advanced, "stl_pct")),
          blkPct: num(cell(advanced, "blk_pct")),
          tovPct: num(cell(advanced, "tov_pct")),
          ows: num(cell(advanced, "ows")),
          dws: num(cell(advanced, "dws")),
          ws: num(cell(advanced, "ws")),
          obpm: num(cell(advanced, "obpm")),
          dbpm: num(cell(advanced, "dbpm")),
          bpm: num(cell(advanced, "bpm"))
        },
        shooting: {
          avgDistance: num(cell(shooting, "avg_dist")),
          pctFga2p: num(cell(shooting, "pct_fga_fg2a")),
          pctFga00_03: num(cell(shooting, "pct_fga_00_03")),
          pctFga03_10: num(cell(shooting, "pct_fga_03_10")),
          pctFga10_16: num(cell(shooting, "pct_fga_10_16")),
          pctFga16_xx: num(cell(shooting, "pct_fga_16_xx")),
          pctFga3p: num(cell(shooting, "pct_fga_fg3a")),
          fgPct2p: num(cell(shooting, "fg_pct_fg2a")),
          fgPct00_03: num(cell(shooting, "fg_pct_00_03")),
          fgPct03_10: num(cell(shooting, "fg_pct_03_10")),
          fgPct10_16: num(cell(shooting, "fg_pct_10_16")),
          fgPct16_xx: num(cell(shooting, "fg_pct_16_xx")),
          fgPct3p: num(cell(shooting, "fg_pct_fg3a")),
          pctAst2p: num(cell(shooting, "pct_ast_fg2")),
          pctAst3p: num(cell(shooting, "pct_ast_fg3")),
          pctFgaDunk: num(cell(shooting, "pct_fga_dunk")),
          fgDunk: num(cell(shooting, "fg_dunk")),
          pctCorner3: num(cell(shooting, "pct_fg3a_corner3")),
          corner3Pct: num(cell(shooting, "fg_pct_corner3"))
        },
        playByPlay: {
          plusMinusOn: num(cell(pbp, "plus_minus_on")),
          plusMinusNet: num(cell(pbp, "plus_minus_net")),
          badPassTurnovers: num(cell(pbp, "tov_bad_pass")),
          lostBallTurnovers: num(cell(pbp, "tov_lost_ball")),
          shootingFouls: num(cell(pbp, "fouls_shooting")),
          offensiveFouls: num(cell(pbp, "fouls_offensive")),
          drawnShooting: num(cell(pbp, "drawn_shooting")),
          drawnOffensive: num(cell(pbp, "drawn_offensive")),
          assistedPoints: num(cell(pbp, "astd_pts")),
          andOnes: num(cell(pbp, "and1s")),
          ownShotsBlocked: num(cell(pbp, "own_shots_blk"))
        },
        postseason,
        roster: {
          number: cell(roster, "number"),
          height: cell(roster, "height"),
          weight: num(cell(roster, "weight")),
          birthDate: cell(roster, "birth_date"),
          college: cell(roster, "college")
        }
      };
    })
    .filter((player) => player.name);

  return {
    id: def.id,
    name: def.name,
    shortName: def.shortName,
    franchise: def.franchise,
    abbr: def.abbr,
    season: def.season,
    seasonEndYear: def.seasonEndYear,
    source: {
      provider: "Basketball Reference",
      url: def.sourceUrl,
      fetchedAt: page.fetchedAt,
      pageTitle: page.title,
      h1: page.heading,
      tableIds: page.tables.map((table) => table.id).filter(Boolean)
    },
    team: {
      wins: num(cell(teamMisc, "wins")),
      losses: num(cell(teamMisc, "losses")),
      pace: num(cell(teamMisc, "pace")),
      offensiveRating: num(cell(teamMisc, "off_rtg")),
      defensiveRating: num(cell(teamMisc, "def_rtg")),
      expectedWins: num(cell(teamMisc, "wins_pyth")),
      expectedLosses: num(cell(teamMisc, "losses_pyth")),
      simpleRating: num(cell(teamMisc, "srs")),
      strengthOfSchedule: num(cell(teamMisc, "sos")),
      marginOfVictory: num(cell(teamMisc, "mov")),
      efgPct: num(cell(teamMisc, "efg_pct")),
      turnoverPct: num(cell(teamMisc, "tov_pct")),
      offensiveReboundPct: num(cell(teamMisc, "orb_pct")),
      freeThrowAttemptRate: num(cell(teamMisc, "fta_per_fga_pct")),
      freeThrowRate: num(cell(teamMisc, "ft_rate")),
      opponentEfgPct: num(cell(teamMisc, "opp_efg_pct")),
      opponentTurnoverPct: num(cell(teamMisc, "opp_tov_pct")),
      defensiveReboundPct: num(cell(teamMisc, "drb_pct")),
      opponentFreeThrowAttemptRate: derivePct(num(cell(opponentTotals, "opp_fta")), num(cell(opponentTotals, "opp_fga")), `${def.id} opponent FTA/FGA`),
      opponentFreeThrowRate: num(cell(teamMisc, "opp_ft_rate")),
      threeAttemptRate: num(cell(teamMisc, "fg3a_per_fga_pct")),
      totals: {
        fg: num(cell(teamTotals, "fg")),
        fga: num(cell(teamTotals, "fga")),
        fg3: num(cell(teamTotals, "fg3")),
        fg3a: num(cell(teamTotals, "fg3a")),
        fg2: num(cell(teamTotals, "fg2")),
        fg2a: num(cell(teamTotals, "fg2a")),
        ft: num(cell(teamTotals, "ft")),
        fta: num(cell(teamTotals, "fta")),
        orb: num(cell(teamTotals, "orb")),
        drb: num(cell(teamTotals, "drb")),
        trb: num(cell(teamTotals, "trb")),
        ast: num(cell(teamTotals, "ast")),
        stl: num(cell(teamTotals, "stl")),
        blk: num(cell(teamTotals, "blk")),
        tov: num(cell(teamTotals, "tov")),
        pf: num(cell(teamTotals, "pf")),
        pts: num(cell(teamTotals, "pts"))
      },
      opponentTotals: {
        fg: num(cell(opponentTotals, "opp_fg")),
        fga: num(cell(opponentTotals, "opp_fga")),
        fg3: num(cell(opponentTotals, "opp_fg3")),
        fg3a: num(cell(opponentTotals, "opp_fg3a")),
        fg2: num(cell(opponentTotals, "opp_fg2")),
        fg2a: num(cell(opponentTotals, "opp_fg2a")),
        ft: num(cell(opponentTotals, "opp_ft")),
        fta: num(cell(opponentTotals, "opp_fta")),
        orb: num(cell(opponentTotals, "opp_orb")),
        drb: num(cell(opponentTotals, "opp_drb")),
        trb: num(cell(opponentTotals, "opp_trb")),
        ast: num(cell(opponentTotals, "opp_ast")),
        stl: num(cell(opponentTotals, "opp_stl")),
        blk: num(cell(opponentTotals, "opp_blk")),
        tov: num(cell(opponentTotals, "opp_tov")),
        pf: num(cell(opponentTotals, "opp_pf")),
        pts: num(cell(opponentTotals, "opp_pts"))
      }
    },
    players,
    rawTableSummary: page.tables.map((table) => ({
      id: table.id,
      caption: table.caption,
      rows: table.rows.length,
      headers: table.headers
    }))
  };
}

function normalizeLeague(def, page) {
  const tableMap = normalizeTableMap(page.tables);
  const advancedRows = tableMap["advanced-team"]?.rows ?? [];
  const totalsRows = tableMap["totals-team"]?.rows ?? [];
  const opponentRows = tableMap["totals-opponent"]?.rows ?? [];

  if (!advancedRows.length || !totalsRows.length || !opponentRows.length) {
    throw new Error(`Missing league tables for ${def.seasonEndYear}`);
  }

  const totalsByTeam = new Map(totalsRows.map((row) => [cleanTeamName(cell(row, "team")), row]));
  const opponentByTeam = new Map(opponentRows.map((row) => [cleanTeamName(cell(row, "team")), row]));
  const total = (key) => sumRows(totalsRows, key);
  const opponentTotal = (key) => sumRows(opponentRows, key);
  const leagueFga = requireNumber(total("fga"), `${def.season} league FGA`);
  const leagueOppFga = requireNumber(opponentTotal("opp_fga"), `${def.season} league opponent FGA`);

  const teams = advancedRows.map((advanced) => {
    const name = cleanTeamName(cell(advanced, "team"));
    const totals = totalsByTeam.get(name) ?? {};
    const opponent = opponentByTeam.get(name) ?? {};
    const fga = num(cell(totals, "fga"));
    const fg2a = num(cell(totals, "fg2a"));
    const fg3a = num(cell(totals, "fg3a"));
    const fta = num(cell(totals, "fta"));
    const oppFga = num(cell(opponent, "opp_fga"));
    const oppFta = num(cell(opponent, "opp_fta"));

    return {
      name,
      wins: num(cell(advanced, "wins")),
      losses: num(cell(advanced, "losses")),
      pace: num(cell(advanced, "pace")),
      offensiveRating: num(cell(advanced, "off_rtg")),
      defensiveRating: num(cell(advanced, "def_rtg")),
      netRating: num(cell(advanced, "net_rtg")),
      simpleRating: num(cell(advanced, "srs")),
      marginOfVictory: num(cell(advanced, "mov")),
      efgPct: num(cell(advanced, "efg_pct")),
      turnoverPct: num(cell(advanced, "tov_pct")),
      offensiveReboundPct: num(cell(advanced, "orb_pct")),
      freeThrowRate: num(cell(advanced, "ft_rate")),
      freeThrowAttemptRate: derivePct(fta, fga, `${def.season} ${name} FTA/FGA`),
      opponentEfgPct: num(cell(advanced, "opp_efg_pct")),
      opponentTurnoverPct: num(cell(advanced, "opp_tov_pct")),
      defensiveReboundPct: num(cell(advanced, "drb_pct")),
      opponentFreeThrowAttemptRate: derivePct(oppFta, oppFga, `${def.season} ${name} opponent FTA/FGA`),
      opponentFreeThrowRate: num(cell(advanced, "opp_ft_rate")),
      threeAttemptRate: num(cell(advanced, "fg3a_per_fga_pct")),
      fg2Pct: derivePct(num(cell(totals, "fg2")), fg2a, `${def.season} ${name} 2P%`),
      fg3Pct: derivePct(num(cell(totals, "fg3")), fg3a, `${def.season} ${name} 3P%`),
      ftPct: derivePct(num(cell(totals, "ft")), fta, `${def.season} ${name} FT%`)
    };
  });

  const distributionKeys = {
    pace: "pace",
    offensiveRating: "off_rtg",
    defensiveRating: "def_rtg",
    simpleRating: "srs",
    marginOfVictory: "mov",
    efgPct: "efg_pct",
    turnoverPct: "tov_pct",
    offensiveReboundPct: "orb_pct",
    freeThrowRate: "ft_rate",
    opponentEfgPct: "opp_efg_pct",
    opponentTurnoverPct: "opp_tov_pct",
    defensiveReboundPct: "drb_pct",
    opponentFreeThrowRate: "opp_ft_rate",
    threeAttemptRate: "fg3a_per_fga_pct"
  };

  const distributions = Object.fromEntries(
    Object.entries(distributionKeys).map(([name, key]) => [name, distribution(advancedRows, key)])
  );
  distributions.freeThrowAttemptRate = distribution(
    teams.map((team) => ({ value: { text: String(team.freeThrowAttemptRate) } })),
    "value"
  );
  distributions.opponentFreeThrowAttemptRate = distribution(
    teams.map((team) => ({ value: { text: String(team.opponentFreeThrowAttemptRate) } })),
    "value"
  );
  distributions.fg2Pct = distribution(teams.map((team) => ({ value: { text: String(team.fg2Pct) } })), "value");
  distributions.fg3Pct = distribution(teams.map((team) => ({ value: { text: String(team.fg3Pct) } })), "value");
  distributions.ftPct = distribution(teams.map((team) => ({ value: { text: String(team.ftPct) } })), "value");

  return {
    season: def.season,
    seasonEndYear: def.seasonEndYear,
    source: {
      provider: "Basketball Reference",
      url: def.sourceUrl,
      fetchedAt: page.fetchedAt,
      pageTitle: page.title,
      h1: page.heading,
      tableIds: page.tables.map((table) => table.id).filter(Boolean)
    },
    averages: {
      pace: requireNumber(distributions.pace.mean, `${def.season} pace mean`),
      offensiveRating: requireNumber(distributions.offensiveRating.mean, `${def.season} ORtg mean`),
      defensiveRating: requireNumber(distributions.defensiveRating.mean, `${def.season} DRtg mean`),
      simpleRating: requireNumber(distributions.simpleRating.mean, `${def.season} SRS mean`),
      marginOfVictory: requireNumber(distributions.marginOfVictory.mean, `${def.season} MOV mean`),
      efgPct: requireNumber(distributions.efgPct.mean, `${def.season} eFG% mean`),
      turnoverPct: requireNumber(distributions.turnoverPct.mean, `${def.season} TOV% mean`),
      offensiveReboundPct: requireNumber(distributions.offensiveReboundPct.mean, `${def.season} ORB% mean`),
      freeThrowRate: ratio(total("ft"), leagueFga),
      freeThrowAttemptRate: ratio(total("fta"), leagueFga),
      opponentEfgPct: requireNumber(distributions.opponentEfgPct.mean, `${def.season} opp eFG% mean`),
      opponentTurnoverPct: requireNumber(distributions.opponentTurnoverPct.mean, `${def.season} opp TOV% mean`),
      defensiveReboundPct: requireNumber(distributions.defensiveReboundPct.mean, `${def.season} DRB% mean`),
      opponentFreeThrowAttemptRate: ratio(opponentTotal("opp_fta"), leagueOppFga),
      opponentFreeThrowRate: ratio(opponentTotal("opp_ft"), leagueOppFga),
      threeAttemptRate: ratio(total("fg3a"), leagueFga),
      fg2Pct: ratio(total("fg2"), total("fg2a")),
      fg3Pct: ratio(total("fg3"), total("fg3a")),
      ftPct: ratio(total("ft"), total("fta"))
    },
    distributions,
    playerDistributions: {},
    qualifiedPlayerCount: 0,
    teams
  };
}

function normalizePlayerDistributions(def, page) {
  const tableMap = normalizeTableMap(page.tables);
  const rows = tableMap.advanced_stats?.rows ?? tableMap.advanced?.rows ?? [];
  if (!rows.length) {
    throw new Error(`Missing player advanced table for ${def.season}`);
  }

  const minMinutes = 500;
  const qualifiedRows = rows.filter((row) => (num(cell(row, "mp")) ?? 0) >= minMinutes);
  if (!qualifiedRows.length) {
    throw new Error(`No qualified player rows for ${def.season}`);
  }

  const keys = {
    usagePct: "usg_pct",
    trueShootingPct: "ts_pct",
    threeAttemptRate: "fg3a_per_fga_pct",
    freeThrowAttemptRate: "fta_per_fga_pct",
    offensiveReboundPct: "orb_pct",
    defensiveReboundPct: "drb_pct",
    totalReboundPct: "trb_pct",
    assistPct: "ast_pct",
    stealPct: "stl_pct",
    blockPct: "blk_pct",
    turnoverPct: "tov_pct",
    offensiveWinShares: "ows",
    defensiveWinShares: "dws",
    winShares: "ws",
    offensiveBoxPlusMinus: "obpm",
    defensiveBoxPlusMinus: "dbpm",
    boxPlusMinus: "bpm"
  };

  return {
    qualifiedPlayerCount: qualifiedRows.length,
    playerDistributions: Object.fromEntries(Object.entries(keys).map(([name, key]) => [name, weightedDistribution(qualifiedRows, key, "mp", minMinutes)]))
  };
}

const extractionScript = String.raw`
(() => {
  const readCell = (cell) => ({
    text: cell.innerText.replace(/\s+/g, " ").trim(),
    dataStat: cell.getAttribute("data-stat") || "",
    href: cell.querySelector("a") ? cell.querySelector("a").href : ""
  });

  const tableToObject = (table) => {
    const headerCells = Array.from(table.querySelectorAll("thead tr:last-child th"));
    const headers = headerCells.map((cell) => cell.getAttribute("data-stat") || cell.innerText.trim());
    const rows = Array.from(table.querySelectorAll("tbody tr"))
      .filter((row) => !row.classList.contains("thead"))
      .map((row) => {
        const cells = Array.from(row.querySelectorAll("th,td"));
        const out = {};
        for (const cell of cells) {
          const key = cell.getAttribute("data-stat") || headers[cells.indexOf(cell)] || cell.tagName.toLowerCase();
          out[key] = readCell(cell);
        }
        return out;
      });

    return {
      id: table.id || "",
      caption: table.querySelector("caption")?.innerText?.trim() || "",
      headers,
      rows
    };
  };

  return {
    fetchedAt: new Date().toISOString(),
    url: location.href,
    title: document.title,
    heading: document.querySelector("h1")?.innerText?.trim() || "",
    tables: Array.from(document.querySelectorAll("table")).map(tableToObject)
  };
})()
`;

fs.mkdirSync(rawDir, { recursive: true });
fs.mkdirSync(path.dirname(generatedPath), { recursive: true });

function waitForFunction(expression, timeout = 60000) {
  try {
    const result = runAgentBrowser(["--session", session, "wait", "--fn", expression], undefined, { timeout });
    if (result.status !== 0) {
      console.warn(result.stderr || result.stdout || `Wait returned status ${result.status}`);
    }
  } catch (error) {
    console.warn(`Wait timed out; attempting extraction anyway: ${error.message}`);
  }
}

function getPage(rawName, url, waitExpression) {
  const rawPath = path.join(rawDir, rawName);
  if (useCache && fs.existsSync(rawPath)) {
    return JSON.parse(fs.readFileSync(rawPath, "utf8"));
  }

  const openResult = runAgentBrowser(["--session", session, "open", url], undefined, { timeout: 300000 });
  if (openResult.status !== 0) {
    console.warn(openResult.stderr || `Open returned status ${openResult.status}; trying to extract current page.`);
  }

  waitForFunction(waitExpression);
  const page = evalPage(extractionScript);
  fs.writeFileSync(rawPath, `${JSON.stringify(page, null, 2)}\n`);
  return page;
}

const normalizedTeams = [];

for (const team of selectedTeams) {
  console.log(`${fetchOnly ? "Caching" : "Fetching"} ${team.name}`);
  const page = getPage(`${team.id}.json`, team.sourceUrl, "document.querySelectorAll('table').length > 5");
  if (!page.url.includes(`/teams/${team.abbr}/`) || !page.url.includes(`/${team.seasonEndYear}.html`)) {
    throw new Error(`Unexpected page for ${team.id}: ${page.url}`);
  }

  if (!fetchOnly) {
    normalizedTeams.push(normalizeTeam(team, page));
  }
}

const normalizedLeagues = [];

for (const league of selectedLeagues) {
  console.log(`${fetchOnly ? "Caching" : "Fetching"} ${league.season} NBA league summary`);
  const page = getPage(
    `league-${league.seasonEndYear}.json`,
    league.sourceUrl,
    "document.querySelector('#advanced-team') && document.querySelector('#totals-team')"
  );
  if (!page.url.includes(`/leagues/NBA_${league.seasonEndYear}.html`)) {
    throw new Error(`Unexpected page for ${league.season}: ${page.url}`);
  }

  const normalizedLeague = fetchOnly ? null : normalizeLeague(league, page);

  const playerAdvancedUrl = league.sourceUrl.replace(".html", "_advanced.html");
  console.log(`${fetchOnly ? "Caching" : "Fetching"} ${league.season} NBA player advanced distributions`);
  const playerPage = getPage(
    `league-${league.seasonEndYear}-players-advanced.json`,
    playerAdvancedUrl,
    "(document.querySelectorAll('#advanced_stats tbody tr:not(.thead)').length || document.querySelectorAll('#advanced tbody tr:not(.thead)').length) > 100"
  );
  if (!playerPage.url.includes(`/leagues/NBA_${league.seasonEndYear}_advanced.html`)) {
    throw new Error(`Unexpected player advanced page for ${league.season}: ${playerPage.url}`);
  }

  if (!fetchOnly) {
    Object.assign(normalizedLeague, normalizePlayerDistributions(league, playerPage));
    normalizedLeagues.push(normalizedLeague);
  }
}

if (fetchOnly) {
  runAgentBrowser(["--session", session, "close"]);
  console.log(`Cached ${selectedTeams.length} team pages and ${selectedLeagues.length * 2} league/player pages.`);
  process.exit(0);
}

const output = {
  generatedAt: new Date().toISOString(),
  manifestVersion: manifest.version,
  sourceProvider: manifest.primarySource,
  teams: normalizedTeams,
  leagues: normalizedLeagues
};

fs.writeFileSync(generatedPath, `${JSON.stringify(output, null, 2)}\n`);
runAgentBrowser(["--session", session, "close"]);
console.log(`Wrote ${path.relative(root, generatedPath)}`);
