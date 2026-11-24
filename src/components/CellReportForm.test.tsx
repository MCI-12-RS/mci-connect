import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { format } from "date-fns";
import { createQueryWrapper } from "@/test/query-wrapper";
import { fakeQueries, fakeRpcs, resetFakeSupabase, respondToRpc, respondWith } from "@/test/fake-supabase";
import { APP_ERROR_HINT } from "@/lib/errors";
import { WEEKDAYS } from "@/lib/cells/weekdays";
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
  cell_deleted: false,
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
      ["select", "member_id, member_name, member_deleted"],
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

// Gravação (E2.01, RN-13, T8, DT-19, UX-28 a UX-30): o relatório e, depois,
// uma chamada só de set_cell_report_participants com o conjunto final.
// A data é a de hoje: o campo só aceita a semana atual.

const today = format(new Date(), "yyyy-MM-dd");
const editing: CellReportRow = { ...report, date: today };
// Célula que se reúne hoje: a data sugerida é a de hoje.
const todayCell: CellSummary = { ...cell, meeting_day: WEEKDAYS[new Date().getDay()] };

const appError = (code: string, message: string, extra: object = {}) => ({
  code: "22023",
  message,
  details: JSON.stringify({ code, ...extra }),
  hint: APP_ERROR_HINT,
});

const SAVE = { name: "Salvar" };

/** Nenhuma exclusão nem inclusão direta nos participantes (critério de pronto 6). */
function expectNoDirectParticipantWrites() {
  const participantWrites = fakeQueries().filter(
    (query) => query.table === "cell_report_participants" && /^(insert|delete|update)$/.test(query.methods()[0] ?? ""),
  );
  expect(participantWrites).toEqual([]);
  expect(fakeQueries().some((query) => query.methods().includes("delete"))).toBe(false);
}

