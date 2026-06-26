import type { DicePlayerCard, DiceTeamCard, MatchupCard } from "./types";

type PdfDoc = InstanceType<typeof import("jspdf").jsPDF>;
type AutoTable = typeof import("jspdf-autotable").default;
type PdfDeps = { jsPDF: typeof import("jspdf").jsPDF; autoTable: AutoTable };
type PdfDocWithAutoTable = PdfDoc & { lastAutoTable?: { finalY: number } };
type Rgb = [number, number, number];

const scoresheetMargin = 18;
const scoresheetInk: Rgb = [28, 37, 34];
const scoresheetMuted: Rgb = [88, 98, 94];
const scoresheetLine: Rgb = [60, 68, 64];
const scoresheetSoft: Rgb = [239, 245, 241];
const scoresheetPale: Rgb = [249, 251, 250];
const scoresheetMaxRosterRows = 15;
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

function scoresheetRotationPlayers(team: DiceTeamCard): DicePlayerCard[] {
  const groups = scoresheetPlayerGroups(team);
  return [...groups.starters, ...[...groups.bench].sort((a, b) => b.minutes - a.minutes)].slice(0, scoresheetMaxRosterRows);
}

function setPdfFill(doc: PdfDoc, color: Rgb): void {
  doc.setFillColor(color[0], color[1], color[2]);
}

function setPdfStroke(doc: PdfDoc, color: Rgb): void {
  doc.setDrawColor(color[0], color[1], color[2]);
}

function setPdfText(doc: PdfDoc, color: Rgb): void {
  doc.setTextColor(color[0], color[1], color[2]);
}

function drawRightText(doc: PdfDoc, text: string, rightX: number, y: number): void {
  text = pdfSafeText(text);
  doc.text(text, rightX - doc.getTextWidth(text), y);
}

function drawCenteredText(doc: PdfDoc, text: string, x: number, y: number, width: number): void {
  text = pdfSafeText(text);
  doc.text(text, x + (width - doc.getTextWidth(text)) / 2, y);
}

function drawClippedText(doc: PdfDoc, value: string, x: number, y: number, maxWidth: number): void {
  value = pdfSafeText(value);
  if (doc.getTextWidth(value) <= maxWidth) {
    doc.text(value, x, y);
    return;
  }

  let clipped = value;
  while (clipped.length > 1 && doc.getTextWidth(`${clipped}...`) > maxWidth) {
    clipped = clipped.slice(0, -1);
  }
  doc.text(`${clipped}...`, x, y);
}

function pdfSafeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "");
}

function drawScoresheetField(doc: PdfDoc, label: string, value: string, x: number, y: number, width: number, height: number): void {
  setPdfStroke(doc, scoresheetLine);
  doc.setLineWidth(0.55);
  doc.rect(x, y, width, height);
  setPdfText(doc, scoresheetMuted);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(5.4);
  doc.text(label.toUpperCase(), x + 3, y + 6.6);
  setPdfText(doc, scoresheetInk);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.2);
  drawClippedText(doc, value, x + 3, y + height - 4.5, width - 6);
}

function drawScoresByPeriodsBox(doc: PdfDoc, matchup: MatchupCard, x: number, y: number, width: number, height: number): void {
  const titleHeight = 11;
  const headerHeight = 11;
  const labelWidth = 34;
  const scoreRowHeight = (height - titleHeight - headerHeight) / 2;
  const periodLabels = ["Q1", "Q2", "Q3", "Q4", "OT", "Final"];
  const periodWidth = (width - labelWidth) / periodLabels.length;

  setPdfStroke(doc, scoresheetLine);
  doc.setLineWidth(0.65);
  doc.rect(x, y, width, height);
  setPdfFill(doc, scoresheetSoft);
  doc.rect(x, y, width, titleHeight, "F");
  doc.line(x, y + titleHeight, x + width, y + titleHeight);
  doc.line(x, y + titleHeight + headerHeight, x + width, y + titleHeight + headerHeight);
  doc.line(x + labelWidth, y + titleHeight, x + labelWidth, y + height);

  setPdfText(doc, scoresheetInk);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.7);
  drawCenteredText(doc, "SCORING BY PERIODS", x, y + 8, width);

  doc.setFontSize(5.7);
  periodLabels.forEach((label, index) => {
    const cellX = x + labelWidth + index * periodWidth;
    doc.line(cellX, y + titleHeight, cellX, y + height);
    drawCenteredText(doc, label, cellX, y + titleHeight + 7.3, periodWidth);
  });
  doc.line(x + width, y + titleHeight, x + width, y + height);
  doc.line(x, y + titleHeight + headerHeight + scoreRowHeight, x + width, y + titleHeight + headerHeight + scoreRowHeight);

  doc.setFontSize(6.4);
  drawCenteredText(doc, "A", x, y + titleHeight + headerHeight + 10, labelWidth);
  drawCenteredText(doc, "B", x, y + titleHeight + headerHeight + scoreRowHeight + 10, labelWidth);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.4);
  drawClippedText(doc, matchup.away.abbr, x + 3, y + height - scoreRowHeight - 1.8, labelWidth - 6);
  drawClippedText(doc, matchup.home.abbr, x + 3, y + height - 2, labelWidth - 6);
}

