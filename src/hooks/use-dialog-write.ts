import { useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { DELETION_TEXTS } from "@/lib/deletion/texts";
import type { WriteResult } from "@/lib/deletion/outcome";
import type { AppError } from "@/lib/errors";

/** Textos e reação de uma gravação do diálogo (excluir, inativar). */
export interface WriteResultHandlers {
  /** Toast do sucesso: "Célula excluída.". */
  doneText: string;
  /** Aviso no diálogo na queda de conexão. */
  networkText: string;
  /** Aviso no diálogo numa falha técnica ou inesperada ("tente de novo", RN-20). */
  unexpectedText: string;
  /** Recusa de uma regra: quem chama decide se troca o conteúdo ou mostra a mensagem. */
  onRefused: (refusal: AppError) => void;
}

/**
 * Gravações de um diálogo de exclusão (E2.01, T2 e "Estados"): uma por vez
 * (um toque duplo não faz duas chamadas, UX-06) e, conforme o resultado,
 * fecha com o toast, avisa no próprio diálogo ou entrega a recusa.
 *
 * - feita: toast do sucesso e fecha;
 * - sumiu no meio tempo: toast informativo e fecha (UX-24);
 * - sem permissão: toast "Você não tem permissão para esta ação." e fecha (UX-39);
 * - recusa de regra: `onRefused`;
 * - queda de conexão ou falha técnica: o aviso no diálogo, que continua aberto.
 */
export function useDialogWrite(onClose: () => void) {
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);

  const handleResult = (result: WriteResult, handlers: WriteResultHandlers) => {
    switch (result.kind) {
      case "done":
        toast({ title: handlers.doneText });
        onClose();
        return;
      case "gone":
        toast({ title: result.message });
        onClose();
        return;
      case "forbidden":
        toast({ variant: "destructive", title: DELETION_TEXTS.permissionDenied });
        onClose();
        return;
      case "refused":
        handlers.onRefused(result.refusal);
        return;
      case "network":
        setError(handlers.networkText);
        return;
      case "unexpected":
        setError(handlers.unexpectedText);
    }
  };

  /** Grava, se não houver outra gravação em andamento. Uma falha não classificada pede para tentar de novo. */
  const send = (write: () => Promise<WriteResult>, handlers: WriteResultHandlers) => {
    if (sending.current) return;
    sending.current = true;
    setError(null);
    void write()
      .then((result) => handleResult(result, handlers))
      .catch(() => setError(handlers.unexpectedText))
      .finally(() => {
        sending.current = false;
      });
  };

  return { error, setError, send };
}
