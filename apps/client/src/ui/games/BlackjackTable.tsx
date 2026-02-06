// apps/client/src/ui/games/BlackjackTable.tsx
import React from "react";
import { useApp } from "../../state/store";

export function BlackjackTable() {
  const { publicState } = useApp();

  const dealerCount = publicState?.dealerCardsCount ?? 0;
  const dealerUp = publicState?.dealerUpCard ?? null;

  return (
    <div className="h-full w-full flex flex-col">
      <div className="flex-1 min-h-0 grid grid-rows-2 gap-2">
        <div className="panel p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="font-bold">Dealer</div>
            <div className="text-xs text-white/60">{publicState?.phase === "playerTurn" ? "Upcard only" : "Revealed"}</div>
          </div>
          <div className="flex items-center gap-2 overflow-hidden">
            <CardFace label={dealerUp ? dealerUp : "??"} />
            {Array.from({ length: Math.max(0, dealerCount - 1) }).map((_, i) => (
              <CardBack key={i} />
            ))}
          </div>
        </div>

        <div className="panel p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="font-bold">You</div>
            <div className="text-xs text-white/60">
              Total: <span className="font-semibold text-white">{publicState?.playerTotal ?? 0}</span>{" "}
              {publicState?.playerSoft ? "(soft)" : ""}
            </div>
          </div>
          <div className="flex items-center gap-2 overflow-hidden">
            {(publicState?.playerCards ?? []).map((c: string, i: number) => (
              <CardFace key={i} label={c} />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-2 text-[11px] text-white/50 px-1">
        Blackjack baseline: multi-deck shoe, S17, dealer scripted. :contentReference[oaicite:5]{index=5}
      </div>
    </div>
  );
}

function CardFace({ label }: { label: string }) {
  return (
    <div className="h-16 w-12 rounded-xl bg-white/10 border border-white/15 grid place-items-center font-black tracking-tight">
      {label}
    </div>
  );
}

function CardBack() {
  return (
    <div className="h-16 w-12 rounded-xl bg-gradient-to-b from-fuchsia-500/20 to-cyan-400/10 border border-white/15" />
  );
}
