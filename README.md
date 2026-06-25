# Basketball Dice Studio

Local-first tabletop basketball dice game studio.

## v0.6 Direction

The repository root is now the v0.6 local web app. The original v0.5.1
print-and-play package is archived at `legacy/v0.5.1`.

The app is source-first:

- Team and player inputs are fetched from Basketball Reference pages listed in
  `data/source-manifest.json`.
- Raw page table extracts are cached in `src/data/bbr/raw`.
- Normalized app data is generated at `src/data/teams.generated.json`.
- The dice engine keeps the v0.5 possession model: possession counts, loose
  fouls, usage rolls, turnover/foul/shot action ranges, shot type rolls,
  make rolls, assists, blocks, rebounds, offensive-rebound extensions, and
  stat assignment tables.
- Matchup scoresheets can be exported directly to a two-page landscape PDF for
  printing.

## Setup

```bash
npm install
npm run fetch:data
npm run dev
```

Open the printed local URL to use the app.

## Data Fetching

`npm run fetch:data` uses the `agent-browser` CLI to open each Basketball
Reference team-season page, extract all rendered stat tables, write raw JSON,
and regenerate the normalized offline data bundle.

Initial source teams:

- 2024-25 Oklahoma City Thunder
- 2024-25 New York Knicks
- 2024-25 Boston Celtics
- 2024-25 Denver Nuggets
- 1992-93 Phoenix Suns
- 1992-93 Chicago Bulls
- 2020-21 Phoenix Suns
- 2020-21 Milwaukee Bucks

## Scripts

```bash
npm run dev        # start local app
npm run build      # type-check and build
npm run preview    # preview production build
npm run fetch:data # refresh Basketball Reference source cache
```
