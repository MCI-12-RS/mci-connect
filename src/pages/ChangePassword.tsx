import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Loader2, LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PasswordChangeFields } from "@/components/auth/PasswordChangeFields";
import { useToast } from "@/hooks/use-toast";
import { usePasswordChangeForm } from "@/hooks/use-password-change-form";
import { FORCED_CHANGE_TEXTS, PASSWORD_CHANGE_TEXTS } from "@/lib/auth/password-texts";
import { usernameFromState } from "@/lib/auth/password-change-route";
import logo from "@/assets/logo.png";

/**
 * Troca obrigatória (E2.03, T2, RN-10, P18): antes de qualquer outra tela,
 * fora do `AppLayout`, no visual do login. Só "Salvar nova senha" e "Sair".
 */
const ChangePassword = () => {
  const { completeForcedChange, recheckPasswordStatus, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const titleRef = useRef<HTMLHeadingElement>(null);
  // A identificação usada no login, para o gerenciador de senhas atualizar a conta certa (T2).
  const username = usernameFromState(location.state);

  const form = usePasswordChangeForm({
    mode: "forced",
    personal: null,
    onSuccess: () => {
      void completeForcedChange();
      navigate("/", { replace: true });
      toast({ title: FORCED_CHANGE_TEXTS.success });
    },
    // Na mesma sessão, `not_flagged` quer dizer que a troca já foi feita daqui (DA-14).
    onNotFlagged: () => void recheckPasswordStatus(),
  });

  // O foco começa no título: o leitor de tela anuncia onde a pessoa está, e o teclado não abre (UXD-2).
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const busy = form.submitting;

  return (
    <main className="min-h-dvh flex items-center justify-center bg-primary p-4">
      <Card className="w-full sm:max-w-md">
        <CardHeader className="space-y-4 pb-2">
          <div className="mx-auto h-14 w-14 overflow-hidden rounded-full bg-secondary/20 flex items-center justify-center">
            <img src={logo} alt={FORCED_CHANGE_TEXTS.logoAlt} className="h-full w-full object-cover" />
          </div>
          <h1
            ref={titleRef}
            tabIndex={-1}
            className="text-xl font-semibold leading-tight focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          >
            {FORCED_CHANGE_TEXTS.title}
          </h1>
          <p className="text-sm text-muted-foreground">{FORCED_CHANGE_TEXTS.intro}</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={(event) => void form.handleSubmit(event)} noValidate className="space-y-4">
            {username && (
              <input
                type="text"
                name="username"
                autoComplete="username"
                value={username}
                readOnly
                hidden
                aria-hidden="true"
                tabIndex={-1}
              />
            )}
            <PasswordChangeFields idPrefix="forced-change" form={form} />
            <Button type="submit" size="lg" className="w-full h-11" disabled={busy}>
              {busy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  {PASSWORD_CHANGE_TEXTS.submitting}
                </>
              ) : (
                PASSWORD_CHANGE_TEXTS.submit
              )}
            </Button>
          </form>
          <Button
            type="button"
            variant="ghost"
            size="lg"
            className="mt-4 w-full h-11"
            disabled={busy}
            onClick={() => void signOut()}
          >
            <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
            {FORCED_CHANGE_TEXTS.signOut}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
};

export default ChangePassword;
