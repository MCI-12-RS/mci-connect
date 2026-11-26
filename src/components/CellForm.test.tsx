import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeQueries, fakeRpcs, resetFakeSupabase, respondToRpc, respondWith, type FakeResponse } from "@/test/fake-supabase";
import type { CellRow } from "@/lib/cells/fields";
import type { Access } from "@/lib/access/access";
import CellForm from "./CellForm";

// O formulário de célula (E2.08, T1 a T6; UX-02 a UX-12, UX-16 a UX-20, UX-24,
// UX-25, UX-29, UX-30), com o seletor e o diálogo de verdade. O banco é o
// cliente falso (uma fila de respostas, na ordem das consultas).

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

const auth = vi.hoisted(() => ({ access: null as import("@/lib/access/access").Access | null }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ access: auth.access }) }));

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

const c1: CellRow = {
  id: "c1",
  leader_id: "andre",
  timothy_id: "caio",
  host_id: "carla",
  type: "Evangelística",
  meeting_day: "Quarta",
  meeting_time: "20:00:00",
  street: "Rua das Flores",
  number: "100",
  complement: "ap. 2",
  neighborhood: "Centro",
  city: "Porto Alegre",
  state: "RS",
  zip_code: "90010000",
  is_active: true,
  leader_name: "André Souza",
  leader_g12_level: 2,
  leader_is_pastor: false,
  leader_gender: "M",
  timothy_name: "Caio Lima",
  host_name: "Carla Dias",
  g12_leader_name: "Pedro Alves",
  can_submit_report: true,
};

const ministryAccess: Access = {
  member_id: "m-pedro",
  role_id: "r-lider",
  role_name: "Líder",
  role_is_protected: false,
  permissions: ["view_own_ministry", "edit_cell", "create_cell"],
  sees_whole_church: false,
  sees_ministry: true,
  sees_whole_church_reports: false,
  sees_ministry_reports: true,
  can_create_member: false,
  can_assign_roles: false,
  can_submit_some_report: true,
};

const CARLA_ADDRESS = {
  street: "Rua das Flores",
  number: "100",
  complement: "ap. 2",
  neighborhood: "Centro",
  city: "Porto Alegre",
  state: "RS",
  zip_code: "90010-000",
  sensitive_visible: true,
};
const FABIO_ADDRESS = {
  street: "Av. Ipiranga",
  number: "5",
  complement: null,
  neighborhood: "Azenha",
  city: "Porto Alegre",
  state: "RS",
  zip_code: "90160-000",
  sensitive_visible: true,
};

/** A célula sendo editada: a fila começa pela leitura da situação das três pessoas (P63). */
function renderForm(cell: CellRow | null, { statuses = [] as unknown[] } = {}) {
  optionsServed = false;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const onClose = vi.fn();
  if (cell) respondWith({ data: statuses });
  render(
    <QueryClientProvider client={client}>
      <CellForm cell={cell} onClose={onClose} />
    </QueryClientProvider>,
  );
  const invalidatedKeys = () => invalidate.mock.calls.map(([filters]) => filters?.queryKey);
  return { onClose, invalidatedKeys };
}

const dialog = () => screen.getByRole("dialog");
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const cellsWrites = () => fakeQueries().filter((query) => query.table === "cells");

/** O `<select>` escondido do Select do Radix (dentro de um `form`): escolhe o valor como a pessoa faria. */
function chooseInSelect(label: string, value: string) {
  const trigger = screen.getByRole("combobox", { name: label });
  const native = trigger.parentElement?.querySelector("select");
  if (!native) throw new Error(`sem o select nativo de ${label}`);
  fireEvent.change(native, { target: { value } });
}

/** As pessoas que o seletor oferece (uma página só, a mesma para os três papéis). */
const PEOPLE = [
  { id: "andre", name: "André Souza", is_active: true, gender: "M" },
  { id: "caio", name: "Caio Lima", is_active: true, gender: "M" },
  { id: "carla", name: "Carla Dias", is_active: true, gender: "F" },
  { id: "fabio", name: "Fábio Lima", is_active: true, gender: "M" },
  { id: "rita", name: "Rita Reis", is_active: false, gender: "F" },
];

// As opções ficam no cache do formulário: só a primeira abertura de um seletor as pede.
let optionsServed = false;

