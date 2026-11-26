import { describe, expect, it } from "vitest";
import { isCellReportChanged, type CellReportSnapshot } from "./changes";
import { toReportWrite } from "./report-form";

// O que mudou no formulário de relatório (E2.05, T5 e UXD-9): sem mudança, nada vai ao servidor.
const opening = {
  cell_id: "c1",
  date: "2026-11-23",
  time: "20:00",
  was_held: true,
  reason_not_held: "",
  theme: "Fé",
  observations: "",
  visitors: "João, Maria",
  offering: 10,
};

const stored: CellReportSnapshot = { report: toReportWrite(opening), participantIds: ["m1", "m2"] };
const current = (changes: Partial<typeof opening> = {}, participantIds: string[] | null = ["m1", "m2"]): CellReportSnapshot => ({
  report: toReportWrite({ ...opening, ...changes }),
  participantIds,
});

describe("isCellReportChanged (E2.05, T5)", () => {
  it("Dado o formulário como abriu, então nada mudou", () => {
    expect(isCellReportChanged(stored, current())).toBe(false);
  });

  it("Dado um valor digitado e devolvido ao original, então nada mudou", () => {
    expect(isCellReportChanged(stored, current({ theme: "Fé" }))).toBe(false);
  });

  it("Dado o horário com segundos no gravado, então é o mesmo horário", () => {
    const withSeconds: CellReportSnapshot = { ...stored, report: { ...stored.report, time: "20:00:00" } };
    expect(isCellReportChanged(withSeconds, current())).toBe(false);
  });

  it("Dado o vazio e o nulo, então são iguais", () => {
    const withNull: CellReportSnapshot = { ...stored, report: { ...stored.report, observations: null } };
    expect(isCellReportChanged(withNull, current({ observations: "" }))).toBe(false);
  });

  it.each([
    ["célula", { cell_id: "c2" }],
    ["data", { date: "2026-11-24" }],
    ["horário", { time: "20:30" }],
    ["tema", { theme: "Esperança" }],
    ["observações", { observations: "Chuva" }],
    ["visitantes", { visitors: "João" }],
    ["oferta", { offering: 12.5 }],
  ])("Dada a mudança de %s, então mudou", (_label, changes) => {
    expect(isCellReportChanged(stored, current(changes))).toBe(true);
  });

  it("Dado 'Não houve célula' com o motivo, então mudou", () => {
    expect(isCellReportChanged(stored, current({ was_held: false, reason_not_held: "Chuva forte" }, null))).toBe(true);
  });

  it("Dado só um participante incluído ou retirado, então mudou (os participantes contam, RN-04 a)", () => {
    expect(isCellReportChanged(stored, current({}, ["m1", "m2", "m3"]))).toBe(true);
    expect(isCellReportChanged(stored, current({}, ["m1"]))).toBe(true);
  });

  it("Dados os mesmos participantes em outra ordem, então nada mudou", () => {
    expect(isCellReportChanged(stored, current({}, ["m2", "m1"]))).toBe(false);
  });

  it("Dado o formulário que não envia os participantes, então eles não contam", () => {
    const notHeld: CellReportSnapshot = {
      report: toReportWrite({ ...opening, was_held: false, reason_not_held: "Chuva" }),
      participantIds: [],
    };
    const same = { report: toReportWrite({ ...opening, was_held: false, reason_not_held: "Chuva" }), participantIds: null };
    expect(isCellReportChanged(notHeld, same)).toBe(false);
  });
});
