# Solitaire (Klondike Baseline)

## Objective
Move all cards to 4 foundations (one per suit) built Ace → King.

## Layout
- **Foundations**: start empty, build by suit A→K.
- **Tableau**: 7 piles, dealt 1–7 cards with top face up.
- **Stock**: remaining face-down draw pile.
- **Waste**: face-up discard pile from stock.

## Core Moves
- **Tableau build**: descending rank, alternating colors.
- **Move sequences**: any properly ordered face-up run may move together.
- **Empty tableau**: only King (or sequence starting with King) may be placed.
- **Flip**: when a face-down card is exposed, flip it immediately.
- **Foundations**: build up by suit.

## Stock Rules (Choose)
- **Draw 1** (easier) or **Draw 3** (harder).
- **Redeals**: unlimited, 3, 1, or none.

## Win/Lose
- Win when all cards are in foundations.
- Lose when no moves remain and stock redeals are exhausted.

## Variants to Decide (V1)
- Draw 1 vs Draw 3.
- Redeal limit.
- Allow moving cards back from foundation to tableau (usually allowed in apps).
