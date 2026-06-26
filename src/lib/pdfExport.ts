import type { DicePlayerCard, DiceTeamCard, MatchupCard } from "./types";

type PdfDoc = InstanceType<typeof import("jspdf").jsPDF>;
type AutoTable = typeof import("jspdf-autotable").default;
type PdfDeps = { jsPDF: typeof import("jspdf").jsPDF; autoTable: AutoTable };
type PdfDocWithAutoTable = PdfDoc & { lastAutoTable?: { finalY: number } };

const scoreColumns = [
  { label: "PTS", width: 44 },
  { label: "FGM", width: 42 },
  { label: "FGA", width: 72 },
  { label: "3PM", width: 36 },
  { label: "3PA", width: 54 },
  { label: "FTM", width: 42 },
  { label: "FTA", width: 64 },
  { label: "OREB", width: 44 },
  { label: "DREB", width: 48 },
  { label: "AST", width: 44 },
  { label: "STL", width: 34 },
  { label: "BLK", width: 34 },
  { label: "TOV", width: 38 },
  { label: "PF", width: 28 }
] as const;
const scoresheetPlayerColumnWidth = 132;
const scoresheetHorizontalMargin = 18;
const scoresheetBaseTableWidth = scoresheetPlayerColumnWidth + scoreColumns.reduce((sum, column) => sum + column.width, 0);
const playerRangeColumns = [
  "Player",
  "Use",
  "TOV",
  "TOV Type",
  "Live TOV",
  "Off Foul TOV",
  "Foul",
  "Shot",
  "Profile",
  "Conf",
  "Rim",
  "Short 2",
  "Long 2",
  "3P",
  "Rim Make",
  "Short Make",
  "Long Make",
  "3P Make",
  "FT",
  "And-1"
];
const assignmentEvents = ["Use", "AST", "OREB", "DREB", "STL", "BLK", "PF", "ShootingPF"] as const;

function fileSafe(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
}

function matchupFilePrefix(matchup: MatchupCard): string {
  return `${fileSafe(matchup.away.shortName)}_at_${fileSafe(matchup.home.shortName)}`;
}

function shotProfileLabel(row: MatchupCard["awayPlayerRanges"][number]): string {
  if (row.shotProfileMethod === "sourced-location") return "SRC";
  if (row.shotProfileMethod === "same-player-neighbor-proxy") return "PLY-PXY";
  if (row.shotProfileMethod === "era-role-neighbor-proxy") return "ROLE-PXY";
  return "MANUAL";
}

function shotAdjustmentLabel(value: number): string {
  const rounded = Math.abs(value).toFixed(1);
  return value >= 0 ? `-${rounded}` : `+${rounded}`;
}

function signedLabel(value: number, digits = 1): string {
  const rounded = Math.abs(value).toFixed(digits);
  return value >= 0 ? `+${rounded}` : `-${rounded}`;
}

async function loadPdfDeps(): Promise<PdfDeps> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  return { jsPDF, autoTable };
}

function createLandscapeDoc(jsPDF: PdfDeps["jsPDF"]): PdfDoc {
  return new jsPDF({
    orientation: "landscape",
    unit: "pt",
    format: "letter"
  });
}

