import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createQueryWrapper } from "@/test/query-wrapper";
import { fakeQueries, resetFakeSupabase, respondWith } from "@/test/fake-supabase";
import type { MemberRow } from "@/lib/members/fields";
import MemberForm from "./MemberForm";

// Campo Função do formulário de membro. As funções chegam depois de o
// formulário abrir; a função atual do membro não pode se perder nesse meio
// tempo (o Salvar seria recusado com "Selecione uma função para o membro.").

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

// Permissões do usuário logado. Por padrão, só atribuir a função: sem os dados
// ministeriais, que trariam os seletores de membro e as consultas deles.
const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isSystem: false,
    hasPermission: (...permissions: string[]) => permissions.some((p) => auth.permissions.has(p)),
  }),
}));

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

const ROLE = "Função *";

const roles = [
  { id: "role-admin", name: "Administrador", is_default: false },
  { id: "role-lider", name: "Líder", is_default: false },
  { id: "role-membro", name: "Membro", is_default: true },
];

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
  is_baptized: true,
  baptism_date: null,
  is_active: true,
  g12_level: 2,
  total_disciples: 0,
  total_cells: 0,
  role_id: "role-lider",
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

/** A lista de funções só chega quando `release` for chamado. */
function respondWithRolesLater() {
  let release: () => void = () => {};
  const arrived = new Promise<void>((resolve) => {
    release = resolve;
  });
  respondWith({ data: roles, until: arrived });
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
  });

  it("Dado um membro em edição aberto antes de as funções carregarem, quando elas chegam, então a função atual continua escolhida e vai no Salvar", async () => {
    const releaseRoles = respondWithRolesLater();
    const onClose = vi.fn();
    render(<MemberForm member={member} onClose={onClose} />, { wrapper: createQueryWrapper() });

    expect(screen.getByLabelText(ROLE)).toHaveValue("Carregando funções…");

    await releaseRoles();

    const trigger = await screen.findByRole("combobox", { name: ROLE });
    expect(trigger).toHaveTextContent("Líder");

    respondWith({});
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
    const save = fakeQueries().find((query) => query.table === "members");
    expect(save?.calls).toContainEqual(["update", expect.objectContaining({ role_id: "role-lider" })]);
    expect(save?.calls).toContainEqual(["eq", "id", "m1"]);
  });

  it("Dado um membro novo, quando as funções chegam, então a função padrão vem escolhida", async () => {
    const releaseRoles = respondWithRolesLater();
    render(<MemberForm member={null} onClose={vi.fn()} />, { wrapper: createQueryWrapper() });

    expect(screen.getByLabelText(ROLE)).toHaveValue("Carregando funções…");

    await releaseRoles();

    await waitFor(() => expect(screen.getByRole("combobox", { name: ROLE })).toHaveTextContent("Membro (Padrão)"));
  });

  it("Dada uma falha ao carregar as funções, então o campo avisa", async () => {
    respondWith({ error: { code: "42501", message: "permission denied for table roles" } });
    render(<MemberForm member={member} onClose={vi.fn()} />, { wrapper: createQueryWrapper() });

    await waitFor(() => expect(screen.getByLabelText(ROLE)).toHaveValue("Não foi possível carregar as funções"));
    expect(screen.queryByRole("combobox", { name: ROLE })).not.toBeInTheDocument();
  });

  it("Dado quem não atribui funções, então a função atual aparece só para leitura", async () => {
    auth.permissions = new Set();
    respondWith({ data: roles });
    render(<MemberForm member={member} onClose={vi.fn()} />, { wrapper: createQueryWrapper() });

    await waitFor(() => expect(screen.getByLabelText("Função")).toHaveValue("Líder"));
    expect(screen.getByLabelText("Função")).toBeDisabled();
    expect(screen.queryByRole("combobox", { name: /Função/ })).not.toBeInTheDocument();
  });
});
