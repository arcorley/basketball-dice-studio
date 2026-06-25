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
import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { buildMatchupCard, createManualResult, defaultMatchupOptions, nRange, simulateGame, summarizeSimulations } from "./lib/diceEngine";
import { aggregatePlayerStats, aggregateTeamStats, createLeague, markUnplayed, setManualLeagueResult, simulateLeagueGameWithTeams, standings } from "./lib/league";
import { exportScoresheetsPdf } from "./lib/pdfExport";
import { formatNumber, formatPct, loadDiceTeam, loadSourceCatalog } from "./lib/sourceData";
import { derivationNotes } from "./lib/teamCards";
import { loadLeague, saveLeague } from "./lib/storage";
import type { DiceTeamCard, GameResult, LeagueGame, LeagueState, MatchupCard, MatchupOptions, SourceCatalog, SourceTeamCatalogEntry, StatLine } from "./lib/types";

type Tab = "library" | "matchup" | "sim" | "league" | "leaders";
type PrintTarget = "card" | "scoresheets" | null;

const statColumns = ["PTS", "REB", "AST", "STL", "BLK", "TOV", "PF"];
const maxLeagueTeams = 32;

type SeasonChoice = { season: string; seasonEndYear: number };

function seasonChoicesFor(teams: SourceTeamCatalogEntry[]): SeasonChoice[] {
  return Array.from(new Map(teams.map((team) => [team.season, team.seasonEndYear])))
    .map(([season, seasonEndYear]) => ({ season, seasonEndYear }))
    .sort((a, b) => b.seasonEndYear - a.seasonEndYear);
}

function teamsBySeason(teams: SourceTeamCatalogEntry[], seasons: SeasonChoice[]): Map<string, SourceTeamCatalogEntry[]> {
  return new Map(seasons.map((choice) => [choice.season, teams.filter((team) => team.season === choice.season)]));
}

function teamLabel(teamNames: Map<string, string>, teamId: string): string {
  return teamNames.get(teamId) ?? teamId;
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

function signedLabel(value: number, digits = 1): string {
  const rounded = Math.abs(value).toFixed(digits);
  return value >= 0 ? `+${rounded}` : `-${rounded}`;
}

function shotProfileLabel(row: MatchupCard["awayPlayerRanges"][number]): string {
  if (row.shotProfileMethod === "sourced-location") return "SRC";
  if (row.shotProfileMethod === "same-player-neighbor-proxy") return "PLY-PXY";
  if (row.shotProfileMethod === "era-role-neighbor-proxy") return "ROLE-PXY";
  return "MANUAL";
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
  const [catalog, setCatalog] = useState<SourceCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadSourceCatalog()
      .then((nextCatalog) => {
        if (active) setCatalog(nextCatalog);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      active = false;
    };
  }, []);

  if (error) {
    return <StartupPanel title="Data Load Failed" message={error} />;
  }

  if (!catalog) {
    return <StartupPanel title="Loading Data" message="Loading local catalog." />;
  }

  return <StudioApp catalog={catalog} />;
}

function StartupPanel({ title, message }: { title: string; message: string }) {
  return (
    <div className="app screen-only">
      <main className="workspace">
        <article className="panel">
          <h2>{title}</h2>
          <p>{message}</p>
        </article>
      </main>
    </div>
  );
}