describe("CellReportForm: participantes excluídos e gravação (E2.01)", () => {
  beforeAll(() => vi.stubGlobal("ResizeObserver", NoopResizeObserver));
  afterAll(() => vi.unstubAllGlobals());
  beforeEach(() => resetFakeSupabase());

  it("Dado R com Ana e Sara, e Sara excluída, então Sara fica fora dos chips, na linha só de leitura, e continua no relatório ao salvar (RN-13, UX-29)", async () => {
    respondWith(
      {
        data: [
          { member_id: "m1", member_name: "Ana Souza", member_deleted: false },
          { member_id: "m2", member_name: "Sara Reis", member_deleted: true },
        ],
      },
      { data: [{ id: "r1" }] },
    );
    respondToRpc("set_cell_report_participants", {});
    const onClose = vi.fn();
    render(<CellReportForm report={editing} onClose={onClose} />, { wrapper: createQueryWrapper() });

    expect(await screen.findByLabelText("Remover Ana Souza")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Remover Sara/)).not.toBeInTheDocument();
    expect(screen.getByText("Continuam no relatório (cadastros excluídos): Sara Reis.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", SAVE));
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    const update = fakeQueries()[1];
    expect(update.table).toBe("cell_reports");
    expect(update.methods()).toEqual(["update", "eq", "select"]);
    expect(update.calls).toContainEqual(["eq", "id", "r1"]);
    expect(update.calls).toContainEqual(["select", "id"]);
    // Uma chamada só, com o conjunto final: Ana (escolhida) e Sara (excluída, sem mudança).
    expect(fakeRpcs().map((call) => [call.fn, call.args])).toEqual([
      ["set_cell_report_participants", { _report_id: "r1", _member_ids: ["m1", "m2"] }],
    ]);
    expectNoDirectParticipantWrites();
  });

  it("Dado um relatório em edição, enquanto os participantes carregam, então Salvar fica desabilitado", async () => {
    let release = () => {};
    respondWith({
      data: [{ member_id: "m1", member_name: "Ana Souza", member_deleted: false }],
      until: new Promise<void>((resolve) => (release = resolve)),
    });
    render(<CellReportForm report={editing} onClose={vi.fn()} />, { wrapper: createQueryWrapper() });

    expect(screen.getByRole("button", SAVE)).toBeDisabled();
    release();
    await screen.findByLabelText("Remover Ana Souza");
    expect(screen.getByRole("button", SAVE)).toBeEnabled();
  });

  it("Dado um participante excluído entre a escolha e o envio, então a mensagem fica embaixo do campo, o chip é marcado e a nova tentativa atualiza o mesmo relatório (UX-30)", async () => {
    respondWith(
      { data: [{ id: "m7", name: "Maria Mendes" }] },
      { data: [{ id: "new1" }] },
      { data: [{ id: "new1" }] },
    );
    respondToRpc(
      "set_cell_report_participants",
      {
        error: appError("deleted_member_chosen", "Este membro foi excluído e não pode ser escolhido.", {
          field: "member_id",
          member_id: "m7",
        }),
      },
      {},
    );
    const onClose = vi.fn();
    render(<CellReportForm initialCell={todayCell} onClose={onClose} />, { wrapper: createQueryWrapper() });
    openMenu(screen.getByLabelText(PARTICIPANTS));
    fireEvent.click(await screen.findByRole("option", { name: "Maria Mendes" }));
    fireEvent.change(screen.getByLabelText("Tema da Palavra"), { target: { value: "Fé que move montanhas" } });

    fireEvent.click(screen.getByRole("button", SAVE));

    const removeMarked = await screen.findByLabelText("Remover Maria Mendes (cadastro excluído)");
    expect(screen.getByText("Este membro foi excluído e não pode ser escolhido.")).toBeInTheDocument();
    expect(screen.getByLabelText(PARTICIPANTS)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("O relatório foi gravado, mas os participantes não. Salve de novo para gravá-los.")).toBeInTheDocument();
    // O resto do formulário fica como estava.
    expect(screen.getByLabelText("Tema da Palavra")).toHaveValue("Fé que move montanhas");
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(removeMarked);
    expect(screen.queryByText("Este membro foi excluído e não pode ser escolhido.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", SAVE));
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    // A primeira tentativa criou o relatório; a segunda o atualiza, sem criar outro.
    const writes = fakeQueries().filter((query) => query.table === "cell_reports");
    expect(writes.map((query) => query.methods()[0])).toEqual(["insert", "update"]);
    expect(writes[1].calls).toContainEqual(["eq", "id", "new1"]);
    expect(fakeRpcs().map((call) => call.args)).toEqual([
      { _report_id: "new1", _member_ids: ["m7"] },
      { _report_id: "new1", _member_ids: [] },
    ]);
    expectNoDirectParticipantWrites();
  });

  it("Dada a célula excluída entre a escolha e o envio, então o aviso fica no topo, sem gravar participantes (UX-30)", async () => {
    respondWith({ error: appError("cell_deleted", "Esta célula foi excluída e não recebe relatórios.", { cell_id: "c1" }) });
    const onClose = vi.fn();
    render(<CellReportForm initialCell={todayCell} onClose={onClose} />, { wrapper: createQueryWrapper() });

    fireEvent.click(screen.getByRole("button", SAVE));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Esta célula foi excluída e não recebe relatórios.");
    await waitFor(() => expect(alert).toHaveFocus());
    expect(fakeRpcs()).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Dada a edição recusada porque a célula foi excluída no meio tempo, então o aviso no topo, os dados ficam e o formulário não fecha (UX-28)", async () => {
    const message = "A célula deste relatório foi excluída. Restaure a célula para editar o relatório.";
    respondWith(
      { data: [{ member_id: "m1", member_name: "Ana Souza", member_deleted: false }] },
      { error: appError("report_cell_deleted", message, { cell_id: "c1" }) },
    );
    const onClose = vi.fn();
    render(<CellReportForm report={editing} onClose={onClose} />, { wrapper: createQueryWrapper() });
    await screen.findByLabelText("Remover Ana Souza");
    fireEvent.change(screen.getByLabelText("Tema da Palavra"), { target: { value: "Novo tema" } });

    fireEvent.click(screen.getByRole("button", SAVE));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByLabelText("Tema da Palavra")).toHaveValue("Novo tema");
    expect(screen.getByLabelText("Remover Ana Souza")).toBeInTheDocument();
    expect(screen.getByRole("button", SAVE)).toBeEnabled();
    expect(fakeRpcs()).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Dada a edição sem linha de volta, então 'não existe ou já foi excluído', Salvar desabilitado e 'Fechar' volta para a lista (DT-19)", async () => {
    respondWith({ data: [] }, { data: [] });
    const onClose = vi.fn();
    render(<CellReportForm report={editing} onClose={onClose} />, { wrapper: createQueryWrapper() });
    await waitFor(() => expect(screen.getByRole("button", SAVE)).toBeEnabled());

    fireEvent.click(screen.getByRole("button", SAVE));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Este relatório não existe ou já foi excluído. As alterações não foram salvas.");
    expect(screen.getByRole("button", SAVE)).toBeDisabled();
    expect(fakeRpcs()).toHaveLength(0);

    fireEvent.click(within(alert).getByRole("button", { name: "Fechar" }));
    expect(onClose).toHaveBeenCalled();
  });
});