function drawScoresheetHeader(doc: PdfDoc, matchup: MatchupCard): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  const scoreBoxWidth = 226;
  const scoreBoxX = pageWidth - scoresheetMargin - scoreBoxWidth;

  setPdfText(doc, scoresheetInk);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("OFFICIAL SCORESHEET", scoresheetMargin, 25);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.2);
  doc.text(`${matchup.away.shortName} at ${matchup.home.shortName}`, scoresheetMargin, 39);
  setPdfText(doc, scoresheetMuted);
  doc.setFontSize(6.8);
  doc.text(`Context: ${matchup.context.label}  |  Possessions/team: ${matchup.possessionsEach}  |  Q targets: ${matchup.quarters.join(" / ")}  |  OT: ${matchup.overtimePossessionsEach}`, scoresheetMargin, 51);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(5.8);
  setPdfText(doc, scoresheetInk);
  doc.text("SHOT MARKS", scoresheetMargin, 62);
  doc.setFont("helvetica", "normal");
  setPdfText(doc, scoresheetMuted);
  doc.text("2, 3, F = made   |   2x, 3x, Fx = missed   |   continue crowded player cells on the overflow line", scoresheetMargin + 46, 62);
  drawScoresByPeriodsBox(doc, matchup, scoreBoxX, 16, scoreBoxWidth, 50);

  const fieldY = 70;
  const fieldHeight = 22;
  const fieldWidths = [138, 70, 58, 162, 108, 108, 112];
  const fieldLabels = ["Competition", "Date", "Time", "Site", "Scorer", "Timer", "Referee"];
  const fieldValues = ["Basketball Dice Studio", "", "", "", "", "", ""];
  let currentX = scoresheetMargin;
  fieldLabels.forEach((label, index) => {
    drawScoresheetField(doc, label, fieldValues[index], currentX, fieldY, fieldWidths[index], fieldHeight);
    currentX += fieldWidths[index];
  });
}

function drawMiniBoxes(doc: PdfDoc, x: number, y: number, count: number, size: number, gap: number): void {
  for (let index = 0; index < count; index += 1) {
    doc.rect(x + index * (size + gap), y, size, size);
  }
}

function drawTeamControlStrip(doc: PdfDoc, matchup: MatchupCard, x: number, y: number, width: number, height: number): void {
  setPdfStroke(doc, scoresheetLine);
  doc.setLineWidth(0.45);
  doc.rect(x, y, width, height);
  setPdfText(doc, scoresheetInk);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(5.8);
  doc.text("TIME-OUTS", x + 5, y + 8);
  doc.text("TEAM FOULS", x + 102, y + 8);
  doc.text("PACE / POSSESSIONS", x + width - 94, y + 8);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(5);
  doc.text("Full", x + 5, y + 18);
  drawMiniBoxes(doc, x + 27, y + 12, 4, 8, 2);
  doc.text("30", x + 5, y + 30);
  drawMiniBoxes(doc, x + 27, y + 24, 2, 8, 2);
  doc.text("OT", x + 53, y + 30);
  drawMiniBoxes(doc, x + 68, y + 24, 1, 8, 2);

  const foulBoxSize = 5.6;
  const periodStartX = x + 102;
  ["Q1", "Q2", "Q3", "Q4"].forEach((label, index) => {
    const rowX = periodStartX + index * 47;
    doc.setFont("helvetica", "bold");
    doc.text(label, rowX, y + 20);
    doc.setFont("helvetica", "normal");
    drawMiniBoxes(doc, rowX + 12, y + 14, 5, foulBoxSize, 1.1);
  });

  setPdfText(doc, scoresheetMuted);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.5);
  doc.text(`Q: ${matchup.quarters.join("/")}`, x + width - 94, y + 19);
  doc.text(`Game: ${matchup.possessionsEach} each`, x + width - 94, y + 30);
  setPdfText(doc, scoresheetInk);
}

