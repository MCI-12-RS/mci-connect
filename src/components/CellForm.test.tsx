import type { ReactNode } from "react";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeQueries, fakeRpcs, resetFakeSupabase, respondToRpc, respondWith } from "@/test/fake-supabase";
import type { CellRow } from "@/lib/cells/fields";
import CellForm from "./CellForm";

// Edição de uma célula excluída no meio tempo (E2.01, DT-19): o PATCH volta
// sem linha, o formulário avisa e não fecha, e a lista de Células recarrega
// já, para "Fechar", "Cancelar", o X e o Esc voltarem a ela atualizada.

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

// O acesso de quem está logado (E2.02): `null` antes da primeira leitura; os testes de escopo trocam.
const auth = vi.hoisted(() => ({ access: null as import("@/lib/access/access").Access | null }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ access: auth.access }) }));

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

// O Switch e o Select do Radix medem o tamanho com ResizeObserver (o jsdom não tem).
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const carlos: CellRow = {
  id: "c1",
  leader_id: "l1",
  // E2.08 (RN-02, RN-03): toda célula tem as três pessoas; aqui, Carlos nos três papéis.
  timothy_id: "l1",
  host_id: "l1",
  type: "Evangelística",
  meeting_day: "Quarta",
  meeting_time: "20:00:00",
  street: "Rua das Flores",
  number: "120",
  complement: null,
  neighborhood: "Centro",
  city: null,
  state: null,
  zip_code: null,
  is_active: true,
  leader_name: "Carlos Lima",
  leader_g12_level: 2,
  leader_is_pastor: false,
  leader_gender: "M",
  timothy_name: "Carlos Lima",
  host_name: "Carlos Lima",
  g12_leader_name: "Vera",
  can_submit_report: true,
};

function renderForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const onClose = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  respondToRpc("member_names", { data: [{ id: "l1", name: "Carlos Lima" }] });
  render(<CellForm cell={carlos} onClose={onClose} />, { wrapper });
  const invalidatedKeys = () => invalidate.mock.calls.map(([filters]) => filters?.queryKey);
  return { onClose, invalidatedKeys };
}

async function saveWithoutRowBack() {
  respondWith({ data: [] });
  fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
  return screen.findByRole("alert");
}

