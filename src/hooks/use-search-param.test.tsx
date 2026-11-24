import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation, useNavigationType } from "react-router-dom";
import { useListSearchParams } from "./use-list-search-params";
import { useSearchParam } from "./use-search-param";

// O ?report=<id> que abre a consulta em Relatórios (E2.01, T7), junto com o
// estado da lista na URL (q, page, size).

function renderParam(initialUrl: string, state?: unknown) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[{ pathname: initialUrl.split("?")[0], search: initialUrl.split("?")[1] ?? "", state }]}>
      {children}
    </MemoryRouter>
  );
  return renderHook(
    () => {
      const [report, setReport] = useSearchParam("report");
      return { report, setReport, list: useListSearchParams(), location: useLocation(), navigationType: useNavigationType() };
    },
    { wrapper },
  );
}

describe("useSearchParam", () => {
  it("lê o parâmetro da URL; sem ele, ou vazio, null", () => {
    expect(renderParam("/cell-reports?report=r1").result.current.report).toBe("r1");
    expect(renderParam("/cell-reports").result.current.report).toBeNull();
    expect(renderParam("/cell-reports?report=").result.current.report).toBeNull();
  });

  it("abrir e fechar mantêm a busca, a página e o tamanho da lista", () => {
    const { result } = renderParam("/cell-reports?q=rui&page=2&size=50");

    act(() => result.current.setReport("r1"));
    expect(result.current.location.search).toBe("?q=rui&page=2&size=50&report=r1");
    expect(result.current.list.params).toEqual({ page: 2, pageSize: 50, search: "rui" });

    act(() => result.current.setReport(null));
    expect(result.current.location.search).toBe("?q=rui&page=2&size=50");
    expect(result.current.report).toBeNull();
  });

  it("troca o endereço sem criar entrada no histórico e mantém o estado da navegação", () => {
    const { result } = renderParam("/cell-reports?q=rui", { returnTo: "/cells?q=x" });

    act(() => result.current.setReport("r1"));
    expect(result.current.navigationType).toBe("REPLACE");
    expect(result.current.location.state).toEqual({ returnTo: "/cells?q=x" });
  });

  it("mudar a página da lista com o painel aberto mantém o parâmetro", () => {
    const { result } = renderParam("/cell-reports?report=r1");

    act(() => result.current.list.setPage(3));
    expect(result.current.location.search).toBe("?report=r1&page=3");
    expect(result.current.report).toBe("r1");
  });
});