function drawRosterTable(doc: PdfDoc, team: DiceTeamCard, x: number, y: number, width: number, height: number): void {
  const players = scoresheetRotationPlayers(team);
  const starters = new Set(scoresheetPlayerGroups(team).starters.map((player) => player.id));
  const headerHeight = 12.5;
  const totalRows = scoresheetMaxRosterRows + 1;
  const rowHeight = (height - headerHeight) / totalRows;
  const fixedWidth = 22 + 16 + 52 + 46 + 46 + 46 + 46 + 38 + 24;
  const playerWidth = width - fixedWidth;
  const columns = [
    { label: "No.", width: 22, align: "center" as const },
    { label: "Player", width: playerWidth, align: "left" as const },
    { label: "In", width: 16, align: "center" as const },
    { label: "Fouls", width: 52, align: "center" as const },
    { label: "Q1", width: 46, align: "center" as const },
    { label: "Q2", width: 46, align: "center" as const },
    { label: "Q3", width: 46, align: "center" as const },
    { label: "Q4", width: 46, align: "center" as const },
    { label: "OT", width: 38, align: "center" as const },
    { label: "TP", width: 24, align: "center" as const }
  ];

  setPdfStroke(doc, scoresheetLine);
  doc.setLineWidth(0.45);
  doc.rect(x, y, width, height);
  setPdfFill(doc, scoresheetSoft);
  doc.rect(x, y, width, headerHeight, "F");

  let colX = x;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(5.7);
  setPdfText(doc, scoresheetInk);
  columns.forEach((column) => {
    doc.line(colX, y, colX, y + height);
    if (column.align === "left") {
      doc.text(column.label, colX + 3, y + 8.2);
    } else {
      drawCenteredText(doc, column.label, colX, y + 8.2, column.width);
    }
    colX += column.width;
  });
  doc.line(x + width, y, x + width, y + height);
  doc.line(x, y + headerHeight, x + width, y + headerHeight);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.5);
  Array.from({ length: totalRows }).forEach((_, rowIndex) => {
    const rowY = y + headerHeight + rowIndex * rowHeight;
    const nextY = rowY + rowHeight;
    if (rowIndex % 2 === 0) {
      setPdfFill(doc, scoresheetPale);
      doc.rect(x, rowY, width, rowHeight, "F");
    }
    doc.line(x, nextY, x + width, nextY);

    const player = rowIndex < scoresheetMaxRosterRows ? players[rowIndex] : undefined;
    const isTotalsRow = rowIndex === scoresheetMaxRosterRows;
    colX = x;
    columns.forEach((column, colIndex) => {
      if (colIndex > 0) doc.line(colX, rowY, colX, nextY);
      if (column.label === "Fouls") {
        const slotWidth = column.width / 5;
        for (let slotIndex = 1; slotIndex < 5; slotIndex += 1) {
          doc.line(colX + slotIndex * slotWidth, rowY, colX + slotIndex * slotWidth, nextY);
        }
      }

      if (isTotalsRow) {
        if (colIndex === 1) {
          doc.setFont("helvetica", "bold");
          drawClippedText(doc, "TEAM TOTALS", colX + 3, rowY + rowHeight - 2, column.width - 6);
          doc.setFont("helvetica", "normal");
        }
      } else if (player) {
        if (colIndex === 0) drawCenteredText(doc, player.source.roster.number || "", colX, rowY + rowHeight - 2, column.width);
        if (colIndex === 1) drawClippedText(doc, player.name, colX + 3, rowY + rowHeight - 2, column.width - 6);
        if (colIndex === 2 && starters.has(player.id)) drawCenteredText(doc, "S", colX, rowY + rowHeight - 2, column.width);
      }

      colX += column.width;
    });
  });
}

