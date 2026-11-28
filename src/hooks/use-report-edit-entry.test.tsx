import type { ReactNode } from "react";
import { describe, it, expect } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { useReportEditEntry } from "./use-report-edit-entry";

// "Editar relatório" pela consulta com uma entrada própria no histórico (E2.12, DA-11).

const SHEET = "/cell-reports?report=22222222-2222-4222-8222-222222222222";

type Entry = string | { pathname: string; search?: string; state?: unknown };

function setup(initialEntries: Entry[]) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={initialEntries} initialIndex={initialEntries.length - 1}>
      {children}
    </MemoryRouter>
  );
  return renderHook(
    () => {
      const entry = useReportEditEntry();
      return { entry, location: useLocation(), navigate: useNavigate() };
    },
    { wrapper },
  );
}

const sheetEntry = { pathname: "/cell-reports", search: "?report=22222222-2222-4222-8222-222222222222", state: { reportFromList: true } };

describe("useReportEditEntry (DA-11)", () => {
  it("abrir cria uma entrada no mesmo endereço; salvar ou cancelar a tira, e a consulta continua", async () => {
    const { result } = setup(["/cell-reports", sheetEntry]);
    act(() => result.current.entry.start());
    expect(result.current.entry.open).toBe(true);
    expect(result.current.location.pathname + result.current.location.search).toBe(SHEET);
    expect(result.current.location.state).toEqual({ reportFromList: true, reportEdit: true });

    act(() => result.current.entry.closed());
    await waitFor(() => expect(result.current.location.state).toEqual({ reportFromList: true }));
    expect(result.current.entry.open).toBe(false);
    expect(result.current.location.search).toContain("report=");
    expect(result.current.entry.closeRequest).toBe(0);
  });

  it("o voltar do aparelho tira só a entrada e pede para fechar o formulário; recusado, a entrada volta", async () => {
    const { result } = setup(["/cell-reports", sheetEntry]);
    act(() => result.current.entry.start());
    await waitFor(() => expect(result.current.location.state).toMatchObject({ reportEdit: true }));

    act(() => result.current.navigate(-1));
    await waitFor(() => expect(result.current.entry.closeRequest).toBe(1));
    expect(result.current.location.search).toContain("report=");
    expect(result.current.entry.open).toBe(true);

    // "Continuar editando": a entrada é recriada, e o próximo voltar pede de novo.
    act(() => result.current.entry.declined());
    await waitFor(() => expect(result.current.location.state).toMatchObject({ reportEdit: true }));
    act(() => result.current.navigate(-1));
    await waitFor(() => expect(result.current.entry.closeRequest).toBe(2));

    // Agora fecha (descartou): sem entrada, nada mais sai do histórico.
    act(() => result.current.entry.closed());
    expect(result.current.entry.open).toBe(false);
    expect(result.current.location.search).toContain("report=");
    expect(result.current.location.state).toEqual({ reportFromList: true });
  });

  it("a entrada que sobra sem o formulário (recarregar com ele aberto) sai na hora, e a consulta continua", async () => {
    const { result } = setup(["/cell-reports", sheetEntry, { ...sheetEntry, state: { reportFromList: true, reportEdit: true } }]);
    await waitFor(() => expect(result.current.location.state).toEqual({ reportFromList: true }));
    expect(result.current.location.search).toContain("report=");
    expect(result.current.entry.open).toBe(false);
  });
});
