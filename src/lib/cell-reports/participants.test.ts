import { describe, it, expect } from "vitest";
import { toSelectedParticipantOptions } from "./participants";

const options = [
  { value: "m1", label: "Ana" },
  { value: "m2", label: "Bruno" },
];

describe("toSelectedParticipantOptions (RN-06)", () => {
  it("participante já salvo aparece com o nome, mesmo fora das opções", () => {
    const saved = [
      { member_id: "m1", member_name: "Ana" },
      { member_id: "m9", member_name: "Carlos (inativo)" },
    ];
    expect(toSelectedParticipantOptions(["m1", "m9"], options, saved)).toEqual([
      { value: "m1", label: "Ana" },
      { value: "m9", label: "Carlos (inativo)" },
    ]);
  });

  it("participante recém-escolhido usa o nome das opções, na ordem dos ids", () => {
    expect(toSelectedParticipantOptions(["m2", "m1"], options, [])).toEqual([
      { value: "m2", label: "Bruno" },
      { value: "m1", label: "Ana" },
    ]);
  });

  it("id sem nome conhecido não some da seleção", () => {
    expect(toSelectedParticipantOptions(["x"], options, [])).toEqual([{ value: "x", label: "Membro sem nome" }]);
  });

  it("nenhum participante", () => {
    expect(toSelectedParticipantOptions([], options, [])).toEqual([]);
  });

  it("participante salvo sem nome usa o nome das opções", () => {
    expect(toSelectedParticipantOptions(["m2"], options, [{ member_id: "m2", member_name: null }])).toEqual([
      { value: "m2", label: "Bruno" },
    ]);
  });

  it("salvar sem mudanças mantém os mesmos participantes, inclusive os que não estão nas opções", () => {
    const saved = [
      { member_id: "m9", member_name: "Carlos (inativo)" },
      { member_id: "m1", member_name: "Ana" },
    ];
    const selected = toSelectedParticipantOptions(saved.map((p) => p.member_id), options, saved);
    expect(selected.map((o) => o.value)).toEqual(["m9", "m1"]);
  });
});
