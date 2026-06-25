import type { DiceTeamCard, MatchupCard } from "./types";

type PdfDoc = InstanceType<typeof import("jspdf").jsPDF>;
type AutoTable = typeof import("jspdf-autotable").default;

const scoreColumns = ["PTS", "FGM", "FGA", "3PM", "3PA", "FTM", "FTA", "OREB", "DREB", "AST", "STL", "BLK", "TOV", "PF"];

function fileSafe(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
}

function drawHeader(doc: PdfDoc, matchup: MatchupCard, team: DiceTeamCard): void {
  const opponent = team.id === matchup.away.id ? matchup.home : matchup.away;
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFillColor(28, 37, 34);
  doc.rect(0, 0, pageWidth, 42, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(`${team.shortName} Expanded Scoresheet`, 28, 25);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Opponent: ${opponent.shortName}`, pageWidth - 205, 18);
  doc.text(`Possessions: ${matchup.possessionsEach}`, pageWidth - 205, 31);

  doc.setTextColor(28, 37, 34);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  const quarterText = `Quarter targets: Q1 ${matchup.quarters[0]} / Q2 ${matchup.quarters[1]} / Q3 ${matchup.quarters[2]} / Q4 ${matchup.quarters[3]}`;
  doc.text(quarterText, 28, 58);

  doc.setFont("helvetica", "normal");
  doc.text("Manual tally boxes are intentionally large for tabletop tracking.", pageWidth - 300, 58);
}

function drawTeamScoresheet(doc: PdfDoc, autoTable: AutoTable, matchup: MatchupCard, team: DiceTeamCard): void {
  drawHeader(doc, matchup, team);

  const rows = [
    ...team.players.map((player) => [player.name, ...scoreColumns.map(() => "")]),
    ["Team Totals", ...scoreColumns.map(() => "")]
  ];

  autoTable(doc, {
    startY: 70,
    head: [["Player", ...scoreColumns]],
    body: rows,
    theme: "grid",
    margin: { left: 28, right: 28 },
    tableWidth: "auto",
    styles: {
      font: "helvetica",
      fontSize: 8,
      cellPadding: 3,
      lineColor: [160, 166, 162],
      lineWidth: 0.5,
      minCellHeight: 24,
      valign: "middle"
    },
    headStyles: {
      fillColor: [31, 45, 40],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      halign: "center"
    },
    columnStyles: {
      0: {
        cellWidth: 128,
        fontStyle: "bold",
        halign: "left"
      }
    },
    alternateRowStyles: {
      fillColor: [247, 249, 248]
    },
    didParseCell: (data) => {
      if (data.section === "body" && data.row.index === rows.length - 1) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = [238, 243, 239];
      }
    }
  });
}

export async function exportScoresheetsPdf(matchup: MatchupCard): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "pt",
    format: "letter"
  });

  drawTeamScoresheet(doc, autoTable, matchup, matchup.away);
  doc.addPage();
  drawTeamScoresheet(doc, autoTable, matchup, matchup.home);

  const filename = `${fileSafe(matchup.away.shortName)}_at_${fileSafe(matchup.home.shortName)}_scoresheets.pdf`;
  doc.save(filename);
}
