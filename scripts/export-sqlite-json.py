#!/usr/bin/env python3
import argparse
import json
import sqlite3
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATABASE = ROOT / "data" / "basketball-dice.sqlite"
DEFAULT_OUTPUT = ROOT / "data" / "teams.generated.json"
DEFAULT_CATALOG_OUTPUT = ROOT / "public" / "data" / "catalog.generated.json"
DEFAULT_TEAM_DIR = ROOT / "public" / "data" / "teams"

TEAM_TOTAL_KEYS = [
    "fg",
    "fga",
    "fg3",
    "fg3a",
    "fg2",
    "fg2a",
    "ft",
    "fta",
    "orb",
    "drb",
    "trb",
    "ast",
    "stl",
    "blk",
    "tov",
    "pf",
    "pts",
]

TEAM_METRIC_MAP = [
    ("wins", "wins"),
    ("losses", "losses"),
    ("pace", "pace"),
    ("offensiveRating", "offensive_rating"),
    ("defensiveRating", "defensive_rating"),
    ("expectedWins", "expected_wins"),
    ("expectedLosses", "expected_losses"),
    ("simpleRating", "simple_rating"),
    ("strengthOfSchedule", "strength_of_schedule"),
    ("marginOfVictory", "margin_of_victory"),
    ("efgPct", "efg_pct"),
    ("turnoverPct", "turnover_pct"),
    ("offensiveReboundPct", "offensive_rebound_pct"),
    ("freeThrowAttemptRate", "free_throw_attempt_rate"),
    ("freeThrowRate", "free_throw_rate"),
    ("opponentEfgPct", "opponent_efg_pct"),
    ("opponentTurnoverPct", "opponent_turnover_pct"),
    ("defensiveReboundPct", "defensive_rebound_pct"),
    ("opponentFreeThrowAttemptRate", "opponent_free_throw_attempt_rate"),
    ("opponentFreeThrowRate", "opponent_free_throw_rate"),
    ("threeAttemptRate", "three_attempt_rate"),
]

PLAYER_PER_GAME_MAP = [
    ("mp", "mp"),
    ("pts", "pts"),
    ("trb", "trb"),
    ("ast", "ast"),
    ("stl", "stl"),
    ("blk", "blk"),
    ("tov", "tov"),
    ("pf", "pf"),
    ("fga", "fga"),
    ("fg3a", "fg3a"),
    ("fta", "fta"),
]

PLAYER_TOTALS_MAP = [
    ("fg", "fg"),
    ("fga", "fga"),
    ("fgPct", "fg_pct"),
    ("fg3", "fg3"),
    ("fg3a", "fg3a"),
    ("fg3Pct", "fg3_pct"),
    ("fg2", "fg2"),
    ("fg2a", "fg2a"),
    ("fg2Pct", "fg2_pct"),
    ("ft", "ft"),
    ("fta", "fta"),
    ("ftPct", "ft_pct"),
    ("orb", "orb"),
    ("drb", "drb"),
    ("trb", "trb"),
    ("ast", "ast"),
    ("stl", "stl"),
    ("blk", "blk"),
    ("tov", "tov"),
    ("pf", "pf"),
    ("pts", "pts"),
]

PLAYER_PER_100_MAP = [
    ("fga", "fga"),
    ("fg3a", "fg3a"),
    ("fta", "fta"),
    ("orb", "orb"),
    ("drb", "drb"),
    ("trb", "trb"),
    ("ast", "ast"),
    ("stl", "stl"),
    ("blk", "blk"),
    ("tov", "tov"),
    ("pf", "pf"),
    ("pts", "pts"),
    ("offRtg", "off_rtg"),
    ("defRtg", "def_rtg"),
]

PLAYER_ADVANCED_MAP = [
    ("usagePct", "usage_pct"),
    ("tsPct", "ts_pct"),
    ("threeAttemptRate", "three_attempt_rate"),
    ("freeThrowRate", "free_throw_rate"),
    ("orbPct", "orb_pct"),
    ("drbPct", "drb_pct"),
    ("trbPct", "trb_pct"),
    ("astPct", "ast_pct"),
    ("stlPct", "stl_pct"),
    ("blkPct", "blk_pct"),
    ("tovPct", "tov_pct"),
    ("ows", "ows"),
    ("dws", "dws"),
    ("ws", "ws"),
    ("obpm", "obpm"),
    ("dbpm", "dbpm"),
    ("bpm", "bpm"),
]

