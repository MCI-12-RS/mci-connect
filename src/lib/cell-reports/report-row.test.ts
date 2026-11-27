import { describe, it, expect } from "vitest";
import { reportRowDate, toReportRowView } from "./report-row";
import { reportListRow } from "@/test/report-snapshot-fixture";

// A linha da lista (E2.12, RN-15, UX-17).

describe("toReportRowView", () => {
  it("R1: o líder registrado, o G12, a data com o dia, o endereço, o tema e os números", () => {
    const view = toReportRowView(reportListRow(), { canEditReports: true });
    expect(view).toMatchObject({
      leader: "André Souza",
      g12: { text: "Pedro Alves", none: false },
      date: { dayShort: "Qua", dayFull: "Quarta", date: "18/11/2026", time: "20:00" },
      address: "Rua das Flores, 100 · Centro",
      held: true,
      text: { label: "Tema:", value: "A fé que vence" },
      numbers: { participants: 8, visitors: 2, offering: "R$\u00a050,00" },
      canEdit: true,
      openLabel: "Ver o relatório de 18/11/2026, André Souza",
    });
  });

  it("R2, Não houve célula: o motivo, sem números nem oferta, mesmo com os do legado", () => {
    const view = toReportRowView(
      reportListRow({ was_held: false, reason_not_held: "Chuva forte no bairro", theme: "Legado", offering: 10, date: "2026-11-11" }),
      { canEditReports: true },
    );
    expect(view.text).toEqual({ label: "Motivo:", value: "Chuva forte no bairro" });
    expect(view.numbers).toBeNull();
    expect(view.held).toBe(false);
  });

  it("pastor, sem G12, sem endereço, sem número e oferta não informada", () => {
    expect(toReportRowView(reportListRow({ snapshot_leader_g12_level: 0, snapshot_leader_is_pastor: true, snapshot_g12_leader_name: null }), { canEditReports: false }).g12).toEqual({
      text: "Pastores",
      none: false,
    });
    expect(toReportRowView(reportListRow({ snapshot_leader_g12_level: null, snapshot_g12_leader_name: null }), { canEditReports: false }).g12.none).toBe(true);
    expect(toReportRowView(reportListRow({ cell_street: null, cell_number: null, cell_neighborhood: null }), { canEditReports: false }).address).toBeNull();
    expect(toReportRowView(reportListRow({ cell_number: null }), { canEditReports: false }).address).toBe("Rua das Flores, s/n · Centro");
    expect(toReportRowView(reportListRow({ offering: null }), { canEditReports: false }).numbers?.offering).toBe("Não informada");
  });

  it("célula excluída: sem Editar, mesmo para quem edita (RN-11 do E2.01)", () => {
    const view = toReportRowView(reportListRow({ cell_deleted: true }), { canEditReports: true });
    expect(view.cellDeleted).toBe(true);
    expect(view.canEdit).toBe(false);
  });
});

describe("reportRowDate (UXD-15)", () => {
  it("o dia da própria data, sem conversão de fuso", () => {
    expect(reportRowDate("2026-11-22", "18:00:00")).toEqual({ dayShort: "Dom", dayFull: "Domingo", date: "22/11/2026", time: "18:00" });
    expect(reportRowDate("2026-11-28", null)).toMatchObject({ dayShort: "Sáb", time: "" });
  });
});
