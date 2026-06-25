#!/usr/bin/env python3
import argparse
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "data" / "app-state.sqlite"
VALID_KEYS = {"tournament", "season-league", "season-leagues"}


def connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS app_state (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
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


def is_valid_state_value(key: str, value) -> bool:
    if key == "season-leagues":
        return is_season_league_collection(value)
    return is_league_state(value)


def read_state(conn: sqlite3.Connection, key: str) -> None:
    row = conn.execute("SELECT value_json FROM app_state WHERE key = ?", (key,)).fetchone()
    value = json.loads(row[0]) if row else None
    if value is not None and not is_valid_state_value(key, value):
        conn.execute("DELETE FROM app_state WHERE key = ?", (key,))
        conn.commit()
        value = None
    print(json.dumps({"state": value}, separators=(",", ":")))


def write_state(conn: sqlite3.Connection, key: str) -> None:
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
