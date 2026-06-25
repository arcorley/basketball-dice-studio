#!/usr/bin/env python3
import argparse
import hashlib
import json
import math
import re
import sqlite3
import unicodedata
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "data" / "teams.generated.json"
DEFAULT_OUTPUT = ROOT / "data" / "basketball-dice.sqlite"
SCHEDULE_GLOB = "schedule-*.json"
REGULAR_SEASON_END_BY_YEAR = {
    2021: "2021-05-16",
}

TEAM_TOTAL_KEYS = ["fg", "fga", "fg3", "fg3a", "fg2", "fg2a", "ft", "fta", "orb", "drb", "trb", "ast", "stl", "blk", "tov", "pf", "pts"]
LEAGUE_STRENGTH_MODEL_VERSION = "league-strength-v1"
SHOT_LOCATION_MODEL_VERSION = "shot-location-proxy-v1"
SHOT_LOCATION_MIN_FGA = 50
EARLY_LOCATION_WARNING = "sports-reference-flags-1997-2000-shot-location-quality"
SHOT_LOCATION_METHODS = ("sourced-location", "same-player-neighbor-proxy", "era-role-neighbor-proxy", "manual-audit")


def slugify(value):
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", normalized.lower()).strip("-")
    if slug:
        return slug
    return hashlib.sha1(value.encode("utf-8")).hexdigest()[:12]


