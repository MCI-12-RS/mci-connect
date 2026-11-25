// E2.03 (T6, P17, UX-23, UX-29): a senha temporária na tela.
import { describe, expect, it } from "vitest";
import { displayGroups, formatResetTime, formatValidUntil, nextStepForRefusal, spellForScreenReader } from "./temporary-password";

describe("senha temporária", () => {
  it("dois grupos de 4 só no visual; soletrada para o leitor de tela (UX-29)", () => {
    expect(displayGroups("k7m2x9pa")).toEqual(["k7m2", "x9pa"]);
    expect(spellForScreenReader("k7m2x9pa")).toBe("Senha: k, 7, m, 2, x, 9, p, a.");
  });

  it("UX-23: redefinida em 28/11/2026 às 23:50 (Brasília) vale até 05/12/2026 às 23:50, em qualquer fuso", () => {
    const original = process.env.TZ;
    try {
      for (const tz of ["UTC", "Asia/Tokyo", "America/Los_Angeles"]) {
        process.env.TZ = tz;
        expect(formatValidUntil("2026-12-06T02:50:00+00:00")).toBe("05/12/2026 às 23:50");
        expect(formatResetTime("2026-11-29T02:50:00Z")).toBe("23:50");
      }
    } finally {
      process.env.TZ = original;
    }
  });

  it("o que a tela faz depois de cada recusa (T6)", () => {
    expect(nextStepForRefusal("not_found")).toBe("close_record");
    expect(nextStepForRefusal("no_permission")).toBe("reread_access");
    expect(nextStepForRefusal("role_not_covered")).toBe("show_text");
    expect(nextStepForRefusal("no_account")).toBe("show_text");
    expect(nextStepForRefusal("rate_limited")).toBe("none");
    expect(nextStepForRefusal("self")).toBe("none");
  });
});