function StudioApp({ catalog }: { catalog: SourceCatalog }) {
  const sourceTeams = catalog.teams;
  const seasonChoices = useMemo(() => seasonChoicesFor(sourceTeams), [sourceTeams]);
  const defaultSeason = seasonChoices[0]?.season ?? sourceTeams[0].season;
  const sourceTeamsBySeason = useMemo(() => teamsBySeason(sourceTeams, seasonChoices), [seasonChoices, sourceTeams]);
  const sourceTeamsInSeason = useCallback((season: string) => sourceTeamsBySeason.get(season) ?? sourceTeams, [sourceTeams, sourceTeamsBySeason]);
  const teamNames = useMemo(() => new Map(sourceTeams.map((team) => [team.id, team.shortName])), [sourceTeams]);
  const defaultAwayId = sourceTeams[0].id;
  const defaultHomeId = sourceTeams[1]?.id ?? sourceTeams[0].id;
  const [tab, setTab] = useState<Tab>("library");
  const [awayId, setAwayId] = useState(defaultAwayId);
  const [homeId, setHomeId] = useState(defaultHomeId);
  const [selectedTeamId, setSelectedTeamId] = useState(defaultAwayId);
  const [printTarget, setPrintTarget] = useState<PrintTarget>(null);
  const [league, setLeague] = useState<LeagueState | null>(() => loadLeague());
  const [teamCards, setTeamCards] = useState<Partial<Record<string, DiceTeamCard>>>({});
  const [teamLoadError, setTeamLoadError] = useState<string | null>(null);
  const [matchupOptions, setMatchupOptions] = useState<MatchupOptions>(defaultMatchupOptions);

  useEffect(() => saveLeague(league), [league]);

  useEffect(() => {
    const reset = () => setPrintTarget(null);
    window.addEventListener("afterprint", reset);
    return () => window.removeEventListener("afterprint", reset);
  }, []);

  const loadTeam = useCallback(
    async (teamId: string) => {
      const team = await loadDiceTeam(teamId, catalog.leagues);
      setTeamCards((current) => (current[teamId] ? current : { ...current, [teamId]: team }));
      return team;
    },
    [catalog.leagues]
  );

  useEffect(() => {
    let active = true;
    setTeamLoadError(null);
    Promise.all(Array.from(new Set([awayId, homeId, selectedTeamId])).map((teamId) => loadTeam(teamId))).catch((reason: unknown) => {
      if (active) setTeamLoadError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => {
      active = false;
    };
  }, [awayId, homeId, loadTeam, selectedTeamId]);

  const away = teamCards[awayId];
  const home = teamCards[homeId];
  const selectedTeam = teamCards[selectedTeamId];
  const matchup = useMemo(() => (away && home ? buildMatchupCard(away, home, matchupOptions) : null), [away, home, matchupOptions]);

  const print = (target: PrintTarget) => {
    if (!matchup) return;
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
            <strong>{catalog.sourceProvider}</strong>
            <span>{sourceTeams.length} teams</span>
            <span>Generated {new Date(catalog.generatedAt).toLocaleString()}</span>
          </div>
        </aside>

        <main className="workspace">
          {teamLoadError && (
            <article className="panel">
              <h3>Team Load Failed</h3>
              <p>{teamLoadError}</p>
            </article>
          )}
          {tab === "library" && (
            <Library
              selectedTeamId={selectedTeamId}
              selected={selectedTeam}
              setSelectedTeamId={setSelectedTeamId}
              seasonChoices={seasonChoices}
              defaultSeason={defaultSeason}
              sourceTeamsInSeason={sourceTeamsInSeason}
            />
          )}
          {tab === "matchup" && matchup && (
            <MatchupStudio
              awayId={awayId}
              homeId={homeId}
              setAwayId={setAwayId}
              setHomeId={setHomeId}
              matchup={matchup}
              matchupOptions={matchupOptions}
              setMatchupOptions={setMatchupOptions}
              onPrint={print}
              seasonChoices={seasonChoices}
              sourceTeamsInSeason={sourceTeamsInSeason}
            />
          )}
          {tab === "matchup" && !matchup && <LoadingPanel label="Loading matchup teams." />}
          {tab === "sim" && away && home && (
            <Simulator
              awayId={awayId}
              homeId={homeId}
              away={away}
              home={home}
              matchupOptions={matchupOptions}
              setMatchupOptions={setMatchupOptions}
              setAwayId={setAwayId}
              setHomeId={setHomeId}
              seasonChoices={seasonChoices}
              sourceTeamsInSeason={sourceTeamsInSeason}
            />
          )}
          {tab === "sim" && (!away || !home) && <LoadingPanel label="Loading simulator teams." />}
          {tab === "league" && (
            <LeagueView
              league={league}
              setLeague={setLeague}
              seasonChoices={seasonChoices}
              defaultSeason={defaultSeason}
              sourceTeamsInSeason={sourceTeamsInSeason}
              teamNames={teamNames}
              loadTeam={loadTeam}
            />
          )}
          {tab === "leaders" && <Leaders league={league} teamNames={teamNames} />}
        </main>
      </div>

      {matchup && <div className={`print-root ${printTarget === "card" ? "active" : ""}`}>
        <PrintableGameCard matchup={matchup} />
      </div>}
      {matchup && <div className={`print-root ${printTarget === "scoresheets" ? "active" : ""}`}>
        <PrintableScoresheets matchup={matchup} />
      </div>}
    </>
  );
}

function LoadingPanel({ label }: { label: string }) {
  return (
    <article className="panel">
      <h3>Loading</h3>
      <p>{label}</p>
    </article>
  );
}

function Library({
  selectedTeamId,
  selected,
  setSelectedTeamId,
  seasonChoices,
  defaultSeason,
  sourceTeamsInSeason
}: {
  selectedTeamId: string;
  selected: DiceTeamCard | undefined;
  setSelectedTeamId: (id: string) => void;
  seasonChoices: SeasonChoice[];
  defaultSeason: string;
  sourceTeamsInSeason: (season: string) => SourceTeamCatalogEntry[];
}) {
  const [season, setSeason] = useState(defaultSeason);
  const visibleTeams = sourceTeamsInSeason(season);

  useEffect(() => {
    if (visibleTeams.length && !visibleTeams.some((team) => team.id === selectedTeamId)) {
      setSelectedTeamId(visibleTeams[0].id);
    }
  }, [selectedTeamId, setSelectedTeamId, visibleTeams]);

  if (!selected) {
    return (
      <section className="page">
        <LoadingPanel label="Loading selected team." />
      </section>
    );
  }

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h2>Team Library</h2>
          <p>Source-derived team and player cards. Full raw tables stay cached for audit and recalibration.</p>
        </div>
        <label className="season-filter">
          Season
          <select value={season} onChange={(event) => setSeason(event.target.value)}>
            {seasonChoices.map((choice) => (
              <option key={choice.season} value={choice.season}>
                {choice.season}
              </option>
            ))}
          </select>
        </label>
      </header>

      <div className="library-layout">
        <div className="team-list">
          {visibleTeams.map((team) => (
            <button key={team.id} className={team.id === selectedTeamId ? "team-row active" : "team-row"} onClick={() => setSelectedTeamId(team.id)}>
              <span>
                <strong>{team.shortName}</strong>
                <small>{team.franchise}</small>
              </span>
              <span className="record">
                {team.team.wins}-{team.team.losses}
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
  matchupOptions,
  setMatchupOptions,
  onPrint,
  seasonChoices,
  sourceTeamsInSeason
}: {
  awayId: string;
  homeId: string;
  setAwayId: (id: string) => void;
  setHomeId: (id: string) => void;
  matchup: MatchupCard;
  matchupOptions: MatchupOptions;
  setMatchupOptions: (options: MatchupOptions) => void;
  onPrint: (target: PrintTarget) => void;
  seasonChoices: SeasonChoice[];
  sourceTeamsInSeason: (season: string) => SourceTeamCatalogEntry[];
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

      <TeamSelectors
        awayId={awayId}
        homeId={homeId}
        setAwayId={setAwayId}
        setHomeId={setHomeId}
        seasonChoices={seasonChoices}
        sourceTeamsInSeason={sourceTeamsInSeason}
      />
      <MatchupOptionsControls options={matchupOptions} setOptions={setMatchupOptions} />
      <ScreenGameCard matchup={matchup} />
    </section>
  );
}

function MatchupOptionsControls({ options, setOptions }: { options: MatchupOptions; setOptions: (options: MatchupOptions) => void }) {
  return (
    <div className="selector-row compact">
      <label>
        Venue
        <select value={options.venue} onChange={(event) => setOptions({ ...options, venue: event.target.value as MatchupOptions["venue"] })}>
          <option value="home-court">Home court</option>
          <option value="neutral">Neutral court</option>
        </select>
      </label>
      <label>
        Game type
        <select value={options.intensity} onChange={(event) => setOptions({ ...options, intensity: event.target.value as MatchupOptions["intensity"] })}>
          <option value="regular">Regular</option>
          <option value="playoff">Playoff</option>
        </select>
      </label>
    </div>
  );
}

function TeamSelectors({
  awayId,
  homeId,
  setAwayId,
  setHomeId,
  seasonChoices,
  sourceTeamsInSeason
}: {
  awayId: string;
  homeId: string;
  setAwayId: (id: string) => void;
  setHomeId: (id: string) => void;
  seasonChoices: SeasonChoice[];
  sourceTeamsInSeason: (season: string) => SourceTeamCatalogEntry[];
}) {
  return (
    <div className="selector-row">
      <label>
        Away
        <select value={awayId} onChange={(event) => setAwayId(event.target.value)}>
          <TeamOptions disabledTeamId={homeId} seasonChoices={seasonChoices} sourceTeamsInSeason={sourceTeamsInSeason} />
        </select>
      </label>
      <label>
        Home
        <select value={homeId} onChange={(event) => setHomeId(event.target.value)}>
          <TeamOptions disabledTeamId={awayId} seasonChoices={seasonChoices} sourceTeamsInSeason={sourceTeamsInSeason} />
        </select>
      </label>
    </div>
  );
}

function TeamOptions({
  disabledTeamId,
  seasonChoices,
  sourceTeamsInSeason
}: {
  disabledTeamId: string;
  seasonChoices: SeasonChoice[];
  sourceTeamsInSeason: (season: string) => SourceTeamCatalogEntry[];
}) {
  return (
    <>
      {seasonChoices.map((choice) => (
        <optgroup key={choice.season} label={choice.season}>
          {sourceTeamsInSeason(choice.season).map((team) => (
            <option key={team.id} value={team.id} disabled={team.id === disabledTeamId}>
              {team.shortName}
            </option>
          ))}
        </optgroup>
      ))}
    </>
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
              <th>Context</th>
              <td>{matchup.context.label}</td>
            </tr>
            <tr>
              <th>Home court</th>
              <td>{matchup.context.venue === "home-court" ? `${matchup.home.shortName} (${matchup.context.homeCourtAdvantagePoints.toFixed(1)} pts)` : "None"}</td>
            </tr>
            <tr>
              <th>Rotation</th>
              <td>{matchup.context.useWeightMode === "playoff-tightened" ? "Playoff tightened" : "Regular"}</td>
            </tr>
            <tr>
              <th>Pace factor</th>
              <td>{matchup.context.paceMultiplier.toFixed(2)}</td>
            </tr>
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
              <th>Overtime</th>
              <td>OT {matchup.overtimePossessionsEach} possessions per team</td>
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
              <th>ORB Avg</th>
              <th>ORB Rim</th>
              <th>ORB Short</th>
              <th>ORB Long</th>
              <th>ORB 3P</th>
              <th>BLK</th>
              <th>Foul End</th>
              <th>AST 2</th>
              <th>AST 3</th>
              <th>Ctx Adj</th>
              <th>PO Leverage</th>
              <th>Era Talent</th>
              <th>Def Adj</th>
              <th>Total Shot Adj</th>
            </tr>
          </thead>
          <tbody>
            {[matchup.awayStatic, matchup.homeStatic].map((row) => (
              <tr key={row.offense}>
                <td>{row.offense === matchup.away.id ? matchup.away.shortName : matchup.home.shortName}</td>
                <td>{row.ranges.orb}</td>
                <td>{row.ranges.orbRim}</td>
                <td>{row.ranges.orbShortMid}</td>
                <td>{row.ranges.orbLongMid}</td>
                <td>{row.ranges.orbThree}</td>
                <td>{row.ranges.block}</td>
                <td>{row.ranges.foulEndsPossession}</td>
                <td>{row.ranges.ast2}</td>
                <td>{row.ranges.ast3}</td>
                <td>{shotAdjustmentLabel(row.contextShotAdjustment)}</td>
                <td>{signedLabel(row.playoffLeverageShotAdjustment)}</td>
                <td title={`Shot ${signedLabel(row.eraTalentAdjustment.shotMakeAdjustment)} / TO ${signedLabel(row.eraTalentAdjustment.turnoverAdjustment)} / ORB ${signedLabel(row.eraTalentAdjustment.reboundAdjustment)}`}>
                  {signedLabel(row.eraTalentAdjustment.talentDelta)}
                </td>
                <td>{shotAdjustmentLabel(row.defenseShotAdjustment)}</td>
                <td>{shotAdjustmentLabel(row.totalShotAdjustment)}</td>
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
            <th>TOV Type</th>
            <th>Live TOV</th>
            <th>Off Foul TOV</th>
            <th>Foul</th>
            <th>Shot</th>
            <th>Profile</th>
            <th>Conf</th>
            <th>Rim</th>
            <th>Short 2</th>
            <th>Long 2</th>
            <th>3P</th>
            <th>Rim Make</th>
            <th>Short Make</th>
            <th>Long Make</th>
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
              <td>{row.turnoverProfile === "play-by-play" ? "PBP" : "Agg"}</td>
              <td>{row.liveBallTurnover}</td>
              <td>{row.offensiveFoulTurnover}</td>
              <td>{row.foul}</td>
              <td>{row.shot}</td>
              <td>{shotProfileLabel(row)}</td>
              <td>{row.shotProfileConfidence.toFixed(2)}</td>
              <td>{row.rim}</td>
              <td>{row.shortMid}</td>
              <td>{row.longMid}</td>
              <td>{row.three}</td>
              <td>{row.rimMake}</td>
              <td>{row.shortMidMake}</td>
              <td>{row.longMidMake}</td>
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
  const events = ["Use", "AST", "OREB", "DREB", "STL", "BLK", "PF", "ShootingPF"] as const;
  return (
    <>
      <h3>{team.shortName}</h3>
      <table>
        <thead>
          <tr>
            <th>Player</th>
            {events.map((event) => (
              <th key={event}>{event === "ShootingPF" ? "Shoot PF" : event}</th>
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
            <span>OT {matchup.overtimePossessionsEach}</span>
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
  away,
  home,
  matchupOptions,
  setMatchupOptions,
  setAwayId,
  setHomeId,
  seasonChoices,
  sourceTeamsInSeason
}: {
  awayId: string;
  homeId: string;
  away: DiceTeamCard;
  home: DiceTeamCard;
  matchupOptions: MatchupOptions;
  setMatchupOptions: (options: MatchupOptions) => void;
  setAwayId: (id: string) => void;
  setHomeId: (id: string) => void;
  seasonChoices: SeasonChoice[];
  sourceTeamsInSeason: (season: string) => SourceTeamCatalogEntry[];
}) {
  const [result, setResult] = useState<GameResult | null>(null);
  const [bulkGames, setBulkGames] = useState(500);
  const [bulk, setBulk] = useState<ReturnType<typeof summarizeSimulations> | null>(null);

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h2>Simulator</h2>
          <p>Runs the full possession engine using source-derived matchup cards.</p>
        </div>
        <div className="actions">
          <Button icon={<Play size={16} />} variant="primary" onClick={() => setResult(simulateGame(away, home, Date.now(), "simulated", matchupOptions))}>
            Sim One
          </Button>
          <Button icon={<BarChart3 size={16} />} onClick={() => setBulk(summarizeSimulations(away, home, bulkGames, Date.now(), matchupOptions))}>
            Sim Many
          </Button>
        </div>
      </header>

      <TeamSelectors
        awayId={awayId}
        homeId={homeId}
        setAwayId={setAwayId}
        setHomeId={setHomeId}
        seasonChoices={seasonChoices}
        sourceTeamsInSeason={sourceTeamsInSeason}
      />
      <MatchupOptionsControls options={matchupOptions} setOptions={setMatchupOptions} />
      <label className="inline-input">
        Bulk games
        <input type="number" min={1} max={10000} value={bulkGames} onChange={(event) => setBulkGames(Number(event.target.value))} />
      </label>

      {result && <ResultPanel result={result} away={away} home={home} />}
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
              <span>OT rate</span>
              <strong>{pct(bulk.overtimeGames ?? 0, bulk.games)}</strong>
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

function ResultPanel({ result, away, home }: { result: GameResult; away: DiceTeamCard; home: DiceTeamCard }) {
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
      {result.quarters.length > 4 && <p>Overtime periods: {result.quarters.length - 4}</p>}
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

function LeagueView({
  league,
  setLeague,
  seasonChoices,
  defaultSeason,
  sourceTeamsInSeason,
  teamNames,
  loadTeam
}: {
  league: LeagueState | null;
  setLeague: (league: LeagueState | null) => void;
  seasonChoices: SeasonChoice[];
  defaultSeason: string;
  sourceTeamsInSeason: (season: string) => SourceTeamCatalogEntry[];
  teamNames: Map<string, string>;
  loadTeam: (teamId: string) => Promise<DiceTeamCard>;
}) {
  const [name, setName] = useState("Studio League");
  const [season, setSeason] = useState(defaultSeason);
  const visibleTeams = sourceTeamsInSeason(season);
  const [selected, setSelected] = useState<string[]>(visibleTeams.slice(0, 4).map((team) => team.id));
  const [manualGame, setManualGame] = useState<LeagueGame | null>(null);
  const [pendingGameId, setPendingGameId] = useState<string | null>(null);
  const [leagueError, setLeagueError] = useState<string | null>(null);

  useEffect(() => {
    setSelected((current) => {
      const visibleIds = new Set(visibleTeams.map((team) => team.id));
      const kept = current.filter((teamId) => visibleIds.has(teamId)).slice(0, maxLeagueTeams);
      if (kept.length >= 2) return kept;
      return visibleTeams.slice(0, Math.min(4, maxLeagueTeams, visibleTeams.length)).map((team) => team.id);
    });
  }, [visibleTeams]);

  const toggle = (teamId: string) => {
    setSelected((current) => (current.includes(teamId) ? current.filter((id) => id !== teamId) : [...current, teamId]));
  };

  const simulateGameInLeague = async (game: LeagueGame) => {
    if (!league) return;
    setPendingGameId(game.id);
    setLeagueError(null);
    try {
      const [away, home] = await Promise.all([loadTeam(game.awayTeamId), loadTeam(game.homeTeamId)]);
      setLeague(simulateLeagueGameWithTeams(league, game.id, away, home));
    } catch (reason) {
      setLeagueError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPendingGameId(null);
    }
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
            <label>
              Season
              <select value={season} onChange={(event) => setSeason(event.target.value)}>
                {seasonChoices.map((choice) => (
                  <option key={choice.season} value={choice.season}>
                    {choice.season}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="team-check-grid">
            {visibleTeams.map((team) => (
              <label key={team.id} className="check-card">
                <input
                  type="checkbox"
                  checked={selected.includes(team.id)}
                  disabled={!selected.includes(team.id) && selected.length >= maxLeagueTeams}
                  onChange={() => toggle(team.id)}
                />
                <span>
                  <strong>{team.shortName}</strong>
                  <small>
                    {team.team.wins}-{team.team.losses}
                  </small>
                </span>
              </label>
            ))}
          </div>
          <Button
            icon={<CalendarDays size={16} />}
            variant="primary"
            disabled={selected.length < 2 || selected.length > maxLeagueTeams}
            onClick={() => setLeague(createLeague(name, selected))}
          >
            Create Schedule
          </Button>
        </article>
      ) : (
        <>
          {leagueError && (
            <article className="panel">
              <h3>League Action Failed</h3>
              <p>{leagueError}</p>
            </article>
          )}
          <StandingsTable league={league} teamNames={teamNames} />
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
                        {teamLabel(teamNames, game.awayTeamId)} at {teamLabel(teamNames, game.homeTeamId)}
                      </td>
                      <td>
                        <span className={`status ${game.status}`}>{game.status}</span>
                      </td>
                      <td>{game.result ? `${game.result.awayScore}-${game.result.homeScore}` : "-"}</td>
                      <td className="row-actions">
                        <Button data-testid={`sim-${game.id}`} icon={<Play size={14} />} disabled={pendingGameId === game.id} onClick={() => void simulateGameInLeague(game)}>
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
          {manualGame && (
            <ManualResultFormLoader
              game={manualGame}
              league={league}
              setLeague={setLeague}
              onClose={() => setManualGame(null)}
              loadTeam={loadTeam}
            />
          )}
        </>
      )}
    </section>
  );
}

function ManualResultFormLoader({
  game,
  league,
  setLeague,
  onClose,
  loadTeam
}: {
  game: LeagueGame;
  league: LeagueState;
  setLeague: (league: LeagueState) => void;
  onClose: () => void;
  loadTeam: (teamId: string) => Promise<DiceTeamCard>;
}) {
  const [teams, setTeams] = useState<{ away: DiceTeamCard; home: DiceTeamCard } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setTeams(null);
    setError(null);
    Promise.all([loadTeam(game.awayTeamId), loadTeam(game.homeTeamId)])
      .then(([away, home]) => {
        if (active) setTeams({ away, home });
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      active = false;
    };
  }, [game.awayTeamId, game.homeTeamId, loadTeam]);

  if (error) {
    return (
      <article className="panel">
        <h3>Manual Result Failed</h3>
        <p>{error}</p>
        <Button onClick={onClose}>Close</Button>
      </article>
    );
  }

  if (!teams) {
    return <LoadingPanel label="Loading manual result teams." />;
  }

  return <ManualResultForm game={game} league={league} setLeague={setLeague} onClose={onClose} away={teams.away} home={teams.home} />;
}

function ManualResultForm({
  game,
  league,
  setLeague,
  onClose,
  away,
  home
}: {
  game: LeagueGame;
  league: LeagueState;
  setLeague: (league: LeagueState) => void;
  onClose: () => void;
  away: DiceTeamCard;
  home: DiceTeamCard;
}) {
  const [awayScore, setAwayScore] = useState(game.result?.awayScore ?? 0);
  const [homeScore, setHomeScore] = useState(game.result?.homeScore ?? 0);
  const [playerInputs, setPlayerInputs] = useState<Record<string, Record<string, number>>>({});
  const [manualError, setManualError] = useState<string | null>(null);

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
    setManualError(null);
    let result: GameResult;
    try {
      result = createManualResult(away, home, awayScore, homeScore);
    } catch (reason) {
      setManualError(reason instanceof Error ? reason.message : String(reason));
      return;
    }
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
          <input data-testid="manual-away-score" type="number" min={0} value={awayScore} onChange={(event) => setAwayScore(Number(event.target.value))} />
        </label>
        <label>
          {home.shortName}
          <input data-testid="manual-home-score" type="number" min={0} value={homeScore} onChange={(event) => setHomeScore(Number(event.target.value))} />
        </label>
      </div>
      {manualError && <p className="form-error">{manualError}</p>}
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

function StandingsTable({ league, teamNames }: { league: LeagueState; teamNames: Map<string, string> }) {
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
              <th>Pct</th>
              <th>PF</th>
              <th>PA</th>
              <th>Diff</th>
            </tr>
          </thead>
          <tbody>
            {standings(league).map((row) => (
              <tr key={row.teamId}>
                <td>{teamLabel(teamNames, row.teamId)}</td>
                <td>{row.wins}</td>
                <td>{row.losses}</td>
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

function Leaders({ league, teamNames }: { league: LeagueState | null; teamNames: Map<string, string> }) {
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
                      <td>{teamLabel(teamNames, teamId)}</td>
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
                    <td>{teamLabel(teamNames, row.teamId)}</td>
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
