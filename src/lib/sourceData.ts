import generatedData from "../data/teams.generated.json";
import type { DiceTeamCard, GeneratedSourceData, SourceLeague, SourceTeam } from "./types";
import { buildDiceTeamCards } from "./teamCards";

export const sourceData = generatedData as GeneratedSourceData;

export const sourceTeams: SourceTeam[] = sourceData.teams;
export const sourceLeagues: SourceLeague[] = sourceData.leagues ?? [];

export const diceTeams: DiceTeamCard[] = buildDiceTeamCards(sourceTeams, sourceLeagues);

export const teamsById = new Map(diceTeams.map((team) => [team.id, team]));

export function getTeam(teamId: string): DiceTeamCard {
  const team = teamsById.get(teamId);
  if (!team) {
    throw new Error(`Unknown team: ${teamId}`);
  }
  return team;
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