function drawTeamPanel(doc: PdfDoc, matchup: MatchupCard, team: DiceTeamCard, role: "Team A" | "Team B", x: number, y: number, width: number, height: number): void {
  const headerHeight = 16;
  const controlHeight = 38;
  const footerHeight = 18;
  const rosterX = x + 5;
  const rosterY = y + headerHeight + controlHeight;
  const rosterWidth = width - 10;
  const rosterHeight = height - headerHeight - controlHeight - footerHeight;
  const extraPlayers = Math.max(0, team.players.length - scoresheetMaxRosterRows);

  setPdfStroke(doc, scoresheetLine);
  doc.setLineWidth(0.8);
  doc.rect(x, y, width, height);
  setPdfFill(doc, scoresheetInk);
  doc.rect(x, y, width, headerHeight, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  doc.text(`${role}  ${team.shortName}`, x + 6, y + 10.8);
  doc.setFontSize(6.4);
  drawRightText(doc, team.season, x + width - 6, y + 10.5);

  drawTeamControlStrip(doc, matchup, x, y + headerHeight, width, controlHeight);
  drawRosterTable(doc, team, rosterX, rosterY, rosterWidth, rosterHeight);

  const footerY = y + height - footerHeight;
  setPdfStroke(doc, scoresheetLine);
  doc.line(x, footerY, x + width, footerY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(5.7);
  setPdfText(doc, scoresheetInk);
  doc.text("Coach", x + 6, footerY + 7);
  doc.line(x + 30, footerY + 7, x + 142, footerY + 7);
  doc.text("Asst.", x + 6, footerY + 15);
  doc.line(x + 30, footerY + 15, x + 142, footerY + 15);
  doc.text("Overflow", x + 158, footerY + 7);
  doc.line(x + 201, footerY + 7, x + width - 8, footerY + 7);
  doc.text("Notes", x + 158, footerY + 15);
  doc.line(x + 201, footerY + 15, x + width - 8, footerY + 15);
  if (extraPlayers) {
    setPdfText(doc, scoresheetMuted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.4);
    drawRightText(doc, `Top ${scoresheetMaxRosterRows} rotation spots; +${extraPlayers} reserves`, x + width - 6, footerY + 12);
  }
}

function drawRunningScoreGrid(doc: PdfDoc, matchup: MatchupCard, x: number, y: number, width: number, height: number): void {
  const groupCount = 4;
  const rowsPerGroup = 40;
  const titleHeight = 16;
  const headerHeight = 11;
  const rowHeight = (height - titleHeight - headerHeight) / rowsPerGroup;
  const groupWidth = width / groupCount;
  const cellWidth = groupWidth / 2;

  setPdfStroke(doc, scoresheetLine);
  doc.setLineWidth(0.7);
  doc.rect(x, y, width, height);
  setPdfFill(doc, scoresheetSoft);
  doc.rect(x, y, width, titleHeight, "F");
  doc.line(x, y + titleHeight, x + width, y + titleHeight);
  setPdfText(doc, scoresheetInk);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  drawCenteredText(doc, "RUNNING SCORE", x, y + 10.8, width);

  doc.setFontSize(5.7);
  drawClippedText(doc, `A ${matchup.away.abbr}`, x + 4, y + 10.7, 50);
  drawRightText(doc, `B ${matchup.home.abbr}`, x + width - 4, y + 10.7);

  const gridY = y + titleHeight;
  doc.line(x, gridY + headerHeight, x + width, gridY + headerHeight);
  for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
    const groupX = x + groupIndex * groupWidth;
    doc.line(groupX, gridY, groupX, y + height);
    doc.line(groupX + cellWidth, gridY, groupX + cellWidth, y + height);
    doc.setFont("helvetica", "bold");
    drawCenteredText(doc, "A", groupX, gridY + 7.5, cellWidth);
    drawCenteredText(doc, "B", groupX + cellWidth, gridY + 7.5, cellWidth);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.3);
    for (let rowIndex = 0; rowIndex < rowsPerGroup; rowIndex += 1) {
      const score = groupIndex * rowsPerGroup + rowIndex + 1;
      const rowY = gridY + headerHeight + rowIndex * rowHeight;
      if (rowIndex % 5 === 0) {
        setPdfFill(doc, scoresheetPale);
        doc.rect(groupX, rowY, groupWidth, rowHeight, "F");
      }
      doc.line(groupX, rowY + rowHeight, groupX + groupWidth, rowY + rowHeight);
      drawCenteredText(doc, String(score), groupX, rowY + rowHeight - 2.1, cellWidth);
      drawCenteredText(doc, String(score), groupX + cellWidth, rowY + rowHeight - 2.1, cellWidth);
    }
  }
  doc.line(x + width, gridY, x + width, y + height);
}

