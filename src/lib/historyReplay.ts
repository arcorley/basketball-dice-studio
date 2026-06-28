import type { TeamGamePlanOptions } from "./types";

export interface HistoryReplayProspectSnapshot {
  prospectId: string;
  archetype: string;
  position: string;
  rank: number;
  projectedPickBand: string;
  needAreas: string[];
  upside: number;
  readiness: number;
  risk: string;
}

export interface HistoryReplayCampaign {
  id: string;
  name: string;
  controlledFranchise: string;
  startSeason: string;
  startSeasonEndYear: number;
  currentSeason: string;
  currentSeasonEndYear: number;
  originalTeamId: string;
  currentTeamId: string;
  activeLeagueId: string;
  createdAt: string;
  updatedAt: string;
}

export interface HistoryReplaySeason {
  id: string;
  campaignId: string;
  leagueId: string;
  season: string;
  seasonEndYear: number;
  teamId: string;
  seasonIndex: number;
  createdAt: string;
}

export interface HistoryReplayDraftPick {
  id: string;
  campaignId: string;
  fromSeasonId: string;
  toSeasonId: string;
  fromLeagueId: string;
  toLeagueId: string;
  season: string;
  seasonEndYear: number;
  pickId: string;
  pickLabel: string;
  pickDetail: string;
  pickKind: "archetype";
  prospectSnapshot: HistoryReplayProspectSnapshot;
  controlledTeamId: string;
  controlledTeamName: string;
  plan: TeamGamePlanOptions;
  createdAt: string;
}

export interface HistoryReplayCollectionState {
  campaigns: HistoryReplayCampaign[];
  seasons: HistoryReplaySeason[];
  draftPicks: HistoryReplayDraftPick[];
}

export const emptyHistoryReplayCollection: HistoryReplayCollectionState = {
  campaigns: [],
  seasons: [],
  draftPicks: []
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizePlan(value: unknown): TeamGamePlanOptions {
  return isRecord(value) ? (value as TeamGamePlanOptions) : {};
}

function isProspectSnapshot(value: unknown): value is HistoryReplayProspectSnapshot {
  return (
    isRecord(value) &&
    isString(value.prospectId) &&
    isString(value.archetype) &&
    isString(value.position) &&
    isFiniteNumber(value.rank) &&
    isString(value.projectedPickBand) &&
    Array.isArray(value.needAreas) &&
    value.needAreas.every(isString) &&
    isFiniteNumber(value.upside) &&
    isFiniteNumber(value.readiness) &&
    isString(value.risk)
  );
}

function isCampaign(value: unknown): value is HistoryReplayCampaign {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.name) &&
    isString(value.controlledFranchise) &&
    isString(value.startSeason) &&
    isFiniteNumber(value.startSeasonEndYear) &&
    isString(value.currentSeason) &&
    isFiniteNumber(value.currentSeasonEndYear) &&
    isString(value.originalTeamId) &&
    isString(value.currentTeamId) &&
    isString(value.activeLeagueId) &&
    isString(value.createdAt) &&
    isString(value.updatedAt)
  );
}

function isSeason(value: unknown): value is HistoryReplaySeason {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.campaignId) &&
    isString(value.leagueId) &&
    isString(value.season) &&
    isFiniteNumber(value.seasonEndYear) &&
    isString(value.teamId) &&
    isFiniteNumber(value.seasonIndex) &&
    isString(value.createdAt)
  );
}

function isDraftPick(value: unknown): value is HistoryReplayDraftPick {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.campaignId) &&
    isString(value.fromSeasonId) &&
    isString(value.toSeasonId) &&
    isString(value.fromLeagueId) &&
    isString(value.toLeagueId) &&
    isString(value.season) &&
    isFiniteNumber(value.seasonEndYear) &&
    isString(value.pickId) &&
    isString(value.pickLabel) &&
    isString(value.pickDetail) &&
    value.pickKind === "archetype" &&
    isProspectSnapshot(value.prospectSnapshot) &&
    isString(value.controlledTeamId) &&
    isString(value.controlledTeamName) &&
    isString(value.createdAt)
  );
}

export function normalizeHistoryReplayCollection(value: unknown): HistoryReplayCollectionState {
  if (!isRecord(value)) return emptyHistoryReplayCollection;
  const campaigns = Array.isArray(value.campaigns) ? value.campaigns.filter(isCampaign) : [];
  const campaignIds = new Set(campaigns.map((campaign) => campaign.id));
  const seasons = Array.isArray(value.seasons)
    ? value.seasons.filter((season): season is HistoryReplaySeason => isSeason(season) && campaignIds.has(season.campaignId))
    : [];
  const seasonIds = new Set(seasons.map((season) => season.id));
  const leagueIds = new Set(seasons.map((season) => season.leagueId));
  const draftPicks = Array.isArray(value.draftPicks)
    ? value.draftPicks
        .filter(
          (pick): pick is HistoryReplayDraftPick =>
            isDraftPick(pick) &&
            campaignIds.has(pick.campaignId) &&
            seasonIds.has(pick.fromSeasonId) &&
            seasonIds.has(pick.toSeasonId) &&
            leagueIds.has(pick.fromLeagueId) &&
            leagueIds.has(pick.toLeagueId)
        )
        .map((pick) => ({ ...pick, plan: normalizePlan(pick.plan) }))
    : [];

  return {
    campaigns: campaigns
      .filter((campaign) => seasons.some((season) => season.campaignId === campaign.id))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name)),
    seasons: seasons.sort((a, b) => a.campaignId.localeCompare(b.campaignId) || a.seasonIndex - b.seasonIndex || a.seasonEndYear - b.seasonEndYear),
    draftPicks: draftPicks.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  };
}
