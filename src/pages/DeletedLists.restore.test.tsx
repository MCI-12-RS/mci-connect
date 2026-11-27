import type { ReactNode } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeQueries, fakeRpcs, resetFakeSupabase, respondToRpc, respondWith } from "@/test/fake-supabase";
import type { DeletedCellReportRow, DeletedCellRow, DeletedMemberRow } from "@/lib/deletion/deleted-lists";
import MembersDeleted from "./MembersDeleted";
import CellsDeleted from "./CellsDeleted";
import CellReportsDeleted from "./CellReportsDeleted";

// Restauração nas listas de excluídos (E2.01, T5 e T6), o que os testes da
// tarefa 11 não cobrem:
// - UX-20: célula e relatório restauram sem confirmação; a de membro só chama
//   o servidor ao confirmar, e "Cancelar" não chama;
// - UX-23: as recusas da tabela da T6 (dado em uso por e-mail e CPF, função
//   acima, pessoa excluída na célula por líder, timóteo e anfitrião, semana
//   ocupada), com a ação que resolve e o foco; sem servidor quando o card já
//   mostra o motivo;
// - UX-24: "não está excluído" do relatório, o "não encontrado" (DA-4) e a
//   nova tentativa depois da queda de conexão, como aviso informativo, e a
//   lista recarrega.
// As recusas usam o formato que o banco devolve (`_del_raise`: SQLSTATE 22023,
// DETAIL em JSON com o `code`, HINT "app_error").

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

vi.mock("@/components/AppLayout", () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isSystem: false,
    permissionsLoaded: true,
    hasPermission: (...permissions: string[]) => permissions.some((p) => p === "manage_roles" || p === "edit_member"),
  }),
}));

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

/** A recusa como o PostgREST repassa o `_del_raise`. */
const appError = (code: string, message: string, detail: object = {}) => ({
  error: { code: "22023", message, details: JSON.stringify({ ...detail, code }), hint: "app_error" },
});

const NETWORK_ERROR = { error: { code: "", message: "TypeError: Failed to fetch" } };

const bruno: DeletedMemberRow = {
  id: "b1",
  name: "Bruno Almeida",
  is_active: true,
  leader_name: "Gil Souza",
  leader_deleted: true,
  restore_role_name: "Líder",
  has_account: true,
  deleted_at: "2026-11-10T17:32:00+00:00",
  deleted_by_name: "Elisa Martins",
  deleted_by_kind: "member",
};

const paula: DeletedMemberRow = {
  id: "p1",
  name: "Paula Reis",
  is_active: false,
  leader_name: null,
  leader_deleted: false,
  restore_role_name: null,
  has_account: false,
  deleted_at: "2026-11-02T12:10:00+00:00",
  deleted_by_name: null,
  deleted_by_kind: null,
};

const cell = (id: string, leader: string, people: Partial<DeletedCellRow> = {}): DeletedCellRow => ({
  id,
  type: "Evangelística",
  meeting_day: "Quarta",
  meeting_time: "20:00:00",
  neighborhood: "Centro",
  leader_id: `m-${id}`,
  leader_name: leader,
  leader_deleted: false,
  timothy_id: "m-tito",
  timothy_name: "Tito Lima",
  timothy_deleted: false,
  host_id: "m-quintino",
  host_name: "Quintino Reis",
  host_deleted: false,
  deleted_at: "2026-11-12T13:05:00Z",
  deleted_by_name: "Elisa Martins",
  deleted_by_kind: "member",
  ...people,
});

const report = (id: string, date: string, people: Partial<DeletedCellReportRow> = {}): DeletedCellReportRow => ({
  id,
  date,
  time: "20:00:00",
  was_held: true,
  theme: "Fé que move",
  cell_leader_name: "Carlos Lima",
  cell_deleted: false,
  week_taken: false,
  deleted_at: "2026-11-20T11:00:00Z",
  deleted_by_name: "Gil Souza",
  deleted_by_kind: "member",
  ...people,
});

