import { describe, expect, it } from "vitest";
import { saveOutcome, saveOutcomeToast, situationHint, situationNotice, type CellSaveOutcome } from "./situation";

describe("situação da célula (E2.08, RN-11, P60, T6)", () => {
  it("a dica segue a situação gravada", () => {
    expect(situationHint(true)).toMatch(/^Desligue quando a célula parar de se reunir/);
    expect(situationHint(false)).toMatch(/^Ligue quando a célula voltar a se reunir/);
  });

  it("o aviso só aparece com o interruptor diferente do gravado", () => {
    expect(situationNotice(true, true)).toBeNull();
    expect(situationNotice(true, false)).toBe("Ao salvar, a célula fica inativa. Os relatórios que ela já tem continuam.");
    expect(situationNotice(false, true)).toBe("Ao salvar, a célula volta aos totais e a receber relatórios a partir desta semana.");
    expect(situationNotice(false, false)).toBeNull();
  });

  it("o toast de cada gravação (UX-20)", () => {
    expect(saveOutcome(null, {})).toBe("created");
    expect(saveOutcome(true, {})).toBe("unchanged");
    expect(saveOutcome(true, { is_active: false, meeting_time: "19:30" })).toBe("inactivated");
    expect(saveOutcome(false, { is_active: true })).toBe("reactivated");
    expect(saveOutcome(true, { meeting_time: "19:30" })).toBe("updated");
    const outcomes: CellSaveOutcome[] = ["created", "updated", "inactivated", "reactivated", "unchanged"];
    expect(outcomes.map(saveOutcomeToast)).toEqual([
      "Célula criada.",
      "Célula atualizada.",
      "Célula inativada.",
      "Célula reativada.",
      "Nenhuma alteração para salvar.",
    ]);
  });
});