def json_text(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def clamp(value, low, high):
    return min(high, max(low, value))


def finite(value):
    return value is not None and isinstance(value, (int, float)) and math.isfinite(value)


def season_label(season_end_year):
    return f"{season_end_year - 1}-{str(season_end_year)[-2:]}"


def game_date_iso(date_text):
    return datetime.strptime(date_text, "%a, %b %d, %Y").date().isoformat()


def game_type(season_end_year, date_iso):
    regular_season_end = REGULAR_SEASON_END_BY_YEAR.get(season_end_year)
    if regular_season_end is None:
        return "regular_season"
    return "regular_season" if date_iso <= regular_season_end else "postseason"


def table_columns_sql(columns):
    return ",\n    ".join(columns)


def metric_columns(prefix=""):
    return [
        f"{prefix}wins REAL",
        f"{prefix}losses REAL",
        f"{prefix}pace REAL",
        f"{prefix}offensive_rating REAL",
        f"{prefix}defensive_rating REAL",
        f"{prefix}expected_wins REAL",
        f"{prefix}expected_losses REAL",
        f"{prefix}simple_rating REAL",
        f"{prefix}strength_of_schedule REAL",
        f"{prefix}margin_of_victory REAL",
        f"{prefix}efg_pct REAL",
        f"{prefix}turnover_pct REAL",
        f"{prefix}offensive_rebound_pct REAL",
        f"{prefix}free_throw_attempt_rate REAL",
        f"{prefix}free_throw_rate REAL",
        f"{prefix}opponent_efg_pct REAL",
        f"{prefix}opponent_turnover_pct REAL",
        f"{prefix}defensive_rebound_pct REAL",
        f"{prefix}opponent_free_throw_attempt_rate REAL",
        f"{prefix}opponent_free_throw_rate REAL",
        f"{prefix}three_attempt_rate REAL",
    ]


def league_team_metric_columns():
    return [
        "wins REAL",
        "losses REAL",
        "pace REAL",
        "offensive_rating REAL",
        "defensive_rating REAL",
        "net_rating REAL",
        "simple_rating REAL",
        "margin_of_victory REAL",
        "efg_pct REAL",
        "turnover_pct REAL",
        "offensive_rebound_pct REAL",
        "free_throw_rate REAL",
        "free_throw_attempt_rate REAL",
        "opponent_efg_pct REAL",
        "opponent_turnover_pct REAL",
        "defensive_rebound_pct REAL",
        "opponent_free_throw_attempt_rate REAL",
        "opponent_free_throw_rate REAL",
        "three_attempt_rate REAL",
        "fg2_pct REAL",
        "fg3_pct REAL",
        "ft_pct REAL",
    ]


def create_schema(conn):
    conn.executescript(
        f"""
        PRAGMA foreign_keys = ON;

        CREATE TABLE metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE seasons (
          season_end_year INTEGER PRIMARY KEY,
          season TEXT NOT NULL
        );

        CREATE TABLE franchises (
          franchise_id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE
        );

        CREATE TABLE source_pages (
          source_page_id INTEGER PRIMARY KEY AUTOINCREMENT,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          provider TEXT,
          url TEXT,
          fetched_at TEXT,
          page_title TEXT,
          h1 TEXT,
          table_ids_json TEXT NOT NULL DEFAULT '[]'
        );

        CREATE TABLE source_page_tables (
          source_page_id INTEGER NOT NULL REFERENCES source_pages(source_page_id) ON DELETE CASCADE,
          ordinal INTEGER NOT NULL,
          table_id TEXT,
          caption TEXT,
          row_count INTEGER,
          headers_json TEXT NOT NULL,
          PRIMARY KEY (source_page_id, ordinal)
        );

        CREATE TABLE team_seasons (
          team_id TEXT PRIMARY KEY,
          season_end_year INTEGER NOT NULL REFERENCES seasons(season_end_year),
          franchise_id TEXT NOT NULL REFERENCES franchises(franchise_id),
          name TEXT NOT NULL,
          short_name TEXT NOT NULL,
          abbr TEXT NOT NULL,
          source_page_id INTEGER REFERENCES source_pages(source_page_id)
        );

        CREATE TABLE team_metrics (
          team_id TEXT PRIMARY KEY REFERENCES team_seasons(team_id) ON DELETE CASCADE,
          {table_columns_sql(metric_columns())}
        );

        CREATE TABLE team_totals (
          team_id TEXT NOT NULL REFERENCES team_seasons(team_id) ON DELETE CASCADE,
          side TEXT NOT NULL CHECK (side IN ('team', 'opponent')),
          fg REAL,
          fga REAL,
          fg3 REAL,
          fg3a REAL,
          fg2 REAL,
          fg2a REAL,
          ft REAL,
          fta REAL,
          orb REAL,
          drb REAL,
          trb REAL,
          ast REAL,
          stl REAL,
          blk REAL,
          tov REAL,
          pf REAL,
          pts REAL,
          PRIMARY KEY (team_id, side)
        );

        CREATE TABLE players (
          player_id TEXT PRIMARY KEY,
          source_id TEXT UNIQUE,
          name TEXT NOT NULL
        );

        CREATE TABLE player_team_seasons (
          player_team_season_id TEXT PRIMARY KEY,
          player_id TEXT NOT NULL REFERENCES players(player_id),
          team_id TEXT NOT NULL REFERENCES team_seasons(team_id) ON DELETE CASCADE,
          source_id TEXT,
          source_url TEXT,
          name TEXT NOT NULL,
          position TEXT,
          age REAL,
          games REAL,
          games_started REAL,
          minutes REAL,
          jersey_number TEXT,
          height TEXT,
          weight REAL,
          birth_date TEXT,
          college TEXT,
          postseason_json TEXT
        );

        CREATE TABLE player_per_game (
          player_team_season_id TEXT PRIMARY KEY REFERENCES player_team_seasons(player_team_season_id) ON DELETE CASCADE,
          mp REAL,
          pts REAL,
          trb REAL,
          ast REAL,
          stl REAL,
          blk REAL,
          tov REAL,
          pf REAL,
          fga REAL,
          fg3a REAL,
          fta REAL
        );

        CREATE TABLE player_totals (
          player_team_season_id TEXT PRIMARY KEY REFERENCES player_team_seasons(player_team_season_id) ON DELETE CASCADE,
          fg REAL,
          fga REAL,
          fg_pct REAL,
          fg3 REAL,
          fg3a REAL,
          fg3_pct REAL,
          fg2 REAL,
          fg2a REAL,
          fg2_pct REAL,
          ft REAL,
          fta REAL,
          ft_pct REAL,
          orb REAL,
          drb REAL,
          trb REAL,
          ast REAL,
          stl REAL,
          blk REAL,
          tov REAL,
          pf REAL,
          pts REAL
        );

        CREATE TABLE player_per_100 (
          player_team_season_id TEXT PRIMARY KEY REFERENCES player_team_seasons(player_team_season_id) ON DELETE CASCADE,
          fga REAL,
          fg3a REAL,
          fta REAL,
          orb REAL,
          drb REAL,
          trb REAL,
          ast REAL,
          stl REAL,
          blk REAL,
          tov REAL,
          pf REAL,
          pts REAL,
          off_rtg REAL,
          def_rtg REAL
        );

        CREATE TABLE player_advanced (
          player_team_season_id TEXT PRIMARY KEY REFERENCES player_team_seasons(player_team_season_id) ON DELETE CASCADE,
          usage_pct REAL,
          ts_pct REAL,
          three_attempt_rate REAL,
          free_throw_rate REAL,
          orb_pct REAL,
          drb_pct REAL,
          trb_pct REAL,
          ast_pct REAL,
          stl_pct REAL,
          blk_pct REAL,
          tov_pct REAL,
          ows REAL,
          dws REAL,
          ws REAL,
          obpm REAL,
          dbpm REAL,
          bpm REAL
        );

        CREATE TABLE player_shooting (
          player_team_season_id TEXT PRIMARY KEY REFERENCES player_team_seasons(player_team_season_id) ON DELETE CASCADE,
          avg_distance REAL,
          pct_fga_2p REAL,
          pct_fga_00_03 REAL,
          pct_fga_03_10 REAL,
          pct_fga_10_16 REAL,
          pct_fga_16_xx REAL,
          pct_fga_3p REAL,
          fg_pct_2p REAL,
          fg_pct_00_03 REAL,
          fg_pct_03_10 REAL,
          fg_pct_10_16 REAL,
          fg_pct_16_xx REAL,
          fg_pct_3p REAL,
          pct_ast_2p REAL,
          pct_ast_3p REAL,
          pct_fga_dunk REAL,
          fg_dunk REAL,
          pct_corner_3 REAL,
          corner_3_pct REAL
        );

        CREATE TABLE player_shot_location_profiles (
          player_team_season_id TEXT PRIMARY KEY REFERENCES player_team_seasons(player_team_season_id) ON DELETE CASCADE,
          method TEXT NOT NULL CHECK (method IN {SHOT_LOCATION_METHODS}),
          model_version TEXT NOT NULL,
          confidence REAL NOT NULL,
          source_refs_json TEXT NOT NULL DEFAULT '[]',
          source_player_seasons_json TEXT NOT NULL DEFAULT '[]',
          neighbor_count INTEGER NOT NULL DEFAULT 0,
          source_fga REAL NOT NULL DEFAULT 0,
          quality_warnings_json TEXT NOT NULL DEFAULT '[]',
          pct_fga_00_03 REAL,
          pct_fga_03_10 REAL,
          pct_fga_10_16 REAL,
          pct_fga_16_xx REAL,
          pct_fga_3p REAL,
          fg_pct_00_03 REAL,
          fg_pct_03_10 REAL,
          fg_pct_10_16 REAL,
          fg_pct_16_xx REAL,
          fg_pct_3p REAL
        );

        CREATE TABLE player_play_by_play (
          player_team_season_id TEXT PRIMARY KEY REFERENCES player_team_seasons(player_team_season_id) ON DELETE CASCADE,
          plus_minus_on REAL,
          plus_minus_net REAL,
          bad_pass_turnovers REAL,
          lost_ball_turnovers REAL,
          shooting_fouls REAL,
          offensive_fouls REAL,
          drawn_shooting REAL,
          drawn_offensive REAL,
          assisted_points REAL,
          and_ones REAL,
          own_shots_blocked REAL
        );

        CREATE TABLE league_seasons (
          season_end_year INTEGER PRIMARY KEY REFERENCES seasons(season_end_year),
          season TEXT NOT NULL,
          qualified_player_count INTEGER NOT NULL DEFAULT 0,
          source_page_id INTEGER REFERENCES source_pages(source_page_id)
        );

        CREATE TABLE league_averages (
          season_end_year INTEGER PRIMARY KEY REFERENCES league_seasons(season_end_year) ON DELETE CASCADE,
          pace REAL,
          offensive_rating REAL,
          defensive_rating REAL,
          simple_rating REAL,
          margin_of_victory REAL,
          efg_pct REAL,
          turnover_pct REAL,
          offensive_rebound_pct REAL,
          free_throw_rate REAL,
          free_throw_attempt_rate REAL,
          opponent_efg_pct REAL,
          opponent_turnover_pct REAL,
          defensive_rebound_pct REAL,
          opponent_free_throw_attempt_rate REAL,
          opponent_free_throw_rate REAL,
          three_attempt_rate REAL,
          fg2_pct REAL,
          fg3_pct REAL,
          ft_pct REAL
        );

        CREATE TABLE league_metric_distributions (
          season_end_year INTEGER NOT NULL REFERENCES league_seasons(season_end_year) ON DELETE CASCADE,
          scope TEXT NOT NULL CHECK (scope IN ('team', 'player')),
          metric TEXT NOT NULL,
          mean REAL NOT NULL,
          stdev REAL NOT NULL,
          min REAL NOT NULL,
          max REAL NOT NULL,
          PRIMARY KEY (season_end_year, scope, metric)
        );

        CREATE TABLE league_team_metrics (
          season_end_year INTEGER NOT NULL REFERENCES league_seasons(season_end_year) ON DELETE CASCADE,
          team_name TEXT NOT NULL,
          {table_columns_sql(league_team_metric_columns())},
          PRIMARY KEY (season_end_year, team_name)
        );

        CREATE TABLE league_strength (
          season_end_year INTEGER PRIMARY KEY REFERENCES league_seasons(season_end_year) ON DELETE CASCADE,
          team_count INTEGER NOT NULL,
          qualified_player_count INTEGER NOT NULL,
          qualified_players_per_team REAL NOT NULL,
          effective_rotation_depth REAL NOT NULL,
          depth_z REAL NOT NULL,
          qualified_players_per_team_z REAL NOT NULL,
          team_count_z REAL NOT NULL,
          league_strength_z REAL NOT NULL,
          talent_points_per_100 REAL NOT NULL,
          model_version TEXT NOT NULL
        );

        CREATE TABLE games (
          game_id TEXT PRIMARY KEY,
          season_end_year INTEGER NOT NULL REFERENCES seasons(season_end_year),
          date_text TEXT NOT NULL,
          date_iso TEXT NOT NULL,
          game_type TEXT NOT NULL CHECK (game_type IN ('regular_season', 'postseason')),
          visitor_abbr TEXT NOT NULL,
          visitor_pts INTEGER,
          home_abbr TEXT NOT NULL,
          home_pts INTEGER,
          box_score_id TEXT NOT NULL UNIQUE,
          box_score_url TEXT,
          overtime TEXT
        );

        CREATE INDEX idx_team_seasons_season ON team_seasons(season_end_year, abbr);
        CREATE INDEX idx_player_team_seasons_team ON player_team_seasons(team_id);
        CREATE INDEX idx_player_team_seasons_player ON player_team_seasons(player_id);
        CREATE INDEX idx_player_shot_location_profiles_method ON player_shot_location_profiles(method);
        CREATE INDEX idx_games_season ON games(season_end_year);
        CREATE INDEX idx_games_type ON games(season_end_year, game_type);
        CREATE INDEX idx_games_teams ON games(season_end_year, visitor_abbr, home_abbr);

        PRAGMA user_version = 1;
        """
    )


def insert_source_page(conn, entity_type, entity_id, source, table_summary=None):
    cursor = conn.execute(
        """
        INSERT INTO source_pages (entity_type, entity_id, provider, url, fetched_at, page_title, h1, table_ids_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            entity_type,
            entity_id,
            source.get("provider"),
            source.get("url"),
            source.get("fetchedAt"),
            source.get("pageTitle"),
            source.get("h1"),
            json_text(source.get("tableIds") or []),
        ),
    )
    page_id = cursor.lastrowid
    for ordinal, table in enumerate(table_summary or []):
        conn.execute(
            """
            INSERT INTO source_page_tables (source_page_id, ordinal, table_id, caption, row_count, headers_json)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                page_id,
                ordinal,
                table.get("id"),
                table.get("caption"),
                table.get("rows"),
                json_text(table.get("headers") or []),
            ),
        )
    return page_id


