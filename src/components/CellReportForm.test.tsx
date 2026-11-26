import type { ReactElement, ReactNode } from "react";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

vi.mock("@/components/RecordAuthorship", async () => {
  const { RecordAuthorshipStub } = await import("@/test/record-authorship-stub");
  return { RecordAuthorship: RecordAuthorshipStub };
});

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

// O acesso de quem está logado (E2.02): `null` antes da primeira leitura; os testes de escopo trocam.
const auth = vi.hoisted(() => ({
  access: null as import("@/lib/access/access").Access | null,
  permissions: new Set<string>(),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ access: auth.access, hasPermission: (permission: string) => auth.permissions.has(permission) }),
}));

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

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
      ["select", "member_id, member_name, member_deleted, member_visible"],
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
    // Nada foi gravado: a única leitura é a primeira página de células, para a célula única (E2.02, UXD-9).
    expect(fakeQueries().map((query) => query.table)).toEqual(["cells_view"]);
  });

  it("Dado um seletor de célula aberto sem nenhuma célula para lançar, então o menu diz que a pessoa não pode enviar nenhum (E2.02, UXD-9)", async () => {
    respondWith({ data: [] });
    render(<CellReportForm onClose={vi.fn()} />, { wrapper: createQueryWrapper() });
    const cellInput = screen.getByLabelText(CELL);
    expect(screen.getByText("Buscar por líder, rua ou bairro…")).toBeInTheDocument();

    openMenu(cellInput);

    // No menu e na região de status (que, sem ponto repetido, tem o mesmo texto).
    expect(await screen.findAllByText("Você não pode enviar o relatório de nenhuma célula.")).toHaveLength(2);
    // A região de status do seletor de célula anuncia o vazio; a dos participantes fica muda.
    expect(screen.getAllByRole("status").map((status) => status.textContent)).toEqual([
      "Você não pode enviar o relatório de nenhuma célula.",
      "",
    ]);
  });
});

// Gravação (E2.01, RN-13, T8, DT-19, UX-28 a UX-30; E2.05, T5, UX-08 e UX-09):
// o relatório e o conjunto final de participantes numa chamada só, a
// save_cell_report. A data é a de hoje: o campo só aceita a semana atual.

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

/** A recusa da save_cell_report para o relatório que não existe mais ou foi excluído (DT-19). */
const GONE = appError("not_found_or_deleted", "Este relatório não existe ou já foi excluído.", { entity: "cell_report" });

/** O formulário com o QueryClient observado: devolve as chaves que ele mandou recarregar. */
function renderWatched(element: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(element, { wrapper });
  return () => invalidate.mock.calls.map(([filters]) => filters?.queryKey);
}

/** As listas de Relatórios e de Células, recarregadas logo que nada no formulário resolve. */
const LISTS = [
  ["cell_reports", "list"],
  ["cells", "list"],
];

/** Nenhuma gravação direta no relatório nem nos participantes: só a save_cell_report (E2.05, critério de pronto 5). */
function expectNoDirectWrites() {
  const writes = fakeQueries().filter((query) => /^(insert|delete|update|upsert)$/.test(query.methods()[0] ?? ""));
  expect(writes).toEqual([]);
  expect(fakeRpcs().filter((call) => call.fn === "set_cell_report_participants")).toEqual([]);
}

/** As chamadas de gravação: uma por envio. */
const saveCalls = () => fakeRpcs().filter((call) => call.fn === "save_cell_report");

const saved = (reportId: string, changed = true) => ({ data: [{ report_id: reportId, changed }] });

