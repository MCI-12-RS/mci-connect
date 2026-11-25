import type { ReactNode } from "react";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeQueries, fakeRpcs, resetFakeSupabase, respondToRpc, respondWith } from "@/test/fake-supabase";
import type { MemberRow } from "@/lib/members/fields";
import MemberForm from "./MemberForm";

// Formulário de membro por acesso e recusas do servidor (E2.02, PR 4, tarefa 14):
// UX-18 (igreja toda como hoje), UX-21 (campo Função nas 5 situações, sem Input
// desabilitado) e UX-22 (recusas no Alert do topo, com foco e dados mantidos;
// erro embaixo do campo quando há `detail.field`; nada de sucesso com 0 linhas;
// 400/403 da `create-user-admin`).

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: { ...fakeSupabase, functions: { invoke } } };
});

interface FakeAccess {
  member_id: string;
  role_id: string | null;
  role_name: string | null;
  permissions: string[];
  sees_whole_church: boolean;
  can_assign_roles: boolean;
}

const auth = vi.hoisted(() => ({
  access: null as unknown as FakeAccess,
  permissions: new Set<string>(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    access: auth.access,
    member: null,
    hasPermission: (...permissions: string[]) => permissions.some((p) => auth.permissions.has(p)),
  }),
}));

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

/** Quem abre o formulário: o que `my_access` diria. */
function actAs(who: "rita" | "pedro" | "assigner", permissions: string[]) {
  const base = { permissions: [], role_id: "role-x" };
  auth.permissions = new Set(permissions);
  auth.access =
    who === "rita"
      ? { ...base, member_id: "rita", role_name: "Administrador", sees_whole_church: true, can_assign_roles: true }
      : who === "pedro"
        ? { ...base, member_id: "pedro", role_name: "Líder", sees_whole_church: false, can_assign_roles: false }
        : { ...base, member_id: "assigner", role_name: "Coordenação", sees_whole_church: false, can_assign_roles: true };
}

const member = (over: Partial<MemberRow>): MemberRow => ({
  id: "caio",
  name: "Caio Lima",
  gender: "M",
  birth_date: null,
  instagram: null,
  avatar_url: null,
  notes: null,
  neighborhood: null,
  city: null,
  state: null,
  is_pastor: false,
  has_leadership: true,
  leader_id: "andre",
  leader_name: "André Souza",
  spouse_id: null,
  spouse_name: null,
  is_baptized: false,
  baptism_date: null,
  is_active: true,
  g12_level: 4,
  total_disciples: 0,
  total_cells: 0,
  auth_user_id: null,
  sensitive_visible: true,
  email: "caio@teste.invalid",
  cpf: null,
  mobile_whatsapp: null,
  phone: null,
  street: null,
  number: null,
  complement: null,
  zip_code: null,
  ...over,
});

const CAIO = member({});
const RITA = member({ id: "rita", name: "Rita Souza", leader_id: "x", leader_name: "Outra" });

const choices = [
  { id: "role-admin", name: "Administrador", is_default: false },
  { id: "role-lider", name: "Líder", is_default: false },
  { id: "role-membro", name: "Membro", is_default: true },
];
const options = (over: object) => ({
  current: { id: "role-lider", name: "Líder" },
  editable: true,
  reason: null,
  options: choices,
  default_role: { id: "role-membro", name: "Membro" },
  ...over,
});