def insert_season(conn, season_end_year, season=None):
    conn.execute(
        "INSERT OR IGNORE INTO seasons (season_end_year, season) VALUES (?, ?)",
        (season_end_year, season or season_label(season_end_year)),
    )


def insert_team(conn, team):
    insert_season(conn, team["seasonEndYear"], team["season"])
    franchise_id = slugify(team["franchise"])
    conn.execute("INSERT OR IGNORE INTO franchises (franchise_id, name) VALUES (?, ?)", (franchise_id, team["franchise"]))
    page_id = insert_source_page(conn, "team", team["id"], team["source"], team.get("rawTableSummary"))
    conn.execute(
        """
        INSERT INTO team_seasons (team_id, season_end_year, franchise_id, name, short_name, abbr, source_page_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (team["id"], team["seasonEndYear"], franchise_id, team["name"], team["shortName"], team["abbr"], page_id),
    )

    metrics = team["team"]
    conn.execute(
        """
        INSERT INTO team_metrics (
          team_id, wins, losses, pace, offensive_rating, defensive_rating, expected_wins, expected_losses,
          simple_rating, strength_of_schedule, margin_of_victory, efg_pct, turnover_pct,
          offensive_rebound_pct, free_throw_attempt_rate, free_throw_rate, opponent_efg_pct,
          opponent_turnover_pct, defensive_rebound_pct, opponent_free_throw_attempt_rate,
          opponent_free_throw_rate, three_attempt_rate
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            team["id"],
            metrics.get("wins"),
            metrics.get("losses"),
            metrics.get("pace"),
            metrics.get("offensiveRating"),
            metrics.get("defensiveRating"),
            metrics.get("expectedWins"),
            metrics.get("expectedLosses"),
            metrics.get("simpleRating"),
            metrics.get("strengthOfSchedule"),
            metrics.get("marginOfVictory"),
            metrics.get("efgPct"),
            metrics.get("turnoverPct"),
            metrics.get("offensiveReboundPct"),
            metrics.get("freeThrowAttemptRate"),
            metrics.get("freeThrowRate"),
            metrics.get("opponentEfgPct"),
            metrics.get("opponentTurnoverPct"),
            metrics.get("defensiveReboundPct"),
            metrics.get("opponentFreeThrowAttemptRate"),
            metrics.get("opponentFreeThrowRate"),
            metrics.get("threeAttemptRate"),
        ),
    )

    for side, totals_key in [("team", "totals"), ("opponent", "opponentTotals")]:
        totals = metrics.get(totals_key) or {}
        conn.execute(
            f"""
            INSERT INTO team_totals (team_id, side, {", ".join(TEAM_TOTAL_KEYS)})
            VALUES ({", ".join(["?"] * (len(TEAM_TOTAL_KEYS) + 2))})
            """,
            (team["id"], side, *[totals.get(key) for key in TEAM_TOTAL_KEYS]),
        )

    for index, player in enumerate(team["players"]):
        insert_player_team_season(conn, team["id"], index, player)


def player_id_for(conn, player):
    name = player["name"]
    source_id = player.get("sourceId") or None
    if source_id:
        row = conn.execute("SELECT player_id, name FROM players WHERE source_id = ?", (source_id,)).fetchone()
        if row is not None:
            return row[0]
        conn.execute("INSERT INTO players (player_id, source_id, name) VALUES (?, ?, ?)", (source_id, source_id, name))
        return source_id

    base = slugify(name)
    player_id = base
    suffix = 2
    while True:
        row = conn.execute("SELECT name FROM players WHERE player_id = ?", (player_id,)).fetchone()
        if row is None or row[0] == name:
            conn.execute("INSERT OR IGNORE INTO players (player_id, source_id, name) VALUES (?, ?, ?)", (player_id, None, name))
            return player_id
        player_id = f"{base}-{suffix}"
        suffix += 1


def insert_stat_row(conn, table, player_team_season_id, columns, values):
    conn.execute(
        f"""
        INSERT INTO {table} (player_team_season_id, {", ".join(columns)})
        VALUES ({", ".join(["?"] * (len(columns) + 1))})
        """,
        (player_team_season_id, *values),
    )


