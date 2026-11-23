import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createQueryWrapper } from "@/test/query-wrapper";
import { fakeQueries, resetFakeSupabase, respondWith } from "@/test/fake-supabase";
import type { CellSummary } from "@/lib/cells/fields";
import type { CellReportRow } from "@/lib/cell-reports/fields";
import CellReportForm from "./CellReportForm";

// Participantes do relatório (E1.08, RN-06 e RN-07): o seletor busca no
// servidor, 20 por vez, e os escolhidos guardam o nome, que não depende da
// página carregada nem do texto da busca.

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

const PARTICIPANTS = "Participantes (Membros)";
const CELL = "Célula *";

const cell: CellSummary = {
  id: "c1",
  leader_name: "Ana Alves",
  meeting_day: "Segunda",
  meeting_time: "20:00:00",
  street: "Rua A",
  number: "10",
  neighborhood: "Centro",
};

const report: CellReportRow = {
  id: "r1",
  cell_id: "c1",
  date: "2026-11-23",
  time: "20:00:00",
  theme: "Fé",
  observations: null,
  visitors: [],
  offering: 0,
  was_held: true,
  reason_not_held: null,
  visitors_count: 0,
  cell_leader_name: "Ana Alves",
  cell_street: "Rua A",
  cell_number: "10",
  cell_complement: null,
  cell_neighborhood: "Centro",
  participants_count: 2,
};

function openMenu(input: HTMLElement) {
  act(() => input.focus());
  fireEvent.keyDown(input, { key: "ArrowDown" });
}

// O jsdom não tem ResizeObserver, que o Checkbox do Radix usa para medir o
// controle ("Não houve célula").
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("CellReportForm: participantes (RN-06, RN-07)", () => {
  beforeAll(() => vi.stubGlobal("ResizeObserver", NoopResizeObserver));
  afterAll(() => vi.unstubAllGlobals());
  beforeEach(() => resetFakeSupabase());

  it("Dado um relatório novo, então nada é consultado até um seletor abrir", () => {
    render(<CellReportForm initialCell={cell} onClose={vi.fn()} />, { wrapper: createQueryWrapper() });

    expect(screen.getByLabelText(PARTICIPANTS)).toBeInTheDocument();
    expect(fakeQueries()).toHaveLength(0);
  });

  it("Dado um participante escolhido, quando troca o texto da busca, então ele continua escolhido e com o nome", async () => {
    respondWith(
      {
        data: [
          { id: "m1", name: "Maria Mendes" },
          { id: "m2", name: "Marta Moura" },
        ],
      },
      { data: [{ id: "m3", name: "João Jesus" }] },
    );
    render(<CellReportForm initialCell={cell} onClose={vi.fn()} />, { wrapper: createQueryWrapper() });
    const input = screen.getByLabelText(PARTICIPANTS);
    openMenu(input);

    fireEvent.click(await screen.findByRole("option", { name: "Maria Mendes" }));
    expect(screen.getByLabelText("Remover Maria Mendes")).toBeInTheDocument();

    // Mesmo num aparelho de toque (o jsdom é um), o foco e o menu ficam: dá
    // para escolher o próximo do mesmo resultado ou já digitar outra busca.
    expect(input).toHaveFocus();
    expect(screen.getByRole("option", { name: "Marta Moura" })).toBeInTheDocument();
    // Cada escolhido tem o seu "×": a escolha múltipla não tem o Limpar seleção.
    expect(screen.queryByRole("button", { name: "Limpar seleção" })).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "jo" } });

    expect(await screen.findByRole("option", { name: "João Jesus" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Maria Mendes" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Remover Maria Mendes")).toBeInTheDocument();
    expect(screen.getByText("Maria Mendes")).toBeInTheDocument();

    // Só membros ativos, e a nova busca recomeça do início.
    const [first, second] = fakeQueries();
    expect(first.table).toBe("members_view");
    expect(first.calls).toContainEqual(["eq", "is_active", true]);
    expect(second.calls).toContainEqual(["ilike", "search_text", "%jo%"]);
    expect(second.calls).toContainEqual(["range", 0, 20]);

    fireEvent.click(screen.getByRole("option", { name: "João Jesus" }));

    expect(screen.getByLabelText("Remover Maria Mendes")).toBeInTheDocument();
    expect(screen.getByLabelText("Remover João Jesus")).toBeInTheDocument();
  });

  it("Dada uma busca escolhendo participantes, então o texto da busca continua depois da escolha", async () => {
    respondWith(
      { data: [{ id: "m1", name: "Maria Mendes" }] },
      {
        data: [
          { id: "m1", name: "Maria Mendes" },
          { id: "m2", name: "Marta Moura" },
        ],
      },
    );
    render(<CellReportForm initialCell={cell} onClose={vi.fn()} />, { wrapper: createQueryWrapper() });
    const input = screen.getByLabelText(PARTICIPANTS);
    openMenu(input);
    await screen.findByRole("option", { name: "Maria Mendes" });
    fireEvent.change(input, { target: { value: "ma" } });
    await screen.findByRole("option", { name: "Marta Moura" });

    fireEvent.click(screen.getByRole("option", { name: "Maria Mendes" }));

    expect(input).toHaveValue("ma");
    expect(input).toHaveFocus();
    expect(screen.getByRole("option", { name: "Marta Moura" })).toBeInTheDocument();
  });

  it("Dado um relatório em edição, então os participantes salvos aparecem com o nome, lidos da view de participantes", async () => {
    respondWith({
      data: [
        { member_id: "m1", member_name: "Maria Mendes" },
        { member_id: "m9", member_name: null },
      ],
    });

    render(<CellReportForm report={report} onClose={vi.fn()} />, { wrapper: createQueryWrapper() });

    expect(await screen.findByLabelText("Remover Maria Mendes")).toBeInTheDocument();
    expect(screen.getByLabelText("Remover Membro sem nome")).toBeInTheDocument();
    // A célula do relatório, travada, com o rótulo vindo da própria linha.
    expect(screen.getByText("Célula de Ana Alves, em Rua A 10, Centro")).toBeInTheDocument();
    // Uma consulta só, à view de participantes; nada da tabela de membros.
    expect(fakeQueries().map((query) => query.table)).toEqual(["cell_report_participants_view"]);
    expect(fakeQueries()[0].calls).toEqual([
      ["select", "member_id, member_name"],
      ["eq", "report_id", "r1"],
      ["order", "member_name"],
    ]);
  });

  it("Dado um relatório em edição, quando o seletor abre e troca a busca, então os participantes salvos continuam com o nome", async () => {
    respondWith(
      { data: [{ member_id: "m1", member_name: "Maria Mendes" }] },
      { data: [{ id: "m3", name: "João Jesus" }] },
    );
    render(<CellReportForm report={report} onClose={vi.fn()} />, { wrapper: createQueryWrapper() });
    await screen.findByLabelText("Remover Maria Mendes");

    const input = screen.getByLabelText(PARTICIPANTS);
    openMenu(input);
    await screen.findByRole("option", { name: "João Jesus" });

    await waitFor(() => expect(fakeQueries()).toHaveLength(2));
    expect(screen.getByLabelText("Remover Maria Mendes")).toBeInTheDocument();
  });
});