function drawPossessionTrackerBox(doc: PdfDoc, matchup: MatchupCard, x: number, y: number, width: number, height: number): void {
  const target = Math.max(1, Math.ceil(matchup.possessionsEach));
  const segmentSize = 50;
  const segments = Math.ceil(target / segmentSize);
  const rowCount = segments * 2;
  const titleHeight = 12;
  const labelWidth = 52;
  const gridX = x + labelWidth;
  const gridWidth = width - labelWidth - 7;
  const rowStep = (height - titleHeight - 4) / rowCount;
  const boxGap = 1;
  const boxSize = Math.min(6.6, (gridWidth - boxGap * (segmentSize - 1)) / segmentSize, rowStep - 2);

  setPdfStroke(doc, scoresheetLine);
  doc.setLineWidth(0.55);
  doc.rect(x, y, width, height);
  setPdfFill(doc, scoresheetSoft);
  doc.rect(x, y, width, titleHeight, "F");
  setPdfText(doc, scoresheetInk);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6);
  drawCenteredText(doc, "POSSESSION COUNT", x, y + 8, width);

  const teams = [
    { label: `A ${matchup.away.abbr}`, offset: 0 },
    { label: `B ${matchup.home.abbr}`, offset: segments }
  ];

  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.2);
  teams.forEach((team) => {
    for (let segmentIndex = 0; segmentIndex < segments; segmentIndex += 1) {
      const start = segmentIndex * segmentSize + 1;
      const end = Math.min(target, start + segmentSize - 1);
      const count = end - start + 1;
      const rowIndex = team.offset + segmentIndex;
      const rowY = y + titleHeight + 4 + rowIndex * rowStep;
      doc.text(`${team.label} ${start}-${end}`, x + 5, rowY + boxSize - 1.1);
      for (let boxIndex = 0; boxIndex < count; boxIndex += 1) {
        const boxX = gridX + boxIndex * (boxSize + boxGap);
        doc.rect(boxX, rowY, boxSize, boxSize);
        if ((boxIndex + 1) % 10 === 0 && boxIndex + 1 < count) {
          doc.setLineWidth(0.75);
          doc.line(boxX + boxSize + boxGap / 2, rowY - 1, boxX + boxSize + boxGap / 2, rowY + boxSize + 1);
          doc.setLineWidth(0.55);
        }
      }
    }
  });
}

function drawFinalScoreBox(doc: PdfDoc, matchup: MatchupCard, x: number, y: number, width: number, height: number): void {
  setPdfStroke(doc, scoresheetLine);
  doc.setLineWidth(0.55);
  doc.rect(x, y, width, height);
  setPdfFill(doc, scoresheetSoft);
  doc.rect(x, y, width, 12, "F");
  setPdfText(doc, scoresheetInk);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6);
  drawCenteredText(doc, "FINAL APPROVAL", x, y + 8, width);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.8);
  const lineStart = x + 52;
  const lineEnd = x + width - 6;
  const rows = [
    [`Team A ${matchup.away.abbr}`, y + 25],
    [`Team B ${matchup.home.abbr}`, y + 39],
    ["Winning team", y + 56],
    ["Referee", y + 72]
  ] as const;
  rows.forEach(([label, rowY]) => {
    doc.text(label, x + 6, rowY);
    doc.line(lineStart, rowY, lineEnd, rowY);
  });
}

function drawScoresheetFooter(doc: PdfDoc, matchup: MatchupCard, y: number): void {
  drawPossessionTrackerBox(doc, matchup, scoresheetMargin, y, 562, 78);
  drawFinalScoreBox(doc, matchup, 592, y, doc.internal.pageSize.getWidth() - 592 - scoresheetMargin, 78);
}

function drawOfficialScoresheet(doc: PdfDoc, matchup: MatchupCard): void {
  drawScoresheetHeader(doc, matchup);
  const mainY = 99;
  const teamPanelX = scoresheetMargin;
  const teamPanelWidth = 476;
  const teamPanelHeight = 197;
  const teamPanelGap = 8;
  const runningScoreX = teamPanelX + teamPanelWidth + 10;
  const runningScoreWidth = doc.internal.pageSize.getWidth() - runningScoreX - scoresheetMargin;
  const runningScoreHeight = teamPanelHeight * 2 + teamPanelGap;

  drawTeamPanel(doc, matchup, matchup.away, "Team A", teamPanelX, mainY, teamPanelWidth, teamPanelHeight);
  drawTeamPanel(doc, matchup, matchup.home, "Team B", teamPanelX, mainY + teamPanelHeight + teamPanelGap, teamPanelWidth, teamPanelHeight);
  drawRunningScoreGrid(doc, matchup, runningScoreX, mainY, runningScoreWidth, runningScoreHeight);
  drawScoresheetFooter(doc, matchup, mainY + runningScoreHeight + 9);
}

function drawScoresheets(doc: PdfDoc, autoTable: AutoTable, matchup: MatchupCard): void {
  void autoTable;
  drawOfficialScoresheet(doc, matchup);
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
