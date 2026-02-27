import React from "react";
import { AppFrame } from "../layout/AppFrame";

export function DailySpinPage() {
  const tiles = [
    { label: "Free Spin ready", detail: "Resets every 24h" },
    { label: "Prize tiers", detail: "100–10,000 chips" },
    { label: "Spin wheel", detail: "Randomized seed keeps it deterministic" }
  ];

  return (
    <AppFrame
      header={
        <div className="hud-bar">
          <div className="hud-center">
            <div className="hud-pill hud-pill--center">Daily Spin</div>
          </div>
        </div>
      }
      footer={
        <div className="panel px-3 py-2 text-center">
          <div className="text-sm text-white/70">Tap “Spin” when ready, prizes pop up at center.</div>
        </div>
      }
    >
      <div className="spin-page flex flex-col flex-1 gap-6 px-4">
        <div className="panel flex-1 p-4 flex flex-col gap-3 justify-center">
          <div className="text-lg font-bold text-center">Daily Spin</div>
          <div className="text-sm text-white/60 text-center">
            Automatic spin every 24 hours. Any chip prize appears in the win overlay.
          </div>
        </div>

        <div className="panel p-3">
          <div className="grid grid-cols-1 gap-2">
            {tiles.map((tile) => (
              <div
                key={tile.label}
                className="panel px-3 py-2 flex flex-col gap-1 text-sm rounded-xl border border-white/10"
              >
                <span className="font-semibold">{tile.label}</span>
                <span className="text-white/60">{tile.detail}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel p-4 flex justify-center">
          <button className="spin-cta-btn" type="button">
            Spin
          </button>
        </div>
      </div>
    </AppFrame>
  );
}
