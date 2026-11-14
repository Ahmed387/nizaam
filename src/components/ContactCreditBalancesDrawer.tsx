import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/DataTable";
import { formatEGP } from "@/lib/format";
import { fetchAllContactsPage, type ContactPageRow, type Side } from "@/lib/ledger";
import { netOf } from "@/lib/netBalance";
import { InternalBranchBadge } from "@/components/contact/InternalBranchBadge";
import { Search } from "lucide-react";

/**
 * Accounts by their ONE current-account balance (owner 2026-11-14 «نقفل حوار الفواتير المفتوحة والمغلقة»):
 * side "customer" = accounts دائن (علينا ليهم), side "supplier" = accounts مدين (لنا عندهم) — the two cards of the main
 * till. No «unused money» / open invoices: the number is the account's balance, the row opens the account file.
 */
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side: Side;
}

const typeLabel = (type: string) => (type === "customer" ? "عميل" : type === "supplier" ? "مورد" : "عميل ومورد");

export function ContactCreditBalancesDrawer({ open, onOpenChange, side }: Props) {
  const nav = useNavigate();
  const credit = side === "customer";
  const [rows, setRows] = useState<ContactPageRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    fetchAllContactsPage({ branchId: null, type: "all", balance: [credit ? "credit" : "debit"] })
      .then((p) => { if (!cancelled) setRows(p.rows); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, credit]);

  const amountOf = (r: ContactPageRow) => Math.abs(netOf(r.customer_balance, r.supplier_balance));
  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("ar-EG");
    return rows
      .filter((r) => !q || `${r.name} ${r.phone ?? ""}`.toLocaleLowerCase("ar-EG").includes(q))
      .sort((a, b) => amountOf(b) - amountOf(a));
  }, [rows, search]);
  const total = Math.round(filtered.reduce((s, r) => s + amountOf(r), 0) * 100) / 100;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-full sm:max-w-3xl overflow-y-auto" dir="rtl">
        <SheetHeader>
          <SheetTitle>{credit ? "حسابات دائنة — علينا ليهم" : "حسابات مدينة — لنا عندهم"}</SheetTitle>
          <SheetDescription>
            {credit ? "كل حساب رصيده الحالي دائن في كل الفروع (حساب جاري)." : "كل حساب رصيده الحالي مدين في كل الفروع (حساب جاري)."}
            {" "}الإجمالي: <b>{formatEGP(total)}</b> — {filtered.length} حساب.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex items-center gap-2">
          <Search className="w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث بالاسم أو التليفون" />
        </div>

        <div className="mt-4">
          <DataTable
            loading={loading}
            rows={filtered}
            empty="مفيش حسابات"
            onRowClick={(r: any) => nav(`/admin/contacts/${r.id}`)}
            columns={[
              { key: "name", header: "اسم الحساب", render: (r: any) => <div><div className="font-semibold">{r.name}<InternalBranchBadge id={r.id} /></div><div className="text-xs text-muted-foreground">{typeLabel(r.type)}</div></div> },
              { key: "phone", header: "التليفون", render: (r: any) => <span dir="ltr">{r.phone ?? "—"}</span> },
              { key: "bal", header: "الرصيد الحالى", render: (r: any) => <b className={credit ? "text-destructive" : "text-success"}>{formatEGP(amountOf(r))} {credit ? "دائن" : "مدين"}</b> },
              { key: "go", header: "", render: (r: any) => (
                <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); nav(`/admin/contacts/${r.id}`); }}>الملف</Button>
              ) },
            ]}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
