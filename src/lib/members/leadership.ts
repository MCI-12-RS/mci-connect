// Os três interruptores dos dados ministeriais (E2.04, RN-11, RN-12, RN-16;
// P20, P-VAL-22, P-VAL-23): "É Pastor(a)?", "Tem Liderança?" e "Batizado(a)?".
//
// Nada é apagado em silêncio: o interruptor esconde o campo e guarda o valor
// que sai na memória; voltar o interruptor antes de salvar devolve o valor. O
// que vai para o banco é o estado visível (`state`): o líder e a data do
// batismo escondidos vão vazios. Vale para quem vê a igreja toda, que tem os
// interruptores (E2.02, `ministryFieldsView`).

import { formatIsoDateBr } from "@/lib/dates/sao-paulo";
import { MEMBER_HINT_TEXTS } from "./texts";

/** O líder escolhido, com o nome para o aviso. */
export interface LeaderRef {
  id: string;
  name: string;
}

/** O estado visível dos interruptores e dos campos que eles escondem. */
export interface MinistrySwitchState {
  is_pastor: boolean;
  has_leadership: boolean;
  leader: LeaderRef | null;
  is_baptized: boolean;
  /** "aaaa-mm-dd". */
  baptism_date: string | null;
}

/** Os valores escondidos por um interruptor, que voltam quando ele volta. */
export interface MinistrySwitchMemory {
  /** O líder escondido por "É Pastor(a)?" ou por "Tem Liderança?". */
  leader: LeaderRef | null;
  /** "Tem Liderança?" antes de ligar "É Pastor(a)?". `null`: não há o que devolver. */
  hasLeadershipBeforePastor: boolean | null;
  /** A data do batismo escondida por "Batizado(a)?". */
  baptismDate: string | null;
}

export interface MinistrySwitches {
  state: MinistrySwitchState;
  memory: MinistrySwitchMemory;
}

const EMPTY_MEMORY: MinistrySwitchMemory = { leader: null, hasLeadershipBeforePastor: null, baptismDate: null };

/**
 * O estado ao abrir o formulário:
 * - cadastro novo: "Tem Liderança?" ligado, sem líder (RN-12, P-VAL-12);
 * - edição: como está gravado.
 */
export function initialMinistrySwitches(
  stored: Partial<MinistrySwitchState> | null,
): MinistrySwitches {
  if (!stored) {
    return {
      state: { is_pastor: false, has_leadership: true, leader: null, is_baptized: false, baptism_date: null },
      memory: EMPTY_MEMORY,
    };
  }
  return {
    state: {
      is_pastor: stored.is_pastor === true,
      has_leadership: stored.has_leadership === true,
      leader: stored.leader ?? null,
      is_baptized: stored.is_baptized === true,
      baptism_date: stored.baptism_date ?? null,
    },
    memory: EMPTY_MEMORY,
  };
}

/**
 * "É Pastor(a)?" (RN-11, P-VAL-22):
 * - ligar esconde "Tem Liderança?" e o Líder: o líder vai para a memória, e
 *   "Tem Liderança?" desliga;
 * - desligar devolve "Tem Liderança?" e o líder como estavam. Num cadastro que
 *   já era de pastor, não há o que devolver: "Tem Liderança?" aparece ligado,
 *   com o Líder vazio (UX-18).
 */
export function setPastor({ state, memory }: MinistrySwitches, on: boolean): MinistrySwitches {
  if (on === state.is_pastor) return { state, memory };
  if (on) {
    return {
      state: { ...state, is_pastor: true, has_leadership: false, leader: null },
      memory: { ...memory, leader: state.leader ?? memory.leader, hasLeadershipBeforePastor: state.has_leadership },
    };
  }
  const hasLeadership = memory.hasLeadershipBeforePastor ?? true;
  return {
    state: { ...state, is_pastor: false, has_leadership: hasLeadership, leader: hasLeadership ? memory.leader : null },
    memory: { ...memory, leader: hasLeadership ? null : memory.leader, hasLeadershipBeforePastor: null },
  };
}

/**
 * "Tem Liderança?" (RN-12): desligar esconde o Líder e o guarda na memória;
 * ligar devolve o líder guardado (ou o Líder vazio).
 */
export function setHasLeadership({ state, memory }: MinistrySwitches, on: boolean): MinistrySwitches {
  if (on === state.has_leadership) return { state, memory };
  if (on) {
    return { state: { ...state, has_leadership: true, leader: memory.leader }, memory: { ...memory, leader: null } };
  }
  return {
    state: { ...state, has_leadership: false, leader: null },
    memory: { ...memory, leader: state.leader ?? memory.leader },
  };
}

