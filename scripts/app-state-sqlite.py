#!/usr/bin/env python3
import argparse
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "data" / "app-state.sqlite"
VALID_KEYS = {"tournament", "season-league", "season-leagues", "history-replays"}


def connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS app_state (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS history_replay_campaigns (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          controlled_franchise TEXT NOT NULL,
          start_season TEXT NOT NULL,
          start_season_end_year INTEGER NOT NULL,
          current_season TEXT NOT NULL,
          current_season_end_year INTEGER NOT NULL,
          original_team_id TEXT NOT NULL,
          current_team_id TEXT NOT NULL,
          active_league_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS history_replay_seasons (
          id TEXT PRIMARY KEY,
          campaign_id TEXT NOT NULL REFERENCES history_replay_campaigns(id) ON DELETE CASCADE,
          league_id TEXT NOT NULL,
          season TEXT NOT NULL,
          season_end_year INTEGER NOT NULL,
          team_id TEXT NOT NULL,
          season_index INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(campaign_id, league_id),
          UNIQUE(campaign_id, season_index)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS history_replay_draft_picks (
          id TEXT PRIMARY KEY,
          campaign_id TEXT NOT NULL REFERENCES history_replay_campaigns(id) ON DELETE CASCADE,
          from_season_id TEXT NOT NULL REFERENCES history_replay_seasons(id) ON DELETE CASCADE,
          to_season_id TEXT NOT NULL REFERENCES history_replay_seasons(id) ON DELETE CASCADE,
          from_league_id TEXT NOT NULL,
          to_league_id TEXT NOT NULL,
          season TEXT NOT NULL,
          season_end_year INTEGER NOT NULL,
          pick_id TEXT NOT NULL,
          pick_label TEXT NOT NULL,
          pick_detail TEXT NOT NULL,
          pick_kind TEXT NOT NULL,
          prospect_snapshot_json TEXT NOT NULL,
          controlled_team_id TEXT NOT NULL,
          controlled_team_name TEXT NOT NULL,
          plan_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
        """
    )
    return conn


def validate_key(key: str) -> None:
    if key not in VALID_KEYS:
        raise SystemExit(f"Unknown app state key: {key}")


def is_league_state(value) -> bool:
    return (
        isinstance(value, dict)
        and isinstance(value.get("id"), str)
        and isinstance(value.get("name"), str)
        and isinstance(value.get("teamIds"), list)
        and isinstance(value.get("games"), list)
        and isinstance(value.get("createdAt"), str)
        and isinstance(value.get("updatedAt"), str)
    )


def is_season_league_collection(value) -> bool:
    return (
        isinstance(value, dict)
        and isinstance(value.get("leagues"), list)
        and all(is_league_state(league) for league in value.get("leagues"))
        and (value.get("activeLeagueId") is None or isinstance(value.get("activeLeagueId"), str))
    )


def is_history_replay_campaign(value) -> bool:
    return (
        isinstance(value, dict)
        and isinstance(value.get("id"), str)
        and isinstance(value.get("name"), str)
        and isinstance(value.get("controlledFranchise"), str)
        and isinstance(value.get("startSeason"), str)
        and isinstance(value.get("startSeasonEndYear"), int)
        and isinstance(value.get("currentSeason"), str)
        and isinstance(value.get("currentSeasonEndYear"), int)
        and isinstance(value.get("originalTeamId"), str)
        and isinstance(value.get("currentTeamId"), str)
        and isinstance(value.get("activeLeagueId"), str)
        and isinstance(value.get("createdAt"), str)
        and isinstance(value.get("updatedAt"), str)
    )


def is_history_replay_season(value) -> bool:
    return (
        isinstance(value, dict)
        and isinstance(value.get("id"), str)
        and isinstance(value.get("campaignId"), str)
        and isinstance(value.get("leagueId"), str)
        and isinstance(value.get("season"), str)
        and isinstance(value.get("seasonEndYear"), int)
        and isinstance(value.get("teamId"), str)
        and isinstance(value.get("seasonIndex"), int)
        and isinstance(value.get("createdAt"), str)
    )


def is_history_replay_draft_pick(value) -> bool:
    prospect_snapshot = value.get("prospectSnapshot") if isinstance(value, dict) else None
    return (
        isinstance(value, dict)
        and isinstance(value.get("id"), str)
        and isinstance(value.get("campaignId"), str)
        and isinstance(value.get("fromSeasonId"), str)
        and isinstance(value.get("toSeasonId"), str)
        and isinstance(value.get("fromLeagueId"), str)
        and isinstance(value.get("toLeagueId"), str)
        and isinstance(value.get("season"), str)
        and isinstance(value.get("seasonEndYear"), int)
        and isinstance(value.get("pickId"), str)
        and isinstance(value.get("pickLabel"), str)
        and isinstance(value.get("pickDetail"), str)
        and value.get("pickKind") == "archetype"
        and isinstance(prospect_snapshot, dict)
        and isinstance(prospect_snapshot.get("prospectId"), str)
        and isinstance(prospect_snapshot.get("archetype"), str)
        and isinstance(prospect_snapshot.get("position"), str)
        and isinstance(prospect_snapshot.get("rank"), int)
        and isinstance(prospect_snapshot.get("projectedPickBand"), str)
        and isinstance(prospect_snapshot.get("needAreas"), list)
        and all(isinstance(area, str) for area in prospect_snapshot.get("needAreas"))
        and isinstance(prospect_snapshot.get("upside"), int)
        and isinstance(prospect_snapshot.get("readiness"), int)
        and isinstance(prospect_snapshot.get("risk"), str)
        and isinstance(value.get("controlledTeamId"), str)
        and isinstance(value.get("controlledTeamName"), str)
        and isinstance(value.get("plan"), dict)
        and isinstance(value.get("createdAt"), str)
    )


def is_history_replay_collection(value) -> bool:
    if not (
        isinstance(value, dict)
        and isinstance(value.get("campaigns"), list)
        and isinstance(value.get("seasons"), list)
        and isinstance(value.get("draftPicks"), list)
        and all(is_history_replay_campaign(row) for row in value.get("campaigns"))
        and all(is_history_replay_season(row) for row in value.get("seasons"))
        and all(is_history_replay_draft_pick(row) for row in value.get("draftPicks"))
    ):
        return False

    campaign_ids = {row["id"] for row in value["campaigns"]}
    season_ids = {row["id"] for row in value["seasons"]}
    league_ids = {row["leagueId"] for row in value["seasons"]}
    return (
        all(row["campaignId"] in campaign_ids for row in value["seasons"])
        and all(row["campaignId"] in campaign_ids for row in value["draftPicks"])
        and all(row["fromSeasonId"] in season_ids and row["toSeasonId"] in season_ids for row in value["draftPicks"])
        and all(row["fromLeagueId"] in league_ids and row["toLeagueId"] in league_ids for row in value["draftPicks"])
    )


def is_valid_state_value(key: str, value) -> bool:
    if key == "history-replays":
        return is_history_replay_collection(value)
    if key == "season-leagues":
        return is_season_league_collection(value)
    return is_league_state(value)


def read_history_replays(conn: sqlite3.Connection) -> None:
    campaigns = [
        {
            "id": row["id"],
            "name": row["name"],
            "controlledFranchise": row["controlled_franchise"],
            "startSeason": row["start_season"],
            "startSeasonEndYear": row["start_season_end_year"],
            "currentSeason": row["current_season"],
            "currentSeasonEndYear": row["current_season_end_year"],
            "originalTeamId": row["original_team_id"],
            "currentTeamId": row["current_team_id"],
            "activeLeagueId": row["active_league_id"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }
        for row in conn.execute("SELECT * FROM history_replay_campaigns ORDER BY updated_at DESC, name ASC")
    ]
    seasons = [
        {
            "id": row["id"],
            "campaignId": row["campaign_id"],
            "leagueId": row["league_id"],
            "season": row["season"],
            "seasonEndYear": row["season_end_year"],
            "teamId": row["team_id"],
            "seasonIndex": row["season_index"],
            "createdAt": row["created_at"],
        }
        for row in conn.execute("SELECT * FROM history_replay_seasons ORDER BY campaign_id ASC, season_index ASC, season_end_year ASC")
    ]
    draft_picks = [
        {
            "id": row["id"],
            "campaignId": row["campaign_id"],
            "fromSeasonId": row["from_season_id"],
            "toSeasonId": row["to_season_id"],
            "fromLeagueId": row["from_league_id"],
            "toLeagueId": row["to_league_id"],
            "season": row["season"],
            "seasonEndYear": row["season_end_year"],
            "pickId": row["pick_id"],
            "pickLabel": row["pick_label"],
            "pickDetail": row["pick_detail"],
            "pickKind": row["pick_kind"],
            "prospectSnapshot": json.loads(row["prospect_snapshot_json"]),
            "controlledTeamId": row["controlled_team_id"],
            "controlledTeamName": row["controlled_team_name"],
            "plan": json.loads(row["plan_json"]),
            "createdAt": row["created_at"],
        }
        for row in conn.execute("SELECT * FROM history_replay_draft_picks ORDER BY created_at ASC, id ASC")
    ]
    print(json.dumps({"state": {"campaigns": campaigns, "seasons": seasons, "draftPicks": draft_picks}}, separators=(",", ":")))


def write_history_replays(conn: sqlite3.Connection) -> None:
    raw = sys.stdin.read()
    value = json.loads(raw)
    if not is_history_replay_collection(value):
        raise SystemExit("Invalid history replay payload.")

    with conn:
        conn.execute("DELETE FROM history_replay_draft_picks")
        conn.execute("DELETE FROM history_replay_seasons")
        conn.execute("DELETE FROM history_replay_campaigns")
        conn.executemany(
            """
            INSERT INTO history_replay_campaigns (
              id,
              name,
              controlled_franchise,
              start_season,
              start_season_end_year,
              current_season,
              current_season_end_year,
              original_team_id,
              current_team_id,
              active_league_id,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    row["id"],
                    row["name"],
                    row["controlledFranchise"],
                    row["startSeason"],
                    row["startSeasonEndYear"],
                    row["currentSeason"],
                    row["currentSeasonEndYear"],
                    row["originalTeamId"],
                    row["currentTeamId"],
                    row["activeLeagueId"],
                    row["createdAt"],
                    row["updatedAt"],
                )
                for row in value["campaigns"]
            ],
        )
        conn.executemany(
            """
            INSERT INTO history_replay_seasons (
              id,
              campaign_id,
              league_id,
              season,
              season_end_year,
              team_id,
              season_index,
              created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    row["id"],
                    row["campaignId"],
                    row["leagueId"],
                    row["season"],
                    row["seasonEndYear"],
                    row["teamId"],
                    row["seasonIndex"],
                    row["createdAt"],
                )
                for row in value["seasons"]
            ],
        )
        conn.executemany(
            """
            INSERT INTO history_replay_draft_picks (
              id,
              campaign_id,
              from_season_id,
              to_season_id,
              from_league_id,
              to_league_id,
              season,
              season_end_year,
              pick_id,
              pick_label,
              pick_detail,
              pick_kind,
              prospect_snapshot_json,
              controlled_team_id,
              controlled_team_name,
              plan_json,
              created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    row["id"],
                    row["campaignId"],
                    row["fromSeasonId"],
                    row["toSeasonId"],
                    row["fromLeagueId"],
                    row["toLeagueId"],
                    row["season"],
                    row["seasonEndYear"],
                    row["pickId"],
                    row["pickLabel"],
                    row["pickDetail"],
                    row["pickKind"],
                    json.dumps(row["prospectSnapshot"], ensure_ascii=False, sort_keys=True, separators=(",", ":")),
                    row["controlledTeamId"],
                    row["controlledTeamName"],
                    json.dumps(row["plan"], ensure_ascii=False, sort_keys=True, separators=(",", ":")),
                    row["createdAt"],
                )
                for row in value["draftPicks"]
            ],
        )
    print(json.dumps({"ok": True}, separators=(",", ":")))


def delete_history_replays(conn: sqlite3.Connection) -> None:
    with conn:
        conn.execute("DELETE FROM history_replay_draft_picks")
        conn.execute("DELETE FROM history_replay_seasons")
        conn.execute("DELETE FROM history_replay_campaigns")
    print(json.dumps({"ok": True}, separators=(",", ":")))


def read_state(conn: sqlite3.Connection, key: str) -> None:
    if key == "history-replays":
        read_history_replays(conn)
        return

    row = conn.execute("SELECT value_json FROM app_state WHERE key = ?", (key,)).fetchone()
    value = json.loads(row[0]) if row else None
    if value is not None and not is_valid_state_value(key, value):
        conn.execute("DELETE FROM app_state WHERE key = ?", (key,))
        conn.commit()
        value = None
    print(json.dumps({"state": value}, separators=(",", ":")))


def write_state(conn: sqlite3.Connection, key: str) -> None:
    if key == "history-replays":
        write_history_replays(conn)
        return

    raw = sys.stdin.read()
    value = json.loads(raw)
    if not is_valid_state_value(key, value):
        raise SystemExit("Invalid app state payload.")
    normalized = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    conn.execute(
        """
        INSERT INTO app_state (key, value_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = excluded.updated_at
        """,
        (key, normalized, datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()
    print(json.dumps({"ok": True}, separators=(",", ":")))


def delete_state(conn: sqlite3.Connection, key: str) -> None:
    if key == "history-replays":
        delete_history_replays(conn)
        return

    conn.execute("DELETE FROM app_state WHERE key = ?", (key,))
    conn.commit()
    print(json.dumps({"ok": True}, separators=(",", ":")))


def main() -> None:
    parser = argparse.ArgumentParser(description="Read and write Basketball Dice Studio app state in SQLite.")
    parser.add_argument("action", choices=["read", "write", "delete"])
    parser.add_argument("key")
    parser.add_argument("--db", default=str(DEFAULT_DB))
    args = parser.parse_args()

    validate_key(args.key)
    with connect(Path(args.db)) as conn:
        if args.action == "read":
            read_state(conn, args.key)
        elif args.action == "write":
            write_state(conn, args.key)
        else:
            delete_state(conn, args.key)


if __name__ == "__main__":
    main()
