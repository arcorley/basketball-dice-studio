#!/usr/bin/env python3
import argparse
import json
import sqlite3
import sys
from collections import Counter
from pathlib import Path
from urllib.parse import quote


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATABASE = ROOT / "data" / "basketball-dice.sqlite"
DEFAULT_MANIFEST = ROOT / "data" / "source-manifest.json"
DEFAULT_CATALOG = ROOT / "public" / "data" / "catalog.generated.json"
DEFAULT_TEAM_DIR = ROOT / "public" / "data" / "teams"
DEFAULT_START_YEAR = 1990
DEFAULT_END_YEAR = 2025
SOURCE_ID_FAIL_THRESHOLD = 0.80
SOURCE_ID_WARN_THRESHOLD = 0.95

REQUIRED_TABLES = (
    "seasons",
    "team_seasons",
    "source_pages",
    "players",
    "player_team_seasons",
    "player_per_game",
    "player_totals",
    "player_per_100",
    "player_advanced",
    "player_shooting",
    "player_shot_location_profiles",
    "league_seasons",
    "league_strength",
    "league_metric_distributions",
    "league_team_metrics",
    "games",
)

SUMMARY_TABLES = (
    "seasons",
    "team_seasons",
    "players",
    "player_team_seasons",
    "player_shot_location_profiles",
    "league_strength",
    "source_pages",
    "games",
)

PLAYER_STAT_TABLES = (
    ("player_per_game", "per-game"),
    ("player_totals", "totals"),
    ("player_per_100", "per-100"),
    ("player_advanced", "advanced"),
    ("player_shooting", "shooting"),
)


def parse_args():
    parser = argparse.ArgumentParser(
        description="Validate the Basketball Dice SQLite data migration."
    )
    parser.add_argument(
        "--database",
        type=Path,
        default=DEFAULT_DATABASE,
        help=f"SQLite database to validate. Defaults to {DEFAULT_DATABASE}.",
    )
    parser.add_argument(
        "--expected-start-year",
        type=int,
        default=DEFAULT_START_YEAR,
        help=f"Inclusive first season end year expected in the database. Defaults to {DEFAULT_START_YEAR}.",
    )
    parser.add_argument(
        "--expected-end-year",
        type=int,
        default=DEFAULT_END_YEAR,
        help=f"Inclusive last season end year expected in the database. Defaults to {DEFAULT_END_YEAR}.",
    )
    return parser.parse_args()


def resolve_path(path):
    path = path.expanduser()
    if not path.is_absolute():
        path = Path.cwd() / path
    return path.resolve()


def connect_readonly(path):
    if not path.exists():
        raise RuntimeError(f"database does not exist: {path}")
    if not path.is_file():
        raise RuntimeError(f"database path is not a file: {path}")

    uri = "file:{}?mode=ro".format(quote(str(path), safe="/"))
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def scalar(conn, sql, params=()):
    row = conn.execute(sql, params).fetchone()
    return row[0] if row is not None else None


def format_ranges(values):
    years = sorted(set(values))
    if not years:
        return "none"

    ranges = []
    start = years[0]
    previous = years[0]
    for year in years[1:]:
        if year == previous + 1:
            previous = year
            continue
        ranges.append((start, previous))
        start = year
        previous = year
    ranges.append((start, previous))

    parts = []
    for start, end in ranges:
        parts.append(str(start) if start == end else f"{start}-{end}")
    return ", ".join(parts)


def preview(values, limit=8):
    values = [str(value) for value in values]
    if len(values) <= limit:
        return ", ".join(values)
    return "{}, ... (+{} more)".format(", ".join(values[:limit]), len(values) - limit)


def sample_ids(conn, sql, params=(), limit=5):
    rows = conn.execute(sql, params).fetchmany(limit)
    return [row[0] for row in rows]


def format_source_page(row):
    return "{}:{}:{}".format(row["source_page_id"], row["entity_type"], row["entity_id"])