def insert_player_team_season(conn, team_id, player_index, player):
    player_id = player_id_for(conn, player)
    player_team_season_id = f"{team_id}:{player_index + 1:02d}:{player_id}"
    roster = player.get("roster") or {}
    conn.execute(
        """
        INSERT INTO player_team_seasons (
          player_team_season_id, player_id, team_id, source_id, source_url, name, position, age, games, games_started,
          minutes, jersey_number, height, weight, birth_date, college, postseason_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            player_team_season_id,
            player_id,
            team_id,
            player.get("sourceId"),
            player.get("sourceUrl"),
            player["name"],
            player.get("position"),
            player.get("age"),
            player.get("games"),
            player.get("gamesStarted"),
            player.get("minutes"),
            roster.get("number"),
            roster.get("height"),
            roster.get("weight"),
            roster.get("birthDate"),
            roster.get("college"),
            json_text(player.get("postseason")) if player.get("postseason") is not None else None,
        ),
    )

    per_game = player.get("perGame") or {}
    insert_stat_row(
        conn,
        "player_per_game",
        player_team_season_id,
        ["mp", "pts", "trb", "ast", "stl", "blk", "tov", "pf", "fga", "fg3a", "fta"],
        [per_game.get(key) for key in ["mp", "pts", "trb", "ast", "stl", "blk", "tov", "pf", "fga", "fg3a", "fta"]],
    )

    totals = player.get("totals") or {}
    insert_stat_row(
        conn,
        "player_totals",
        player_team_season_id,
        [
            "fg",
            "fga",
            "fg_pct",
            "fg3",
            "fg3a",
            "fg3_pct",
            "fg2",
            "fg2a",
            "fg2_pct",
            "ft",
            "fta",
            "ft_pct",
            "orb",
            "drb",
            "trb",
            "ast",
            "stl",
            "blk",
            "tov",
            "pf",
            "pts",
        ],
        [
            totals.get("fg"),
            totals.get("fga"),
            totals.get("fgPct"),
            totals.get("fg3"),
            totals.get("fg3a"),
            totals.get("fg3Pct"),
            totals.get("fg2"),
            totals.get("fg2a"),
            totals.get("fg2Pct"),
            totals.get("ft"),
            totals.get("fta"),
            totals.get("ftPct"),
            totals.get("orb"),
            totals.get("drb"),
            totals.get("trb"),
            totals.get("ast"),
            totals.get("stl"),
            totals.get("blk"),
            totals.get("tov"),
            totals.get("pf"),
            totals.get("pts"),
        ],
    )

    per100 = player.get("per100") or {}
    insert_stat_row(
        conn,
        "player_per_100",
        player_team_season_id,
        ["fga", "fg3a", "fta", "orb", "drb", "trb", "ast", "stl", "blk", "tov", "pf", "pts", "off_rtg", "def_rtg"],
        [
            per100.get("fga"),
            per100.get("fg3a"),
            per100.get("fta"),
            per100.get("orb"),
            per100.get("drb"),
            per100.get("trb"),
            per100.get("ast"),
            per100.get("stl"),
            per100.get("blk"),
            per100.get("tov"),
            per100.get("pf"),
            per100.get("pts"),
            per100.get("offRtg"),
            per100.get("defRtg"),
        ],
    )

    advanced = player.get("advanced") or {}
    insert_stat_row(
        conn,
        "player_advanced",
        player_team_season_id,
        [
            "usage_pct",
            "ts_pct",
            "three_attempt_rate",
            "free_throw_rate",
            "orb_pct",
            "drb_pct",
            "trb_pct",
            "ast_pct",
            "stl_pct",
            "blk_pct",
            "tov_pct",
            "ows",
            "dws",
            "ws",
            "obpm",
            "dbpm",
            "bpm",
        ],
        [
            advanced.get("usagePct"),
            advanced.get("tsPct"),
            advanced.get("threeAttemptRate"),
            advanced.get("freeThrowRate"),
            advanced.get("orbPct"),
            advanced.get("drbPct"),
            advanced.get("trbPct"),
            advanced.get("astPct"),
            advanced.get("stlPct"),
            advanced.get("blkPct"),
            advanced.get("tovPct"),
            advanced.get("ows"),
            advanced.get("dws"),
            advanced.get("ws"),
            advanced.get("obpm"),
            advanced.get("dbpm"),
            advanced.get("bpm"),
        ],
    )

    shooting = player.get("shooting") or {}
    insert_stat_row(
        conn,
        "player_shooting",
        player_team_season_id,
        [
            "avg_distance",
            "pct_fga_2p",
            "pct_fga_00_03",
            "pct_fga_03_10",
            "pct_fga_10_16",
            "pct_fga_16_xx",
            "pct_fga_3p",
            "fg_pct_2p",
            "fg_pct_00_03",
            "fg_pct_03_10",
            "fg_pct_10_16",
            "fg_pct_16_xx",
            "fg_pct_3p",
            "pct_ast_2p",
            "pct_ast_3p",
            "pct_fga_dunk",
            "fg_dunk",
            "pct_corner_3",
            "corner_3_pct",
        ],
        [
            shooting.get("avgDistance"),
            shooting.get("pctFga2p"),
            shooting.get("pctFga00_03"),
            shooting.get("pctFga03_10"),
            shooting.get("pctFga10_16"),
            shooting.get("pctFga16_xx"),
            shooting.get("pctFga3p"),
            shooting.get("fgPct2p"),
            shooting.get("fgPct00_03"),
            shooting.get("fgPct03_10"),
            shooting.get("fgPct10_16"),
            shooting.get("fgPct16_xx"),
            shooting.get("fgPct3p"),
            shooting.get("pctAst2p"),
            shooting.get("pctAst3p"),
            shooting.get("pctFgaDunk"),
            shooting.get("fgDunk"),
            shooting.get("pctCorner3"),
            shooting.get("corner3Pct"),
        ],
    )

    pbp = player.get("playByPlay") or {}
    insert_stat_row(
        conn,
        "player_play_by_play",
        player_team_season_id,
        [
            "plus_minus_on",
            "plus_minus_net",
            "bad_pass_turnovers",
            "lost_ball_turnovers",
            "shooting_fouls",
            "offensive_fouls",
            "drawn_shooting",
            "drawn_offensive",
            "assisted_points",
            "and_ones",
            "own_shots_blocked",
        ],
        [
            pbp.get("plusMinusOn"),
            pbp.get("plusMinusNet"),
            pbp.get("badPassTurnovers"),
            pbp.get("lostBallTurnovers"),
            pbp.get("shootingFouls"),
            pbp.get("offensiveFouls"),
            pbp.get("drawnShooting"),
            pbp.get("drawnOffensive"),
            pbp.get("assistedPoints"),
            pbp.get("andOnes"),
            pbp.get("ownShotsBlocked"),
        ],
    )


def insert_league(conn, league):
    insert_season(conn, league["seasonEndYear"], league["season"])
    page_id = insert_source_page(conn, "league", str(league["seasonEndYear"]), league["source"])
    conn.execute(
        """
        INSERT INTO league_seasons (season_end_year, season, qualified_player_count, source_page_id)
        VALUES (?, ?, ?, ?)
        """,
        (league["seasonEndYear"], league["season"], league.get("qualifiedPlayerCount") or 0, page_id),
    )

    averages = league.get("averages") or {}
    conn.execute(
        """
        INSERT INTO league_averages (
          season_end_year, pace, offensive_rating, defensive_rating, simple_rating, margin_of_victory,
          efg_pct, turnover_pct, offensive_rebound_pct, free_throw_rate, free_throw_attempt_rate,
          opponent_efg_pct, opponent_turnover_pct, defensive_rebound_pct,
          opponent_free_throw_attempt_rate, opponent_free_throw_rate, three_attempt_rate,
          fg2_pct, fg3_pct, ft_pct
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            league["seasonEndYear"],
            averages.get("pace"),
            averages.get("offensiveRating"),
            averages.get("defensiveRating"),
            averages.get("simpleRating"),
            averages.get("marginOfVictory"),
            averages.get("efgPct"),
            averages.get("turnoverPct"),
            averages.get("offensiveReboundPct"),
            averages.get("freeThrowRate"),
            averages.get("freeThrowAttemptRate"),
            averages.get("opponentEfgPct"),
            averages.get("opponentTurnoverPct"),
            averages.get("defensiveReboundPct"),
            averages.get("opponentFreeThrowAttemptRate"),
            averages.get("opponentFreeThrowRate"),
            averages.get("threeAttemptRate"),
            averages.get("fg2Pct"),
            averages.get("fg3Pct"),
            averages.get("ftPct"),
        ),
    )

    for scope, distributions in [("team", league.get("distributions") or {}), ("player", league.get("playerDistributions") or {})]:
        for metric, distribution in distributions.items():
            conn.execute(
                """
                INSERT INTO league_metric_distributions (season_end_year, scope, metric, mean, stdev, min, max)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    league["seasonEndYear"],
                    scope,
                    metric,
                    distribution["mean"],
                    distribution["stdev"],
                    distribution["min"],
                    distribution["max"],
                ),
            )

    for team in league.get("teams") or []:
        conn.execute(
            """
            INSERT INTO league_team_metrics (
              season_end_year, team_name, wins, losses, pace, offensive_rating, defensive_rating,
              net_rating, simple_rating, margin_of_victory, efg_pct, turnover_pct,
              offensive_rebound_pct, free_throw_rate, free_throw_attempt_rate, opponent_efg_pct,
              opponent_turnover_pct, defensive_rebound_pct, opponent_free_throw_attempt_rate,
              opponent_free_throw_rate, three_attempt_rate, fg2_pct, fg3_pct, ft_pct
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                league["seasonEndYear"],
                team["name"],
                team.get("wins"),
                team.get("losses"),
                team.get("pace"),
                team.get("offensiveRating"),
                team.get("defensiveRating"),
                team.get("netRating"),
                team.get("simpleRating"),
                team.get("marginOfVictory"),
                team.get("efgPct"),
                team.get("turnoverPct"),
                team.get("offensiveReboundPct"),
                team.get("freeThrowRate"),
                team.get("freeThrowAttemptRate"),
                team.get("opponentEfgPct"),
                team.get("opponentTurnoverPct"),
                team.get("defensiveReboundPct"),
                team.get("opponentFreeThrowAttemptRate"),
                team.get("opponentFreeThrowRate"),
                team.get("threeAttemptRate"),
                team.get("fg2Pct"),
                team.get("fg3Pct"),
                team.get("ftPct"),
            ),
        )