describe("CellReportForm: participantes excluídos e gravação (E2.01)", () => {
  beforeAll(() => vi.stubGlobal("ResizeObserver", NoopResizeObserver));
  afterAll(() => vi.unstubAllGlobals());
  beforeEach(() => {
    resetFakeSupabase();
    toast.mockClear();
  });

  it("Dado R com Ana e Sara, e Sara excluída, então Sara fica fora dos chips, na linha só de leitura, e continua no relatório ao salvar (RN-13, UX-29)", async () => {
    respondWith(
      {
        data: [
          { member_id: "m1", member_name: "Ana Souza", member_deleted: false },
          { member_id: "m2", member_name: "Sara Reis", member_deleted: true },
        ],
      },
    );
    respondToRpc("save_cell_report", saved("r1"));
    const onClose = vi.fn();
    render(<CellReportForm report={editing} onClose={onClose} />, { wrapper: createQueryWrapper() });

    expect(await screen.findByLabelText("Remover Ana Souza")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Remover Sara/)).not.toBeInTheDocument();
    const keptLine = screen.getByText("Continuam no relatório (cadastros excluídos): Sara Reis.");
    // A linha descreve o seletor de participantes para o leitor de tela.
    expect(keptLine.id).not.toBe("");
    expect(screen.getByLabelText(PARTICIPANTS).getAttribute("aria-describedby")?.split(" ")).toContain(keptLine.id);

    fireEvent.change(screen.getByLabelText("Tema da Palavra"), { target: { value: "Esperança" } });
    fireEvent.click(screen.getByRole("button", SAVE));
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    // Uma chamada só, com o relatório e o conjunto final: Ana (escolhida) e Sara (excluída, sem mudança).
    expect(saveCalls().map((call) => call.args)).toEqual([
      {
        _report_id: "r1",
        _report: {
          cell_id: "c1",
          date: today,
          time: "20:00",
          was_held: true,
          reason_not_held: null,
          theme: "Esperança",
          observations: null,
          visitors: [],
          offering: 0,
        },
        _participant_ids: ["m1", "m2"],
      },
    ]);
    expect(toast).toHaveBeenCalledWith({ title: "Relatório salvo com sucesso" });
    expectNoDirectWrites();
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

  it("Dado que os participantes salvos não carregam, então o aviso pede para tentar de novo, Salvar fica desabilitado e 'Tentar de novo' recarrega", async () => {
    respondWith(
      { error: { code: "XX000", message: "internal error" } },
      { data: [{ member_id: "m1", member_name: "Ana Souza", member_deleted: false }] },
    );
    render(<CellReportForm report={editing} onClose={vi.fn()} />, { wrapper: createQueryWrapper() });

    const message = await screen.findByText("Não foi possível carregar os participantes. Tente de novo para poder salvar.");
    // O texto e o botão ficam na cor do texto (contraste, UX-38).
    expect(message.parentElement).toHaveClass("text-foreground");
    expect(screen.getByRole("button", SAVE)).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));

    expect(await screen.findByLabelText("Remover Ana Souza")).toBeInTheDocument();
    expect(screen.getByRole("button", SAVE)).toBeEnabled();
  });

  it("Dado um participante excluído entre a escolha e o envio, então a mensagem fica embaixo do campo, o chip é marcado, nada foi gravado e a nova tentativa envia de novo (UX-30; E2.05, RN-14)", async () => {
    respondWith({ data: [{ id: "m7", name: "Maria Mendes" }] });
    respondToRpc(
      "save_cell_report",
      {
        error: appError("deleted_member_chosen", "Este membro foi excluído e não pode ser escolhido.", {
          field: "member_id",
          member_id: "m7",
        }),
      },
      saved("new1"),
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
    await waitFor(() => expect(screen.getByLabelText(PARTICIPANTS)).toHaveFocus());
    // A recusa desfez tudo: não há relatório gravado pela metade (E2.05, RN-14).
    expect(screen.queryByText(/participantes ainda não/)).not.toBeInTheDocument();
    // O resto do formulário fica como estava.
    expect(screen.getByLabelText("Tema da Palavra")).toHaveValue("Fé que move montanhas");
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(removeMarked);
    expect(screen.queryByText("Este membro foi excluído e não pode ser escolhido.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", SAVE));
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    // Nada foi gravado na primeira: as duas tentativas são envios, cada uma com o conjunto daquele momento.
    expect(saveCalls().map((call) => call.args)).toEqual([
      expect.objectContaining({ _report_id: null, _participant_ids: ["m7"] }),
      expect.objectContaining({ _report_id: null, _participant_ids: [] }),
    ]);
    expectNoDirectWrites();
  });

  it("Dado um relatório novo com os participantes recusados, então nada foi gravado e o seletor de célula continua editável (E2.05, RN-14)", async () => {
    respondWith({ data: [todayCell] });
    respondToRpc("save_cell_report", {
      error: appError("too_many_participants", "Um relatório pode ter no máximo 1000 participantes."),
    });
    render(<CellReportForm onClose={vi.fn()} />, { wrapper: createQueryWrapper() });
    const cellInput = screen.getByLabelText(CELL);
    openMenu(cellInput);
    fireEvent.click(await screen.findByRole("option", { name: "Célula de Ana Alves, em Rua A 10, Centro" }));
    expect(cellInput).toBeEnabled();

    fireEvent.click(screen.getByRole("button", SAVE));

    expect(await screen.findByText("Um relatório pode ter no máximo 1000 participantes.")).toBeInTheDocument();
    expect(screen.getByLabelText(CELL)).toBeEnabled();
  });

  it("Dada a célula aberta em Células e excluída antes do envio, então o aviso no topo, com 'Fechar', Salvar desabilitado e as listas recarregadas (UX-30)", async () => {
    respondWith({ error: appError("cell_deleted", "Esta célula foi excluída e não recebe relatórios.", { cell_id: "c1" }) });
    const onClose = vi.fn();
    const invalidatedKeys = renderWatched(<CellReportForm initialCell={todayCell} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", SAVE));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Esta célula foi excluída e não recebe relatórios.");
    await waitFor(() => expect(alert).toHaveFocus());
    expect(saveCalls()).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
    // A célula não pode ser trocada: nada no formulário resolve.
    expect(screen.getByRole("button", SAVE)).toBeDisabled();
    // As listas recarregam já: "Cancelar", o X e o Esc também voltam a elas atualizadas.
    expect(invalidatedKeys()).toEqual(LISTS);

    fireEvent.click(within(alert).getByRole("button", { name: "Fechar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Dado um relatório novo aberto em Relatórios, com a célula escolhida excluída antes do envio, então o aviso fica sem 'Fechar' e dá para escolher outra célula (UX-30)", async () => {
    respondWith(
      { data: [todayCell] },
      { error: appError("cell_deleted", "Esta célula foi excluída e não recebe relatórios.", { cell_id: "c1" }) },
    );
    const invalidatedKeys = renderWatched(<CellReportForm onClose={vi.fn()} />);
    openMenu(screen.getByLabelText(CELL));
    fireEvent.click(await screen.findByRole("option", { name: "Célula de Ana Alves, em Rua A 10, Centro" }));

    fireEvent.click(screen.getByRole("button", SAVE));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Esta célula foi excluída e não recebe relatórios.");
    expect(within(alert).queryByRole("button", { name: "Fechar" })).not.toBeInTheDocument();
    expect(screen.getByLabelText(CELL)).toBeEnabled();
    expect(screen.getByRole("button", SAVE)).toBeEnabled();
    expect(invalidatedKeys()).toEqual([]);
  });

  it("Dada a edição recusada porque a célula foi excluída no meio tempo, então o aviso no topo, com 'Fechar', os dados ficam, Salvar fica desabilitado e o formulário não fecha (UX-28)", async () => {
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

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(message);
    expect(screen.getByLabelText("Tema da Palavra")).toHaveValue("Novo tema");
    expect(screen.getByLabelText("Remover Ana Souza")).toBeInTheDocument();
    // Nada no formulário resolve: só restaurar a célula.
    expect(screen.getByRole("button", SAVE)).toBeDisabled();
    expect(within(alert).getByRole("button", { name: "Fechar" })).toBeInTheDocument();
    expect(saveCalls()).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Dada a edição recusada com 'não existe ou já foi excluído', então o aviso, Salvar desabilitado e 'Fechar' volta para a lista (DT-19)", async () => {
    respondWith({ data: [] }, { error: GONE });
    const onClose = vi.fn();
    const invalidatedKeys = renderWatched(<CellReportForm report={editing} onClose={onClose} />);
    await waitFor(() => expect(screen.getByRole("button", SAVE)).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Tema da Palavra"), { target: { value: "Novo tema" } });

    fireEvent.click(screen.getByRole("button", SAVE));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Este relatório não existe ou já foi excluído. As alterações não foram salvas.");
    expect(screen.getByRole("button", SAVE)).toBeDisabled();
    expect(saveCalls()).toHaveLength(1);
    // As listas recarregam já, antes de qualquer botão.
    expect(invalidatedKeys()).toEqual(LISTS);

    fireEvent.click(within(alert).getByRole("button", { name: "Fechar" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("Depois do 'não existe ou já foi excluído', 'Cancelar' também volta para a lista já recarregada (DT-19)", async () => {
    respondWith({ data: [] }, { error: GONE });
    const onClose = vi.fn();
    const invalidatedKeys = renderWatched(<CellReportForm report={editing} onClose={onClose} />);
    await waitFor(() => expect(screen.getByRole("button", SAVE)).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Tema da Palavra"), { target: { value: "Novo tema" } });
    fireEvent.click(screen.getByRole("button", SAVE));
    await screen.findByRole("alert");

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(invalidatedKeys()).toContainEqual(["cell_reports", "list"]);
  });

  it("Dada uma falha ao salvar, então o aviso traz só a mensagem, sem um título repetido", async () => {
    respondWith({ error: { code: "23505", message: "duplicate key value violates unique constraint" } });
    render(<CellReportForm initialCell={todayCell} onClose={vi.fn()} />, { wrapper: createQueryWrapper() });

    fireEvent.click(screen.getByRole("button", SAVE));

    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(toast).toHaveBeenCalledWith({
      variant: "destructive",
      title: "Já existe um relatório dessa célula nesta semana (domingo a sábado).",
    });
  });
});

// Salvar sem mudança e falha da Auditoria, do servidor ou da rede (E2.05, T5, UX-08 e UX-09).
describe("CellReportForm: sem mudança e falha ao salvar (E2.05, T5)", () => {
  beforeAll(() => vi.stubGlobal("ResizeObserver", NoopResizeObserver));
  afterAll(() => vi.unstubAllGlobals());
  beforeEach(() => {
    resetFakeSupabase();
    toast.mockClear();
    auth.access = null;
    auth.permissions = new Set();
  });

  const ANA = { data: [{ member_id: "m1", member_name: "Ana Souza", member_deleted: false }] };
  const CONNECTION = "Não foi possível salvar o relatório. Verifique a conexão e tente de novo.";

  it("UX-08: na edição, 'Salvar' sem nenhuma mudança fecha sem nenhuma requisição de gravação, com 'Nenhuma alteração para salvar.'", async () => {
    respondWith(ANA);
    const onClose = vi.fn();
    render(<CellReportForm report={editing} onClose={onClose} />, { wrapper: createQueryWrapper() });
    await screen.findByLabelText("Remover Ana Souza");
    // Digitar e voltar ao valor original não conta.
    fireEvent.change(screen.getByLabelText("Tema da Palavra"), { target: { value: "Outro" } });
    fireEvent.change(screen.getByLabelText("Tema da Palavra"), { target: { value: "Fé" } });

    fireEvent.click(screen.getByRole("button", SAVE));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(saveCalls()).toHaveLength(0);
    expectNoDirectWrites();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith({ title: "Nenhuma alteração para salvar." });
  });

  it("Dado só um participante retirado, então é mudança: grava numa chamada, com o conjunto final", async () => {
    respondWith(ANA);
    respondToRpc("save_cell_report", saved("r1"));
    const onClose = vi.fn();
    render(<CellReportForm report={editing} onClose={onClose} />, { wrapper: createQueryWrapper() });
    fireEvent.click(await screen.findByLabelText("Remover Ana Souza"));

    fireEvent.click(screen.getByRole("button", SAVE));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(saveCalls().map((call) => call.args)).toEqual([expect.objectContaining({ _report_id: "r1", _participant_ids: [] })]);
    expect(toast).toHaveBeenCalledWith({ title: "Relatório salvo com sucesso" });
  });

  it("Dado que a tela acha que mudou e o servidor não (changed: false), então o mesmo aviso de 'sem mudança' (AQ-7)", async () => {
    respondWith(ANA);
    respondToRpc("save_cell_report", saved("r1", false));
    const onClose = vi.fn();
    render(<CellReportForm report={editing} onClose={onClose} />, { wrapper: createQueryWrapper() });
    await screen.findByLabelText("Remover Ana Souza");
    fireEvent.change(screen.getByLabelText("Tema da Palavra"), { target: { value: "Fé " } });

    fireEvent.click(screen.getByRole("button", SAVE));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith({ title: "Nenhuma alteração para salvar." });
    expect(toast).not.toHaveBeenCalledWith({ title: "Relatório salvo com sucesso" });
  });

  it.each([
    ["a falha da Auditoria (CHECK em events)", { code: "23514", message: 'new row for relation "events" violates check constraint "e205_qa_broken"' }],
    ["um erro 5xx", { code: "XX000", message: "internal error" }],
    ["a queda de rede", { code: "", message: "TypeError: Failed to fetch" }],
  ])("UX-09: com %s, o formulário fica aberto com os dados, a mensagem de conexão junto de 'Salvar', sem toast; a nova tentativa grava uma vez", async (_label, error) => {
    respondToRpc("save_cell_report", { error }, saved("new1"));
    const onClose = vi.fn();
    render(<CellReportForm initialCell={todayCell} onClose={onClose} />, { wrapper: createQueryWrapper() });
    fireEvent.change(screen.getByLabelText("Tema da Palavra"), { target: { value: "Fé que move montanhas" } });

    fireEvent.click(screen.getByRole("button", SAVE));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(CONNECTION);
    expect(alert).not.toHaveTextContent(/events|constraint|internal|fetch/i);
    // Logo acima dos botões.
    expect(alert.compareDocumentPosition(screen.getByRole("button", SAVE)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByLabelText("Tema da Palavra")).toHaveValue("Fé que move montanhas");
    expect(onClose).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", SAVE)).toHaveFocus());
    expect(screen.getByRole("button", SAVE)).toBeEnabled();

    fireEvent.click(screen.getByRole("button", SAVE));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(saveCalls()).toHaveLength(2);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith({ title: "Relatório salvo com sucesso" });
  });

  it("Enquanto envia, 'Salvando…' desabilitado, e um duplo toque não envia duas vezes", async () => {
    let release = () => {};
    respondToRpc("save_cell_report", { ...saved("new1"), until: new Promise<void>((resolve) => (release = resolve)) });
    const onClose = vi.fn();
    render(<CellReportForm initialCell={todayCell} onClose={onClose} />, { wrapper: createQueryWrapper() });
    const button = screen.getByRole("button", SAVE);

    fireEvent.click(button);
    fireEvent.click(button);

    expect(await screen.findByRole("button", { name: "Salvando…" })).toBeDisabled();
    release();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(saveCalls()).toHaveLength(1);
  });
});

// Escopo e quem lança (E2.02, T8, UXD-9, AQ-7). Os critérios completos (UX-26, UX-27) ficam com o QA.
describe("CellReportForm: escopo (E2.02, T8)", () => {
  beforeAll(() => vi.stubGlobal("ResizeObserver", NoopResizeObserver));
  afterAll(() => vi.unstubAllGlobals());
  beforeEach(() => {
    resetFakeSupabase();
    toast.mockClear();
    auth.access = null;
  });

  it("Dada uma célula só em que a pessoa pode lançar, então ela já vem escolhida, com o horário sugerido, e o seletor continua editável", async () => {
    respondWith({ data: [todayCell] });
    render(<CellReportForm onClose={vi.fn()} />, { wrapper: createQueryWrapper() });

    expect(await screen.findByText("Célula de Ana Alves, em Rua A 10, Centro")).toBeInTheDocument();
    expect(screen.getByLabelText("Horário *")).toHaveValue("20:00");
    expect(screen.getByLabelText(CELL)).toBeEnabled();
    const [query] = fakeQueries();
    expect(query.calls).toContainEqual(["eq", "can_submit_report", true]);
  });

  it("Dadas duas células, então nenhuma vem escolhida", async () => {
    respondWith({ data: [todayCell, { ...todayCell, id: "c2", leader_name: "Bruno Braga" }] });
    render(<CellReportForm onClose={vi.fn()} />, { wrapper: createQueryWrapper() });

    await waitFor(() => expect(fakeQueries()).toHaveLength(1));
    expect(screen.getByText("Buscar por líder, rua ou bairro…")).toBeInTheDocument();
  });

  it("Dado o lançamento recusado pela RN-13, então o aviso no topo com o foco, a célula desmarcada e o resto do formulário mantido", async () => {
    const message = "Você não pode enviar o relatório desta célula.";
    respondWith({ data: [todayCell] }, { error: appError("report_submit_not_allowed", message, { cell_id: "c1" }) });
    const onClose = vi.fn();
    const invalidatedKeys = renderWatched(<CellReportForm onClose={onClose} />);
    await screen.findByText("Célula de Ana Alves, em Rua A 10, Centro");
    fireEvent.change(screen.getByLabelText("Tema da Palavra"), { target: { value: "Fé" } });

    fireEvent.click(screen.getByRole("button", SAVE));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(message);
    await waitFor(() => expect(alert).toHaveFocus());
    expect(screen.queryByText("Célula de Ana Alves, em Rua A 10, Centro")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Tema da Palavra")).toHaveValue("Fé");
    expect(invalidatedKeys()).toContainEqual(["cells", "options"]);
    expect(invalidatedKeys()).toContainEqual(["access"]);
    expect(toast).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Dado um 42501 ao salvar, então o texto de permissão no topo, sem toast, e o acesso é relido (T11)", async () => {
    respondWith({ data: [todayCell] }, { error: { code: "42501", message: "new row violates row-level security policy" } });
    const invalidatedKeys = renderWatched(<CellReportForm onClose={vi.fn()} />);
    await screen.findByText("Célula de Ana Alves, em Rua A 10, Centro");

    fireEvent.click(screen.getByRole("button", SAVE));

    expect(await screen.findByRole("alert")).toHaveTextContent("Você não tem permissão para esta ação.");
    expect(invalidatedKeys()).toContainEqual(["access"]);
    expect(toast).not.toHaveBeenCalled();
  });

  it("Dado um relatório em edição com participantes que a pessoa não vê, então o aviso aparece e some quando eles são retirados (UX-27)", async () => {
    respondWith({
      data: [
        { member_id: "m1", member_name: "Caio Lima", member_deleted: false, member_visible: true },
        { member_id: "m2", member_name: "Diego Reis", member_deleted: false, member_visible: false },
      ],
    });
    render(<CellReportForm report={editing} onClose={vi.fn()} />, { wrapper: createQueryWrapper() });
    const warning =
      "Alguns participantes não são do seu ministério: se você retirá-los, não poderá incluí-los de novo.";

    expect(await screen.findByText(warning)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Remover Diego Reis"));
    expect(screen.queryByText(warning)).not.toBeInTheDocument();
  });

  it("Dado quem vê só o ministério, então a dica dos participantes aparece ligada ao seletor; para quem vê a igreja toda, não", () => {
    const hint = "Aparecem só as pessoas do seu ministério.";
    auth.access = {
      member_id: "m-pedro",
      role_id: "r-lider",
      role_name: "Líder",
      role_is_protected: false,
      permissions: ["view_own_ministry"],
      sees_whole_church: false,
      sees_ministry: true,
      sees_whole_church_reports: false,
      sees_ministry_reports: true,
      can_create_member: false,
      can_assign_roles: false,
      can_submit_some_report: true,
    };
    const { unmount } = render(<CellReportForm initialCell={cell} onClose={vi.fn()} />, { wrapper: createQueryWrapper() });
    const hintElement = screen.getByText(hint);
    expect(screen.getByLabelText(PARTICIPANTS).getAttribute("aria-describedby")).toContain(hintElement.id);
    unmount();

    auth.access = { ...auth.access, sees_whole_church: true };
    render(<CellReportForm initialCell={cell} onClose={vi.fn()} />, { wrapper: createQueryWrapper() });
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
  });
});

// Célula inativada com o formulário aberto (E2.08, RN-11 c, T8, UX-23).
describe("CellReportForm: célula inativa (E2.08, T8)", () => {
  beforeAll(() => vi.stubGlobal("ResizeObserver", NoopResizeObserver));
  afterAll(() => vi.unstubAllGlobals());
  beforeEach(() => {
    resetFakeSupabase();
    toast.mockClear();
    auth.access = null;
    auth.permissions = new Set();
  });

  const inactive = () => ({ error: appError("cell_inactive", "Esta célula está inativa e não recebe relatórios.", { cell_id: "c1" }) });

  it("aberto pela lista: o aviso com a orientação de reativar (com 'Editar Célula'), 'Fechar', os dados mantidos e sem toast", async () => {
    auth.permissions = new Set(["edit_cell"]);
    respondWith(inactive());
    const onClose = vi.fn();
    const invalidatedKeys = renderWatched(<CellReportForm initialCell={todayCell} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("Tema da Palavra"), { target: { value: "Fé que move montanhas" } });

    fireEvent.click(screen.getByRole("button", SAVE));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Esta célula está inativa e não recebe relatórios. Para enviar um relatório, reative a célula.");
    await waitFor(() => expect(alert).toHaveFocus());
    expect(screen.getByLabelText("Tema da Palavra")).toHaveValue("Fé que move montanhas");
    expect(invalidatedKeys()).toContainEqual(["cells"]);
    expect(invalidatedKeys()).toContainEqual(["access"]);
    expect(toast).not.toHaveBeenCalled();
    expect(screen.getByRole("button", SAVE)).toBeDisabled();

    fireEvent.click(within(alert).getByRole("button", { name: "Fechar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("aberto por Relatórios, sem 'Editar Célula': a orientação de pedir à liderança e a célula desmarcada", async () => {
    respondWith({ data: [todayCell] }, inactive());
    const onClose = vi.fn();
    renderWatched(<CellReportForm onClose={onClose} />);
    await screen.findByText("Célula de Ana Alves, em Rua A 10, Centro");

    fireEvent.click(screen.getByRole("button", SAVE));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Esta célula está inativa e não recebe relatórios. Se ela voltou a se reunir, peça à sua liderança para reativá-la.",
    );
    expect(within(alert).queryByRole("button", { name: "Fechar" })).not.toBeInTheDocument();
    expect(screen.queryByText("Célula de Ana Alves, em Rua A 10, Centro")).not.toBeInTheDocument();
    expect(toast).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("E2.05, UX-03: a autoria na edição do relatório (T4, P30)", () => {
  beforeEach(() => resetFakeSupabase());

  it("na edição, antes do campo Célula; no relatório novo, não aparece", async () => {
    respondWith({ data: [] });
    const { unmount } = render(<CellReportForm report={report} onClose={vi.fn()} />, { wrapper: createQueryWrapper() });
    const block = await screen.findByTestId("record-authorship");
    expect(block).toHaveAttribute("data-entity", "cell_report");
    expect(block).toHaveAttribute("data-record-id", "r1");
    const cellLabel = screen.getByText("Célula *");
    expect((block.compareDocumentPosition(cellLabel) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true);
    unmount();

    render(<CellReportForm onClose={vi.fn()} />, { wrapper: createQueryWrapper() });
    expect(screen.queryByTestId("record-authorship")).not.toBeInTheDocument();
  });
});