def add_integrity_failures(conn, failures):
    quick_check_rows = [row[0] for row in conn.execute("PRAGMA quick_check").fetchall()]
    if quick_check_rows != ["ok"]:
        failures.append("PRAGMA quick_check returned: {}".format(preview(quick_check_rows)))

    fk_rows = conn.execute("PRAGMA foreign_key_check").fetchall()
    if fk_rows:
        examples = []
        for row in fk_rows[:5]:
            examples.append(
                "{} rowid={} parent={} fkid={}".format(row[0], row[1], row[2], row[3])
            )
        failures.append(
            "PRAGMA foreign_key_check returned {} row(s): {}".format(
                len(fk_rows), preview(examples, limit=5)
            )
        )


def ensure_required_tables(conn, failures):
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table'"
    ).fetchall()
    existing = {row["name"] for row in rows}
    missing = [table for table in REQUIRED_TABLES if table not in existing]
    if missing:
        failures.append("database is missing required table(s): {}".format(preview(missing)))
        return False
    return True


def load_manifest(path, failures, warnings):
    if not path.exists():
        warnings.append(f"{path} not found; skipped manifest team-season count check")
        return None

    try:
        with path.open("r", encoding="utf-8") as handle:
            manifest = json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        failures.append(f"could not read source manifest {path}: {exc}")
        return None

    teams = manifest.get("teams") if isinstance(manifest, dict) else None
    if not isinstance(teams, list):
        failures.append(f"source manifest {path} does not contain a teams array")
        return None
    return manifest


def expected_team_counts(manifest, start_year, end_year, failures):
    counts = Counter()
    bad_entries = []
    for index, team in enumerate(manifest.get("teams", [])):
        year = team.get("seasonEndYear") if isinstance(team, dict) else None
        if isinstance(year, bool) or not isinstance(year, int):
            bad_entries.append(index)
            continue
        if start_year <= year <= end_year:
            counts[year] += 1

    if bad_entries:
        failures.append(
            "source manifest has team entries without integer seasonEndYear at index(es): {}".format(
                preview(bad_entries, limit=5)
            )
        )
    if not counts:
        failures.append(
            "source manifest has no team entries in expected range {}-{}".format(
                start_year, end_year
            )
        )
    return counts


def add_season_failures(conn, manifest, start_year, end_year, failures):
    expected_years = set(range(start_year, end_year + 1))
    season_years = {
        row["season_end_year"]
        for row in conn.execute(
            """
            SELECT season_end_year
            FROM seasons
            WHERE season_end_year BETWEEN ? AND ?
            """,
            (start_year, end_year),
        )
    }

    missing_years = expected_years - season_years
    if missing_years:
        failures.append(
            "seasons missing expected end year(s): {}".format(format_ranges(missing_years))
        )

    if manifest is None:
        return

    expected_counts = expected_team_counts(manifest, start_year, end_year, failures)
    actual_counts = {
        row["season_end_year"]: row["count"]
        for row in conn.execute(
            """
            SELECT season_end_year, COUNT(*) AS count
            FROM team_seasons
            WHERE season_end_year BETWEEN ? AND ?
            GROUP BY season_end_year
            """,
            (start_year, end_year),
        )
    }

    shortfalls = []
    for year in sorted(expected_counts):
        expected = expected_counts[year]
        actual = actual_counts.get(year, 0)
        if actual < expected:
            shortfalls.append(f"{year}: found {actual}, expected at least {expected}")
    if shortfalls:
        failures.append(
            "team_seasons below manifest expected count for {} season(s): {}".format(
                len(shortfalls), preview(shortfalls, limit=8)
            )
        )