def mean(values):
    if not values:
        raise ValueError("mean requires at least one value")
    return sum(values) / len(values)


def stdev(values):
    if len(values) < 2:
        raise ValueError("stdev requires at least two values")
    avg = mean(values)
    variance = sum((value - avg) ** 2 for value in values) / len(values)
    out = math.sqrt(variance)
    if out <= 0:
        raise ValueError("stdev requires non-identical values")
    return out


def zscores_by_key(rows, key):
    logged = {row["season_end_year"]: math.log(row[key]) for row in rows}
    avg = mean(list(logged.values()))
    sd = stdev(list(logged.values()))
    return {season_end_year: (value - avg) / sd for season_end_year, value in logged.items()}


def derive_team_rotation_depth(conn, team_id):
    player_rows = conn.execute(
        """
        SELECT minutes
        FROM player_team_seasons
        WHERE team_id = ?
          AND minutes IS NOT NULL
          AND minutes > 0
        ORDER BY minutes DESC
        """,
        (team_id,),
    ).fetchall()
    minutes = [row["minutes"] for row in player_rows]
    if not minutes:
        raise ValueError(f"{team_id} has no positive player minutes")
    qualified = [value for value in minutes if value >= 300]
    rotation = qualified if len(qualified) >= 8 else minutes[: min(10, len(minutes))]
    rotation = rotation[:12]
    total = sum(rotation)
    if total <= 0:
        raise ValueError(f"{team_id} has invalid rotation minutes")
    return 1 / sum((value / total) ** 2 for value in rotation)


