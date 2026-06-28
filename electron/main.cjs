const { app, BrowserWindow, protocol, shell } = require("electron");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
let DatabaseSync = null;
try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch {
  DatabaseSync = null;
}

const APP_SCHEME = "bds";
const APP_HOST = "basketball-dice-studio";
const VALID_STATE_KEYS = new Set(["tournament", "season-league", "season-leagues", "history-replays"]);
let appStateStoreQueue = Promise.resolve();
let historyReplayDb = null;

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
]);

function isLeagueState(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    Array.isArray(value.teamIds) &&
    Array.isArray(value.games) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isSeasonLeagueCollection(value) {
  return (
    value &&
    typeof value === "object" &&
    Array.isArray(value.leagues) &&
    value.leagues.every(isLeagueState) &&
    (value.activeLeagueId === null || typeof value.activeLeagueId === "string")
  );
}

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function isHistoryReplayCampaign(value) {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.controlledFranchise === "string" &&
    typeof value.startSeason === "string" &&
    Number.isInteger(value.startSeasonEndYear) &&
    typeof value.currentSeason === "string" &&
    Number.isInteger(value.currentSeasonEndYear) &&
    typeof value.originalTeamId === "string" &&
    typeof value.currentTeamId === "string" &&
    typeof value.activeLeagueId === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isHistoryReplaySeason(value) {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.campaignId === "string" &&
    typeof value.leagueId === "string" &&
    typeof value.season === "string" &&
    Number.isInteger(value.seasonEndYear) &&
    typeof value.teamId === "string" &&
    Number.isInteger(value.seasonIndex) &&
    typeof value.createdAt === "string"
  );
}

function isHistoryReplayDraftPick(value) {
  const prospectSnapshot = isRecord(value) ? value.prospectSnapshot : null;
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.campaignId === "string" &&
    typeof value.fromSeasonId === "string" &&
    typeof value.toSeasonId === "string" &&
    typeof value.fromLeagueId === "string" &&
    typeof value.toLeagueId === "string" &&
    typeof value.season === "string" &&
    Number.isInteger(value.seasonEndYear) &&
    typeof value.pickId === "string" &&
    typeof value.pickLabel === "string" &&
    typeof value.pickDetail === "string" &&
    value.pickKind === "archetype" &&
    isRecord(prospectSnapshot) &&
    typeof prospectSnapshot.prospectId === "string" &&
    typeof prospectSnapshot.archetype === "string" &&
    typeof prospectSnapshot.position === "string" &&
    Number.isInteger(prospectSnapshot.rank) &&
    typeof prospectSnapshot.projectedPickBand === "string" &&
    Array.isArray(prospectSnapshot.needAreas) &&
    prospectSnapshot.needAreas.every((area) => typeof area === "string") &&
    Number.isInteger(prospectSnapshot.upside) &&
    Number.isInteger(prospectSnapshot.readiness) &&
    typeof prospectSnapshot.risk === "string" &&
    typeof value.controlledTeamId === "string" &&
    typeof value.controlledTeamName === "string" &&
    isRecord(value.plan) &&
    typeof value.createdAt === "string"
  );
}

function isHistoryReplayCollection(value) {
  if (
    !(
      isRecord(value) &&
      Array.isArray(value.campaigns) &&
      Array.isArray(value.seasons) &&
      Array.isArray(value.draftPicks) &&
      value.campaigns.every(isHistoryReplayCampaign) &&
      value.seasons.every(isHistoryReplaySeason) &&
      value.draftPicks.every(isHistoryReplayDraftPick)
    )
  ) {
    return false;
  }

  const campaignIds = new Set(value.campaigns.map((campaign) => campaign.id));
  const seasonIds = new Set(value.seasons.map((season) => season.id));
  const leagueIds = new Set(value.seasons.map((season) => season.leagueId));
  return (
    value.seasons.every((season) => campaignIds.has(season.campaignId)) &&
    value.draftPicks.every(
      (pick) =>
        campaignIds.has(pick.campaignId) &&
        seasonIds.has(pick.fromSeasonId) &&
        seasonIds.has(pick.toSeasonId) &&
        leagueIds.has(pick.fromLeagueId) &&
        leagueIds.has(pick.toLeagueId)
    )
  );
}

