import type { ReactNode } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeQueries, fakeRpcs, resetFakeSupabase, respondToRpc, respondWith } from "@/test/fake-supabase";
import type { DeletedMemberRow } from "@/lib/deletion/deleted-lists";
import type { MemberRow } from "@/lib/members/fields";
import MembersDeleted from "./MembersDeleted";

// Membros excluídos (E2.01, T4 e T5): a rota sem permissão não consulta nada
// (UX-17, critério de pronto 7); a confirmação da restauração (UX-20); o
// resultado com "Definir líder" (UX-22); a recusa (UX-23) e o aviso de quem
// já não está excluído (UX-24).

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

vi.mock("@/components/AppLayout", () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

const auth = vi.hoisted(() => ({ permissions: new Set<string>(), loaded: true }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    permissionsLoaded: auth.loaded,
    // Quem restaura vê a igreja toda; sem atribuir funções, o formulário não lê `role_options`.
    access: { member_id: "me", role_name: "Administrador", sees_whole_church: true, can_assign_roles: false },
    hasPermission: (...permissions: string[]) => permissions.some((p) => auth.permissions.has(p)),
  }),
}));

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

// O Switch do formulário de membro mede o tamanho com ResizeObserver (o jsdom não tem).
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const bruno: DeletedMemberRow = {
  id: "b1",
  name: "Bruno Almeida",
  is_active: true,
  leader_name: "Gil Souza",
  leader_deleted: false,
  restore_role_name: "Líder",
  has_account: true,
  deleted_at: "2026-11-10T17:32:00+00:00",
  deleted_by_name: "Elisa Martins",
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
};

/** O cadastro de Bruno restaurado, como a `members_view` o devolve ao abrir "Definir líder". */
const brunoRestored: MemberRow = {
  id: "b1",
  name: "Bruno Almeida",
  gender: "M",
  birth_date: null,
  instagram: null,
  avatar_url: null,
  notes: null,
  neighborhood: null,
  city: null,
  state: null,
  is_pastor: false,
  has_leadership: false,
  leader_id: null,
  leader_name: null,
  spouse_id: null,
  spouse_name: null,
  is_baptized: false,
  baptism_date: null,
  is_active: true,
  g12_level: 0,
  total_disciples: 0,
  total_cells: 0,
  auth_user_id: "u-bruno",
  sensitive_visible: false,
  email: null,
  cpf: null,
  mobile_whatsapp: null,
  phone: null,
  street: null,
  number: null,
  complement: null,
  zip_code: null,
};

const appError = (code: string, message: string, extra: object = {}) => ({
  error: { code: "22023", message, details: JSON.stringify({ code, ...extra }), hint: "app_error" },
});

const originalWidth = window.innerWidth;
const setWidth = (width: number) => Object.defineProperty(window, "innerWidth", { configurable: true, value: width });

function renderPage(rows: DeletedMemberRow[] = [bruno, paula], path = "/members/deleted") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  respondWith({ data: rows, count: rows.length });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/members/deleted" element={<MembersDeleted />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Membros excluídos: acesso", () => {
  beforeEach(() => {
    resetFakeSupabase();
    auth.loaded = true;
    setWidth(1280);
  });

  afterEach(() => setWidth(originalWidth));

  it("Sem manage_roles, mostra o aviso e 'Voltar para Membros', sem nenhuma consulta nem registro (UX-17)", async () => {
    auth.permissions = new Set(["delete_member", "view_members"]);
    renderPage();

    expect(screen.getByText("Você não tem acesso a esta lista.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Voltar para Membros" })).toHaveAttribute("href", "/members");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fakeQueries()).toHaveLength(0);
    expect(fakeRpcs()).toHaveLength(0);
    expect(screen.queryByText("Bruno Almeida")).not.toBeInTheDocument();
  });

  it("Enquanto as permissões não chegam, nem o aviso nem a lista: nenhuma consulta", async () => {
    auth.loaded = false;
    auth.permissions = new Set();
    renderPage();

    expect(screen.queryByText("Você não tem acesso a esta lista.")).not.toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fakeQueries()).toHaveLength(0);
  });

  it("Com manage_roles, lê a view de excluídos da exclusão mais recente para a mais antiga, com total exato (UX-14)", async () => {
    auth.permissions = new Set(["manage_roles"]);
    renderPage();

    await screen.findByText("Bruno Almeida");
    const [query] = fakeQueries();
    expect(query.table).toBe("members_deleted_view");
    expect(query.calls).toContainEqual(["order", "deleted_at", { ascending: false }]);
    expect(query.calls).toContainEqual(["order", "id"]);
    expect(query.calls).toContainEqual(["range", 0, 24]);
    expect(query.calls[0]).toEqual(["select", expect.any(String), { count: "exact" }]);
    expect(screen.getByRole("link", { name: "← Membros" })).toHaveAttribute("href", "/members");
  });
});

