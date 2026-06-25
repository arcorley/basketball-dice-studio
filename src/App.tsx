import {
  BarChart3,
  BookOpen,
  CalendarDays,
  Download,
  FileText,
  Play,
  Printer,
  RotateCcw,
  Trophy
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { buildMatchupCard, createManualResult, nRange, simulateGame, summarizeSimulations } from "./lib/diceEngine";
import { aggregatePlayerStats, aggregateTeamStats, createLeague, markUnplayed, setManualLeagueResult, simulateLeagueGame, standings } from "./lib/league";
import { exportScoresheetsPdf } from "./lib/pdfExport";
import { diceTeams, formatNumber, formatPct, getTeam, sourceData } from "./lib/sourceData";
import { derivationNotes } from "./lib/teamCards";
import { loadLeague, saveLeague } from "./lib/storage";
import type { DiceTeamCard, GameResult, LeagueGame, LeagueState, MatchupCard, StatLine } from "./lib/types";

type Tab = "library" | "matchup" | "sim" | "league" | "leaders";
type PrintTarget = "card" | "scoresheets" | null;

const statColumns = ["PTS", "REB", "AST", "STL", "BLK", "TOV", "PF"];

function teamName(teamId: string): string {
  return getTeam(teamId).shortName;
}

function round(value: number | undefined, digits = 1): string {
  if (value === undefined || Number.isNaN(value)) return "-";
  return value.toFixed(digits);
}

function pct(num: number, den: number): string {
  return den ? `${((num / den) * 100).toFixed(1)}%` : "-";
}

function modifier(value: number | undefined, digits = 2): string {
  if (value === undefined || Number.isNaN(value)) return "-";
  return value.toFixed(digits);
}

function shotAdjustmentLabel(value: number): string {
  const rounded = Math.abs(value).toFixed(1);
  return value >= 0 ? `-${rounded}` : `+${rounded}`;
}

function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode; variant?: "primary" | "subtle" | "danger" }) {
  const { icon, children, variant = "subtle", className = "", ...rest } = props;
  return (
    <button type="button" className={`btn ${variant} ${className}`} {...rest}>
      {icon}
      <span>{children}</span>
    </button>
  );
}

