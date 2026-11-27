import { useRef, useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { FiltersButton } from "./FiltersButton";
import { FilterChips } from "./FilterChips";
import { SingleChoiceFilter } from "./SingleChoiceFilter";
import { MultiChoiceFilter } from "./MultiChoiceFilter";
import { DateRangeFilter } from "./DateRangeFilter";
import { FiltersSheet } from "./FiltersSheet";
import { usePanelOpen, panelOpenStorageKey } from "@/hooks/use-panel-open";
import type { FilterOption } from "./filter-options";

// Os componentes de filtro reaproveitáveis (E2.07, P50 a P54; tarefa 6): rótulos, contagem, chips,
// grupos com legenda e dicas ligadas, mensagens das datas e o painel lembrado no navegador.

describe("FiltersButton (P50, UX-05)", () => {
  it("sem filtro: 'Filtros'; com N: 'Filtros (N)' na tela e 'Filtros (N ativos)' no nome acessível", () => {
    const { rerender } = render(<FiltersButton count={0} mode="sheet" expanded={false} onClick={vi.fn()} />);
    expect(screen.getByRole("button")).toHaveAccessibleName("Filtros");
    rerender(<FiltersButton count={2} mode="sheet" expanded={false} onClick={vi.fn()} />);
    const button = screen.getByRole("button");
    expect(button).toHaveAccessibleName("Filtros (2 ativos)");
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("no painel: aria-controls e aria-expanded, sem aria-haspopup", () => {
    render(<FiltersButton count={0} mode="panel" expanded controlsId="painel" onClick={vi.fn()} />);
    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("aria-controls", "painel");
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).not.toHaveAttribute("aria-haspopup");
  });
});

describe("FilterChips (P50, UX-06)", () => {
  function Harness() {
    const [chips, setChips] = useState([
      { key: "a", text: "Situação: Ativo" },
      { key: "b", text: "Nível: 144" },
    ]);
    const buttonRef = useRef<HTMLButtonElement>(null);
    return (
      <>
        <button ref={buttonRef}>Filtros</button>
        <FilterChips chips={chips} onRemove={(key) => setChips((all) => all.filter((c) => c.key !== key))} filtersButtonRef={buttonRef} compact />
      </>
    );
  }

  it("um botão por chip, 36 px, com 'Remover filtro …'; o foco vai ao próximo e depois a 'Filtros'", async () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame"] });
    try {
      render(<Harness />);
      const first = screen.getByRole("button", { name: "Remover filtro Situação: Ativo" });
      expect(first).toHaveClass("min-h-9");
      expect(first.className).not.toContain("h-11");
      fireEvent.click(first);
      act(() => void vi.advanceTimersToNextFrame());
      expect(screen.getByRole("button", { name: "Remover filtro Nível: 144" })).toHaveFocus();
      fireEvent.click(screen.getByRole("button", { name: "Remover filtro Nível: 144" }));
      act(() => void vi.advanceTimersToNextFrame());
      expect(screen.getByRole("button", { name: "Filtros" })).toHaveFocus();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("SingleChoiceFilter (P52)", () => {
  const options = [
    { value: "active", label: "Ativo" },
    { value: "inactive", label: "Inativo" },
  ] as const;

  it("no Sheet: fieldset com legenda e 'Todos' marcado; escolher chama onChange", () => {
    const onChange = vi.fn();
    render(<SingleChoiceFilter legend="Situação" options={options} value={null} onChange={onChange} variant="radio" />);
    const group = screen.getByRole("group", { name: "Situação" });
    expect(within(group).getByRole("radio", { name: "Todos" })).toBeChecked();
    expect(screen.getByRole("radiogroup", { name: "Situação" })).toBeInTheDocument();
    fireEvent.click(within(group).getByRole("radio", { name: "Inativo" }));
    expect(onChange).toHaveBeenCalledWith("inactive");
    // Cada opção é um rótulo de 44 px que responde ao toque na linha inteira.
    expect(screen.getByText("Ativo").closest("label")).toHaveClass("min-h-11");
  });

  it("no painel: Select com o valor, nome com a legenda", () => {
    render(<SingleChoiceFilter legend="Batizado" options={options} value="active" onChange={vi.fn()} variant="select" />);
    expect(screen.getByRole("group", { name: "Batizado" })).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveAccessibleName(/Batizado/);
    expect(screen.getByRole("combobox")).toHaveTextContent("Ativo");
  });
});

describe("MultiChoiceFilter (P51, UX-20)", () => {
  const options: FilterOption<"leader" | "attendee">[] = [
    { value: "leader", label: "Líder" },
    { value: "attendee", label: "Participante", hint: "Esteve em pelo menos uma célula realizada nos últimos 30 dias." },
  ];

  it("caixas no Sheet: a dica da opção e a do grupo ligadas por aria-describedby; a ordem é a das opções", () => {
    const onChange = vi.fn();
    render(
      <MultiChoiceFilter
        legend="Vínculo celular"
        options={options}
        values={["attendee"]}
        onChange={onChange}
        variant="checkboxes"
        groupHint="Líder, timóteo e anfitrião contam só em células ativas."
        groupHintPosition="before"
      />,
    );
    const group = screen.getByRole("group", { name: "Vínculo celular" });
    expect(group).toHaveAccessibleDescription("Líder, timóteo e anfitrião contam só em células ativas.");
    expect(within(group).getByRole("checkbox", { name: "Participante" })).toHaveAccessibleDescription(
      "Esteve em pelo menos uma célula realizada nos últimos 30 dias.",
    );
    fireEvent.click(within(group).getByRole("checkbox", { name: "Líder" }));
    expect(onChange).toHaveBeenCalledWith(["leader", "attendee"]);
  });

  it("no painel: o botão mostra 'Todos' ou as escolhidas, com o nome do filtro (UX-18)", () => {
    const { rerender } = render(<MultiChoiceFilter legend="Nível" options={options} values={[]} onChange={vi.fn()} variant="popover" />);
    const button = screen.getByRole("button");
    expect(button).toHaveTextContent("Todos");
    expect(button).toHaveAccessibleName("Nível Todos");
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    rerender(<MultiChoiceFilter legend="Nível" options={options} values={["leader", "attendee"]} onChange={vi.fn()} variant="popover" />);
    expect(screen.getByRole("button")).toHaveTextContent("Líder, Participante");
    expect(screen.getByRole("button").className).not.toContain("truncate");
  });
});

describe("DateRangeFilter (P54, UX-10)", () => {
  it("sem max, com a legenda só para o leitor de tela e a dica ligada aos dois campos", () => {
    render(
      <DateRangeFilter
        legend="Data de cadastro"
        legendSrOnly
        fromLabel="Cadastrado a partir de"
        toLabel="Cadastrado até"
        from="2026-11-25"
        to="2026-11-20"
        onFromChange={vi.fn()}
        onToChange={vi.fn()}
        hint="Cadastros antigos sem data de cadastro não aparecem quando há filtro de data."
        invertedMessage="A data inicial precisa ser igual ou anterior à data final."
      />,
    );
    expect(screen.getByRole("group", { name: "Data de cadastro" })).toBeInTheDocument();
    expect(screen.getByText("Data de cadastro")).toHaveClass("sr-only");
    const from = screen.getByLabelText("Cadastrado a partir de");
    const to = screen.getByLabelText("Cadastrado até");
    expect(from).not.toHaveAttribute("max");
    expect(from).toHaveAccessibleDescription(/Cadastros antigos/);
    expect(to).toHaveAttribute("aria-invalid", "true");
    expect(to).toHaveAccessibleDescription(/A data inicial precisa ser igual ou anterior à data final\./);
    expect(from).not.toHaveAttribute("aria-invalid");
  });

  it("data inválida no campo: a mensagem embaixo dele, com aria-invalid", () => {
    render(
      <DateRangeFilter
        legend="Data de cadastro"
        fromLabel="De"
        toLabel="Até"
        from=""
        to=""
        onFromChange={vi.fn()}
        onToChange={vi.fn()}
        fromError="Data inválida. Use o formato dd/mm/aaaa."
      />,
    );
    expect(screen.getByLabelText("De")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("De")).toHaveAccessibleDescription("Data inválida. Use o formato dd/mm/aaaa.");
  });
});

describe("FiltersSheet (P50, UXD-15, UX-03)", () => {
  it("abre com o foco no título, a descrição para o leitor de tela e o rodapé; Enter aplica", () => {
    const onApply = vi.fn();
    render(
      <FiltersSheet open onClose={vi.fn()} onApply={onApply} onClear={vi.fn()} onCloseAutoFocus={vi.fn()}>
        <input aria-label="Bairro" />
      </FiltersSheet>,
    );
    const dialog = screen.getByRole("dialog", { name: "Filtros" });
    expect(within(dialog).getByRole("heading", { name: "Filtros" })).toHaveFocus();
    expect(dialog).toHaveAccessibleDescription("As mudanças valem quando você toca em Aplicar filtros.");
    fireEvent.submit(within(dialog).getByLabelText("Bairro"));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole("button", { name: "Aplicar filtros" })).toHaveClass("h-11");
    expect(within(dialog).getByRole("button", { name: "Limpar" })).toHaveClass("h-11");
  });
});

describe("usePanelOpen (UXD-14)", () => {
  beforeEach(() => localStorage.clear());

  function Panel() {
    const [open, setOpen] = usePanelOpen("members");
    return <button onClick={() => setOpen(!open)}>{open ? "aberto" : "fechado"}</button>;
  }

  it("começa fechado e lembra o último estado neste navegador", () => {
    const { unmount } = render(<Panel />);
    fireEvent.click(screen.getByRole("button", { name: "fechado" }));
    expect(localStorage.getItem(panelOpenStorageKey("members"))).toBe("1");
    unmount();
    render(<Panel />);
    expect(screen.getByRole("button", { name: "aberto" })).toBeInTheDocument();
  });
});
