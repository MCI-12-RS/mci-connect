import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeRpcs, resetFakeSupabase, respondToRpc, respondWith } from "@/test/fake-supabase";
import type { Access } from "@/lib/access/access";
import type { CellSummary } from "@/lib/cells/fields";
import { CellReportDialog } from "./CellReportDialog";

// O formulário de relatório (E2.11, T1 a T8): a conferência antes de preencher (UX-07, UX-08, UX-09,
// UX-12), a célula livre (UX-04), a recusa no campo (UX-26) e o descartar (UX-31). O banco é o cliente
// falso; as RPCs têm fila própria.

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
  permissions: ["view_own_ministry", "submit_own_cell_report"],
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

function renderDialog(cell: CellSummary | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <CellReportDialog mode="launch" cell={cell} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose };
}

const dialog = () => screen.getByRole("dialog");
const submitCalls = () => fakeRpcs().filter((rpc) => rpc.fn === "submit_cell_report");

beforeEach(() => {
  resetFakeSupabase();
  toast.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("E2.11: o formulário de relatório", () => {
  it("UX-07, UX-08 e UXD-14: com a célula fixa, o bloco na hora, 'Conferindo…' sem nenhum campo até a resposta, e o foco no título", async () => {
    let answer: () => void = () => undefined;
    respondToRpc("cell_report_launch_check", { data: [CHECK], until: new Promise<void>((resolve) => (answer = resolve)) });
    respondWith({ data: [] });
    renderDialog(C1);

    expect(screen.getByRole("heading", { name: "Novo relatório" })).toBeInTheDocument();
    expect(within(dialog()).getByRole("region", { name: "Dados da célula" })).toHaveTextContent("LíderAndré Souza");
    expect(within(dialog()).queryByRole("combobox", { name: /Célula/ })).not.toBeInTheDocument();
    expect(within(dialog()).getByText("Conferindo o relatório desta semana…").closest("[role='status']")).not.toBeNull();
    expect(within(dialog()).queryByLabelText("Tema *")).not.toBeInTheDocument();
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Novo relatório"));

    await act(async () => answer());
    expect(await within(dialog()).findByLabelText("Tema *")).toBeInTheDocument();
    // Um dia só: a data como texto, com "(hoje)" (P104); o horário da reunião (RN-18).
    expect(within(dialog()).getByText("Quarta, 25/11/2026 (hoje)")).toBeInTheDocument();
    expect(within(dialog()).getByLabelText("Horário *")).toHaveValue("20:00");
    expect(within(dialog()).getByText("Entre quarta, 25/11/2026, às 20:00, e agora.")).toBeInTheDocument();
  });

  it("UX-09: com o relatório da semana, o aviso sem os campos e o rodapé só com 'Fechar'", async () => {
    respondToRpc("cell_report_launch_check", {
      data: [{ ...CHECK, status: "already_sent", allowed_dates: [], existing_report_id: "r2", existing_date: "2026-11-25", existing_time: "20:00:00", existing_was_held: true, existing_can_edit: false }],
    });
    respondWith({ data: [] });
    renderDialog(C1);
    const notice = await within(dialog()).findByText("O relatório para esta semana já foi enviado.");
    expect(notice.closest("[role='status']")).toHaveTextContent("Reunião de quarta, 25/11/2026, às 20:00 · Célula realizada.");
    expect(within(dialog()).queryByLabelText("Tema *")).not.toBeInTheDocument();
    expect(within(dialog()).queryByRole("button", { name: "Enviar relatório" })).not.toBeInTheDocument();
    expect(within(dialog()).queryByRole("button", { name: "Editar relatório" })).not.toBeInTheDocument();
  });

  it("UX-12: a conferência que falha libera os campos com o aviso e 'Tentar de novo'", async () => {
    respondToRpc("cell_report_launch_check", { error: { code: "", message: "TypeError: Failed to fetch" } });
    respondWith({ data: [] });
    renderDialog(C1);
    expect(
      await within(dialog()).findByText("Não foi possível conferir se o relatório desta semana já foi enviado. Você pode preencher; a conferência é feita ao enviar."),
    ).toBeInTheDocument();
    expect(within(dialog()).getByLabelText("Tema *")).toBeInTheDocument();
    expect(within(dialog()).getByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
  });

  it("UX-04: com a célula livre, antes da escolha só o seletor e a dica; enviar mostra 'Escolha a célula.' sem chamada", async () => {
    respondWith({ data: [C1, { ...C1, id: "c5", meeting_day: "Sábado", meeting_time: "22:00:00" }] });
    renderDialog(null);
    expect(within(dialog()).getByText("Escolha a célula para preencher o relatório.")).toBeInTheDocument();
    expect(within(dialog()).queryByLabelText("Tema *")).not.toBeInTheDocument();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Enviar relatório" }));
    expect(await within(dialog()).findByText("Escolha a célula.")).toBeInTheDocument();
    expect(await within(dialog()).findByText("Confira os campos destacados (1).")).toBeInTheDocument();
    expect(submitCalls()).toHaveLength(0);
  });

  it("UX-26: a recusa do servidor com 'date_time' vai para o Horário, sem toast, e o formulário fica", async () => {
    respondToRpc("cell_report_launch_check", { data: [CHECK] });
    respondWith({ data: [] });
    respondToRpc("submit_cell_report", {
      error: {
        code: "22023",
        message: "O relatório não pode ser enviado para uma data ou horário futuros.",
        details: JSON.stringify({ code: "report_in_future", field: "date_time" }),
        hint: "app_error",
      },
    });
    renderDialog(C1);
    fireEvent.change(await within(dialog()).findByLabelText("Tema *"), { target: { value: "A fé que vence" } });
    fireEvent.change(within(dialog()).getByLabelText("Oferta *"), { target: { value: "0" } });
    fireEvent.click(within(dialog()).getByRole("button", { name: "Enviar relatório" }));
    const message = await within(dialog()).findByText("O relatório não pode ser enviado para uma data ou horário futuros.");
    expect(within(dialog()).getByLabelText("Horário *")).toHaveAttribute("aria-invalid", "true");
    expect(within(dialog()).getByLabelText("Horário *").getAttribute("aria-describedby")).toContain(message.closest("[id]")?.id ?? "-");
    expect(within(dialog()).getByLabelText("Tema *")).toHaveValue("A fé que vence");
    expect(toast).not.toHaveBeenCalled();
    expect(submitCalls()).toHaveLength(1);
    expect(submitCalls()[0].args).toMatchObject({
      _report: { cell_id: "c1", was_held: true, date: "2026-11-25", time: "20:00", theme: "A fé que vence", offering: 0, visitors: [] },
      _participant_ids: [],
    });
  });

  it("UX-31: só com a célula e a sugestão, 'Cancelar' fecha direto; com o tema digitado, pergunta antes", async () => {
    respondToRpc("cell_report_launch_check", { data: [CHECK] }, { data: [CHECK] });
    respondWith({ data: [] });
    const { onClose } = renderDialog(C1);
    await within(dialog()).findByLabelText("Tema *");
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancelar" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.change(within(dialog()).getByLabelText("Tema *"), { target: { value: "Tema" } });
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancelar" }));
    expect(await screen.findByRole("alertdialog", { name: "Descartar as alterações?" })).toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
