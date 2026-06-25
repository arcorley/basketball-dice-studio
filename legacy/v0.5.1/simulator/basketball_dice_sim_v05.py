#!/usr/bin/env python3
"""
Basketball Dice Game Simulator v0.5

No external dependencies. Default matchup: 2024-25 Thunder at 2024-25 Knicks. v0.5 adds game-card generation and expanded scoresheets; sim math is unchanged from v0.4.
Teams in starter set: Thunder, Knicks, Celtics, Nuggets.

Example:
    python basketball_dice_sim_v05.py --away Thunder --home Knicks --games 10000 --seed 777 --sample-seed 18 --outdir sim_output
"""
from dataclasses import dataclass
from collections import defaultdict, Counter
from typing import List, Dict
import argparse, csv, math, os, random, statistics

@dataclass
class Player:
    team: str; name: str; use: int; tov: int; fd: int; three_f: int; p2: int; p3: int; ft: int; astw: int; orbw: int; drbw: int; stlw: int; blkw: int; pfw: int
@dataclass
class Team:
    name: str; pace: float; ortg: float; drtg: float; shotq: int; defense: int; to_press: int; to_protect: int; foul_draw: int; foul_disc: int; three_tend: int; orb: int; drb: int; ast: int; players: List[Player]
@dataclass
class SimParams:
    global_shot_mod: int = -1
    global_fd_mod: int = 1
    fd_scale: float = 1.0
    global_tov_mod: int = 0
    tov_scale: float = 1.0
    three_mod: int = 0
    orb_base: int = 27
    ast_mod: int = 0
    block_base: int = 7
    steal_turnover_pct: int = 60
    nonshoot_foul_chance: int = 7
    defense_shot_divisor: float = 2.0
    max_orb_extensions: int = 2

