// Textos do E2.04 (validações de membro): "Textos de tela" do Negócio e
// "Textos" da Experiência (UX). Todos os textos de tela deste passo ficam só
// aqui; os componentes só os consomem.
//
// As mensagens de regra também vêm prontas do banco (`message` do erro
// `app_error`), e a tela mostra a que veio. As cópias aqui servem para a
// conferência na tela (antes de enviar), para os testes e para as reservas
// (23505 e 23514), que não trazem texto amigável.

import { MEMBER_FORM_TEXTS, OWN_DATA_TEXTS } from "@/lib/access/texts";

/** Mensagens das regras (RN-02 a RN-16; "Formato dos erros", AQ-1). */
export const MEMBER_RULE_TEXTS = {
  nameInvalid: "Informe o nome e o sobrenome.",
  genderRequired: "Informe o sexo.",
  birthDateFuture: "A data de nascimento não pode ser futura.",
  birthDateTooOld: "Confira a data de nascimento: a pessoa teria 100 anos ou mais.",
  mobileInvalid: "Celular inválido. Informe o DDD e o número.",
  emailPlaceholder: "Este e-mail não pode ser usado. Informe um e-mail real ou deixe o campo em branco.",
  emailInvalid: "E-mail inválido. Confira o endereço digitado.",
  cpfInvalid: "CPF inválido. Se a pessoa não tem CPF, deixe o campo em branco.",
  identifierRequired: "Informe o e-mail, o celular ou o CPF. A pessoa usa um deles para entrar no sistema.",
  spouseSelf: "Uma pessoa não pode ser cônjuge de si mesma.",
  pastorWithLeader: 'Pastor(a) não tem líder. Tire o líder ou desmarque "É Pastor(a)?".',
  /** DA-2: o texto do servidor e o de quem vê só o ministério (E2.02). */
  leaderRequired: MEMBER_FORM_TEXTS.leaderRequired,
  /** DA-2: o texto da tela para quem vê a igreja toda. */
  leaderRequiredWholeChurch: 'Escolha o líder ou desligue "Tem Liderança?".',
  leaderSelf: "Uma pessoa não pode ser líder de si mesma.",
  leaderCycle: "O líder escolhido é discípulo desta pessoa (direto ou indireto). Escolha outro líder.",
  baptismDateWithoutBaptism: "A data do batismo só pode ser informada para quem é batizado(a).",
  valueInUse: {
    email: "Este e-mail já está sendo usado por outro cadastro.",
    mobile: "Este celular já está sendo usado por outro cadastro.",
    cpf: "Este CPF já está sendo usado por outro cadastro.",
  },
  /** E2.01 (RN-18), agora com `field: "email"`. */
  deletedAccountEmail: "Este e-mail pertence a um cadastro excluído. Peça a um administrador para restaurá-lo ou use outro e-mail.",
  /** Só pela `create-user-admin` (DA-10). */
  attemptAlreadyUsed: "Este cadastro já foi enviado. Confira na lista de Membros.",
  /** Só pela `member_descendants_among`. */
  tooManyIds: "No máximo 100 membros por consulta.",
  /** A idade embaixo da data de nascimento (RN-15, P-VAL-24). */
  age: (years: number): string => {
    if (years < 1) return "Menos de 1 ano";
    return years === 1 ? "1 ano" : `${years} anos`;
  },
} as const;

/** Dicas e avisos dos interruptores (RN-08, RN-11, RN-12, RN-16; P20). */
export const MEMBER_HINT_TEXTS = {
  identification: "A pessoa entra no sistema com o celular, o e-mail ou o CPF. Informe pelo menos um.",
  noLeadership: "A pessoa fica sem liderança.",
  pastorHasNoLeader: "Pastor(a) não tem líder.",
  /** P20: "É Pastor(a)?" ligado com líder. */
  leaderRemoved: (name: string): string => `Ao salvar, ${name} deixa de ser o líder.`,
  /** P20: "Tem Liderança?" desligado com líder. */
  leaderRemovedNoLeadership: (name: string): string => `Ao salvar, ${name} deixa de ser o líder. A pessoa fica sem liderança.`,
  /** P20: "Batizado(a)?" desligado com a data; a data em dd/mm/aaaa. */
  baptismDateRemoved: (date: string): string => `Ao salvar, a data do batismo (${date}) será apagada.`,
  /** O motivo do discípulo desabilitado no seletor de líder (RN-13, P5). */
  discipleOfThisPerson: "Discípulo desta pessoa",
} as const;

