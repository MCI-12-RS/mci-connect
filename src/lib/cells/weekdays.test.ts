import { describe, it, expect } from "vitest";
import { WEEKDAYS, weekdayIndex } from "./weekdays";

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