TEAM_ROWS = [{'Team': 'Thunder', 'Abbr': 'OKC', 'Pace': 100.0, 'ORtg': 120.3, 'DRtg': 107.5, 'ShotQ': 1, 'DEF': 5, 'TO Press': 2, 'TO Protect': 1, 'Foul Draw': 1, 'Foul Disc': 1, '3PT Tend': 1, 'ORB': 0, 'DRB': 2, 'AST': 57}, {'Team': 'Knicks', 'Abbr': 'NYK', 'Pace': 96.7, 'ORtg': 118.5, 'DRtg': 114.3, 'ShotQ': 1, 'DEF': 1, 'TO Press': 1, 'TO Protect': 1, 'Foul Draw': 1, 'Foul Disc': 0, '3PT Tend': 1, 'ORB': 2, 'DRB': 0, 'AST': 56}, {'Team': 'Celtics', 'Abbr': 'BOS', 'Pace': 95.7, 'ORtg': 120.6, 'DRtg': 111.1, 'ShotQ': 2, 'DEF': 3, 'TO Press': 1, 'TO Protect': 1, 'Foul Draw': -1, 'Foul Disc': 1, '3PT Tend': 4, 'ORB': -1, 'DRB': 1, 'AST': 62}, {'Team': 'Nuggets', 'Abbr': 'DEN', 'Pace': 99.8, 'ORtg': 119.9, 'DRtg': 116.0, 'ShotQ': 2, 'DEF': -1, 'TO Press': 0, 'TO Protect': 2, 'Foul Draw': 1, 'Foul Disc': -1, '3PT Tend': -1, 'ORB': 0, 'DRB': 0, 'AST': 66}]
PLAYER_ROWS = [['Thunder', 'Shai Gilgeous-Alexander', 27, 8, 15, 26, 55, 37, 90, 35, 2, 8, 18, 6, 7], ['Thunder', 'Jalen Williams', 18, 10, 7, 31, 53, 37, 80, 22, 4, 10, 12, 5, 7], ['Thunder', 'Chet Holmgren', 12, 9, 7, 48, 58, 38, 75, 8, 13, 18, 7, 24, 8], ['Thunder', 'Luguentz Dort', 8, 8, 3, 75, 46, 41, 72, 6, 5, 8, 12, 3, 9], ['Thunder', 'Isaiah Hartenstein', 7, 12, 6, 1, 58, 0, 68, 12, 18, 19, 4, 8, 11], ['Thunder', 'Cason Wallace', 7, 9, 3, 55, 48, 36, 78, 8, 3, 5, 12, 2, 5], ['Thunder', 'Alex Caruso', 5, 11, 3, 60, 50, 35, 82, 10, 3, 6, 14, 2, 6], ['Thunder', 'Isaiah Joe', 7, 6, 2, 80, 45, 41, 80, 4, 1, 3, 6, 1, 3], ['Thunder', 'Aaron Wiggins', 9, 7, 4, 42, 57, 38, 79, 8, 5, 7, 7, 3, 5], ['Knicks', 'Jalen Brunson', 27, 9, 12, 32, 51, 38, 82, 32, 1, 5, 8, 1, 6], ['Knicks', 'Karl-Anthony Towns', 22, 11, 10, 38, 58, 42, 83, 14, 15, 24, 5, 10, 9], ['Knicks', 'Mikal Bridges', 16, 8, 5, 45, 52, 36, 82, 12, 3, 8, 12, 3, 6], ['Knicks', 'OG Anunoby', 15, 9, 5, 48, 54, 37, 78, 8, 5, 9, 13, 4, 8], ['Knicks', 'Josh Hart', 9, 10, 4, 20, 55, 33, 75, 14, 10, 17, 9, 2, 7], ['Knicks', 'Miles McBride', 5, 7, 2, 60, 47, 39, 83, 7, 2, 4, 6, 1, 3], ['Knicks', 'Mitchell Robinson', 4, 13, 8, 0, 65, 0, 55, 2, 20, 18, 5, 16, 8], ['Knicks', 'Precious Achiuwa', 2, 13, 5, 10, 54, 30, 64, 2, 11, 10, 4, 7, 5], ['Celtics', 'Jayson Tatum', 25, 9, 8, 48, 53, 37, 83, 22, 7, 16, 9, 5, 6], ['Celtics', 'Jaylen Brown', 22, 10, 8, 35, 54, 35, 76, 14, 5, 11, 10, 4, 7], ['Celtics', 'Derrick White', 15, 7, 5, 58, 52, 38, 84, 20, 3, 7, 10, 9, 6], ['Celtics', 'Kristaps Porzingis', 14, 9, 9, 44, 59, 40, 82, 7, 9, 15, 4, 18, 8], ['Celtics', 'Jrue Holiday', 9, 8, 3, 55, 52, 36, 83, 18, 4, 8, 14, 3, 6], ['Celtics', 'Payton Pritchard', 7, 6, 2, 65, 49, 41, 84, 12, 3, 5, 7, 1, 4], ['Celtics', 'Al Horford', 4, 7, 2, 70, 55, 36, 80, 8, 5, 11, 5, 8, 7], ['Celtics', 'Sam Hauser', 3, 5, 1, 82, 48, 41, 78, 3, 2, 5, 4, 1, 4], ['Celtics', 'Luke Kornet', 1, 10, 5, 0, 66, 0, 65, 3, 9, 8, 2, 10, 8], ['Nuggets', 'Nikola Jokic', 29, 12, 10, 25, 62, 42, 80, 45, 15, 27, 8, 8, 7], ['Nuggets', 'Jamal Murray', 24, 9, 7, 45, 52, 39, 86, 25, 2, 7, 7, 2, 5], ['Nuggets', 'Michael Porter Jr.', 16, 6, 4, 58, 55, 40, 77, 4, 6, 13, 5, 4, 6], ['Nuggets', 'Aaron Gordon', 12, 9, 8, 20, 60, 34, 70, 12, 10, 11, 6, 5, 8], ['Nuggets', 'Christian Braun', 8, 7, 5, 35, 56, 38, 78, 7, 5, 7, 8, 3, 7], ['Nuggets', 'Russell Westbrook', 6, 13, 9, 22, 50, 32, 66, 20, 5, 10, 9, 2, 7], ['Nuggets', 'Peyton Watson', 3, 10, 4, 32, 51, 31, 68, 4, 4, 6, 5, 10, 7], ['Nuggets', 'Julian Strawther', 2, 8, 3, 70, 46, 36, 80, 3, 2, 3, 3, 1, 3]]
STAT_FIELDS = ["PTS","FGM","FGA","3PM","3PA","FTM","FTA","OREB","DREB","REB","AST","STL","BLK","TOV","PF"]

