import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DiceTeamCard, GeneratedSourceData, SourceCatalog, SourceLeague, SourceTeam } from "../src/lib/types";
import { buildDiceTeamCards } from "../src/lib/teamCards";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDataDir = path.join(root, "public", "data");

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

export const sourceCatalog = readJson<SourceCatalog>(path.join(publicDataDir, "catalog.generated.json"));

export const sourceLeagues: SourceLeague[] = sourceCatalog.leagues ?? [];
export const sourceTeams: SourceTeam[] = sourceCatalog.teams.map((team) =>
  readJson<SourceTeam>(path.join(publicDataDir, "teams", `${team.id}.json`))
);
export const sourceData: GeneratedSourceData = {
  generatedAt: sourceCatalog.generatedAt,
  manifestVersion: sourceCatalog.manifestVersion,
  sourceProvider: sourceCatalog.sourceProvider,
  teams: sourceTeams,
  leagues: sourceLeagues
};

const sourceTeamsById = new Map(sourceTeams.map((team) => [team.id, team]));
const teamCardCache = new Map<string, DiceTeamCard>();
let allDiceTeams: DiceTeamCard[] | null = null;

export function getDiceTeams(): DiceTeamCard[] {
  if (!allDiceTeams) {
    allDiceTeams = buildDiceTeamCards(sourceTeams, sourceLeagues);
    for (const team of allDiceTeams) {
      teamCardCache.set(team.id, team);
    }
  }
  return allDiceTeams;
}

export const diceTeams = new Proxy([] as DiceTeamCard[], {
  get(_target, prop) {
    if (prop === "length") return sourceTeams.length;
    if (prop === Symbol.iterator) return getDiceTeams()[Symbol.iterator].bind(getDiceTeams());
    if (typeof prop === "string" && /^\d+$/.test(prop)) {
      const source = sourceTeams[Number(prop)];
      return source ? getTeam(source.id) : undefined;
    }
    const value = Reflect.get(getDiceTeams(), prop);
    return typeof value === "function" ? value.bind(getDiceTeams()) : value;
  },
  ownKeys() {
    return Reflect.ownKeys(getDiceTeams());
  },
  getOwnPropertyDescriptor(_target, prop) {
    return Object.getOwnPropertyDescriptor(getDiceTeams(), prop);
  }
});

export function getTeam(teamId: string): DiceTeamCard {
  const cached = teamCardCache.get(teamId);
  if (cached) return cached;

  const source = sourceTeamsById.get(teamId);
  if (!source) {
    throw new Error(`Unknown team: ${teamId}`);
  }

  const [team] = buildDiceTeamCards([source], sourceLeagues);
  teamCardCache.set(teamId, team);
  return team;
}
