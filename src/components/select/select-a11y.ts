import type { AriaLiveMessages, GroupBase } from "react-select";
import type { SelectOption } from "@/lib/selectors";

// Itens de ação dos seletores paginados (E1.08, RN-07) e os anúncios do
// react-select em pt-BR para o leitor de tela.

/**
 * Item no fim do menu que carrega a próxima página. É uma opção do menu (e não
 * um botão) porque o react-select mantém o foco no campo de busca: só as
 * opções são alcançáveis pelas setas e anunciadas ao leitor de tela.
 */
export const LOAD_MORE_OPTION: SelectOption = { value: "__load_more__", label: "Carregar mais" };

/** Item no fim do menu, depois de uma falha, que tenta carregar de novo. */
export const RETRY_OPTION: SelectOption = {
  value: "__retry__",
  label: "Não foi possível carregar as opções. Tentar novamente",
};

/** O item é uma ação (carregar mais ou tentar de novo), e não uma opção que se escolhe. */
export function isActionOption(option: SelectOption): boolean {
  return option === LOAD_MORE_OPTION || option === RETRY_OPTION;
}

export const LOADING_LABEL = "Carregando…";
export const NO_RESULTS_LABEL = "Nenhum resultado";

/** Quantas opções o menu mostra, para o leitor de tela (sem contar o item de ação). */
export function resultsMessage(count: number): string {
  return count === 1 ? "1 resultado disponível" : `${count} resultados disponíveis`;
}

function position(list: readonly unknown[], item: unknown): string {
  return list.length ? `${list.indexOf(item) + 1} de ${list.length}` : "";
}

/**
 * Anúncios do react-select em pt-BR. Os itens de ação são opções desativadas
 * para o react-select (assim nunca são escolhidos); por isso a tentativa de
 * "escolher" um deles não é anunciada, e o foco neles não fala em desativado.
 */
export const SELECT_ARIA_MESSAGES: AriaLiveMessages<SelectOption, boolean, GroupBase<SelectOption>> = {
  guidance: ({ context, isSearchable, isMulti, tabSelectsValue, isInitialFocus, "aria-label": ariaLabel }) => {
    switch (context) {
      case "menu":
        return `Use as setas para cima e para baixo para escolher, Enter para selecionar a opção em foco${
          tabSelectsValue ? ", Tab para selecioná-la e sair" : ""
        } e Esc para fechar a lista.`;
      case "input":
        return isInitialFocus
          ? `${ariaLabel || "Seletor"} em foco${isSearchable ? ", digite para buscar" : ""}, seta para baixo abre a lista${
              isMulti ? ", seta para a esquerda percorre os selecionados" : ""
            }.`
          : "";
      case "value":
        return "Use as setas para a esquerda e para a direita para percorrer os selecionados e Backspace para remover o selecionado em foco.";
      default:
        return "";
    }
  },
  onChange: ({ action, label = "", labels, isDisabled }) => {
    switch (action) {
      case "deselect-option":
      case "pop-value":
      case "remove-value":
        return `Opção ${label} removida.`;
      case "clear":
        return "Seleção limpa.";
      case "initial-input-focus":
        return `${labels.length > 1 ? "Selecionados" : "Selecionado"}: ${labels.join(", ")}.`;
      case "select-option":
        return isDisabled ? "" : `Opção ${label} selecionada.`;
      default:
        return "";
    }
  },
  onFocus: ({ context, focused, options, label = "", selectValue, isSelected, isAppleDevice }) => {
    if (context === "value" && selectValue) return `Selecionado ${label} em foco, ${position(selectValue, focused)}.`;
    if (context === "menu" && isAppleDevice) {
      return `${label}${isSelected ? ", selecionada" : ""}, ${position(options, focused)}.`;
    }
    return "";
  },
  onFilter: ({ inputValue, resultsMessage: results }) => `${results}${inputValue ? ` para a busca "${inputValue}"` : ""}.`,
};