describe("CellForm: célula excluída durante a edição (DT-19)", () => {
  beforeAll(() => vi.stubGlobal("ResizeObserver", NoopResizeObserver));
  afterAll(() => vi.unstubAllGlobals());
  beforeEach(() => {
    resetFakeSupabase();
    toast.mockClear();
  });

  it("Dado um PATCH sem linha de volta, então o aviso com 'Fechar', Salvar desabilitado e a lista de Células recarregada já", async () => {
    const { onClose, invalidatedKeys } = renderForm();

    const alert = await saveWithoutRowBack();

    expect(alert).toHaveTextContent("Esta célula não existe ou já foi excluída. As alterações não foram salvas.");
    expect(alert).toHaveFocus();
    // O texto fica na cor do texto (contraste, UX-38); o vermelho fica na borda e no ícone.
    expect(within(alert).getByText(/As alterações não foram salvas/).parentElement).toHaveClass("text-foreground");
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled();
    expect(invalidatedKeys()).toEqual([["cells", "list"]]);
    expect(onClose).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    const update = fakeQueries().find((query) => query.table === "cells");
    expect(update?.calls).toContainEqual(["select", "id"]);

    fireEvent.click(within(alert).getByRole("button", { name: "Fechar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Depois do aviso, 'Cancelar' também volta para a lista já recarregada", async () => {
    const { onClose, invalidatedKeys } = renderForm();
    await saveWithoutRowBack();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(invalidatedKeys()).toContainEqual(["cells", "list"]);
  });
});

// Escopo no formulário de célula (E2.02, T7, T11). Os critérios completos (UX-24) ficam com o QA.
describe("CellForm: escopo (E2.02, T7)", () => {
  beforeAll(() => vi.stubGlobal("ResizeObserver", NoopResizeObserver));
  afterAll(() => vi.unstubAllGlobals());
  beforeEach(() => {
    resetFakeSupabase();
    toast.mockClear();
    auth.access = null;
  });

  const ministryAccess = {
    member_id: "m-pedro",
    role_id: "r-lider",
    role_name: "Líder",
    role_is_protected: false,
    permissions: ["view_own_ministry" as const, "edit_cell" as const],
    sees_whole_church: false,
    sees_ministry: true,
    sees_whole_church_reports: false,
    sees_ministry_reports: true,
    can_create_member: false,
    can_assign_roles: false,
    can_submit_some_report: true,
  };

  it("Dado quem vê só o ministério, então a dica única fica acima das três pessoas e ligada a cada campo", () => {
    auth.access = ministryAccess;
    renderForm();

    const hint = screen.getByText("Líder, timóteo e anfitrião são escolhidos entre as pessoas do seu ministério.");
    for (const id of ["leader_id", "timothy_id", "host_id"]) {
      expect(document.getElementById(id)?.getAttribute("aria-describedby")).toContain(hint.id);
    }
  });

  it("Dado quem vê a igreja toda, então a dica não aparece", () => {
    auth.access = { ...ministryAccess, sees_whole_church: true };
    renderForm();

    expect(screen.queryByText(/escolhidos entre as pessoas do seu ministério/)).not.toBeInTheDocument();
  });

  it("Dada a RN-09 (c) na gravação, então a mensagem no Alert do topo, com o foco, sem toast e sem fechar (UX-24)", async () => {
    const message =
      "Com esta alteração, você deixaria de ver esta célula. Mantenha pelo menos uma pessoa do seu ministério como líder, timóteo ou anfitrião. As alterações não foram salvas.";
    const { onClose } = renderForm();
    // O erro do PostgREST traz também `details` e `hint`, que o tipo da resposta falsa não descreve.
    const error = { code: "22023", message, details: JSON.stringify({ code: "would_leave_scope", entity: "cell" }), hint: "app_error" };
    respondWith({ error });

    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(message);
    expect(alert).toHaveFocus();
    expect(screen.getByRole("button", { name: "Salvar" })).toBeEnabled();
    expect(toast).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

// Nomes salvos fora do escopo (E2.02, DT-23, RN-02, UX-20): com o seletor de
// verdade, Líder e Timóteo de C2 aparecem pelo nome da cells_view mesmo que a
// `member_names` não os devolva (Pedro editando a célula de Diego).
describe("CellForm: nomes salvos fora do escopo (DT-23, UX-20)", () => {
  beforeAll(() => vi.stubGlobal("ResizeObserver", NoopResizeObserver));
  afterAll(() => vi.unstubAllGlobals());
  beforeEach(() => {
    resetFakeSupabase();
    toast.mockClear();
    auth.access = null;
  });

  const diegoCell: CellRow = {
    ...carlos,
    id: "c2",
    leader_id: "m-diego",
    leader_name: "Diego Souza",
    timothy_id: "m-hugo",
    timothy_name: "Hugo Reis",
    host_id: "m-caio",
    host_name: "Caio Nunes",
  };

  it("Dada a edição de C2 por quem não vê Diego nem Hugo, então Líder, Timóteo e Anfitrião mostram os nomes salvos", async () => {
    // A member_names não devolve quem está fora do escopo.
    respondToRpc("member_names", { data: [] }, { data: [] }, { data: [] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <CellForm cell={diegoCell} onClose={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Diego Souza")).toBeInTheDocument();
    expect(screen.getByText("Hugo Reis")).toBeInTheDocument();
    expect(screen.getByText("Caio Nunes")).toBeInTheDocument();
    expect(screen.queryByText("Membro sem nome")).not.toBeInTheDocument();
    expect(fakeRpcs().some((call) => call.fn === "member_names")).toBe(false);
  });
});

// E2.08 (PR 2, ajuste mínimo): sem os padrões Sábado e 19:00, "Célula Ativa" só na edição e nada
// enviado sem as três pessoas, o dia e o horário (RN-02, RN-05, RN-06, RN-11).
describe("CellForm: regras do cadastro (E2.08, PR 2)", () => {
  beforeAll(() => vi.stubGlobal("ResizeObserver", NoopResizeObserver));
  afterAll(() => vi.unstubAllGlobals());
  beforeEach(() => {
    resetFakeSupabase();
    toast.mockClear();
    auth.access = null;
  });

  function renderNew() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <CellForm cell={null} onClose={vi.fn()} />
      </QueryClientProvider>,
    );
  }

  it("Célula nova: sem dia e sem horário escolhidos, Evangelística, e sem 'Célula Ativa'", () => {
    renderNew();
    expect(screen.getByLabelText("Horário")).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Dia da Semana" })).toHaveTextContent("Selecione o dia");
    expect(screen.getByRole("combobox", { name: "Tipo" })).toHaveTextContent("Evangelística");
    expect(screen.queryByLabelText("Célula Ativa")).not.toBeInTheDocument();
  });

  it("Salvar a célula nova vazia não envia nada e avisa o primeiro campo que falta (o líder)", () => {
    renderNew();
    fireEvent.click(screen.getByRole("button", { name: "Criar Célula" }));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: "Escolha o líder da célula." }));
    expect(fakeQueries().some((query) => query.table === "cells")).toBe(false);
  });

  it("Na edição, 'Célula Ativa' aparece; sem o timóteo, nada é enviado e o aviso diz o campo", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <CellForm cell={{ ...carlos, timothy_id: null, timothy_name: null }} onClose={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.getByLabelText("Célula Ativa")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: "Escolha o timóteo da célula." }));
    expect(fakeQueries().some((query) => query.table === "cells")).toBe(false);
  });

  it("Na edição completa, o PATCH leva a situação, e o cadastro novo nunca leva is_active", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <CellForm cell={carlos} onClose={vi.fn()} />
      </QueryClientProvider>,
    );
    respondWith({ data: [{ id: "c1" }] });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await vi.waitFor(() => expect(fakeQueries().some((query) => query.table === "cells")).toBe(true));
    const update = fakeQueries().find((query) => query.table === "cells");
    const patch = update?.calls.find(([method]) => method === "update")?.[1];
    expect(patch).toMatchObject({ leader_id: "l1", timothy_id: "l1", host_id: "l1", meeting_day: "Quarta", is_active: true });
  });
});