def add_source_page_failures(conn, failures):
    missing_team_source_count = scalar(
        conn,
        """
        SELECT COUNT(*)
        FROM team_seasons
        WHERE source_page_id IS NULL
        """,
    )
    if missing_team_source_count:
        examples = sample_ids(
            conn,
            """
            SELECT team_id
            FROM team_seasons
            WHERE source_page_id IS NULL
            ORDER BY team_id
            """,
        )
        failures.append(
            "team_seasons without source_page_id: {} (examples: {})".format(
                missing_team_source_count, preview(examples, limit=5)
            )
        )

    missing_fields_rows = conn.execute(
        """
        SELECT source_page_id, entity_type, entity_id
        FROM source_pages
        WHERE entity_type IN ('team', 'league')
          AND (
            provider IS NULL OR trim(provider) = ''
            OR url IS NULL OR trim(url) = ''
            OR fetched_at IS NULL OR trim(fetched_at) = ''
          )
        ORDER BY source_page_id
        """
    ).fetchall()
    if missing_fields_rows:
        failures.append(
            "team/league source_pages missing provider/url/fetched_at: {} (examples: {})".format(
                len(missing_fields_rows),
                preview([format_source_page(row) for row in missing_fields_rows[:5]], limit=5),
            )
        )

    invalid_table_ids = []
    empty_table_ids = []
    for row in conn.execute(
        """
        SELECT source_page_id, entity_type, entity_id, table_ids_json
        FROM source_pages
        WHERE entity_type IN ('team', 'league')
        ORDER BY source_page_id
        """
    ):
        raw = row["table_ids_json"]
        try:
            table_ids = json.loads(raw)
        except (TypeError, json.JSONDecodeError):
            invalid_table_ids.append(format_source_page(row))
            continue
        if not isinstance(table_ids, list):
            invalid_table_ids.append(format_source_page(row))
            continue
        if not table_ids:
            empty_table_ids.append(format_source_page(row))

    if invalid_table_ids:
        failures.append(
            "team/league source_pages with invalid table_ids_json: {} (examples: {})".format(
                len(invalid_table_ids), preview(invalid_table_ids, limit=5)
            )
        )
    if empty_table_ids:
        failures.append(
            "team/league source_pages with empty table_ids_json: {} (examples: {})".format(
                len(empty_table_ids), preview(empty_table_ids, limit=5)
            )
        )


def add_player_failures(conn, failures, warnings):
    team_season_count = scalar(conn, "SELECT COUNT(*) FROM team_seasons")
    player_team_season_count = scalar(conn, "SELECT COUNT(*) FROM player_team_seasons")
    minimum_player_team_seasons = team_season_count * 8
    if player_team_season_count <= minimum_player_team_seasons:
        failures.append(
            "player_team_seasons count is {}; expected > team_seasons * 8 ({} * 8 = {})".format(
                player_team_season_count, team_season_count, minimum_player_team_seasons
            )
        )

    blank_name_count = scalar(
        conn,
        """
        SELECT COUNT(*)
        FROM player_team_seasons
        WHERE name IS NULL OR trim(name) = ''
        """,
    )
    if blank_name_count:
        examples = sample_ids(
            conn,
            """
            SELECT player_team_season_id
            FROM player_team_seasons
            WHERE name IS NULL OR trim(name) = ''
            ORDER BY player_team_season_id
            """,
        )
        failures.append(
            "player_team_seasons with blank name: {} (examples: {})".format(
                blank_name_count, preview(examples, limit=5)
            )
        )

    for table_name, label in PLAYER_STAT_TABLES:
        missing_count = scalar(
            conn,
            f"""
            SELECT COUNT(*)
            FROM player_team_seasons pts
            LEFT JOIN {table_name} stat
              ON stat.player_team_season_id = pts.player_team_season_id
            WHERE stat.player_team_season_id IS NULL
            """,
        )
        if missing_count:
            examples = sample_ids(
                conn,
                f"""
                SELECT pts.player_team_season_id
                FROM player_team_seasons pts
                LEFT JOIN {table_name} stat
                  ON stat.player_team_season_id = pts.player_team_season_id
                WHERE stat.player_team_season_id IS NULL
                ORDER BY pts.player_team_season_id
                """,
            )
            failures.append(
                "{} stat rows missing for {} player_team_seasons (examples: {})".format(
                    label, missing_count, preview(examples, limit=5)
                )
            )

    with_source_id = scalar(
        conn,
        """
        SELECT COUNT(*)
        FROM player_team_seasons
        WHERE source_id IS NOT NULL AND trim(source_id) <> ''
        """,
    )
    coverage = with_source_id / player_team_season_count if player_team_season_count else 0.0
    coverage_message = "player_team_seasons source_id coverage is {:.1%} ({}/{})".format(
        coverage, with_source_id, player_team_season_count
    )
    if coverage < SOURCE_ID_FAIL_THRESHOLD:
        failures.append(
            "{}; expected at least {:.0%}".format(coverage_message, SOURCE_ID_FAIL_THRESHOLD)
        )
    elif coverage < SOURCE_ID_WARN_THRESHOLD:
        warnings.append(
            "{}; below preferred {:.0%}".format(coverage_message, SOURCE_ID_WARN_THRESHOLD)
        )

    return {
        "with_source_id": with_source_id,
        "total": player_team_season_count,
        "coverage": coverage,
    }


