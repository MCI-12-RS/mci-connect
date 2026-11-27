import { describe, it, expect } from "vitest";
import { NO_ACCESS, type Access } from "@/lib/access/access";
import {
  addressLines,
  backLink,
  cameFromList,
  cellAuthorship,
  cellDetailPath,
  meetingParts,
  reportHeading,
  shownReports,
  weekdayOfDate,
} from "./detail";

// Regras de tela do detalhe da célula (E2.10, T8 a T13; RN-14, RN-15).

const persona = (permissions: Access["permissions"]): Access => ({ ...NO_ACCESS, member_id: "m", permissions });
const pedro = persona(["view_own_ministry", "edit_cell"]);
const hugo = persona(["view_own_reports", "submit_own_cell_report"]);

const EMPTY = { street: null, number: null, complement: null, neighborhood: null, city: null, state: null, zip_code: null };

describe("meetingParts (RN-15 c)", () => {
  it("dia curto, horário sem segundos e tipo", () => {
    expect(meetingParts({ meeting_day: "Quarta", meeting_time: "20:00:00", type: "Evangelística" })).toEqual([
      "Quarta",
      "20:00",
      "Evangelística",
    ]);
  });
  it("tira as partes vazias", () => {
    expect(meetingParts({ meeting_day: null, meeting_time: "19:30", type: "Discipulado" })).toEqual(["19:30", "Discipulado"]);
  });
});

describe("addressLines (RN-15 d, T8)", () => {
  it("as quatro linhas, com o CEP formatado", () => {
    expect(
      addressLines({
        street: "Rua das Flores",
        number: "100",
        complement: "Ap. 2",
        neighborhood: "Centro",
        city: "Porto Alegre",
        state: "RS",
        zip_code: "90010000",
      }),
    ).toEqual(["Rua das Flores, 100", "Ap. 2", "Centro · Porto Alegre, RS", "CEP 90010-000"]);
  });
  it("sem número, s/n; sem bairro, só a cidade; CEP já com hífen", () => {
    expect(addressLines({ ...EMPTY, street: "Rua A", city: "Canoas", zip_code: "92000-000" })).toEqual([
      "Rua A, s/n",
      "Canoas",
      "CEP 92000-000",
    ]);
  });
  it("sem nenhuma parte, nada (Sem endereço)", () => {
    expect(addressLines(EMPTY)).toEqual([]);
    expect(addressLines({ ...EMPTY, street: "  ", city: "" })).toEqual([]);
  });
});

describe("backLink (RN-14, UXD-10, AQ-8)", () => {
  it("vindo da lista, o voltar do histórico", () => {
    expect(backLink(pedro, true)).toEqual({ kind: "history", label: "Voltar para Células" });
  });
  it("aberto por link, a lista sem parâmetros", () => {
    expect(backLink(pedro, false)).toEqual({ kind: "link", label: "Voltar para Células", to: "/cells" });
  });
  it("sem a lista de Células, Ir para o início", () => {
    expect(backLink(hugo, true)).toEqual({ kind: "link", label: "Ir para o início", to: "/" });
    expect(backLink(hugo, false)).toEqual({ kind: "link", label: "Ir para o início", to: "/" });
  });
});

describe("cameFromList e cellDetailPath (P81)", () => {
  it("só com fromList verdadeiro", () => {
    expect(cameFromList({ fromList: true })).toBe(true);
    expect(cameFromList({ fromList: "true" })).toBe(false);
    expect(cameFromList(null)).toBe(false);
    expect(cameFromList(undefined)).toBe(false);
  });
  it("o endereço do detalhe", () => {
    expect(cellDetailPath("abc")).toBe("/cells/abc");
  });
});

describe("reportHeading (T11)", () => {
  it("o dia da semana vem da data, sem depender do fuso", () => {
    expect(weekdayOfDate("2026-11-18")).toBe("Quarta");
    expect(weekdayOfDate("2026-11-22")).toBe("Domingo");
    expect(weekdayOfDate("xx")).toBe("");
    expect(reportHeading({ date: "2026-11-18", time: "20:00:00" })).toBe("Quarta, 18/11/2026 às 20:00");
    expect(reportHeading({ date: "2026-11-11", time: null })).toBe("Quarta, 11/11/2026");
  });
});

describe("shownReports (RN-17)", () => {
  it("os 3 primeiros, na ordem do servidor", () => {
    expect(shownReports([1, 2, 3, 4, 5])).toEqual([1, 2, 3]);
    expect(shownReports([1])).toEqual([1]);
  });
});

describe("cellAuthorship (RN-15 g)", () => {
  it("as colunas da autoria, com updated_at nulo quando falta", () => {
    expect(
      cellAuthorship({
        created_at: "2025-03-10T22:40:00Z",
        created_by_kind: "member",
        created_by_name: "Rita Gomes",
        updated_by_kind: null,
        updated_by_name: null,
      }),
    ).toEqual({
      created_at: "2025-03-10T22:40:00Z",
      created_by_kind: "member",
      created_by_name: "Rita Gomes",
      updated_at: null,
      updated_by_kind: null,
      updated_by_name: null,
    });
  });
});