describe("CellReportForm: célula obrigatória", () => {
  beforeAll(() => vi.stubGlobal("ResizeObserver", NoopResizeObserver));
  afterAll(() => vi.unstubAllGlobals());
  beforeEach(() => resetFakeSupabase());

  it("Dado um relatório novo sem célula, quando salva, então o foco vai ao seletor de célula, que aponta a mensagem de erro", async () => {
    render(<CellReportForm onClose={vi.fn()} />, { wrapper: createQueryWrapper() });
    const cellInput = screen.getByLabelText(CELL);
    expect(cellInput).toHaveAttribute("aria-invalid", "false");
    expect(cellInput).not.toHaveAttribute("aria-errormessage");
    // Sem erro, a descrição é só a do react-select (o placeholder).
    const placeholderId = cellInput.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(placeholderId)).toHaveTextContent("Buscar por líder, rua ou bairro…");

    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(cellInput).toHaveFocus());
    expect(cellInput).toHaveAttribute("aria-invalid", "true");
    const messageId = cellInput.getAttribute("aria-errormessage") ?? "";
    expect(document.getElementById(messageId)).toHaveTextContent("Selecione uma célula");
    // A mensagem também entra na descrição, mantendo a do react-select.
    expect(cellInput).toHaveAttribute("aria-describedby", `${placeholderId} ${messageId}`);
    // Os participantes não têm erro.
    expect(screen.getByLabelText(PARTICIPANTS)).toHaveAttribute("aria-invalid", "false");
    expect(screen.getByLabelText(PARTICIPANTS).getAttribute("aria-describedby")).not.toContain(messageId);
    // Nada foi gravado.
    expect(fakeQueries()).toHaveLength(0);
  });

  it("Dado um seletor de célula aberto sem resultado, então o menu diz Nenhuma célula encontrada", async () => {
    respondWith({ data: [] });
    render(<CellReportForm onClose={vi.fn()} />, { wrapper: createQueryWrapper() });
    const cellInput = screen.getByLabelText(CELL);
    expect(screen.getByText("Buscar por líder, rua ou bairro…")).toBeInTheDocument();

    openMenu(cellInput);

    expect(await screen.findByText("Nenhuma célula encontrada")).toBeInTheDocument();
    // A região de status do seletor de célula anuncia o vazio; a dos participantes fica muda.
    expect(screen.getAllByRole("status").map((status) => status.textContent)).toEqual([
      "Nenhuma célula encontrada.",
      "",
    ]);
  });
});