def add_player_shooting_failures(conn, failures, warnings):
    detailed_start_year = 1997
    minimum_fga = 50
    missing_detailed_count = scalar(
        conn,
        """
        SELECT COUNT(*)
        FROM player_team_seasons pts
        JOIN team_seasons ts
          ON ts.team_id = pts.team_id
        JOIN player_totals pt
          ON pt.player_team_season_id = pts.player_team_season_id
        JOIN player_shooting ps
          ON ps.player_team_season_id = pts.player_team_season_id
        WHERE ts.season_end_year >= ?
          AND pt.fga >= ?
          AND (
            ps.pct_fga_00_03 IS NULL
            OR ps.pct_fga_03_10 IS NULL
            OR ps.pct_fga_10_16 IS NULL
            OR ps.pct_fga_16_xx IS NULL
            OR ps.pct_fga_3p IS NULL
            OR (ps.pct_fga_00_03 > 0 AND ps.fg_pct_00_03 IS NULL)
            OR (ps.pct_fga_03_10 > 0 AND ps.fg_pct_03_10 IS NULL)
            OR (ps.pct_fga_10_16 > 0 AND ps.fg_pct_10_16 IS NULL)
            OR (ps.pct_fga_16_xx > 0 AND ps.fg_pct_16_xx IS NULL)
          )
        """,
        (detailed_start_year, minimum_fga),
    )
    if missing_detailed_count:
        examples = [
            "{} {} ({}, FGA {})".format(row["team_id"], row["name"], row["season_end_year"], row["fga"])
            for row in conn.execute(
                """
                SELECT ts.team_id, ts.season_end_year, pts.name, pt.fga
                FROM player_team_seasons pts
                JOIN team_seasons ts
                  ON ts.team_id = pts.team_id
                JOIN player_totals pt
                  ON pt.player_team_season_id = pts.player_team_season_id
                JOIN player_shooting ps
                  ON ps.player_team_season_id = pts.player_team_season_id
                WHERE ts.season_end_year >= ?
                  AND pt.fga >= ?
                  AND (
                    ps.pct_fga_00_03 IS NULL
                    OR ps.pct_fga_03_10 IS NULL
                    OR ps.pct_fga_10_16 IS NULL
                    OR ps.pct_fga_16_xx IS NULL
                    OR ps.pct_fga_3p IS NULL
                    OR (ps.pct_fga_00_03 > 0 AND ps.fg_pct_00_03 IS NULL)
                    OR (ps.pct_fga_03_10 > 0 AND ps.fg_pct_03_10 IS NULL)
                    OR (ps.pct_fga_10_16 > 0 AND ps.fg_pct_10_16 IS NULL)
                    OR (ps.pct_fga_16_xx > 0 AND ps.fg_pct_16_xx IS NULL)
                  )
                ORDER BY pt.fga DESC
                LIMIT 5
                """,
                (detailed_start_year, minimum_fga),
            )
        ]
        failures.append(
            "modern player_shooting detailed location fields missing for {} player-season(s) with FGA >= {} (examples: {})".format(
                missing_detailed_count, minimum_fga, preview(examples, limit=5)
            )
        )

    incoherent_share_count = scalar(
        conn,
        """
        SELECT COUNT(*)
        FROM player_team_seasons pts
        JOIN team_seasons ts
          ON ts.team_id = pts.team_id
        JOIN player_totals pt
          ON pt.player_team_season_id = pts.player_team_season_id
        JOIN player_shooting ps
          ON ps.player_team_season_id = pts.player_team_season_id
        WHERE ts.season_end_year >= ?
          AND pt.fga >= ?
          AND ps.pct_fga_00_03 IS NOT NULL
          AND ps.pct_fga_03_10 IS NOT NULL
          AND ps.pct_fga_10_16 IS NOT NULL
          AND ps.pct_fga_16_xx IS NOT NULL
          AND ps.pct_fga_3p IS NOT NULL
          AND ABS(
            ps.pct_fga_00_03
            + ps.pct_fga_03_10
            + ps.pct_fga_10_16
            + ps.pct_fga_16_xx
            + ps.pct_fga_3p
            - 1
          ) > 0.035
        """,
        (detailed_start_year, minimum_fga),
    )
    incoherent_share_rows = [
        "{} {} ({}, shares {:.3f})".format(row["team_id"], row["name"], row["season_end_year"], row["share_sum"])
        for row in conn.execute(
            """
            SELECT ts.team_id,
                   ts.season_end_year,
                   pts.name,
                   pt.fga,
                   (
                     ps.pct_fga_00_03
                     + ps.pct_fga_03_10
                     + ps.pct_fga_10_16
                     + ps.pct_fga_16_xx
                     + ps.pct_fga_3p
                   ) AS share_sum
            FROM player_team_seasons pts
            JOIN team_seasons ts
              ON ts.team_id = pts.team_id
            JOIN player_totals pt
              ON pt.player_team_season_id = pts.player_team_season_id
            JOIN player_shooting ps
              ON ps.player_team_season_id = pts.player_team_season_id
            WHERE ts.season_end_year >= ?
              AND pt.fga >= ?
              AND ps.pct_fga_00_03 IS NOT NULL
              AND ps.pct_fga_03_10 IS NOT NULL
              AND ps.pct_fga_10_16 IS NOT NULL
              AND ps.pct_fga_16_xx IS NOT NULL
              AND ps.pct_fga_3p IS NOT NULL
              AND ABS(
                ps.pct_fga_00_03
                + ps.pct_fga_03_10
                + ps.pct_fga_10_16
                + ps.pct_fga_16_xx
                + ps.pct_fga_3p
                - 1
              ) > 0.035
            ORDER BY ABS(share_sum - 1) DESC
            LIMIT 5
            """,
            (detailed_start_year, minimum_fga),
        )
    ]
    if incoherent_share_count:
        warnings.append(
            "modern player_shooting location shares require normalization for {} player-season(s) with FGA >= {}; engine preserves sourced 2P/3P split and normalizes known 2P distance buckets (examples: {})".format(
                incoherent_share_count, minimum_fga, preview(incoherent_share_rows, limit=5)
            )
        )

    early_detailed_count = scalar(
        conn,
        """
        SELECT COUNT(*)
        FROM player_team_seasons pts
        JOIN team_seasons ts
          ON ts.team_id = pts.team_id
        JOIN player_shooting ps
          ON ps.player_team_season_id = pts.player_team_season_id
        WHERE ts.season_end_year < ?
          AND (
            ps.pct_fga_00_03 IS NOT NULL
            OR ps.pct_fga_03_10 IS NOT NULL
            OR ps.pct_fga_10_16 IS NOT NULL
            OR ps.pct_fga_16_xx IS NOT NULL
          )
        """,
        (detailed_start_year,),
    )
    if early_detailed_count:
        warnings.append(
            "pre-1996-97 player_shooting includes detailed location data for {} player-season(s); engine will use sourced location profiles where available".format(
                early_detailed_count
            )
        )


