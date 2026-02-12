# Checkers (American/English Draughts Baseline)

## Objective
Capture all opponent pieces or leave them with no legal moves.

## Setup
- 8×8 board, use dark squares only.
- 12 pieces per side on the three closest rows.

## Movement (Men)
- Move 1 square diagonally forward.
- Cannot move backward.

## Captures
- Jump diagonally over adjacent enemy into empty square.
- **Captures are mandatory** if available.
- **Multi-jumps** must be completed in one turn.

## Kings
- A man reaching the far row is kinged.
- Kings move and capture diagonally forward/backward.
- **V1 choice**: kinging ends the turn (standard tournament rule).

## Variants to Decide
- Maximum-capture rule (usually no in American).
- “Crown and continue” vs end turn (choose end turn for V1).