def derive_league_strength(conn):
    rows = []
    for season in conn.execute(
        """
        SELECT ls.season_end_year,
               ls.qualified_player_count,
               COUNT(ltm.team_name) AS league_team_count
        FROM league_seasons ls
        LEFT JOIN league_team_metrics ltm
          ON ltm.season_end_year = ls.season_end_year
        GROUP BY ls.season_end_year, ls.qualified_player_count
        ORDER BY ls.season_end_year
        """
    ):
        team_ids = [
            row["team_id"]
            for row in conn.execute(
                """
                SELECT team_id
                FROM team_seasons
                WHERE season_end_year = ?
                ORDER BY team_id
                """,
                (season["season_end_year"],),
            )
        ]
        team_count = season["league_team_count"] or len(team_ids)
        if team_count <= 0:
            raise ValueError(f"{season['season_end_year']} has no league teams")
        qualified_player_count = season["qualified_player_count"]
        if qualified_player_count <= 0:
            raise ValueError(f"{season['season_end_year']} has no qualified player count")
        depths = [derive_team_rotation_depth(conn, team_id) for team_id in team_ids]
        rows.append(
            {
                "season_end_year": season["season_end_year"],
                "team_count": team_count,
                "qualified_player_count": qualified_player_count,
                "qualified_players_per_team": qualified_player_count / team_count,
                "effective_rotation_depth": mean(depths),
            }
        )

    depth_z = zscores_by_key(rows, "effective_rotation_depth")
    qualified_z = zscores_by_key(rows, "qualified_players_per_team")
    team_count_z = zscores_by_key(rows, "team_count")
    for row in rows:
        season_end_year = row["season_end_year"]
        league_strength_z = 0.55 * depth_z[season_end_year] + 0.30 * qualified_z[season_end_year] - 0.15 * team_count_z[season_end_year]
        talent_points = clamp(1.10 * league_strength_z, -2.25, 2.25)
        conn.execute(
            """
            INSERT INTO league_strength (
              season_end_year, team_count, qualified_player_count, qualified_players_per_team,
              effective_rotation_depth, depth_z, qualified_players_per_team_z, team_count_z,
              league_strength_z, talent_points_per_100, model_version
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                season_end_year,
                row["team_count"],
                row["qualified_player_count"],
                row["qualified_players_per_team"],
                row["effective_rotation_depth"],
                depth_z[season_end_year],
                qualified_z[season_end_year],
                team_count_z[season_end_year],
                league_strength_z,
                talent_points,
                LEAGUE_STRENGTH_MODEL_VERSION,
            ),
        )


def height_inches(height):
    if not height:
        return None
    match = re.match(r"^(\d+)-(\d+)$", str(height))
    if not match:
        return None
    return int(match.group(1)) * 12 + int(match.group(2))


def position_rank(position):
    if not position:
        return None
    ranks = {"PG": 1, "SG": 2, "SF": 3, "PF": 4, "C": 5}
    parts = [part.strip().upper() for part in str(position).replace("-", "/").split("/") if part.strip()]
    values = [ranks[part] for part in parts if part in ranks]
    return mean(values) if values else None


def shot_source_quality_weight(row):
    return 0.72 if row["season_end_year"] <= 2000 else 1


def row_quality_warnings(row):
    return [EARLY_LOCATION_WARNING] if row["season_end_year"] <= 2000 else []


def has_sourced_location(row):
    shares = [row["pct_fga_00_03"], row["pct_fga_03_10"], row["pct_fga_10_16"], row["pct_fga_16_xx"], row["pct_fga_3p"]]
    if not all(finite(value) for value in shares):
        return False
    for share_column, pct_column in [
        ("pct_fga_00_03", "fg_pct_00_03"),
        ("pct_fga_03_10", "fg_pct_03_10"),
        ("pct_fga_10_16", "fg_pct_10_16"),
        ("pct_fga_16_xx", "fg_pct_16_xx"),
    ]:
        if row[share_column] > 0 and not finite(row[pct_column]):
            return False
    if row["pct_fga_3p"] > 0 and not finite(row["fg_pct_3p"]):
        return False
    return True


def two_point_share_sum(row):
    return sum(max(0, row[column] or 0) for column in ("pct_fga_00_03", "pct_fga_03_10", "pct_fga_10_16", "pct_fga_16_xx"))


def weighted_rate(items):
    valid = [(value, weight) for value, weight in items if finite(value) and weight > 0]
    total = sum(weight for _, weight in valid)
    if total <= 0:
        return None
    return sum(value * weight for value, weight in valid) / total


def target_three_share(row):
    fga = row["fga"] or 0
    return 0 if fga <= 0 else clamp((row["fg3a"] or 0) / fga, 0, 1)


def target_two_share(row):
    fga = row["fga"] or 0
    return 0 if fga <= 0 else clamp((row["fg2a"] or 0) / fga, 0, 1)


def target_two_pct(row):
    fg2a = row["fg2a"] or 0
    if fg2a <= 0:
        return None
    if not finite(row["fg2"]):
        raise ValueError(f"{row['player_team_season_id']} has 2PA but no 2P makes")
    return clamp(row["fg2"] / fg2a, 0.01, 0.99)


def target_three_pct(row):
    fg3a = row["fg3a"] or 0
    if fg3a <= 0:
        return None
    if not finite(row["fg3"]):
        raise ValueError(f"{row['player_team_season_id']} has 3PA but no 3P makes")
    return clamp(row["fg3"] / fg3a, 0.01, 0.99)


def source_ref(row):
    return row["source_url"] or f"Basketball Reference player_team_season:{row['player_team_season_id']}"


def insert_shot_location_profile(conn, player_team_season_id, profile):
    conn.execute(
        """
        INSERT INTO player_shot_location_profiles (
          player_team_season_id, method, model_version, confidence, source_refs_json,
          source_player_seasons_json, neighbor_count, source_fga, quality_warnings_json,
          pct_fga_00_03, pct_fga_03_10, pct_fga_10_16, pct_fga_16_xx, pct_fga_3p,
          fg_pct_00_03, fg_pct_03_10, fg_pct_10_16, fg_pct_16_xx, fg_pct_3p
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            player_team_season_id,
            profile["method"],
            profile["model_version"],
            profile["confidence"],
            json_text(profile["source_refs"]),
            json_text(profile["source_player_seasons"]),
            profile["neighbor_count"],
            profile["source_fga"],
            json_text(profile["quality_warnings"]),
            profile["pct_fga_00_03"],
            profile["pct_fga_03_10"],
            profile["pct_fga_10_16"],
            profile["pct_fga_16_xx"],
            profile["pct_fga_3p"],
            profile["fg_pct_00_03"],
            profile["fg_pct_03_10"],
            profile["fg_pct_10_16"],
            profile["fg_pct_16_xx"],
            profile["fg_pct_3p"],
        ),
    )


def sourced_shot_location_profile(row):
    return {
        "method": "sourced-location",
        "model_version": SHOT_LOCATION_MODEL_VERSION,
        "confidence": 0.88 if row["season_end_year"] <= 2000 else 1,
        "source_refs": [source_ref(row)],
        "source_player_seasons": [row["player_team_season_id"]],
        "neighbor_count": 0,
        "source_fga": row["fga"] or 0,
        "quality_warnings": row_quality_warnings(row),
        "pct_fga_00_03": row["pct_fga_00_03"],
        "pct_fga_03_10": row["pct_fga_03_10"],
        "pct_fga_10_16": row["pct_fga_10_16"],
        "pct_fga_16_xx": row["pct_fga_16_xx"],
        "pct_fga_3p": row["pct_fga_3p"],
        "fg_pct_00_03": row["fg_pct_00_03"],
        "fg_pct_03_10": row["fg_pct_03_10"],
        "fg_pct_10_16": row["fg_pct_10_16"],
        "fg_pct_16_xx": row["fg_pct_16_xx"],
        "fg_pct_3p": row["fg_pct_3p"],
    }


