import { describe, expect, it } from "vitest";
import { cellRulesCases } from "@/test/cell-rules-cases";
import { isValidHhmm, maskHhmm, readHhmmOnBlur, toHhmm } from "./hhmm";

describe("horário digitado (E2.08, P62, UX-08): a tabela de casos", () => {
  it.each(cellRulesCases.meeting_time.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const typed = maskHhmm(c.input ?? "");
    expect(typed, "enquanto digita").toBe(c.typing);
    const blurred = readHhmmOnBlur(typed);
    expect(blurred, "ao sair do campo").toBe(c.blur);
    expect(isValidHhmm(blurred), "a tela aceita").toBe(c.ui_valid);
  });
});

describe("maskHhmm ao apagar", () => {
  it("os dois-pontos do fim não voltam enquanto a pessoa apaga", () => {
    expect(maskHhmm("20", { deleting: true })).toBe("20");
    expect(maskHhmm("20")).toBe("20:");
  });
});

describe("toHhmm", () => {
  it("o gravado sem os segundos; vazio sem horário", () => {
    expect(toHhmm("20:00:00")).toBe("20:00");
    expect(toHhmm("7:05")).toBe("07:05");
    expect(toHhmm(null)).toBe("");
  });
});