/** Mostra o endereço atual, para conferir para onde a ação do bloqueio leva. */
const Where = () => {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
};

const originalWidth = window.innerWidth;
const setWidth = (width: number) => Object.defineProperty(window, "innerWidth", { configurable: true, value: width });

function renderAt(path: string, element: ReactNode, rows: unknown[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  respondWith({ data: rows, count: rows.length });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={path} element={element} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const listReads = (view: string) => fakeQueries().filter((query) => query.table === view);

beforeEach(() => {
  resetFakeSupabase();
  toast.mockClear();
  setWidth(360);
});

afterEach(() => setWidth(originalWidth));

describe("UX-20: o que pede confirmação na restauração", () => {
  it("Dada uma célula excluída, quando toca em 'Restaurar', então chama o servidor na hora, sem confirmação", async () => {
    renderAt("/cells/deleted", <CellsDeleted />, [cell("c2", "Carlos Lima")]);
    respondToRpc("restore_cell", {});
    respondWith({ data: [], count: 0 });

    fireEvent.click(await screen.findByRole("button", { name: "Restaurar a célula de Carlos Lima" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await waitFor(() => expect(fakeRpcs().map((call) => [call.fn, call.args])).toEqual([["restore_cell", { _cell_id: "c2" }]]));
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "Célula restaurada." }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("Dado um relatório excluído, quando toca em 'Restaurar', então chama o servidor na hora, sem confirmação", async () => {
    renderAt("/cell-reports/deleted", <CellReportsDeleted />, [report("r2", "2026-11-12")]);
    respondToRpc("restore_cell_report", {});
    respondWith({ data: [], count: 0 });

    fireEvent.click(await screen.findByRole("button", { name: "Restaurar o relatório de 12/11/2026 da célula de Carlos Lima" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await waitFor(() => expect(fakeRpcs().map((call) => call.fn)).toEqual(["restore_cell_report"]));
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "Relatório restaurado." }));
  });

  it("Dado um membro com conta, líder excluído e função, então a confirmação traz os 4 tópicos, nessa ordem", async () => {
    renderAt("/members/deleted", <MembersDeleted />, [bruno, paula]);
    fireEvent.click(await screen.findByRole("button", { name: "Restaurar Bruno Almeida" }));

    const dialog = await screen.findByRole("alertdialog", { name: "Restaurar o cadastro de Bruno Almeida?" });
    expect(within(dialog).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "O cadastro volta às listas e aos totais, com os mesmos dados e a função Líder.",
      "A pessoa volta a entrar no sistema com a mesma senha.",
      "O vínculo de cônjuge não volta. Se havia, refaça-o no cadastro.",
      "Volta sem líder, porque o líder anterior (Gil Souza) foi excluído.",
    ]);
    expect(fakeRpcs()).toHaveLength(0);
  });

  it("Dado um membro sem conta, sem função e sem líder, então a confirmação fica só com a volta e o cônjuge", async () => {
    renderAt("/members/deleted", <MembersDeleted />, [bruno, paula]);
    fireEvent.click(await screen.findByRole("button", { name: "Restaurar Paula Reis" }));

    const dialog = await screen.findByRole("alertdialog", { name: "Restaurar o cadastro de Paula Reis?" });
    expect(within(dialog).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "O cadastro volta às listas e aos totais, com os mesmos dados.",
      "O vínculo de cônjuge não volta. Se havia, refaça-o no cadastro.",
    ]);
  });

  it("Quando cancela a confirmação do membro, então nada é chamado, e o foco volta ao 'Restaurar' dele", async () => {
    renderAt("/members/deleted", <MembersDeleted />, [bruno, paula]);
    const button = await screen.findByRole("button", { name: "Restaurar Bruno Almeida" });
    act(() => button.focus());
    fireEvent.click(button);

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(fakeRpcs()).toHaveLength(0);
    await waitFor(() => expect(button).toHaveFocus());
  });
});

describe("UX-23: recusas da restauração (tabela da T6)", () => {
  it.each([
    ["email", "e-mail"],
    ["cpf", "CPF"],
  ])(
    "RN-16 (e): dado em uso (%s), então o diálogo de bloqueio mostra 'outro cadastro já usa este %s', só com 'Fechar'",
    async (field, label) => {
      renderAt("/members/deleted", <MembersDeleted />, [bruno, paula]);
      fireEvent.click(await screen.findByRole("button", { name: "Restaurar Paula Reis" }));
      const message = `Não é possível restaurar: outro cadastro já usa este ${label}.`;
      respondToRpc("restore_member", appError("restore_value_in_use", message, { fields: [field] }));
      // A lista recarrega depois da recusa, ainda com ele.
      respondWith({ data: [bruno, paula], count: 2 });
      fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Restaurar cadastro" }));

      const dialog = await screen.findByRole("alertdialog", { name: "Não é possível restaurar Paula Reis" });
      expect(dialog).toHaveTextContent(message);
      expect(within(dialog).getAllByRole("button").map((button) => button.textContent)).toEqual(["Fechar"]);
      expect(toast).not.toHaveBeenCalled();
      // Recusado, ele continua na lista.
      fireEvent.click(within(dialog).getByRole("button", { name: "Fechar" }));
      await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
      expect(screen.getByRole("button", { name: "Restaurar Paula Reis" })).toBeInTheDocument();
    },
  );

  it("RN-16 (b): função acima de quem restaura, então 'Você não tem permissão para restaurar este membro.', só com 'Fechar'", async () => {
    renderAt("/members/deleted", <MembersDeleted />, [bruno, paula]);
    fireEvent.click(await screen.findByRole("button", { name: "Restaurar Bruno Almeida" }));
    respondToRpc("restore_member", appError("restore_role_above", "Você não tem permissão para restaurar este membro."));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Restaurar cadastro" }));

    const title = await screen.findByRole("heading", { name: "Não é possível restaurar Bruno Almeida" });
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("Você não tem permissão para restaurar este membro.");
    expect(within(dialog).getAllByRole("button").map((button) => button.textContent)).toEqual(["Fechar"]);
    // O conteúdo troca dentro do diálogo: o foco vai para o título (Acessibilidade).
    await waitFor(() => expect(title).toHaveFocus());
    // Não é o toast genérico de permissão (42501).
    expect(toast).not.toHaveBeenCalled();
  });

  it.each([
    ["líder", { leader_deleted: true }, "Rui Prado", "Célula de Rui Prado (cadastro excluído)"],
    ["timóteo", { timothy_deleted: true }, "Tito Lima", "Timóteo: Tito Lima (cadastro excluído)"],
    ["anfitrião", { host_deleted: true }, "Quintino Reis", "Anfitrião: Quintino Reis (cadastro excluído)"],
  ] as const)(
    "RN-17: célula com o %s excluído (o card já mostra), então o bloqueio abre sem servidor, com 'Ver membros excluídos' no foco",
    async (role, people, name, cardText) => {
      renderAt("/cells/deleted", <CellsDeleted />, [cell("c1", "Rui Prado", people)]);
      const card = (await screen.findByText(/^Célula de Rui Prado/)).closest("li");
      expect(card).toHaveTextContent(cardText);

      fireEvent.click(within(card).getByRole("button", { name: "Restaurar a célula de Rui Prado" }));

      const dialog = await screen.findByRole("alertdialog", { name: "Não é possível restaurar a célula de Rui Prado" });
      expect(dialog).toHaveTextContent(
        `Não é possível restaurar a célula: o ${role} ${name} foi excluído. Restaure o cadastro dele antes ou crie uma célula nova.`,
      );
      const action = within(dialog).getByRole("button", { name: "Ver membros excluídos" });
      await waitFor(() => expect(action).toHaveFocus());
      expect(fakeRpcs()).toHaveLength(0);

      fireEvent.click(action);
      expect(await screen.findByTestId("where")).toHaveTextContent(
        `/members/deleted?${new URLSearchParams({ q: name }).toString()}`,
      );
    },
  );

  it("RN-17 e DA-5: célula com o líder e o anfitrião excluídos, então cita o líder, sem servidor", async () => {
    renderAt("/cells/deleted", <CellsDeleted />, [cell("c1", "Rui Prado", { leader_deleted: true, host_deleted: true })]);
    fireEvent.click(await screen.findByRole("button", { name: "Restaurar a célula de Rui Prado" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("o líder Rui Prado foi excluído");
    expect(dialog).not.toHaveTextContent("Quintino");
    expect(fakeRpcs()).toHaveLength(0);
  });

  it("Quando fecha o bloqueio antecipado da célula, então o foco volta ao 'Restaurar' dela, e nada foi chamado", async () => {
    renderAt("/cells/deleted", <CellsDeleted />, [cell("c1", "Rui Prado", { host_deleted: true }), cell("c2", "Carlos Lima")]);
    const button = await screen.findByRole("button", { name: "Restaurar a célula de Rui Prado" });
    act(() => button.focus());
    fireEvent.click(button);

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Fechar" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    await waitFor(() => expect(button).toHaveFocus());
    expect(fakeRpcs()).toHaveLength(0);
    expect(toast).not.toHaveBeenCalled();
  });

  it("RN-17: semana ocupada (o card já mostra) e sem o nome do líder, então o bloqueio abre sem servidor, só com 'Fechar', no foco", async () => {
    renderAt("/cell-reports/deleted", <CellReportsDeleted />, [report("r1", "2026-11-19", { week_taken: true, cell_leader_name: null })]);
    const card = (await screen.findByText("Célula de Membro sem nome")).closest("li");
    expect(card).toHaveTextContent("Já há outro relatório desta célula na mesma semana.");

    fireEvent.click(within(card).getByRole("button", { name: "Restaurar o relatório de 19/11/2026 da célula de Membro sem nome" }));

    const dialog = await screen.findByRole("alertdialog", { name: "Não é possível restaurar o relatório de 19/11/2026 da célula de Membro sem nome" });
    expect(dialog).toHaveTextContent("Esta célula já tem outro relatório na mesma semana. Exclua-o antes de restaurar este.");
    const close = within(dialog).getByRole("button", { name: "Fechar" });
    expect(within(dialog).getAllByRole("button").map((button) => button.textContent)).toEqual(["Fechar"]);
    await waitFor(() => expect(close).toHaveFocus());
    expect(fakeRpcs()).toHaveLength(0);
  });

  it("RN-17: semana ocupada na tabela (desktop), então o mesmo bloqueio, sem servidor, com 'Ver relatórios da célula'", async () => {
    setWidth(1280);
    renderAt("/cell-reports/deleted", <CellReportsDeleted />, [report("r1", "2026-11-19", { week_taken: true })]);
    const row = (await screen.findByText("Carlos Lima")).closest("tr");
    expect(row).toHaveTextContent("Já há outro relatório desta célula na mesma semana.");

    fireEvent.click(within(row).getByRole("button", { name: "Restaurar o relatório de 19/11/2026 da célula de Carlos Lima" }));

    const dialog = await screen.findByRole("alertdialog");
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Ver relatórios da célula" })).toHaveFocus());
    expect(fakeRpcs()).toHaveLength(0);
  });

  it("RN-17: a semana fica ocupada depois de a lista carregar, então o servidor recusa, e o bloqueio abre com a mensagem e a lista recarrega", async () => {
    renderAt("/cell-reports/deleted", <CellReportsDeleted />, [report("r2", "2026-11-12")]);
    respondToRpc(
      "restore_cell_report",
      appError("restore_week_taken", "Esta célula já tem outro relatório na mesma semana. Exclua-o antes de restaurar este.", {
        report_id: "r9",
        week_start: "2026-11-08",
      }),
    );
    respondWith({ data: [report("r2", "2026-11-12", { week_taken: true })], count: 1 });
    fireEvent.click(await screen.findByRole("button", { name: "Restaurar o relatório de 12/11/2026 da célula de Carlos Lima" }));

    const dialog = await screen.findByRole("alertdialog", { name: "Não é possível restaurar o relatório de 12/11/2026 da célula de Carlos Lima" });
    expect(dialog).toHaveTextContent("Esta célula já tem outro relatório na mesma semana.");
    expect(fakeRpcs()).toHaveLength(1);
    // A recusa pode vir de algo que a lista ainda não mostrava: ela recarrega e passa a mostrar o aviso.
    await waitFor(() => expect(listReads("cell_reports_deleted_view")).toHaveLength(2));
    expect(await screen.findByText("Já há outro relatório desta célula na mesma semana.")).toBeInTheDocument();
  });
});

describe("UX-24: o que já não está excluído vira aviso informativo, e a lista recarrega", () => {
  it("Dado um relatório que outra pessoa já restaurou, então 'Este relatório não está excluído.' é toast informativo, sem diálogo", async () => {
    renderAt("/cell-reports/deleted", <CellReportsDeleted />, [report("r2", "2026-11-12")]);
    respondToRpc("restore_cell_report", appError("not_deleted", "Este relatório não está excluído.", { entity: "cell_report" }));
    respondWith({ data: [], count: 0 });
    fireEvent.click(await screen.findByRole("button", { name: "Restaurar o relatório de 12/11/2026 da célula de Carlos Lima" }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "Este relatório não está excluído." }));
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await waitFor(() => expect(listReads("cell_reports_deleted_view")).toHaveLength(2));
    expect(await screen.findByText("Nenhum relatório excluído.")).toBeInTheDocument();
  });

  it("DA-4: um cadastro que não existe mais para quem restaura, então 'Este cadastro não foi encontrado.' é toast informativo, e a lista recarrega", async () => {
    renderAt("/members/deleted", <MembersDeleted />, [bruno, paula]);
    fireEvent.click(await screen.findByRole("button", { name: "Restaurar Paula Reis" }));
    respondToRpc("restore_member", appError("not_found", "Este cadastro não foi encontrado.", { entity: "member" }));
    respondWith({ data: [bruno], count: 1 });
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Restaurar cadastro" }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "Este cadastro não foi encontrado." }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText("Paula Reis")).not.toBeInTheDocument());
    expect(listReads("members_deleted_view")).toHaveLength(2);
  });

  it("Dada uma queda de conexão, quando tenta de novo e a primeira tinha valido, então o aviso informativo e a lista recarrega", async () => {
    renderAt("/cells/deleted", <CellsDeleted />, [cell("c2", "Carlos Lima")]);
    respondToRpc("restore_cell", NETWORK_ERROR, appError("not_deleted", "Esta célula não está excluída.", { entity: "cell" }));
    const button = await screen.findByRole("button", { name: "Restaurar a célula de Carlos Lima" });

    fireEvent.click(button);
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        variant: "destructive",
        title: "Não foi possível restaurar. Verifique a conexão e tente de novo.",
      }),
    );
    // Na queda de conexão, a lista não recarrega e o botão volta.
    await waitFor(() => expect(button).toHaveTextContent("Restaurar"));
    expect(button).not.toHaveAttribute("aria-disabled");
    expect(listReads("cells_deleted_view")).toHaveLength(1);

    respondWith({ data: [], count: 0 });
    fireEvent.click(button);
    await waitFor(() => expect(toast).toHaveBeenLastCalledWith({ title: "Esta célula não está excluída." }));
    await waitFor(() => expect(listReads("cells_deleted_view")).toHaveLength(2));
    expect(await screen.findByText("Nenhuma célula excluída.")).toBeInTheDocument();
  });
});