/**
 * Abre o seletor de pessoa e escolhe a opção. A fila responde às opções (na
 * primeira abertura) e, no Anfitrião, depois delas, à leitura do endereço (`address`).
 */
async function pickPerson(inputId: string, name: string, address?: FakeResponse) {
  const next: FakeResponse[] = [];
  if (!optionsServed) next.push({ data: PEOPLE });
  optionsServed = true;
  if (address) next.push(address);
  respondWith(...next);
  const input = document.getElementById(inputId);
  if (!input) throw new Error(inputId);
  fireEvent.focus(input);
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name }));
}

async function fillNewCell() {
  await pickPerson("leader_id", "André Souza");
  await pickPerson("timothy_id", "Caio Lima");
  // O anfitrião sem endereço: o endereço não muda.
  await pickPerson("host_id", "André Souza", { data: null });
  await screen.findByText("O endereço do anfitrião não está disponível. Preencha o endereço da célula.");
  chooseInSelect("Dia da semana *", "Quarta");
  fireEvent.change(screen.getByLabelText("Horário *"), { target: { value: "2000" } });
}

beforeEach(() => {
  resetFakeSupabase();
  toast.mockClear();
  auth.access = null;
});

describe("CellForm: estrutura e textos (UX-02, UX-03, UX-04, UX-30)", () => {
  it("célula nova: os três grupos na ordem, sem dia e sem horário, Evangelística, sem 'Célula ativa'", () => {
    renderForm(null);
    expect(screen.getByRole("dialog", { name: "Nova célula" })).toBeInTheDocument();
    expect(screen.getAllByRole("group").map((group) => group.querySelector("legend")?.textContent)).toEqual([
      "Pessoas da célula",
      "Reunião",
      "Endereço da célula",
    ]);
    expect(screen.getByText("Campos com * são obrigatórios.")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Tipo *" })).toHaveTextContent("Evangelística");
    expect(screen.getByRole("combobox", { name: "Dia da semana *" })).toHaveTextContent("Escolha o dia");
    expect(screen.getByLabelText("Horário *")).toHaveValue("");
    expect(screen.queryByText("Célula ativa")).not.toBeInTheDocument();
    expect(button("Criar célula")).toBeInTheDocument();
    for (const forbidden of ["Auxiliar", "Modalidade", "Nova Célula", "Editar Célula", "Criar Célula", "Célula Ativa", "Dia da Semana", "Endereço da Célula"]) {
      expect(dialog().textContent).not.toContain(forbidden);
    }
  });

  it("UX-30: o formulário tem noValidate e o endereço tem autoComplete='off'", () => {
    renderForm(null);
    expect(dialog().querySelector("form")).toHaveAttribute("novalidate");
    for (const label of ["CEP", "Rua", "Número", "Complemento", "Bairro", "Cidade"]) {
      expect(screen.getByLabelText(label)).toHaveAttribute("autocomplete", "off");
    }
  });

  it("UX-04 e UX-10: salvar vazio mostra os 5 erros, o resumo e o foco no Líder, sem requisição; de novo, o foco vai ao seguinte", async () => {
    renderForm(null);
    fireEvent.click(button("Criar célula"));

    for (const message of ["Escolha o líder da célula.", "Escolha o timóteo da célula.", "Escolha o anfitrião da célula.", "Escolha o dia da semana.", "Informe o horário."]) {
      expect(await screen.findByText(message)).toBeInTheDocument();
    }
    const summary = screen.getByText("Confira os campos destacados (5).");
    expect(summary.closest("[role=status]")).not.toBeNull();
    await waitFor(() => expect(document.getElementById("leader_id")).toHaveFocus());
    expect(document.getElementById("leader_id")).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById("leader_id")?.getAttribute("aria-describedby")).toContain("leader_id-error");
    expect(cellsWrites()).toHaveLength(0);

    fireEvent.click(button("Criar célula"));
    await waitFor(() => expect(document.getElementById("timothy_id")).toHaveFocus());

    // O erro some assim que o valor fica certo, e o resumo diminui.
    fireEvent.change(screen.getByLabelText("Horário *"), { target: { value: "2000" } });
    await waitFor(() => expect(screen.queryByText("Informe o horário.")).not.toBeInTheDocument());
    expect(screen.getByText("Confira os campos destacados (4).")).toBeInTheDocument();
  });
});

