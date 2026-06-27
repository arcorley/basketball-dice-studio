import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

type StepResult = {
  id: string;
  label: string;
  command: string[];
  status: "pass" | "fail" | "skipped";
  elapsedSeconds: number;
  output?: string;
};

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    return [key, value] as const;
  })
);

const outputPath = path.resolve(args.get("output") ?? path.join(process.cwd(), "reports", "model-acceptance.json"));
const markdownPath = path.resolve(args.get("markdown") ?? outputPath.replace(/\.json$/i, ".md"));
const crossEraReport = path.resolve(args.get("cross-era-report") ?? path.join(process.cwd(), "reports", "cross-era-model-current-240x50-seed-7777.json"));
const sameEraOutput = path.resolve(args.get("same-era-output") ?? path.join(process.cwd(), "reports", "model-acceptance-same-era.json"));
const expectedPlayersOutput = path.resolve(args.get("expected-players-output") ?? path.join(process.cwd(), "reports", "model-acceptance-expected-players.json"));
const leverOutput = path.resolve(args.get("lever-output") ?? path.join(process.cwd(), "reports", "model-acceptance-gameplay-levers.json"));

const sameEraPairsPerSeason = integerArg("same-era-pairs-per-season", 2);
const sameEraGamesPerPair = integerArg("same-era-games-per-pair", 60);
const sameEraSeed = integerArg("same-era-seed", 6262);
const expectedPlayersPairs = integerArg("expected-players-pairs", 80);
const expectedPlayersSeed = integerArg("expected-players-seed", 7373);
const leverPairsPerBucket = integerArg("lever-pairs-per-bucket", 2);
const leverGamesPerScenario = integerArg("lever-games-per-scenario", 80);
const leverSeed = integerArg("lever-seed", 9292);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function numberArg(name: string, fallback: number): number {
  const value = args.get(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid --${name}: ${value}`);
  return parsed;
}

function integerArg(name: string, fallback: number): number {
  const parsed = numberArg(name, fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Invalid --${name}: ${parsed}`);
  return parsed;
}

function fixed(value: number, digits = 1): number {
  return Number(value.toFixed(digits));
}

function runStep(id: string, label: string, command: string[], skip = false): StepResult {
  if (skip) {
    return {
      id,
      label,
      command,
      status: "skipped",
      elapsedSeconds: 0
    };
  }

  const started = Date.now();
  console.log(`\n[model-acceptance] ${label}`);
  console.log(command.join(" "));
  const result = spawnSync(command[0], command.slice(1), {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  const elapsedSeconds = fixed((Date.now() - started) / 1000);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return {
    id,
    label,
    command,
    status: result.status === 0 ? "pass" : "fail",
    elapsedSeconds,
    output: [result.stdout, result.stderr].filter(Boolean).join("\n").trim() || undefined
  };
}

function markdown(report: { generatedAt: string; status: string; steps: StepResult[] }): string {
  const lines = [
    "# Model Acceptance",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Status: ${report.status.toUpperCase()}`,
    "",
    "| Step | Status | Seconds |",
    "| --- | --- | ---: |"
  ];
  for (const step of report.steps) {
    lines.push(`| ${step.label} | ${step.status.toUpperCase()} | ${step.elapsedSeconds} |`);
  }
  const failures = report.steps.filter((step) => step.status === "fail");
  if (failures.length) {
    lines.push("", "## Failures");
    for (const step of failures) {
      lines.push("", `### ${step.label}`, "", "```text", step.output ?? step.command.join(" "), "```");
    }
  }
  return `${lines.join("\n")}\n`;
}

const steps: StepResult[] = [];

steps.push(
  runStep(
    "cross-era-current-baseline",
    "Validate current cross-era baseline",
    [npmCommand, "run", "validate:cross-era", "--", `--report=${crossEraReport}`],
    args.get("skip-cross-era") === "true"
  )
);

steps.push(
  runStep(
    "same-era-calibration",
    "Same-era calibration",
    [
      npmCommand,
      "run",
      "analyze:same-era",
      "--",
      `--pairs-per-season=${sameEraPairsPerSeason}`,
      `--games-per-pair=${sameEraGamesPerPair}`,
      `--seed=${sameEraSeed}`,
      `--output=${sameEraOutput}`
    ],
    args.get("skip-same-era") === "true"
  )
);

steps.push(
  runStep(
    "expected-player-lines",
    "Expected player-line reconciliation",
    [
      npmCommand,
      "run",
      "validate:expected-players",
      "--",
      `--pairs=${expectedPlayersPairs}`,
      `--seed=${expectedPlayersSeed}`,
      `--output=${expectedPlayersOutput}`
    ],
    args.get("skip-expected-players") === "true"
  )
);

steps.push(
  runStep(
    "gameplay-lever-smoke",
    "Gameplay lever smoke",
    [
      npmCommand,
      "run",
      "sweep:gameplay-levers",
      "--",
      `--pairs-per-bucket=${leverPairsPerBucket}`,
      `--games-per-scenario=${leverGamesPerScenario}`,
      `--seed=${leverSeed}`,
      `--output=${leverOutput}`
    ],
    args.get("skip-levers") === "true"
  )
);

const status = steps.some((step) => step.status === "fail") ? "fail" : "pass";
const report = {
  generatedAt: new Date().toISOString(),
  status,
  crossEraReport: path.relative(process.cwd(), crossEraReport),
  sameEraOutput: path.relative(process.cwd(), sameEraOutput),
  expectedPlayersOutput: path.relative(process.cwd(), expectedPlayersOutput),
  leverOutput: path.relative(process.cwd(), leverOutput),
  steps
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(markdownPath, markdown(report));

console.log(`\n${status.toUpperCase()}: ${path.relative(process.cwd(), outputPath)}`);
console.log(`Markdown summary: ${path.relative(process.cwd(), markdownPath)}`);
if (status === "fail") process.exit(1);
