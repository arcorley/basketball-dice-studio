import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import scheduleData from "../src/data/bbr/raw/schedule-2021.json";
import { simulateGame } from "../src/lib/diceEngine";
import { diceTeams } from "./sourceDataStatic";
import type { DiceTeamCard } from "../src/lib/types";
import { SeededRandom } from "../src/lib/random";

type ScheduleGame = {
  date: string;
  visitorAbbr: string;
  visitorPts: number;
  homeAbbr: string;
  homePts: number;
  boxScoreId: string;
};

type MatchupTask = {
  key: string;
  awayId: string;
  homeId: string;
  samples: number;
  seed: number;
};

type MatchupEstimate = {
  key: string;
  awayId: string;
  homeId: string;
  samples: number;
  awayWins: number;
  homeWins: number;
  ties: number;
  awayWinProbability: number;
  averageAwayScore: number;
  averageHomeScore: number;
};

type TeamSeasonSummary = {
  teamId: string;
  team: string;
  conference: Conference;
  actualWins: number;
  actualLosses: number;
  averageWins: number;
  winDelta: number;
  absWinDelta: number;
  stdevWins: number;
  p05Wins: number;
  p50Wins: number;
  p95Wins: number;
  averageRank: number;
  topSeedPct: number;
  topSixPct: number;
  topTenPct: number;
};

type Conference = "East" | "West";

type WorkerInput = {
  tasks: MatchupTask[];
};

type WorkerOutput = {
  estimates: MatchupEstimate[];
};

const scriptPath = fileURLToPath(import.meta.url);
const regularSeasonEnd = Date.UTC(2021, 4, 16, 23, 59, 59);
const defaultSeasonIterations = 10_000;
const defaultMatchupSamples = 240;
const defaultSeed = 4242;
const maxWorkerCount = Math.max(1, os.availableParallelism?.() ?? os.cpus().length);
const defaultWorkerCount = Math.max(1, Math.min(maxWorkerCount, 8));

const eastAbbrs = new Set(["ATL", "BOS", "BRK", "CHI", "CHO", "CLE", "DET", "IND", "MIA", "MIL", "NYK", "ORL", "PHI", "TOR", "WAS"]);
const westAbbrs = new Set(["DAL", "DEN", "GSW", "HOU", "LAC", "LAL", "MEM", "MIN", "NOP", "OKC", "PHO", "POR", "SAC", "SAS", "UTA"]);

function teamIdFromAbbr(abbr: string): string {
  return `2020-21-${abbr.toLowerCase()}`;
}

function dateUtc(date: string): number {
  const withoutDay = date.replace(/^[A-Za-z]+, /, "");
  const parsed = Date.parse(`${withoutDay} 00:00:00 UTC`);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Could not parse schedule date: ${date}`);
  }
  return parsed;
}

function fixed(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function percentile(sorted: number[], pct: number): number {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * pct)));
  return sorted[index];
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function standardDeviation(values: number[], avg = mean(values)): number {
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / Math.max(1, values.length);
  return Math.sqrt(variance);
}

function pearsonCorrelation(a: number[], b: number[]): number {
  const aMean = mean(a);
  const bMean = mean(b);
  const numerator = a.reduce((sum, value, index) => sum + (value - aMean) * (b[index] - bMean), 0);
  const denominator = Math.sqrt(
    a.reduce((sum, value) => sum + (value - aMean) ** 2, 0) * b.reduce((sum, value) => sum + (value - bMean) ** 2, 0)
  );
  return denominator === 0 ? 0 : numerator / denominator;
}

function conferenceForAbbr(abbr: string): Conference {
  if (eastAbbrs.has(abbr)) return "East";
  if (westAbbrs.has(abbr)) return "West";
  throw new Error(`Unknown 2020-21 conference for ${abbr}`);
}

function loadRegularSeasonGames(): ScheduleGame[] {
  const games = (scheduleData as { games: ScheduleGame[] }).games.filter((game) => dateUtc(game.date) <= regularSeasonEnd);
  if (games.length !== 1_080) {
    throw new Error(`Expected 1,080 2020-21 regular-season games, found ${games.length}.`);
  }
  return games;
}

function teamMap(): Map<string, DiceTeamCard> {
  const teams = new Map(diceTeams.filter((team) => team.season === "2020-21").map((team) => [team.id, team]));
  if (teams.size !== 30) {
    throw new Error(`Expected 30 generated 2020-21 teams, found ${teams.size}.`);
  }
  return teams;
}

function buildMatchupTasks(games: ScheduleGame[], samples: number, seed: number): MatchupTask[] {
  const rng = new SeededRandom(seed);
  const seen = new Set<string>();
  const tasks: MatchupTask[] = [];

  for (const game of games) {
    const awayId = teamIdFromAbbr(game.visitorAbbr);
    const homeId = teamIdFromAbbr(game.homeAbbr);
    const key = `${awayId}|${homeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tasks.push({ key, awayId, homeId, samples, seed: rng.pickSeed() });
  }

  return tasks;
}

