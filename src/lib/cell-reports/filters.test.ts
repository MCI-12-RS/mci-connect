import { describe, it, expect } from "vitest";
import {
  applyWeek,
  cellChipState,
  cellIdentityChipText,
  cellReportFilterChips,
  cellReportListHref,
  clearCellReportFilters,
  countActiveCellReportFilters,
  EMPTY_CELL_REPORT_FILTERS,
  parseCellReportFilters,
  removeCellReportFilterChip,
  toCellReportsListArgs,
  writeCellReportFilters,
  type CellReportFilters,
} from "./filters";

// O filtro da lista de Relatórios (E2.12, AQ-1; RN-02, RN-05, RN-07 a RN-12, RN-18; UX-08, UX-15).

const ANDRE = "a0000000-0000-4000-8000-000000000001";
const DEBORA = "a0000000-0000-4000-8000-000000000002";
const PEDRO = "a0000000-0000-4000-8000-000000000003";
const C1 = "c0000000-0000-4000-8000-000000000001";
const REPORT = "d0000000-0000-4000-8000-000000000001";
const ids = (n: number) => Array.from({ length: n }, (_, i) => `b0000000-0000-4000-8000-${String(i).padStart(12, "0")}`);

const parse = (query: string) => parseCellReportFilters(new URLSearchParams(query));

const all: CellReportFilters = {
  cellId: C1,
  leaderIds: [ANDRE, DEBORA],
  g12Ids: [PEDRO],
  from: "2026-11-15",
  to: "2026-11-21",
  types: ["evangelistic", "discipleship"],
  held: "yes",
};

describe("parseCellReportFilters (RN-12, Navegação e rotas)", () => {
  it("lê os sete filtros com os nomes da URL", () => {
    const { filters, cleanParams } = parse(
      `cell=${C1}&leaders=${ANDRE},${DEBORA}&g12=${PEDRO}&from=2026-11-15&to=2026-11-21&type=evangelistic,discipleship&held=yes`,
    );
    expect(filters).toEqual(all);
    expect(cleanParams).toBeNull();
  });

  it("tira da URL o inválido, sem contar: tipo desconhecido, data que não existe, id sem formato e report sem formato (UX-15)", () => {
    const { filters, cleanParams } = parse("type=abc&held=no&from=2026-02-31&cell=xyz&leaders=xyz&report=xyz&page=2&q=fe");
    expect(filters).toEqual({ ...EMPTY_CELL_REPORT_FILTERS, held: "no" });
    expect(cleanParams?.toString()).toBe("held=no&page=2&q=fe");
    expect(countActiveCellReportFilters(filters)).toBe(1);
  });

  it("mantém o report com formato de id", () => {
    expect(parse(`report=${REPORT}`).cleanParams).toBeNull();
  });

  it("acima de 10 ids valem os 10 primeiros, na ordem da escolha, e sem repetidos (RN-05, DA-3)", () => {
    const many = ids(12);
    const { filters, leadersTruncated, cleanParams } = parse(`leaders=${[many[1], many[0], many[1], ...many.slice(2)].join(",")}`);
    expect(filters.leaderIds).toEqual([many[1], many[0], ...many.slice(2, 10)]);
    expect(leadersTruncated).toBe(true);
    expect(cleanParams?.get("leaders")?.split(",")).toHaveLength(10);
  });

  it("tipos na ordem das opções", () => {
    expect(parse("type=macrocell,evangelistic").cleanParams?.get("type")).toBe("evangelistic,macrocell");
  });

  it("datas invertidas ficam na URL, mas não valem, não contam e não viram chip (DA-6)", () => {
    const parsed = parse("from=2026-11-21&to=2026-11-15");
    expect(parsed.cleanParams).toBeNull();
    expect(parsed.dateRangeInverted).toBe(true);
    expect(countActiveCellReportFilters(parsed.filters)).toBe(0);
    expect(cellReportFilterChips(parsed.filters, { leader: () => "", g12: () => "" })).toEqual([]);
    expect(toCellReportsListArgs(parsed.filters, "")).toEqual({});
  });
});

describe("contagem e chips (RN-12, UX-08)", () => {
  it("todos os filtros contam 6, e tirar um dos tipos mantém 6", () => {
    expect(countActiveCellReportFilters(all)).toBe(6);
    expect(countActiveCellReportFilters(removeCellReportFilterChip(all, "type:discipleship"))).toBe(6);
  });

  it("os chips depois da Célula, na ordem Líder, G12, De, Até, Tipo e Reunião, as pessoas pela posição", () => {
    const names = ["André Souza", "Débora Lins"];
    const chips = cellReportFilterChips(all, { leader: (i) => names[i], g12: () => "Pedro Alves" });
    expect(chips.map((chip) => chip.text)).toEqual([
      "Líder: André Souza",
      "Líder: Débora Lins",
      "G12: Pedro Alves",
      "De: 15/11/2026",
      "Até: 21/11/2026",
      "Tipo: Evangelística",
      "Tipo: Discipulado",
      "Reunião: Célula realizada",
    ]);
    expect(chips.map((chip) => chip.key).join()).not.toContain(ANDRE);
  });

  it("o chip tira só aquele valor", () => {
    expect(removeCellReportFilterChip(all, "leaders:0").leaderIds).toEqual([DEBORA]);
    expect(removeCellReportFilterChip(all, "from")).toEqual({ ...all, from: null });
    expect(removeCellReportFilterChip(all, "held").held).toBeNull();
  });
});