function App() {
  const [tab, setTab] = useState<Tab>("library");
  const [awayId, setAwayId] = useState(diceTeams[0].id);
  const [homeId, setHomeId] = useState(diceTeams[1].id);
  const [selectedTeamId, setSelectedTeamId] = useState(diceTeams[0].id);
  const [printTarget, setPrintTarget] = useState<PrintTarget>(null);
  const [league, setLeague] = useState<LeagueState | null>(() => loadLeague());

  useEffect(() => saveLeague(league), [league]);

  useEffect(() => {
    const reset = () => setPrintTarget(null);
    window.addEventListener("afterprint", reset);
    return () => window.removeEventListener("afterprint", reset);
  }, []);

  const away = getTeam(awayId);
  const home = getTeam(homeId);
  const matchup = useMemo(() => buildMatchupCard(away, home), [away, home]);

  const print = (target: PrintTarget) => {
    setPrintTarget(target);
    window.setTimeout(() => window.print(), 80);
  };

  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
    { id: "library", label: "Library", icon: <BookOpen size={18} /> },
    { id: "matchup", label: "Matchup", icon: <FileText size={18} /> },
    { id: "sim", label: "Simulator", icon: <Play size={18} /> },
    { id: "league", label: "League", icon: <CalendarDays size={18} /> },
    { id: "leaders", label: "Leaders", icon: <Trophy size={18} /> }
  ];

  return (
    <>
      <div className="app screen-only">
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-mark">BD</div>
            <div>
              <h1>Basketball Dice Studio</h1>
              <p>v0.6 source-backed local app</p>
            </div>
          </div>
          <nav className="nav">
            {tabs.map((item) => (
              <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="source-box">
            <strong>{sourceData.sourceProvider}</strong>
            <span>{diceTeams.length} teams</span>
            <span>Generated {new Date(sourceData.generatedAt).toLocaleString()}</span>
          </div>
        </aside>

        <main className="workspace">
          {tab === "library" && <Library selectedTeamId={selectedTeamId} setSelectedTeamId={setSelectedTeamId} />}
          {tab === "matchup" && (
            <MatchupStudio
              awayId={awayId}
              homeId={homeId}
              setAwayId={setAwayId}
              setHomeId={setHomeId}
              matchup={matchup}
              onPrint={print}
            />
          )}
          {tab === "sim" && <Simulator awayId={awayId} homeId={homeId} setAwayId={setAwayId} setHomeId={setHomeId} />}
          {tab === "league" && <LeagueView league={league} setLeague={setLeague} />}
          {tab === "leaders" && <Leaders league={league} />}
        </main>
      </div>

      <div className={`print-root ${printTarget === "card" ? "active" : ""}`}>
        <PrintableGameCard matchup={matchup} />
      </div>
      <div className={`print-root ${printTarget === "scoresheets" ? "active" : ""}`}>
        <PrintableScoresheets matchup={matchup} />
      </div>
    </>
  );
}

function Library({ selectedTeamId, setSelectedTeamId }: { selectedTeamId: string; setSelectedTeamId: (id: string) => void }) {
  const selected = getTeam(selectedTeamId);
  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h2>Team Library</h2>
          <p>Source-derived team and player cards. Full raw tables stay cached for audit and recalibration.</p>
        </div>
      </header>

      <div className="library-layout">
        <div className="team-list">
          {diceTeams.map((team) => (
            <button key={team.id} className={team.id === selectedTeamId ? "team-row active" : "team-row"} onClick={() => setSelectedTeamId(team.id)}>
              <span>
                <strong>{team.shortName}</strong>
                <small>{team.source.franchise}</small>
              </span>
              <span className="record">
                {team.source.team.wins}-{team.source.team.losses}
              </span>
            </button>
          ))}
        </div>

        <article className="panel">
          <div className="panel-title">
            <div>
              <h3>{selected.name}</h3>
              <p>
                <a href={selected.source.source.url} target="_blank" rel="noreferrer">
                  {selected.source.source.provider}
                </a>
                {" "}tables: {selected.source.source.tableIds.length}
              </p>
            </div>
            <span className="badge">{selected.abbr}</span>
          </div>

          <MetricGrid
            metrics={[
              ["Pace", formatNumber(selected.pace)],
              ["ORtg", formatNumber(selected.offensiveRating)],
              ["DRtg", formatNumber(selected.defensiveRating)],
              ["ShotQ", modifier(selected.shotQuality)],
              ["DEF", modifier(selected.defense)],
              ["3PT Tend", modifier(selected.threeTendency)],
              ["AST 2/3", `${nRange(selected.assistMade2)} / ${nRange(selected.assistMade3)}`],
              ["Rotation", selected.players.length]
            ]}
          />

          <h4>Derived Rotation Cards</h4>
          {(() => {
            const totalUseWeight = selected.players.reduce((sum, player) => sum + player.useWeight, 0);
            return (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Pos</th>
                  <th>Min</th>
                  <th>Use %</th>
                  <th>TOV</th>
                  <th>FD</th>
                  <th>3F</th>
                  <th>2P</th>
                  <th>3P</th>
                  <th>FT</th>
                  <th>And-1</th>
                  <th>ASTw</th>
                  <th>REBw</th>
                </tr>
              </thead>
              <tbody>
                {selected.players.map((player) => (
                  <tr key={player.id}>
                    <td>{player.name}</td>
                    <td>{player.position}</td>
                    <td>{Math.round(player.minutes)}</td>
                    <td>{((player.useWeight / totalUseWeight) * 100).toFixed(1)}</td>
                    <td>{modifier(player.tov, 1)}</td>
                    <td>{modifier(player.fd, 1)}</td>
                    <td>{modifier(player.threeFrequency, 1)}</td>
                    <td>{modifier(player.p2, 1)}</td>
                    <td>{modifier(player.p3, 1)}</td>
                    <td>{modifier(player.ft, 1)}</td>
                    <td>{modifier(player.andOneChance, 1)}</td>
                    <td>{modifier(player.astWeight, 1)}</td>
                    <td>{modifier(player.orbWeight + player.drbWeight, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
            );
          })()}

          <details className="notes">
            <summary>Derivation notes</summary>
            {derivationNotes.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </details>

          <h4>Source Table Coverage</h4>
          <div className="chip-row">
            {selected.source.rawTableSummary
              .filter((table) => table.id)
              .map((table) => (
                <span className="chip" key={table.id}>
                  {table.id}: {table.rows}
                </span>
              ))}
          </div>
        </article>
      </div>
    </section>
  );
}

function MatchupStudio({
  awayId,
  homeId,
  setAwayId,
  setHomeId,
  matchup,
  onPrint
}: {
  awayId: string;
  homeId: string;
  setAwayId: (id: string) => void;
  setHomeId: (id: string) => void;
  matchup: MatchupCard;
  onPrint: (target: PrintTarget) => void;
}) {
  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h2>Matchup Card</h2>
          <p>All static calculations are precomputed before tabletop play.</p>
        </div>
        <div className="actions">
          <Button icon={<Printer size={16} />} onClick={() => onPrint("card")} variant="primary">
            Print Card
          </Button>
          <Button icon={<Printer size={16} />} onClick={() => onPrint("scoresheets")}>
            Print Scoresheets
          </Button>
          <Button data-testid="export-scoresheets-pdf" icon={<Download size={16} />} onClick={() => void exportScoresheetsPdf(matchup)}>
            Export Sheets PDF
          </Button>
        </div>
      </header>

      <TeamSelectors awayId={awayId} homeId={homeId} setAwayId={setAwayId} setHomeId={setHomeId} />
      <ScreenGameCard matchup={matchup} />
    </section>
  );
}

function TeamSelectors({
  awayId,
  homeId,
  setAwayId,
  setHomeId
}: {
  awayId: string;
  homeId: string;
  setAwayId: (id: string) => void;
  setHomeId: (id: string) => void;
}) {
  return (
    <div className="selector-row">
      <label>
        Away
        <select value={awayId} onChange={(event) => setAwayId(event.target.value)}>
          {diceTeams.map((team) => (
            <option key={team.id} value={team.id} disabled={team.id === homeId}>
              {team.shortName}
            </option>
          ))}
        </select>
      </label>
      <label>
        Home
        <select value={homeId} onChange={(event) => setHomeId(event.target.value)}>
          {diceTeams.map((team) => (
            <option key={team.id} value={team.id} disabled={team.id === awayId}>
              {team.shortName}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function ScreenGameCard({ matchup }: { matchup: MatchupCard }) {
  return (
    <div className="card-preview">
      <PrintableGameCard matchup={matchup} />
    </div>
  );
}

function PrintableGameCard({ matchup }: { matchup: MatchupCard }) {
  return (
    <section className="print-page game-card">
      <h2>
        {matchup.away.shortName} at {matchup.home.shortName}
      </h2>
      <div className="print-grid two">
        <table>
          <tbody>
            <tr>
              <th>Possessions per team</th>
              <td>{matchup.possessionsEach}</td>
            </tr>
            <tr>
              <th>Quarter split</th>
              <td>
                Q1 {matchup.quarters[0]} / Q2 {matchup.quarters[1]} / Q3 {matchup.quarters[2]} / Q4 {matchup.quarters[3]}
              </td>
            </tr>
            <tr>
              <th>Loose foul check</th>
              <td>{matchup.looseFoulRange}</td>
            </tr>
            <tr>
              <th>Steal on turnover</th>
              <td>{matchup.stealOnTurnoverRange}</td>
            </tr>
          </tbody>
        </table>
        <table>
          <thead>
            <tr>
              <th>Offense</th>
              <th>ORB</th>
              <th>BLK</th>
              <th>Foul End</th>
              <th>AST 2</th>
              <th>AST 3</th>
              <th>Def Adj</th>
            </tr>
          </thead>
          <tbody>
            {[matchup.awayStatic, matchup.homeStatic].map((row) => (
              <tr key={row.offense}>
                <td>{teamName(row.offense)}</td>
                <td>{row.ranges.orb}</td>
                <td>{row.ranges.block}</td>
                <td>{row.ranges.foulEndsPossession}</td>
                <td>{row.ranges.ast2}</td>
                <td>{row.ranges.ast3}</td>
                <td>{shotAdjustmentLabel(row.defenseShotAdjustment)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <PlayerRangesTable title={`${matchup.away.shortName} offense vs ${matchup.home.shortName} defense`} rows={matchup.awayPlayerRanges} />
      <PlayerRangesTable title={`${matchup.home.shortName} offense vs ${matchup.away.shortName} defense`} rows={matchup.homePlayerRanges} />

      <div className="print-break" />
      <h2>Assignment Matrix</h2>
      {[matchup.away, matchup.home].map((team) => (
        <AssignmentMatrix key={team.id} team={team} matchup={matchup} />
      ))}
    </section>
  );
}

function PlayerRangesTable({ title, rows }: { title: string; rows: MatchupCard["awayPlayerRanges"] }) {
  return (
    <>
      <h3>{title}</h3>
      <table>
        <thead>
          <tr>
            <th>Player</th>
            <th>Use</th>
            <th>TOV</th>
            <th>Foul</th>
            <th>Shot</th>
            <th>3PA?</th>
            <th>2P Make</th>
            <th>3P Make</th>
            <th>FT</th>
            <th>And-1</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.player}>
              <td>{row.player}</td>
              <td>{row.use}</td>
              <td>{row.tov}</td>
              <td>{row.foul}</td>
              <td>{row.shot}</td>
              <td>{row.three}</td>
              <td>{row.p2}</td>
              <td>{row.p3}</td>
              <td>{row.ft}</td>
              <td>{row.andOne}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function AssignmentMatrix({ team, matchup }: { team: DiceTeamCard; matchup: MatchupCard }) {
  const events = ["Use", "AST", "OREB", "DREB", "STL", "BLK", "PF"] as const;
  return (
    <>
      <h3>{team.shortName}</h3>
      <table>
        <thead>
          <tr>
            <th>Player</th>
            {events.map((event) => (
              <th key={event}>{event}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {team.players.map((player) => (
            <tr key={player.id}>
              <td>{player.name}</td>
              {events.map((event) => (
                <td key={event}>{matchup.assignments[team.id][event].find((row) => row.label === player.name)?.range ?? "-"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function PrintableScoresheets({ matchup }: { matchup: MatchupCard }) {
  return (
    <section className="print-page scoresheets">
      {[matchup.away, matchup.home].map((team) => (
        <div className="scoresheet" key={team.id}>
          <h2>{team.shortName} Scoresheet</h2>
          <div className="score-meta">
            <span>Opponent: {team.id === matchup.away.id ? matchup.home.shortName : matchup.away.shortName}</span>
            <span>Q1 {matchup.quarters[0]}</span>
            <span>Q2 {matchup.quarters[1]}</span>
            <span>Q3 {matchup.quarters[2]}</span>
            <span>Q4 {matchup.quarters[3]}</span>
            <span>Total poss {matchup.possessionsEach}</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Player</th>
                <th>PTS</th>
                <th>FGM</th>
                <th>FGA</th>
                <th>3PM</th>
                <th>3PA</th>
                <th>FTM</th>
                <th>FTA</th>
                <th>OREB</th>
                <th>DREB</th>
                <th>AST</th>
                <th>STL</th>
                <th>BLK</th>
                <th>TOV</th>
                <th>PF</th>
              </tr>
            </thead>
            <tbody>
              {team.players.map((player) => (
                <tr key={player.id}>
                  <td>{player.name}</td>
                  {Array.from({ length: 14 }).map((_, index) => (
                    <td key={index} className="tally-cell" />
                  ))}
                </tr>
              ))}
              <tr>
                <td>Team</td>
                {Array.from({ length: 14 }).map((_, index) => (
                  <td key={index} className="tally-cell" />
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}

function Simulator({
  awayId,
  homeId,
  setAwayId,
  setHomeId
}: {
  awayId: string;
  homeId: string;
  setAwayId: (id: string) => void;
  setHomeId: (id: string) => void;
}) {
  const [result, setResult] = useState<GameResult | null>(null);
  const [bulkGames, setBulkGames] = useState(500);
  const [bulk, setBulk] = useState<ReturnType<typeof summarizeSimulations> | null>(null);
  const away = getTeam(awayId);
  const home = getTeam(homeId);

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h2>Simulator</h2>
          <p>Runs the full possession engine using source-derived matchup cards.</p>
        </div>
        <div className="actions">
          <Button icon={<Play size={16} />} variant="primary" onClick={() => setResult(simulateGame(away, home))}>
            Sim One
          </Button>
          <Button icon={<BarChart3 size={16} />} onClick={() => setBulk(summarizeSimulations(away, home, bulkGames))}>
            Sim Many
          </Button>
        </div>
      </header>

      <TeamSelectors awayId={awayId} homeId={homeId} setAwayId={setAwayId} setHomeId={setHomeId} />
      <label className="inline-input">
        Bulk games
        <input type="number" min={1} max={10000} value={bulkGames} onChange={(event) => setBulkGames(Number(event.target.value))} />
      </label>

      {result && <ResultPanel result={result} />}
      {bulk && (
        <article className="panel">
          <h3>{bulk.games.toLocaleString()} Game Summary</h3>
          <div className="metric-grid">
            {[away, home].map((team) => (
              <div className="metric" key={team.id}>
                <span>{team.shortName} win rate</span>
                <strong>{pct(bulk.wins[team.id] ?? 0, bulk.games)}</strong>
              </div>
            ))}
            <div className="metric">
              <span>Tie rate</span>
              <strong>{pct(bulk.wins.tie ?? 0, bulk.games)}</strong>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Team</th>
                  <th>PTS</th>
                  <th>FGA</th>
                  <th>3PA</th>
                  <th>FTA</th>
                  <th>REB</th>
                  <th>AST</th>
                  <th>STL</th>
                  <th>BLK</th>
                  <th>TOV</th>
                </tr>
              </thead>
              <tbody>
                {[away, home].map((team) => (
                  <tr key={team.id}>
                    <td>{team.shortName}</td>
                    {["PTS", "FGA", "3PA", "FTA", "REB", "AST", "STL", "BLK", "TOV"].map((field) => (
                      <td key={field}>{round(bulk.teams[team.id][field])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      )}
    </section>
  );
}

function ResultPanel({ result }: { result: GameResult }) {
  const away = getTeam(result.awayTeamId);
  const home = getTeam(result.homeTeamId);
  return (
    <article className="panel">
      <div className="scoreline">
        <strong>
          {away.shortName} {result.awayScore}
        </strong>
        <span>at</span>
        <strong>
          {home.shortName} {result.homeScore}
        </strong>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th>Team</th>
              {["PTS", "REB", "AST", "STL", "BLK", "TOV", "PF"].map((field) => (
                <th key={field}>{field}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[away, home].flatMap((team) =>
              Object.entries(result.playerStats[team.id]).map(([player, line]) => (
                <tr key={`${team.id}:${player}`}>
                  <td>{player}</td>
                  <td>{team.shortName}</td>
                  {["PTS", "REB", "AST", "STL", "BLK", "TOV", "PF"].map((field) => (
                    <td key={field}>{line[field] ?? 0}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function LeagueView({ league, setLeague }: { league: LeagueState | null; setLeague: (league: LeagueState | null) => void }) {
  const [name, setName] = useState("Studio League");
  const [selected, setSelected] = useState<string[]>(diceTeams.slice(0, 4).map((team) => team.id));
  const [manualGame, setManualGame] = useState<LeagueGame | null>(null);

  const toggle = (teamId: string) => {
    setSelected((current) => (current.includes(teamId) ? current.filter((id) => id !== teamId) : [...current, teamId]));
  };

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h2>Season League</h2>
          <p>Create a small double round-robin, then mark games simulated, manual, or unplayed.</p>
        </div>
        {league && (
          <Button icon={<RotateCcw size={16} />} variant="danger" onClick={() => setLeague(null)}>
            Reset League
          </Button>
        )}
      </header>

      {!league ? (
        <article className="panel">
          <div className="form-row">
            <label>
              League name
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
          </div>
          <div className="team-check-grid">
            {diceTeams.map((team) => (
              <label key={team.id} className="check-card">
                <input type="checkbox" checked={selected.includes(team.id)} onChange={() => toggle(team.id)} />
                <span>
                  <strong>{team.shortName}</strong>
                  <small>
                    {team.source.team.wins}-{team.source.team.losses}
                  </small>
                </span>
              </label>
            ))}
          </div>
          <Button icon={<CalendarDays size={16} />} variant="primary" disabled={selected.length < 2} onClick={() => setLeague(createLeague(name, selected))}>
            Create Schedule
          </Button>
        </article>
      ) : (
        <>
          <StandingsTable league={league} />
          <article className="panel">
            <h3>Schedule</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Game</th>
                    <th>Status</th>
                    <th>Score</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {league.games.map((game) => (
                    <tr key={game.id}>
                      <td>
                        {teamName(game.awayTeamId)} at {teamName(game.homeTeamId)}
                      </td>
                      <td>
                        <span className={`status ${game.status}`}>{game.status}</span>
                      </td>
                      <td>{game.result ? `${game.result.awayScore}-${game.result.homeScore}` : "-"}</td>
                      <td className="row-actions">
                        <Button data-testid={`sim-${game.id}`} icon={<Play size={14} />} onClick={() => setLeague(simulateLeagueGame(league, game.id))}>
                          Sim
                        </Button>
                        <Button
                          data-testid={`manual-${game.id}`}
                          icon={<FileText size={14} />}
                          onMouseDown={() => setManualGame(game)}
                          onClick={() => setManualGame(game)}
                        >
                          Manual
                        </Button>
                        <Button data-testid={`unplayed-${game.id}`} icon={<RotateCcw size={14} />} onClick={() => setLeague(markUnplayed(league, game.id))}>
                          Unplayed
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
          {manualGame && <ManualResultForm game={manualGame} league={league} setLeague={setLeague} onClose={() => setManualGame(null)} />}
        </>
      )}
    </section>
  );
}

function ManualResultForm({
  game,
  league,
  setLeague,
  onClose
}: {
  game: LeagueGame;
  league: LeagueState;
  setLeague: (league: LeagueState) => void;
  onClose: () => void;
}) {
  const away = getTeam(game.awayTeamId);
  const home = getTeam(game.homeTeamId);
  const [awayScore, setAwayScore] = useState(game.result?.awayScore ?? 0);
  const [homeScore, setHomeScore] = useState(game.result?.homeScore ?? 0);
  const [playerInputs, setPlayerInputs] = useState<Record<string, Record<string, number>>>({});

  const update = (team: DiceTeamCard, player: string, field: string, value: number) => {
    const key = `${team.id}:${player}`;
    setPlayerInputs((current) => ({
      ...current,
      [key]: {
        ...(current[key] ?? {}),
        [field]: value
      }
    }));
  };

  const submit = () => {
    const result = createManualResult(away, home, awayScore, homeScore);
    for (const team of [away, home]) {
      const teamLine: StatLine = result.teamStats[team.id];
      for (const player of team.players) {
        const key = `${team.id}:${player.name}`;
        const input = playerInputs[key] ?? {};
        const line = result.playerStats[team.id][player.name];
        for (const field of statColumns) {
          line[field] = input[field] ?? 0;
          teamLine[field] = (teamLine[field] ?? 0) + line[field];
        }
      }
      teamLine.PTS = team.id === away.id ? awayScore : homeScore;
    }
    setLeague(setManualLeagueResult(league, game.id, result));
    onClose();
  };

  return (
    <article className="panel manual-panel">
      <div className="panel-title">
        <h3>
          Manual Result: {away.shortName} at {home.shortName}
        </h3>
        <Button onClick={onClose}>Close</Button>
      </div>
      <div className="score-inputs">
        <label>
          {away.shortName}
          <input data-testid="manual-away-score" type="number" value={awayScore} onChange={(event) => setAwayScore(Number(event.target.value))} />
        </label>
        <label>
          {home.shortName}
          <input data-testid="manual-home-score" type="number" value={homeScore} onChange={(event) => setHomeScore(Number(event.target.value))} />
        </label>
      </div>
      {[away, home].map((team) => (
        <div key={team.id}>
          <h4>{team.shortName} player stats</h4>
          <div className="manual-grid">
            <div className="manual-head">Player</div>
            {statColumns.map((field) => (
              <div className="manual-head" key={field}>
                {field}
              </div>
            ))}
            {team.players.map((player) => (
              <ManualPlayerRow key={player.id} team={team} player={player.name} update={update} />
            ))}
          </div>
        </div>
      ))}
      <Button data-testid="save-manual-result" icon={<FileText size={16} />} variant="primary" onMouseDown={submit} onClick={submit}>
        Save Manual Result
      </Button>
    </article>
  );
}

function ManualPlayerRow({ team, player, update }: { team: DiceTeamCard; player: string; update: (team: DiceTeamCard, player: string, field: string, value: number) => void }) {
  return (
    <>
      <div className="manual-player">{player}</div>
      {statColumns.map((field) => (
        <input key={field} type="number" min={0} defaultValue={0} onChange={(event) => update(team, player, field, Number(event.target.value))} />
      ))}
    </>
  );
}

function StandingsTable({ league }: { league: LeagueState }) {
  return (
    <article className="panel">
      <h3>{league.name} Standings</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Team</th>
              <th>W</th>
              <th>L</th>
              <th>T</th>
              <th>Pct</th>
              <th>PF</th>
              <th>PA</th>
              <th>Diff</th>
            </tr>
          </thead>
          <tbody>
            {standings(league).map((row) => (
              <tr key={row.teamId}>
                <td>{teamName(row.teamId)}</td>
                <td>{row.wins}</td>
                <td>{row.losses}</td>
                <td>{row.ties}</td>
                <td>{row.winPct.toFixed(3)}</td>
                <td>{row.pointsFor}</td>
                <td>{row.pointsAgainst}</td>
                <td>{row.differential}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function Leaders({ league }: { league: LeagueState | null }) {
  if (!league) {
    return (
      <section className="page">
        <header className="page-header">
          <div>
            <h2>Leaders</h2>
            <p>Create a league and play or simulate games to populate standings and leaders.</p>
          </div>
        </header>
      </section>
    );
  }

  const teamStats = aggregateTeamStats(league);
  const playerStats = aggregatePlayerStats(league);
  const played = league.games.filter((game) => game.result).length;

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h2>Leaders</h2>
          <p>{played} games completed in the current local league.</p>
        </div>
      </header>
      <div className="leaders-layout">
        <article className="panel">
          <h3>Team Leaders</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Team</th>
                  <th>GP</th>
                  <th>PPG</th>
                  <th>RPG</th>
                  <th>APG</th>
                  <th>SPG</th>
                  <th>BPG</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(teamStats)
                  .sort(([, a], [, b]) => (b.PTS ?? 0) / Math.max(1, b.games) - (a.PTS ?? 0) / Math.max(1, a.games))
                  .map(([teamId, line]) => (
                    <tr key={teamId}>
                      <td>{teamName(teamId)}</td>
                      <td>{line.games}</td>
                      {["PTS", "REB", "AST", "STL", "BLK"].map((field) => (
                        <td key={field}>{round((line[field] ?? 0) / Math.max(1, line.games))}</td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </article>
        <article className="panel">
          <h3>Player Leaders</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Team</th>
                  <th>GP</th>
                  <th>PTS</th>
                  <th>REB</th>
                  <th>AST</th>
                  <th>STL</th>
                  <th>BLK</th>
                </tr>
              </thead>
              <tbody>
                {playerStats.slice(0, 30).map((row) => (
                  <tr key={`${row.teamId}:${row.player}`}>
                    <td>{row.player}</td>
                    <td>{teamName(row.teamId)}</td>
                    <td>{row.games}</td>
                    {["PTS", "REB", "AST", "STL", "BLK"].map((field) => (
                      <td key={field}>{round(row.perGame[field])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </div>
    </section>
  );
}

function MetricGrid({ metrics }: { metrics: Array<[string, React.ReactNode]> }) {
  return (
    <div className="metric-grid">
      {metrics.map(([label, value]) => (
        <div className="metric" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