def add_shot_location_profile_failures(conn, failures):
    minimum_fga = 50
    detailed_start_year = 1997
    missing_count = scalar(
        conn,
        """
        SELECT COUNT(*)
        FROM player_team_seasons pts
        JOIN team_seasons ts
          ON ts.team_id = pts.team_id
        JOIN player_totals pt
          ON pt.player_team_season_id = pts.player_team_season_id
        LEFT JOIN player_shot_location_profiles pslp
          ON pslp.player_team_season_id = pts.player_team_season_id
        WHERE pt.fga >= ?
          AND pslp.player_team_season_id IS NULL
        """,
        (minimum_fga,),
    )
    if missing_count:
        examples = [
            "{} {} ({}, FGA {})".format(row["team_id"], row["name"], row["season_end_year"], row["fga"])
            for row in conn.execute(
                """
                SELECT ts.team_id, ts.season_end_year, pts.name, pt.fga
                FROM player_team_seasons pts
                JOIN team_seasons ts
                  ON ts.team_id = pts.team_id
                JOIN player_totals pt
                  ON pt.player_team_season_id = pts.player_team_season_id
                LEFT JOIN player_shot_location_profiles pslp
                  ON pslp.player_team_season_id = pts.player_team_season_id
                WHERE pt.fga >= ?
                  AND pslp.player_team_season_id IS NULL
                ORDER BY pt.fga DESC
                LIMIT 5
                """,
                (minimum_fga,),
            )
        ]
        failures.append(
            "player_shot_location_profiles missing for {} player-season(s) with FGA >= {} (examples: {})".format(
                missing_count, minimum_fga, preview(examples, limit=5)
            )
        )

    modern_proxy_count = scalar(
        conn,
        """
        SELECT COUNT(*)
        FROM player_team_seasons pts
        JOIN team_seasons ts
          ON ts.team_id = pts.team_id
        JOIN player_totals pt
          ON pt.player_team_season_id = pts.player_team_season_id
        JOIN player_shot_location_profiles pslp
          ON pslp.player_team_season_id = pts.player_team_season_id
        WHERE ts.season_end_year >= ?
          AND pt.fga >= ?
          AND pslp.method != 'sourced-location'
        """,
        (detailed_start_year, minimum_fga),
    )
    if modern_proxy_count:
        failures.append(
            "modern player shot-location profiles must be sourced-location for FGA >= {}; found {} proxy row(s)".format(
                minimum_fga, modern_proxy_count
            )
        )

    malformed_count = scalar(
        conn,
        """
        SELECT COUNT(*)
        FROM player_shot_location_profiles
        WHERE model_version IS NULL
          OR model_version = ''
          OR confidence IS NULL
          OR confidence < 0
          OR confidence > 1
          OR source_refs_json IS NULL
          OR source_refs_json = '[]'
          OR source_player_seasons_json IS NULL
          OR source_player_seasons_json = '[]'
          OR source_fga IS NULL
          OR source_fga <= 0
        """,
    )
    if malformed_count:
        failures.append("player_shot_location_profiles has {} malformed provenance row(s)".format(malformed_count))

    incoherent_count = scalar(
        conn,
        """
        SELECT COUNT(*)
        FROM player_shot_location_profiles pslp
        WHERE pct_fga_00_03 IS NULL
          OR pct_fga_03_10 IS NULL
          OR pct_fga_10_16 IS NULL
          OR pct_fga_16_xx IS NULL
          OR pct_fga_3p IS NULL
          OR (method != 'sourced-location' AND ABS(pct_fga_00_03 + pct_fga_03_10 + pct_fga_10_16 + pct_fga_16_xx + pct_fga_3p - 1) > 0.015)
          OR (pct_fga_00_03 > 0.000001 AND fg_pct_00_03 IS NULL)
          OR (pct_fga_03_10 > 0.000001 AND fg_pct_03_10 IS NULL)
          OR (pct_fga_10_16 > 0.000001 AND fg_pct_10_16 IS NULL)
          OR (pct_fga_16_xx > 0.000001 AND fg_pct_16_xx IS NULL)
        """,
    )
    if incoherent_count:
        failures.append("player_shot_location_profiles has {} incoherent share/make row(s)".format(incoherent_count))

    proxy_three_mismatch = scalar(
        conn,
        """
        SELECT COUNT(*)
        FROM player_shot_location_profiles pslp
        JOIN player_totals pt
          ON pt.player_team_season_id = pslp.player_team_season_id
        WHERE pslp.method != 'sourced-location'
          AND pt.fga > 0
          AND ABS(pslp.pct_fga_3p - (pt.fg3a / pt.fga)) > 0.0005
        """,
    )
    if proxy_three_mismatch:
        failures.append("proxy shot-location profiles do not preserve sourced 3PA/FGA for {} row(s)".format(proxy_three_mismatch))

    proxy_two_mismatch = scalar(
        conn,
        """
        SELECT COUNT(*)
        FROM player_shot_location_profiles pslp
        JOIN player_totals pt
          ON pt.player_team_season_id = pslp.player_team_season_id
        WHERE pslp.method != 'sourced-location'
          AND pt.fg2a > 0
          AND ABS(
            (
              pslp.pct_fga_00_03 * pslp.fg_pct_00_03
              + pslp.pct_fga_03_10 * pslp.fg_pct_03_10
              + pslp.pct_fga_10_16 * pslp.fg_pct_10_16
              + pslp.pct_fga_16_xx * pslp.fg_pct_16_xx
            )
            / NULLIF(pslp.pct_fga_00_03 + pslp.pct_fga_03_10 + pslp.pct_fga_10_16 + pslp.pct_fga_16_xx, 0)
            - (pt.fg2 / pt.fg2a)
          ) > 0.01
        """,
    )
    if proxy_two_mismatch:
        failures.append("proxy shot-location profiles do not reconcile to sourced 2P% for {} row(s)".format(proxy_two_mismatch))