PLAYER_SHOOTING_MAP = [
    ("avgDistance", "avg_distance"),
    ("pctFga2p", "pct_fga_2p"),
    ("pctFga00_03", "pct_fga_00_03"),
    ("pctFga03_10", "pct_fga_03_10"),
    ("pctFga10_16", "pct_fga_10_16"),
    ("pctFga16_xx", "pct_fga_16_xx"),
    ("pctFga3p", "pct_fga_3p"),
    ("fgPct2p", "fg_pct_2p"),
    ("fgPct00_03", "fg_pct_00_03"),
    ("fgPct03_10", "fg_pct_03_10"),
    ("fgPct10_16", "fg_pct_10_16"),
    ("fgPct16_xx", "fg_pct_16_xx"),
    ("fgPct3p", "fg_pct_3p"),
    ("pctAst2p", "pct_ast_2p"),
    ("pctAst3p", "pct_ast_3p"),
    ("pctFgaDunk", "pct_fga_dunk"),
    ("fgDunk", "fg_dunk"),
    ("pctCorner3", "pct_corner_3"),
    ("corner3Pct", "corner_3_pct"),
]

PLAYER_SHOT_LOCATION_PROFILE_MAP = [
    ("pctFga00_03", "pct_fga_00_03"),
    ("pctFga03_10", "pct_fga_03_10"),
    ("pctFga10_16", "pct_fga_10_16"),
    ("pctFga16_xx", "pct_fga_16_xx"),
    ("pctFga3p", "pct_fga_3p"),
    ("fgPct00_03", "fg_pct_00_03"),
    ("fgPct03_10", "fg_pct_03_10"),
    ("fgPct10_16", "fg_pct_10_16"),
    ("fgPct16_xx", "fg_pct_16_xx"),
    ("fgPct3p", "fg_pct_3p"),
]

PLAYER_PLAY_BY_PLAY_MAP = [
    ("plusMinusOn", "plus_minus_on"),
    ("plusMinusNet", "plus_minus_net"),
    ("badPassTurnovers", "bad_pass_turnovers"),
    ("lostBallTurnovers", "lost_ball_turnovers"),
    ("shootingFouls", "shooting_fouls"),
    ("offensiveFouls", "offensive_fouls"),
    ("drawnShooting", "drawn_shooting"),
    ("drawnOffensive", "drawn_offensive"),
    ("assistedPoints", "assisted_points"),
    ("andOnes", "and_ones"),
    ("ownShotsBlocked", "own_shots_blocked"),
]

LEAGUE_AVERAGES_MAP = [
    ("pace", "pace"),
    ("offensiveRating", "offensive_rating"),
    ("defensiveRating", "defensive_rating"),
    ("simpleRating", "simple_rating"),
    ("marginOfVictory", "margin_of_victory"),
    ("efgPct", "efg_pct"),
    ("turnoverPct", "turnover_pct"),
    ("offensiveReboundPct", "offensive_rebound_pct"),
    ("freeThrowRate", "free_throw_rate"),
    ("freeThrowAttemptRate", "free_throw_attempt_rate"),
    ("opponentEfgPct", "opponent_efg_pct"),
    ("opponentTurnoverPct", "opponent_turnover_pct"),
    ("defensiveReboundPct", "defensive_rebound_pct"),
    ("opponentFreeThrowAttemptRate", "opponent_free_throw_attempt_rate"),
    ("opponentFreeThrowRate", "opponent_free_throw_rate"),
    ("threeAttemptRate", "three_attempt_rate"),
    ("fg2Pct", "fg2_pct"),
    ("fg3Pct", "fg3_pct"),
    ("ftPct", "ft_pct"),
]

