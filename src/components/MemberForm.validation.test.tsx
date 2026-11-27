import type { ReactNode } from "react";
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeQueries, fakeRpcs, resetFakeSupabase, respondToRpc, respondWith } from "@/test/fake-supabase";
import type { MemberRow } from "@/lib/members/fields";
import MemberForm from "./MemberForm";

// Formulário de membro (E2.04, PR 3, tarefa 11): os critérios de UX que se provam em
// componente (UX-02 a UX-12, 18, 20, 22 a 27 e 30) e os critérios de pronto da tarefa 9
// (edição sem mudança não faz requisição; o PATCH leva só o que mudou; nenhuma consulta de
// unicidade fora do salvar; o domínio fictício não aparece no DOM). Quem abre é Rita
// (vê a igreja toda). O Supabase é o `fake-supabase`; a `create-user-admin` é o `invoke`.

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/components/RecordAuthorship", async () => {
  const { RecordAuthorshipStub } = await import("@/test/record-authorship-stub");
  return { RecordAuthorship: RecordAuthorshipStub };
});

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: { ...fakeSupabase, functions: { invoke } } };
});

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    access: {
      member_id: "rita",
      role_id: "role-admin",
      role_name: "Administrador",
      permissions: [],
      sees_whole_church: true,
      can_assign_roles: true,
    },
    member: null,
    hasPermission: (...permissions: string[]) => permissions.some((p) => auth.permissions.has(p)),
  }),
}));

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

const member = (over: Partial<MemberRow> = {}): MemberRow => ({
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
  g12_name: null,
  total_disciples: 0,
  total_cells: 0,
  auth_user_id: null,
  sensitive_visible: true,
  email: "caio@exemplo.com",
  cpf: null,
  mobile_whatsapp: "51988887777",
  phone: null,
  street: null,
  number: null,
  complement: null,
  zip_code: null,
  ...over,
});
const CAIO = member();
/** Veio do legado (RN-17): uma palavra no nome, celular sem DDD, nascido em 1920, sem identificador real. */
const FABIO = member({
  id: "fabio",
  name: "Fábio",
  birth_date: "1920-03-10",
  mobile_whatsapp: "98887777",
  email: null,
  is_active: false,
});

const roleOptions = (current: { id: string; name: string } | null) => ({
  current,
  editable: true,
  reason: null,
  options: [
    { id: "role-admin", name: "Administrador", is_default: false },
    { id: "role-membro", name: "Membro", is_default: true },
  ],
  default_role: { id: "role-membro", name: "Membro" },
});

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={newClient()}>{children}</QueryClientProvider>;

async function renderNew() {
  auth.permissions = new Set(["create_member", "assign_role", "view_all_church"]);
  respondToRpc("role_options", { data: roleOptions(null) });
  const onClose = vi.fn();
  render(<MemberForm member={null} onClose={onClose} />, { wrapper });
  await screen.findByRole("button", { name: "Criar membro" });
  return onClose;
}

/** O Líder já vem com quem cadastra (E2.07, RN-16): os testes do Líder vazio o tiram antes. */
function clearLeader() {
  const leader = field("Líder *").closest("[data-leader-field]") as HTMLElement;
  fireEvent.click(within(leader).getByRole("button", { name: "Limpar seleção" }));
}

async function renderEdit(row: MemberRow = CAIO, props: { title?: string; readOnly?: boolean } = {}) {
  auth.permissions = new Set(["edit_member", "assign_role", "view_all_church"]);
  respondToRpc("role_options", { data: roleOptions({ id: "role-membro", name: "Membro" }) });
  const onClose = vi.fn();
  render(<MemberForm member={row} onClose={onClose} {...props} />, { wrapper });
  if (props.readOnly) await screen.findAllByRole("button", { name: "Fechar" });
  else await screen.findByRole("button", { name: "Salvar alterações" });
  await screen.findByRole("combobox", { name: "Função *" }).catch(() => null);
  return onClose;
}

const field = (label: string) => screen.getByLabelText(label);
const type = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });
const typeAndLeave = (label: string, value: string) => {
  type(label, value);
  fireEvent.blur(field(label));
};
const clickCreate = () => fireEvent.click(screen.getByRole("button", { name: "Criar membro" }));
const clickSave = () => fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
const submitted = (name = "Criar membro") => fireEvent.click(screen.getByRole("button", { name }));
const summary = () => screen.queryByText(/Confira os campos destacados/);
const memberQueries = () => fakeQueries().filter((q) => q.table === "members");
const updateArgs = () => memberQueries().flatMap((q) => q.calls.filter(([m]) => m === "update").map(([, patch]) => patch));
const errorOf = (id: string) => document.getElementById(`${id}-error`);

const appError = (message: string, detail: Record<string, unknown>) => ({
  code: "22023",
  message,
  hint: "app_error",
  details: JSON.stringify(detail),
});
const refuseUpdate = (error: object) => respondWith({ error: error as never });

function createRefusal(status: number, body: unknown) {
  const error = new Error("Edge Function returned a non-2xx status code");
  Object.assign(error, { name: "FunctionsHttpError", context: new Response(JSON.stringify(body), { status }) });
  invoke.mockResolvedValueOnce({ data: null, error });
}

beforeAll(() => {
  // Os dois mostrados abaixo do formulário (o jsdom não mede).
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  resetFakeSupabase();
  invoke.mockReset();
  toast.mockClear();
});

