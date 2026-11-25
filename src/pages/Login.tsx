import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AlertCircle, Clock, Eye, EyeOff, Info, Loader2, WifiOff, type LucideIcon } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { checkBeforeSubmit, identifierIndicatorLabel } from "@/lib/auth/identifier";
import {
  LOGIN_TEXTS,
  isSessionEndedState,
  loginNoticeText,
  noticeForOutcome,
  type LoginNotice,
} from "@/lib/auth/session";
import { cn } from "@/lib/utils";
import logo from "@/assets/logo.png";

const MESSAGE_ID = "login-message";

type FocusTarget = "identifier" | "password" | "message" | null;

interface InvalidFields {
  identifier: boolean;
  password: boolean;
}

const NO_INVALID_FIELDS: InvalidFields = { identifier: false, password: false };

const NOTICE_ICONS: Record<LoginNotice["kind"], LucideIcon> = {
  session_ended: Info,
  empty_fields: AlertCircle,
  invalid_format: AlertCircle,
  invalid_credentials: AlertCircle,
  locked: Clock,
  connection: WifiOff,
};

/**
 * O papel de cada mensagem para o leitor de tela (UXD-3): o aviso de sessão é
 * `status`; o bloqueio recebe o foco e não usa `alert`, para não ser lido duas
 * vezes; as demais são `alert`.
 */
function noticeRole(notice: LoginNotice): "status" | "alert" | undefined {
  if (notice.kind === "session_ended") return "status";
  if (notice.kind === "locked") return undefined;
  return "alert";
}