LEAGUE_TEAM_MAP = [
    ("name", "team_name"),
    ("wins", "wins"),
    ("losses", "losses"),
    ("pace", "pace"),
    ("offensiveRating", "offensive_rating"),
    ("defensiveRating", "defensive_rating"),
    ("netRating", "net_rating"),
    ("simpleRating", "simple_rating"),
    ("marginOfVictory", "margin_of_victory"),
    ("efgPct", "efg_pct"),
    ("turnoverPct", "turnover_pct"),
    ("offensiveReboundPct", "offensive_rebound_pct"),
    ("freeThrowRate", "free_throw_rate"),
    ("freeThrowAttemptRate", "free_throw_attempt_rate"),
    ("opponentEfgPct", "opponent_efg_pct"),
    ("opponentTurnoverPct", "opponent_turnover_pct"),
    ("defensiveReboundPct", "defensive_rebound_pct"),
    ("opponentFreeThrowAttemptRate", "opponent_free_throw_attempt_rate"),
    ("opponentFreeThrowRate", "opponent_free_throw_rate"),
    ("threeAttemptRate", "three_attempt_rate"),
    ("fg2Pct", "fg2_pct"),
    ("fg3Pct", "fg3_pct"),
    ("ftPct", "ft_pct"),
]

TEAM_DISTRIBUTION_ORDER = [
    "pace",
    "offensiveRating",
    "defensiveRating",
    "simpleRating",
    "marginOfVictory",
    "efgPct",
    "turnoverPct",
    "offensiveReboundPct",
    "freeThrowRate",
    "opponentEfgPct",
    "opponentTurnoverPct",
    "defensiveReboundPct",
    "opponentFreeThrowRate",
    "threeAttemptRate",
    "freeThrowAttemptRate",
    "opponentFreeThrowAttemptRate",
    "fg2Pct",
    "fg3Pct",
    "ftPct",
]

PLAYER_DISTRIBUTION_ORDER = [
    "usagePct",
    "trueShootingPct",
    "threeAttemptRate",
    "freeThrowAttemptRate",
    "offensiveReboundPct",
    "defensiveReboundPct",
    "totalReboundPct",
    "assistPct",
    "stealPct",
    "blockPct",
    "turnoverPct",
    "offensiveWinShares",
    "defensiveWinShares",
    "winShares",
    "offensiveBoxPlusMinus",
    "defensiveBoxPlusMinus",
    "boxPlusMinus",
]


def normalize_number(value):
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def mapped_object(row, mapping):
    if row is None:
        return {json_key: None for json_key, _ in mapping}
    return {json_key: normalize_number(row[column]) for json_key, column in mapping}


def one(conn, sql, params=()):
    return conn.execute(sql, params).fetchone()


def all_rows(conn, sql, params=()):
    return conn.execute(sql, params).fetchall()


def metadata(conn):
    rows = all_rows(conn, "SELECT key, value FROM metadata ORDER BY key")
    return {row["key"]: row["value"] for row in rows}


def table_ids(conn, source_page_id):
    if source_page_id is None:
        return []
    source_row = one(
        conn,
        """
        SELECT table_ids_json
        FROM source_pages
        WHERE source_page_id = ?
        """,
        (source_page_id,),
    )
    if source_row is not None and source_row["table_ids_json"] is not None:
        ids = json.loads(source_row["table_ids_json"])
        if ids:
            return ids
    rows = all_rows(
        conn,
        """
        SELECT table_id
        FROM source_page_tables
        WHERE source_page_id = ?
        ORDER BY ordinal
        """,
        (source_page_id,),
    )
    return [row["table_id"] for row in rows if row["table_id"]]


def source_page(conn, source_page_id):
    row = None
    if source_page_id is not None:
        row = one(
            conn,
            """
            SELECT provider, url, fetched_at, page_title, h1
            FROM source_pages
            WHERE source_page_id = ?
            """,
            (source_page_id,),
        )
    if row is None:
        return {
            "provider": None,
            "url": None,
            "fetchedAt": None,
            "pageTitle": None,
            "h1": None,
            "tableIds": [],
        }
    return {
        "provider": row["provider"],
        "url": row["url"],
        "fetchedAt": row["fetched_at"],
        "pageTitle": row["page_title"],
        "h1": row["h1"],
        "tableIds": table_ids(conn, source_page_id),
    }