def build_teams():
    players_by_team = defaultdict(list)
    for r in PLAYER_ROWS:
        p = Player(*r)
        players_by_team[p.team].append(p)
    teams = {}
    for r in TEAM_ROWS:
        teams[r["Team"]] = Team(r["Team"], r["Pace"], r["ORtg"], r["DRtg"], r["ShotQ"], r["DEF"], r["TO Press"], r["TO Protect"], r["Foul Draw"], r["Foul Disc"], r["3PT Tend"], r["ORB"], r["DRB"], r["AST"], players_by_team[r["Team"]])
    return teams

def weighted_choice(players, attr, rng, exclude_name=""):
    total = 0; cumulative = []
    for p in players:
        if p.name == exclude_name: continue
        w = getattr(p, attr)
        if w > 0:
            total += w; cumulative.append((total, p))
    if total <= 0: return None
    r = rng.uniform(0, total)
    for cutoff, p in cumulative:
        if r <= cutoff: return p
    return cumulative[-1][1]

def select_offensive_player(team, rng):
    r = rng.randint(1,100); cumulative=0
    for p in team.players:
        cumulative += p.use
        if r <= cumulative: return p
    return team.players[-1]

def empty_player_stats(team):
    return {p.name: defaultdict(int) for p in team.players}

def resolve_possession(off, deff, off_stats, def_stats, off_team, def_team, rng, params):
    off_team["poss"] += 1
    extensions = 0
    while True:
        if params.nonshoot_foul_chance > 0 and rng.randint(1,100) <= params.nonshoot_foul_chance:
            fouler = weighted_choice(deff.players, "pfw", rng)
            if fouler:
                def_stats[fouler.name]["PF"] += 1; def_team["PF"] += 1; off_team["nonshooting_fouls_drawn"] += 1
        shooter = select_offensive_player(off, rng)
        eff_tov = max(0, round((shooter.tov + deff.to_press - off.to_protect + params.global_tov_mod) * params.tov_scale))
        eff_fd = max(0, round((shooter.fd + off.foul_draw - deff.foul_disc + params.global_fd_mod) * params.fd_scale))
        action_roll = rng.randint(1,100)
        if action_roll <= eff_tov:
            off_stats[shooter.name]["TOV"] += 1; off_team["TOV"] += 1
            if rng.randint(1,100) <= params.steal_turnover_pct:
                stealer = weighted_choice(deff.players, "stlw", rng)
                if stealer: def_stats[stealer.name]["STL"] += 1; def_team["STL"] += 1
            return
        if action_roll <= eff_tov + eff_fd:
            fouler = weighted_choice(deff.players, "pfw", rng)
            if fouler: def_stats[fouler.name]["PF"] += 1; def_team["PF"] += 1
            for _ in range(2):
                off_stats[shooter.name]["FTA"] += 1; off_team["FTA"] += 1
                if rng.randint(1,100) <= shooter.ft:
                    off_stats[shooter.name]["FTM"] += 1; off_stats[shooter.name]["PTS"] += 1; off_team["FTM"] += 1; off_team["PTS"] += 1
            return
        three_chance = min(95, max(0, shooter.three_f + off.three_tend + params.three_mod))
        is_three = rng.randint(1,100) <= three_chance
        def_adj = math.floor(deff.defense / params.defense_shot_divisor)
        if is_three:
            make_num = max(1, min(99, shooter.p3 + off.shotq - def_adj + params.global_shot_mod))
            off_stats[shooter.name]["FGA"] += 1; off_stats[shooter.name]["3PA"] += 1; off_team["FGA"] += 1; off_team["3PA"] += 1
            if rng.randint(1,100) <= make_num:
                off_stats[shooter.name]["FGM"] += 1; off_stats[shooter.name]["3PM"] += 1; off_stats[shooter.name]["PTS"] += 3
                off_team["FGM"] += 1; off_team["3PM"] += 1; off_team["PTS"] += 3
                if rng.randint(1,100) <= max(0, min(95, off.ast + 8 + params.ast_mod)):
                    passer = weighted_choice(off.players, "astw", rng, shooter.name)
                    if passer: off_stats[passer.name]["AST"] += 1; off_team["AST"] += 1
                return
        else:
            make_num = max(1, min(99, shooter.p2 + off.shotq - def_adj + params.global_shot_mod))
            off_stats[shooter.name]["FGA"] += 1; off_team["FGA"] += 1
            if rng.randint(1,100) <= make_num:
                off_stats[shooter.name]["FGM"] += 1; off_stats[shooter.name]["PTS"] += 2; off_team["FGM"] += 1; off_team["PTS"] += 2
                if rng.randint(1,100) <= max(0, min(95, off.ast + params.ast_mod)):
                    passer = weighted_choice(off.players, "astw", rng, shooter.name)
                    if passer: off_stats[passer.name]["AST"] += 1; off_team["AST"] += 1
                return
            if rng.randint(1,100) <= max(0, min(40, params.block_base + deff.defense)):
                blocker = weighted_choice(deff.players, "blkw", rng)
                if blocker: def_stats[blocker.name]["BLK"] += 1; def_team["BLK"] += 1
        # rebound
        orb_chance = max(5, min(45, params.orb_base + off.orb - deff.drb))
        if rng.randint(1,100) <= orb_chance and extensions < params.max_orb_extensions:
            rebounder = weighted_choice(off.players, "orbw", rng)
            if rebounder: off_stats[rebounder.name]["OREB"] += 1; off_team["OREB"] += 1
            extensions += 1; continue
        rebounder = weighted_choice(deff.players, "drbw", rng)
        if rebounder: def_stats[rebounder.name]["DREB"] += 1; def_team["DREB"] += 1
        return

