import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { toast as sonnerToast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { dismiss as dismissToasts } from "@/hooks/use-toast";
import { MEMBER_ROW_SELECT, type MemberRow } from "@/lib/members/fields";
import { SERVER_ERROR, type SignInOutcome } from "@/lib/auth/sign-in-result";
import { shouldEndSession } from "@/lib/auth/session";
import { isFocusCheckDue, setGateHandler, setSessionCheckHandler, singleFlight } from "@/lib/auth/session-check";
import { gateCode, type GateCode } from "@/lib/errors";
import { requestSignIn } from "@/services/auth/sign-in";
import { refreshAccess, useAccessQuery } from "@/hooks/use-access";
import { hasPermission as accessHasPermission, type Access } from "@/lib/access/access";
import type { PermissionAction } from "@/lib/access/permissions";

type Member = MemberRow;

interface AuthContextType {
  session: Session | null;
  user: User | null;
  member: Member | null;
  /**
   * O acesso de quem está logado, pela `my_access()` (E2.02): permissões
   * efetivas, função e alcance. `null` sem sessão ou antes da primeira
   * leitura. É relido sem sair e entrar (RN-08, `use-access`).
   */
  access: Access | null;
  loading: boolean;
  /**
   * O acesso do usuário logado já chegou (ou não há sessão). Antes disso,
   * `hasPermission` responde `false` para tudo: uma tela protegida por
   * permissão espera, em vez de dizer que o usuário não tem acesso.
   */
  permissionsLoaded: boolean;
  /** A primeira leitura do acesso falhou (T12): a área principal mostra o aviso com "Tentar de novo". */
  accessLoadFailed: boolean;
  retryAccess: () => void;
  signIn: (identifier: string, password: string) => Promise<SignInOutcome>;
  signOut: () => Promise<void>;
  /**
   * A sessão terminou sem a pessoa pedir (cadastro excluído, renovação
   * recusada; E2.01, RN-14). O `ProtectedRoute` leva ao login com o aviso.
   * Volta a `false` no próximo login.
   */
  sessionEnded: boolean;
  /** Só mostra ou esconde: quem protege é o banco. As permissões aposentadas não liberam nada (RN-22). */
  hasPermission: (...permissions: PermissionAction[]) => boolean;
  /**
   * A conta tem a marca de troca obrigatória (E2.03, RN-08 a RN-10). Enquanto
   * vale, o acesso e o próprio cadastro não são lidos (RN-09 b), e as rotas
   * levam à troca (`/change-password`).
   */
  mustChangePassword: boolean;
  /** A marca já foi lida para a sessão atual (ou não há sessão). Antes disso, as rotas esperam. */
  passwordStatusLoaded: boolean;
  /** Depois da troca obrigatória: tira a marca, renova a sessão (as outras abas releem) e relê o acesso (P13). */
  completeForcedChange: () => Promise<void>;
  /** Relê a marca (`not_flagged` na troca obrigatória, DA-14). */
  recheckPasswordStatus: () => Promise<void>;
}

/** A marca de troca obrigatória da sessão atual: ainda não lida, exigida ou não. */
type PasswordStatus = "unknown" | "required" | "ok";

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** Fim forçado da sessão: nenhum aviso da tela anterior fica por cima do login (E2.01, PR 6). */
function dismissOpenToasts() {
  dismissToasts();
  sonnerToast.dismiss();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [passwordStatus, setPasswordStatusState] = useState<PasswordStatus>("unknown");
  // Muda a cada login e renovação da sessão: o próprio cadastro é relido.
  const [memberReload, setMemberReload] = useState(0);
  const queryClient = useQueryClient();
  // O usuário da sessão atual, para a verificação ler sem depender do render.
  const userIdRef = useRef<string | null>(null);
  // O próximo SIGNED_OUT foi pedido pela pessoa (botão Sair): sem aviso.
  const signOutRequestedRef = useRef(false);
  const lastFocusCheckRef = useRef<number | null>(null);
  // O fim forçado está em andamento: um evento com sessão (renovação) até o SIGNED_OUT não apaga o aviso.
  const endingRef = useRef(false);
  // A marca e o usuário a que ela pertence, para os eventos lerem sem depender do render.
  const passwordStatusRef = useRef<PasswordStatus>("unknown");
  const statusOwnerRef = useRef<string | null>(null);
  // A marca que a `sign-in` devolveu, para o SIGNED_IN do login usar sem esperar outra leitura.
  const signInStatusRef = useRef<PasswordStatus | null>(null);
  // Só a leitura da marca mais recente vale (uma resposta antiga não desfaz uma nova).
  const statusReadSeq = useRef(0);

  const setPasswordStatus = useCallback((owner: string | null, status: PasswordStatus) => {
    statusOwnerRef.current = owner;
    passwordStatusRef.current = status;
    setPasswordStatusState(status);
  }, []);

  // Com a marca, nada de acesso nem de cadastro (E2.03, RN-09 b): o banco recusaria.
  const canReadAccount = !!user && passwordStatus === "ok";

  // O acesso (permissões, função e alcance) vem da `my_access()`, com a chave do usuário da sessão.
  const { access, loadFailed: accessLoadFailed, retry: retryAccess } = useAccessQuery(canReadAccount ? user.id : null);

  useEffect(() => {
    if (!user) {
      setMember(null);
      return;
    }
    if (!canReadAccount) return;
    const userId = user.id;
    // Pela members_view: o próprio cadastro vem sem máscara.
    void supabase
      .from("members_view")
      .select(MEMBER_ROW_SELECT)
      .eq("auth_user_id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (userIdRef.current === userId) setMember(data);
      });
  }, [user, canReadAccount, memberReload]);

  /**
   * Encerra a sessão só neste navegador, com o aviso de sessão encerrada (E2.01,
   * RN-14; E2.03, RN-16): as sessões no servidor já foram apagadas. O
   * `ProtectedRoute` leva ao login com o aviso.
   */
  const endSessionLocally = useCallback(async () => {
    if (endingRef.current) return;
    // O aviso antes de a sessão sumir: o ProtectedRoute redireciona já com ele.
    endingRef.current = true;
    setSessionEnded(true);
    dismissOpenToasts();
    // Sem log_auth_event: o banco não grava para cadastro excluído (DA-9) nem para sessão apagada.
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) {
      // O SIGNED_OUT não veio: limpa à mão.
      endingRef.current = false;
      userIdRef.current = null;
      setSession(null);
      setUser(null);
      setMember(null);
      setPasswordStatus(null, "unknown");
      queryClient.clear();
    }
  }, [queryClient, setPasswordStatus]);

  /**
   * Lê a marca de troca obrigatória (`my_password_status`, E2.03, DT-05). A
   * sessão apagada encerra a sessão local (RN-16). Outro erro mantém o que já
   * se sabia e, sem nada lido, segue sem a marca: o portão do banco ainda
   * leva à troca pelo código.
   */
  const readPasswordStatus = useCallback(
    async (userId: string) => {
      const seq = ++statusReadSeq.current;
      const { data, error } = await supabase.rpc("my_password_status");
      if (seq !== statusReadSeq.current || userIdRef.current !== userId) return;
      if (error) {
        if (gateCode(error) === "session_ended") {
          void endSessionLocally();
          return;
        }
        if (passwordStatusRef.current === "unknown") setPasswordStatus(userId, "ok");
        return;
      }
      const row = Array.isArray(data) ? data[0] : null;
      setPasswordStatus(userId, row?.must_change_password === true ? "required" : "ok");
    },
    [endSessionLocally, setPasswordStatus],
  );

  /** Uma sessão chegou (abertura, login, renovação): a marca é a do login ou é lida. */
  const onSessionUser = useCallback(
    (userId: string, reread: boolean) => {
      const preset = signInStatusRef.current;
      signInStatusRef.current = null;
      if (preset) {
        setPasswordStatus(userId, preset);
        return;
      }
      if (statusOwnerRef.current !== userId) setPasswordStatus(userId, "unknown");
      else if (!reread) return;
      // Fora do `onAuthStateChange`: uma chamada ao Supabase dentro dele espera a trava da sessão.
      setTimeout(() => void readPasswordStatus(userId), 0);
    },
    [readPasswordStatus, setPasswordStatus],
  );

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        userIdRef.current = session?.user.id ?? null;
        if (event === "SIGNED_OUT") {
          // Sem o pedido da pessoa (renovação recusada, outra aba, fim forçado): o login mostra o aviso.
          if (!signOutRequestedRef.current) {
            setSessionEnded(true);
            dismissOpenToasts();
          }
          signOutRequestedRef.current = false;
          endingRef.current = false;
          // Nada do usuário anterior fica na memória para o próximo login.
          queryClient.clear();
        } else if (session && !endingRef.current) {
          setSessionEnded(false);
        }
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          // Login e renovação releem a marca (a troca em outra aba renova a sessão, T2).
          onSessionUser(session.user.id, event === "SIGNED_IN" || event === "TOKEN_REFRESHED");
          setMemberReload((n) => n + 1);
          // Sessão renovada: relê o acesso (T12).
          if (event === "TOKEN_REFRESHED") void refreshAccess(queryClient);
        } else {
          setPasswordStatus(null, "unknown");
          setMember(null);
        }
        setLoading(false);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      userIdRef.current = session?.user.id ?? null;
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) onSessionUser(session.user.id, false);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [queryClient, onSessionUser, setPasswordStatus]);

  /**
   * Relê o próprio cadastro na `members_view` (E2.01, RN-14 e DT-20). Sem
   * linha e sem erro, o cadastro foi excluído: encerra a sessão só neste
   * navegador. Qualquer erro, inclusive a queda de conexão, mantém a sessão.
   * Com a marca de troca, não lê nada (E2.03, RN-09 b). Uma releitura por vez.
   */
  const [verifySession] = useState(() =>
    singleFlight(async () => {
      const userId = userIdRef.current;
      if (!userId || passwordStatusRef.current === "required") return;
      const result = await supabase
        .from("members_view")
        .select("id")
        .eq("auth_user_id", userId)
        .maybeSingle();
      // A sessão mudou durante a releitura (saída, outro login): a resposta não vale mais.
      if (userIdRef.current !== userId || !shouldEndSession(result)) return;
      await endSessionLocally();
    }),
  );

  useEffect(() => setSessionCheckHandler(() => void verifySession()), [verifySession]);

  /**
   * O portão da senha (E2.03, AQ-3): a marca leva à troca, sem mensagem (o
   * `ProtectedRoute` redireciona); a sessão apagada vai ao login com o aviso.
   */
  const handleGateError = useCallback(
    (code: GateCode) => {
      if (!userIdRef.current) return;
      if (code === "password_change_required") setPasswordStatus(userIdRef.current, "required");
      else void endSessionLocally();
    },
    [endSessionLocally, setPasswordStatus],
  );

  useEffect(() => setGateHandler(handleGateError), [handleGateError]);

  // Volta da aba ou da janela: no máximo uma releitura a cada FOCUS_CHECK_INTERVAL_MS.
  const checkOnFocus = useCallback(() => {
    if (document.visibilityState !== "visible") return;
    const now = Date.now();
    if (!isFocusCheckDue(lastFocusCheckRef.current, now)) return;
    lastFocusCheckRef.current = now;
    void verifySession();
    if (userIdRef.current) void readPasswordStatus(userIdRef.current);
  }, [verifySession, readPasswordStatus]);

  useEffect(() => {
    document.addEventListener("visibilitychange", checkOnFocus);
    window.addEventListener("focus", checkOnFocus);
    return () => {
      document.removeEventListener("visibilitychange", checkOnFocus);
      window.removeEventListener("focus", checkOnFocus);
    };
  }, [checkOnFocus]);

  /**
   * Login pela Edge Function `sign-in` (E1.04, RN-13 e RN-14): o único caminho.
   * As falhas esperadas voltam como resultado, sem exceção. No sucesso, a
   * sessão devolvida pela função passa ao cliente do Supabase, que a renova e
   * a guarda como antes. A marca de troca obrigatória (E2.03) entra antes da
   * sessão, para nenhuma tela abrir antes da troca. O login é registrado na
   * Auditoria pelo servidor.
   */
  const signIn = async (identifier: string, password: string): Promise<SignInOutcome> => {
    const result = await requestSignIn(identifier, password);
    if (result.result !== "ok") return result;

    signInStatusRef.current = result.mustChangePassword ? "required" : "ok";
    const { error } = await supabase.auth.setSession({
      access_token: result.session.access_token,
      refresh_token: result.session.refresh_token,
    });
    if (error) {
      signInStatusRef.current = null;
      return SERVER_ERROR;
    }
    setSessionEnded(false);
    return { result: "ok", mustChangePassword: result.mustChangePassword };
  };

  const signOut = async () => {
    await supabase.rpc("log_auth_event", {
      _action: "logout",
      _success: true,
      _identifier: null,
      _reason: null,
    }).then(() => {}, () => {});
    signOutRequestedRef.current = true;
    const { error } = await supabase.auth.signOut();
    // A saída não aconteceu (sem conexão): o próximo SIGNED_OUT não é o deste pedido.
    if (error) signOutRequestedRef.current = false;
  };

  const completeForcedChange = useCallback(async () => {
    const userId = userIdRef.current;
    if (!userId) return;
    setPasswordStatus(userId, "ok");
    // As outras abas recebem a sessão renovada e releem a marca (T2).
    await supabase.auth.refreshSession().then(() => {}, () => {});
    void refreshAccess(queryClient);
  }, [queryClient, setPasswordStatus]);

  const recheckPasswordStatus = useCallback(async () => {
    if (userIdRef.current) await readPasswordStatus(userIdRef.current);
  }, [readPasswordStatus]);

  const hasPermission = (...perms: PermissionAction[]) => accessHasPermission(access, ...perms);

  const permissionsLoaded = !loading && (!user || access !== null);

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        member,
        access,
        loading,
        permissionsLoaded,
        accessLoadFailed,
        retryAccess,
        signIn,
        signOut,
        sessionEnded,
        hasPermission,
        mustChangePassword: !!session && passwordStatus === "required",
        passwordStatusLoaded: !session || passwordStatus !== "unknown",
        completeForcedChange,
        recheckPasswordStatus,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