describe("gravar e limpar a URL (RN-02, RN-12, DA-13)", () => {
  it("gravar tira page e os padrões, mantém q, size e report", () => {
    const next = writeCellReportFilters(new URLSearchParams(`page=3&size=50&q=fe&report=${REPORT}`), { ...EMPTY_CELL_REPORT_FILTERS, held: "no" });
    expect(next.toString()).toBe(`size=50&q=fe&report=${REPORT}&held=no`);
  });

  it("Limpar filtros deixa só size e report", () => {
    const params = writeCellReportFilters(new URLSearchParams(`page=2&size=50&q=fe&report=${REPORT}`), all);
    expect(clearCellReportFilters(params).toString()).toBe(`size=50&report=${REPORT}`);
  });

  it("o atalho troca só o Período (RN-10)", () => {
    expect(applyWeek(all, { start: "2026-11-22", end: "2026-11-28" })).toEqual({ ...all, from: "2026-11-22", to: "2026-11-28" });
  });
});

describe("toCellReportsListArgs", () => {
  it("só os filtros em uso, com os nomes da RPC e os tipos gravados", () => {
    expect(toCellReportsListArgs(all, "Fé  vence")).toEqual({
      _search: ["%fe%", "%vence%"],
      _cell_id: C1,
      _leader_ids: [ANDRE, DEBORA],
      _g12_ids: [PEDRO],
      _date_from: "2026-11-15",
      _date_to: "2026-11-21",
      _types: ["Evangelística", "Discipulado"],
      _held: true,
    });
    expect(toCellReportsListArgs({ ...EMPTY_CELL_REPORT_FILTERS, held: "no" }, "")._held).toBe(false);
  });

  it("a barra invertida digitada vai escapada, também no fim (um padrão terminado em \\ dá 22025 na RPC)", () => {
    expect(toCellReportsListArgs(EMPTY_CELL_REPORT_FILTERS, "fe\\")._search).toEqual(["%fe\\\\%"]);
    expect(toCellReportsListArgs(EMPTY_CELL_REPORT_FILTERS, "\\")._search).toEqual(["%\\\\%"]);
  });
});

describe("cellReportListHref (RN-08, RN-18)", () => {
  it("Ver todos os relatórios desta célula: só a Célula, mantendo o tamanho da página fora do padrão", () => {
    expect(cellReportListHref({ cellId: C1 })).toBe(`/cell-reports?cell=${C1}`);
    expect(cellReportListHref({ cellId: C1, size: 50 })).toBe(`/cell-reports?cell=${C1}&size=50`);
    expect(cellReportListHref({ cellId: C1, size: 25 })).toBe(`/cell-reports?cell=${C1}`);
  });

  it("os links do Dashboard (RN-18)", () => {
    expect(cellReportListHref({ from: "2026-11-22", to: "2026-11-28" })).toBe("/cell-reports?from=2026-11-22&to=2026-11-28");
    expect(cellReportListHref({ from: "2026-11-22", to: "2026-11-28", held: "yes" })).toBe("/cell-reports?from=2026-11-22&to=2026-11-28&held=yes");
    expect(cellReportListHref({})).toBe("/cell-reports");
  });
});

describe("o chip da Célula (P84, vindo do E2.10)", () => {
  it("o texto com os dados atuais e o dia na forma curta", () => {
    expect(cellIdentityChipText({ leader_name: "André Souza", meeting_day: "Quarta", meeting_time: "20:00:00" })).toBe(
      "Célula de André Souza · Quarta · 20:00",
    );
  });

  it("carregando, não carregada, indisponível e pronta", () => {
    expect(cellChipState({ data: undefined, isError: false })).toEqual({ kind: "loading" });
    expect(cellChipState({ data: undefined, isError: true })).toEqual({ kind: "failed" });
    expect(cellChipState({ data: null, isError: false })).toEqual({ kind: "unavailable" });
    expect(cellChipState({ data: { leader_name: "Jonas Prado", meeting_day: "Sexta", meeting_time: "20:00" }, isError: false })).toEqual({
      kind: "ready",
      text: "Célula de Jonas Prado · Sexta · 20:00",
    });
  });
});
