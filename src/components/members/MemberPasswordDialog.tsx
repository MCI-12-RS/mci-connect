import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { isJsonObject } from "@/lib/errors";
import { MEMBER_FORM_LAYOUT_TEXTS } from "@/lib/members/texts";

const TEXTS = MEMBER_FORM_LAYOUT_TEXTS.password;
const MIN_LENGTH = 6;

interface MemberPasswordDialogProps {
  member: { id: string; name: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** "Alterar Senha" de outro membro, como antes (a política é do E2.03). */
export function MemberPasswordDialog({ member, open, onOpenChange }: MemberPasswordDialogProps) {
  const { toast } = useToast();
  const [newPassword, setNewPassword] = useState("");
  const [changing, setChanging] = useState(false);

  const changePassword = async () => {
    if (newPassword.length < MIN_LENGTH) {
      toast({ variant: "destructive", title: TEXTS.tooShort });
      return;
    }
    setChanging(true);
    try {
      const { data, error } = await supabase.functions.invoke("change-member-password", {
        body: { member_id: member.id, new_password: newPassword },
      });
      if (error) throw error;
      if (isJsonObject(data) && typeof data.error === "string") throw new Error(data.error);
      toast({ title: TEXTS.changed });
      onOpenChange(false);
      setNewPassword("");
    } catch (err) {
      toast({ variant: "destructive", title: TEXTS.failed, description: err instanceof Error ? err.message : String(err) });
    } finally {
      setChanging(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{TEXTS.dialogTitle(member.name)}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new_password">{TEXTS.newPassword}</Label>
            <Input
              id="new_password"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder={TEXTS.newPasswordPlaceholder}
            />
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {MEMBER_FORM_LAYOUT_TEXTS.buttons.cancel}
            </Button>
            <Button type="button" onClick={changePassword} disabled={changing || newPassword.length < MIN_LENGTH}>
              {changing ? TEXTS.changing : TEXTS.change}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
