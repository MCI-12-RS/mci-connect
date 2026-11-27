import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeRpcs, resetFakeSupabase, respondToRpc, respondWith } from "@/test/fake-supabase";
import { reportSnapshotColumns } from "@/test/report-snapshot-fixture";
import type { Access } from "@/lib/access/access";
import type { CellSummary } from "@/lib/cells/fields";
import { CellReportDialog } from "./CellReportDialog";

// QA do E2.11 (PRs 3 e 4): o que o CellReportDialog.test.tsx do desenvolvedor não cobre. O envio e a
// edição pelos hooks reais, o banco como cliente falso (as RPCs com fila própria).
//   RN-09 e P20 (o que sai em "Não houve célula"), RN-11 (automáticos fixos e contados), P-REL-29 e P107
//   (nova tentativa, id, troca de célula, `replayed`), UXD-4 (conferência sem conexão), T9 (edição).

vi.mock("@/components/RecordAuthorship", async () => {
  const { RecordAuthorshipStub } = await import("@/test/record-authorship-stub");
  return { RecordAuthorship: RecordAuthorshipStub };
});

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

const ACCESS: Access = {
  member_id: "m-carla",
  role_id: "r-membro",
  role_name: "Membro",
  role_is_protected: false,
  permissions: ["view_own_ministry", "submit_own_cell_report", "edit_cell_report"],
  sees_whole_church: false,
  sees_ministry: true,
  sees_whole_church_reports: false,
  sees_ministry_reports: true,
  can_create_member: false,
  can_assign_roles: false,
  can_submit_some_report: true,
};
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ access: ACCESS, hasPermission: (p: string) => ACCESS.permissions.includes(p as never) }),
}));

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

const C1: CellSummary = {
  id: "c1",
  leader_id: "andre",
  leader_name: "André Souza",
  timothy_id: "caio",
  timothy_name: "Caio Lima",
  host_id: "carla",
  host_name: "Carla Dias",
  type: "Evangelística",
  meeting_day: "Quarta",
  meeting_time: "20:00:00",
  street: "Rua das Flores",
  number: "100",
  neighborhood: "Centro",
  g12_leader_name: "Pedro Alves",
  leader_g12_level: 2,
  leader_is_pastor: false,
};
const C5: CellSummary = {
  ...C1,
  id: "c5",
  leader_id: "samuel",
  leader_name: "Samuel Prado",
  timothy_id: "samuel",
  timothy_name: "Samuel Prado",
  host_id: "paula",
  host_name: "Paula Reis",
  meeting_day: "Sábado",
  meeting_time: "22:00:00",
};

const CHECK = {
  status: "can_submit",
  server_now: "2026-11-26T00:30:00Z",
  today: "2026-11-25",
  week_start: "2026-11-22",
  week_end: "2026-11-28",
  meeting_date: "2026-11-25",
  meeting_time: "20:00:00",
  allowed_dates: ["2026-11-25"],
  existing_report_id: null,
  existing_date: null,
  existing_time: null,
  existing_was_held: null,
  existing_can_edit: null,
};

const SUBMITTED = (outcome: "created" | "replayed", sameContent = true) => ({
  data: [{ report_id: "r-new", outcome, same_content: sameContent }],
});
const CONNECTION = { error: { code: "", message: "TypeError: Failed to fetch" } };

type OpenProps = { mode: "launch"; cell?: CellSummary | null } | { mode: "edit"; reportId: string };

function renderDialog(props: OpenProps) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <CellReportDialog {...props} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose };
}

const dialog = () => screen.getByRole("dialog");
const submitCalls = () => fakeRpcs().filter((rpc) => rpc.fn === "submit_cell_report");
const saveCalls = () => fakeRpcs().filter((rpc) => rpc.fn === "save_cell_report");
const send = () => fireEvent.click(within(dialog()).getByRole("button", { name: "Enviar relatório" }));

async function fillHeld() {
  fireEvent.change(await within(dialog()).findByLabelText("Tema *"), { target: { value: "A fé que vence" } });
  fireEvent.change(within(dialog()).getByLabelText("Oferta *"), { target: { value: "0" } });
}

