import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { createQueryWrapper } from "@/test/query-wrapper";
import { fakeQueries, resetFakeSupabase, respondToRpc, respondWith } from "@/test/fake-supabase";
import AsyncMemberSelect from "./AsyncMemberSelect";

// Seletor de membro com busca e paginação no servidor (E1.08, RN-07), pelo
// PaginatedSelect. O usuário vê 20 opções por vez e o item "Carregar mais".

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

const LABEL = "Cônjuge";

/** Linhas da members_view: "Membro 000", "Membro 001"… em ordem alfabética. */
const members = (count: number, start = 0) =>
  Array.from({ length: count }, (_, i) => {
    const n = String(start + i).padStart(3, "0");
    return { id: `m${n}`, name: `Membro ${n}` };
  });
const failure = { error: { code: "08006", message: "connection failure" } };

function renderSelect(value: string | null = null) {
  const onChange = vi.fn();
  render(
    <>
      <label htmlFor="spouse">{LABEL}</label>
      <AsyncMemberSelect inputId="spouse" value={value} onChange={onChange} excludeId="m-self" />
    </>,
    { wrapper: createQueryWrapper() },
  );
  return { onChange, input: screen.getByLabelText(LABEL) };
}

/** O que o react-select anuncia sobre os resultados (região "log" do leitor de tela). */
const announcedResults = () => document.getElementById("aria-results")?.textContent;
/** O anúncio do menu vazio, na região de status do seletor. */
const emptyStatus = () => screen.getByRole("status").textContent;

function openMenu(input: HTMLElement) {
  fireEvent.focus(input);
  fireEvent.keyDown(input, { key: "ArrowDown" });
}

/** As opções de membro exibidas (sem os itens de ação). */
function memberOptions() {
  return screen.queryAllByRole("option").filter((option) => /^Membro \d{3}$/.test(option.textContent ?? ""));
}

const loadMoreOption = () => screen.getByRole("option", { name: "Carregar mais" });

