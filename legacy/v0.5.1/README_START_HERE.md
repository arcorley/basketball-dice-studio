# Basketball Dice v0.5.1 Complete Package

This is the current single package. Use it instead of v0.5.

## v0.5.1 possession counter patch

- Added a dedicated Game Control + Possession Counter page to the expanded scoresheets.
- Added Q1/Q2/Q3/Q4/Total/Target possession fields to the team stat pages.
- Added a Possession Counter sheet to the Excel workbook.

## What changed in v0.5

1. Added matchup-specific game cards so you do not calculate static ranges during play.
2. Added expanded paper scoresheets with much larger tally boxes.
3. Regenerated matchup/player/event range CSVs from the current card data.

## Print for your first game

1. `game_cards/prebuilt/Thunder_at_Knicks_game_card.pdf`
2. `print/basketball_dice_v05_1_expanded_scoresheets.pdf`
   - Print the Thunder Shooting page + Thunder Other Stats page.
   - Print the Knicks Shooting page + Knicks Other Stats page.
3. Optional backup: `print/basketball_dice_v05_team_and_player_cards.pdf`
4. Keep `docs/basketball_dice_v05_quick_flow.pdf` next to you.

## What the game card replaces

Use the game card for:
- possession count and quarter split
- offensive rebound chance
- block chance
- assist chance
- player action ranges: turnover / foul / shot
- 3PA chance
- 2P/3P/FT make ranges
- Use/AST/OREB/DREB/STL/BLK/PF assignment ranges

You should not need to calculate these during a game once the matchup is known.

## Generate a new game card

Use the no-dependency HTML generator:

```bash
python tools/generate_game_card.py --away Celtics --home Nuggets --outdir generated_cards
```

Then open the generated `.html` file in your browser and print it landscape.

Available starter teams: Thunder, Knicks, Celtics, Nuggets.

## Files

- `game_cards/prebuilt/Thunder_at_Knicks_game_card.pdf` - first recommended matchup card.
- `game_cards/prebuilt/all_starter_matchup_cards.pdf` - every ordered matchup among starter teams.
- `game_cards/html/Thunder_at_Knicks_game_card.html` - browser-printable version.
- `print/basketball_dice_v05_1_expanded_scoresheets.pdf` - large tally-box scoresheets.
- `tracker/basketball_dice_v05_1_matchup_calculator_and_scorebook.xlsx` - filterable static calc workbook and scorebook template.
- `data/matchup_static_calcs.csv` - precomputed static matchup values.
- `data/matchup_player_ranges.csv` - precomputed player ranges by matchup.
- `data/event_assignment_tables.csv` - regenerated d100 event assignment ranges.
- `tools/generate_game_card.py` - generate matchup cards as HTML/CSV.
- `simulator/basketball_dice_sim_v05.py` - simulator; math unchanged from v0.4.