function estimateMatchups(tasks: MatchupTask[]): MatchupEstimate[] {
  const teams = teamMap();

  return tasks.map((task) => {
    const away = teams.get(task.awayId);
    const home = teams.get(task.homeId);
    if (!away || !home) {
      throw new Error(`Unknown matchup task: ${task.key}`);
    }

    const rng = new SeededRandom(task.seed);
    let awayWins = 0;
    let homeWins = 0;
    let ties = 0;
    let awayPoints = 0;
    let homePoints = 0;

    for (let index = 0; index < task.samples; index += 1) {
      const result = simulateGame(away, home, rng.pickSeed(), "simulated", { venue: "home-court", intensity: "regular" });
      awayPoints += result.awayScore;
      homePoints += result.homeScore;
      if (result.winnerTeamId === away.id) {
        awayWins += 1;
      } else if (result.winnerTeamId === home.id) {
        homeWins += 1;
      } else {
        ties += 1;
      }
    }

    return {
      key: task.key,
      awayId: task.awayId,
      homeId: task.homeId,
      samples: task.samples,
      awayWins,
      homeWins,
      ties,
      awayWinProbability: (awayWins + ties * 0.5) / task.samples,
      averageAwayScore: awayPoints / task.samples,
      averageHomeScore: homePoints / task.samples
    };
  });
}

function chunkTasks(tasks: MatchupTask[], workerCount: number): MatchupTask[][] {
  const chunks = Array.from({ length: workerCount }, () => [] as MatchupTask[]);
  tasks.forEach((task, index) => {
    chunks[index % workerCount].push(task);
  });
  return chunks.filter((chunk) => chunk.length > 0);
}