describe("AsyncMemberSelect / PaginatedSelect (RN-07)", () => {
  beforeEach(() => resetFakeSupabase());

  it("Dado o seletor fechado, então nada é consultado", () => {
    renderSelect();

    expect(fakeQueries()).toHaveLength(0);
  });

  it("Dadas 21 linhas na primeira página, quando abre o seletor, então mostra 20 opções e o item Carregar mais", async () => {
    respondWith({ data: members(21) });
    const { input } = renderSelect();

    openMenu(input);

    await waitFor(() => expect(memberOptions()).toHaveLength(20));
    expect(screen.queryByText("Membro 020")).not.toBeInTheDocument();
    expect(loadMoreOption()).toBeInTheDocument();
    // A consulta: members_view, em ordem de nome e id, pedindo 21 linhas, sem o próprio membro.
    const [query] = fakeQueries();
    expect(query.table).toBe("members_view");
    expect(query.calls).toEqual([
      ["select", "id, name"],
      ["neq", "id", "m-self"],
      ["order", "name"],
      ["order", "id"],
      ["range", 0, 20],
    ]);
  });

  it("Dado o foco no item Carregar mais, quando aperta Enter, então pede a página seguinte (offset 20) e as opções crescem sem repetir", async () => {
    respondWith({ data: members(21) }, { data: members(5, 20) });
    const { input } = renderSelect();
    openMenu(input);
    await waitFor(() => expect(memberOptions()).toHaveLength(20));

    // Da primeira opção, a seta para cima vai ao último item: o Carregar mais.
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input).toHaveAttribute("aria-activedescendant", loadMoreOption().id);
    expect(fakeQueries()).toHaveLength(1);

    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(memberOptions()).toHaveLength(25));
    expect(fakeQueries()).toHaveLength(2);
    expect(fakeQueries()[1].calls).toContainEqual(["range", 20, 40]);
    const labels = memberOptions().map((option) => option.textContent);
    expect(new Set(labels).size).toBe(25);
    expect(labels[0]).toBe("Membro 000");
    expect(labels[24]).toBe("Membro 024");
    // Acabou: sem o item de carregar mais.
    expect(screen.queryByRole("option", { name: "Carregar mais" })).not.toBeInTheDocument();
  });

  it("Dado o item Carregar mais, quando é clicado, então pede a página seguinte, sem escolher nada", async () => {
    respondWith({ data: members(21) }, { data: members(21, 20) });
    const { input, onChange } = renderSelect();
    openMenu(input);
    await waitFor(() => expect(memberOptions()).toHaveLength(20));

    fireEvent.click(loadMoreOption());

    await waitFor(() => expect(memberOptions()).toHaveLength(40));
    expect(fakeQueries()[1].calls).toContainEqual(["range", 20, 40]);
    expect(new Set(memberOptions().map((option) => option.textContent)).size).toBe(40);
    // Ainda há mais: o item continua no fim.
    expect(loadMoreOption()).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Dado o foco chegando às 3 últimas opções, então a página seguinte já é pedida, uma vez só", async () => {
    respondWith({ data: members(21) }, { data: members(3, 20) });
    const { input } = renderSelect();
    openMenu(input);
    await waitFor(() => expect(memberOptions()).toHaveLength(20));

    // Da 1ª à 17ª opção: nada novo.
    for (let i = 0; i < 16; i += 1) fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(fakeQueries()).toHaveLength(1);

    // 18ª, 19ª e 20ª: a próxima página, uma vez.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });

    await waitFor(() => expect(memberOptions()).toHaveLength(23));
    expect(fakeQueries()).toHaveLength(2);
  });

  it("Dadas duas páginas carregadas, quando troca o texto da busca, então recomeça do offset 0 só com o novo resultado", async () => {
    respondWith(
      { data: members(21) },
      { data: members(21, 20) },
      {
        data: [
          { id: "x1", name: "Marta Moura" },
          { id: "x2", name: "Mateus Moura" },
        ],
      },
    );
    const { input } = renderSelect();
    openMenu(input);
    await waitFor(() => expect(memberOptions()).toHaveLength(20));
    fireEvent.click(loadMoreOption());
    await waitFor(() => expect(memberOptions()).toHaveLength(40));

    fireEvent.change(input, { target: { value: "ma" } });

    await waitFor(() => expect(screen.getByRole("option", { name: "Marta Moura" })).toBeInTheDocument());
    expect(screen.getByRole("option", { name: "Mateus Moura" })).toBeInTheDocument();
    expect(memberOptions()).toHaveLength(0);
    expect(screen.queryByRole("option", { name: "Carregar mais" })).not.toBeInTheDocument();
    expect(fakeQueries()).toHaveLength(3);
    const searchCalls = fakeQueries()[2].calls;
    expect(searchCalls).toContainEqual(["ilike", "search_text", "%ma%"]);
    expect(searchCalls).toContainEqual(["range", 0, 20]);
  });

  it("Dada a primeira página demorando, então o menu mostra Carregando… até as opções chegarem", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    respondWith({ data: members(2), until: gate });
    const { input } = renderSelect();

    openMenu(input);

    expect(await screen.findByText("Carregando…")).toBeInTheDocument();
    expect(memberOptions()).toHaveLength(0);

    release();

    await waitFor(() => expect(memberOptions()).toHaveLength(2));
    expect(screen.queryByText("Carregando…")).not.toBeInTheDocument();
  });

  it("Dada uma busca sem resultado, então o menu mostra Nenhum membro encontrado, sem Carregar mais, e o leitor de tela ouve o vazio com a busca", async () => {
    respondWith({ data: [] }, { data: [] });
    const { input } = renderSelect();
    // Fechado, a região de status fica muda.
    expect(emptyStatus()).toBe("");

    openMenu(input);

    expect(await screen.findByText("Nenhum membro encontrado")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Carregar mais" })).not.toBeInTheDocument();
    expect(emptyStatus()).toBe("Nenhum membro encontrado.");

    fireEvent.change(input, { target: { value: "zz" } });

    await waitFor(() => expect(emptyStatus()).toBe('Nenhum membro encontrado para a busca "zz".'));
    expect(fakeQueries()).toHaveLength(2);
  });

  it("Dadas opções no menu, então a região de status do vazio fica muda e o react-select anuncia o total sem o item de ação", async () => {
    respondWith({ data: members(21) });
    const { input } = renderSelect();

    openMenu(input);

    await waitFor(() => expect(memberOptions()).toHaveLength(20));
    expect(emptyStatus()).toBe("");
    expect(announcedResults()).toBe("20 resultados disponíveis.");
  });

  it("Dada uma falha na primeira página, então mostra o erro com Tentar novamente, que refaz a consulta do início", async () => {
    respondWith(failure, { data: members(2) });
    const { input } = renderSelect();
    openMenu(input);

    const retry = await screen.findByRole("option", { name: /Tentar novamente/ });
    expect(within(retry).getByText("Não foi possível carregar as opções.")).toBeInTheDocument();
    expect(memberOptions()).toHaveLength(0);
    // O leitor de tela ouve a falha, e não "0 resultados"; o vazio fica mudo.
    expect(announcedResults()).toBe("Não foi possível carregar as opções.");
    expect(emptyStatus()).toBe("");

    fireEvent.click(retry);

    await waitFor(() => expect(memberOptions()).toHaveLength(2));
    expect(screen.queryByRole("option", { name: /Tentar novamente/ })).not.toBeInTheDocument();
    expect(fakeQueries()).toHaveLength(2);
    expect(fakeQueries()[1].calls).toContainEqual(["range", 0, 20]);
  });

  it("Dada uma falha na página seguinte, então as opções ficam e Enter em Tentar novamente pede a mesma página", async () => {
    respondWith({ data: members(21) }, failure, { data: members(4, 20) });
    const { input } = renderSelect();
    openMenu(input);
    await waitFor(() => expect(memberOptions()).toHaveLength(20));
    fireEvent.click(loadMoreOption());

    const retry = await screen.findByRole("option", { name: /Tentar novamente/ });
    expect(memberOptions()).toHaveLength(20);
    // O texto visível diz o mesmo que o leitor de tela: as opções que já estão no menu ficam.
    expect(within(retry).getByText("Não foi possível carregar mais opções.")).toBeInTheDocument();
    expect(announcedResults()).toBe("Não foi possível carregar mais opções. 20 resultados disponíveis.");

    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      screen.getByRole("option", { name: /Tentar novamente/ }).id,
    );
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(memberOptions()).toHaveLength(24));
    expect(fakeQueries()[2].calls).toContainEqual(["range", 20, 40]);
  });

  it("Dado o mouse sobre Tentar novamente, então ele fica em foco, como uma opção comum, e só uma linha fica destacada por vez", async () => {
    respondWith({ data: members(21) }, failure);
    const { input } = renderSelect();
    openMenu(input);
    await waitFor(() => expect(memberOptions()).toHaveLength(20));
    fireEvent.click(loadMoreOption());
    const retry = await screen.findByRole("option", { name: /Tentar novamente/ });
    const failureText = within(retry).getByText("Não foi possível carregar mais opções.");
    // Em repouso: o texto da falha em vermelho, sobre o fundo do menu.
    expect(retry).not.toHaveClass("bg-accent");
    expect(failureText).toHaveClass("text-destructive");

    // O primeiro movimento do mouse depois do teclado só destrava o hover (como no react-select).
    fireEvent.mouseMove(retry);
    fireEvent.mouseMove(retry);

    expect(input).toHaveAttribute("aria-activedescendant", retry.id);
    expect(retry).toHaveClass("bg-accent", "text-foreground");
    expect(failureText).not.toHaveClass("text-destructive");

    // O mouse numa opção comum leva o foco (e o destaque) para ela.
    const member = screen.getByRole("option", { name: "Membro 019" });
    fireEvent.mouseOver(member);

    expect(input).toHaveAttribute("aria-activedescendant", member.id);
    expect(retry).not.toHaveClass("bg-accent");
    expect(failureText).toHaveClass("text-destructive");
  });

  it("Dado o menu aberto, então a lista fica fora da ordem do Tab (o Tab sai do campo, sem parar na lista rolável)", async () => {
    respondWith({ data: members(21) });
    const { input } = renderSelect();
    openMenu(input);
    await waitFor(() => expect(memberOptions()).toHaveLength(20));

    expect(screen.getByRole("listbox")).toHaveAttribute("tabindex", "-1");
    expect(input).toHaveAttribute("aria-controls", screen.getByRole("listbox").id);
  });

  it("Dada uma opção clicada, então ela é escolhida e mostrada no campo", async () => {
    respondWith({ data: members(3) });
    const { input, onChange } = renderSelect();
    openMenu(input);
    await waitFor(() => expect(memberOptions()).toHaveLength(3));

    fireEvent.click(screen.getByRole("option", { name: "Membro 001" }));

    expect(onChange).toHaveBeenCalledWith("m001");
  });

  it("Dado um texto digitado e uma opção em foco, quando aperta Tab, então nada é escolhido", async () => {
    respondWith({ data: members(3) }, { data: [{ id: "x1", name: "Marta Moura" }] });
    const { input, onChange } = renderSelect();
    openMenu(input);
    await waitFor(() => expect(memberOptions()).toHaveLength(3));
    fireEvent.change(input, { target: { value: "ma" } });
    await screen.findByRole("option", { name: "Marta Moura" });
    expect(input).toHaveAttribute("aria-activedescendant", screen.getByRole("option", { name: "Marta Moura" }).id);

    fireEvent.keyDown(input, { key: "Tab" });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("Dado um toque no campo de busca, quando ele abre o menu, então os eventos de mouse do toque são cancelados; com o menu aberto, o toque segue normal", async () => {
    respondWith({ data: members(3) });
    const { input } = renderSelect();

    // `fireEvent` devolve false quando o evento foi cancelado (preventDefault).
    expect(fireEvent.touchEnd(input)).toBe(false);

    expect(input).toHaveFocus();
    await waitFor(() => expect(memberOptions()).toHaveLength(3));
    // Já aberto e em foco: o toque não é cancelado (para mover o cursor no texto).
    expect(fireEvent.touchEnd(input)).toBe(true);
    expect(memberOptions()).toHaveLength(3);
  });

  it("Dado um membro já escolhido, então a escolha única tem o botão Limpar seleção", async () => {
    respondToRpc("member_names", { data: [{ id: "m001", name: "Membro 001" }] });

    renderSelect("m001");

    expect(await screen.findByText("Membro 001")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Limpar seleção" })).toBeInTheDocument();
  });
});

describe("PaginatedSelect: menu trazido para a vista", () => {
  beforeEach(() => resetFakeSupabase());
  afterEach(() => vi.restoreAllMocks());

  it("Dado o menu aberto carregando, quando a 1ª página chega, então o menu é rolado para a vista, uma vez", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    respondWith({ data: members(21), until: gate });
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
    const { input } = renderSelect();
    openMenu(input);
    await screen.findByText("Carregando…");
    expect(scrollIntoView).not.toHaveBeenCalled();

    release();

    await waitFor(() => expect(memberOptions()).toHaveLength(20));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByRole("listbox"));

    // Andar pelas opções não rola o menu para a vista de novo.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });
});

describe("PaginatedSelect dentro de um Dialog (Esc)", () => {
  beforeEach(() => resetFakeSupabase());

  it("Dado o menu aberto num Dialog, quando aperta Esc, então fecha só o menu; um segundo Esc fecha o Dialog", async () => {
    respondWith({ data: members(2) });
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>Editar membro</DialogTitle>
          <DialogDescription>Dados do membro</DialogDescription>
          <label htmlFor="spouse">{LABEL}</label>
          <AsyncMemberSelect inputId="spouse" value={null} onChange={() => {}} />
        </DialogContent>
      </Dialog>,
      { wrapper: createQueryWrapper() },
    );
    const input = screen.getByLabelText(LABEL);
    openMenu(input);
    await waitFor(() => expect(memberOptions()).toHaveLength(2));

    fireEvent.keyDown(input, { key: "Escape" });

    expect(memberOptions()).toHaveLength(0);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Escape" });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
