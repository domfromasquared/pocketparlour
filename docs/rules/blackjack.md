# Blackjack (Baseline Rules)

This document captures the baseline rules and options described in the provided rules text. The server implementation should follow the **V1 Choices** section unless overridden.

## Objective
- Beat the dealer by getting closer to 21 without busting.
- Number cards are face value, J/Q/K = 10, Ace = 1 or 11.
- A **soft** hand has an Ace counted as 11; **hard** does not.

## Round Flow
1. **Bets**: players place stakes.
2. **Deal**:
   - **Hole-card (US)**: dealer gets 2 cards (1 up, 1 down).
   - **No-hole-card (EU)**: dealer gets 1 card up, second card after players act.
3. **Dealer Blackjack Check**:
   - With Ace up (and often 10 up), dealer may peek in hole-card games.
4. **Player Actions** (one hand at a time).
5. **Dealer Plays** (fixed rules).
6. **Settle**: compare totals.

## Player Actions
- **Hit**: take a card, repeat until stand or bust.
- **Stand**: take no more cards.
- **Double**: double bet, take exactly 1 card, then stand.
  - Variations: double on any 2, only 9–11, only 10–11, double after split (DAS).
- **Split**: if first two cards are same rank, split into two hands, add equal bet.
  - Variations: resplit limits, split aces rules, DAS.
- **Surrender** (if offered):
  - Late surrender (after dealer checks), or early surrender (rare).
- **Insurance** (if dealer shows Ace): side bet paying 2:1 if dealer has blackjack.

## Dealer Rules
- Dealer must hit until at least 17.
- **S17 vs H17**:
  - **S17**: stand on soft 17.
  - **H17**: hit soft 17.
- Dealer does not choose; they follow house rules.

## Outcomes & Payouts
- Win: 1:1
- Blackjack:
  - **3:2** (player friendly) or **6:5** (worse)
- Push: bet returned
- Bust: lose immediately

## Rule Variations (Impactful)
- 3:2 vs 6:5 payouts (largest impact)
- S17 vs H17
- Number of decks
- Double rules & DAS
- Surrender availability
- Hole-card vs no-hole-card

## V1 Choices (Current Implementation)
- 6-deck shoe
- Dealer **stands on soft 17** (S17)
- Actions: **Hit, Stand, Double** (no split/insurance/surrender yet)
- Single-player vs house
- Stake model:
  - Win: +2x stake payout (net +stake)
  - Push: refund stake
  - Lose: lose stake

## Future Extensions
- Add splits, insurance, surrender
- Enable multi-seat tables
- Add dealer peek rules for hole-card version
