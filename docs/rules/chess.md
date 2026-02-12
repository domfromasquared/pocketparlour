# Chess (Standard Rules)

## Objective
Checkmate the opponent’s king.

## Board & Setup
- 8×8 board. White moves first.
- “White on right” orientation.
- Standard initial setup.

## Piece Movement
- **King**: 1 square any direction.
- **Queen**: any distance orthogonal or diagonal.
- **Rook**: any distance orthogonal.
- **Bishop**: any distance diagonal.
- **Knight**: L-shape (2+1), can jump.
- **Pawn**: forward 1 (or 2 from start), captures diagonally.

## Special Moves
- **Castling**: king + rook, only if neither moved, no pieces between, and king not in or through check.
- **En passant**: immediate capture of a pawn that advanced two squares.
- **Promotion**: pawn reaching last rank becomes Q/R/B/N.

## Check/Checkmate/Stalemate
- You may not leave your king in check.
- Checkmate ends the game.
- Stalemate (no legal moves, king not in check) is a draw.

## Draws
Agreement, stalemate, threefold repetition, 50-move rule, insufficient material, or time rules.

## V1 Notes
If implementing as a plugin, start with legal move generation and check/checkmate detection before clocks and advanced draw claims.