const Login = () => {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Aviso de sessão encerrada (E2.01, PR 6): chega pelo estado da navegação e é lido uma vez só.
  const [arrivedAfterSessionEnd] = useState(() => isSessionEndedState(location.state));
  const [notice, setNotice] = useState<LoginNotice | null>(() =>
    arrivedAfterSessionEnd ? { kind: "session_ended" } : null,
  );
  // Monta a mensagem de novo a cada resposta, para ser anunciada mesmo com o mesmo texto (UX-04).
  const [attempt, setAttempt] = useState(0);
  const [invalid, setInvalid] = useState<InvalidFields>(NO_INVALID_FIELDS);
  // Com o aviso, o foco começa na Identificação, que é descrita por ele: o leitor de tela lê os dois.
  const [focusTarget, setFocusTarget] = useState<FocusTarget>(() => (arrivedAfterSessionEnd ? "identifier" : null));

  const identifierRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  const submittingRef = useRef(false);

  const indicator = identifierIndicatorLabel(identifier);

  // O aviso fica no estado da tela; tirado do histórico, recarregar ou voltar não o mostra de novo.
  useEffect(() => {
    if (isSessionEndedState(location.state)) navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);

  // O foco vai para o que a pessoa faz em seguida (UXD-3), depois de a mensagem estar na tela.
  useEffect(() => {
    if (!focusTarget) return;
    const target = { identifier: identifierRef, password: passwordRef, message: messageRef }[focusTarget];
    target.current?.focus();
    setFocusTarget(null);
  }, [focusTarget, attempt]);

  // O bloqueio some sozinho, sem anúncio, depois dos {N} minutos (UXD-2, UX-06).
  useEffect(() => {
    if (notice?.kind !== "locked") return;
    const timer = setTimeout(() => setNotice(null), notice.minutes * 60_000);
    return () => clearTimeout(timer);
  }, [notice, attempt]);

  const showNotice = (next: LoginNotice | null, focus: FocusTarget, nextInvalid = NO_INVALID_FIELDS) => {
    setNotice(next);
    setInvalid(nextInvalid);
    setAttempt((n) => n + 1);
    setFocusTarget(focus);
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submittingRef.current) return;
    setShowPassword(false);

    const problem = checkBeforeSubmit(identifier, password);
    if (problem?.kind === "empty_fields") {
      showNotice({ kind: "empty_fields" }, problem.identifierEmpty ? "identifier" : "password", {
        identifier: problem.identifierEmpty,
        password: problem.passwordEmpty,
      });
      return;
    }
    if (problem?.kind === "invalid_format") {
      showNotice({ kind: "invalid_format" }, "identifier", { identifier: true, password: false });
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setInvalid(NO_INVALID_FIELDS);
    try {
      const outcome = await signIn(identifier, password);
      if (outcome.result === "ok") {
        navigate("/");
        return;
      }
      const next = noticeForOutcome(outcome);
      if (outcome.result === "invalid_credentials") {
        setPassword("");
        showNotice(next, "password");
      } else if (outcome.result === "locked") {
        setPassword("");
        showNotice(next, "message");
      } else if (outcome.result === "empty_fields") {
        // A tela já confere os campos vazios; o servidor só repete a conferência.
        showNotice(next, "identifier");
      } else {
        // Conexão ou servidor: nada é limpo e o foco não muda (UXD-3).
        showNotice(next, null);
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  // Enter na Identificação com a senha vazia só avança para a Senha (UXD-7).
  const handleIdentifierKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && password === "") {
      e.preventDefault();
      passwordRef.current?.focus();
    }
  };

  const togglePassword = () => {
    setShowPassword((shown) => !shown);
    passwordRef.current?.focus();
  };

  const NoticeIcon = notice ? NOTICE_ICONS[notice.kind] : null;
  const isError = notice !== null && notice.kind !== "session_ended";

  return (
    <div className="min-h-dvh flex items-center justify-center bg-primary p-4">
      <Card className="w-full max-w-md animate-fade-in motion-reduce:animate-none">
        <CardHeader className="text-center space-y-4 pb-2">
          <h1 className="sr-only">{LOGIN_TEXTS.title}</h1>
          <div className="mx-auto w-20 h-20 rounded-full overflow-hidden bg-secondary/20 flex items-center justify-center">
            <img src={logo} alt={LOGIN_TEXTS.logoAlt} className="w-full h-full object-cover" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{LOGIN_TEXTS.churchName}</p>
            <p className="text-sm text-muted-foreground">{LOGIN_TEXTS.churchCity}</p>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            {notice && NoticeIcon && (
              <Alert
                key={attempt}
                id={MESSAGE_ID}
                ref={messageRef}
                role={noticeRole(notice)}
                tabIndex={notice.kind === "locked" ? -1 : undefined}
                variant={isError ? "destructive" : "default"}
                className={cn(
                  isError && "text-foreground dark:[&>svg]:text-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                <NoticeIcon className="h-4 w-4" aria-hidden="true" />
                <AlertDescription>{loginNoticeText(notice)}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor="login">{LOGIN_TEXTS.identifierLabel}</Label>
                {indicator && (
                  <Badge
                    variant="outline"
                    data-testid="identifier-indicator"
                    className="animate-in fade-in zoom-in-95 duration-200 motion-reduce:animate-none"
                  >
                    {indicator}
                  </Badge>
                )}
              </div>
              <Input
                id="login"
                ref={identifierRef}
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                onKeyDown={handleIdentifierKeyDown}
                placeholder={LOGIN_TEXTS.identifierPlaceholder}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="next"
                required
                aria-invalid={invalid.identifier || undefined}
                aria-describedby={invalid.identifier || notice?.kind === "session_ended" ? MESSAGE_ID : undefined}
                className="h-11"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">{LOGIN_TEXTS.passwordLabel}</Label>
              <div className="relative">
                <Input
                  id="password"
                  ref={passwordRef}
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  enterKeyHint="go"
                  required
                  aria-invalid={invalid.password || undefined}
                  aria-describedby={invalid.password ? MESSAGE_ID : undefined}
                  className="h-11 pr-12"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-11 w-11"
                  onClick={togglePassword}
                  aria-label={showPassword ? LOGIN_TEXTS.hidePassword : LOGIN_TEXTS.showPassword}
                  aria-pressed={showPassword}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                </Button>
              </div>
            </div>

            <Button type="submit" size="lg" className="w-full" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  {LOGIN_TEXTS.submitting}
                </>
              ) : (
                LOGIN_TEXTS.submit
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default Login;
