import { describe, it, expect } from "vitest";
import { WEEKDAYS, weekdayInSentence, weekdayIndex } from "./weekdays";

describe("WEEKDAYS", () => {
  it("lista os dias de domingo a sábado, como o banco grava", () => {
    expect(WEEKDAYS).toEqual(["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"]);
  });
});

describe("weekdayIndex (espelho de public.weekday_index)", () => {
  it.each(WEEKDAYS.map((day, index) => [day, index] as const))("%s → %i", (day, index) => {
    expect(weekdayIndex(day)).toBe(index);
  });

  it.each(["Segunda-feira", "segunda", "Terca", " Sexta", "", null, undefined])(
    "valor desconhecido (%j) → null",
    (day) => {
      expect(weekdayIndex(day)).toBeNull();
    },
  );
});

describe("weekdayInSentence", () => {
  it("põe o dia em minúsculas para o meio da frase", () => {
    expect(WEEKDAYS.map(weekdayInSentence)).toEqual(["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"]);
  });

  it("um valor desconhecido volta como veio", () => {
    expect(weekdayInSentence("Segunda-feira")).toBe("Segunda-feira");
  });
});

describe("WEEKDAY_OPTIONS (E2.08, RN-05, UXD-4)", () => {
  it("de segunda a domingo, com o rótulo do legado e o valor gravado (a tabela de casos)", async () => {
    const { WEEKDAY_OPTIONS, weekdayLongLabel } = await import("./weekdays");
    const { cellRulesCases } = await import("@/test/cell-rules-cases");
    expect(WEEKDAY_OPTIONS.map((o) => ({ label: o.label, value: o.value }))).toEqual(cellRulesCases.weekday_options);
    expect(weekdayLongLabel("Quarta")).toBe("Quarta-feira");
    expect(weekdayLongLabel("Feriado")).toBe("Feriado");
  });
});
