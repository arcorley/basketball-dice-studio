import react from "@vitejs/plugin-react";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig, type Plugin, type PreviewServer, type ViteDevServer } from "vite";

const rootDir = dirname(fileURLToPath(import.meta.url));
const appStateScript = resolve(rootDir, "scripts/app-state-sqlite.py");
const validStateKeys = new Set(["tournament", "season-league", "season-leagues"]);
const appStateMaxBuffer = 64 * 1024 * 1024;

function readBody(request: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolveBody, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => resolveBody(body));
    request.on("error", reject);
  });
}

function runStateCommand(action: "read" | "write" | "delete", key: string, body?: string): Promise<string> {
  return new Promise((resolveCommand, reject) => {
    const child = execFile("python3", [appStateScript, action, key], { cwd: rootDir, maxBuffer: appStateMaxBuffer }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message));
        return;
      }
      resolveCommand(stdout);
    });
    if (body) child.stdin?.write(body);
    child.stdin?.end();
  });
}

function appStatePlugin(): Plugin {
  const attach = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use(async (request, response, next) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const match = /^\/api\/app-state\/([^/]+)$/.exec(url.pathname);
      if (!match) {
        next();
        return;
      }

      const key = decodeURIComponent(match[1]);
      if (!validStateKeys.has(key)) {
        response.statusCode = 404;
        response.end("Unknown app state key.");
        return;
      }

      response.setHeader("Content-Type", "application/json; charset=utf-8");
      try {
        if (request.method === "GET") {
          response.end(await runStateCommand("read", key));
          return;
        }
        if (request.method === "PUT") {
          response.end(await runStateCommand("write", key, await readBody(request)));
          return;
        }
        if (request.method === "DELETE") {
          response.end(await runStateCommand("delete", key));
          return;
        }
        response.statusCode = 405;
        response.end(JSON.stringify({ error: "Method not allowed." }));
      } catch (reason) {
        response.statusCode = 500;
        response.end(JSON.stringify({ error: reason instanceof Error ? reason.message : String(reason) }));
      }
    });
  };

  return {
    name: "basketball-dice-app-state",
    configureServer: attach,
    configurePreviewServer: attach
  };
}

export default defineConfig({
  plugins: [react(), appStatePlugin()]
});
