# Basketball Dice Studio

Local-first tabletop basketball dice game studio.

## Download The App

If you just want to play, you do not need to install developer tools, use the
green **Code** button, or download the source code.

1. Open the latest release page:
   https://github.com/arcorley/basketball-dice-studio/releases/latest
2. Find the **Assets** section near the bottom of the release.
3. Download the file for your computer:
   - **macOS:** download the `.dmg` file. Use `mac-arm64` for newer Apple
     Silicon Macs. Use `mac-x64` for older Intel Macs if that file is available.
   - **Windows:** download the `.exe` installer. If you prefer not to install
     it, download the Windows `.zip` file if one is available.
   - **Linux:** download the `.AppImage` for a portable app, or the `.deb`
     package for Debian/Ubuntu-based systems.
4. Do not download **Source code (zip)** or **Source code (tar.gz)** unless you
   are a developer. Those files are not the ready-to-run app.

### macOS

1. Open the downloaded `.dmg` file.
2. Drag **Basketball Dice Studio** into the **Applications** folder if prompted.
3. Open **Basketball Dice Studio** from Applications.
4. If macOS says the app is from an unidentified developer, right-click the app,
   choose **Open**, then choose **Open** again. Only do this for downloads from
   the official release page above.

### Windows

1. Open the downloaded `.exe` installer.
2. Follow the installer steps.
3. Open **Basketball Dice Studio** from the Start menu or desktop shortcut.
4. If Windows SmartScreen says it protected your PC, choose **More info**, then
   **Run anyway**. Only do this for downloads from the official release page
   above.

The app saves your tournament and season progress on your own computer.

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

## Desktop Packaging

The app can also run as a packaged Electron desktop app for macOS, Windows, and
Linux.
The desktop shell serves the built Vite app locally and stores tournament/season
state in the OS app-data directory, so packaged builds do not require Python or
a dev server at runtime.

```bash
npm run desktop:dev       # run the Vite app inside Electron
npm run desktop:pack      # create an unpacked local desktop app in release/
npm run desktop:dist      # build installers/packages for the current OS
npm run desktop:dist:mac  # build macOS dmg/zip artifacts
npm run desktop:dist:win  # build Windows nsis/zip artifacts
npm run desktop:dist:linux # build Linux AppImage/deb/tar.gz artifacts
```

For distributable installers, build on the target OS or in target-specific CI.
Default macOS builds are unsigned; configure signing and notarization before
shipping outside local testing. The generated desktop artifacts are written to
`release/`.

## Release Tooling

Release assets are built with Electron Builder on native GitHub Actions runners:
macOS produces `.dmg` and `.zip`, Windows produces `.exe` and `.zip`, and Linux
produces `.AppImage`, `.deb`, and `.tar.gz`.

To cut a release through CI, push a version tag or run the **Release** workflow
manually:

```bash
git tag v0.6.0
git push origin v0.6.0
```

Tag pushes publish a GitHub release immediately. Manual workflow runs default to
a draft release so the assets can be checked before publishing.

Local release commands are available for testing or emergency publishing:

```bash
npm run release:build:mac
npm run release:build:win
npm run release:build:linux
npm run release:github -- --tag v0.6.0 --asset-dir release
```

Run each platform build on its target OS. The `release:github` command requires
the GitHub CLI (`gh`) to be installed and authenticated; if the release already
exists, it uploads matching assets with `--clobber`.

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
npm run desktop:dev
npm run desktop:pack
npm run desktop:dist
npm run release:build:mac
npm run release:build:win
npm run release:build:linux
npm run discover:data -- --start-year=1990 --end-year=2025 --use-cache
npm run fetch:data -- --use-cache
npm run data:sqlite
npm run data:export-json
npm run data:validate
npm run data:refresh
```
