import { describe, it, expect } from "vitest";
import { activeWeekShortcut, toWeekShortcuts, type ServerWeeks } from "./weeks";

// Os atalhos de semana (E2.12, P90, RN-10, T3, UX-04): as datas vêm só da `server_weeks`.

const weeks: ServerWeeks = {
  today: "2026-11-24",
  this_week_start: "2026-11-22",
  this_week_end: "2026-11-28",
  last_week_start: "2026-11-15",
  last_week_end: "2026-11-21",
  week_before_last_start: "2026-11-08",
  week_before_last_end: "2026-11-14",
};

describe("toWeekShortcuts", () => {
  it("as três semanas na ordem da tela, com o nome acessível com as datas", () => {
    expect(toWeekShortcuts(weeks)).toEqual([
      { key: "this", label: "Esta semana", start: "2026-11-22", end: "2026-11-28", spokenLabel: "Esta semana, de 22/11/2026 a 28/11/2026" },
      { key: "last", label: "Semana passada", start: "2026-11-15", end: "2026-11-21", spokenLabel: "Semana passada, de 15/11/2026 a 21/11/2026" },
      { key: "before_last", label: "Semana retrasada", start: "2026-11-08", end: "2026-11-14", spokenLabel: "Semana retrasada, de 08/11/2026 a 14/11/2026" },
    ]);
  });
});

describe("activeWeekShortcut (UX-04)", () => {
  const shortcuts = toWeekShortcuts(weeks);

  it("marca a semana quando o Período é exatamente o domingo e o sábado dela", () => {
    expect(activeWeekShortcut({ from: "2026-11-15", to: "2026-11-21" }, shortcuts)).toBe("last");
    expect(activeWeekShortcut({ from: "2026-11-22", to: "2026-11-28" }, shortcuts)).toBe("this");
  });

  it("não marca nenhum com só De, só Até, outro intervalo ou datas invertidas", () => {
    expect(activeWeekShortcut({ from: "2026-11-15", to: "2026-11-20" }, shortcuts)).toBeNull();
    expect(activeWeekShortcut({ from: "2026-11-15", to: null }, shortcuts)).toBeNull();
    expect(activeWeekShortcut({ from: null, to: "2026-11-21" }, shortcuts)).toBeNull();
    expect(activeWeekShortcut({ from: "2026-11-21", to: "2026-11-15" }, shortcuts)).toBeNull();
  });

  it("a marcação segue a data de hoje do servidor: 22/11 a 28/11 aberto em 01/12 marca Semana passada", () => {
    const december = toWeekShortcuts({
      today: "2026-12-01",
      this_week_start: "2026-11-29",
      this_week_end: "2026-12-05",
      last_week_start: "2026-11-22",
      last_week_end: "2026-11-28",
      week_before_last_start: "2026-11-15",
      week_before_last_end: "2026-11-21",
    });
    expect(activeWeekShortcut({ from: "2026-11-22", to: "2026-11-28" }, december)).toBe("last");
  });
});
