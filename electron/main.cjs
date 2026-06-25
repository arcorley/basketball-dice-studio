const { app, BrowserWindow, protocol, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const APP_SCHEME = "bds";
const APP_HOST = "basketball-dice-studio";
const VALID_STATE_KEYS = new Set(["tournament", "season-league"]);

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
  const temporary = `${destination}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(store, null, 2), "utf8");
  await fs.rename(temporary, destination);
}

async function handleAppStateRequest(request, url) {
  const match = /^\/api\/app-state\/([^/]+)$/.exec(url.pathname);
  if (!match) return null;

  const key = decodeURIComponent(match[1]);
  if (!VALID_STATE_KEYS.has(key)) {
    return textResponse("Unknown app state key.", 404);
  }

  const store = await readAppStateStore();
  if (request.method === "GET") {
    const value = isLeagueState(store[key]) ? store[key] : null;
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

    if (!isLeagueState(value)) {
      return jsonResponse({ error: "Invalid LeagueState payload." }, 400);
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