async function runWorkerProcess(tasks: MatchupTask[], tempDir: string, index: number): Promise<MatchupEstimate[]> {
  const inputPath = path.join(tempDir, `tasks-${index}.json`);
  const outputPath = path.join(tempDir, `estimates-${index}.json`);
  fs.writeFileSync(inputPath, JSON.stringify({ tasks } satisfies WorkerInput));

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", scriptPath, "--worker", inputPath, outputPath], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Season simulation worker ${index} exited with code ${code}.\n${stdout}${stderr}`));
        return;
      }
      try {
        const output = JSON.parse(fs.readFileSync(outputPath, "utf8")) as WorkerOutput;
        resolve(output.estimates);
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function estimateMatchupsParallel(tasks: MatchupTask[], workerCount: number): Promise<MatchupEstimate[]> {
  const chunks = chunkTasks(tasks, Math.max(1, Math.min(workerCount, tasks.length)));
  const started = Date.now();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "basketball-dice-season-"));
  console.log(`Estimating ${tasks.length} scheduled home/away matchup probabilities with ${chunks.length} workers...`);
  try {
    const estimatesByChunk = await Promise.all(
      chunks.map(async (chunk, index) => {
        const estimates = await runWorkerProcess(chunk, tempDir, index);
        console.log(`Worker ${index + 1}/${chunks.length}: estimated ${estimates.length} matchups.`);
        return estimates;
      })
    );
    console.log(`Finished matchup estimation in ${fixed((Date.now() - started) / 1000, 1)}s.`);
    return estimatesByChunk.flat();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function actualStandings(games: ScheduleGame[], teams: Map<string, DiceTeamCard>): Map<string, { wins: number; losses: number }> {
  const standings = new Map([...teams.keys()].map((teamId) => [teamId, { wins: 0, losses: 0 }]));

  for (const game of games) {
    const awayId = teamIdFromAbbr(game.visitorAbbr);
    const homeId = teamIdFromAbbr(game.homeAbbr);
    const away = standings.get(awayId);
    const home = standings.get(homeId);
    if (!away || !home) {
      throw new Error(`Schedule game references a team missing from generated data: ${game.boxScoreId}`);
    }

    if (game.visitorPts > game.homePts) {
      away.wins += 1;
      home.losses += 1;
    } else if (game.homePts > game.visitorPts) {
      home.wins += 1;
      away.losses += 1;
    } else {
      throw new Error(`NBA schedule game ended tied: ${game.boxScoreId}`);
    }
  }

  for (const [teamId, record] of standings) {
    if (record.wins + record.losses !== 72) {
      throw new Error(`${teamId} has ${record.wins + record.losses} regular-season games; expected 72.`);
    }
  }

  return standings;
}

function rankTeams(teamIds: string[], wins: Map<string, number>): Map<string, number> {
  const ordered = [...teamIds].sort((a, b) => (wins.get(b) ?? 0) - (wins.get(a) ?? 0) || a.localeCompare(b));
  return new Map(ordered.map((teamId, index) => [teamId, index + 1]));
}

function summarizeSeasonReplays(
  games: ScheduleGame[],
  teams: Map<string, DiceTeamCard>,
  estimates: MatchupEstimate[],
  seasonIterations: number,
  seed: number
): { summaries: TeamSeasonSummary[]; metrics: Record<string, number>; topSixAccuracy: Record<Conference, number>; topTenAccuracy: Record<Conference, number> } {
  const actual = actualStandings(games, teams);
  const estimateByKey = new Map(estimates.map((estimate) => [estimate.key, estimate]));
  const teamIds = [...teams.keys()].sort();
  const abbrByTeamId = new Map([...teams.values()].map((team) => [team.id, team.abbr]));
  const conferenceByTeamId = new Map(teamIds.map((teamId) => [teamId, conferenceForAbbr(abbrByTeamId.get(teamId) ?? "")]));
  const winsByTeam = new Map(teamIds.map((teamId) => [teamId, [] as number[]]));
  const rankSumByTeam = new Map(teamIds.map((teamId) => [teamId, 0]));
  const topSeedByTeam = new Map(teamIds.map((teamId) => [teamId, 0]));
  const topSixByTeam = new Map(teamIds.map((teamId) => [teamId, 0]));
  const topTenByTeam = new Map(teamIds.map((teamId) => [teamId, 0]));
  const rng = new SeededRandom(seed);

  for (let iteration = 0; iteration < seasonIterations; iteration += 1) {
    const wins = new Map(teamIds.map((teamId) => [teamId, 0]));

    for (const game of games) {
      const awayId = teamIdFromAbbr(game.visitorAbbr);
      const homeId = teamIdFromAbbr(game.homeAbbr);
      const estimate = estimateByKey.get(`${awayId}|${homeId}`);
      if (!estimate) {
        throw new Error(`Missing matchup estimate for ${awayId} at ${homeId}`);
      }
      const winnerId = rng.next() < estimate.awayWinProbability ? awayId : homeId;
      wins.set(winnerId, (wins.get(winnerId) ?? 0) + 1);
    }

    for (const conference of ["East", "West"] as const) {
      const conferenceTeams = teamIds.filter((teamId) => conferenceByTeamId.get(teamId) === conference);
      const ranks = rankTeams(conferenceTeams, wins);
      for (const teamId of conferenceTeams) {
        const rank = ranks.get(teamId) ?? conferenceTeams.length;
        rankSumByTeam.set(teamId, (rankSumByTeam.get(teamId) ?? 0) + rank);
        if (rank === 1) topSeedByTeam.set(teamId, (topSeedByTeam.get(teamId) ?? 0) + 1);
        if (rank <= 6) topSixByTeam.set(teamId, (topSixByTeam.get(teamId) ?? 0) + 1);
        if (rank <= 10) topTenByTeam.set(teamId, (topTenByTeam.get(teamId) ?? 0) + 1);
      }
    }

    for (const teamId of teamIds) {
      winsByTeam.get(teamId)?.push(wins.get(teamId) ?? 0);
    }
  }

  const summaries = teamIds
    .map((teamId) => {
      const team = teams.get(teamId);
      const record = actual.get(teamId);
      const winSamples = [...(winsByTeam.get(teamId) ?? [])].sort((a, b) => a - b);
      const averageWins = mean(winSamples);
      if (!team || !record) {
        throw new Error(`Missing summary inputs for ${teamId}`);
      }
      return {
        teamId,
        team: team.shortName,
        conference: conferenceByTeamId.get(teamId) ?? conferenceForAbbr(team.abbr),
        actualWins: record.wins,
        actualLosses: record.losses,
        averageWins,
        winDelta: averageWins - record.wins,
        absWinDelta: Math.abs(averageWins - record.wins),
        stdevWins: standardDeviation(winSamples, averageWins),
        p05Wins: percentile(winSamples, 0.05),
        p50Wins: percentile(winSamples, 0.5),
        p95Wins: percentile(winSamples, 0.95),
        averageRank: (rankSumByTeam.get(teamId) ?? 0) / seasonIterations,
        topSeedPct: (topSeedByTeam.get(teamId) ?? 0) / seasonIterations,
        topSixPct: (topSixByTeam.get(teamId) ?? 0) / seasonIterations,
        topTenPct: (topTenByTeam.get(teamId) ?? 0) / seasonIterations
      } satisfies TeamSeasonSummary;
    })
    .sort((a, b) => b.actualWins - a.actualWins || b.averageWins - a.averageWins);

  const actualWins = summaries.map((summary) => summary.actualWins);
  const averageWins = summaries.map((summary) => summary.averageWins);
  const errors = summaries.map((summary) => summary.winDelta);
  const metrics = {
    meanAbsoluteWinError: mean(summaries.map((summary) => summary.absWinDelta)),
    rootMeanSquareWinError: Math.sqrt(mean(errors.map((error) => error ** 2))),
    maxAbsoluteWinError: Math.max(...summaries.map((summary) => summary.absWinDelta)),
    actualToSimWinCorrelation: pearsonCorrelation(actualWins, averageWins)
  };

  const topSixAccuracy = membershipAccuracy(summaries, 6);
  const topTenAccuracy = membershipAccuracy(summaries, 10);

  return { summaries, metrics, topSixAccuracy, topTenAccuracy };
}

function membershipAccuracy(summaries: TeamSeasonSummary[], rankCutoff: number): Record<Conference, number> {
  const out = {} as Record<Conference, number>;
  for (const conference of ["East", "West"] as const) {
    const conferenceRows = summaries.filter((summary) => summary.conference === conference);
    const actual = new Set(
      [...conferenceRows].sort((a, b) => b.actualWins - a.actualWins || a.teamId.localeCompare(b.teamId)).slice(0, rankCutoff).map((summary) => summary.teamId)
    );
    const simulated = new Set(
      [...conferenceRows].sort((a, b) => b.averageWins - a.averageWins || a.teamId.localeCompare(b.teamId)).slice(0, rankCutoff).map((summary) => summary.teamId)
    );
    const matches = [...actual].filter((teamId) => simulated.has(teamId)).length;
    out[conference] = matches / rankCutoff;
  }
  return out;
}

function printReport(
  seasonIterations: number,
  matchupSamples: number,
  workerCount: number,
  games: ScheduleGame[],
  estimates: MatchupEstimate[],
  summaries: TeamSeasonSummary[],
  metrics: Record<string, number>,
  topSixAccuracy: Record<Conference, number>,
  topTenAccuracy: Record<Conference, number>
): void {
  console.log("");
  console.log(`2020-21 season replay: ${seasonIterations.toLocaleString()} seasons`);
  console.log(`Schedule: ${games.length} regular-season games; ${estimates.length} unique home/away matchups.`);
  console.log(`Matchup estimation: ${matchupSamples.toLocaleString()} full engine games per matchup across ${workerCount} workers.`);
  console.log(
    `Accuracy: MAE ${fixed(metrics.meanAbsoluteWinError, 2)} wins, RMSE ${fixed(metrics.rootMeanSquareWinError, 2)}, max error ${fixed(
      metrics.maxAbsoluteWinError,
      2
    )}, correlation ${fixed(metrics.actualToSimWinCorrelation, 3)}.`
  );
  console.log(`Top-six membership accuracy: East ${fixed(topSixAccuracy.East * 100, 1)}%, West ${fixed(topSixAccuracy.West * 100, 1)}%.`);
  console.log(`Top-ten membership accuracy: East ${fixed(topTenAccuracy.East * 100, 1)}%, West ${fixed(topTenAccuracy.West * 100, 1)}%.`);
  console.log("");
  console.table(
    summaries.map((summary) => ({
      Team: summary.team,
      Conf: summary.conference,
      Actual: `${summary.actualWins}-${summary.actualLosses}`,
      SimWins: fixed(summary.averageWins, 1),
      Delta: fixed(summary.winDelta, 1),
      P05: summary.p05Wins,
      P50: summary.p50Wins,
      P95: summary.p95Wins,
      AvgRank: fixed(summary.averageRank, 1),
      Top6: `${fixed(summary.topSixPct * 100, 1)}%`,
      Top10: `${fixed(summary.topTenPct * 100, 1)}%`
    }))
  );
}

function runWorkerCli(inputPath: string | undefined, outputPath: string | undefined): void {
  if (!inputPath || !outputPath) {
    throw new Error("Worker mode requires input and output JSON paths.");
  }
  const input = JSON.parse(fs.readFileSync(inputPath, "utf8")) as WorkerInput;
  const estimates = estimateMatchups(input.tasks);
  fs.writeFileSync(outputPath, JSON.stringify({ estimates } satisfies WorkerOutput));
}

async function main(): Promise<void> {
  const [seasonIterationsArg, matchupSamplesArg, seedArg, workerCountArg] = process.argv.slice(2);
  const seasonIterations = Number(seasonIterationsArg ?? defaultSeasonIterations);
  const matchupSamples = Number(matchupSamplesArg ?? defaultMatchupSamples);
  const seed = Number(seedArg ?? defaultSeed);
  const requestedWorkers = Number(workerCountArg ?? defaultWorkerCount);
  const workerCount = Math.max(1, Math.min(Number.isFinite(requestedWorkers) ? Math.floor(requestedWorkers) : defaultWorkerCount, maxWorkerCount));

  if (![seasonIterations, matchupSamples, seed, workerCount].every(Number.isFinite) || seasonIterations <= 0 || matchupSamples <= 0 || workerCount <= 0) {
    throw new Error("Usage: npm run simulate:2021-season -- <seasonIterations=10000> <matchupSamples=240> <seed=4242> <workers=auto>");
  }

  const games = loadRegularSeasonGames();
  const teams = teamMap();
  const tasks = buildMatchupTasks(games, matchupSamples, seed);
  const estimates = await estimateMatchupsParallel(tasks, workerCount);
  const replayStarted = Date.now();
  const { summaries, metrics, topSixAccuracy, topTenAccuracy } = summarizeSeasonReplays(games, teams, estimates, seasonIterations, seed + 1);
  console.log(`Finished ${seasonIterations.toLocaleString()} season replays in ${fixed((Date.now() - replayStarted) / 1000, 1)}s.`);
  printReport(seasonIterations, matchupSamples, workerCount, games, estimates, summaries, metrics, topSixAccuracy, topTenAccuracy);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  if (process.argv[2] === "--worker") {
    try {
      runWorkerCli(process.argv[3], process.argv[4]);
    } catch (error: unknown) {
      console.error(error instanceof Error ? error.stack ?? error.message : error);
      process.exitCode = 1;
    }
  } else {
    main().catch((error: unknown) => {
      console.error(error instanceof Error ? error.stack ?? error.message : error);
      process.exitCode = 1;
    });
  }
}
