// O que sai ao trocar a situação da reunião (E2.11, RN-09, P20, T4 e T9). Sem
// React e sem Supabase.
import { LEAVING_TEXTS } from "./texts";
import { formatOffering } from "./offering";

/** O que está preenchido da célula realizada. */
export interface HeldContent {
  theme: string;
  /** No lançamento, os escolhidos; na edição, todos os participantes. */
  participants: number;
  visitors: number;
  /** O valor da oferta, ou `null` sem oferta. */
  offering: number | null;
  observations: string;
}

function items(content: HeldContent, participantItem: (n: number) => string): string[] {
  const list: string[] = [];
  if (content.theme.trim() !== "") list.push(LEAVING_TEXTS.items.theme);
  if (content.participants > 0) list.push(participantItem(content.participants));
  if (content.visitors > 0) list.push(LEAVING_TEXTS.items.visitors(content.visitors));
  if (content.offering !== null) list.push(LEAVING_TEXTS.items.offering(formatOffering(content.offering)));
  if (content.observations.trim() !== "") list.push(LEAVING_TEXTS.items.observations);
  return list;
}

/** No lançamento, "Ao enviar, não serão enviados: {itens}." (com um item, "não será enviado"); `null` sem nada preenchido. */
export function launchLeavingNotice(content: HeldContent): string | null {
  const list = items(content, LEAVING_TEXTS.items.chosen);
  return list.length > 0 ? LEAVING_TEXTS.launch(list) : null;
}

/**
 * Na edição: da célula realizada para "Não houve célula", "Ao salvar, saem do
 * relatório: {itens}." (com um item, "sai"); no sentido contrário, o texto fixo. `null` quando a
 * situação não mudou ou nada sai.
 */
export function editSwitchNotice(storedHeld: boolean, currentHeld: boolean, content: HeldContent): string | null {
  if (storedHeld === currentHeld) return null;
  if (!currentHeld) {
    const list = items(content, LEAVING_TEXTS.items.participants);
    return list.length > 0 ? LEAVING_TEXTS.edit(list) : null;
  }
  return LEAVING_TEXTS.toHeld;
}
