import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type KeyboardEvent,
  type MutableRefObject,
  type Ref,
  type SyntheticEvent,
  type TouchEvent,
} from "react";
import Select, {
  components,
  type ClearIndicatorProps,
  type GroupBase,
  type InputProps,
  type MultiValueRemoveProps,
  type OnChangeValue,
  type OptionProps,
  type PropsValue,
  type SelectComponentsConfig,
  type SelectInstance,
} from "react-select";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SelectOption } from "@/lib/selectors";
import { useIsMobile } from "@/hooks/use-mobile";
import type { OptionsPagination, SelectSearch } from "@/hooks/use-paginated-select";
import { selectStyles } from "./select-styles";
import {
  LOAD_FAILED_LABEL,
  LOAD_MORE_OPTION,
  LOADING_LABEL,
  NO_RESULTS_LABEL,
  RETRY_OPTION,
  SELECT_ARIA_MESSAGES,
  isActionOption,
  noResultsMessage,
  resultsMessage,
} from "./select-a11y";

// Seletor com busca e paginação no servidor (E1.08, RN-07), sobre o
// react-select. O filtro é do servidor (`filterOption={null}`). A próxima
// página carrega:
//   - ao rolar até o fim (roda do mouse ou toque);
//   - quando o foco (setas ou mouse) chega a uma das últimas opções;
//   - pelo item "Carregar mais", no fim do menu (clique, toque, Enter ou espaço).
// O estado das páginas chega aos componentes do menu por contexto: o objeto
// `components` é fixo, para o menu não ser remontado (e perder a rolagem) a
// cada render.

/** O foco numa das últimas N opções já pede a próxima página. */
const PREFETCH_DISTANCE = 3;

/** Altura máxima do menu: menor no celular, para caber com o teclado aberto. */
const MENU_MAX_HEIGHT = 300;
const MOBILE_MENU_MAX_HEIGHT = 240;

interface PaginatedMenuContextValue {
  pagination: OptionsPagination;
  /** Valores das últimas opções carregadas. */
  prefetchValues: ReadonlySet<string>;
  /** O item de ação em foco no menu, se houver (para Enter e espaço). */
  focusedAction: MutableRefObject<SelectOption | null>;
  runAction: (action: SelectOption) => void;
  focusInput: () => void;
}

const PaginatedMenuContext = createContext<PaginatedMenuContextValue | null>(null);

function usePaginatedMenu(): PaginatedMenuContextValue {
  const context = useContext(PaginatedMenuContext);
  if (!context) throw new Error("Componente do menu fora do PaginatedSelect");
  return context;
}

type PaginatedOptionProps = OptionProps<SelectOption, boolean, GroupBase<SelectOption>>;

/** Opção comum: o foco numa das últimas já carrega a próxima página. */
function ItemOption(props: PaginatedOptionProps) {
  const { pagination, prefetchValues } = usePaginatedMenu();
  const { loadMore } = pagination;
  const nearEnd = prefetchValues.has(props.data.value);
  useEffect(() => {
    if (props.isFocused && nearEnd) loadMore();
  }, [props.isFocused, nearEnd, loadMore]);
  return <components.Option {...props} />;
}

/** "Carregar mais" (ou "Carregando…") e "Tentar novamente", no fim do menu. */
function ActionOption({ data, innerProps, innerRef, isFocused }: PaginatedOptionProps) {
  const { pagination, focusedAction, runAction } = usePaginatedMenu();

  useEffect(() => {
    if (!isFocused) return;
    focusedAction.current = data;
    return () => {
      if (focusedAction.current === data) focusedAction.current = null;
    };
  }, [isFocused, data, focusedAction]);

  const loadingMore = data === LOAD_MORE_OPTION && pagination.isFetchingNextPage;
  return (
    <div
      ref={innerRef}
      id={innerProps.id}
      role="option"
      aria-selected={innerProps["aria-selected"]}
      tabIndex={-1}
      onClick={() => runAction(data)}
      className={cn(
        "flex min-h-11 cursor-pointer flex-wrap items-center gap-x-2 px-3 py-2 hover:bg-accent hover:text-foreground",
        isFocused ? "bg-accent text-foreground" : "text-primary",
      )}
    >
      {data === RETRY_OPTION ? (
        <>
          <span className={cn(!isFocused && "text-destructive")}>{LOAD_FAILED_LABEL}.</span>
          <span className="font-medium underline underline-offset-4">Tentar novamente</span>
        </>
      ) : loadingMore ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {LOADING_LABEL}
        </>
      ) : (
        <span className="font-medium">{LOAD_MORE_OPTION.label}</span>
      )}
    </div>
  );
}