beforeEach(() => {
  resetFakeSupabase();
  toast.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("P-REL-29, P107, RN-14: a nova tentativa e o id do envio", () => {
  it("UX-28: depois de uma queda, a nova tentativa envia o mesmo _report_id e o seletor de célula fica travado", async () => {
    respondToRpc("cell_report_launch_check", { data: [CHECK] });
    respondToRpc("submit_cell_report", CONNECTION, SUBMITTED("created"));
    // A célula livre com uma só opção entra escolhida.
    respondWith({ data: [C1] });
    const { onClose } = renderDialog({ mode: "launch", cell: null });

    await fillHeld();
    send();
    expect(await within(dialog()).findByText("Não foi possível enviar o relatório. Verifique a conexão e tente de novo.")).toBeInTheDocument();
    // Os dados ficam, e o seletor não deixa trocar de célula (a tentativa pode ter gravado).
    expect(within(dialog()).getByLabelText("Tema *")).toHaveValue("A fé que vence");
    expect(dialog().querySelector("#report-cell")).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();

    send();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const [first, second] = submitCalls();
    expect(submitCalls()).toHaveLength(2);
    const firstId = (first.args as { _report_id: string })._report_id;
    expect(firstId).toMatch(/^[0-9a-f-]{36}$/);
    expect((second.args as { _report_id: string })._report_id).toBe(firstId);
    expect(toast).toHaveBeenCalledWith({ title: "Relatório enviado." });
  });

  it("repetição do mesmo envio: 'replayed' com o mesmo conteúdo é 'Relatório enviado.'", async () => {
    respondToRpc("cell_report_launch_check", { data: [CHECK] });
    respondToRpc("submit_cell_report", SUBMITTED("replayed", true));
    respondWith({ data: [] });
    const { onClose } = renderDialog({ mode: "launch", cell: C1 });
    await fillHeld();
    send();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(toast).toHaveBeenCalledWith({ title: "Relatório enviado." });
  });

  it("repetição com o formulário mudado depois da primeira tentativa: 'replayed' diferente avisa que as alterações não foram salvas", async () => {
    respondToRpc("cell_report_launch_check", { data: [CHECK] });
    respondToRpc("submit_cell_report", SUBMITTED("replayed", false));
    respondWith({ data: [] });
    const { onClose } = renderDialog({ mode: "launch", cell: C1 });
    await fillHeld();
    send();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(toast).toHaveBeenCalledWith({
      title: "O relatório foi enviado na primeira tentativa. As alterações feitas depois não foram salvas.",
    });
  });

  it("trocar de célula antes de enviar gera um id novo (um por célula)", async () => {
    respondToRpc("cell_report_launch_check", { data: [CHECK] }, { data: [{ ...CHECK, meeting_date: "2026-11-28", allowed_dates: ["2026-11-28"], meeting_time: "22:00:00" }] });
    respondToRpc("submit_cell_report", SUBMITTED("created"), SUBMITTED("created"));
    // Duas células: nada entra escolhido; o seletor lê a primeira página ao abrir.
    respondWith({ data: [C1, C5] }, { data: [C1, C5] }, { data: [C1, C5] }, { data: [C1, C5] });
    renderDialog({ mode: "launch", cell: null });

    const pick = async (leader: string) => {
      const combobox = within(dialog()).getByRole("combobox", { name: /Célula/ });
      fireEvent.focus(combobox);
      fireEvent.keyDown(combobox, { key: "ArrowDown" });
      fireEvent.click(await screen.findByText(new RegExp(leader)));
    };

    await pick("André Souza");
    await fillHeld();
    // O bloco da primeira célula, depois a troca para a segunda.
    await pick("Samuel Prado");
    await waitFor(() => expect(within(dialog()).getByRole("region", { name: "Dados da célula" })).toHaveTextContent("Samuel Prado"));
    await fillHeld();
    send();
    await waitFor(() => expect(submitCalls()).toHaveLength(1));
    const only = submitCalls()[0].args as { _report_id: string; _report: { cell_id: string } };
    expect(only._report.cell_id).toBe("c5");
    // O id do envio da segunda célula não é o da abertura: o primeiro id nunca foi usado.
    expect(only._report_id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("UXD-4, UX-12: sem conexão", () => {
  it("a conferência que falha libera os campos, e o 'Tentar de novo' bem-sucedido tira o aviso", async () => {
    respondToRpc("cell_report_launch_check", CONNECTION, { data: [CHECK] });
    respondWith({ data: [] });
    renderDialog({ mode: "launch", cell: C1 });
    const failed = await within(dialog()).findByText(/Não foi possível conferir se o relatório desta semana já foi enviado/);
    expect(failed).toBeInTheDocument();
    expect(within(dialog()).getByLabelText("Tema *")).toBeInTheDocument();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(screen.queryByText(/Não foi possível conferir/)).not.toBeInTheDocument());
    expect(within(dialog()).getByLabelText("Tema *")).toBeInTheDocument();
  });

  it("com a conferência falha, o envio vai mesmo assim (a conferência é refeita no servidor)", async () => {
    respondToRpc("cell_report_launch_check", CONNECTION);
    respondToRpc("submit_cell_report", SUBMITTED("created"));
    respondWith({ data: [] });
    const { onClose } = renderDialog({ mode: "launch", cell: C1 });
    await within(dialog()).findByText(/Não foi possível conferir/);
    await fillHeld();
    send();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(submitCalls()).toHaveLength(1);
  });
});

describe("RN-11, UX-20: participantes automáticos", () => {
  it("o líder, o timóteo e o anfitrião aparecem fixos (sem ✕), contados, e não vão na lista de escolhidos", async () => {
    respondToRpc("cell_report_launch_check", { data: [CHECK] });
    respondToRpc("submit_cell_report", SUBMITTED("created"));
    respondWith({ data: [] });
    renderDialog({ mode: "launch", cell: C1 });
    await fillHeld();
    const group = within(dialog()).getByRole("group", { name: "Participantes" });
    expect(within(group).getByText("O líder, o timóteo e o anfitrião entram automaticamente.")).toBeInTheDocument();
    for (const name of ["André Souza", "Caio Lima", "Carla Dias"]) {
      expect(within(group).getByText(new RegExp(name))).toBeInTheDocument();
    }
    expect(within(group).queryByRole("button", { name: /Retirar/ })).not.toBeInTheDocument();
    expect(within(group).getByText("Participantes: 3")).toBeInTheDocument();
    send();
    await waitFor(() => expect(submitCalls()).toHaveLength(1));
    expect((submitCalls()[0].args as { _participant_ids: string[] })._participant_ids).toEqual([]);
  });

  it("a mesma pessoa em dois papéis conta uma vez (Samuel líder e timóteo: total 2)", async () => {
    respondToRpc("cell_report_launch_check", { data: [{ ...CHECK, meeting_date: "2026-11-25", meeting_time: "22:00:00" }] });
    respondWith({ data: [] });
    renderDialog({ mode: "launch", cell: C5 });
    await within(dialog()).findByLabelText("Tema *");
    const group = within(dialog()).getByRole("group", { name: "Participantes" });
    expect(within(group).getAllByText(/Samuel Prado/)).toHaveLength(1);
    expect(within(group).getByText("Participantes: 2")).toBeInTheDocument();
  });
});

describe("RN-09, P20: 'Não houve célula'", () => {
  async function openNotHeld() {
    respondToRpc("cell_report_launch_check", { data: [CHECK] });
    respondWith({ data: [] });
    const view = renderDialog({ mode: "launch", cell: C1 });
    fireEvent.change(await within(dialog()).findByLabelText("Tema *"), { target: { value: "A fé que vence" } });
    return view;
  }

  it("com só o tema preenchido, o aviso é no singular: 'Ao enviar, não será enviado: o tema.'", async () => {
    await openNotHeld();
    fireEvent.click(within(dialog()).getByRole("radio", { name: /Não houve célula/ }));
    expect(await within(dialog()).findByText("Ao enviar, não será enviado: o tema.")).toBeInTheDocument();
  });

  it("com tema, visitante e oferta, o aviso é no plural e lista cada item", async () => {
    await openNotHeld();
    fireEvent.change(within(dialog()).getByLabelText("Nome do visitante 1"), { target: { value: "Bruno" } });
    fireEvent.change(within(dialog()).getByLabelText("Oferta *"), { target: { value: "5000" } });
    fireEvent.click(within(dialog()).getByRole("radio", { name: /Não houve célula/ }));
    const notice = await within(dialog()).findByText(/^Ao enviar, não serão enviados:/);
    expect(notice).toHaveTextContent("o tema");
    expect(notice).toHaveTextContent("1 visitante");
    expect(notice).toHaveTextContent("a oferta (R$ 50,00)");
  });

  it("exige o motivo (sem chamada) e, com ele, envia só a célula, a situação e o motivo, sem participantes", async () => {
    respondToRpc("submit_cell_report", SUBMITTED("created"));
    const { onClose } = await openNotHeld();
    fireEvent.click(within(dialog()).getByRole("radio", { name: /Não houve célula/ }));
    send();
    expect(await within(dialog()).findByText("Informe o motivo de não ter havido célula.")).toBeInTheDocument();
    expect(submitCalls()).toHaveLength(0);

    fireEvent.change(within(dialog()).getByLabelText("Motivo *"), { target: { value: "Feriado" } });
    send();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(submitCalls()).toHaveLength(1);
    expect(submitCalls()[0].args).toMatchObject({
      _report: { cell_id: "c1", was_held: false, reason_not_held: "Feriado" },
      _participant_ids: [],
    });
    const report = (submitCalls()[0].args as { _report: Record<string, unknown> })._report;
    expect(Object.keys(report).sort()).toEqual(["cell_id", "reason_not_held", "was_held"]);
  });

  it("motivo só com espaços não vale", async () => {
    await openNotHeld();
    fireEvent.click(within(dialog()).getByRole("radio", { name: /Não houve célula/ }));
    fireEvent.change(within(dialog()).getByLabelText("Motivo *"), { target: { value: "   " } });
    send();
    expect(await within(dialog()).findByText("Informe o motivo de não ter havido célula.")).toBeInTheDocument();
    expect(submitCalls()).toHaveLength(0);
  });
});

describe("RN-05, RN-06, RN-07: data e horário recusados", () => {
  it("horário antes da reunião: erro no Horário, sem chamada (pelo relógio do servidor)", async () => {
    respondToRpc("cell_report_launch_check", { data: [CHECK] });
    respondWith({ data: [] });
    renderDialog({ mode: "launch", cell: C1 });
    await fillHeld();
    const time = within(dialog()).getByLabelText("Horário *");
    fireEvent.change(time, { target: { value: "19:00" } });
    send();
    await within(dialog()).findByText(/não pode ser de antes da reunião da célula nesta semana/);
    expect(time).toHaveAttribute("aria-invalid", "true");
    expect(submitCalls()).toHaveLength(0);
  });

  it("horário depois do 'agora' do servidor (data futura): recusa sem chamada", async () => {
    // Quarta 25/11 às 21:30 em Brasília (00:30Z): 23:00 de hoje é futuro.
    respondToRpc("cell_report_launch_check", { data: [CHECK] });
    respondWith({ data: [] });
    renderDialog({ mode: "launch", cell: C1 });
    await fillHeld();
    fireEvent.change(within(dialog()).getByLabelText("Horário *"), { target: { value: "23:00" } });
    send();
    await within(dialog()).findByText("O relatório não pode ser enviado para uma data ou horário futuros.");
    expect(submitCalls()).toHaveLength(0);
  });

  it("recusa do servidor 'report_not_current_week' no Horário/data e 'meeting_not_yet' no topo, com os dados mantidos", async () => {
    respondToRpc("cell_report_launch_check", { data: [CHECK] });
    respondToRpc("submit_cell_report", {
      error: {
        code: "22023",
        message: "O relatório precisa ser da semana atual, de 22/11/2026 a 28/11/2026.",
        details: JSON.stringify({ code: "report_not_current_week", field: "date_time", week_start: "2026-11-22", week_end: "2026-11-28" }),
        hint: "app_error",
      },
    });
    respondWith({ data: [] });
    renderDialog({ mode: "launch", cell: C1 });
    await fillHeld();
    send();
    expect(await within(dialog()).findByText("O relatório precisa ser da semana atual, de 22/11/2026 a 28/11/2026.")).toBeInTheDocument();
    expect(within(dialog()).getByLabelText("Tema *")).toHaveValue("A fé que vence");
    expect(toast).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- edição (T9)

const REPORT_ROW = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  cell_id: "c1",
  date: "2026-11-25",
  time: "20:00:00",
  theme: "Tema salvo",
  observations: null,
  visitors: ["Bruno"],
  offering: 10,
  was_held: true,
  reason_not_held: null,
  cell_deleted: false,
  ...reportSnapshotColumns("André Souza"),
  ...over,
});
const PARTICIPANTS = [
  { member_id: "andre", member_name: "André Souza", member_deleted: false, member_visible: true, is_snapshot_person: true, member_is_active: true, member_gender: "M" },
  { member_id: "caio", member_name: "Caio Lima", member_deleted: false, member_visible: true, is_snapshot_person: true, member_is_active: true, member_gender: "M" },
  { member_id: "carla", member_name: "Carla Dias", member_deleted: false, member_visible: true, is_snapshot_person: true, member_is_active: true, member_gender: "F" },
  { member_id: "lucas", member_name: "Lucas Melo", member_deleted: false, member_visible: true, is_snapshot_person: false, member_is_active: true, member_gender: "M" },
];
const EDIT_CONTEXT = {
  server_now: "2026-11-26T00:30:00Z",
  today: "2026-11-25",
  week_start: "2026-11-22",
  week_end: "2026-11-28",
  allowed_dates: ["2026-11-22", "2026-11-23", "2026-11-24", "2026-11-25"],
};
const SAVED = (changed: boolean) => ({ data: [{ report_id: "r1", changed }] });

function openEdit(row: unknown = REPORT_ROW(), participants: unknown = PARTICIPANTS) {
  respondToRpc("cell_report_edit_context", { data: [EDIT_CONTEXT] });
  respondWith({ data: row }, { data: participants });
  return renderDialog({ mode: "edit", reportId: "r1" });
}
const save = () => fireEvent.click(within(dialog()).getByRole("button", { name: "Salvar alterações" }));

describe("T9: o diálogo de edição", () => {
  it("abre com o título, o bloco do retrato, os registrados fixos e os valores gravados", async () => {
    openEdit();
    expect(await within(dialog()).findByLabelText("Tema *")).toHaveValue("Tema salvo");
    expect(screen.getByRole("heading", { name: "Editar relatório" })).toBeInTheDocument();
    expect(within(dialog()).getByRole("region", { name: "Dados da célula" })).toHaveTextContent("André Souza");
    const group = within(dialog()).getByRole("group", { name: "Participantes" });
    expect(within(group).getByText("O líder, o timóteo e o anfitrião registrados no relatório não podem ser retirados dos participantes.")).toBeInTheDocument();
    expect(within(group).getByText("Participantes: 4")).toBeInTheDocument();
    expect(within(dialog()).getByLabelText("Nome do visitante 1")).toHaveValue("Bruno");
  });

  it("UX-16: salvar sem mudança não chama a RPC e avisa 'Nenhuma alteração para salvar.'", async () => {
    const { onClose } = openEdit();
    await within(dialog()).findByLabelText("Tema *");
    save();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(saveCalls()).toHaveLength(0);
    expect(toast).toHaveBeenCalledWith({ title: "Nenhuma alteração para salvar." });
  });

  it("o PATCH leva só o que mudou (o tema), sem participantes, e avisa 'Relatório atualizado.'", async () => {
    respondToRpc("save_cell_report", SAVED(true));
    const { onClose } = openEdit();
    fireEvent.change(await within(dialog()).findByLabelText("Tema *"), { target: { value: "Tema novo" } });
    save();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(saveCalls()).toHaveLength(1);
    expect(saveCalls()[0].args).toEqual({ _report_id: "r1", _report: { theme: "Tema novo" } });
    expect(toast).toHaveBeenCalledWith({ title: "Relatório atualizado." });
  });

  it("o servidor que não mudou nada (changed=false) mostra 'Nenhuma alteração para salvar.'", async () => {
    respondToRpc("save_cell_report", SAVED(false));
    const { onClose } = openEdit();
    fireEvent.change(await within(dialog()).findByLabelText("Tema *"), { target: { value: "Tema novo" } });
    save();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(toast).toHaveBeenCalledWith({ title: "Nenhuma alteração para salvar." });
  });

  it("P20 na edição: passar para 'Não houve célula' avisa o que sai (plural e singular) e grava só a situação e o motivo", async () => {
    respondToRpc("save_cell_report", SAVED(true));
    const { onClose } = openEdit();
    await within(dialog()).findByLabelText("Tema *");
    fireEvent.click(within(dialog()).getByRole("radio", { name: /Não houve célula/ }));
    const notice = await within(dialog()).findByText(/^Ao salvar, saem do relatório:/);
    expect(notice).toHaveTextContent("o tema");
    expect(notice).toHaveTextContent("4 participantes");
    expect(notice).toHaveTextContent("1 visitante");
    expect(notice).toHaveTextContent("a oferta (R$ 10,00)");

    fireEvent.change(within(dialog()).getByLabelText("Motivo *"), { target: { value: "Chuva" } });
    save();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(saveCalls()[0].args).toEqual({ _report_id: "r1", _report: { was_held: false, reason_not_held: "Chuva" } });
  });

  it("P20 na edição, singular: relatório só com o tema avisa 'Ao salvar, sai do relatório: o tema.'", async () => {
    openEdit(REPORT_ROW({ visitors: [], offering: null }), [PARTICIPANTS[0]].map((p) => ({ ...p, is_snapshot_person: false })).slice(0, 0));
    await within(dialog()).findByLabelText("Tema *");
    fireEvent.click(within(dialog()).getByRole("radio", { name: /Não houve célula/ }));
    expect(await within(dialog()).findByText("Ao salvar, sai do relatório: o tema.")).toBeInTheDocument();
  });

  it("a edição que falha por conexão mostra o erro no rodapé e mantém os dados", async () => {
    respondToRpc("save_cell_report", CONNECTION);
    const { onClose } = openEdit();
    fireEvent.change(await within(dialog()).findByLabelText("Tema *"), { target: { value: "Tema novo" } });
    save();
    expect(await within(dialog()).findByText("Não foi possível salvar o relatório. Verifique a conexão e tente de novo.")).toBeInTheDocument();
    expect(within(dialog()).getByLabelText("Tema *")).toHaveValue("Tema novo");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("offline ao abrir: erro de carregamento com 'Tentar de novo' e nenhum campo", async () => {
    respondToRpc("cell_report_edit_context", { data: [EDIT_CONTEXT] });
    // A leitura tenta uma segunda vez na queda de conexão (retryOnceOnNetworkError).
    const down = { error: { code: "", message: "TypeError: Failed to fetch" } };
    respondWith(down, { data: PARTICIPANTS }, down);
    renderDialog({ mode: "edit", reportId: "r1" });
    expect(await within(dialog()).findByText("Não foi possível carregar o relatório. Verifique a conexão e tente de novo.", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(within(dialog()).getByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
    expect(within(dialog()).queryByLabelText("Tema *")).not.toBeInTheDocument();
    expect(saveCalls()).toHaveLength(0);
  });

  it("relatório que sumiu (excluído no meio tempo): mensagem e nenhum campo", async () => {
    respondToRpc("cell_report_edit_context", { data: [] });
    respondWith({ data: null }, { data: [] });
    renderDialog({ mode: "edit", reportId: "r1" });
    expect(await within(dialog()).findByText("Este relatório não existe ou já foi excluído. As alterações não foram salvas.")).toBeInTheDocument();
    expect(within(dialog()).queryByLabelText("Tema *")).not.toBeInTheDocument();
  });

  it("a recusa 'report_gone' do servidor ao salvar mostra a mensagem no topo e tira o botão de salvar", async () => {
    respondToRpc("save_cell_report", {
      error: {
        code: "22023",
        message: "Este relatório não existe ou já foi excluído. As alterações não foram salvas.",
        details: JSON.stringify({ code: "not_found_or_deleted", entity: "cell_report" }),
        hint: "app_error",
      },
    });
    openEdit();
    fireEvent.change(await within(dialog()).findByLabelText("Tema *"), { target: { value: "Tema novo" } });
    save();
    expect(await within(dialog()).findByText("Este relatório não existe ou já foi excluído. As alterações não foram salvas.")).toBeInTheDocument();
    expect(within(dialog()).queryByRole("button", { name: "Salvar alterações" })).not.toBeInTheDocument();
  });

  it("RN-16: data fora da semana do relatório é recusada pelo servidor, no campo", async () => {
    respondToRpc("save_cell_report", {
      error: {
        code: "22023",
        message: "Na edição, a data só pode mudar dentro da semana do relatório, de 22/11/2026 a 28/11/2026.",
        details: JSON.stringify({ code: "report_week_locked", field: "date_time", week_start: "2026-11-22", week_end: "2026-11-28" }),
        hint: "app_error",
      },
    });
    openEdit();
    fireEvent.change(await within(dialog()).findByLabelText("Horário *"), { target: { value: "21:00" } });
    save();
    expect(await within(dialog()).findByText(/Na edição, a data só pode mudar dentro da semana do relatório/)).toBeInTheDocument();
  });

  it("o participante de cadastro excluído impede 'Não houve célula' (RN-09, T9)", async () => {
    openEdit(REPORT_ROW(), [...PARTICIPANTS.slice(0, 3), { ...PARTICIPANTS[3], member_deleted: true }]);
    await within(dialog()).findByLabelText("Tema *");
    expect(within(dialog()).getByRole("radio", { name: /Não houve célula/ })).toBeDisabled();
    expect(
      within(dialog()).getByText('Este relatório tem participante com cadastro excluído e não pode passar para "Não houve célula".'),
    ).toBeInTheDocument();
  });
});