def proxy_shot_location_profile(target, weighted_neighbors, method, confidence):
    two_share = target_two_share(target)
    three_share = target_three_share(target)
    two_pct = target_two_pct(target)
    three_pct = target_three_pct(target)
    source_fga = sum(max(0, row["fga"] or 0) for row, _ in weighted_neighbors)

    zone_columns = ["pct_fga_00_03", "pct_fga_03_10", "pct_fga_10_16", "pct_fga_16_xx"]
    rate_columns = ["fg_pct_00_03", "fg_pct_03_10", "fg_pct_10_16", "fg_pct_16_xx"]
    conditional_shares = {}
    for zone in zone_columns:
        values = []
        for row, weight in weighted_neighbors:
            two_sum = two_point_share_sum(row)
            if two_sum > 0:
                values.append(((row[zone] or 0) / two_sum, weight))
        conditional_shares[zone] = weighted_rate(values)
    if any(value is None for value in conditional_shares.values()):
        raise ValueError(f"{target['player_team_season_id']} has no usable shot-location neighbor shares")
    share_total = sum(max(0, value) for value in conditional_shares.values())
    if share_total <= 0:
        raise ValueError(f"{target['player_team_season_id']} has non-positive proxy location shares")
    conditional_shares = {zone: max(0, value) / share_total for zone, value in conditional_shares.items()}

    raw_rates = {}
    for zone, rate in zip(zone_columns, rate_columns):
        values = []
        for row, weight in weighted_neighbors:
            two_sum = two_point_share_sum(row)
            if two_sum <= 0:
                continue
            conditional = (row[zone] or 0) / two_sum
            if conditional > 0 and finite(row[rate]):
                values.append((row[rate], weight * max(conditional, 0.05)))
        raw_rates[rate] = weighted_rate(values)
    if two_share > 0:
        for zone, rate in zip(zone_columns, rate_columns):
            if conditional_shares[zone] > 0.000001 and raw_rates[rate] is None:
                raise ValueError(f"{target['player_team_season_id']} has incomplete proxy zone make rates")
            if conditional_shares[zone] <= 0.000001:
                raw_rates[rate] = two_pct

    raw_two_pct = sum(conditional_shares[zone] * raw_rates[rate] for zone, rate in zip(zone_columns, rate_columns)) if two_share > 0 else None
    if two_share > 0 and (not finite(raw_two_pct) or raw_two_pct <= 0):
        raise ValueError(f"{target['player_team_season_id']} has invalid proxy weighted 2P%")
    make_scale = (two_pct / raw_two_pct) if two_share > 0 else 1
    quality_warnings = sorted({warning for row, _ in weighted_neighbors for warning in row_quality_warnings(row)})
    source_refs = []
    source_player_seasons = []
    for row, _ in weighted_neighbors:
        ref = source_ref(row)
        if ref not in source_refs:
            source_refs.append(ref)
        season_ref = row["player_team_season_id"]
        if season_ref not in source_player_seasons:
            source_player_seasons.append(season_ref)

    return {
        "method": method,
        "model_version": SHOT_LOCATION_MODEL_VERSION,
        "confidence": confidence,
        "source_refs": source_refs[:12],
        "source_player_seasons": source_player_seasons[:16],
        "neighbor_count": len(weighted_neighbors),
        "source_fga": source_fga,
        "quality_warnings": quality_warnings,
        "pct_fga_00_03": conditional_shares["pct_fga_00_03"] * two_share,
        "pct_fga_03_10": conditional_shares["pct_fga_03_10"] * two_share,
        "pct_fga_10_16": conditional_shares["pct_fga_10_16"] * two_share,
        "pct_fga_16_xx": conditional_shares["pct_fga_16_xx"] * two_share,
        "pct_fga_3p": three_share,
        "fg_pct_00_03": None if two_share <= 0 or conditional_shares["pct_fga_00_03"] <= 0.000001 else clamp(raw_rates["fg_pct_00_03"] * make_scale, 0.01, 0.99),
        "fg_pct_03_10": None if two_share <= 0 or conditional_shares["pct_fga_03_10"] <= 0.000001 else clamp(raw_rates["fg_pct_03_10"] * make_scale, 0.01, 0.99),
        "fg_pct_10_16": None if two_share <= 0 or conditional_shares["pct_fga_10_16"] <= 0.000001 else clamp(raw_rates["fg_pct_10_16"] * make_scale, 0.01, 0.99),
        "fg_pct_16_xx": None if two_share <= 0 or conditional_shares["pct_fga_16_xx"] <= 0.000001 else clamp(raw_rates["fg_pct_16_xx"] * make_scale, 0.01, 0.99),
        "fg_pct_3p": three_pct,
    }


def shot_profile_feature(row):
    fga = row["fga"] or 0
    fg2a = row["fg2a"] or 0
    games = row["games"] or 0
    feature = {
        "position": position_rank(row["position"]),
        "height": height_inches(row["height"]),
        "weight": row["weight"],
        "age": row["age"],
        "usage": row["usage_pct"],
        "three_rate": 0 if fga <= 0 else (row["fg3a"] or 0) / fga,
        "free_throw_rate": row["free_throw_rate"],
        "orb_pct": row["orb_pct"],
        "ast_pct": row["ast_pct"],
        "fg2_pct": None if fg2a <= 0 or not finite(row["fg2"]) else row["fg2"] / fg2a,
        "minutes_per_game": None if games <= 0 else (row["minutes"] or 0) / games,
    }
    if not all(finite(value) for value in feature.values()):
        return None
    return feature


def derive_player_shot_location_profiles(conn):
    rows = [
        row
        for row in conn.execute(
            """
            SELECT pts.player_team_season_id,
                   pts.player_id,
                   pts.source_id,
                   pts.source_url,
                   pts.name,
                   pts.position,
                   pts.age,
                   pts.games,
                   pts.minutes,
                   pts.height,
                   pts.weight,
                   ts.team_id,
                   ts.season_end_year,
                   pt.fga,
                   pt.fg,
                   pt.fg2,
                   pt.fg2a,
                   pt.fg3,
                   pt.fg3a,
                   pa.usage_pct,
                   pa.free_throw_rate,
                   pa.orb_pct,
                   pa.ast_pct,
                   ps.pct_fga_00_03,
                   ps.pct_fga_03_10,
                   ps.pct_fga_10_16,
                   ps.pct_fga_16_xx,
                   ps.pct_fga_3p,
                   ps.fg_pct_00_03,
                   ps.fg_pct_03_10,
                   ps.fg_pct_10_16,
                   ps.fg_pct_16_xx,
                   ps.fg_pct_3p
            FROM player_team_seasons pts
            JOIN team_seasons ts
              ON ts.team_id = pts.team_id
            JOIN player_totals pt
              ON pt.player_team_season_id = pts.player_team_season_id
            JOIN player_advanced pa
              ON pa.player_team_season_id = pts.player_team_season_id
            JOIN player_shooting ps
              ON ps.player_team_season_id = pts.player_team_season_id
            ORDER BY ts.season_end_year, pts.player_team_season_id
            """
        )
    ]
    sourced_rows = [row for row in rows if has_sourced_location(row)]
    rows_by_team = {}
    for row in rows:
        rows_by_team.setdefault(row["team_id"], []).append(row)
    required_profile_ids = set()
    for team_rows in rows_by_team.values():
        ordered = sorted(team_rows, key=lambda row: row["minutes"] or 0, reverse=True)
        qualified = [row for row in ordered if (row["minutes"] or 0) >= 300]
        rotation = qualified if len(qualified) >= 8 else ordered[: min(10, len(ordered))]
        for row in rotation[:12]:
            if (row["fga"] or 0) > 0:
                required_profile_ids.add(row["player_team_season_id"])
    sourced_by_player = {}
    for row in sourced_rows:
        sourced_by_player.setdefault(row["player_id"], []).append(row)

    feature_rows = []
    for row in sourced_rows:
        feature = shot_profile_feature(row)
        if feature is not None:
            feature_rows.append((row, feature))
    feature_keys = list(feature_rows[0][1].keys()) if feature_rows else []
    feature_means = {key: mean([feature[key] for _, feature in feature_rows]) for key in feature_keys}
    feature_stdevs = {key: stdev([feature[key] for _, feature in feature_rows]) for key in feature_keys}
    feature_weights = {
        "position": 1.4,
        "height": 0.8,
        "weight": 0.4,
        "age": 0.35,
        "usage": 0.75,
        "three_rate": 1.8,
        "free_throw_rate": 0.85,
        "orb_pct": 0.8,
        "ast_pct": 0.9,
        "fg2_pct": 0.8,
        "minutes_per_game": 0.45,
    }

    failures = []
    for row in rows:
        fga = row["fga"] or 0
        if fga <= 0 or (fga < SHOT_LOCATION_MIN_FGA and row["player_team_season_id"] not in required_profile_ids):
            continue
        try:
            if has_sourced_location(row):
                insert_shot_location_profile(conn, row["player_team_season_id"], sourced_shot_location_profile(row))
                continue

            same_player = [
                source_row
                for source_row in sourced_by_player.get(row["player_id"], [])
                if source_row["player_team_season_id"] != row["player_team_season_id"]
                and (source_row["fga"] or 0) >= 75
            ]
            if sum(source_row["fga"] or 0 for source_row in same_player) >= 200:
                weighted_neighbors = []
                for source_row in sorted(same_player, key=lambda item: (abs(item["season_end_year"] - row["season_end_year"]), -item["fga"])):
                    season_gap = abs(source_row["season_end_year"] - row["season_end_year"])
                    weight = math.sqrt(max(1, source_row["fga"] or 1)) * shot_source_quality_weight(source_row) / ((season_gap + 1) ** 1.35)
                    weighted_neighbors.append((source_row, weight))
                weighted_neighbors = weighted_neighbors[:8]
                avg_gap = mean([abs(source_row["season_end_year"] - row["season_end_year"]) for source_row, _ in weighted_neighbors])
                confidence = clamp(0.55 + min(0.25, sum(source_row["fga"] or 0 for source_row, _ in weighted_neighbors) / 2600) + max(0, 0.14 - avg_gap * 0.015), 0.52, 0.92)
                try:
                    insert_shot_location_profile(
                        conn,
                        row["player_team_season_id"],
                        proxy_shot_location_profile(row, weighted_neighbors, "same-player-neighbor-proxy", confidence),
                    )
                    continue
                except ValueError:
                    pass

            target_feature = shot_profile_feature(row)
            if target_feature is None:
                raise ValueError("missing role-neighbor input features")
            distances = []
            for source_row, source_feature in feature_rows:
                squared = 0
                for key in feature_keys:
                    z_delta = (target_feature[key] - source_feature[key]) / feature_stdevs[key]
                    squared += feature_weights[key] * z_delta * z_delta
                distance = math.sqrt(squared)
                weight = math.sqrt(max(1, source_row["fga"] or 1)) * shot_source_quality_weight(source_row) / ((distance + 0.35) ** 2)
                distances.append((distance, source_row, weight))
            weighted_neighbors = [(source_row, weight) for _, source_row, weight in sorted(distances, key=lambda item: item[0])[:40]]
            insert_shot_location_profile(
                conn,
                row["player_team_season_id"],
                proxy_shot_location_profile(row, weighted_neighbors, "era-role-neighbor-proxy", 0.48),
            )
        except Exception as exc:
            failures.append(f"{row['player_team_season_id']} {row['name']}: {exc}")

    if failures:
        raise ValueError("shot-location profile derivation failed: " + "; ".join(failures[:12]))


