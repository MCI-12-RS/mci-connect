import type { GroupBase, StylesConfig } from "react-select";

/**
 * Estilos dos seletores do react-select com os tokens do tema (claro e
 * escuro): controle no formato do `Input` do shadcn, foco visível e menu com
 * as cores do `popover`.
 */
export function selectStyles<Option, IsMulti extends boolean>(): StylesConfig<Option, IsMulti, GroupBase<Option>> {
  return {
    control: (base, state) => ({
      ...base,
      backgroundColor: "transparent",
      borderColor: state.isFocused ? "hsl(var(--ring))" : "hsl(var(--input))",
      boxShadow: state.isFocused ? "0 0 0 1px hsl(var(--ring))" : "none",
      minHeight: "40px",
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
    option: (base, state) => ({
      ...base,
      backgroundColor: state.isFocused ? "hsl(var(--accent))" : "transparent",
      color: state.isFocused ? "hsl(var(--accent-foreground))" : "hsl(var(--foreground))",
      cursor: "pointer",
    }),
    loadingMessage: (base) => ({ ...base, color: "hsl(var(--muted-foreground))" }),
    noOptionsMessage: (base) => ({ ...base, color: "hsl(var(--muted-foreground))" }),
    multiValue: (base) => ({
      ...base,
      backgroundColor: "hsl(var(--secondary))",
    }),
    multiValueLabel: (base) => ({
      ...base,
      color: "hsl(var(--secondary-foreground))",
    }),
    multiValueRemove: (base) => ({
      ...base,
      color: "hsl(var(--secondary-foreground))",
    }),
  };
}
