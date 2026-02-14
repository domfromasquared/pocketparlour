const CARD_IMPORTS = import.meta.glob("./cards/*.png", {
  eager: true,
  import: "default"
}) as Record<string, string>;

const CARD_BY_FILENAME = Object.entries(CARD_IMPORTS).reduce<Record<string, string>>((acc, [path, url]) => {
  const file = path.split("/").pop();
  if (file) acc[file] = url;
  return acc;
}, {});

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
  return CARD_BY_FILENAME[name] ?? null;
}

export const CARD_BACK_1 = CARD_BY_FILENAME["back1.png"] ?? "";
export const CARD_BACK_2 = CARD_BY_FILENAME["back2.png"] ?? "";
