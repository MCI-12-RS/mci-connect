import type { ReactNode } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createQueryWrapper } from "@/test/query-wrapper";
import { fakeQueries, fakeRpcs, resetFakeSupabase, respondToRpc, respondWith } from "@/test/fake-supabase";
import type { MemberRow } from "@/lib/members/fields";
import MemberForm from "./MemberForm";

// Campo Função do formulário de membro, pela `role_options` (E2.02). As
// opções chegam depois de o formulário abrir; a função atual do membro não
// pode se perder nesse meio tempo.

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

// Acesso do usuário logado (`me`, outra pessoa que não Ana). Por padrão, só
// atribuir a função: sem os dados ministeriais, que trariam os seletores de
// membro e as consultas deles.
const auth = vi.hoisted(() => ({
  permissions: new Set<string>(),
  roleName: "Líder" as string | null,
  memberId: "me",
  canAssignRoles: true,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    access: {
      member_id: auth.memberId,
      role_id: auth.roleName ? "role-lider" : null,
      role_name: auth.roleName,
      permissions: [],
      sees_whole_church: true,
      can_assign_roles: auth.canAssignRoles,
    },
    member: null,
    hasPermission: (...permissions: string[]) => permissions.some((p) => auth.permissions.has(p)),
  }),
}));

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

const ROLE = "Função *";

const roleOptions = (current: { id: string; name: string } | null) => ({
  current,
  editable: true,
  reason: null,
  options: [
    { id: "role-admin", name: "Administrador", is_default: false },
    { id: "role-lider", name: "Líder", is_default: false },
    { id: "role-membro", name: "Membro", is_default: true },
  ],
  default_role: { id: "role-membro", name: "Membro" },
});
const ANA_OPTIONS = roleOptions({ id: "role-lider", name: "Líder" });

const member: MemberRow = {
  id: "m1",
  name: "Ana Alves",
  gender: "F",
  birth_date: null,
  instagram: null,
  avatar_url: null,
  notes: null,
  neighborhood: "Centro",
  city: "Porto Alegre",
  state: "RS",
  is_pastor: false,
  has_leadership: true,
  leader_id: "m0",
  leader_name: "Bruno Borges",
  spouse_id: null,
  spouse_name: null,
  is_baptized: true,
  baptism_date: null,
  is_active: true,
  g12_level: 2,
  total_disciples: 0,
  total_cells: 0,
  auth_user_id: "u1",
  sensitive_visible: true,
  email: "ana@teste.invalid",
  cpf: null,
  mobile_whatsapp: null,
  phone: null,
  street: null,
  number: null,
  complement: null,
  zip_code: null,
};

/** As opções de função só chegam quando `release` for chamado. */
function respondWithRolesLater(data: unknown = ANA_OPTIONS) {
  let release: () => void = () => {};
  const arrived = new Promise<void>((resolve) => {
    release = resolve;
  });
  respondToRpc("role_options", { data, until: arrived });
  return () =>
    act(async () => {
      release();
      await arrived;
    });
}

describe("MemberForm: campo Função", () => {
  beforeEach(() => {
    resetFakeSupabase();
    toast.mockClear();
    auth.permissions = new Set(["assign_role"]);
    auth.canAssignRoles = true;
    auth.memberId = "me";
  });

  it("Dado um membro em edição aberto antes de as funções carregarem, quando elas chegam, então a função atual continua escolhida e vai no Salvar", async () => {
    const releaseRoles = respondWithRolesLater();
    const onClose = vi.fn();
    render(<MemberForm member={member} onClose={onClose} />, { wrapper: createQueryWrapper() });

    expect(screen.getByText("Carregando…")).toBeInTheDocument();

    await releaseRoles();

    const trigger = await screen.findByRole("combobox", { name: ROLE });
    expect(trigger).toHaveTextContent("Líder");

    respondWith({ data: [{ id: "m1" }] });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
    const save = fakeQueries().find((query) => query.table === "members");
    expect(save?.calls).toContainEqual(["update", expect.objectContaining({ role_id: "role-lider" })]);
    expect(save?.calls).toContainEqual(["eq", "id", "m1"]);
    expect(fakeRpcs().find((call) => call.fn === "role_options")?.args).toEqual({ _member_id: "m1" });
  });

  it("Dado um membro novo, quando as funções chegam, então a função padrão vem escolhida", async () => {
    const releaseRoles = respondWithRolesLater();
    render(<MemberForm member={null} onClose={vi.fn()} />, { wrapper: createQueryWrapper() });

    expect(screen.getByText("Carregando…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Criar membro" })).toBeDisabled();

    await releaseRoles();

    await waitFor(() => expect(screen.getByRole("combobox", { name: ROLE })).toHaveTextContent("Membro (padrão)"));
    expect(screen.getByRole("button", { name: "Criar membro" })).toBeEnabled();
  });

  it("Dada uma falha ao carregar as funções, então o campo avisa", async () => {
    respondToRpc("role_options", { error: { code: "XX000", message: "falhou" } });
    render(<MemberForm member={member} onClose={vi.fn()} />, { wrapper: createQueryWrapper() });

    expect(await screen.findByText("Não foi possível carregar as funções.")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: ROLE })).not.toBeInTheDocument();
  });

  it("Dado quem não atribui funções editando outra pessoa, então o campo Função não aparece e a função não vai no Salvar (UXD-12)", async () => {
    auth.permissions = new Set();
    auth.canAssignRoles = false;
    const onClose = vi.fn();
    render(<MemberForm member={member} onClose={onClose} />, { wrapper: createQueryWrapper() });

    expect(screen.queryByText(/Função/)).not.toBeInTheDocument();
    respondWith({ data: [{ id: "m1" }] });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const save = fakeQueries().find((query) => query.table === "members");
    expect(save?.calls).toContainEqual(["update", expect.not.objectContaining({ role_id: expect.anything() })]);
    expect(fakeRpcs()).toHaveLength(0);
  });
});