/** Avisos de dado antigo fora da regra (RN-17, P24, P-VAL-25): não impedem salvar. */
export const MEMBER_LEGACY_TEXTS = {
  name: "Nome sem sobrenome. Complete quando puder.",
  mobile: "Celular fora do formato. Corrija quando puder.",
  birthDate: "Data de nascimento fora do intervalo aceito. Confira quando puder.",
  identification: "Sem e-mail, celular ou CPF: esta pessoa não consegue entrar no sistema.",
} as const;

/** O formulário (T1 a T7; "Textos" da UX). */
export const MEMBER_FORM_LAYOUT_TEXTS = {
  titles: {
    create: MEMBER_FORM_TEXTS.newMember,
    edit: "Editar membro",
    own: "Editar meus dados",
  },
  requiredNote: "Campos com * são obrigatórios.",
  sections: {
    personal: "Dados pessoais",
    identification: "Identificação",
    ministry: "Dados ministeriais",
    address: "Endereço",
    access: "Acesso",
  },
  labels: {
    name: "Nome *",
    gender: "Sexo *",
    male: "Masculino",
    female: "Feminino",
    birthDate: "Data de nascimento",
    mobile: "Celular / WhatsApp",
    email: "E-mail",
    cpf: "CPF",
    phone: "Telefone",
    instagram: "Instagram (@)",
    spouse: "Cônjuge",
    notes: "Observações",
    pastor: "É Pastor(a)?",
    hasLeadership: "Tem Liderança?",
    leader: MEMBER_FORM_TEXTS.leaderLabel,
    /** Quem vê só o ministério e edita alguém já sem liderança (E2.02, PO-UX-7): opcional. */
    leaderOptional: "Líder",
    active: "Ativo",
    baptized: "Batizado(a)?",
    baptismDate: "Data do batismo",
  },
  placeholders: {
    mobile: "(00) 00000-0000",
    cpf: "000.000.000-00",
    phone: "(00) 0000-0000",
    instagram: "@usuario",
    leader: "Buscar líder…",
    spouse: "Buscar cônjuge…",
  },
  buttons: {
    cancel: "Cancelar",
    create: MEMBER_FORM_TEXTS.createMember,
    save: "Salvar alterações",
    creating: "Criando…",
    saving: "Salvando…",
  },
  /** O "✕" do cabeçalho, para o leitor de tela. */
  close: MEMBER_FORM_TEXTS.close,
  /** O rodapé de "Meus dados" só para leitura (E2.02). */
  readOnlyClose: OWN_DATA_TEXTS.close,
  /** Sucesso: como antes (toast). */
  created: "Membro criado com sucesso",
  updated: "Membro atualizado com sucesso",
  /** Endereço: como antes. */
  address: {
    zipCode: "CEP",
    street: "Rua",
    number: "Número",
    complement: "Complemento",
    neighborhood: "Bairro",
    city: "Cidade",
    state: "Estado",
    statePlaceholder: "UF",
  },
  roleSelectPlaceholder: "Selecione a função",
  /** P22: o resumo no rodapé ao salvar com erro. */
  errorSummary: (count: number): string => `Confira os campos destacados (${count}).`,
  /** T7: queda de conexão ou 5xx ao salvar. */
  saveNetworkError: MEMBER_FORM_TEXTS.saveNetworkError,
} as const;

/** A marca de situação da pessoa nos seletores e nas listas (E2.08, P63; E2.01, T3). */
export const PERSON_MARK_TEXTS = {
  inactiveMale: "(inativo)",
  inactiveFemale: "(inativa)",
} as const;
