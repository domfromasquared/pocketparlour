export const CARD_ASSET_BASE = "/src/ui/assets/cards";

export type SuitCode = "S" | "H" | "D" | "C";
export type RankCode = "A" | "K" | "Q" | "J" | "10" | "9" | "8" | "7" | "6" | "5" | "4" | "3" | "2";

export function cardLabelToAssetName(label: string): string | null {
  // Supports labels like "AS", "10H", "QD", "7C".
  if (!label || label.length < 2) return null;
  const suit = label[label.length - 1] as SuitCode;
  const rank = label.slice(0, label.length - 1) as RankCode;
  if (!["S", "H", "D", "C"].includes(suit)) return null;
  if (!["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2"].includes(rank)) return null;
  return `${rank}${suit}.png`;
}

export function cardLabelToAssetUrl(label: string): string | null {
  const name = cardLabelToAssetName(label);
  if (!name) return null;
  return `${CARD_ASSET_BASE}/${name}`;
}

export const CARD_BACK_1 = `${CARD_ASSET_BASE}/back1.png`;
export const CARD_BACK_2 = `${CARD_ASSET_BASE}/back2.png`;
