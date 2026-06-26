import type { LeagueState } from "./types";

type AppStateKey = "tournament" | "season-league" | "season-leagues";

export interface SeasonLeagueCollectionState {
  leagues: LeagueState[];
  activeLeagueId: string | null;
}

export interface LoadedSeasonLeagueCollectionState {
  collection: SeasonLeagueCollectionState;
  hasStoredCollection: boolean;
}

function isLeagueState(value: unknown): value is LeagueState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LeagueState>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    Array.isArray(candidate.teamIds) &&
    Array.isArray(candidate.games) &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string"
  );
}

function normalizeSeasonLeagueCollection(value: unknown): SeasonLeagueCollectionState {
  if (!value || typeof value !== "object") return { leagues: [], activeLeagueId: null };
  const candidate = value as Partial<SeasonLeagueCollectionState>;
  const leagues = Array.isArray(candidate.leagues) ? candidate.leagues.filter(isLeagueState) : [];
  const activeLeagueId = typeof candidate.activeLeagueId === "string" && leagues.some((league) => league.id === candidate.activeLeagueId) ? candidate.activeLeagueId : leagues[0]?.id ?? null;
  return { leagues, activeLeagueId };
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `App state request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

async function loadStateValue(key: AppStateKey): Promise<unknown> {
  const response = await fetch(`/api/app-state/${key}`, {
    headers: { Accept: "application/json" },
    cache: "no-store"
  });
  const payload = await parseResponse<{ state: unknown }>(response);
  return payload.state;
}

async function loadState(key: AppStateKey): Promise<LeagueState | null> {
  const state = await loadStateValue(key);
  return isLeagueState(state) ? state : null;
}

async function saveStateValue(key: AppStateKey, state: unknown | null): Promise<void> {
  if (!state) {
    await parseResponse<{ ok: true }>(
      await fetch(`/api/app-state/${key}`, {
        method: "DELETE",
        headers: { Accept: "application/json" }
      })
    );
    return;
  }

  await parseResponse<{ ok: true }>(
    await fetch(`/api/app-state/${key}`, {
      method: "PUT",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(state)
    })
  );
}

async function saveState(key: AppStateKey, state: LeagueState | null): Promise<void> {
  return saveStateValue(key, state);
}

export function loadTournament(): Promise<LeagueState | null> {
  return loadState("tournament");
}

export function saveTournament(tournament: LeagueState | null): Promise<void> {
  return saveState("tournament", tournament);
}

export function loadSeasonLeague(): Promise<LeagueState | null> {
  return loadState("season-league");
}

export function saveSeasonLeague(league: LeagueState | null): Promise<void> {
  return saveState("season-league", league);
}

export async function loadSeasonLeagues(): Promise<SeasonLeagueCollectionState> {
  return (await loadSeasonLeagueCollection()).collection;
}

export async function loadSeasonLeagueCollection(): Promise<LoadedSeasonLeagueCollectionState> {
  const state = await loadStateValue("season-leagues");
  return {
    collection: normalizeSeasonLeagueCollection(state),
    hasStoredCollection: Boolean(state && typeof state === "object")
  };
}

export async function saveSeasonLeagues(collection: SeasonLeagueCollectionState): Promise<void> {
  await saveStateValue("season-leagues", normalizeSeasonLeagueCollection(collection));
  await saveStateValue("season-league", null);
}
