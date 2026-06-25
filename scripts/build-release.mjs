#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const platformByHost = {
  darwin: "mac",
  linux: "linux",
  win32: "win"
};

const hostByPlatform = {
  mac: "darwin",
  linux: "linux",
  win: "win32"
};

const defaultArchByPlatform = {
  mac: ["x64", "arm64"],
  linux: ["x64"],
  win: ["x64"]
};

const args = process.argv.slice(2);
const separatorIndex = args.indexOf("--");
const scriptArgs = separatorIndex === -1 ? args : args.slice(0, separatorIndex);
const passthroughArgs = separatorIndex === -1 ? [] : args.slice(separatorIndex + 1);
const skipBuild = scriptArgs.includes("--skip-build");
const requestedPlatform = scriptArgs.find((arg) => !arg.startsWith("-")) ?? platformByHost[process.platform];

if (!requestedPlatform || !(requestedPlatform in hostByPlatform)) {
  console.error("Usage: node scripts/build-release.mjs [mac|win|linux] [--skip-build] [-- <electron-builder args>]");
  process.exit(1);
}

const requiredHost = hostByPlatform[requestedPlatform];
if (process.platform !== requiredHost && process.env.BDS_ALLOW_CROSS_PLATFORM_RELEASE !== "1") {
  console.error(
    `Refusing to build ${requestedPlatform} release assets on ${process.platform}. ` +
      `Run this on ${requiredHost}, or set BDS_ALLOW_CROSS_PLATFORM_RELEASE=1 if you intentionally cross-build.`
  );
  process.exit(1);
}

const shell = process.platform === "win32";
const releaseArches = (process.env.BDS_RELEASE_ARCHES || defaultArchByPlatform[requestedPlatform].join(","))
  .split(",")
  .map((arch) => arch.trim())
  .filter(Boolean);

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    shell
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!skipBuild) {
  run("npm", ["run", "build"]);
}

run("npx", [
  "electron-builder",
  `--${requestedPlatform}`,
  ...releaseArches.map((arch) => `--${arch}`),
  "--publish",
  "never",
  ...passthroughArgs
]);

