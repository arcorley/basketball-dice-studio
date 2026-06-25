#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const manifestPath = path.join(root, "data", "source-manifest.json");
const rawDir = path.join(root, "src", "data", "bbr", "raw");
const generatedPath = path.join(root, "src", "data", "teams.generated.json");
const session = "basketball-dice-bbr";

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

function runAgentBrowser(args, input = undefined, options = {}) {
  const result = spawnSync("agent-browser", args, {
    input,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 50,
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

function firstRow(table) {
  return table?.rows?.[0] ?? {};
}

function normalizeTeam(def, page) {
  const tableMap = normalizeTableMap(page.tables);
  const teamMisc = firstRow(tableMap.team_misc);
  const teamTotals = firstRow(tableMap.team_and_opponent);
  const opponentTotals = tableMap.team_and_opponent?.rows?.[1] ?? {};
  const perGameRows = tableMap.per_game_stats?.rows ?? [];
  const totalsRows = tableMap.totals_stats?.rows ?? [];
  const perPossRows = tableMap.per_poss?.rows ?? [];
  const advancedRows = tableMap.advanced?.rows ?? [];
  const shootingRows = tableMap.shooting?.rows ?? [];
  const pbpRows = tableMap.pbp_stats?.rows ?? [];
  const rosterRows = tableMap.roster?.rows ?? [];

  const byName = (rows, nameKey = "name_display") =>
    new Map(rows.map((row) => [cell(row, nameKey) || cell(row, "player"), row]));

  const totalsByName = byName(totalsRows);
  const perPossByName = byName(perPossRows);
  const advancedByName = byName(advancedRows);
  const shootingByName = byName(shootingRows);
  const pbpByName = byName(pbpRows);
  const rosterByName = byName(rosterRows, "player");

  const players = perGameRows
    .map((perGame) => {
      const name = cell(perGame, "name_display");
      const totals = totalsByName.get(name) ?? {};
      const perPoss = perPossByName.get(name) ?? {};
      const advanced = advancedByName.get(name) ?? {};
      const shooting = shootingByName.get(name) ?? {};
      const pbp = pbpByName.get(name) ?? {};
      const roster = rosterByName.get(name) ?? {};

      return {
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
          pctFga3p: num(cell(shooting, "pct_fga_fg3a")),
          fgPct2p: num(cell(shooting, "fg_pct_fg2a")),
          fgPct3p: num(cell(shooting, "fg_pct_fg3a")),
          pctAst2p: num(cell(shooting, "pct_ast_fg2")),
          pctAst3p: num(cell(shooting, "pct_ast_fg3")),
          pctFgaDunk: num(cell(shooting, "pct_fga_dunk")),
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
      freeThrowRate: num(cell(teamMisc, "ft_rate")),
      opponentEfgPct: num(cell(teamMisc, "opp_efg_pct")),
      opponentTurnoverPct: num(cell(teamMisc, "opp_tov_pct")),
      defensiveReboundPct: num(cell(teamMisc, "drb_pct")),
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
        fg: num(cell(opponentTotals, "fg")),
        fga: num(cell(opponentTotals, "fga")),
        fg3: num(cell(opponentTotals, "fg3")),
        fg3a: num(cell(opponentTotals, "fg3a")),
        ft: num(cell(opponentTotals, "ft")),
        fta: num(cell(opponentTotals, "fta")),
        orb: num(cell(opponentTotals, "orb")),
        drb: num(cell(opponentTotals, "drb")),
        ast: num(cell(opponentTotals, "ast")),
        stl: num(cell(opponentTotals, "stl")),
        blk: num(cell(opponentTotals, "blk")),
        tov: num(cell(opponentTotals, "tov")),
        pf: num(cell(opponentTotals, "pf")),
        pts: num(cell(opponentTotals, "pts"))
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

const normalized = [];

for (const team of manifest.teams) {
  console.log(`Fetching ${team.name}`);
  const openResult = runAgentBrowser(["--session", session, "open", team.sourceUrl]);
  if (openResult.status !== 0) {
    console.warn(openResult.stderr || `Open returned status ${openResult.status}; trying to extract current page.`);
  }

  runAgentBrowser(["--session", session, "wait", "--fn", "document.querySelectorAll('table').length > 5"], undefined, {
    timeout: 45000
  });

  const page = evalPage(extractionScript);
  if (!page.url.includes(`/teams/${team.abbr}/`) || !page.url.includes(`/${team.seasonEndYear}.html`)) {
    throw new Error(`Unexpected page for ${team.id}: ${page.url}`);
  }

  const rawPath = path.join(rawDir, `${team.id}.json`);
  fs.writeFileSync(rawPath, `${JSON.stringify(page, null, 2)}\n`);
  normalized.push(normalizeTeam(team, page));
}

const output = {
  generatedAt: new Date().toISOString(),
  manifestVersion: manifest.version,
  sourceProvider: manifest.primarySource,
  teams: normalized
};

fs.writeFileSync(generatedPath, `${JSON.stringify(output, null, 2)}\n`);
runAgentBrowser(["--session", session, "close"]);
console.log(`Wrote ${path.relative(root, generatedPath)}`);
