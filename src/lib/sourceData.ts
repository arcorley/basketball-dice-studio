import type { DiceTeamCard, SourceCatalog, SourceLeague, SourceTeam } from "./types";
import { buildDiceTeamCards } from "./teamCards";

const dataBaseUrl = `${import.meta.env.BASE_URL}data`;
let catalogPromise: Promise<SourceCatalog> | null = null;
const sourceTeamPromises = new Map<string, Promise<SourceTeam>>();
const diceTeamPromises = new Map<string, Promise<DiceTeamCard>>();

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status}`);
  }
  return (await response.json()) as T;
}

export function teamDetailUrl(teamId: string): string {
  return `${dataBaseUrl}/teams/${teamId}.json`;
}

export function loadSourceCatalog(): Promise<SourceCatalog> {
  catalogPromise ??= fetchJson<SourceCatalog>(`${dataBaseUrl}/catalog.generated.json`);
  return catalogPromise;
}

export function loadSourceTeam(teamId: string): Promise<SourceTeam> {
  const cached = sourceTeamPromises.get(teamId);
  if (cached) return cached;

  const promise = fetchJson<SourceTeam>(teamDetailUrl(teamId));
  sourceTeamPromises.set(teamId, promise);
  return promise;
}

export async function loadDiceTeam(teamId: string, leagues?: SourceLeague[]): Promise<DiceTeamCard> {
  const cached = diceTeamPromises.get(teamId);
  if (cached) return cached;

  const promise = Promise.all([loadSourceTeam(teamId), leagues ? Promise.resolve(leagues) : loadSourceCatalog().then((catalog) => catalog.leagues)]).then(
    ([source, sourceLeagues]) => buildDiceTeamCards([source], sourceLeagues)[0]
  );
  diceTeamPromises.set(teamId, promise);
  return promise;
}

export function formatNumber(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  });
}

export function formatPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return `${(value * 100).toFixed(digits)}%`;
}
