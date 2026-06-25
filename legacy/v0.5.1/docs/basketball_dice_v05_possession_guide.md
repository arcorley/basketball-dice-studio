# Basketball Dice v0.4 - Clear Possession Procedure

Use this with the v0.4 cards. The key rule is: **mark one possession at the start, then resolve until the possession ends. Offensive rebounds continue the same possession and do not add a new possession.**

## One possession

### Step 1 - Mark possession
Add one possession to the offense. For Thunder at Knicks, use 98 possessions per team: 25 / 25 / 24 / 24 by quarter.

### Step 2 - Loose foul check
Roll d100.

- 01-07: defensive non-shooting foul. Assign PF using the defense PF table. Continue.
- 08-100: no foul. Continue.

No bonus free throws in v0.4.

### Step 3 - Pick the offensive player
Roll d100 on the offense Use table. That player is the action player.

### Step 4 - Build the action range

```text
Effective TOV = player TOV + defense TO Press - offense TO Protect
Effective FD  = player FD + offense Foul Draw - defense Foul Disc + 1
```

Roll d100:

```text
01 through TOV         = turnover
next FD numbers        = shooting foul
anything higher        = shot attempt
```

### Step 5A - Turnover

1. Record TOV for the action player and team.
2. Roll d100 for steal check.
3. 01-60 = defense gets a steal. Assign STL using defense STL table.
4. Possession ends.

### Step 5B - Shooting foul

1. Assign defender PF using defense PF table.
2. Shooter gets 2 FTA.
3. Roll each FT separately. Roll <= player FT is made.
4. Record FTA, FTM, points, and team points.
5. Possession ends.

### Step 5C - Shot attempt

First decide shot type:

```text
3PT chance = player 3F + offense 3PT Tend
```

Roll d100. If roll <= 3PT chance, it is a 3PA. Otherwise it is a 2PA.

Then calculate make number:

```text
2P make = player 2P + offense ShotQ - floor(defense DEF / 2) - 1
3P make = player 3P + offense ShotQ - floor(defense DEF / 2) - 1
```

Roll d100. Roll <= make number is made.

### Step 6 - If shot is made

Record FGA, FGM, points, and 3PA/3PM if it was a three.

Assist check:

```text
Made 2 = Team AST
Made 3 = Team AST + 8
```

If assisted, roll on the offense AST table. If the table picks the shooter, reroll until it picks a teammate. Record AST. Possession ends.

### Step 7 - If shot is missed

Record FGA, and 3PA if it was a three.

For missed 2PA only, check block:

```text
Block chance = 7 + defense DEF
```

If blocked, assign BLK using defense BLK table.

Then rebound:

```text
Offensive rebound chance = 27 + offense ORB - defense DRB
```

- If offensive rebound: assign OREB using offense OREB table. Do not add a possession. Go back to Step 2.
- If defensive rebound: assign DREB using defense DREB table. Possession ends.

Maximum offensive rebound extensions: 2.

## End conditions

A possession ends after:

- turnover
- shooting foul free throws
- made field goal
- defensive rebound

A possession does **not** end after:

- non-shooting foul
- offensive rebound
