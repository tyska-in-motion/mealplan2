import type { InstructionStep } from "@shared/schema";

export type InstructionLink = {
  stepIndex: number;
  text: string;
  ingredientId: number;
  multiplier?: number;
};

export const parseInstructionLines = (instructions?: string) =>
  (instructions || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\d+[.)]\s*/, ""));

export const buildInstructionSteps = (instructions: string | undefined, links: InstructionLink[]): InstructionStep[] => {
  const steps = parseInstructionLines(instructions);

  return steps.map((stepText, stepIndex) => {
    const applicableLinks = links
      .filter((link) => link.stepIndex === stepIndex && link.text.trim())
      .sort((a, b) => b.text.length - a.text.length);

    if (applicableLinks.length === 0) {
      return { segments: [{ type: "text", text: stepText }] };
    }

    const segments: InstructionStep["segments"] = [];
    let cursor = 0;

    while (cursor < stepText.length) {
      let matched = false;

      for (const link of applicableLinks) {
        const position = stepText.toLowerCase().indexOf(link.text.toLowerCase(), cursor);
        if (position !== cursor) continue;

        if (position > cursor) {
          segments.push({ type: "text", text: stepText.slice(cursor, position) });
        }

        segments.push({
          type: "ingredient",
          text: stepText.slice(position, position + link.text.length),
          ingredientId: link.ingredientId,
          multiplier: typeof link.multiplier === "number" && Number.isFinite(link.multiplier) ? link.multiplier : 1,
        });
        cursor = position + link.text.length;
        matched = true;
        break;
      }

      if (!matched) {
        const nextIngredientStart = applicableLinks
          .map((link) => stepText.toLowerCase().indexOf(link.text.toLowerCase(), cursor))
          .filter((idx) => idx >= 0)
          .sort((a, b) => a - b)[0];

        const end = typeof nextIngredientStart === "number" ? nextIngredientStart : stepText.length;
        segments.push({ type: "text", text: stepText.slice(cursor, end) });
        cursor = end;
      }
    }

    return { segments: segments.filter((segment) => segment.text.length > 0) };
  });
};
