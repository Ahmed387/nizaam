import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { fetchPartnerCards, salaryText, type PartnerCards } from "@/lib/partners";
import { PartnerCardsRow } from "./PartnerCardsRow";

/**
 * «حسابك كشريك» on an employee's own home when he is also a partner («موظف وشريك», 0137) — read only, his own record only
 * (partner_users → partner_cards checks it on the server). The owner / managers and plain partners have their own pages.
 */
export function MyPartnerAccount() {
  const { user, isOwner, isAdmin, hasRole } = useAuth();
  const [cards, setCards] = useState<PartnerCards | null>(null);
  const [open, setOpen] = useState(false);
  const skip = !user || isOwner || isAdmin || hasRole("partner");

  useEffect(() => {
    if (skip) return;
    supabase.from("partner_users" as any).select("partner_id").eq("user_id", user!.id).eq("is_active", true).limit(1).maybeSingle()
      .then(async ({ data }) => {
        const id = (data as any)?.partner_id;
        if (id) setCards(await fetchPartnerCards(id).catch(() => null));
      });
  }, [skip, user?.id]);

  if (skip || !cards) return null;
  return (
    <Card className="mb-4">
      <CardHeader className="flex flex-row items-center justify-between gap-2 py-3">
        <div>
          <CardTitle className="text-base">حسابك كشريك</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">{salaryText(cards.partner)}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </Button>
      </CardHeader>
      {open && <CardContent><PartnerCardsRow cards={cards} /></CardContent>}
    </Card>
  );
}