// Edição de um cadastro excluído no meio tempo (E2.01, DT-19): o PATCH volta
// sem linha e sem erro. O formulário avisa, não fecha e não diz que salvou.
describe("MemberForm: cadastro excluído durante a edição", () => {
  beforeEach(() => {
    resetFakeSupabase();
    toast.mockClear();
    auth.permissions = new Set(["assign_role"]);
    auth.canAssignRoles = true;
    auth.memberId = "me";
  });

  it("Dado um PATCH que volta com a linha, então pede só o id de volta (sem coluna sensível no RETURNING)", async () => {
    respondToRpc("role_options", { data: ANA_OPTIONS });
    const onClose = vi.fn();
    render(<MemberForm member={member} onClose={onClose} />, { wrapper: createQueryWrapper() });
    await screen.findByRole("combobox", { name: ROLE });

    respondWith({ data: [{ id: "m1" }] });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const save = fakeQueries().find((query) => query.table === "members");
    expect(save?.calls).toContainEqual(["select", "id"]);
  });

  it("Dado um PATCH que volta sem linha, então mostra o aviso, não fecha e o Fechar volta para a lista", async () => {
    respondToRpc("role_options", { data: ANA_OPTIONS });
    const onClose = vi.fn();
    render(<MemberForm member={member} onClose={onClose} />, { wrapper: createQueryWrapper() });
    await screen.findByRole("combobox", { name: ROLE });

    respondWith({ data: [] });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Este cadastro não existe ou já foi excluído. As alterações não foram salvas.");
    expect(alert).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("Dado um PATCH que volta sem linha, então a lista de Membros recarrega já, e 'Cancelar' volta para ela atualizada", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    respondToRpc("role_options", { data: ANA_OPTIONS });
    const onClose = vi.fn();
    render(<MemberForm member={member} onClose={onClose} />, { wrapper });
    await screen.findByRole("combobox", { name: ROLE });

    respondWith({ data: [] });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    const alert = await screen.findByRole("alert");
    // O texto fica na cor do texto (contraste, UX-38); o vermelho fica na borda e no ícone.
    expect(within(alert).getByText(/As alterações não foram salvas/).parentElement).toHaveClass("text-foreground");
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([["members", "list"]]);

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("MemberForm: Meus dados só para leitura (E2.02, UXD-13, UX-09)", () => {
  beforeEach(() => {
    resetFakeSupabase();
    auth.permissions = new Set();
    auth.roleName = null;
  });

  it("campos readOnly e focáveis, aviso no topo, função como texto, só 'Fechar' e nenhuma consulta de funções", () => {
    const onClose = vi.fn();
    render(<MemberForm member={member} readOnly onClose={onClose} />, { wrapper: createQueryWrapper() });

    expect(
      screen.getByText(
        "Você pode consultar os seus dados, mas não alterá-los. Para corrigir alguma informação, fale com o seu líder.",
      ),
    ).toBeInTheDocument();
    const name = screen.getByLabelText("Nome *");
    expect(name).toHaveAttribute("readonly");
    expect(name).not.toBeDisabled();
    expect(screen.getByLabelText("Gênero")).toHaveValue("Feminino");
    expect(screen.getByLabelText("Gênero")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Estado")).toHaveAttribute("readonly");
    // Sem função: o texto, com o motivo (P12), e nenhum Input desabilitado.
    expect(screen.getByText("Sem função")).toBeInTheDocument();
    expect(screen.getByText("Ninguém pode alterar a própria função.")).toBeInTheDocument();
    expect(document.querySelector("input:disabled")).toBeNull();

    expect(screen.queryByRole("button", { name: "Salvar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(onClose).toHaveBeenCalled();
    expect(fakeQueries().filter((q) => q.table === "roles")).toHaveLength(0);
    expect(fakeRpcs()).toHaveLength(0);
  });

  it("Enter num campo não envia nada", () => {
    render(<MemberForm member={member} readOnly onClose={vi.fn()} />, { wrapper: createQueryWrapper() });
    const form = screen.getByLabelText("Nome *").closest("form");
    expect(form).not.toBeNull();
    if (form) fireEvent.submit(form);
    expect(fakeQueries().filter((q) => q.table === "members")).toHaveLength(0);
  });
});
