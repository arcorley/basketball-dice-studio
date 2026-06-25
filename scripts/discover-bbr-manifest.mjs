#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const rawDir = path.join(root, "src", "data", "bbr", "raw");
const defaultOutputPath = path.join(root, "data", "source-manifest.json");
const session = "basketball-dice-bbr-discover";

const args = new Map(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith("--") && arg.includes("="))
    .map((arg) => {
      const [key, ...rest] = arg.slice(2).split("=");
      return [key, rest.join("=")];
    })
);
const flags = new Set(process.argv.slice(2).filter((arg) => arg.startsWith("--") && !arg.includes("=")).map((arg) => arg.slice(2)));

const startYear = Number(args.get("start-year") ?? 1990);
const endYear = Number(args.get("end-year") ?? 2025);
const outputPath = path.resolve(args.get("output") ?? defaultOutputPath);
const useCache = flags.has("use-cache");

if (!Number.isInteger(startYear) || !Number.isInteger(endYear) || startYear < 1947 || endYear < startYear) {
  throw new Error("Usage: node scripts/discover-bbr-manifest.mjs --start-year=1990 --end-year=2025 [--output=data/source-manifest.json] [--use-cache]");
}

const nicknameSuffixes = [
  "Trail Blazers",
  "SuperSonics",
  "Timberwolves",
  "Mavericks",
  "Clippers",
  "Grizzlies",
  "Pelicans",
  "Cavaliers",
  "Pistons",
  "Warriors",
  "Wizards",
  "Bobcats",
  "Hornets",
  "Raptors",
  "Rockets",
  "Celtics",
  "Knicks",
  "Nuggets",
  "Thunder",
  "Blazers",
  "Bucks",
  "Bulls",
  "Hawks",
  "Heat",
  "Jazz",
  "Kings",
  "Lakers",
  "Magic",
  "Nets",
  "Pacers",
  "Suns",
  "Spurs",
  "76ers"
].sort((a, b) => b.length - a.length);

function runAgentBrowser(commandArgs, input = undefined, options = {}) {
  const result = spawnSync("agent-browser", commandArgs, {
    input,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 50,
    timeout: 120000,
    ...options
  });
  if (result.error) throw result.error;
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

const leagueTeamLinkExtractionScript = String.raw`
(() => {
  return {
    fetchedAt: new Date().toISOString(),
    url: location.href,
    title: document.title,
    heading: document.querySelector("h1")?.innerText?.trim() || "",
    teams: Array.from(document.querySelectorAll("#advanced-team tbody tr"))
      .filter((row) => !row.classList.contains("thead"))
      .map((row) => {
        const cell = row.querySelector('[data-stat="team"]');
        const link = cell?.querySelector("a");
        return {
          text: cell?.innerText?.replace(/\s+/g, " ").trim() || "",
          href: link?.href || ""
        };
      })
      .filter((team) => team.text && team.href)
  };
})()
`;

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

function getLeaguePage(seasonEndYear) {
  const rawPath = path.join(rawDir, `league-${seasonEndYear}.json`);
  if (useCache && fs.existsSync(rawPath)) {
    return JSON.parse(fs.readFileSync(rawPath, "utf8"));
  }

  const url = `https://www.basketball-reference.com/leagues/NBA_${seasonEndYear}.html`;
  const openResult = runAgentBrowser(["--session", session, "open", url], undefined, { timeout: 90000 });
  if (openResult.status !== 0) {
    console.warn(openResult.stderr || `Open returned status ${openResult.status}; trying to extract current page.`);
  }
  waitForFunction("document.querySelector('#advanced-team') && document.querySelector('#totals-team')");
  const page = evalPage(leagueTeamLinkExtractionScript);
  if (!page.url.includes(`/leagues/NBA_${seasonEndYear}.html`)) {
    throw new Error(`Unexpected page for NBA_${seasonEndYear}: ${page.url}`);
  }
  return page;
}

function cleanTeamName(value) {
  return String(value).replace(/\*/g, "").trim();
}

function shortName(season, franchise) {
  const suffix = nicknameSuffixes.find((candidate) => franchise.endsWith(candidate));
  return `${season} ${suffix ?? franchise.split(/\s+/).at(-1)}`;
}

function teamDefinition(season, seasonEndYear, row) {
  const name = cleanTeamName(row.team?.text ?? "");
  const url = row.team?.href ?? "";
  const match = url.match(/\/teams\/([^/]+)\/(\d{4})\.html$/);
  if (!name || !match) {
    throw new Error(`Could not parse team link for ${season}: ${JSON.stringify(row.team)}`);
  }
  const abbr = match[1];
  const urlYear = Number(match[2]);
  if (urlYear !== seasonEndYear) {
    throw new Error(`Unexpected team URL year for ${name}: ${url}`);
  }

  return {
    id: `${season}-${abbr.toLowerCase()}`,
    name: `${season} ${name}`,
    shortName: shortName(season, name),
    franchise: name,
    abbr,
    season,
    seasonEndYear,
    sourceUrl: url
  };
}

function teamLinksFromPage(page) {
  if (page.teams?.length) return page.teams;
  const table = page.tables?.find((candidate) => candidate.id === "advanced-team");
  return (table?.rows ?? [])
    .map((row) => ({
      text: row.team?.text ?? "",
      href: row.team?.href ?? ""
    }))
    .filter((team) => team.text && team.href);
}

function discoverSeason(seasonEndYear) {
  const season = `${seasonEndYear - 1}-${String(seasonEndYear).slice(-2)}`;
  const page = getLeaguePage(seasonEndYear);
  const teamLinks = teamLinksFromPage(page);
  if (!teamLinks.length) {
    throw new Error(`Missing advanced-team team links for ${season}`);
  }
  const teams = teamLinks
    .map((team) => teamDefinition(season, seasonEndYear, { team }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const uniqueIds = new Set(teams.map((team) => team.id));
  if (uniqueIds.size !== teams.length) {
    throw new Error(`Duplicate team ids discovered for ${season}`);
  }
  return {
    leagueSource: {
      season,
      seasonEndYear,
      sourceUrl: `https://www.basketball-reference.com/leagues/NBA_${seasonEndYear}.html`
    },
    teams
  };
}

const seasons = [];
for (let seasonEndYear = startYear; seasonEndYear <= endYear; seasonEndYear += 1) {
  console.log(`Discovering NBA_${seasonEndYear}`);
  seasons.push(discoverSeason(seasonEndYear));
}

const manifest = {
  version: `0.6.0-source-manifest-bbr-${startYear}-${endYear}`,
  primarySource: "Basketball Reference",
  leagueSources: seasons.map((season) => season.leagueSource),
  teams: seasons.flatMap((season) => season.teams)
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
runAgentBrowser(["--session", session, "close"]);
console.log(`Wrote ${path.relative(root, outputPath)} with ${manifest.leagueSources.length} seasons and ${manifest.teams.length} team seasons.`);
