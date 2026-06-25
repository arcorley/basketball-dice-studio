#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8"));
const args = process.argv.slice(2);
const shell = process.platform === "win32";

function flagValue(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
}

function hasFlag(name) {
  return args.includes(`--${name}`);
}

function runGh(ghArgs, options = {}) {
  const result = spawnSync("gh", ghArgs, {
    cwd: rootDir,
    stdio: options.stdio ?? "inherit",
    shell
  });
  return result.status ?? 1;
}

function walkFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const filePath = path.join(directory, entry);
    const stats = statSync(filePath);
    if (stats.isDirectory()) {
      if (!entry.endsWith("-unpacked")) files.push(...walkFiles(filePath));
      continue;
    }
    files.push(filePath);
  }
  return files;
}

function isReleaseAsset(filePath) {
  const name = path.basename(filePath);
  if (name.endsWith(".blockmap")) return false;
  if (name.startsWith("latest") && name.endsWith(".yml")) return false;
  if (name === "builder-debug.yml" || name === "builder-effective-config.yaml") return false;

  return (
    name.endsWith(".AppImage") ||
    name.endsWith(".deb") ||
    name.endsWith(".dmg") ||
    name.endsWith(".exe") ||
    name.endsWith(".pkg") ||
    name.endsWith(".rpm") ||
    name.endsWith(".snap") ||
    name.endsWith(".tar.gz") ||
    name.endsWith(".zip")
  );
}

const tag = flagValue("tag", `v${packageJson.version}`);
const title = flagValue("title", `${packageJson.build?.productName ?? packageJson.name} ${tag}`);
const assetDir = path.resolve(rootDir, flagValue("asset-dir", "release"));
const notesFile = flagValue("notes-file");
const repo = flagValue("repo");
const target = flagValue("target");
const draft = hasFlag("draft");
const prerelease = hasFlag("prerelease");

if (!existsSync(assetDir)) {
  console.error(`Release asset directory does not exist: ${assetDir}`);
  process.exit(1);
}

const assets = walkFiles(assetDir).filter(isReleaseAsset).sort();
if (assets.length === 0) {
  console.error(`No release assets found in ${assetDir}`);
  process.exit(1);
}

if (runGh(["--version"], { stdio: "ignore" }) !== 0) {
  console.error("GitHub CLI is required. Install gh and authenticate before creating releases.");
  process.exit(1);
}

const repoArgs = repo ? ["--repo", repo] : [];
const releaseExists = runGh(["release", "view", tag, ...repoArgs], { stdio: "ignore" }) === 0;

if (releaseExists) {
  process.exit(runGh(["release", "upload", tag, ...assets, "--clobber", ...repoArgs]));
}

const createArgs = ["release", "create", tag, ...assets, "--title", title, ...repoArgs];
if (notesFile) {
  createArgs.push("--notes-file", notesFile);
} else {
  createArgs.push("--generate-notes");
}
if (target) createArgs.push("--target", target);
if (draft) createArgs.push("--draft");
if (prerelease) createArgs.push("--prerelease");

process.exit(runGh(createArgs));