function PaginatedOption(props: PaginatedOptionProps) {
  return isActionOption(props.data) ? <ActionOption {...props} /> : <ItemOption {...props} />;
}

/**
 * Botão de limpar com rótulo e alcançável pelo Tab (o do react-select é
 * escondido do leitor de tela e só responde ao mouse).
 */
function ClearIndicator({ clearValue }: ClearIndicatorProps<SelectOption, boolean, GroupBase<SelectOption>>) {
  const { focusInput } = usePaginatedMenu();
  // O preventDefault impede o controle de abrir o menu e o botão de roubar o foco.
  const clear = (event: SyntheticEvent) => {
    event.preventDefault();
    clearValue();
  };
  return (
    <button
      type="button"
      aria-label="Limpar seleção"
      className="flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        clear(event);
        focusInput();
      }}
      onTouchEnd={clear}
      onClick={(event) => {
        // Enter ou espaço com o botão em foco (o clique do mouse já limpou no mousedown).
        if (event.detail !== 0) return;
        clear(event);
        focusInput();
      }}
    >
      <X className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

/**
 * Campo de busca com o tratamento do blur adiado para depois da troca de foco.
 * No blur, o react-select remove nós do DOM (o texto do leitor de tela e o
 * menu); dentro de um Dialog do Radix, uma remoção enquanto o foco está no
 * `body` (entre o blur e o foco do próximo campo) faz o diálogo puxar o foco
 * para si, e o Tab não chegava ao campo seguinte.
 */
function DeferredBlurInput(props: InputProps<SelectOption, boolean, GroupBase<SelectOption>>) {
  const { onBlur } = props;
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <components.Input
      {...props}
      onBlur={(event) => {
        const input = event.currentTarget;
        timer.current = window.setTimeout(() => {
          // O foco já voltou ao campo (Tab e Shift+Tab rápidos): não houve saída.
          if (document.activeElement !== input) onBlur?.(event);
        });
      }}
    />
  );
}

function MultiValueRemove(props: MultiValueRemoveProps<SelectOption, boolean, GroupBase<SelectOption>>) {
  return (
    <components.MultiValueRemove {...props} innerProps={{ ...props.innerProps, "aria-label": `Remover ${props.data.label}` }} />
  );
}

const SELECT_COMPONENTS: SelectComponentsConfig<SelectOption, boolean, GroupBase<SelectOption>> = {
  Option: PaginatedOption,
  ClearIndicator,
  Input: DeferredBlurInput,
  MultiValueRemove,
};

/** O que o seletor expõe por `focusRef`: levar o foco ao campo de busca. */
export interface PaginatedSelectHandle {
  focus: () => void;
}

export interface PaginatedSelectProps<IsMulti extends boolean> {
  /** Id do campo de busca, para o `<Label htmlFor>`. */
  inputId?: string;
  isMulti?: IsMulti;
  search: SelectSearch;
  pagination: OptionsPagination;
  value: PropsValue<SelectOption>;
  onChange: (value: OnChangeValue<SelectOption, IsMulti>) => void;
  placeholder: string;
  /** Texto do menu sem resultados (ex.: "Nenhum membro encontrado"). */
  noResultsLabel?: string;
  isDisabled?: boolean;
  /** Botão de limpar a escolha. Padrão: sem (no múltiplo, cada escolhido tem o seu "×"). */
  isClearable?: boolean;
  /**
   * Recebe o `field.ref` do react-hook-form: quando a validação falha, o foco
   * vem para o seletor. (Uma prop, e não `forwardRef`, para o componente
   * continuar genérico no `IsMulti`.)
   */
  focusRef?: Ref<PaginatedSelectHandle>;
  "aria-invalid"?: boolean;
  /** Id da mensagem de erro do campo. */
  "aria-errormessage"?: string;
}

