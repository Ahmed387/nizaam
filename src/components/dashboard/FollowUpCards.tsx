import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeftRight, Calculator, ClipboardCheck, HandCoins, Package, Scale, Store, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { StatCard } from "@/components/StatCard";
import { formatEGP } from "@/lib/format";
import { followUpItems, type FollowUps } from "@/lib/followUps";

const ICONS = { approvals: ClipboardCheck, money: Wallet, stock: Package, other_income: ArrowLeftRight, count_diff: Scale, internal: Store, advances: HandCoins, shares: Calculator };

/**
 * «متابعة» (migration 0147): one card per thing the owner agreed to follow — filled by the server by itself, each card
 * opens the page where it is handled. Example: «طلبات موافقة مستنية 2», «تحويل فلوس مستني الاستلام 15,000».
 */
export function FollowUpCards() {
  const [data, setData] = useState<FollowUps | null>(null);
  useEffect(() => {
    (supabase.rpc as any)("owner_followups").then(({ data, error }: any) => { if (!error) setData(data as FollowUps); });
  }, []);
  if (!data) return null;
  const items = followUpItems(data);
  return (
    <div className="mb-6">
      <h2 className="text-lg font-bold mb-3">متابعة</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {items.map((it) => {
          const Icon = ICONS[it.key];
          return (
            <Link key={it.key} to={it.to} className="block hover:scale-[1.02] transition-transform" title={it.meaning}>
              <StatCard label={it.label} value={it.money ? formatEGP(it.value) : String(it.value)} hint={it.hint}
                icon={<Icon className="w-5 h-5" />} accent={it.attention ? "warning" : "secondary"}
                metricHint={{ meaning: it.meaning, source: "owner_followups (السيرفر، كل ما تفتح الصفحة)", formula: it.formula }} />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