def add_league_failures(conn, start_year, end_year, failures):
    season_years = {
        row["season_end_year"]
        for row in conn.execute(
            """
            SELECT season_end_year
            FROM seasons
            WHERE season_end_year BETWEEN ? AND ?
            """,
            (start_year, end_year),
        )
    }
    league_years = {
        row["season_end_year"]
        for row in conn.execute(
            """
            SELECT season_end_year
            FROM league_seasons
            WHERE season_end_year BETWEEN ? AND ?
            """,
            (start_year, end_year),
        )
    }

    if league_years != season_years:
        details = []
        missing = season_years - league_years
        extra = league_years - season_years
        if missing:
            details.append("missing {}".format(format_ranges(missing)))
        if extra:
            details.append("extra {}".format(format_ranges(extra)))
        failures.append(
            "league_seasons do not match seasons in expected range: {} (league_seasons={}, seasons={})".format(
                "; ".join(details), len(league_years), len(season_years)
            )
        )

    for table_name in ("league_metric_distributions", "league_team_metrics"):
        counts = {
            row["season_end_year"]: row["count"]
            for row in conn.execute(
                f"""
                SELECT season_end_year, COUNT(*) AS count
                FROM {table_name}
                WHERE season_end_year BETWEEN ? AND ?
                GROUP BY season_end_year
                """,
                (start_year, end_year),
            )
        }
        missing_metrics = [year for year in sorted(league_years) if counts.get(year, 0) == 0]
        if missing_metrics:
            failures.append(
                "{} has no rows for league season(s): {}".format(
                    table_name, format_ranges(missing_metrics)
                )
            )

    strength_years = {
        row["season_end_year"]
        for row in conn.execute(
            """
            SELECT season_end_year
            FROM league_strength
            WHERE season_end_year BETWEEN ? AND ?
            """,
            (start_year, end_year),
        )
    }
    if strength_years != league_years:
        failures.append(
            "league_strength rows do not match league_seasons: missing {}, extra {}".format(
                format_ranges(league_years - strength_years),
                format_ranges(strength_years - league_years),
            )
        )

    invalid_strength_count = scalar(
        conn,
        """
        SELECT COUNT(*)
        FROM league_strength
        WHERE team_count <= 0
          OR qualified_player_count <= 0
          OR qualified_players_per_team <= 0
          OR effective_rotation_depth <= 0
          OR talent_points_per_100 < -2.25
          OR talent_points_per_100 > 2.25
          OR model_version IS NULL
          OR model_version = ''
        """,
    )
    if invalid_strength_count:
        failures.append("league_strength has {} invalid row(s)".format(invalid_strength_count))