def schedule_end_year(path):
    match = re.search(r"schedule-(\d{4})\.json$", path.name)
    return int(match.group(1)) if match else None


def insert_schedules(conn, raw_dir):
    for schedule_path in sorted(raw_dir.glob(SCHEDULE_GLOB)):
        with schedule_path.open("r", encoding="utf-8") as handle:
            schedule = json.load(handle)
        season_end_year = schedule.get("seasonEndYear") or schedule_end_year(schedule_path)
        if not season_end_year:
            continue
        insert_season(conn, season_end_year, schedule.get("season") or season_label(season_end_year))
        for page in schedule.get("pages") or []:
            insert_source_page(
                conn,
                "schedule_month",
                f"{season_end_year}:{page.get('url', schedule_path.name)}",
                {
                    "provider": schedule.get("sourceProvider"),
                    "url": page.get("url"),
                    "fetchedAt": page.get("fetchedAt"),
                    "pageTitle": page.get("title"),
                    "h1": "",
                },
            )
        for game in schedule.get("games") or []:
            date_iso = game_date_iso(game["date"])
            conn.execute(
                """
                INSERT OR REPLACE INTO games (
                  game_id, season_end_year, date_text, date_iso, game_type, visitor_abbr, visitor_pts, home_abbr,
                  home_pts, box_score_id, box_score_url, overtime
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    game.get("boxScoreId"),
                    season_end_year,
                    game.get("date"),
                    date_iso,
                    game_type(season_end_year, date_iso),
                    game.get("visitorAbbr"),
                    game.get("visitorPts"),
                    game.get("homeAbbr"),
                    game.get("homePts"),
                    game.get("boxScoreId"),
                    game.get("boxScoreUrl"),
                    game.get("overtime"),
                ),
            )


def row_counts(conn):
    tables = [
        "seasons",
        "franchises",
        "team_seasons",
        "players",
        "player_team_seasons",
        "player_shot_location_profiles",
        "league_seasons",
        "league_strength",
        "league_metric_distributions",
        "league_team_metrics",
        "games",
        "source_pages",
        "source_page_tables",
    ]
    return {table: conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] for table in tables}


def build_database(source_path, output_path):
    with source_path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = output_path.with_suffix(output_path.suffix + ".tmp")
    if temp_path.exists():
        temp_path.unlink()

    conn = sqlite3.connect(temp_path)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        create_schema(conn)
        conn.execute("INSERT INTO metadata (key, value) VALUES (?, ?)", ("generated_at", data["generatedAt"]))
        conn.execute("INSERT INTO metadata (key, value) VALUES (?, ?)", ("manifest_version", data["manifestVersion"]))
        conn.execute("INSERT INTO metadata (key, value) VALUES (?, ?)", ("source_provider", data["sourceProvider"]))
        conn.execute("INSERT INTO metadata (key, value) VALUES (?, ?)", ("source_json", str(source_path.relative_to(ROOT))))

        for team in data.get("teams") or []:
            insert_team(conn, team)
        for league in data.get("leagues") or []:
            insert_league(conn, league)
        derive_league_strength(conn)
        derive_player_shot_location_profiles(conn)
        insert_schedules(conn, ROOT / "src" / "data" / "bbr" / "raw")

        conn.commit()
        conn.execute("PRAGMA optimize")
        counts = row_counts(conn)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    if output_path.exists():
        output_path.unlink()
    temp_path.replace(output_path)
    return counts


def main():
    parser = argparse.ArgumentParser(description="Build normalized Basketball Dice Studio SQLite data from generated JSON.")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help=f"Generated source JSON path. Default: {DEFAULT_SOURCE}")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help=f"SQLite output path. Default: {DEFAULT_OUTPUT}")
    args = parser.parse_args()

    source_path = args.source.resolve()
    output_path = args.output.resolve()
    counts = build_database(source_path, output_path)
    size_mb = output_path.stat().st_size / 1024 / 1024
    print(f"Wrote {output_path.relative_to(ROOT)} ({size_mb:.2f} MB)")
    for table, count in counts.items():
        print(f"{table}: {count}")


if __name__ == "__main__":
    main()