def raw_table_summary(conn, source_page_id):
    if source_page_id is None:
        return []
    rows = all_rows(
        conn,
        """
        SELECT table_id, caption, row_count, headers_json
        FROM source_page_tables
        WHERE source_page_id = ?
        ORDER BY ordinal
        """,
        (source_page_id,),
    )
    summaries = []
    for row in rows:
        headers = json.loads(row["headers_json"]) if row["headers_json"] is not None else None
        summaries.append(
            {
                "id": row["table_id"],
                "caption": row["caption"],
                "rows": normalize_number(row["row_count"]),
                "headers": headers,
            }
        )
    return summaries


def team_totals(conn, team_id, side):
    row = one(
        conn,
        f"""
        SELECT {", ".join(TEAM_TOTAL_KEYS)}
        FROM team_totals
        WHERE team_id = ? AND side = ?
        """,
        (team_id, side),
    )
    if row is None:
        return {key: None for key in TEAM_TOTAL_KEYS}
    return {key: normalize_number(row[key]) for key in TEAM_TOTAL_KEYS}


def player_stat(conn, table, player_team_season_id, mapping):
    row = one(
        conn,
        f"""
        SELECT *
        FROM {table}
        WHERE player_team_season_id = ?
        """,
        (player_team_season_id,),
    )
    return mapped_object(row, mapping)


def player_shot_location_profile(conn, player_team_season_id):
    row = one(
        conn,
        """
        SELECT *
        FROM player_shot_location_profiles
        WHERE player_team_season_id = ?
        """,
        (player_team_season_id,),
    )
    if row is None:
        return None
    out = {
        "method": row["method"],
        "modelVersion": row["model_version"],
        "confidence": normalize_number(row["confidence"]),
        "sourceRefs": json.loads(row["source_refs_json"] or "[]"),
        "sourcePlayerSeasons": json.loads(row["source_player_seasons_json"] or "[]"),
        "neighborCount": normalize_number(row["neighbor_count"]),
        "sourceFga": normalize_number(row["source_fga"]),
        "qualityWarnings": json.loads(row["quality_warnings_json"] or "[]"),
    }
    out.update(mapped_object(row, PLAYER_SHOT_LOCATION_PROFILE_MAP))
    return out


def build_player(conn, row):
    player = {}
    if row["source_id"] is not None:
        player["sourceId"] = row["source_id"]
    if row["source_url"] is not None:
        player["sourceUrl"] = row["source_url"]

    player_team_season_id = row["player_team_season_id"]
    player.update(
        {
            "name": row["name"],
            "position": row["position"],
            "age": normalize_number(row["age"]),
            "games": normalize_number(row["games"]),
            "gamesStarted": normalize_number(row["games_started"]),
            "minutes": normalize_number(row["minutes"]),
            "perGame": player_stat(conn, "player_per_game", player_team_season_id, PLAYER_PER_GAME_MAP),
            "totals": player_stat(conn, "player_totals", player_team_season_id, PLAYER_TOTALS_MAP),
            "per100": player_stat(conn, "player_per_100", player_team_season_id, PLAYER_PER_100_MAP),
            "advanced": player_stat(conn, "player_advanced", player_team_season_id, PLAYER_ADVANCED_MAP),
            "shooting": player_stat(conn, "player_shooting", player_team_season_id, PLAYER_SHOOTING_MAP),
            "shotLocationProfile": player_shot_location_profile(conn, player_team_season_id),
            "playByPlay": player_stat(
                conn,
                "player_play_by_play",
                player_team_season_id,
                PLAYER_PLAY_BY_PLAY_MAP,
            ),
            "roster": {
                "number": row["jersey_number"],
                "height": row["height"],
                "weight": normalize_number(row["weight"]),
                "birthDate": row["birth_date"],
                "college": row["college"],
            },
        }
    )
    if row["postseason_json"] is not None:
        player["postseason"] = json.loads(row["postseason_json"])
    return player


def build_players(conn, team_id):
    rows = all_rows(
        conn,
        """
        SELECT *
        FROM player_team_seasons
        WHERE team_id = ?
        ORDER BY player_team_season_id
        """,
        (team_id,),
    )
    return [build_player(conn, row) for row in rows]