describe("UX-02: ordem e agrupamento dos campos de Dados pessoais", () => {
  it("Dado o cadastro novo, então a ordem é Nome, Sexo, Data de nascimento, Identificação (Celular, E-mail, CPF), Telefone, Instagram, Cônjuge e Observações", async () => {
    await renderNew();
    const order = [
      field("Nome *"),
      screen.getByRole("radiogroup", { name: /Sexo/ }),
      field("Data de nascimento"),
      field("Celular / WhatsApp"),
      field("E-mail"),
      field("CPF"),
      field("Telefone"),
      field("Instagram (@)"),
      field("Cônjuge"),
      field("Observações"),
    ];
    for (let i = 0; i < order.length - 1; i++) {
      expect(order[i].compareDocumentPosition(order[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING, `posição ${i}`).toBeTruthy();
    }
  });

  it("Dado o cadastro novo, então Celular, E-mail e CPF ficam num grupo 'Identificação' com a dica", async () => {
    await renderNew();
    const group = screen.getByRole("group", { name: "Identificação" });
    expect(within(group).getByLabelText("Celular / WhatsApp")).toBeInTheDocument();
    expect(within(group).getByLabelText("E-mail")).toBeInTheDocument();
    expect(within(group).getByLabelText("CPF")).toBeInTheDocument();
    expect(within(group).getByText("A pessoa entra no sistema com o celular, o e-mail ou o CPF. Informe pelo menos um.")).toBeInTheDocument();
  });

  it("Dado o formulário, então uma coluna abaixo de 768 px e os pares a partir de 768 px (grid-cols-1 e md:grid-cols-2; Nome e Observações em linha inteira)", async () => {
    await renderNew();
    const grid = field("Nome *").closest(".grid");
    expect(grid).toHaveClass("grid-cols-1", "md:grid-cols-2");
    expect(field("Nome *").closest("div")).toHaveClass("md:col-span-2");
    expect(field("Observações").closest("div")).toHaveClass("md:col-span-2");
  });
});

describe("UX-03: rótulos e títulos", () => {
  it("Dado o cadastro novo, então o DOM tem 'Sexo *', 'Data de nascimento', a nota dos obrigatórios e o título 'Novo membro', e não tem 'Gênero'", async () => {
    await renderNew();
    expect(screen.getByRole("dialog", { name: "Novo membro" })).toBeInTheDocument();
    expect(screen.getByText("Sexo *")).toBeInTheDocument();
    expect(field("Data de nascimento")).toBeInTheDocument();
    expect(screen.getByText("Campos com * são obrigatórios.")).toBeInTheDocument();
    expect(screen.queryByText(/Gênero/)).not.toBeInTheDocument();
  });

  it("Dado a edição, então o título é 'Editar membro', a ação é 'Salvar alterações', e 'Data do batismo' aparece com 'Batizado(a)?' ligado", async () => {
    await renderEdit(member({ is_baptized: true, baptism_date: "2020-05-10" }));
    expect(screen.getByRole("dialog", { name: "Editar membro" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar alterações" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Salvar" })).not.toBeInTheDocument();
    expect(field("Data do batismo")).toHaveValue("2020-05-10");
    expect(screen.queryByText(/Gênero/)).not.toBeInTheDocument();
  });

  it("Dado 'Editar meus dados' (título pela tela), então o diálogo usa esse título", async () => {
    await renderEdit(CAIO, { title: "Editar meus dados" });
    expect(screen.getByRole("dialog", { name: "Editar meus dados" })).toBeInTheDocument();
  });
});

describe("UX-04: Sexo é um radiogroup", () => {
  it("Dado o cadastro novo, então há Masculino e Feminino, nenhum marcado, e cada caixa tem min-h-11", async () => {
    await renderNew();
    const group = screen.getByRole("radiogroup", { name: /^Sexo/ });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("aria-label") ?? r.closest("label")?.textContent)).toEqual(["Masculino", "Feminino"]);
    expect(within(group).queryAllByRole("radio", { checked: true })).toHaveLength(0);
    for (const radio of radios) expect(radio.closest("label")).toHaveClass("min-h-11");
  });

  it("Dado o toque no texto 'Feminino', então a opção marca (a caixa inteira é o alvo)", async () => {
    await renderNew();
    fireEvent.click(screen.getByText("Feminino"));
    expect(screen.getByRole("radio", { name: "Feminino" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Masculino" })).not.toBeChecked();
  });
});

describe("UX-05: atributos dos campos", () => {
  it("Dado o formulário, então os campos têm o type, o inputMode e os atributos de teclado da T2 e da T3", async () => {
    await renderNew();
    expect(field("Celular / WhatsApp")).toHaveAttribute("type", "tel");
    expect(field("CPF")).toHaveAttribute("inputmode", "numeric");
    const email = field("E-mail");
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("autocapitalize", "none");
    expect(email).toHaveAttribute("autocorrect", "off");
    expect(email).toHaveAttribute("spellcheck", "false");
    expect(field("Nome *")).toHaveAttribute("autocapitalize", "words");
    for (const label of ["Nome *", "E-mail", "Celular / WhatsApp", "CPF", "Telefone", "Data de nascimento"]) {
      expect(field(label), label).toHaveAttribute("autocomplete", "off");
    }
  });

  it("Dado o formulário, então as Observações têm fonte de 16 px no celular (text-base) e o form tem noValidate", async () => {
    await renderNew();
    expect(field("Observações")).toHaveClass("text-base", "md:text-sm");
    expect(document.querySelector("form")?.noValidate).toBe(true);
  });
});

describe("UX-06: celular (tabela da T3)", () => {
  it.each([
    ["51988887777", "(51) 98888-7777"],
    ["(51)98888-7777", "(51) 98888-7777"],
    ["+55 (51) 98888-7777", "(51) 98888-7777"],
    ["5551988887777", "(51) 98888-7777"],
    ["051 98888-7777", "(51) 98888-7777"],
    ["(55) 99999-1111", "(55) 99999-1111"],
    ["55999991111", "(55) 99999-1111"],
    ["5133334444", "(51) 3333-4444"],
    ["98888-1234", "98888-1234"],
    ["(51) 98888-12345", "(51) 98888-12345"],
  ])("Dado %s digitado ou colado, quando sai do campo, então mostra %s e nenhum dígito foi cortado antes", async (input, expected) => {
    await renderNew();
    type("Celular / WhatsApp", input);
    expect((field("Celular / WhatsApp") as HTMLInputElement).value.replace(/\D/g, "")).toBe(input.replace(/\D/g, ""));
    fireEvent.blur(field("Celular / WhatsApp"));
    expect(field("Celular / WhatsApp")).toHaveValue(expected);
  });
});

describe("UX-07: CPF (tabela da T3)", () => {
  it.each([
    ["52998224725", "529.982.247-25"],
    ["01234567890", "012.345.678-90"],
    ["529.982.247-26", "529.982.247-26"],
    ["1144477735", "114.447.773-5"],
    ["111444777350", "111.444.777-350"],
  ])("Dado %s, quando sai do campo, então mostra %s, sem cortar dígitos", async (input, expected) => {
    await renderNew();
    typeAndLeave("CPF", input);
    expect(field("CPF")).toHaveValue(expected);
    expect((field("CPF") as HTMLInputElement).value.replace(/\D/g, "")).toBe(input.replace(/\D/g, ""));
  });
});

describe("UX-08: erros ao salvar, todos de uma vez, sem requisição", () => {
  it("Dado o cadastro novo vazio, quando 'Criar membro', então Nome, Sexo, Identificação e Líder têm erro, o foco vai ao Nome e nada é enviado", async () => {
    await renderNew();
    clearLeader();
    const requestsBefore = fakeQueries().length + fakeRpcs().length;
    clickCreate();

    expect(await screen.findByText("Informe o nome e o sobrenome.")).toBeInTheDocument();
    expect(errorOf("name")).toBeInTheDocument();
    expect(errorOf("gender")).toHaveTextContent("Informe o sexo.");
    expect(errorOf("identification")).toHaveTextContent("Informe o e-mail, o celular ou o CPF.");
    expect(errorOf("leader")).toHaveTextContent('Escolha o líder ou desligue "Tem Liderança?".');
    expect(screen.getByText("Confira os campos destacados (4).")).toBeInTheDocument();
    await waitFor(() => expect(field("Nome *")).toHaveFocus());
    expect(invoke).not.toHaveBeenCalled();
    expect(fakeQueries().length + fakeRpcs().length).toBe(requestsBefore);
  });
});

describe("UX-09: conferência fora do salvar", () => {
  it("Dado um campo alterado e preenchido, quando sai dele, então só o erro de formato daquele campo aparece", async () => {
    await renderNew();
    typeAndLeave("CPF", "52998224726");
    expect(errorOf("cpf")).toHaveTextContent("CPF inválido.");
    expect(errorOf("name")).toBeNull();
    expect(errorOf("gender")).toBeNull();
    expect(errorOf("identification")).toBeNull();
  });

  it("Dado um campo vazio, quando sai dele, então nenhum erro aparece", async () => {
    await renderNew();
    fireEvent.blur(field("Nome *"));
    fireEvent.blur(field("E-mail"));
    fireEvent.blur(field("CPF"));
    expect(errorOf("name")).toBeNull();
    expect(errorOf("email")).toBeNull();
    expect(errorOf("cpf")).toBeNull();
  });

  it("Dado um erro de formato, quando o valor fica certo (sem sair do campo), então o erro some", async () => {
    await renderNew();
    typeAndLeave("CPF", "52998224726");
    expect(errorOf("cpf")).toBeInTheDocument();
    type("CPF", "52998224725");
    expect(errorOf("cpf")).toBeNull();
  });

  it("Dado a pessoa digitando um valor ruim (sem sair do campo), então nenhum erro novo aparece", async () => {
    await renderNew();
    type("CPF", "529");
    type("E-mail", "isso-nao-e-email");
    type("Celular / WhatsApp", "9888");
    expect(errorOf("cpf")).toBeNull();
    expect(errorOf("email")).toBeNull();
    expect(errorOf("mobile_whatsapp")).toBeNull();
  });

  it("Dado e-mail, celular e CPF preenchidos e deixados, então nenhuma consulta de dado em uso acontece fora do salvar", async () => {
    await renderNew();
    const before = { queries: fakeQueries().length, rpcs: fakeRpcs().length };
    typeAndLeave("E-mail", "lucia@exemplo.com");
    typeAndLeave("Celular / WhatsApp", "51988887777");
    typeAndLeave("CPF", "52998224725");
    expect(fakeQueries().length).toBe(before.queries);
    expect(fakeRpcs().length).toBe(before.rpcs);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("UX-10: resumo no rodapé", () => {
  it("Dado o salvar com 4 erros, então o resumo (role=status) mostra 4, diminui a cada correção e some sem erros", async () => {
    await renderNew();
    clearLeader();
    clickCreate();
    const note = await screen.findByText("Confira os campos destacados (4).");
    expect(note.closest("[role='status']")).not.toBeNull();

    type("Nome *", "Igor Teixeira");
    expect(screen.getByText("Confira os campos destacados (3).")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Masculino" }));
    expect(screen.getByText("Confira os campos destacados (2).")).toBeInTheDocument();
    type("Celular / WhatsApp", "51988887777");
    expect(screen.getByText("Confira os campos destacados (1).")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Tem Liderança?" }));
    expect(summary()).not.toBeInTheDocument();
  });

  it("Dado o resumo, quando toca de novo na ação primária, então o foco vai para o próximo campo com erro", async () => {
    await renderNew();
    clickCreate();
    await waitFor(() => expect(field("Nome *")).toHaveFocus());
    type("Nome *", "Igor Teixeira");
    clickCreate();
    await waitFor(() => expect(screen.getByRole("radio", { name: "Masculino" })).toHaveFocus());
  });

  it("Dado o cadastro antigo de Fábio com avisos de dado antigo, então os avisos não contam no resumo", async () => {
    await renderEdit(FABIO);
    expect(screen.getByText("Nome sem sobrenome. Complete quando puder.")).toBeInTheDocument();
    type("Observações", "ok");
    respondWith({ data: [{ id: "fabio" }] });
    clickSave();
    await waitFor(() => expect(summary()).not.toBeInTheDocument());
  });
});

describe("UX-11: Identificação (RN-08)", () => {
  it("Dado o cadastro sem nenhum identificador, quando salva, então a mensagem toma o lugar da dica, os três campos ficam inválidos ligados a ela e o foco vai ao Celular", async () => {
    await renderNew();
    type("Nome *", "Igor Teixeira");
    fireEvent.click(screen.getByRole("radio", { name: "Masculino" }));
    fireEvent.click(screen.getByRole("switch", { name: "Tem Liderança?" }));
    clickCreate();

    const message = await screen.findByText(/Informe o e-mail, o celular ou o CPF\. A pessoa usa um deles/);
    expect(message.closest("p")).toHaveAttribute("id", "identification-error");
    expect(screen.queryByText("A pessoa entra no sistema com o celular, o e-mail ou o CPF. Informe pelo menos um.")).not.toBeInTheDocument();
    for (const label of ["Celular / WhatsApp", "E-mail", "CPF"]) {
      expect(field(label), label).toHaveAttribute("aria-invalid", "true");
      expect(field(label).getAttribute("aria-describedby"), label).toContain("identification-error");
    }
    await waitFor(() => expect(field("Celular / WhatsApp")).toHaveFocus());
    expect(invoke).not.toHaveBeenCalled();
  });

  it("Dado o erro da Identificação, quando um identificador válido é informado, então o erro some dos três campos", async () => {
    await renderNew();
    clickCreate();
    await screen.findByText(/Informe o e-mail, o celular ou o CPF\. A pessoa usa um deles/);
    type("E-mail", "igor@exemplo.com");
    expect(errorOf("identification")).toBeNull();
    for (const label of ["Celular / WhatsApp", "E-mail", "CPF"]) expect(field(label)).not.toHaveAttribute("aria-invalid", "true");
  });

  it("Dado Caio com e-mail e celular, quando apaga o e-mail e salva, então grava e-mail nulo; quando apaga também o celular, a mensagem aparece e nada é enviado", async () => {
    await renderEdit();
    type("E-mail", "");
    respondWith({ data: [{ id: "caio" }] });
    clickSave();
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "Membro atualizado com sucesso" }));
    expect(updateArgs()).toEqual([{ email: null }]);
  });

  it("Dado Caio sem e-mail nem celular, quando salva, então a mensagem aparece e nenhuma gravação sai", async () => {
    await renderEdit();
    type("E-mail", "");
    type("Celular / WhatsApp", "");
    clickSave();
    expect(await screen.findByText(/Informe o e-mail, o celular ou o CPF/)).toBeInTheDocument();
    expect(updateArgs()).toEqual([]);
  });
});

describe("UX-12: recusas do servidor com campo, no campo certo", () => {
  type Case = { name: string; message: string; detail: Record<string, unknown>; errorId: string; focus: string; row?: MemberRow };
  const cases: Case[] = [
    {
      name: "value_in_use (e-mail e CPF)",
      message: "Já existe um membro com este e-mail, CPF ou celular.",
      detail: { code: "value_in_use", fields: ["email", "cpf"] },
      errorId: "email-error",
      focus: "E-mail",
    },
    {
      name: "leader_cycle",
      message: "O líder escolhido é discípulo desta pessoa (direto ou indireto). Escolha outro líder.",
      detail: { code: "leader_cycle", field: "leader_id" },
      errorId: "leader-error",
      focus: "Líder *",
    },
    {
      name: "leader_self",
      message: "Uma pessoa não pode ser líder de si mesma.",
      detail: { code: "leader_self", field: "leader_id" },
      errorId: "leader-error",
      focus: "Líder *",
    },
    {
      name: "spouse_self",
      message: "Uma pessoa não pode ser cônjuge de si mesma.",
      detail: { code: "spouse_self", field: "spouse_id" },
      errorId: "spouse-error",
      focus: "Cônjuge",
    },
    {
      name: "pastor_with_leader",
      message: 'Pastor(a) não tem líder. Tire o líder ou desmarque "É Pastor(a)?".',
      detail: { code: "pastor_with_leader", field: "is_pastor" },
      errorId: "is_pastor-error",
      focus: "É Pastor(a)?",
    },
    {
      name: "leader_required",
      message: "O líder é obrigatório.",
      detail: { code: "leader_required", field: "leader_id" },
      errorId: "leader-error",
      focus: "Líder *",
    },
    {
      name: "baptism_date_without_baptism",
      message: "A data do batismo só pode ser informada para quem é batizado(a).",
      detail: { code: "baptism_date_without_baptism", field: "baptism_date" },
      errorId: "baptism_date-error",
      focus: "Data do batismo",
      row: member({ is_baptized: true, baptism_date: "2020-05-10" }),
    },
  ];

  it.each(cases)("Dado a recusa $name, então aparece embaixo do campo certo, entra no resumo, recebe o foco e o formulário fica aberto, sem toast", async (c) => {
    const onClose = await renderEdit(c.row ?? CAIO);
    type("Observações", "x");
    refuseUpdate(appError(c.message, c.detail));
    clickSave();

    await waitFor(() => expect(errorOf(c.errorId.replace(/-error$/, ""))).not.toBeNull());
    const target = errorOf(c.errorId.replace(/-error$/, ""));
    // O texto mostrado (a recusa `value_in_use` mostra a mensagem de cada campo, nunca a genérica).
    expect(target?.textContent).toMatch(/\S/);
    expect(target?.textContent).not.toContain("Já existe um membro com este e-mail, CPF ou celular.");
    expect(summary()).toBeInTheDocument();
    const focused = c.focus === "É Pastor(a)?" ? screen.getByRole("switch", { name: c.focus }) : field(c.focus);
    await waitFor(() => expect(focused).toHaveFocus());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(toast).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(field("Observações")).toHaveValue("x");
  });

  it("Dado value_in_use com e-mail, celular e CPF, então cada campo recebe a própria mensagem e a genérica nunca aparece", async () => {
    await renderEdit();
    type("Observações", "x");
    refuseUpdate(appError("Já existe um membro com este e-mail, CPF ou celular.", { code: "value_in_use", fields: ["email", "mobile", "cpf"] }));
    clickSave();
    expect(await screen.findByText("Este e-mail já está sendo usado por outro cadastro.")).toBeInTheDocument();
    expect(screen.getByText("Este celular já está sendo usado por outro cadastro.")).toBeInTheDocument();
    expect(screen.getByText("Este CPF já está sendo usado por outro cadastro.")).toBeInTheDocument();
    expect(screen.queryByText("Já existe um membro com este e-mail, CPF ou celular.")).not.toBeInTheDocument();
    expect(screen.getByText("Confira os campos destacados (3).")).toBeInTheDocument();
  });
});

describe("UX-18: Samuel deixa de ser pastor", () => {
  it("Dado Samuel (pastor), quando desliga 'É Pastor(a)?', então 'Tem Liderança?' aparece ligado e o Líder, vazio e obrigatório", async () => {
    await renderEdit(member({ id: "samuel", name: "Samuel Dias", is_pastor: true, has_leadership: false, leader_id: null, leader_name: null }));
    expect(screen.queryByRole("switch", { name: "Tem Liderança?" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "É Pastor(a)?" }));
    expect(screen.getByRole("switch", { name: "Tem Liderança?" })).toBeChecked();
    expect(field("Líder *")).toHaveValue("");
    expect(screen.getByText("Líder *")).toBeInTheDocument();
  });
});

describe("UX-20: data de nascimento, relógio em 23/11/2026 23:30 de Brasília e navegador em UTC", () => {
  const OLD_TZ = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "UTC";
  });
  afterAll(() => {
    if (OLD_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = OLD_TZ;
  });
  beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-24T02:30:00Z") }));
  afterEach(() => vi.useRealTimers());

  it("Dado o relógio em UTC, então 24/11/2026 02:30Z é 23/11 em Brasília (premissa do teste)", () => {
    expect(new Date().getTimezoneOffset()).toBe(0);
    expect(new Date().getUTCDate()).toBe(24);
  });

  it("Dado o campo, então tem max 2026-11-23 e min 1926-11-24", async () => {
    await renderNew();
    expect(field("Data de nascimento")).toHaveAttribute("max", "2026-11-23");
    expect(field("Data de nascimento")).toHaveAttribute("min", "1926-11-24");
  });

  it("Dado 24/11/2026, então 'A data de nascimento não pode ser futura.'; 23/11/2026 é aceita", async () => {
    await renderNew();
    typeAndLeave("Data de nascimento", "2026-11-24");
    expect(errorOf("birth_date")).toHaveTextContent("A data de nascimento não pode ser futura.");
    typeAndLeave("Data de nascimento", "2026-11-23");
    expect(errorOf("birth_date")).toBeNull();
    expect(screen.getByText("Menos de 1 ano")).toBeInTheDocument();
  });

  it("Dado 23/11/1926, então a mensagem dos 100 anos; 24/11/1926 é aceita", async () => {
    await renderNew();
    typeAndLeave("Data de nascimento", "1926-11-23");
    expect(errorOf("birth_date")).toHaveTextContent("Confira a data de nascimento: a pessoa teria 100 anos ou mais.");
    typeAndLeave("Data de nascimento", "1926-11-24");
    expect(errorOf("birth_date")).toBeNull();
    expect(screen.getByText("99 anos")).toBeInTheDocument();
  });

  it("Dado 14/02/1992, então '34 anos'", async () => {
    await renderNew();
    typeAndLeave("Data de nascimento", "1992-02-14");
    expect(screen.getByText("34 anos")).toBeInTheDocument();
  });
});

describe("UX-22: dado antigo fora da regra (P24)", () => {
  it("Dado Fábio, quando abre, então o celular aparece como está ('98887777') com o aviso, sem aria-invalid", async () => {
    await renderEdit(FABIO);
    expect(field("Celular / WhatsApp")).toHaveValue("98887777");
    expect(screen.getByText("Celular fora do formato. Corrija quando puder.")).toBeInTheDocument();
    expect(field("Celular / WhatsApp")).not.toHaveAttribute("aria-invalid", "true");
    expect(field("Nome *")).not.toHaveAttribute("aria-invalid", "true");
  });

  it("Dado o celular com aviso, quando mexe ('9888-7770'), então o aviso sai e o erro do celular aparece; ao voltar ao gravado, o erro sai e o aviso volta", async () => {
    await renderEdit(FABIO);
    typeAndLeave("Celular / WhatsApp", "9888-7770");
    expect(errorOf("mobile_whatsapp")).toHaveTextContent("Celular inválido. Informe o DDD e o número.");
    expect(screen.queryByText("Celular fora do formato. Corrija quando puder.")).not.toBeInTheDocument();

    typeAndLeave("Celular / WhatsApp", "98887777");
    expect(errorOf("mobile_whatsapp")).toBeNull();
    expect(screen.getByText("Celular fora do formato. Corrija quando puder.")).toBeInTheDocument();
  });

  it("Dado Caio com o celular gravado 51988887777, quando abre, então o campo mostra '(51) 98888-7777' e salvar não conta o celular como alterado", async () => {
    await renderEdit();
    expect(field("Celular / WhatsApp")).toHaveValue("(51) 98888-7777");
    type("Observações", "só isto");
    respondWith({ data: [{ id: "caio" }] });
    clickSave();
    await waitFor(() => expect(updateArgs()).toHaveLength(1));
    expect(updateArgs()[0]).toEqual({ notes: "só isto" });
  });

  it("Dado Fábio, quando salva sem mexer em nada, então nada é enviado e o formulário fecha", async () => {
    const onClose = await renderEdit(FABIO);
    const before = { queries: fakeQueries().length, rpcs: fakeRpcs().length };
    clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fakeQueries().length).toBe(before.queries);
    expect(fakeRpcs().length).toBe(before.rpcs);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("Dado Fábio, quando muda só as observações, então o PATCH leva só as observações (nome, celular e nascimento ficam)", async () => {
    await renderEdit(FABIO);
    type("Observações", "conferido");
    respondWith({ data: [{ id: "fabio" }] });
    clickSave();
    await waitFor(() => expect(updateArgs()).toHaveLength(1));
    expect(updateArgs()[0]).toEqual({ notes: "conferido" });
  });
});

describe("UX-23: 'Ver meus dados' (só leitura)", () => {
  it("Dado o cadastro de Fábio só para leitura, então não mostra avisos nem erros e só oferece 'Fechar'", async () => {
    await renderEdit(FABIO, { readOnly: true });
    expect(screen.queryByText(/Complete quando puder|fora do formato|fora do intervalo|não consegue entrar/)).not.toBeInTheDocument();
    expect(document.querySelectorAll("[aria-invalid='true']")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Salvar alterações" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Fechar" }).length).toBeGreaterThan(0);
  });
});

describe("UX-24: e-mail fictício", () => {
  it("Dado um cadastro com e-mail fictício, quando abre, então o E-mail está vazio e nada no DOM contém o domínio fictício", async () => {
    await renderEdit(member({ email: "caio_a1b2c3@mci12fakemail.com" }));
    expect(field("E-mail")).toHaveValue("");
    expect(document.body.innerHTML).not.toContain("mci12fakemail");
    expect(screen.getByText("E-mail")).toBeInTheDocument();
  });

  it("Dado 'lucia@mci12fakemail.com' digitado, quando sai do campo, então a mensagem da RN-05 aparece", async () => {
    await renderNew();
    typeAndLeave("E-mail", "lucia@mci12fakemail.com");
    expect(errorOf("email")).toHaveTextContent("Este e-mail não pode ser usado. Informe um e-mail real ou deixe o campo em branco.");
  });

  it("Dado o cadastro novo sem e-mail, quando cria, então o e-mail vai vazio (null) e o navegador não monta e-mail fictício", async () => {
    await renderNew();
    type("Nome *", "Igor Teixeira");
    fireEvent.click(screen.getByRole("radio", { name: "Masculino" }));
    type("Celular / WhatsApp", "51988887777");
    fireEvent.click(screen.getByRole("switch", { name: "É Pastor(a)?" }));
    invoke.mockResolvedValueOnce({ data: { member: { id: "novo" } }, error: null });
    clickCreate();
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    const body = invoke.mock.calls[0][1].body;
    expect(body.memberData.email).toBeNull();
    expect(JSON.stringify(body)).not.toContain("mci12fakemail");
  });
});

describe("UX-25: envio e queda de conexão", () => {
  async function fillValidNew() {
    await renderNew();
    type("Nome *", "Igor Teixeira");
    fireEvent.click(screen.getByRole("radio", { name: "Masculino" }));
    type("Celular / WhatsApp", "51988887777");
    fireEvent.click(screen.getByRole("switch", { name: "É Pastor(a)?" }));
  }

  it("Dado o envio em andamento, então o botão mostra 'Criando…', os dois botões ficam desabilitados e um duplo toque gera uma chamada só", async () => {
    await fillValidNew();
    let finish: (value: unknown) => void = () => {};
    invoke.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    clickCreate();
    const busy = await screen.findByRole("button", { name: "Criando…" });
    expect(busy).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
    fireEvent.click(busy);
    fireEvent.click(busy);
    expect(invoke).toHaveBeenCalledTimes(1);
    finish({ data: { member: { id: "novo" } }, error: null });
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "Membro criado com sucesso" }));
  });

  it("Dado uma edição em andamento, então o botão mostra 'Salvando…'", async () => {
    await renderEdit();
    type("Observações", "x");
    let finish: (value: unknown) => void = () => {};
    respondWith({ data: [{ id: "caio" }], until: new Promise((resolve) => (finish = resolve)) });
    clickSave();
    expect(await screen.findByRole("button", { name: "Salvando…" })).toBeDisabled();
    finish(undefined);
    await waitFor(() => expect(toast).toHaveBeenCalled());
  });

  it("Dado a queda de conexão, então a mensagem aparece no rodapé (role=alert), os dados ficam e o botão volta e recebe o foco", async () => {
    await fillValidNew();
    invoke.mockResolvedValueOnce({ data: null, error: Object.assign(new Error("Failed to send a request"), { name: "FunctionsFetchError" }) });
    clickCreate();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Não foi possível salvar o cadastro. Verifique a conexão e tente de novo.");
    expect(field("Nome *")).toHaveValue("Igor Teixeira");
    const button = screen.getByRole("button", { name: "Criar membro" });
    expect(button).toBeEnabled();
    await waitFor(() => expect(button).toHaveFocus());
    expect(toast).not.toHaveBeenCalled();
  });
});

describe("Backlog 5 do E2.02: 'Criar membro' enquanto as funções carregam", () => {
  it("Dado o cadastro novo com as funções ainda carregando, então o botão mostra 'Carregando…' desabilitado e depois 'Criar membro'", async () => {
    auth.permissions = new Set(["create_member", "assign_role", "view_all_church"]);
    let release: () => void = () => {};
    const arrived = new Promise<void>((resolve) => (release = resolve));
    respondToRpc("role_options", { data: roleOptions(null), until: arrived });
    render(<MemberForm member={null} onClose={vi.fn()} />, { wrapper });
    expect(screen.getByRole("button", { name: "Carregando…" })).toBeDisabled();
    release();
    expect(await screen.findByRole("button", { name: "Criar membro" })).toBeEnabled();
  });
});

describe("UX-26: descartar as alterações", () => {
  async function openDirty() {
    const onClose = await renderEdit();
    type("Observações", "mudou");
    return onClose;
  }
  const discardDialog = () => screen.findByRole("alertdialog", { name: "Descartar as alterações?" });

  it("Dado um campo alterado, quando 'Cancelar', então pede 'Descartar as alterações?' com o foco em 'Continuar editando' e o formulário não fecha", async () => {
    const onClose = await openDirty();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    const dialog = await discardDialog();
    expect(within(dialog).getByText("O que você digitou não será salvo.")).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Continuar editando" })).toHaveFocus());
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Continuar editando" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(field("Observações")).toHaveValue("mudou");
  });

  it("Dado um campo alterado, quando '✕' ou Esc, então pede a confirmação também", async () => {
    const onClose = await openDirty();
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(await discardDialog()).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continuar editando" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());

    fireEvent.keyDown(field("Observações"), { key: "Escape" });
    expect(await discardDialog()).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Dado 'Descartar', então o formulário fecha", async () => {
    const onClose = await openDirty();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(within(await discardDialog()).getByRole("button", { name: "Descartar" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("Dado nenhuma alteração, quando 'Cancelar', '✕' ou Esc, então fecha direto", async () => {
    const onClose = await renderEdit();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("Dado o cadastro novo com o Nome digitado, quando 'Cancelar', então pede a confirmação", async () => {
    const onClose = await renderNew();
    type("Nome *", "Igor");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(await discardDialog()).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("UX-27: mensagens em text-foreground, com ícone, sem text-destructive", () => {
  const hasIcon = (message: HTMLElement | null) => message?.querySelector("svg[aria-hidden='true']") != null;

  it("Dado os erros de campo (Nome, Sexo, Identificação, Líder), então o texto usa text-foreground, tem ícone e o campo tem aria-invalid", async () => {
    await renderNew();
    clearLeader();
    clickCreate();
    await screen.findByText("Informe o nome e o sobrenome.");
    for (const id of ["name", "gender", "identification", "leader"]) {
      const message = errorOf(id);
      expect(message, id).toHaveClass("text-foreground");
      expect(message?.className, id).not.toContain("text-destructive");
      expect(hasIcon(message), `${id}: ícone`).toBe(true);
    }
    expect(field("Nome *")).toHaveAttribute("aria-invalid", "true");
  });

  it("Dado os avisos de dado antigo de Fábio, então o texto usa text-foreground, tem ícone e o campo não tem aria-invalid", async () => {
    await renderEdit(FABIO);
    for (const id of ["name-warning", "birth_date-warning", "mobile_whatsapp-warning", "identification-warning"]) {
      const warning = document.getElementById(id);
      expect(warning, id).not.toBeNull();
      expect(warning).toHaveClass("text-foreground");
      expect(warning?.className).not.toContain("text-destructive");
      expect(hasIcon(warning), `${id}: ícone`).toBe(true);
    }
    expect(document.querySelectorAll("[aria-invalid='true']")).toHaveLength(0);
  });

  it("Dado o aviso de interruptor (P20), então é um status com texto em text-foreground e ícone", async () => {
    await renderEdit();
    fireEvent.click(screen.getByRole("switch", { name: "É Pastor(a)?" }));
    const notice = screen.getByText("Ao salvar, André Souza deixa de ser o líder.");
    const status = notice.closest("[role='status']");
    expect(status).not.toBeNull();
    expect(status).toHaveClass("text-foreground");
    expect(hasIcon(status as HTMLElement)).toBe(true);
  });
});

describe("UX-30: nenhuma mensagem técnica", () => {
  const TECHNICAL = /22023|23505|23514|42501|40P01|duplicate key|violates|constraint|trigger|members_[a-z_]*_key|row-level|policy|deadlock|\bfunction\b|app_error/i;

  it.each([
    ["23505 cru de índice único", { code: "23505", message: 'duplicate key value violates unique constraint "members_cpf_key"', details: "Key (cpf)=(x) already exists." }],
    ["23514 cru de CHECK", { code: "23514", message: 'new row for relation "members" violates check constraint "members_name_check"' }],
    ["22023 sem a marca app_error", { code: "22023", message: "invalid input value for enum permission_action: trigger ab_enforce_member_links" }],
    ["40P01", { code: "40P01", message: "deadlock detected" }],
  ])("Dado %s, então nenhum texto técnico aparece na tela", async (_name, error) => {
    await renderEdit();
    type("Observações", "x");
    refuseUpdate(error);
    clickSave();
    await waitFor(() => expect(document.body.textContent).toMatch(/Não foi possível salvar|Este .* já está sendo usado|Confira|não tem permissão/));
    expect(document.body.textContent ?? "").not.toMatch(TECHNICAL);
  });

  it("Dado a recusa 42501, então 'Você não tem permissão para esta ação.' no Alert do topo, sem código técnico", async () => {
    await renderEdit();
    type("Observações", "x");
    refuseUpdate({ code: "42501", message: 'new row violates row-level security policy for table "members"' });
    clickSave();
    expect(await screen.findByRole("alert")).toHaveTextContent("Você não tem permissão para esta ação.");
    expect(document.body.textContent ?? "").not.toMatch(TECHNICAL);
  });

  it("Dado a recusa 409 value_in_use da create-user-admin, então a mensagem vai ao campo, sem texto técnico", async () => {
    await renderNew();
    type("Nome *", "Igor Teixeira");
    fireEvent.click(screen.getByRole("radio", { name: "Masculino" }));
    type("Celular / WhatsApp", "51988887777");
    fireEvent.click(screen.getByRole("switch", { name: "É Pastor(a)?" }));
    createRefusal(409, { error: "Este celular já está sendo usado por outro cadastro.", code: "value_in_use", fields: ["mobile"] });
    clickCreate();
    expect(await screen.findByText("Este celular já está sendo usado por outro cadastro.")).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(TECHNICAL);
  });
});

describe("Critérios de pronto da Tarefa 9", () => {
  it("Dado o cadastro novo de quem vê a igreja toda, então 'Tem Liderança?' vem ligado e o Líder vazio", async () => {
    await renderNew();
    expect(screen.getByRole("switch", { name: "Tem Liderança?" })).toBeChecked();
    expect(field("Líder *")).toHaveValue("");
  });

  it("Dado uma edição sem mudança, quando salva, então nenhuma requisição sai e o formulário fecha", async () => {
    const onClose = await renderEdit();
    const before = { queries: fakeQueries().length, rpcs: fakeRpcs().length };
    clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fakeQueries().length).toBe(before.queries);
    expect(fakeRpcs().length).toBe(before.rpcs);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("Dado a edição de vários campos, então o PATCH leva só os campos alterados (Nome, Instagram e CPF) e nenhum dos que não mudaram", async () => {
    await renderEdit();
    type("Nome *", "Caio Lima Jr");
    typeAndLeave("CPF", "52998224725");
    type("Instagram (@)", "caiolima");
    respondWith({ data: [{ id: "caio" }] });
    clickSave();
    await waitFor(() => expect(updateArgs()).toHaveLength(1));
    expect(updateArgs()[0]).toEqual({ name: "Caio Lima Jr", cpf: "52998224725", instagram: "@caiolima" });
  });

  it("Dado Caio com celular e CPF gravados, quando abre a edição, então os dois aparecem mascarados", async () => {
    await renderEdit(member({ mobile_whatsapp: "51988887777", cpf: "52998224725" }));
    expect(field("Celular / WhatsApp")).toHaveValue("(51) 98888-7777");
    expect(field("CPF")).toHaveValue("529.982.247-25");
  });
});

describe("P20: interruptores que apagam outro campo", () => {
  it("Dado Caio (líder André), quando desliga 'Tem Liderança?', então o aviso cita André e religar devolve o líder", async () => {
    await renderEdit();
    fireEvent.click(screen.getByRole("switch", { name: "Tem Liderança?" }));
    const notice = screen.getByText("Ao salvar, André Souza deixa de ser o líder. A pessoa fica sem liderança.");
    expect(notice.closest("[role='status']")).not.toBeNull();
    expect(screen.queryByLabelText("Líder *")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Tem Liderança?" }));
    expect(field("Líder *")).toBeInTheDocument();
    expect(screen.queryByText(/deixa de ser o líder/)).not.toBeInTheDocument();
  });

  it("Dado 'Batizado(a)?' com data, quando desliga, então o aviso cita a data (dd/MM/aaaa) e religar devolve a data", async () => {
    await renderEdit(member({ is_baptized: true, baptism_date: "2020-05-10" }));
    fireEvent.click(screen.getByRole("switch", { name: "Batizado(a)?" }));
    expect(screen.getByText("Ao salvar, a data do batismo (10/05/2020) será apagada.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Batizado(a)?" }));
    expect(field("Data do batismo")).toHaveValue("2020-05-10");
  });
});
