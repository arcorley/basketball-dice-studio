import electronPath from "electron";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function spawnProcess(command, args, options = {}) {
  return spawn(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    ...options
  });
}

async function waitForServer(url) {
  const deadline = Date.now() + 60_000;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for ${url}${lastError ? `: ${lastError.message}` : ""}`);
}

const vite = spawnProcess(npmCommand, ["run", "dev", "--", "--port", "5173"]);

let electron;
let shuttingDown = false;

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  if (electron && !electron.killed) electron.kill();
  if (!vite.killed) vite.kill();
  process.exit(exitCode);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

vite.on("exit", (code) => {
  if (!shuttingDown && code !== 0) {
    shutdown(code ?? 1);
  }
});

try {
  await waitForServer(devServerUrl);
  electron = spawnProcess(electronPath, [rootDir], {
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: devServerUrl
    }
  });

  electron.on("exit", (code) => shutdown(code ?? 0));
} catch (error) {
  console.error(error);
  shutdown(1);
}