def build_team(conn, row):
    metrics = one(conn, "SELECT * FROM team_metrics WHERE team_id = ?", (row["team_id"],))
    team_metrics = mapped_object(metrics, TEAM_METRIC_MAP)
    team_metrics["totals"] = team_totals(conn, row["team_id"], "team")
    team_metrics["opponentTotals"] = team_totals(conn, row["team_id"], "opponent")

    return {
        "id": row["team_id"],
        "name": row["name"],
        "shortName": row["short_name"],
        "franchise": row["franchise"],
        "abbr": row["abbr"],
        "season": row["season"],
        "seasonEndYear": normalize_number(row["season_end_year"]),
        "source": source_page(conn, row["source_page_id"]),
        "team": team_metrics,
        "players": build_players(conn, row["team_id"]),
        "rawTableSummary": raw_table_summary(conn, row["source_page_id"]),
    }


def build_teams(conn):
    rows = all_rows(
        conn,
        """
        SELECT
          ts.team_id,
          ts.name,
          ts.short_name,
          f.name AS franchise,
          ts.abbr,
          s.season,
          ts.season_end_year,
          ts.source_page_id
        FROM team_seasons ts
        JOIN seasons s ON s.season_end_year = ts.season_end_year
        JOIN franchises f ON f.franchise_id = ts.franchise_id
        ORDER BY
          ts.source_page_id IS NULL,
          ts.source_page_id,
          ts.season_end_year,
          ts.abbr,
          ts.team_id
        """,
    )
    return [build_team(conn, row) for row in rows]


def distribution_object(row):
    return {
        "mean": normalize_number(row["mean"]),
        "stdev": normalize_number(row["stdev"]),
        "min": normalize_number(row["min"]),
        "max": normalize_number(row["max"]),
    }


def build_distributions(conn, season_end_year, scope, preferred_order):
    rows = all_rows(
        conn,
        """
        SELECT metric, mean, stdev, min, max
        FROM league_metric_distributions
        WHERE season_end_year = ? AND scope = ?
        """,
        (season_end_year, scope),
    )
    by_metric = {row["metric"]: row for row in rows}
    ordered_metrics = [metric for metric in preferred_order if metric in by_metric]
    ordered_metrics.extend(sorted(metric for metric in by_metric if metric not in preferred_order))
    return {metric: distribution_object(by_metric[metric]) for metric in ordered_metrics}


def build_league_teams(conn, season_end_year):
    rows = all_rows(
        conn,
        """
        SELECT *
        FROM league_team_metrics
        WHERE season_end_year = ?
        ORDER BY rowid
        """,
        (season_end_year,),
    )
    return [mapped_object(row, LEAGUE_TEAM_MAP) for row in rows]


def build_league(conn, row):
    averages = one(
        conn,
        """
        SELECT *
        FROM league_averages
        WHERE season_end_year = ?
        """,
        (row["season_end_year"],),
    )
    season_end_year = row["season_end_year"]
    strength = one(
        conn,
        """
        SELECT *
        FROM league_strength
        WHERE season_end_year = ?
        """,
        (season_end_year,),
    )
    if strength is None:
        raise ValueError(f"Missing league strength for {season_end_year}")
    return {
        "season": row["season"],
        "seasonEndYear": normalize_number(season_end_year),
        "source": source_page(conn, row["source_page_id"]),
        "averages": mapped_object(averages, LEAGUE_AVERAGES_MAP),
        "distributions": build_distributions(conn, season_end_year, "team", TEAM_DISTRIBUTION_ORDER),
        "playerDistributions": build_distributions(
            conn,
            season_end_year,
            "player",
            PLAYER_DISTRIBUTION_ORDER,
        ),
        "strength": {
            "teamCount": normalize_number(strength["team_count"]),
            "qualifiedPlayerCount": normalize_number(strength["qualified_player_count"]),
            "qualifiedPlayersPerTeam": normalize_number(strength["qualified_players_per_team"]),
            "effectiveRotationDepth": normalize_number(strength["effective_rotation_depth"]),
            "depthZ": normalize_number(strength["depth_z"]),
            "qualifiedPlayersPerTeamZ": normalize_number(strength["qualified_players_per_team_z"]),
            "teamCountZ": normalize_number(strength["team_count_z"]),
            "leagueStrengthZ": normalize_number(strength["league_strength_z"]),
            "talentPointsPer100": normalize_number(strength["talent_points_per_100"]),
            "modelVersion": strength["model_version"],
        },
        "qualifiedPlayerCount": normalize_number(row["qualified_player_count"]),
        "teams": build_league_teams(conn, season_end_year),
    }