def add_browser_export_failures(conn, failures):
    if not DEFAULT_CATALOG.exists():
        failures.append(f"browser catalog is missing: {DEFAULT_CATALOG}")
        return
    if not DEFAULT_TEAM_DIR.exists():
        failures.append(f"browser team directory is missing: {DEFAULT_TEAM_DIR}")
        return

    try:
        with DEFAULT_CATALOG.open("r", encoding="utf-8") as handle:
            catalog = json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        failures.append(f"could not read browser catalog {DEFAULT_CATALOG}: {exc}")
        return

    teams = catalog.get("teams") if isinstance(catalog, dict) else None
    leagues = catalog.get("leagues") if isinstance(catalog, dict) else None
    if not isinstance(teams, list):
        failures.append(f"browser catalog {DEFAULT_CATALOG} does not contain a teams array")
        return
    if not isinstance(leagues, list):
        failures.append(f"browser catalog {DEFAULT_CATALOG} does not contain a leagues array")

    db_team_ids = {
        row["team_id"]
        for row in conn.execute(
            """
            SELECT team_id
            FROM team_seasons
            ORDER BY team_id
            """
        )
    }
    catalog_team_ids = set()
    duplicate_ids = []
    for team in teams:
        team_id = team.get("id") if isinstance(team, dict) else None
        if not team_id:
            failures.append("browser catalog contains a team entry without id")
            continue
        if team_id in catalog_team_ids:
            duplicate_ids.append(team_id)
        catalog_team_ids.add(team_id)

    if duplicate_ids:
        failures.append("browser catalog has duplicate team id(s): {}".format(preview(duplicate_ids, limit=5)))

    missing_catalog_ids = db_team_ids - catalog_team_ids
    extra_catalog_ids = catalog_team_ids - db_team_ids
    if missing_catalog_ids:
        failures.append("browser catalog missing team id(s) from SQLite: {}".format(preview(sorted(missing_catalog_ids), limit=8)))
    if extra_catalog_ids:
        failures.append("browser catalog has team id(s) not in SQLite: {}".format(preview(sorted(extra_catalog_ids), limit=8)))

    missing_files = []
    mismatched_files = []
    invalid_files = []
    for team_id in sorted(db_team_ids):
        path = DEFAULT_TEAM_DIR / f"{team_id}.json"
        if not path.exists():
            missing_files.append(team_id)
            continue
        try:
            with path.open("r", encoding="utf-8") as handle:
                team = json.load(handle)
        except (OSError, json.JSONDecodeError):
            invalid_files.append(team_id)
            continue
        if not isinstance(team, dict) or team.get("id") != team_id:
            mismatched_files.append(team_id)

    if missing_files:
        failures.append("browser team files missing for team id(s): {}".format(preview(missing_files, limit=8)))
    if invalid_files:
        failures.append("browser team files with invalid JSON for team id(s): {}".format(preview(invalid_files, limit=8)))
    if mismatched_files:
        failures.append("browser team files with mismatched id for team id(s): {}".format(preview(mismatched_files, limit=8)))