function drawPdfTitle(doc: PdfDoc, title: string, subtitle: string): void {
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFillColor(28, 37, 34);
  doc.rect(0, 0, pageWidth, 42, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(title, 28, 25);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(subtitle, 28, 38);
  doc.setTextColor(28, 37, 34);
}

function lastAutoTableY(doc: PdfDoc, fallback: number): number {
  return (doc as PdfDocWithAutoTable).lastAutoTable?.finalY ?? fallback;
}

function pageBottom(doc: PdfDoc, bottomMargin = 18): number {
  return doc.internal.pageSize.getHeight() - bottomMargin;
}

function drawSectionTitle(doc: PdfDoc, title: string, y: number): number {
  doc.setTextColor(28, 37, 34);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text(title, 18, y);
  return y + 6;
}

function packedStartY(doc: PdfDoc, startY: number, estimatedHeight: number, pageTitle: string, pageSubtitle: string): { y: number; addedPage: boolean } {
  if (startY + estimatedHeight <= pageBottom(doc)) return { y: startY, addedPage: false };
  doc.addPage();
  drawPdfTitle(doc, pageTitle, pageSubtitle);
  return { y: 58, addedPage: true };
}

function drawGameCard(doc: PdfDoc, autoTable: AutoTable, matchup: MatchupCard): void {
  drawPdfTitle(doc, `${matchup.away.shortName} at ${matchup.home.shortName}`, `Matchup card - ${matchup.context.label}`);

  autoTable(doc, {
    startY: 58,
    head: [["Setting", "Value"]],
    body: [
      ["Context", matchup.context.label],
      ["Home court", matchup.context.venue === "home-court" ? `${matchup.home.shortName} (${matchup.context.homeCourtAdvantagePoints.toFixed(1)} pts)` : "None"],
      ["Rotation", matchup.context.useWeightMode === "playoff-tightened" ? "Playoff tightened" : "Regular"],
      ["Pace factor", matchup.context.paceMultiplier.toFixed(2)],
      ["Possessions per team", String(matchup.possessionsEach)],
      ["Quarter split", `Q1 ${matchup.quarters[0]} / Q2 ${matchup.quarters[1]} / Q3 ${matchup.quarters[2]} / Q4 ${matchup.quarters[3]}`],
      ["Overtime", `OT ${matchup.overtimePossessionsEach} possessions per team`],
      ["Loose foul check", matchup.looseFoulRange],
      ["Steal on turnover", matchup.stealOnTurnoverRange]
    ],
    theme: "grid",
    margin: { left: 28, right: 28 },
    tableWidth: 250,
    styles: { font: "helvetica", fontSize: 9, cellPadding: 3.6, lineColor: [160, 166, 162], lineWidth: 0.5, minCellHeight: 13 },
    headStyles: { fillColor: [31, 45, 40], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8.4, minCellHeight: 14 },
    columnStyles: { 0: { cellWidth: 90, fontStyle: "bold" } }
  });
  const settingsBottom = lastAutoTableY(doc, 58);

  autoTable(doc, {
    startY: 58,
    head: [["Offense", "ORB Avg", "ORB Rim", "ORB Short", "ORB Long", "ORB 3P", "BLK", "Foul End", "AST 2", "AST 3", "Ctx Adj", "PO Lev", "Era", "Def Adj", "Shot Adj"]],
    body: [matchup.awayStatic, matchup.homeStatic].map((row) => [
      row.offense === matchup.away.id ? matchup.away.shortName : matchup.home.shortName,
      row.ranges.orb,
      row.ranges.orbRim,
      row.ranges.orbShortMid,
      row.ranges.orbLongMid,
      row.ranges.orbThree,
      row.ranges.block,
      row.ranges.foulEndsPossession,
      row.ranges.ast2,
      row.ranges.ast3,
      shotAdjustmentLabel(row.contextShotAdjustment),
      signedLabel(row.playoffLeverageShotAdjustment),
      signedLabel(row.eraTalentAdjustment.talentDelta),
      shotAdjustmentLabel(row.defenseShotAdjustment),
      shotAdjustmentLabel(row.totalShotAdjustment)
    ]),
    theme: "grid",
    margin: { left: 294, right: 28 },
    tableWidth: "auto",
    styles: { font: "helvetica", fontSize: 8, cellPadding: 3, lineColor: [160, 166, 162], lineWidth: 0.5, halign: "center", minCellHeight: 13 },
    headStyles: { fillColor: [31, 45, 40], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7.4, minCellHeight: 14 },
    columnStyles: { 0: { halign: "left", fontStyle: "bold" } }
  });
  const staticBottom = lastAutoTableY(doc, 58);

  let nextY = Math.max(settingsBottom, staticBottom) + 14;
  nextY = drawPlayerRangesTable(doc, autoTable, `${matchup.away.shortName} offense vs ${matchup.home.shortName} defense`, matchup.awayPlayerRanges, nextY);
  nextY = drawPlayerRangesTable(doc, autoTable, `${matchup.home.shortName} offense vs ${matchup.away.shortName} defense`, matchup.homePlayerRanges, nextY + 10);
  drawAssignmentMatrix(doc, autoTable, matchup, nextY + 12);
}

function drawPlayerRangesTable(doc: PdfDoc, autoTable: AutoTable, title: string, rows: MatchupCard["awayPlayerRanges"], startY: number): number {
  const estimatedHeight = 24 + rows.length * 12.4;
  const section = packedStartY(doc, startY, estimatedHeight, "Player Ranges", title);
  const tableStartY = section.addedPage ? section.y : drawSectionTitle(doc, title, section.y);
  autoTable(doc, {
    startY: tableStartY,
    head: [playerRangeColumns],
    body: rows.map((row) => [
      row.player,
      row.use,
      row.tov,
      row.turnoverProfile === "play-by-play" ? "PBP" : "Agg",
      row.liveBallTurnover,
      row.offensiveFoulTurnover,
      row.foul,
      row.shot,
      shotProfileLabel(row),
      row.shotProfileConfidence.toFixed(2),
      row.rim,
      row.shortMid,
      row.longMid,
      row.three,
      row.rimMake,
      row.shortMidMake,
      row.longMidMake,
      row.p3,
      row.ft,
      row.andOne
    ]),
    theme: "grid",
    margin: { left: 12, right: 12, bottom: 16 },
    tableWidth: doc.internal.pageSize.getWidth() - 24,
    styles: {
      font: "helvetica",
      fontSize: 6.8,
      cellPadding: { top: 1.8, right: 1.2, bottom: 1.8, left: 1.2 },
      lineColor: [160, 166, 162],
      lineWidth: 0.35,
      halign: "center",
      minCellHeight: 12,
      overflow: "ellipsize"
    },
    headStyles: { fillColor: [31, 45, 40], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 6.3, minCellHeight: 12.2 },
    columnStyles: { 0: { cellWidth: 94, halign: "left", fontStyle: "bold" } },
    alternateRowStyles: { fillColor: [247, 249, 248] }
  });
  return lastAutoTableY(doc, tableStartY) + 2;
}

function drawAssignmentMatrix(doc: PdfDoc, autoTable: AutoTable, matchup: MatchupCard, startY: number): number {
  const estimatedHeight = 30 + (matchup.away.players.length + matchup.home.players.length) * 11.5;
  const section = packedStartY(doc, startY, estimatedHeight, "Assignment Matrix", `${matchup.away.shortName} at ${matchup.home.shortName}`);
  let nextY = section.addedPage ? section.y : drawSectionTitle(doc, "Assignment Matrix", section.y);
  [matchup.away, matchup.home].forEach((team) => {
    const teamHeight = 20 + team.players.length * 11.5;
    if (nextY + teamHeight > pageBottom(doc)) {
      doc.addPage();
      drawPdfTitle(doc, "Assignment Matrix", `${matchup.away.shortName} at ${matchup.home.shortName}`);
      nextY = 58;
    }
    autoTable(doc, {
      startY: nextY,
      head: [[team.shortName, ...assignmentEvents.map((event) => (event === "ShootingPF" ? "Shoot PF" : event))]],
      body: team.players.map((player) => [
        player.name,
        ...assignmentEvents.map((event) => matchup.assignments[team.id][event].find((row) => row.label === player.name)?.range ?? "-")
      ]),
      theme: "grid",
      margin: { left: 18, right: 18, bottom: 16 },
      tableWidth: doc.internal.pageSize.getWidth() - 36,
      styles: { font: "helvetica", fontSize: 7.4, cellPadding: 1.8, lineColor: [160, 166, 162], lineWidth: 0.4, halign: "center", minCellHeight: 11, overflow: "ellipsize" },
      headStyles: { fillColor: [31, 45, 40], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7 },
      columnStyles: { 0: { cellWidth: 140, halign: "left", fontStyle: "bold" } },
      alternateRowStyles: { fillColor: [247, 249, 248] }
    });
    nextY = lastAutoTableY(doc, nextY) + 12;
  });
  return nextY;
}

function scoresheetPlayerGroups(team: DiceTeamCard): { starters: DicePlayerCard[]; bench: DicePlayerCard[] } {
  const starters = [...team.players]
    .sort((a, b) => (b.source.gamesStarted ?? 0) - (a.source.gamesStarted ?? 0) || b.minutes - a.minutes)
    .slice(0, 5);
  const starterIds = new Set(starters.map((player) => player.id));
  return {
    starters,
    bench: team.players.filter((player) => !starterIds.has(player.id))
  };
}

function scoresheetColumnStyles(scale: number) {
  return {
    0: {
      cellWidth: scoresheetPlayerColumnWidth * scale,
      fontStyle: "bold" as const,
      halign: "left" as const
    },
    ...Object.fromEntries(
      scoreColumns.map((column, index) => [
        index + 1,
        {
          cellWidth: column.width * scale,
          halign: "center" as const
        }
      ])
    )
  };
}

function drawScoresheetHeader(doc: PdfDoc, matchup: MatchupCard, team: DiceTeamCard): void {
  const opponent = team.id === matchup.away.id ? matchup.home : matchup.away;
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFillColor(28, 37, 34);
  doc.rect(0, 0, pageWidth, 30, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(`${team.shortName} Scoresheet`, scoresheetHorizontalMargin, 19);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text(`Opponent: ${opponent.shortName}`, pageWidth - 195, 13);
  doc.text(`Possessions: ${matchup.possessionsEach}`, pageWidth - 195, 24);

  doc.setTextColor(28, 37, 34);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text(
    `Context: ${matchup.context.label}  |  Q targets: ${matchup.quarters[0]} / ${matchup.quarters[1]} / ${matchup.quarters[2]} / ${matchup.quarters[3]}  |  OT: ${matchup.overtimePossessionsEach}`,
    scoresheetHorizontalMargin,
    43
  );
}

function drawTeamScoresheet(doc: PdfDoc, autoTable: AutoTable, matchup: MatchupCard, team: DiceTeamCard): void {
  drawScoresheetHeader(doc, matchup, team);

  const groups = scoresheetPlayerGroups(team);
  const emptyScoreCells = scoreColumns.map(() => "");
  const rows = [
    ["Starters", ...emptyScoreCells],
    ...groups.starters.map((player) => [player.name, ...emptyScoreCells]),
    ["Bench", ...emptyScoreCells],
    ...groups.bench.map((player) => [player.name, ...emptyScoreCells]),
    ["Team Totals", ...emptyScoreCells]
  ];
  const tableWidth = doc.internal.pageSize.getWidth() - scoresheetHorizontalMargin * 2;
  const widthScale = tableWidth / scoresheetBaseTableWidth;

  autoTable(doc, {
    startY: 50,
    head: [["Player", ...scoreColumns.map((column) => column.label)]],
    body: rows,
    theme: "grid",
    margin: { left: scoresheetHorizontalMargin, right: scoresheetHorizontalMargin, bottom: 14 },
    tableWidth,
    styles: {
      font: "helvetica",
      fontSize: 7.4,
      cellPadding: { top: 2, right: 1.5, bottom: 2, left: 1.5 },
      lineColor: [160, 166, 162],
      lineWidth: 0.5,
      minCellHeight: 36,
      overflow: "ellipsize",
      valign: "middle"
    },
    headStyles: {
      fillColor: [31, 45, 40],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 6.8,
      halign: "center",
      minCellHeight: 16
    },
    columnStyles: scoresheetColumnStyles(widthScale),
    alternateRowStyles: {
      fillColor: [247, 249, 248]
    },
    didParseCell: (data) => {
      const label = rows[data.row.index]?.[0];
      if (data.section === "body" && (label === "Starters" || label === "Bench")) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = [31, 45, 40];
        data.cell.styles.textColor = [255, 255, 255];
        data.cell.styles.minCellHeight = 13;
        if (data.column.index > 0) data.cell.text = [""];
      }
      if (data.section === "body" && label === "Team Totals") {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = [238, 243, 239];
      }
    }
  });
}

function drawScoresheets(doc: PdfDoc, autoTable: AutoTable, matchup: MatchupCard): void {
  drawTeamScoresheet(doc, autoTable, matchup, matchup.away);
  doc.addPage();
  drawTeamScoresheet(doc, autoTable, matchup, matchup.home);
}

function drawPossessionFlowSheet(doc: PdfDoc, autoTable: AutoTable, matchup: MatchupCard): void {
  drawPdfTitle(doc, "Possession Flow Sheet", `${matchup.away.shortName} at ${matchup.home.shortName} - ${matchup.context.label}`);
  const tableWidth = doc.internal.pageSize.getWidth() - 36;

  autoTable(doc, {
    startY: 54,
    head: [["Poss/team", "Q Targets", "OT", "Loose Foul", "Counter Rule"]],
    body: [
      [
        String(matchup.possessionsEach),
        `${matchup.quarters[0]} / ${matchup.quarters[1]} / ${matchup.quarters[2]} / ${matchup.quarters[3]}`,
        `${matchup.overtimePossessionsEach} per team`,
        matchup.looseFoulRange,
        "Mark once at the start. OREB and continuation fouls do not add a possession."
      ]
    ],
    theme: "grid",
    margin: { left: 18, right: 18 },
    tableWidth,
    styles: { font: "helvetica", fontSize: 7.4, cellPadding: 3, lineColor: [160, 166, 162], lineWidth: 0.4, minCellHeight: 13, halign: "center" },
    headStyles: { fillColor: [31, 45, 40], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7.1 },
    columnStyles: {
      0: { cellWidth: 60 },
      1: { cellWidth: 86 },
      2: { cellWidth: 66 },
      3: { cellWidth: 64 },
      4: { halign: "left" }
    },
    alternateRowStyles: { fillColor: [247, 249, 248] }
  });
  const setupBottom = lastAutoTableY(doc, 54);

  autoTable(doc, {
    startY: setupBottom + 8,
    head: [["Offense", "Foul End", "AST2", "AST3", "Block", "ORB: R / S / L / 3"]],
    body: [
      [matchup.away.shortName, matchup.awayStatic.ranges.foulEndsPossession, matchup.awayStatic.ranges.ast2, matchup.awayStatic.ranges.ast3, matchup.awayStatic.ranges.block, `R ${matchup.awayStatic.ranges.orbRim} / S ${matchup.awayStatic.ranges.orbShortMid} / L ${matchup.awayStatic.ranges.orbLongMid} / 3 ${matchup.awayStatic.ranges.orbThree}`],
      [matchup.home.shortName, matchup.homeStatic.ranges.foulEndsPossession, matchup.homeStatic.ranges.ast2, matchup.homeStatic.ranges.ast3, matchup.homeStatic.ranges.block, `R ${matchup.homeStatic.ranges.orbRim} / S ${matchup.homeStatic.ranges.orbShortMid} / L ${matchup.homeStatic.ranges.orbLongMid} / 3 ${matchup.homeStatic.ranges.orbThree}`]
    ],
    theme: "grid",
    margin: { left: 18, right: 18 },
    tableWidth,
    styles: { font: "helvetica", fontSize: 7, cellPadding: 2.8, lineColor: [160, 166, 162], lineWidth: 0.4, minCellHeight: 15, halign: "center" },
    headStyles: { fillColor: [31, 45, 40], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 6.7 },
    columnStyles: {
      0: { cellWidth: 124, halign: "left", fontStyle: "bold" },
      1: { cellWidth: 56 },
      2: { cellWidth: 48 },
      3: { cellWidth: 48 },
      4: { cellWidth: 48 },
      5: { halign: "left" }
    },
    alternateRowStyles: { fillColor: [247, 249, 248] }
  });
  const referenceBottom = lastAutoTableY(doc, setupBottom + 8);

  autoTable(doc, {
    startY: referenceBottom + 12,
    head: [["Stage", "Roll", "Result", "Record / Next"]],
    body: [
      ["Start", "No roll", "Add one team possession for the offense.", "Use the quarter target. Do this once."],
      ["Loose foul", "d100 vs Loose Foul", "Hit: assign defender on defense PF table.", "Record PF, then continue same possession."],
      ["Use", "Offense Use table", "Selected player becomes action player.", "Use this player's Player Ranges row."],
      ["Action", "d100 on TOV / Foul / Shot", "The printed range picks the branch.", "TOV, foul draw, or shot resolution."],
      ["Turnover", "Off Foul TOV, then Live TOV", "Off foul adds PF to offense. Live ball assigns STL.", "Record TOV. Possession ends."],
      ["Foul draw", "Shoot PF table, 2 FT, Foul Ends", "Yes ends. No creates a continuation shot.", "No extra possession on continuation."],
      ["Shot", "Zone range, then make range", "Use Rim, Short 2, Long 2, or 3P; then matching make range.", "Record FGA, 3PA, makes, and points."],
      ["Made shot", "AST 2 or AST 3, then And-1", "Assign AST from offense AST table excluding shooter. And-1 adds Shoot PF plus 1 FT.", "After any and-one FT, possession ends."],
      ["Missed shot", "BLK on missed 2PA, then ORB", "OREB loops back to loose foul check. DREB ends.", "Max two OREB extensions."]
    ],
    theme: "grid",
    margin: { left: 18, right: 18, bottom: 16 },
    tableWidth,
    styles: {
      font: "helvetica",
      fontSize: 7.3,
      cellPadding: { top: 3.2, right: 3, bottom: 3.2, left: 3 },
      lineColor: [160, 166, 162],
      lineWidth: 0.45,
      minCellHeight: 22,
      overflow: "linebreak",
      valign: "middle"
    },
    headStyles: { fillColor: [31, 45, 40], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7.1 },
    columnStyles: {
      0: { cellWidth: 68, fontStyle: "bold" },
      1: { cellWidth: 136 },
      2: { cellWidth: 270 },
      3: {}
    },
    alternateRowStyles: { fillColor: [247, 249, 248] }
  });
  const flowBottom = lastAutoTableY(doc, referenceBottom + 12);

  autoTable(doc, {
    startY: flowBottom + 12,
    head: [["Ends After", "Continues After", "Range Source"]],
    body: [
      [
        "Turnover; made field goal after AST/and-one checks; foul draw when Foul Ends is Yes; defensive rebound.",
        "Loose non-shooting foul; offensive rebound; foul draw when Foul Ends is No.",
        "Use, AST, OREB, DREB, STL, BLK, PF, and Shoot PF use the Assignment Matrix. TOV, Foul, Shot, zone, make, FT, and And-1 use Player Ranges."
      ]
    ],
    theme: "grid",
    margin: { left: 18, right: 18 },
    tableWidth,
    styles: { font: "helvetica", fontSize: 7.4, cellPadding: 4, lineColor: [160, 166, 162], lineWidth: 0.45, minCellHeight: 42, overflow: "linebreak", valign: "top" },
    headStyles: { fillColor: [31, 45, 40], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7.1 },
    columnStyles: { 0: { cellWidth: 220 }, 1: { cellWidth: 220 }, 2: {} }
  });

  doc.setTextColor(88, 98, 94);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.8);
  doc.text("R = Rim, S = Short 2, L = Long 2. Roll d100; a printed range hit means the result happens.", 18, doc.internal.pageSize.getHeight() - 12);
}