export function PaginatedSelect<IsMulti extends boolean = false>({
  inputId,
  isMulti,
  search,
  pagination,
  value,
  onChange,
  placeholder,
  noResultsLabel = NO_RESULTS_LABEL,
  isDisabled,
  isClearable = false,
  focusRef,
  "aria-invalid": ariaInvalid,
  "aria-errormessage": ariaErrorMessage,
}: PaginatedSelectProps<IsMulti>) {
  const selectRef = useRef<SelectInstance<SelectOption, IsMulti, GroupBase<SelectOption>>>(null);
  const focusedAction = useRef<SelectOption | null>(null);
  const styles = useMemo(() => selectStyles<SelectOption, IsMulti>(), []);
  const isMobile = useIsMobile();
  const { options, isLoading, isError, hasNextPage, isFetchingNextPage, loadMore, retry } = pagination;

  useImperativeHandle(focusRef, () => ({ focus: () => selectRef.current?.focus() }), []);

  // Com erro, o item de tentar de novo; havendo mais páginas, o de carregar
  // mais (que vira "Carregando…" e mantém o foco enquanto a página chega).
  const action = isError ? RETRY_OPTION : hasNextPage || isFetchingNextPage ? LOAD_MORE_OPTION : null;
  const menuOptions = useMemo(() => (action ? [...options, action] : options), [options, action]);
  const prefetchValues = useMemo(
    () => new Set(options.slice(-PREFETCH_DISTANCE).map((option) => option.value)),
    [options],
  );

  const runAction = useCallback(
    (option: SelectOption) => {
      if (option === RETRY_OPTION) retry();
      else loadMore();
    },
    [retry, loadMore],
  );
  const focusInput = useCallback(() => selectRef.current?.focus(), []);
  const menuContext = useMemo(
    () => ({ pagination, prefetchValues, focusedAction, runAction, focusInput }),
    [pagination, prefetchValues, runAction, focusInput],
  );

  // Dentro de um Dialog do Radix, o Esc fecharia o diálogo inteiro (ele escuta
  // o teclado na captura do `document`, antes do react-select). Com o menu
  // aberto, o Esc é interceptado antes (na captura do `window`) e só fecha o
  // menu, sem perder o que já foi preenchido no formulário.
  const { isMenuOpen, term } = search;
  useEffect(() => {
    if (!isMenuOpen) return;
    const closeMenuOnEscape = (event: globalThis.KeyboardEvent) => {
      const select = selectRef.current;
      if (event.key !== "Escape" || !select || event.target !== select.inputRef) return;
      event.stopPropagation();
      event.preventDefault();
      select.onMenuClose();
    };
    window.addEventListener("keydown", closeMenuOnEscape, true);
    return () => window.removeEventListener("keydown", closeMenuOnEscape, true);
  }, [isMenuOpen]);

  // O menu abre com "Carregando…" e é posicionado nesse tamanho; quando a 1ª
  // página chega, ele cresce e pode ficar cortado no fim do diálogo (no
  // celular, só umas 2 opções apareciam). Aí ele é trazido para a vista.
  const awaitingFirstPage = useRef(false);
  useEffect(() => {
    if (!isMenuOpen) {
      awaitingFirstPage.current = false;
    } else if (isLoading) {
      awaitingFirstPage.current = true;
    } else if (awaitingFirstPage.current) {
      awaitingFirstPage.current = false;
      selectRef.current?.menuListRef?.scrollIntoView({ block: "nearest" });
    }
  }, [isMenuOpen, isLoading]);

  // Um toque no campo de busca que abre o menu: o react-select dá o foco e abre
  // o menu no `touchend` (como no resto do controle), mas, só no campo, não
  // cancela os eventos de mouse que o navegador emite depois do toque. Quando
  // o menu rola o diálogo para aparecer inteiro, esse `mousedown` caía em outro
  // elemento e fechava o menu na hora. O cancelamento vem depois do tratamento
  // do react-select (que ignora toques já cancelados). Com o menu já aberto, o
  // toque segue normal (por exemplo, para mover o cursor no texto).
  const touchOpensMenu = useRef(false);
  const handleTouchEndCapture = (event: TouchEvent<HTMLDivElement>) => {
    const input = selectRef.current?.inputRef;
    const menuOpenWithFocus = document.activeElement === input && isMenuOpen;
    touchOpensMenu.current = !!input && event.target === input && !menuOpenWithFocus;
  };
  const handleTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    if (touchOpensMenu.current) event.preventDefault();
    touchOpensMenu.current = false;
  };

  // O react-select não anuncia o menu vazio: o anúncio vai numa região de
  // status própria, que só tem texto enquanto o menu aberto está vazio.
  const isEmpty = isMenuOpen && !isLoading && !isError && options.length === 0;
  const emptyStatus = isEmpty ? noResultsMessage(noResultsLabel, term.trim()) : "";

  // Enter e espaço num item de ação executam a ação, sem passar pela escolha
  // de opção do react-select (que não escolhe itens desativados).
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const focused = focusedAction.current;
    if (!focused) return;
    if (event.key === "Enter" || (event.key === " " && !search.inputValue)) {
      event.preventDefault();
      runAction(focused);
    }
  };

  return (
    <PaginatedMenuContext.Provider value={menuContext}>
      <div onTouchEndCapture={handleTouchEndCapture} onTouchEnd={handleTouchEnd}>
        <Select<SelectOption, IsMulti>
          ref={selectRef}
          inputId={inputId}
          isMulti={isMulti}
          options={menuOptions}
          value={value}
          onChange={(next) => onChange(next)}
          inputValue={search.inputValue}
          onInputChange={(text, meta) => {
            // Na escolha múltipla, o menu, o foco e o texto da busca ficam depois
            // de cada escolha (também no toque, com `blurInputOnSelect` desligado),
            // para escolher outras opções do mesmo resultado.
            if (isMulti && meta.action === "set-value") return;
            search.setInputValue(text);
          }}
          onMenuOpen={() => search.setMenuOpen(true)}
          onMenuClose={() => search.setMenuOpen(false)}
          onMenuScrollToBottom={loadMore}
          // O padrão desliga a captura da rolagem em telas de toque, e aí o fim
          // da rolagem não seria percebido no celular.
          captureMenuScroll
          // O padrão desliga em celulares, e aí o menu abria cortado no fim do diálogo.
          menuShouldScrollIntoView
          maxMenuHeight={isMobile ? MOBILE_MENU_MAX_HEIGHT : MENU_MAX_HEIGHT}
          filterOption={null}
          isOptionDisabled={isActionOption}
          closeMenuOnSelect={!isMulti}
          // No toque, o padrão tira o foco a cada escolha (fecha o teclado). Na
          // escolha única continua assim; na múltipla, o foco fica.
          blurInputOnSelect={isMulti ? false : undefined}
          // O Tab só sai do campo: com texto digitado, ele escolhia a opção em
          // foco e trocava o valor sem querer.
          tabSelectsValue={false}
          isLoading={isLoading}
          isDisabled={isDisabled}
          isClearable={isClearable}
          placeholder={placeholder}
          loadingMessage={() => LOADING_LABEL}
          noOptionsMessage={() => noResultsLabel}
          screenReaderStatus={({ count }) => resultsMessage(action ? count - 1 : count, { failed: isError })}
          ariaLiveMessages={SELECT_ARIA_MESSAGES}
          aria-invalid={ariaInvalid}
          aria-errormessage={ariaErrorMessage}
          components={SELECT_COMPONENTS}
          styles={styles}
          onKeyDown={handleKeyDown}
          className="text-base md:text-sm"
        />
      </div>
      <span role="status" className="sr-only">
        {emptyStatus}
      </span>
    </PaginatedMenuContext.Provider>
  );
}