describe("Membros excluídos: itens", () => {
  beforeEach(() => {
    resetFakeSupabase();
    auth.loaded = true;
    auth.permissions = new Set(["manage_roles"]);
  });

  afterEach(() => setWidth(originalWidth));

  it("Celular: card com o nome, 'Excluído em … às …' em Brasília, o autor, o líder e a situação (UX-15, UX-16)", async () => {
    setWidth(360);
    renderPage();

    const card = (await screen.findByText("Bruno Almeida")).closest("li");
    expect(card).toHaveTextContent("Excluído em 10/11/2026 às 14:32");
    expect(card).toHaveTextContent("por Elisa Martins");
    expect(card).toHaveTextContent("Líder: Gil Souza");
    expect(within(card).getByText("Ativo")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Restaurar Bruno Almeida" })).toHaveClass("min-h-11");

    const paulaCard = screen.getByText("Paula Reis").closest("li");
    expect(paulaCard).toHaveTextContent("Autor não registrado");
    expect(paulaCard).toHaveTextContent("Sem líder");
    expect(within(paulaCard).getByText("Inativo")).toBeInTheDocument();
    expect(screen.getByText("2 cadastros excluídos")).toBeInTheDocument();
  });

  it("Desktop: tabela com 'Não registrado' e o líder marcado '(cadastro excluído)' (T4)", async () => {
    setWidth(1280);
    renderPage([{ ...bruno, leader_deleted: true }, paula]);

    const row = (await screen.findByText("Bruno Almeida")).closest("tr");
    expect(row).toHaveTextContent("Gil Souza (cadastro excluído)");
    expect(row).toHaveTextContent("10/11/2026 14:32");
    expect(screen.getByText("Paula Reis").closest("tr")).toHaveTextContent("Não registrado");
  });

  it("Lista vazia: o aviso e a explicação, sem paginação", async () => {
    setWidth(1280);
    renderPage([]);
    expect(await screen.findByText("Nenhum cadastro excluído.")).toBeInTheDocument();
    expect(screen.getByText("Quando alguém excluir, o registro aparece aqui para ser restaurado.")).toBeInTheDocument();
    expect(screen.queryByText(/por página/)).not.toBeInTheDocument();
  });

  it("Busca sem resultado: o aviso e 'Limpar busca', que esvazia o campo e o foca", async () => {
    setWidth(1280);
    renderPage([], "/members/deleted?q=zz");
    expect(await screen.findByText("Nenhum cadastro excluído encontrado para esta busca.")).toBeInTheDocument();
    const search = screen.getByRole("textbox", { name: "Buscar membros excluídos" });
    expect(search).toHaveValue("zz");
    fireEvent.click(screen.getByRole("button", { name: "Limpar busca" }));
    expect(search).toHaveValue("");
    expect(search).toHaveFocus();
  });
});

describe("Membros excluídos: restaurar (T5)", () => {
  beforeEach(() => {
    resetFakeSupabase();
    toast.mockClear();
    auth.loaded = true;
    auth.permissions = new Set(["manage_roles", "edit_member"]);
    setWidth(1280);
  });

  afterEach(() => setWidth(originalWidth));

  it("A confirmação traz a função, o acesso e o cônjuge, com 'Cancelar' no foco; sem nada a avisar, só o toast (UX-20)", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Restaurar Bruno Almeida" }));

    const dialog = await screen.findByRole("alertdialog", { name: "Restaurar o cadastro de Bruno Almeida?" });
    expect(dialog).toHaveTextContent("O cadastro volta às listas e aos totais, com os mesmos dados e a função Líder.");
    expect(dialog).toHaveTextContent("A pessoa volta a entrar no sistema com a mesma senha.");
    expect(dialog).toHaveTextContent("O vínculo de cônjuge não volta. Se havia, refaça-o no cadastro.");
    expect(dialog).not.toHaveTextContent("Volta sem líder");
    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toHaveFocus();
    expect(fakeRpcs()).toHaveLength(0);

    respondToRpc("restore_member", {
      data: [{ restored_without_leader: false, previous_leader_name: null, role_reset_to_default: false, role_name: "Líder" }],
    });
    respondWith({ data: [paula], count: 1 });
    fireEvent.click(within(dialog).getByRole("button", { name: "Restaurar cadastro" }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "Cadastro restaurado." }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(fakeRpcs().map((call) => [call.fn, call.args])).toEqual([["restore_member", { _member_id: "b1" }]]);
    await waitFor(() => expect(screen.queryByText("Bruno Almeida")).not.toBeInTheDocument());
  });

  it("Sem conta de acesso, a confirmação não fala do acesso (AQ-7)", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Restaurar Paula Reis" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).not.toHaveTextContent("A pessoa volta a entrar no sistema");
  });

  it("Líder excluído: a confirmação avisa; o resultado pede o líder, e 'Definir líder' abre o formulário com o foco no Líder (UX-22)", async () => {
    renderPage([{ ...bruno, leader_deleted: true }, paula]);
    fireEvent.click(await screen.findByRole("button", { name: "Restaurar Bruno Almeida" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Volta sem líder, porque o líder anterior (Gil Souza) foi excluído.");

    respondToRpc("restore_member", {
      data: [{ restored_without_leader: true, previous_leader_name: "Gil Souza", role_reset_to_default: false, role_name: "Líder" }],
    });
    respondWith({ data: [paula], count: 1 });
    fireEvent.click(within(dialog).getByRole("button", { name: "Restaurar cadastro" }));

    const title = await screen.findByRole("heading", { name: "Cadastro restaurado" });
    await waitFor(() => expect(title).toHaveFocus());
    const result = screen.getByRole("alertdialog");
    expect(result).toHaveTextContent(
      "Cadastro restaurado sem líder, porque o líder anterior (Gil Souza) foi excluído. Defina o novo líder.",
    );
    expect(within(result).getByRole("button", { name: "Agora não" })).toBeInTheDocument();
    expect(toast).not.toHaveBeenCalled();

    // O cadastro restaurado, da members_view.
    respondWith({ data: brunoRestored });
    fireEvent.click(within(result).getByRole("button", { name: "Definir líder" }));

    const form = await screen.findByRole("dialog", { name: "Editar Membro" });
    const leader = await within(form).findByLabelText("Líder");
    expect(within(form).getByRole("switch", { name: "Tem Liderança?" })).toBeChecked();
    await waitFor(() => expect(leader).toHaveFocus());
    expect(fakeQueries().some((query) => query.table === "members_view")).toBe(true);
  });

  it("Função apagada: o resultado avisa a função padrão e, sem 'Definir líder', só fecha", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Restaurar Bruno Almeida" }));
    respondToRpc("restore_member", {
      data: [{ restored_without_leader: false, previous_leader_name: null, role_reset_to_default: true, role_name: "Membro" }],
    });
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Restaurar cadastro" }));

    const result = await screen.findByRole("alertdialog", { name: "Cadastro restaurado" });
    expect(result).toHaveTextContent("O cadastro voltou com a função padrão (Membro), porque a função anterior foi apagada.");
    expect(within(result).queryByRole("button", { name: "Definir líder" })).not.toBeInTheDocument();
    fireEvent.click(within(result).getByRole("button", { name: "Fechar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("Sem edit_member, o resultado sem líder não oferece 'Definir líder'", async () => {
    auth.permissions = new Set(["manage_roles"]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Restaurar Bruno Almeida" }));
    respondToRpc("restore_member", {
      data: [{ restored_without_leader: true, previous_leader_name: "Gil Souza", role_reset_to_default: false, role_name: "Líder" }],
    });
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Restaurar cadastro" }));

    const result = await screen.findByRole("alertdialog", { name: "Cadastro restaurado" });
    expect(within(result).queryByRole("button", { name: "Definir líder" })).not.toBeInTheDocument();
  });

  it("Recusa de regra: o mesmo diálogo vira o bloqueio, com a mensagem do servidor e só 'Fechar' (UX-23)", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Restaurar Bruno Almeida" }));
    respondToRpc(
      "restore_member",
      appError("restore_value_in_use", "Não é possível restaurar: outro cadastro já usa este celular.", { fields: ["mobile"] }),
    );
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Restaurar cadastro" }));

    const title = await screen.findByRole("heading", { name: "Não é possível restaurar Bruno Almeida" });
    await waitFor(() => expect(title).toHaveFocus());
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("Não é possível restaurar: outro cadastro já usa este celular.");
    expect(within(dialog).getAllByRole("button").map((button) => button.textContent)).toEqual(["Fechar"]);
  });

  it("'Não está excluído': toast informativo (não destrutivo), o diálogo fecha e a lista recarrega (UX-24)", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Restaurar Bruno Almeida" }));
    respondToRpc("restore_member", appError("not_deleted", "Este cadastro não está excluído.", { entity: "member" }));
    respondWith({ data: [paula], count: 1 });
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Restaurar cadastro" }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "Este cadastro não está excluído." }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    await waitFor(() => expect(fakeQueries().filter((query) => query.table === "members_deleted_view")).toHaveLength(2));
  });

  it("Queda de conexão: o toast de conexão, e a confirmação continua aberta com o botão de volta", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Restaurar Bruno Almeida" }));
    respondToRpc("restore_member", { error: { code: "", message: "TypeError: Failed to fetch" } });
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Restaurar cadastro" }));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        variant: "destructive",
        title: "Não foi possível restaurar. Verifique a conexão e tente de novo.",
      }),
    );
    expect(within(dialog).getByRole("button", { name: "Restaurar cadastro" })).not.toHaveAttribute("aria-disabled");
  });
});
