// Textos do endereço e do CEP, comuns ao cadastro de membro e ao de célula
// (E2.08, RN-09, T4 e "Textos" da UX).

export const ADDRESS_TEXTS = {
  zipCode: "CEP",
  zipCodePlaceholder: "00000-000",
  street: "Rua",
  number: "Número",
  complement: "Complemento",
  neighborhood: "Bairro",
  city: "Cidade",
  state: "Estado",
  statePlaceholder: "UF",
  /** Ao lado do rótulo, durante a busca. */
  searching: "Buscando endereço…",
  /** Só para o leitor de tela, quando os campos chegam. */
  filled: "Rua, bairro, cidade e estado preenchidos pelo CEP.",
  /** Avisos (P21): não marcam o campo como inválido e não impedem salvar. */
  notFound: "CEP não encontrado. Confira o número ou preencha o endereço.",
  failed: "Não foi possível buscar o endereço pelo CEP. Preencha o endereço.",
} as const;

/** As 27 UFs, na ordem do seletor de Estado. */
export const BRAZILIAN_STATES = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;