describe("CellForm: pessoas (UX-05, UX-06, UX-07)", () => {
  it("dicas entre o rótulo e o campo, no aria-describedby; a dica de alcance para Pedro; obrigatórios sem 'Limpar'", async () => {
    auth.access = ministryAccess;
    renderForm(c1);
    const scope = screen.getByText("Líder, timóteo e anfitrião são escolhidos entre as pessoas do seu ministério.");
    const timothy = document.getElementById("timothy_id");
    const timothyHint = screen.getByText("Auxilia o líder e está em formação para liderar.");
    expect(timothy?.getAttribute("aria-describedby")).toBe(`${timothyHint.id} ${scope.id}`);
    expect(document.getElementById("host_id")?.getAttribute("aria-describedby")).toBe(
      `${screen.getByText("Quem recebe a célula em casa.").id} ${scope.id}`,
    );
    for (const id of ["leader_id", "timothy_id", "host_id"]) {
      expect(document.getElementById(id)).toHaveAttribute("aria-required", "true");
    }
    await screen.findByText("André Souza");
    expect(screen.queryByRole("button", { name: "Limpar seleção" })).not.toBeInTheDocument();
  });

  it("UX-07: na edição, quem está gravado inativo aparece com a marca; fora do escopo, só o nome", async () => {
    renderForm(c1, {
      statuses: [
        { id: "andre", is_active: true, gender: "M" },
        { id: "caio", is_active: false, gender: "M" },
      ],
    });
    expect(await screen.findByText("Caio Lima (inativo)")).toBeInTheDocument();
    expect(screen.getByText("André Souza")).toBeInTheDocument();
    // Carla não voltou na leitura (fora do escopo): só o nome.
    expect(screen.getByText("Carla Dias")).toBeInTheDocument();
    const statuses = fakeQueries().find((query) => query.table === "members_view");
    expect(statuses?.calls).toContainEqual(["select", "id, is_active, gender"]);
  });

  it("UX-07: nas opções, a pessoa inativa tem a marca pelo sexo e pode ser escolhida", async () => {
    renderForm(null);
    await pickPerson("timothy_id", "Rita Reis (inativa)");
    expect(screen.getByText("Rita Reis (inativa)")).toBeInTheDocument();
  });
});