def collect_counts(conn):
    return {table: scalar(conn, f"SELECT COUNT(*) FROM {table}") for table in SUMMARY_TABLES}


def print_report(database_path, start_year, end_year, failures, warnings, counts, source_id):
    stream = sys.stderr if failures else sys.stdout
    if failures:
        print(f"Validation failed for {database_path} ({start_year}-{end_year}).", file=stream)
        for failure in failures:
            print(f"- {failure}", file=stream)
    else:
        suffix = " with warnings" if warnings else ""
        print(
            f"Validation passed{suffix} for {database_path} ({start_year}-{end_year}).",
            file=stream,
        )

    if counts:
        print(
            "Counts: {}".format(
                ", ".join(f"{name}={count}" for name, count in counts.items())
            ),
            file=stream,
        )
    if source_id is not None:
        print(
            "source_id coverage: {:.1%} ({}/{})".format(
                source_id["coverage"], source_id["with_source_id"], source_id["total"]
            ),
            file=stream,
        )
    if warnings:
        print("Warnings:", file=stream)
        for warning in warnings:
            print(f"- {warning}", file=stream)


def main():
    args = parse_args()
    database_path = resolve_path(args.database)
    start_year = args.expected_start_year
    end_year = args.expected_end_year

    if start_year > end_year:
        print(
            f"Validation failed: expected start year {start_year} is after expected end year {end_year}.",
            file=sys.stderr,
        )
        return 1

    failures = []
    warnings = []
    counts = None
    source_id = None

    try:
        with connect_readonly(database_path) as conn:
            add_integrity_failures(conn, failures)
            tables_available = ensure_required_tables(conn, failures)
            if tables_available:
                manifest = load_manifest(DEFAULT_MANIFEST, failures, warnings)
                add_season_failures(conn, manifest, start_year, end_year, failures)
                add_source_page_failures(conn, failures)
                source_id = add_player_failures(conn, failures, warnings)
                add_player_shooting_failures(conn, failures, warnings)
                add_shot_location_profile_failures(conn, failures)
                add_league_failures(conn, start_year, end_year, failures)
                add_browser_export_failures(conn, failures)
                counts = collect_counts(conn)
    except (RuntimeError, sqlite3.Error) as exc:
        failures.append(str(exc))

    print_report(database_path, start_year, end_year, failures, warnings, counts, source_id)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
