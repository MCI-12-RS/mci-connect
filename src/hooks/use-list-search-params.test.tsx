import { describe, it, expect, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { useClampPage, useListSearchParams } from "./use-list-search-params";

// Estado das listas na URL (E1.08, RN-01), usado por Membros, Células e
// Relatórios.

interface ClampProps {
  total?: number;
  isPlaceholderData?: boolean;
}

function renderList(initialUrl: string, total?: number) {
  const initialProps: ClampProps = { total };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initialUrl]}>{children}</MemoryRouter>
  );
  return renderHook(
    (props: ClampProps) => {
      const list = useListSearchParams();
      useClampPage(list, {
        data: props.total === undefined ? undefined : { total: props.total },
        isPlaceholderData: props.isPlaceholderData ?? false,
      });
      return { list, location: useLocation(), navigate: useNavigate() };
    },
    { wrapper, initialProps },
  );
}

type Rendered = ReturnType<typeof renderList>["result"];

const urlParams = (result: Rendered) => Object.fromEntries(new URLSearchParams(result.current.location.search));

describe("useListSearchParams (RN-01)", () => {
  afterEach(() => vi.useRealTimers());

  it("Dada uma URL com página, tamanho e busca, quando a tela abre, então usa esses valores", () => {
    const { result } = renderList("/cells?page=3&size=50&q=joao");

    expect(result.current.list.params).toEqual({ page: 3, pageSize: 50, search: "joao" });
    expect(result.current.list.searchInput).toBe("joao");
  });

  it("Dada uma URL sem parâmetros ou com valores inválidos, quando a tela abre, então usa a página 1 e 25 por página", () => {
    expect(renderList("/cells").result.current.list.params).toEqual({ page: 1, pageSize: 25, search: "" });
    expect(renderList("/cells?page=-2&size=30").result.current.list.params).toEqual({ page: 1, pageSize: 25, search: "" });
  });

  it("Quando muda de página, então a página vai para a URL; a página 1 e o tamanho padrão não aparecem", () => {
    const { result } = renderList("/cells?tab=x");

    act(() => result.current.list.setPage(4));
    expect(urlParams(result)).toEqual({ tab: "x", page: "4" });
    expect(result.current.list.params.page).toBe(4);

    act(() => result.current.list.setPage(1));
    expect(urlParams(result)).toEqual({ tab: "x" });
  });

  it("Dada a página 5, quando troca o tamanho da página, então volta para a página 1", () => {
    const { result } = renderList("/cells?page=5&q=ana");

    act(() => result.current.list.setPageSize(100));
    expect(urlParams(result)).toEqual({ q: "ana", size: "100" });
    expect(result.current.list.params).toEqual({ page: 1, pageSize: 100, search: "ana" });

    act(() => result.current.list.setPageSize(25));
    expect(urlParams(result)).toEqual({ q: "ana" });
  });

  it("Dada a página 3, quando digita uma busca, então ela vai para a URL 300 ms depois, sem espaços nas pontas, e a lista volta para a página 1", () => {
    vi.useFakeTimers();
    const { result } = renderList("/cell-reports?page=3");

    act(() => result.current.list.setSearchInput("  João (Silva) "));
    act(() => vi.advanceTimersByTime(299));
    expect(urlParams(result)).toEqual({ page: "3" });

    act(() => vi.advanceTimersByTime(1));
    expect(urlParams(result)).toEqual({ q: "João (Silva)" });
    expect(result.current.list.params).toEqual({ page: 1, pageSize: 25, search: "João (Silva)" });
  });

  it("Quando apaga a busca, então ela sai da URL", () => {
    vi.useFakeTimers();
    const { result } = renderList("/cells?q=ana&page=2");

    act(() => result.current.list.setSearchInput(""));
    act(() => vi.advanceTimersByTime(300));
    expect(urlParams(result)).toEqual({});
  });

  it("Dada uma busca na URL, quando a URL muda por fora (link do menu, botão voltar), então o campo acompanha e a busca antiga não volta", () => {
    vi.useFakeTimers();
    const { result } = renderList("/cells?q=ana&page=2");

    act(() => result.current.navigate("/cells"));
    act(() => vi.advanceTimersByTime(1000));

    expect(result.current.list.searchInput).toBe("");
    expect(result.current.list.params).toEqual({ page: 1, pageSize: 25, search: "" });
    expect(urlParams(result)).toEqual({});

    act(() => result.current.navigate("/cells?q=bia"));
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.list.searchInput).toBe("bia");
    expect(urlParams(result)).toEqual({ q: "bia" });
  });
});

describe("useClampPage (RN-01, página além do fim)", () => {
  it("Dada a página 10 e um total de 30 itens, quando o total chega, então vai para a última página (2)", () => {
    const { result } = renderList("/cells?page=10", 30);
    expect(urlParams(result)).toEqual({ page: "2" });
  });

  it("Dado um total zero, quando o total chega, então vai para a página 1", () => {
    const { result } = renderList("/cells?page=3", 0);
    expect(urlParams(result)).toEqual({});
  });

  it("Enquanto carrega (sem total) ou com a página dentro do intervalo, não muda a página", () => {
    const { result, rerender } = renderList("/cells?page=3", undefined);
    expect(urlParams(result)).toEqual({ page: "3" });

    rerender({ total: 75 });
    expect(urlParams(result)).toEqual({ page: "3" });

    rerender({ total: 50 });
    expect(urlParams(result)).toEqual({ page: "2" });
  });

  it("Dada a página anterior na tela (keepPreviousData), quando volta no navegador de uma busca curta para a página 5, então não muda a página até o total novo chegar", () => {
    const { result, rerender } = renderList("/cells?q=ana", 3);

    // No render em que a URL muda, a consulta nova ainda mostra o total 3 da
    // busca "ana" como placeholder.
    rerender({ total: 3, isPlaceholderData: true });
    act(() => result.current.navigate("/cells?page=5"));
    expect(urlParams(result)).toEqual({ page: "5" });

    rerender({ total: 300, isPlaceholderData: false });
    expect(urlParams(result)).toEqual({ page: "5" });
  });
});