function isValidStateValue(key, value) {
  if (key === "history-replays") {
    return isHistoryReplayCollection(value);
  }
  if (key === "season-leagues") {
    return isSeasonLeagueCollection(value);
  }
  return isLeagueState(value);
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function textResponse(message, status = 500) {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function contentTypeFor(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/x-icon";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

function appStatePath() {
  return path.join(app.getPath("userData"), "app-state.json");
}

function appStateDatabasePath() {
  return path.join(app.getPath("userData"), "app-state.sqlite");
}

function requireHistoryReplayDb() {
  if (!DatabaseSync) {
    throw new Error("SQLite is not available in this Electron runtime.");
  }
  if (!historyReplayDb) {
    fsSync.mkdirSync(path.dirname(appStateDatabasePath()), { recursive: true });
    historyReplayDb = new DatabaseSync(appStateDatabasePath());
    historyReplayDb.exec(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS history_replay_campaigns (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        controlled_franchise TEXT NOT NULL,
        start_season TEXT NOT NULL,
        start_season_end_year INTEGER NOT NULL,
        current_season TEXT NOT NULL,
        current_season_end_year INTEGER NOT NULL,
        original_team_id TEXT NOT NULL,
        current_team_id TEXT NOT NULL,
        active_league_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS history_replay_seasons (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL REFERENCES history_replay_campaigns(id) ON DELETE CASCADE,
        league_id TEXT NOT NULL,
        season TEXT NOT NULL,
        season_end_year INTEGER NOT NULL,
        team_id TEXT NOT NULL,
        season_index INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(campaign_id, league_id),
        UNIQUE(campaign_id, season_index)
      );

      CREATE TABLE IF NOT EXISTS history_replay_draft_picks (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL REFERENCES history_replay_campaigns(id) ON DELETE CASCADE,
        from_season_id TEXT NOT NULL REFERENCES history_replay_seasons(id) ON DELETE CASCADE,
        to_season_id TEXT NOT NULL REFERENCES history_replay_seasons(id) ON DELETE CASCADE,
        from_league_id TEXT NOT NULL,
        to_league_id TEXT NOT NULL,
        season TEXT NOT NULL,
        season_end_year INTEGER NOT NULL,
        pick_id TEXT NOT NULL,
        pick_label TEXT NOT NULL,
        pick_detail TEXT NOT NULL,
        pick_kind TEXT NOT NULL,
        prospect_snapshot_json TEXT NOT NULL,
        controlled_team_id TEXT NOT NULL,
        controlled_team_name TEXT NOT NULL,
        plan_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }
  return historyReplayDb;
}

async function readAppStateStore() {
  try {
    const raw = await fs.readFile(appStatePath(), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (error && error.code === "ENOENT") return {};
    if (error instanceof SyntaxError) return {};
    throw error;
  }
}

async function writeAppStateStore(store) {
  const destination = appStatePath();
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(store, null, 2), "utf8");
    await fs.rename(temporary, destination);
  } catch (error) {
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
}

function queueAppStateStoreOperation(operation) {
  const queued = appStateStoreQueue.then(operation, operation);
  appStateStoreQueue = queued.catch(() => {});
  return queued;
}

function readHistoryReplayCollection() {
  const db = requireHistoryReplayDb();
  const campaigns = db
    .prepare("SELECT * FROM history_replay_campaigns ORDER BY updated_at DESC, name ASC")
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      controlledFranchise: row.controlled_franchise,
      startSeason: row.start_season,
      startSeasonEndYear: row.start_season_end_year,
      currentSeason: row.current_season,
      currentSeasonEndYear: row.current_season_end_year,
      originalTeamId: row.original_team_id,
      currentTeamId: row.current_team_id,
      activeLeagueId: row.active_league_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  const seasons = db
    .prepare("SELECT * FROM history_replay_seasons ORDER BY campaign_id ASC, season_index ASC, season_end_year ASC")
    .all()
    .map((row) => ({
      id: row.id,
      campaignId: row.campaign_id,
      leagueId: row.league_id,
      season: row.season,
      seasonEndYear: row.season_end_year,
      teamId: row.team_id,
      seasonIndex: row.season_index,
      createdAt: row.created_at
    }));
  const draftPicks = db
    .prepare("SELECT * FROM history_replay_draft_picks ORDER BY created_at ASC, id ASC")
    .all()
    .map((row) => ({
      id: row.id,
      campaignId: row.campaign_id,
      fromSeasonId: row.from_season_id,
      toSeasonId: row.to_season_id,
      fromLeagueId: row.from_league_id,
      toLeagueId: row.to_league_id,
      season: row.season,
      seasonEndYear: row.season_end_year,
      pickId: row.pick_id,
      pickLabel: row.pick_label,
      pickDetail: row.pick_detail,
      pickKind: row.pick_kind,
      prospectSnapshot: JSON.parse(row.prospect_snapshot_json),
      controlledTeamId: row.controlled_team_id,
      controlledTeamName: row.controlled_team_name,
      plan: JSON.parse(row.plan_json),
      createdAt: row.created_at
    }));
  return { campaigns, seasons, draftPicks };
}

function writeHistoryReplayCollection(collection) {
  const db = requireHistoryReplayDb();
  const insertCampaign = db.prepare(`
    INSERT INTO history_replay_campaigns (
      id,
      name,
      controlled_franchise,
      start_season,
      start_season_end_year,
      current_season,
      current_season_end_year,
      original_team_id,
      current_team_id,
      active_league_id,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSeason = db.prepare(`
    INSERT INTO history_replay_seasons (
      id,
      campaign_id,
      league_id,
      season,
      season_end_year,
      team_id,
      season_index,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertPick = db.prepare(`
    INSERT INTO history_replay_draft_picks (
      id,
      campaign_id,
      from_season_id,
      to_season_id,
      from_league_id,
      to_league_id,
      season,
      season_end_year,
      pick_id,
      pick_label,
      pick_detail,
      pick_kind,
      prospect_snapshot_json,
      controlled_team_id,
      controlled_team_name,
      plan_json,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM history_replay_draft_picks; DELETE FROM history_replay_seasons; DELETE FROM history_replay_campaigns;");
    for (const row of collection.campaigns) {
      insertCampaign.run(
        row.id,
        row.name,
        row.controlledFranchise,
        row.startSeason,
        row.startSeasonEndYear,
        row.currentSeason,
        row.currentSeasonEndYear,
        row.originalTeamId,
        row.currentTeamId,
        row.activeLeagueId,
        row.createdAt,
        row.updatedAt
      );
    }
    for (const row of collection.seasons) {
      insertSeason.run(row.id, row.campaignId, row.leagueId, row.season, row.seasonEndYear, row.teamId, row.seasonIndex, row.createdAt);
    }
    for (const row of collection.draftPicks) {
      insertPick.run(
        row.id,
        row.campaignId,
        row.fromSeasonId,
        row.toSeasonId,
        row.fromLeagueId,
        row.toLeagueId,
        row.season,
        row.seasonEndYear,
        row.pickId,
        row.pickLabel,
        row.pickDetail,
        row.pickKind,
        JSON.stringify(row.prospectSnapshot),
        row.controlledTeamId,
        row.controlledTeamName,
        JSON.stringify(row.plan),
        row.createdAt
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function deleteHistoryReplayCollection() {
  const db = requireHistoryReplayDb();
  db.exec("DELETE FROM history_replay_draft_picks; DELETE FROM history_replay_seasons; DELETE FROM history_replay_campaigns;");
}

async function handleAppStateRequest(request, url) {
  const match = /^\/api\/app-state\/([^/]+)$/.exec(url.pathname);
  if (!match) return null;

  const key = decodeURIComponent(match[1]);
  if (!VALID_STATE_KEYS.has(key)) {
    return textResponse("Unknown app state key.", 404);
  }

  return queueAppStateStoreOperation(async () => {
    if (key === "history-replays") {
      if (request.method === "GET") {
        return jsonResponse({ state: readHistoryReplayCollection() });
      }

      if (request.method === "PUT") {
        let value;
        try {
          value = JSON.parse(await request.text());
        } catch {
          return jsonResponse({ error: "Invalid JSON payload." }, 400);
        }

        if (!isHistoryReplayCollection(value)) {
          return jsonResponse({ error: "Invalid history replay payload." }, 400);
        }

        writeHistoryReplayCollection(value);
        return jsonResponse({ ok: true });
      }

      if (request.method === "DELETE") {
        deleteHistoryReplayCollection();
        return jsonResponse({ ok: true });
      }

      return jsonResponse({ error: "Method not allowed." }, 405);
    }

    const store = await readAppStateStore();
    if (request.method === "GET") {
      const value = isValidStateValue(key, store[key]) ? store[key] : null;
      if (store[key] && !value) {
        delete store[key];
        await writeAppStateStore(store);
      }
      return jsonResponse({ state: value });
    }

    if (request.method === "PUT") {
      let value;
      try {
        value = JSON.parse(await request.text());
      } catch {
        return jsonResponse({ error: "Invalid JSON payload." }, 400);
      }

      if (!isValidStateValue(key, value)) {
        return jsonResponse({ error: "Invalid app state payload." }, 400);
      }

      store[key] = value;
      await writeAppStateStore(store);
      return jsonResponse({ ok: true });
    }

    if (request.method === "DELETE") {
      delete store[key];
      await writeAppStateStore(store);
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: "Method not allowed." }, 405);
  });
}

function distPathFor(url) {
  const distRoot = path.resolve(__dirname, "..", "dist");
  const relativePath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname).replace(/^\/+/, "");
  const filePath = path.resolve(distRoot, relativePath);

  if (filePath !== distRoot && !filePath.startsWith(`${distRoot}${path.sep}`)) {
    return null;
  }

  return filePath;
}

async function handleAppProtocol(request) {
  try {
    const url = new URL(request.url);
    const appStateResponse = await handleAppStateRequest(request, url);
    if (appStateResponse) return appStateResponse;

    const filePath = distPathFor(url);
    if (!filePath) return textResponse("Forbidden.", 403);

    try {
      const bytes = await fs.readFile(filePath);
      return new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": contentTypeFor(filePath)
        }
      });
    } catch (error) {
      if (error && error.code !== "ENOENT") throw error;
      const indexPath = path.resolve(__dirname, "..", "dist", "index.html");
      const indexBytes = await fs.readFile(indexPath);
      return new Response(indexBytes, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8"
        }
      });
    }
  } catch (error) {
    console.error(error);
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
}

function isAppUrl(targetUrl) {
  return targetUrl.startsWith(`${APP_SCHEME}://${APP_HOST}/`);
}

async function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "Basketball Dice Studio",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!isAppUrl(url)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    const devServerUrl = process.env.VITE_DEV_SERVER_URL;
    const isDevServerUrl = devServerUrl && url.startsWith(devServerUrl);
    if (!isAppUrl(url) && !isDevServerUrl) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
    return;
  }

  await mainWindow.loadURL(`${APP_SCHEME}://${APP_HOST}/index.html`);
}

app.whenReady().then(async () => {
  protocol.handle(APP_SCHEME, handleAppProtocol);
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (historyReplayDb) {
    historyReplayDb.close();
    historyReplayDb = null;
  }
});
