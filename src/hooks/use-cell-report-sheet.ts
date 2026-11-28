import { useCallback } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { closeMode, openedFromList, readReportParam, REPORT_PARAM } from "@/lib/cell-reports/report-sheet";

const stateObject = (state: unknown): Record<string, unknown> =>
  typeof state === "object" && state !== null ? { ...state } : {};

/**
 * A consulta "Ver relatório" na URL (E2.12, AQ-8, UXD-11): abrir pela linha acrescenta `report=<id>`
 * com uma entrada nova no histórico (o voltar fecha a consulta); fechar volta essa entrada ou, se a
 * consulta veio por link, tira o parâmetro com `replace`. O `report` sem formato sai junto com a
 * limpeza dos filtros (`useCellReportFilters`).
 */
export function useCellReportSheet() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const reportId = readReportParam(searchParams);

  const open = useCallback(
    (id: string) =>
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set(REPORT_PARAM, id);
          return next;
        },
        { state: { ...stateObject(location.state), reportFromList: true } },
      ),
    [setSearchParams, location.state],
  );

  const close = useCallback(() => {
    if (closeMode(location.state) === "back") {
      navigate(-1);
      return;
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(REPORT_PARAM);
        return next;
      },
      { replace: true, state: location.state },
    );
  }, [location.state, navigate, setSearchParams]);

  return { reportId, fromList: openedFromList(location.state), open, close };
}
