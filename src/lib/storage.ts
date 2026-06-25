import type { LeagueState } from "./types";

const key = "basketball-dice-studio:v0.6:league";

export function loadLeague(): LeagueState | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LeagueState;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

export function saveLeague(league: LeagueState | null): void {
  if (!league) {
    localStorage.removeItem(key);
    return;
  }
  localStorage.setItem(key, JSON.stringify(league));
}