const wrapperWith = (client: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

/** Erro do PostgREST para uma regra do banco (22023 + HINT app_error + DETAIL em JSON). */
const appError = (message: string, detail: Record<string, unknown>) => ({
  code: "22023",
  message,
  hint: "app_error",
  details: JSON.stringify(detail),
});

/** A `create-user-admin` recusou: o supabase-js entrega um `FunctionsHttpError` com a `Response`. */
function createRefusal(status: number, body: unknown) {
  const error = new Error("Edge Function returned a non-2xx status code");
  Object.assign(error, { name: "FunctionsHttpError", context: new Response(JSON.stringify(body), { status }) });
  invoke.mockResolvedValueOnce({ data: null, error });
}

const submitNew = () => fireEvent.click(screen.getByRole("button", { name: "Criar membro" }));
const submitEdit = () => fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

/** O mínimo que a tela confere no cadastro novo (E2.04): nome e sobrenome, sexo e um identificador. */
async function fillRequired() {
  fireEvent.change(screen.getByLabelText("Nome *"), { target: { value: "Igor Teixeira" } });
  fireEvent.click(screen.getByRole("radio", { name: "Masculino" }));
  fireEvent.change(screen.getByLabelText("Celular / WhatsApp"), { target: { value: "51988887777" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Criar membro" })).toBeEnabled());
}

// O Switch e o Select do Radix medem o tamanho com ResizeObserver (o jsdom não tem).
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeAll(() => vi.stubGlobal("ResizeObserver", NoopResizeObserver));
afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  resetFakeSupabase();
  invoke.mockReset();
  toast.mockClear();
});

describe("UX-18: Rita (vê a igreja toda) vê os dados ministeriais como hoje", () => {
  it("Dado Rita editando Caio, então 'É Pastor(a)?', 'Tem Liderança?' e o 'Líder *' aparecem, sem a dica do ministério (E2.04, T4)", async () => {
    actAs("rita", ["edit_member", "assign_role", "view_all_church"]);
    respondToRpc("role_options", { data: options({}) });
    render(<MemberForm member={CAIO} onClose={vi.fn()} />, { wrapper: wrapperWith(newClient()) });

    expect(screen.getByRole("switch", { name: "É Pastor(a)?" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Tem Liderança?" })).toBeChecked();
    expect(screen.getByLabelText("Líder *")).toBeInTheDocument();
    expect(screen.queryByText(/O líder é obrigatório/)).not.toBeInTheDocument();
  });

  it("Dado Rita cadastrando, então 'Tem Liderança?' vem ligado e o 'Líder *' vem vazio (E2.04, RN-12, UX-15)", async () => {
    actAs("rita", ["create_member", "assign_role", "view_all_church"]);
    respondToRpc("role_options", { data: options({ current: null }) });
    render(<MemberForm member={null} onClose={vi.fn()} />, { wrapper: wrapperWith(newClient()) });

    expect(screen.getByRole("switch", { name: "Tem Liderança?" })).toBeChecked();
    expect(screen.getByLabelText("Líder *")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Limpar seleção" })).not.toBeInTheDocument();
  });
});

describe("UX-21: campo Função nas cinco situações (nenhum Input desabilitado)", () => {
  const noDisabledInput = () => expect(document.querySelector("input:disabled, textarea:disabled")).toBeNull();

  it("Rita editando Caio: seletor só com as funções atribuíveis, com (padrão) na padrão", async () => {
    actAs("rita", ["edit_member", "assign_role"]);
    respondToRpc("role_options", { data: options({}) });
    render(<MemberForm member={CAIO} onClose={vi.fn()} />, { wrapper: wrapperWith(newClient()) });

    const select = await screen.findByRole("combobox", { name: "Função *" });
    expect(select).toHaveTextContent("Líder");
    fireEvent.click(select);
    const list = await screen.findByRole("listbox");
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["Administrador", "Líder", "Membro (padrão)"]);
    noDisabledInput();
  });

  it("Rita no próprio cadastro: o texto 'Administrador' com 'Ninguém pode alterar a própria função.', sem ler a role_options", () => {
    actAs("rita", ["edit_member", "assign_role"]);
    render(<MemberForm member={RITA} onClose={vi.fn()} />, { wrapper: wrapperWith(newClient()) });

    expect(screen.getByText("Administrador")).toBeInTheDocument();
    expect(screen.getByText("Ninguém pode alterar a própria função.")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /Função/ })).not.toBeInTheDocument();
    expect(fakeRpcs().filter((call) => call.fn === "role_options")).toHaveLength(0);
    noDisabledInput();
  });

  it("quem atribui, diante da Administrador (acima dele): o texto com 'Você não tem permissão para alterar a função deste membro.'", async () => {
    actAs("assigner", ["edit_member", "assign_role"]);
    respondToRpc("role_options", {
      data: options({ editable: false, reason: "role_above", current: { id: "role-admin", name: "Administrador" }, options: [] }),
    });
    render(<MemberForm member={member({ id: "rita2", name: "Rita Dois" })} onClose={vi.fn()} />, {
      wrapper: wrapperWith(newClient()),
    });

    expect(await screen.findByText("Você não tem permissão para alterar a função deste membro.")).toBeInTheDocument();
    expect(screen.getByText("Administrador")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /Função/ })).not.toBeInTheDocument();
    noDisabledInput();
  });

  it("Pedro cadastrando: o texto 'Membro (padrão)' com 'Novos membros recebem a função padrão.'", async () => {
    actAs("pedro", ["create_member"]);
    respondToRpc("role_options", {
      data: options({ editable: false, reason: "no_permission", current: null, options: [] }),
    });
    render(<MemberForm member={null} onClose={vi.fn()} />, { wrapper: wrapperWith(newClient()) });

    expect(await screen.findByText("Membro (padrão)")).toBeInTheDocument();
    expect(screen.getByText("Novos membros recebem a função padrão.")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /Função/ })).not.toBeInTheDocument();
    noDisabledInput();
  });

  it("Pedro editando Caio: o campo Função não aparece e nada é lido de role_options", () => {
    actAs("pedro", ["edit_member"]);
    render(<MemberForm member={CAIO} onClose={vi.fn()} />, { wrapper: wrapperWith(newClient()) });

    expect(screen.queryByText("Função")).not.toBeInTheDocument();
    expect(screen.queryByText("Função *")).not.toBeInTheDocument();
    expect(fakeRpcs()).toHaveLength(0);
    noDisabledInput();
  });
});