describe("CellForm: reunião (UX-08, UX-09, UX-19)", () => {
  it("UX-08: horário digitado com máscara; ao sair do campo '20' vira '20:00'; '1960' mostra o erro só ao sair", () => {
    renderForm(null);
    const time = screen.getByLabelText("Horário *");
    expect(time).toHaveAttribute("type", "text");
    expect(time).toHaveAttribute("inputmode", "numeric");
    expect(time).toHaveAttribute("autocomplete", "off");
    expect(time).toHaveAttribute("placeholder", "00:00");
    expect(time).toHaveAttribute("maxlength", "5");

    fireEvent.change(time, { target: { value: "20" } });
    expect(time).toHaveValue("20:");
    fireEvent.blur(time);
    expect(time).toHaveValue("20:00");

    fireEvent.change(time, { target: { value: "1960" } });
    expect(time).toHaveValue("19:60");
    expect(screen.queryByText(/Horário inválido/)).not.toBeInTheDocument();
    fireEvent.blur(time);
    expect(screen.getByText("Horário inválido. Informe a hora e os minutos, entre 00:00 e 23:59.")).toBeInTheDocument();
    expect(cellsWrites()).toHaveLength(0);
  });

  it("UX-08 e UX-20: na edição, '20:00:00' aparece como '20:00', o dia por extenso, e salvar sem mudança não chama o servidor", async () => {
    const { onClose } = renderForm(c1);
    expect(screen.getByLabelText("Horário *")).toHaveValue("20:00");
    expect(screen.getByRole("combobox", { name: "Dia da semana *" })).toHaveTextContent("Quarta-feira");
    fireEvent.click(button("Salvar alterações"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith({ title: "Nenhuma alteração para salvar." });
    expect(cellsWrites()).toHaveLength(0);
  });

  it("UX-09: escolher 'Quarta-feira' envia 'Quarta'; o cadastro sai com o id da abertura e sem is_active", async () => {
    const { onClose } = renderForm(null);
    await fillNewCell();
    respondWith({ data: null });
    fireEvent.click(button("Criar célula"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const insert = cellsWrites()[0].calls.find(([method]) => method === "insert")?.[1];
    expect(insert).toMatchObject({ meeting_day: "Quarta", meeting_time: "20:00", leader_id: "andre", timothy_id: "caio", host_id: "andre" });
    expect(insert).toHaveProperty("id");
    expect(insert).not.toHaveProperty("is_active");
    expect(cellsWrites()[0].calls.some(([method]) => method === "select")).toBe(false);
    expect(toast).toHaveBeenCalledWith({ title: "Célula criada." });
  });

  it("UX-19: 'Célula ativa' só na edição, a dica pela situação gravada e o aviso do P60, que some ao voltar", () => {
    renderForm(c1);
    const toggle = screen.getByRole("switch", { name: "Célula ativa" });
    expect(screen.getByText(/^Desligue quando a célula parar de se reunir/)).toBeInTheDocument();
    fireEvent.click(toggle);
    const notice = screen.getByText("Ao salvar, a célula fica inativa. Os relatórios que ela já tem continuam.");
    expect(notice.closest("[role=status]")).not.toBeNull();
    fireEvent.click(toggle);
    expect(screen.queryByText(/Ao salvar, a célula fica inativa/)).not.toBeInTheDocument();
  });

  it("UX-19: a célula gravada inativa tem o badge 'Inativa' no cabeçalho e a dica de religar", () => {
    renderForm({ ...c1, is_active: false });
    expect(screen.getByRole("dialog", { name: /^Editar célula/ })).toHaveTextContent("Inativa");
    expect(screen.getByText(/^Ligue quando a célula voltar a se reunir/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Célula ativa" }));
    expect(screen.getByText("Ao salvar, a célula volta aos totais e a receber relatórios a partir desta semana.")).toBeInTheDocument();
  });

  it("UX-20: inativar mudando também o horário dá 'Célula inativada.', e o PATCH leva só o que mudou", async () => {
    const { onClose } = renderForm(c1);
    fireEvent.click(screen.getByRole("switch", { name: "Célula ativa" }));
    fireEvent.change(screen.getByLabelText("Horário *"), { target: { value: "1930" } });
    respondWith({ data: [{ id: "c1" }] });
    fireEvent.click(button("Salvar alterações"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const update = cellsWrites()[0];
    expect(update.calls.find(([method]) => method === "update")?.[1]).toEqual({ meeting_time: "19:30", is_active: false });
    expect(update.calls).toContainEqual(["select", "id"]);
    expect(toast).toHaveBeenCalledWith({ title: "Célula inativada." });
  });
});

describe("CellForm: endereço do anfitrião (UX-13 a UX-17)", () => {
  it("UX-16: mudar só o horário não consulta o endereço de ninguém", async () => {
    renderForm(c1);
    fireEvent.change(screen.getByLabelText("Horário *"), { target: { value: "1930" } });
    respondWith({ data: [{ id: "c1" }] });
    fireEvent.click(button("Salvar alterações"));
    await waitFor(() => expect(cellsWrites()).toHaveLength(1));
    const addressReads = fakeQueries().filter((query) => query.calls.some(([, columns]) => typeof columns === "string" && columns.includes("sensitive_visible")));
    expect(addressReads).toHaveLength(0);
    expect(cellsWrites()[0].calls.find(([method]) => method === "update")?.[1]).toEqual({ meeting_time: "19:30" });
  });

  it("UX-16: escolher Fábio e logo depois Carla deixa o endereço de Carla, mesmo com a resposta de Fábio chegando depois", async () => {
    renderForm(c1);
    let releaseFabio: () => void = () => {};
    const fabioLate: FakeResponse = { data: FABIO_ADDRESS, until: new Promise<void>((resolve) => (releaseFabio = resolve)) };
    await pickPerson("host_id", "Fábio Lima", fabioLate);
    await pickPerson("host_id", "Carla Dias", { data: CARLA_ADDRESS });
    await screen.findByText("Endereço preenchido com o do anfitrião.");
    await act(async () => releaseFabio());
    expect(screen.getByLabelText("Rua")).toHaveValue("Rua das Flores");
    expect(screen.getByLabelText("Número")).toHaveValue("100");
  });

  it("UX-14: sem os dados sensíveis, bairro, cidade e estado vêm de Carla; CEP, rua e número ficam vazios; 'Ir para o endereço' leva ao CEP", async () => {
    renderForm(null);
    fireEvent.change(screen.getByLabelText("Rua"), { target: { value: "Rua A" } });
    await pickPerson("host_id", "Carla Dias", {
      data: { ...CARLA_ADDRESS, street: null, number: null, complement: null, zip_code: null, sensitive_visible: false },
    });
    const notice = await screen.findByText("Bairro, cidade e estado preenchidos com os do anfitrião. Complete o CEP, a rua e o número.");
    expect(notice.closest("[role=status]")?.id).toBe("host_id-address");
    expect(document.getElementById("host_id")?.getAttribute("aria-describedby")).toContain("host_id-address");
    expect(screen.getByLabelText("Rua")).toHaveValue("");
    expect(screen.getByLabelText("Bairro")).toHaveValue("Centro");
    expect(toast).not.toHaveBeenCalled();
    fireEvent.click(button("Ir para o endereço"));
    expect(screen.getByLabelText("CEP")).toHaveFocus();
  });

  it("UX-17: 'Buscando o endereço do anfitrião…' e, na falha, o aviso com 'Tentar de novo', sem mudar o endereço", async () => {
    renderForm(null);
    let fail: () => void = () => {};
    await pickPerson("host_id", "Carla Dias", {
      error: { code: "", message: "TypeError: Failed to fetch" },
      until: new Promise<void>((resolve) => (fail = resolve)),
    });
    expect(await screen.findByText("Buscando o endereço do anfitrião…")).toBeInTheDocument();
    await act(async () => fail());
    expect(await screen.findByText("Não foi possível carregar o endereço do anfitrião.")).toBeInTheDocument();
    expect(screen.getByLabelText("Rua")).toHaveValue("");
    respondWith({ data: CARLA_ADDRESS });
    fireEvent.click(button("Tentar de novo"));
    await screen.findByText("Endereço preenchido com o do anfitrião.");
    expect(screen.getByLabelText("Rua")).toHaveValue("Rua das Flores");
  });

  it("UX-18: o CEP que vem do anfitrião não dispara a busca do CEP", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    renderForm(null);
    await pickPerson("host_id", "Carla Dias", { data: CARLA_ADDRESS });
    await screen.findByText("Endereço preenchido com o do anfitrião.");
    expect(screen.getByLabelText("CEP")).toHaveValue("90010-000");
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("CellForm: recusas do servidor (UX-11, UX-12)", () => {
  const appError = (code: string, message: string, detail: Record<string, unknown> = {}) => ({
    error: { code: "22023", message, details: JSON.stringify({ code, ...detail }), hint: "app_error" },
  });

  async function saveEditWith(response: FakeResponse) {
    const rendered = renderForm(c1);
    fireEvent.change(screen.getByLabelText("Bairro"), { target: { value: "Bairro Novo" } });
    respondWith(response);
    fireEvent.click(button("Salvar alterações"));
    await waitFor(() => expect(cellsWrites()).toHaveLength(1));
    return rendered;
  }

  it("pessoa excluída no meio tempo: embaixo do Timóteo, no resumo e com o foco", async () => {
    await saveEditWith(appError("deleted_member_chosen", "Este membro foi excluído e não pode ser escolhido.", { field: "timothy_id", member_id: "caio" }));
    expect((await screen.findByText("Este membro foi excluído e não pode ser escolhido.")).closest("p")).toHaveAttribute("id", "timothy_id-error");
    expect(screen.getByText("Confira os campos destacados (1).")).toBeInTheDocument();
    await waitFor(() => expect(document.getElementById("timothy_id")).toHaveFocus());
    expect(toast).not.toHaveBeenCalled();
  });

  it("célula que sairia do escopo: no Alert do topo, com o foco, sem toast e sem fechar", async () => {
    const message =
      "Com esta alteração, você deixaria de ver esta célula. Mantenha pelo menos uma pessoa do seu ministério como líder, timóteo ou anfitrião. As alterações não foram salvas.";
    const { onClose } = await saveEditWith(appError("would_leave_scope", message, { entity: "cell" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(message);
    await waitFor(() => expect(alert).toHaveFocus());
    expect(button("Salvar alterações")).toBeEnabled();
    expect(onClose).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("célula excluída no meio tempo ('0 linhas'): o Alert com 'Fechar', a ação desabilitada e a lista recarregada", async () => {
    const { onClose, invalidatedKeys } = await saveEditWith({ data: [] });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Esta célula não existe ou já foi excluída. As alterações não foram salvas.");
    expect(button("Salvar alterações")).toBeDisabled();
    expect(invalidatedKeys()).toContainEqual(["cells", "list"]);
    fireEvent.click(within(alert).getByRole("button", { name: "Fechar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("42501: 'Você não tem permissão para esta ação.' no topo, e o acesso relido", async () => {
    const { invalidatedKeys } = await saveEditWith({ error: { code: "42501", message: "permission denied for table cells" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Você não tem permissão para esta ação.");
    expect(invalidatedKeys()).toContainEqual(["access"]);
  });

  it("UX-12 e pendência do PR 2: tipo, dia e horário inválidos aparecem no campo, em pt-BR, sem texto técnico", async () => {
    await saveEditWith({ error: { code: "23514", message: 'new row for relation "cells" violates check constraint "cells_type_check"' } });
    expect(await screen.findByText("Tipo de célula inválido. Escolha Evangelística, Discipulado ou Macrocélula.")).toBeInTheDocument();
    expect(dialog().textContent).not.toMatch(/23514|cells_type_check|violates|relation/);
  });

  it("queda de conexão: a mensagem no rodapé com role='alert', os dados ficam e o foco volta à ação primária", async () => {
    await saveEditWith({ error: { code: "", message: "TypeError: Failed to fetch" } });
    const message = await screen.findByText("Não foi possível salvar a célula. Verifique a conexão e tente de novo.");
    expect(message.closest("[role=alert]")).not.toBeNull();
    await waitFor(() => expect(button("Salvar alterações")).toHaveFocus());
    expect(screen.getByLabelText("Bairro")).toHaveValue("Bairro Novo");
  });
});

describe("CellForm: cadastro idempotente (DT-09, AQ-3)", () => {
  it("depois de uma queda de conexão, a nova tentativa confere a célula na cells_view e não grava de novo", async () => {
    const { onClose } = renderForm(null);
    await fillNewCell();
    respondWith({ error: { code: "", message: "TypeError: Failed to fetch" } });
    fireEvent.click(button("Criar célula"));
    await screen.findByText("Não foi possível salvar a célula. Verifique a conexão e tente de novo.");
    const id = cellsWrites()[0].calls.find(([method]) => method === "insert")?.[1];
    respondWith({ data: { id: "achou" } });
    fireEvent.click(button("Criar célula"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(cellsWrites()).toHaveLength(1);
    const check = fakeQueries().filter((query) => query.table === "cells_view").at(-1);
    expect(check?.calls).toContainEqual(["eq", "id", (id as { id: string }).id]);
    expect(toast).toHaveBeenCalledWith({ title: "Célula criada." });
  });

  it("o 23505 em cells_pkey vale como sucesso", async () => {
    const { onClose } = renderForm(null);
    await fillNewCell();
    respondWith({ error: { code: "23505", message: 'duplicate key value violates unique constraint "cells_pkey"' } });
    fireEvent.click(button("Criar célula"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith({ title: "Célula criada." });
  });
});

describe("CellForm: fechar com alterações (UX-25)", () => {
  it("sem alteração, 'Cancelar' fecha direto; com o anfitrião trocado, pede 'Descartar as alterações?'", async () => {
    const { onClose } = renderForm(c1);
    fireEvent.click(button("Cancelar"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("trocar só o anfitrião conta como alteração; o foco fica em 'Continuar editando'", async () => {
    const { onClose } = renderForm(c1);
    await pickPerson("host_id", "Fábio Lima", { data: FABIO_ADDRESS });
    await screen.findByText("Endereço preenchido com o do anfitrião.");
    fireEvent.click(button("Cancelar"));
    const confirm = await screen.findByRole("alertdialog", { name: "Descartar as alterações?" });
    expect(within(confirm).getByText("O que você digitou não será salvo.")).toBeInTheDocument();
    await waitFor(() => expect(within(confirm).getByRole("button", { name: "Continuar editando" })).toHaveFocus());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("nomes salvos fora do escopo continuam pelo nome da cells_view, sem a member_names (DT-23)", async () => {
    respondToRpc("member_names", { data: [] }, { data: [] }, { data: [] });
    renderForm(c1);
    expect(await screen.findByText("André Souza")).toBeInTheDocument();
    expect(screen.getByText("Caio Lima")).toBeInTheDocument();
    expect(fakeRpcs().some((call) => call.fn === "member_names")).toBe(false);
  });
});

afterEach(() => vi.unstubAllGlobals());

