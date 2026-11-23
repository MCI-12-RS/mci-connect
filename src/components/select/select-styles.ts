import type { GroupBase, StylesConfig } from "react-select";

/**
 * Opções com alvo de toque de 44 px abaixo de 768 px (o `md` do Tailwind) e em
 * qualquer tela de toque (como o tablet, que já mostra o layout do desktop).
 */
const TOUCH_TARGET = "@media (max-width: 767px), (pointer: coarse)";

/**
 * Estilos dos seletores do react-select com os tokens do tema (claro e
 * escuro): controle no formato do `Input` do shadcn, foco visível e menu com
 * as cores do `popover`.
 */
export function selectStyles<Option, IsMulti extends boolean>(): StylesConfig<Option, IsMulti, GroupBase<Option>> {
  return {
    // Desativado, como o `Input`: meio apagado e com o cursor de proibido. O
    // react-select desliga os eventos do ponteiro no contêiner; aqui eles
    // voltam só nele (para o cursor) e continuam desligados no controle.
    container: (base, state) => (state.isDisabled ? { ...base, pointerEvents: "auto", cursor: "not-allowed" } : base),
    control: (base, state) => ({
      ...base,
      backgroundColor: "transparent",
      borderColor: state.isFocused ? "hsl(var(--ring))" : "hsl(var(--input))",
      boxShadow: state.isFocused ? "0 0 0 1px hsl(var(--ring))" : "none",
      minHeight: "40px",
      opacity: state.isDisabled ? 0.5 : 1,
      pointerEvents: state.isDisabled ? "none" : undefined,
      "&:hover": { borderColor: state.isFocused ? "hsl(var(--ring))" : "hsl(var(--input))" },
    }),
    placeholder: (base) => ({ ...base, color: "hsl(var(--muted-foreground))" }),
    singleValue: (base) => ({ ...base, color: "hsl(var(--foreground))" }),
    input: (base) => ({ ...base, color: "hsl(var(--foreground))" }),
    indicatorSeparator: (base) => ({ ...base, backgroundColor: "hsl(var(--border))" }),
    dropdownIndicator: (base) => ({ ...base, color: "hsl(var(--muted-foreground))" }),
    loadingIndicator: (base) => ({ ...base, color: "hsl(var(--muted-foreground))" }),
    menu: (base) => ({
      ...base,
      backgroundColor: "hsl(var(--popover))",
      border: "1px solid hsl(var(--border))",
      zIndex: 50,
    }),
    // Ao ser trazido para a vista, o menu leva junto a margem e a borda de baixo.
    menuList: (base) => ({ ...base, scrollMarginBottom: 12 }),
    // O texto fica com a cor do tema também em foco: o branco sobre o `accent`
    // não tem contraste suficiente.
    option: (base, state) => ({
      ...base,
      display: "flex",
      alignItems: "center",
      backgroundColor: state.isFocused ? "hsl(var(--accent))" : "transparent",
      color: "hsl(var(--foreground))",
      fontWeight: state.isSelected ? 600 : 400,
      cursor: "pointer",
      "&:active": { backgroundColor: "hsl(var(--accent))" },
      [TOUCH_TARGET]: { minHeight: 44 },
    }),
    loadingMessage: (base) => ({ ...base, color: "hsl(var(--muted-foreground))" }),
    noOptionsMessage: (base) => ({ ...base, color: "hsl(var(--muted-foreground))" }),
    // Nomes longos quebram a linha dentro do chip, em vez de alargar o formulário.
    multiValue: (base) => ({
      ...base,
      maxWidth: "100%",
      backgroundColor: "hsl(var(--muted))",
    }),
    multiValueLabel: (base) => ({
      ...base,
      color: "hsl(var(--foreground))",
      whiteSpace: "normal",
      overflowWrap: "anywhere",
    }),
    multiValueRemove: (base) => ({
      ...base,
      minWidth: 32,
      justifyContent: "center",
      color: "hsl(var(--foreground))",
      "&:hover": { backgroundColor: "hsl(var(--destructive))", color: "hsl(var(--destructive-foreground))" },
    }),
  };
}
