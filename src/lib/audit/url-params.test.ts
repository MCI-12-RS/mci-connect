import { describe, expect, it } from "vitest";
import {
  EMPTY_AUDIT_FILTERS,
  activeFilterCount,
  filterChips,
  isPeriodInverted,
  readAuditUrl,
  writeAuditFilters,
} from "./url-params";

// E2.05, "Navegação e rotas" e AQ-9 (UX-12): o estado da Auditoria na URL.
const ID = "11111111-2222-3333-4444-555555555555";
const read = (query: string) => readAuditUrl(new URLSearchParams(query));

describe("UX-12: leitura da URL", () => {
  it("sem parâmetros: nenhum filtro, nenhum registro", () => {
    expect(read("")).toEqual({ filters: EMPTY_AUDIT_FILTERS, record: null, invalidKeys: [] });
  });

  it("lê os filtros válidos", () => {
    expect(read("action=update&entity=cell&status=error&from=2026-11-01&to=2026-11-15").filters).toEqual({
      action: "update",
      entity: "cell",
      status: "error",
      from: "2026-11-01",
      to: "2026-11-15",
    });
  });

  it("um valor inválido é ignorado e listado para sair da URL", () => {
    const state = read("action=atualizar&entity=cell_report_participant&status=ok&from=2026-02-30&to=ontem");
    expect(state.filters).toEqual(EMPTY_AUDIT_FILTERS);
    expect(state.invalidKeys.sort()).toEqual(["action", "entity", "from", "status", "to"]);
  });

  it("'Até' antes de 'De' na URL: o 'Até' sai", () => {
    const state = read("from=2026-11-15&to=2026-11-10");
    expect(state.filters.from).toBe("2026-11-15");
    expect(state.filters.to).toBeNull();
    expect(state.invalidKeys).toEqual(["to"]);
  });

  it("o histórico de um registro: só as ações do histórico e o período (T9)", () => {
    const state = read(`record_type=member&record_id=${ID}&action=login&entity=cell&status=error&from=2026-11-01`);
    expect(state.record).toEqual({ type: "member", id: ID });
    expect(state.filters).toEqual({ ...EMPTY_AUDIT_FILTERS, from: "2026-11-01" });
    expect(state.invalidKeys.sort()).toEqual(["action", "entity", "status"]);
    expect(read(`record_type=cell_report&record_id=${ID}&action=restore`).filters.action).toBe("restore");
  });

  it("registro incompleto ou com id inválido: sai da URL", () => {
    expect(read(`record_type=member`).invalidKeys).toEqual(["record_type"]);
    expect(read(`record_type=role&record_id=${ID}`).invalidKeys.sort()).toEqual(["record_id", "record_type"]);
    expect(read(`record_type=member&record_id=abc`).record).toBeNull();
  });
});

describe("UX-12: escrita na URL", () => {
  it("grava só os filtros com valor, mantém a busca e o tamanho, e volta para a página 1", () => {
    const next = writeAuditFilters(new URLSearchParams("q=igor&size=50&page=3&status=error"), {
      ...EMPTY_AUDIT_FILTERS,
      action: "update",
      from: "2026-11-01",
    });
    expect(next.toString()).toBe("q=igor&size=50&action=update&from=2026-11-01");
  });

  it("mantém o registro do histórico", () => {
    const next = writeAuditFilters(new URLSearchParams(`record_type=member&record_id=${ID}`), { ...EMPTY_AUDIT_FILTERS, action: "delete" });
    expect(next.get("record_id")).toBe(ID);
    expect(next.get("action")).toBe("delete");
  });
});

describe("T8: chips e contagem", () => {
  it("um chip por filtro ativo, com as datas em dd/mm/aaaa", () => {
    const filters = { action: "update", entity: "cell", status: "error", from: "2026-11-01", to: "2026-11-15" } as const;
    expect(filterChips(filters).map((chip) => chip.text)).toEqual([
      "Ação: Alteração",
      "Entidade: Célula",
      "Status: Erro",
      "De: 01/11/2026",
      "Até: 15/11/2026",
    ]);
    expect(activeFilterCount(filters)).toBe(5);
    expect(activeFilterCount(EMPTY_AUDIT_FILTERS)).toBe(0);
  });

  it("P33: o período invertido", () => {
    expect(isPeriodInverted("2026-11-15", "2026-11-10")).toBe(true);
    expect(isPeriodInverted("2026-11-10", "2026-11-10")).toBe(false);
    expect(isPeriodInverted(null, "2026-11-10")).toBe(false);
  });
});