/** Escolher (ou limpar) o líder. Escolher liga "Tem Liderança?" (DA-11 do E2.02) e descarta o líder guardado. */
export function setLeader({ state, memory }: MinistrySwitches, leader: LeaderRef | null): MinistrySwitches {
  return {
    state: { ...state, leader, has_leadership: leader ? true : state.has_leadership },
    memory: { ...memory, leader: null },
  };
}

/** "Batizado(a)?" (RN-16): desligar esconde a data e a guarda; ligar a devolve. */
export function setBaptized({ state, memory }: MinistrySwitches, on: boolean): MinistrySwitches {
  if (on === state.is_baptized) return { state, memory };
  if (on) {
    return { state: { ...state, is_baptized: true, baptism_date: memory.baptismDate }, memory: { ...memory, baptismDate: null } };
  }
  return {
    state: { ...state, is_baptized: false, baptism_date: null },
    memory: { ...memory, baptismDate: state.baptism_date ?? memory.baptismDate },
  };
}

/** A data do batismo. */
export function setBaptismDate({ state, memory }: MinistrySwitches, date: string | null): MinistrySwitches {
  return { state: { ...state, baptism_date: date }, memory: { ...memory, baptismDate: null } };
}

/** Um texto embaixo de um interruptor: dica, texto fixo ou o aviso do P20 (`role="status"`). */
export interface SwitchNotice {
  kind: "hint" | "text" | "warning";
  text: string;
}

/** Os textos embaixo dos interruptores (T4). Vazio quando não há nada a dizer. */
export interface MinistrySwitchNotices {
  /** Embaixo de "É Pastor(a)?", no lugar de "Tem Liderança?" e do Líder. */
  pastor: SwitchNotice[];
  /** Embaixo de "Tem Liderança?" desligado: a dica ou, com líder escondido, o aviso no lugar dela. */
  leadership: SwitchNotice[];
  /** Embaixo de "Batizado(a)?" desligado com a data escondida. */
  baptism: SwitchNotice[];
}

/**
 * Os textos de cada interruptor, pelo estado e pela memória (P20, T4). O aviso "Ao salvar, {Nome}
 * deixa de ser o líder." fala do líder **gravado** (E2.07, RN-16, UXD-11): no cadastro novo, com o
 * líder só preenchido, não há aviso, apenas os textos de situação. Sem o nome do líder gravado (fora
 * do escopo ou não resolvido), também não: o aviso não sai com o nome em branco.
 */
export function ministrySwitchNotices(
  { state, memory }: MinistrySwitches,
  storedLeader: LeaderRef | null = null,
): MinistrySwitchNotices {
  const savedLeader = storedLeader?.name.trim() ? storedLeader : null;
  const pastor: SwitchNotice[] = [];
  const leadership: SwitchNotice[] = [];
  const baptism: SwitchNotice[] = [];
  if (state.is_pastor) {
    pastor.push({ kind: "text", text: MEMBER_HINT_TEXTS.pastorHasNoLeader });
    if (memory.leader && savedLeader) pastor.push({ kind: "warning", text: MEMBER_HINT_TEXTS.leaderRemoved(savedLeader.name) });
  } else if (!state.has_leadership) {
    leadership.push(
      memory.leader && savedLeader
        ? { kind: "warning", text: MEMBER_HINT_TEXTS.leaderRemovedNoLeadership(savedLeader.name) }
        : { kind: "hint", text: MEMBER_HINT_TEXTS.noLeadership },
    );
  }
  if (!state.is_baptized && memory.baptismDate) {
    baptism.push({ kind: "warning", text: MEMBER_HINT_TEXTS.baptismDateRemoved(formatIsoDateBr(memory.baptismDate)) });
  }
  return { pastor, leadership, baptism };
}

/** Os valores que vão para o banco: o estado visível, sem o que está escondido. */
export function ministrySwitchValues({ state }: MinistrySwitches): {
  is_pastor: boolean;
  has_leadership: boolean;
  leader_id: string | null;
  is_baptized: boolean;
  baptism_date: string | null;
} {
  return {
    is_pastor: state.is_pastor,
    has_leadership: state.is_pastor ? false : state.has_leadership,
    leader_id: state.is_pastor || !state.has_leadership ? null : (state.leader?.id ?? null),
    is_baptized: state.is_baptized,
    baptism_date: state.is_baptized ? state.baptism_date : null,
  };
}
