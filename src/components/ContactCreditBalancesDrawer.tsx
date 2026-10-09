import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/DataTable";
import { formatEGP, formatDate } from "@/lib/format";
import { fetchAllContactsPage, fetchContactMoney, type ContactPageRow, type Side } from "@/lib/ledger";
import { Search } from "lucide-react";

/**
 * Money held on account, from the unified ledger (Step 6C): customer advances (2150) and our advances
 * with suppliers (1460) are two separate lists — never added together and never netted against a debt
 * of the other side. Each row opens the unused money movements of that contact and side.
 */
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side: Side;
}

const typeLabel = (type: string) => (type === "customer" ? "عميل" : type === "supplier" ? "مورد" : "عميل ومورد");

export function ContactCreditBalancesDrawer({ open, onOpenChange, side }: Props) {
  const nav = useNavigate();
  const [rows, setRows] = useState<ContactPageRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<{ id: string; name: string; lines: any[] } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setDetail(null);
    fetchAllContactsPage({ branchId: null, type: "all", balance: [side === "customer" ? "customer_advance" : "supplier_advance"] })
      .then((p) => { if (!cancelled) setRows(p.rows); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, side]);

  const advanceOf = (r: ContactPageRow) => (side === "customer" ? r.customer_advance : r.supplier_advance);
  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("ar-EG");
    return rows
      .filter((r) => !q || `${r.name} ${r.phone ?? ""}`.toLocaleLowerCase("ar-EG").includes(q))
      .sort((a, b) => advanceOf(b) - advanceOf(a));
  }, [rows, search, side]);
  const total = Math.round(filtered.reduce((s, r) => s + advanceOf(r), 0) * 100) / 100;

  const openDetail = async (r: ContactPageRow) => {
    const money = await fetchContactMoney(r.id, side).catch(() => []);
    setDetail({ id: r.id, name: r.name, lines: money.filter((m) => m.status === "active" && m.effect === "settle" && m.unallocated > 0.005) });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-full sm:max-w-3xl overflow-y-auto" dir="rtl">
        <SheetHeader>
          <SheetTitle>{side === "customer" ? "مقدمات العملاء عندنا (2150)" : "مقدماتنا عند الموردين (1460)"}</SheetTitle>
          <SheetDescription>
            {side === "customer"
              ? "فلوس دفعها العملاء ولسه ما اتخصمتش من فواتير. أول ما تتسجل فاتورة للعميل بتتخصم منها تلقائياً (الأقدم أولاً)."
              : "فلوس دفعناها للموردين مقدم ولسه ما اتخصمتش من فواتير شراء. بتتخصم تلقائياً من أقدم فاتورة شراء مفتوحة."}
            {" "}الجانبين منفصلين تماماً.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pr-9" placeholder="ابحث بالاسم أو التليفون" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="text-sm whitespace-nowrap">الإجمالي: <b>{formatEGP(total)}</b></div>
        </div>

        {!detail ? (
          <div className="mt-4">
            <DataTable
              loading={loading}
              rows={filtered}
              empty="مفيش مقدمات"
              onRowClick={(r: any) => openDetail(r)}
              columns={[
                { key: "name", header: "الجهة", render: (r: any) => <div><div className="font-semibold">{r.name}</div><div className="text-xs text-muted-foreground">{typeLabel(r.type)}</div></div> },
                { key: "phone", header: "التليفون", render: (r: any) => <span dir="ltr">{r.phone ?? "—"}</span> },
                { key: "adv", header: "المقدم المتاح", render: (r: any) => <b className="text-primary">{formatEGP(advanceOf(r))}</b> },
                { key: "open", header: side === "customer" ? "فواتير مفتوحة عليه" : "فواتير شراء مفتوحة", render: (r: any) => formatEGP(side === "customer" ? r.customer_open : r.supplier_open) },
                { key: "go", header: "", render: (r: any) => (
                  <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); nav(`/admin/contacts/${r.id}`); }}>الملف</Button>
                ) },
              ]}
            />
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-bold">{detail.name} — الحركات اللي لسه ليها رصيد</div>
              <Button size="sm" variant="ghost" onClick={() => setDetail(null)}>رجوع</Button>
            </div>
            <DataTable
              rows={detail.lines}
              empty="مفيش حركات"
              columns={[
                { key: "d", header: "التاريخ", render: (m: any) => formatDate(m.movement_date) },
                { key: "k", header: "النوع", render: (m: any) => m.kind_label },
                { key: "b", header: "الفرع", render: (m: any) => m.branch_name ?? "—" },
                { key: "r", header: "المرجع", render: (m: any) => m.reference ?? "—" },
                { key: "a", header: "المبلغ", render: (m: any) => formatEGP(m.amount) },
                { key: "u", header: "المتبقي منه", render: (m: any) => <b className="text-primary">{formatEGP(m.unallocated)}</b> },
              ]}
            />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
