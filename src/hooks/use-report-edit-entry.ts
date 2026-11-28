import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { onReportEditEntry } from "@/lib/cell-reports/report-sheet";

const stateObject = (state: unknown): Record<string, unknown> =>
  typeof state === "object" && state !== null ? { ...state } : {};

export interface ReportEditEntry {
  /** O formulário de edição está aberto por cima da consulta. */
  open: boolean;
  /** Abre o formulário pela consulta, com uma entrada nova no histórico, no mesmo endereço. */
  start: () => void;
  /** Vai no `onClose` do formulário: salvar, cancelar e descartar tiram a entrada. */
  closed: () => void;
  /** Vão no `CellReportDialog`: o voltar do aparelho pede para fechar o formulário. */
  closeRequest: number;
  declined: () => void;
}

/**
 * "Editar relatório" aberto pela consulta, com uma entrada própria no histórico (E2.12, DA-11). O
 * voltar do aparelho tira só essa entrada e pede ao formulário para fechar, pelo caminho dele (com o
 * "Descartar as alterações?" quando houver mudança); "Continuar editando", ou o envio em andamento,
 * recria a entrada. Salvar, cancelar e descartar também tiram a entrada, e a consulta continua.
 * Uma entrada que sobra sem o formulário (recarregar com ele aberto, avançar) é tirada na hora, para
 * a consulta reabrir sozinha e o próximo voltar fechá-la.
 */
export function useReportEditEntry(): ReportEditEntry {
  const location = useLocation();
  const navigate = useNavigate();
  const onEntry = onReportEditEntry(location.state);
  const [open, setOpen] = useState(false);
  const [closeRequest, setCloseRequest] = useState(0);
  // A entrada do formulário aberto já chegou à URL (antes disso, a falta dela não é um voltar).
  const entryArrived = useRef(false);
  // Saindo da entrada por `navigate(-1)`: espera a navegação terminar.
  const leaving = useRef(false);

  const pushEntry = useCallback(() => {
    entryArrived.current = false;
    navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      { state: { ...stateObject(location.state), reportEdit: true } },
    );
  }, [location.hash, location.pathname, location.search, location.state, navigate]);

  useEffect(() => {
    if (leaving.current) {
      if (!onEntry) leaving.current = false;
      return;
    }
    if (open) {
      if (onEntry) entryArrived.current = true;
      else if (entryArrived.current) {
        // O voltar do aparelho tirou a entrada: o formulário decide se fecha.
        entryArrived.current = false;
        setCloseRequest((n) => n + 1);
      }
      return;
    }
    if (onEntry) {
      leaving.current = true;
      navigate(-1);
    }
  }, [onEntry, open, navigate, location.key]);

  const start = useCallback(() => {
    setOpen(true);
    pushEntry();
  }, [pushEntry]);

  const closed = useCallback(() => {
    setOpen(false);
    if (!onEntry && !entryArrived.current) return;
    entryArrived.current = false;
    leaving.current = true;
    navigate(-1);
  }, [navigate, onEntry]);

  return { open, start, closed, closeRequest, declined: pushEntry };
}
