# Basketball Dice Studio

Local-first tabletop basketball dice game studio.

## v0.6 Direction

The repository root is now the v0.6 local web app. The original v0.5.1
print-and-play package is archived at `legacy/v0.5.1`.

The app is source-first with SQLite as the canonical local store:

- Team and player inputs are discovered and fetched from Basketball Reference pages listed in
  `data/source-manifest.json`.
- Raw page table extracts are cached in `src/data/bbr/raw`.
- Normalized relational data is built at `data/basketball-dice.sqlite`.
- Browser data is exported from SQLite to `public/data/catalog.generated.json`
  plus one `public/data/teams/{teamId}.json` file per team, so the app can load
  only the selected teams.
- `data/teams.generated.json` is still exported as a local derived audit/SQLite
  input artifact, but it is intentionally ignored because the split browser
  files and SQLite database are the committed runtime data.
- The dice engine keeps the v0.5 possession model: possession counts, loose
  fouls, usage rolls, turnover/foul/shot action ranges, shot type rolls,
  make rolls, assists, blocks, rebounds, offensive-rebound extensions, and
  stat assignment tables.
- Matchup scoresheets can be exported directly to a two-page landscape PDF for
  printing.

## Setup

```bash
npm install
npm run data:refresh
npm run dev
```

Open the printed local URL to use the app.

## Data Fetching

`npm run discover:data -- --start-year=1990 --end-year=2025 --use-cache`
discovers the Basketball Reference team-season manifest.

`npm run fetch:data -- --use-cache` uses the `agent-browser` CLI to open each
Basketball Reference team-season page, extract all rendered stat tables, write
raw JSON, and regenerate the normalized offline data bundle.

`npm run data:sqlite` rebuilds the canonical SQLite database from the normalized
bundle. `npm run data:export-json` exports browser catalog/team files plus the
local generated JSON back out of SQLite. `npm run data:validate` checks SQLite,
source coverage, and browser export parity. `npm run data:refresh` runs the full
discover, fetch, SQLite build, export, and validation pipeline.

## Scripts

```bash
npm run dev        # start local app
npm run build      # type-check and build
npm run preview    # preview production build
npm run discover:data -- --start-year=1990 --end-year=2025 --use-cache
npm run fetch:data -- --use-cache
npm run data:sqlite
npm run data:export-json
npm run data:validate
npm run data:refresh
```