export async function exportGameCardPdf(matchup: MatchupCard): Promise<void> {
  const { jsPDF, autoTable } = await loadPdfDeps();
  const doc = createLandscapeDoc(jsPDF);
  drawGameCard(doc, autoTable, matchup);
  doc.save(`${matchupFilePrefix(matchup)}_card.pdf`);
}

export async function exportPossessionFlowPdf(matchup: MatchupCard): Promise<void> {
  const { jsPDF, autoTable } = await loadPdfDeps();
  const doc = createLandscapeDoc(jsPDF);
  drawPossessionFlowSheet(doc, autoTable, matchup);
  doc.save(`${matchupFilePrefix(matchup)}_possession_flow.pdf`);
}

export async function exportScoresheetsPdf(matchup: MatchupCard): Promise<void> {
  const { jsPDF, autoTable } = await loadPdfDeps();
  const doc = createLandscapeDoc(jsPDF);
  drawScoresheets(doc, autoTable, matchup);
  doc.save(`${matchupFilePrefix(matchup)}_scoresheets.pdf`);
}

export async function exportGamePacketPdf(matchup: MatchupCard): Promise<void> {
  const { jsPDF, autoTable } = await loadPdfDeps();
  const doc = createLandscapeDoc(jsPDF);
  drawGameCard(doc, autoTable, matchup);
  doc.addPage();
  drawPossessionFlowSheet(doc, autoTable, matchup);
  doc.addPage();
  drawScoresheets(doc, autoTable, matchup);
  doc.save(`${matchupFilePrefix(matchup)}_game_packet.pdf`);
}