describe("UX-22: recusas do servidor na edição (Pedro, sem a igreja toda)", () => {
  beforeEach(() => actAs("pedro", ["edit_member"]));

  async function openAndFillNotes() {
    const client = newClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const onClose = vi.fn();
    render(<MemberForm member={CAIO} onClose={onClose} />, { wrapper: wrapperWith(client) });
    fireEvent.change(screen.getByLabelText("Nome *"), { target: { value: "Caio Lima Jr" } });
    return { invalidate, onClose };
  }

  const refuse = (error: object) => respondWith({ error: error as never });

  it("RN-09 c: no Alert do topo (role=alert), com o foco, o formulário aberto, os dados mantidos e sem toast", async () => {
    const { onClose } = await openAndFillNotes();
    refuse(appError("Com esta alteração, você deixaria de ver este cadastro. As alterações não foram salvas.", { code: "would_leave_scope" }));
    submitEdit();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Com esta alteração, você deixaria de ver este cadastro. As alterações não foram salvas.");
    await waitFor(() => expect(alert).toHaveFocus());
    expect(screen.getByLabelText("Nome *")).toHaveValue("Caio Lima Jr");
    expect(onClose).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("RN-10: no Alert do topo, e a tela relê o acesso", async () => {
    const { invalidate } = await openAndFillNotes();
    refuse(
      appError("Só quem vê a igreja toda pode marcar um membro como pastor ou como sem liderança.", {
        code: "pastor_or_no_leadership_requires_church",
        field: "is_pastor",
      }),
    );
    submitEdit();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Só quem vê a igreja toda pode marcar um membro como pastor ou como sem liderança.");
    expect(invalidate.mock.calls.some(([filters]) => filters?.queryKey?.[0] === "access")).toBe(true);
  });

  it("RN-09 b com `detail.field`: o erro vai embaixo do Líder, e o Líder recebe o foco", async () => {
    await openAndFillNotes();
    refuse(appError("Você só pode escolher pessoas que você vê.", { code: "person_not_visible", field: "leader_id" }));
    submitEdit();

    const message = await screen.findByText("Você só pode escolher pessoas que você vê.");
    expect(message.closest("p")).toHaveAttribute("id", "leader-error");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Líder *")).toHaveAttribute("aria-describedby", expect.stringContaining("leader-error"));
    await waitFor(() => expect(screen.getByLabelText("Líder *")).toHaveFocus());
  });

  it("RN-09 b com `detail.field` do Cônjuge: o erro vai embaixo do Cônjuge", async () => {
    await openAndFillNotes();
    refuse(appError("Você só pode escolher pessoas que você vê.", { code: "person_not_visible", field: "spouse_id" }));
    submitEdit();

    const message = await screen.findByText("Você só pode escolher pessoas que você vê.");
    expect(message.closest("div")?.querySelector("#spouse")).not.toBeNull();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("RN-09 b sem `detail.field`: no Alert do topo", async () => {
    await openAndFillNotes();
    refuse(appError("Você só pode escolher pessoas que você vê.", { code: "person_not_visible" }));
    submitEdit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Você só pode escolher pessoas que você vê.");
  });

  it("42501: 'Você não tem permissão para esta ação.' no Alert, sem código técnico, e o acesso é relido", async () => {
    const { invalidate } = await openAndFillNotes();
    refuse({ code: "42501", message: 'new row violates row-level security policy for table "members"' });
    submitEdit();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Você não tem permissão para esta ação.");
    expect(alert.textContent ?? "").not.toMatch(/42501|row-level|policy/i);
    expect(invalidate.mock.calls.some(([filters]) => filters?.queryKey?.[0] === "access")).toBe(true);
    expect(toast).not.toHaveBeenCalled();
  });

  it("0 linhas alteradas: o aviso de cadastro que saiu do que se vê, e nenhum toast de sucesso", async () => {
    const { onClose } = await openAndFillNotes();
    respondWith({ data: [] });
    submitEdit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Este cadastro não existe ou já foi excluído. As alterações não foram salvas.");
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Membro atualizado com sucesso" }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("erro técnico ou 40P01 (DT-25): 'tente de novo' no rodapé (role=alert), sem o texto técnico, sem toast, e o foco no botão (T7)", async () => {
    await openAndFillNotes();
    refuse({ code: "40P01", message: "deadlock detected" });
    submitEdit();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Não foi possível salvar o cadastro. Tente de novo.");
    expect(alert.textContent ?? "").not.toMatch(/40P01|deadlock/);
    expect(toast).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Salvar alterações" })).toHaveFocus());
  });

  it("E2.04: 23505 cru do índice único mostra a mensagem amigável embaixo do E-mail, nunca o texto técnico", async () => {
    await openAndFillNotes();
    refuse({ code: "23505", message: 'duplicate key value violates unique constraint "members_email_key"', details: "Key (email)=(x) already exists." });
    submitEdit();

    const message = await screen.findByText("Este e-mail já está sendo usado por outro cadastro.");
    expect(message.closest("p")).toHaveAttribute("id", "email-error");
    expect(screen.getByLabelText("E-mail")).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/duplicate key/)).not.toBeInTheDocument();
  });

  it("depois de uma recusa, um novo envio limpa o Alert", async () => {
    await openAndFillNotes();
    refuse(appError("Com esta alteração, você deixaria de ver este cadastro. As alterações não foram salvas.", { code: "would_leave_scope" }));
    submitEdit();
    await screen.findByRole("alert");

    respondWith({ data: [{ id: "caio" }] });
    submitEdit();
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});

describe("UX-22: recusas da `create-user-admin` no cadastro novo (Pedro)", () => {
  beforeEach(() => {
    actAs("pedro", ["create_member"]);
    respondToRpc("role_options", { data: options({ editable: false, reason: "no_permission", current: null, options: [] }) });
  });

  async function fillNew() {
    const onClose = vi.fn();
    render(<MemberForm member={null} onClose={onClose} />, { wrapper: wrapperWith(newClient()) });
    await fillRequired();
    return onClose;
  }

  it("RN-19 (400, default_role_not_covered): no Alert do topo, com foco, formulário aberto e dados mantidos", async () => {
    const onClose = await fillNew();
    createRefusal(400, {
      error: "A função padrão tem permissões que você não tem. Peça a um administrador para fazer este cadastro.",
      code: "default_role_not_covered",
    });
    submitNew();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("A função padrão tem permissões que você não tem. Peça a um administrador para fazer este cadastro.");
    await waitFor(() => expect(alert).toHaveFocus());
    expect(screen.getByLabelText("Nome *")).toHaveValue("Igor Teixeira");
    expect(onClose).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("RN-10 (400, com field): no Alert do topo, e o acesso é relido", async () => {
    const client = newClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    render(<MemberForm member={null} onClose={vi.fn()} />, { wrapper: wrapperWith(client) });
    await fillRequired();
    createRefusal(400, {
      error: "Só quem vê a igreja toda pode marcar um membro como pastor ou como sem liderança.",
      code: "pastor_or_no_leadership_requires_church",
      field: "has_leadership",
    });
    submitNew();

    expect(await screen.findByRole("alert")).toHaveTextContent("Só quem vê a igreja toda pode marcar");
    expect(invalidate.mock.calls.some(([filters]) => filters?.queryKey?.[0] === "access")).toBe(true);
  });

  it("RN-09 b (400, com field leader_id): embaixo do Líder", async () => {
    await fillNew();
    createRefusal(400, {
      error: "Você só pode escolher pessoas que você vê.",
      code: "person_not_visible",
      field: "leader_id",
    });
    submitNew();

    const message = await screen.findByText("Você só pode escolher pessoas que você vê.");
    expect(message.closest("p")).toHaveAttribute("id", "leader-error");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("403 (forbidden): 'Você não tem permissão para esta ação.' no Alert, e o acesso é relido", async () => {
    const client = newClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    render(<MemberForm member={null} onClose={vi.fn()} />, { wrapper: wrapperWith(client) });
    await fillRequired();
    createRefusal(403, { error: "Sem permissão para criar membros.", code: "forbidden" });
    submitNew();

    expect(await screen.findByRole("alert")).toHaveTextContent("Você não tem permissão para esta ação.");
    expect(invalidate.mock.calls.some(([filters]) => filters?.queryKey?.[0] === "access")).toBe(true);
    expect(toast).not.toHaveBeenCalled();
  });

  it("recusa sem código (erro técnico): 'tente de novo' no rodapé, sem o texto do servidor e sem toast (T7)", async () => {
    await fillNew();
    createRefusal(500, { error: "Falha ao criar o usuário." });
    submitNew();

    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível salvar o cadastro. Tente de novo.");
    expect(screen.queryByText("Falha ao criar o usuário.")).not.toBeInTheDocument();
    expect(toast).not.toHaveBeenCalled();
  });

  it("sucesso: toast 'Membro criado com sucesso' e o formulário fecha", async () => {
    const onClose = await fillNew();
    invoke.mockResolvedValueOnce({ data: { id: "novo" }, error: null });
    submitNew();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith({ title: "Membro criado com sucesso" });
    expect(invoke).toHaveBeenCalledWith("create-user-admin", expect.objectContaining({ body: expect.objectContaining({ memberData: expect.any(Object) }) }));
  });

  it("E2.04 (DT-11, RN-05): corpo novo, e-mail vazio como null e o mesmo attemptId na nova tentativa", async () => {
    await fillNew();
    createRefusal(409, { error: "Este celular já está sendo usado por outro cadastro.", code: "value_in_use", fields: ["mobile"] });
    submitNew();
    // Recusa com campo (T5): embaixo do Celular, com o foco nele.
    const message = await screen.findByText("Este celular já está sendo usado por outro cadastro.");
    expect(message.closest("p")).toHaveAttribute("id", "mobile_whatsapp-error");
    await waitFor(() => expect(screen.getByLabelText("Celular / WhatsApp")).toHaveFocus());

    invoke.mockResolvedValueOnce({ data: { member: { id: "novo" }, replayed: true }, error: null });
    submitNew();
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "Membro criado com sucesso" }));

    const bodies = invoke.mock.calls.map(([, options]) => options.body);
    expect(bodies).toHaveLength(2);
    expect(bodies[0].attemptId).toMatch(/^[0-9a-f-]{36}$/);
    expect(bodies[1].attemptId).toBe(bodies[0].attemptId);
    expect(bodies[0]).not.toHaveProperty("email");
    expect(bodies[0].memberData.email).toBeNull();
  });

  it("E2.04: uma nova abertura do formulário gera outro attemptId", async () => {
    const { unmount } = render(<MemberForm member={null} onClose={vi.fn()} />, { wrapper: wrapperWith(newClient()) });
    await fillRequired();
    invoke.mockResolvedValueOnce({ data: { member: { id: "a" }, replayed: false }, error: null });
    submitNew();
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    unmount();

    await fillNew();
    invoke.mockResolvedValueOnce({ data: { member: { id: "b" }, replayed: false }, error: null });
    submitNew();
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    const [first, second] = invoke.mock.calls.map(([, options]) => options.body.attemptId);
    expect(second).not.toBe(first);
  });

  it("UX-17: o cadastro novo de Pedro vem com ele no Líder, com a dica ligada ao campo e sem os interruptores", async () => {
    await fillNew();
    expect(screen.getByLabelText("Líder *")).toHaveAttribute("aria-describedby", expect.stringContaining("leader-hint"));
    expect(screen.getByRole("button", { name: "Limpar seleção" })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "É Pastor(a)?" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Tem Liderança?" })).not.toBeInTheDocument();
    expect(screen.getByText("O líder é obrigatório e é escolhido entre as pessoas do seu ministério.")).toBeInTheDocument();
  });

  it("UX-17: Pedro limpa o líder e salva: 'Escolha o líder.' embaixo do campo, com o foco, e nada vai ao servidor", async () => {
    await fillNew();
    fireEvent.click(screen.getByRole("button", { name: "Limpar seleção" }));
    submitNew();

    const message = await screen.findByText("Escolha o líder.");
    expect(message.closest("p")).toHaveAttribute("id", "leader-error");
    await waitFor(() => expect(screen.getByLabelText("Líder *")).toHaveFocus());
    expect(invoke).not.toHaveBeenCalled();
  });
});