def build_leagues(conn):
    rows = all_rows(
        conn,
        """
        SELECT season_end_year, season, qualified_player_count, source_page_id
        FROM league_seasons
        ORDER BY
          source_page_id IS NULL,
          source_page_id,
          season_end_year
        """,
    )
    return [build_league(conn, row) for row in rows]


def generated_source_data(conn):
    meta = metadata(conn)
    return {
        "generatedAt": meta.get("generated_at"),
        "manifestVersion": meta.get("manifest_version"),
        "sourceProvider": meta.get("source_provider"),
        "teams": build_teams(conn),
        "leagues": build_leagues(conn),
    }


def team_catalog_entry(team):
    return {
        "id": team["id"],
        "name": team["name"],
        "shortName": team["shortName"],
        "franchise": team["franchise"],
        "abbr": team["abbr"],
        "season": team["season"],
        "seasonEndYear": team["seasonEndYear"],
        "team": {
            "wins": team["team"]["wins"],
            "losses": team["team"]["losses"],
        },
    }


def generated_catalog(data):
    return {
        "generatedAt": data["generatedAt"],
        "manifestVersion": data["manifestVersion"],
        "sourceProvider": data["sourceProvider"],
        "teams": [team_catalog_entry(team) for team in data["teams"]],
        "leagues": data["leagues"],
    }


def resolve_path(path):
    resolved = Path(path).expanduser()
    if not resolved.is_absolute():
        resolved = Path.cwd() / resolved
    return resolved.resolve()


def write_json(data, output_path):
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = output_path.with_suffix(output_path.suffix + ".tmp")
    with temp_path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    temp_path.replace(output_path)


def export_team_files(teams, team_dir):
    team_dir.mkdir(parents=True, exist_ok=True)
    for old_file in team_dir.glob("*.json"):
        old_file.unlink()
    for team in teams:
        write_json(team, team_dir / f"{team['id']}.json")


def export_json(database_path, output_path, catalog_output_path, team_dir):
    if not database_path.exists():
        raise FileNotFoundError(f"SQLite database not found: {database_path}")

    conn = sqlite3.connect(database_path)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA query_only = ON")
        data = generated_source_data(conn)
    finally:
        conn.close()

    write_json(data, output_path)
    write_json(generated_catalog(data), catalog_output_path)
    export_team_files(data["teams"], team_dir)
    return data


def main():
    parser = argparse.ArgumentParser(
        description="Export Basketball Dice Studio SQLite data back to GeneratedSourceData JSON."
    )
    parser.add_argument(
        "--database",
        "--input",
        dest="database",
        default=DEFAULT_DATABASE,
        help=f"SQLite database path. Default: {DEFAULT_DATABASE}",
    )
    parser.add_argument(
        "--output",
        default=DEFAULT_OUTPUT,
        help=f"Generated source JSON output path. Default: {DEFAULT_OUTPUT}",
    )
    parser.add_argument(
        "--catalog-output",
        default=DEFAULT_CATALOG_OUTPUT,
        help=f"Browser catalog JSON output path. Default: {DEFAULT_CATALOG_OUTPUT}",
    )
    parser.add_argument(
        "--team-dir",
        default=DEFAULT_TEAM_DIR,
        help=f"Browser per-team JSON output directory. Default: {DEFAULT_TEAM_DIR}",
    )
    args = parser.parse_args()

    database_path = resolve_path(args.database)
    output_path = resolve_path(args.output)
    catalog_output_path = resolve_path(args.catalog_output)
    team_dir = resolve_path(args.team_dir)

    try:
        data = export_json(database_path, output_path, catalog_output_path, team_dir)
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    print(f"Wrote {output_path}")
    print(f"Wrote {catalog_output_path}")
    print(f"Wrote {team_dir}")
    print(f"teams: {len(data['teams'])}")
    print(f"leagues: {len(data['leagues'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
