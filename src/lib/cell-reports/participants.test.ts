import { describe, it, expect } from "vitest";
import { toParticipantOptions } from "./participants";

describe("toParticipantOptions (RN-06, RN-07)", () => {
  it("participante já salvo vira opção selecionada com o nome, inclusive inativo ou fora do escopo", () => {
    const saved = [
      { member_id: "m1", member_name: "Ana" },
      { member_id: "m9", member_name: "Carlos (inativo)" },
    ];
    expect(toParticipantOptions(saved)).toEqual([
      { value: "m1", label: "Ana" },
      { value: "m9", label: "Carlos (inativo)" },
    ]);
  });

  it("mantém a ordem dos participantes salvos", () => {
    const saved = [
      { member_id: "m9", member_name: "Carlos" },
      { member_id: "m1", member_name: "Ana" },
    ];
    expect(toParticipantOptions(saved).map((o) => o.value)).toEqual(["m9", "m1"]);
  });

  it("participante salvo sem nome não some da seleção", () => {
    expect(toParticipantOptions([{ member_id: "x", member_name: null }])).toEqual([
      { value: "x", label: "Membro sem nome" },
    ]);
  });

  it("nenhum participante", () => {
    expect(toParticipantOptions([])).toEqual([]);
  });
});