def quarter_split(poss_each):
    q = [poss_each // 4] * 4
    for i in range(poss_each % 4): q[i] += 1
    return q

def simulate_game(away, home, params, seed=0):
    rng = random.Random(seed)
    poss_each = round((away.pace + home.pace) / 2)
    qposs = quarter_split(poss_each)
    a_stats = empty_player_stats(away); h_stats = empty_player_stats(home)
    a_team = defaultdict(int); h_team = defaultdict(int); quarters=[]
    for poss in qposs:
        a_before = a_team["PTS"]; h_before = h_team["PTS"]
        for _ in range(poss):
            resolve_possession(away, home, a_stats, h_stats, a_team, h_team, rng, params)
            resolve_possession(home, away, h_stats, a_stats, h_team, a_team, rng, params)
        quarters.append((a_team["PTS"]-a_before, h_team["PTS"]-h_before))
    for stats in (a_stats, h_stats):
        for s in stats.values(): s["REB"] = s["OREB"] + s["DREB"]
    winner = away.name if a_team["PTS"] > h_team["PTS"] else home.name if h_team["PTS"] > a_team["PTS"] else "Tie"
    return {"teams": {away.name: dict(a_team), home.name: dict(h_team)}, "players": {away.name: a_stats, home.name: h_stats}, "quarters": quarters, "poss_each": poss_each, "winner": winner}

def pct(num, den): return (num/den) if den else 0.0

def team_row(team_name, ts):
    return {"team": team_name, "PTS": ts.get("PTS",0), "poss": ts.get("poss",0), "ORtg": round(ts.get("PTS",0)*100/ts.get("poss",1),2), "FGM": ts.get("FGM",0), "FGA": ts.get("FGA",0), "FG%": round(pct(ts.get("FGM",0),ts.get("FGA",0)),3), "3PM": ts.get("3PM",0), "3PA": ts.get("3PA",0), "3P%": round(pct(ts.get("3PM",0),ts.get("3PA",0)),3), "FTM": ts.get("FTM",0), "FTA": ts.get("FTA",0), "FT%": round(pct(ts.get("FTM",0),ts.get("FTA",0)),3), "OREB": ts.get("OREB",0), "DREB": ts.get("DREB",0), "REB": ts.get("OREB",0)+ts.get("DREB",0), "AST": ts.get("AST",0), "STL": ts.get("STL",0), "BLK": ts.get("BLK",0), "TOV": ts.get("TOV",0), "PF": ts.get("PF",0), "nonshooting_fouls_drawn": ts.get("nonshooting_fouls_drawn",0)}

def write_csv(path, rows, fieldnames):
    with open(path, "w", newline="") as f:
        w=csv.DictWriter(f, fieldnames=fieldnames); w.writeheader(); w.writerows(rows)

def print_table(rows, columns):
    widths = {c: max(len(c), *(len(str(r.get(c,""))) for r in rows)) for c in columns}
    print(" | ".join(c.ljust(widths[c]) for c in columns)); print("-+-".join("-"*widths[c] for c in columns))
    for r in rows: print(" | ".join(str(r.get(c,"")).ljust(widths[c]) for c in columns))

def summarize_games(away, home, params, games, seed):
    rng = random.Random(seed); team_values=defaultdict(lambda: defaultdict(list)); player_values=defaultdict(lambda: defaultdict(lambda: defaultdict(list))); win_counts=Counter()
    for _ in range(games):
        result=simulate_game(away, home, params, seed=rng.randint(1,10**9)); win_counts[result["winner"]]+=1
        for team_name, ts in result["teams"].items():
            row=team_row(team_name,ts)
            for k,v in row.items():
                if k != "team": team_values[team_name][k].append(v)
        for team_name, player_stats in result["players"].items():
            for player_name, st in player_stats.items():
                for field in STAT_FIELDS: player_values[team_name][player_name][field].append(st.get(field,0))
    team_summary=[]
    for team_name in sorted(team_values.keys()):
        row={"team": team_name}
        for stat in ["PTS","poss","ORtg","FGM","FGA","FG%","3PM","3PA","3P%","FTM","FTA","FT%","OREB","DREB","REB","AST","STL","BLK","TOV","PF"]:
            row[stat]=round(statistics.mean(team_values[team_name][stat]),2)
        team_summary.append(row)
    player_summary=[]
    for team_name in sorted(player_values.keys()):
        for player_name in sorted(player_values[team_name].keys()):
            row={"team": team_name, "player": player_name}
            for stat in STAT_FIELDS: row[stat]=round(statistics.mean(player_values[team_name][player_name][stat]),2)
            player_summary.append(row)
    return team_summary, player_summary, win_counts

def export_cards(outdir):
    os.makedirs(outdir, exist_ok=True)
    with open(os.path.join(outdir,"team_cards.csv"),"w",newline="") as f:
        fields=list(TEAM_ROWS[0].keys()); w=csv.DictWriter(f,fieldnames=fields); w.writeheader(); w.writerows(TEAM_ROWS)
    with open(os.path.join(outdir,"player_cards.csv"),"w",newline="") as f:
        w=csv.writer(f); w.writerow(["Team","Player","Use","TOV","FD","3F","2P","3P","FT","ASTw","OREBw","DREBw","STLw","BLKw","PFw"]); w.writerows(PLAYER_ROWS)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--away", default="Thunder")
    parser.add_argument("--home", default="Knicks")
    parser.add_argument("--games", type=int, default=10000)
    parser.add_argument("--seed", type=int, default=777)
    parser.add_argument("--sample-seed", type=int, default=18)
    parser.add_argument("--outdir", default="sim_output")
    parser.add_argument("--list-teams", action="store_true")
    parser.add_argument("--export-cards", action="store_true")
    args=parser.parse_args()
    teams=build_teams()
    if args.list_teams:
        print("Teams:", ", ".join(sorted(teams.keys()))); return
    if args.away not in teams or args.home not in teams:
        raise SystemExit(f"Unknown team. Available: {', '.join(sorted(teams.keys()))}")
    if args.away == args.home: raise SystemExit("Away and home teams must be different.")
    away=teams[args.away]; home=teams[args.home]; params=SimParams(); os.makedirs(args.outdir,exist_ok=True)
    if args.export_cards: export_cards(args.outdir)
    sample=simulate_game(away,home,params,seed=args.sample_seed)
    print("\nSAMPLE GAME\n===========")
    print(f"{away.name} {sample['teams'][away.name].get('PTS',0)} at {home.name} {sample['teams'][home.name].get('PTS',0)}")
    print(f"Possessions per team: {sample['poss_each']}")
    print("Quarter scores:")
    for idx,(a,h) in enumerate(sample["quarters"],start=1): print(f"  Q{idx}: {away.name} {a}, {home.name} {h}")
    sample_team_rows=[team_row(name,sample["teams"][name]) for name in [away.name,home.name]]
    sample_team_fields=["team","PTS","poss","ORtg","FGM","FGA","FG%","3PM","3PA","3P%","FTM","FTA","FT%","OREB","DREB","REB","AST","STL","BLK","TOV","PF","nonshooting_fouls_drawn"]
    write_csv(os.path.join(args.outdir,"sample_game_team_totals.csv"),sample_team_rows,sample_team_fields)
    sample_box=[]
    for team_name in [away.name,home.name]:
        for p in teams[team_name].players:
            st=sample["players"][team_name][p.name]; row={"team":team_name,"player":p.name}
            for field in STAT_FIELDS: row[field]=st.get(field,0)
            sample_box.append(row)
    write_csv(os.path.join(args.outdir,"sample_game_boxscore.csv"),sample_box,["team","player"]+STAT_FIELDS)
    print("\nSample team totals:"); print_table(sample_team_rows,["team","PTS","FGA","3PA","FTA","OREB","DREB","AST","STL","BLK","TOV","PF"])
    print(f"\nRunning {args.games:,} simulations...")
    team_summary, player_summary, win_counts=summarize_games(away,home,params,args.games,args.seed)
    write_csv(os.path.join(args.outdir,"team_summary.csv"),team_summary,["team","PTS","poss","ORtg","FGM","FGA","FG%","3PM","3PA","3P%","FTM","FTA","FT%","OREB","DREB","REB","AST","STL","BLK","TOV","PF"])
    write_csv(os.path.join(args.outdir,"player_averages.csv"),player_summary,["team","player"]+STAT_FIELDS)
    print("\nBULK SIM TEAM AVERAGES\n======================")
    print_table(team_summary,["team","PTS","ORtg","FGA","FG%","3PA","3P%","FTA","OREB","DREB","AST","TOV","STL","BLK","PF"])
    total=sum(win_counts.values())
    print("\nWin rates:")
    for team_name,wins in win_counts.most_common(): print(f"  {team_name}: {wins/total:.1%} ({wins}/{total})")
    print(f"\nCSV output written to: {os.path.abspath(args.outdir)}")
if __name__ == "__main__": main()
