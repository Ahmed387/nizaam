import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP } from "@/lib/format";
import { Printer, ArrowRight, Search } from "lucide-react";
import JsBarcode from "jsbarcode";
import { toast } from "sonner";

interface PrintItem {
  id: string;
  name: string;
  sku: string;
  selling_price: number;
  copies: number;
}

export default function PrintBarcodes() {
  const { id: branchId } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const autoAll = searchParams.get("all") === "1";
  const [products, setProducts] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Record<string, PrintItem>>({});
  const [showPrice, setShowPrice] = useState(true);
  const [showName, setShowName] = useState(true);
  const printAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!branchId) return;
    supabase
      .from("products")
      .select("id, name, sku, selling_price")
      .eq("branch_id", branchId)
      .order("name")
      .then(({ data }) => {
        const list = data ?? [];
        setProducts(list);
        if (autoAll && list.length) {
          const all: Record<string, PrintItem> = {};
          list.forEach((p: any) => {
            all[p.id] = { id: p.id, name: p.name, sku: p.sku, selling_price: Number(p.selling_price), copies: 1 };
          });
          setSelected(all);
          toast.success(`تم اختيار ${list.length} منتج`);
        }
      });
  }, [branchId, autoAll]);

  const selectAll = () => {
    const all: Record<string, PrintItem> = {};
    (search ? filtered : products).forEach((p: any) => {
      all[p.id] = { id: p.id, name: p.name, sku: p.sku, selling_price: Number(p.selling_price), copies: selected[p.id]?.copies ?? 1 };
    });
    setSelected(all);
  };
  const clearAll = () => setSelected({});

  const filtered = products.filter(
    (p) => !search || p.name.includes(search) || p.sku?.includes(search)
  );

  const toggle = (p: any) => {
    setSelected((s) => {
      const next = { ...s };
      if (next[p.id]) delete next[p.id];
      else next[p.id] = { id: p.id, name: p.name, sku: p.sku, selling_price: Number(p.selling_price), copies: 1 };
      return next;
    });
  };

  const setCopies = (id: string, n: number) => {
    setSelected((s) => ({ ...s, [id]: { ...s[id], copies: Math.max(1, n) } }));
  };

  const allLabels = Object.values(selected).flatMap((it) =>
    Array.from({ length: it.copies }).map((_, i) => ({ ...it, key: `${it.id}-${i}` }))
  );

  // Render barcodes after labels change
  useEffect(() => {
    setTimeout(() => {
      allLabels.forEach((lbl) => {
        const el = document.getElementById(`bc-${lbl.key}`);
        if (el && lbl.sku) {
          try {
            JsBarcode(el, lbl.sku, {
              format: "CODE128",
              width: 1.6,
              height: 40,
              fontSize: 12,
              margin: 0,
              displayValue: true,
            });
          } catch (e) {
            console.error("Barcode error:", e);
          }
        }
      });
    }, 50);
  }, [allLabels.length, showPrice, showName]);

  const handlePrint = () => {
    if (!allLabels.length) return toast.error("اختر منتج واحد على الأقل");
    window.print();
  };

  return (
    <BranchLayout>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #print-area, #print-area * { visibility: visible; }
          #print-area { position: absolute; inset: 0; padding: 8mm; }
          .no-print { display: none !important; }
          @page { size: A4; margin: 8mm; }
        }
      `}</style>

      <PageHeader
        title="طباعة الباركود"
        subtitle="اختر المنتجات وعدد النسخ ثم اطبع على ورق ملصقات"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => nav(`/branch/${branchId}/inventory`)}>
              <ArrowRight className="w-4 h-4 ml-1" /> رجوع
            </Button>
            <Button className="btn-gradient" onClick={handlePrint} disabled={!allLabels.length}>
              <Printer className="w-4 h-4 ml-2" /> طباعة ({allLabels.length})
            </Button>
          </div>
        }
      />

      <div className="grid lg:grid-cols-3 gap-6 no-print">
        {/* Products list */}
        <div className="lg:col-span-1 card-elevated p-4 max-h-[70vh] overflow-y-auto">
          <Label className="mb-2 block">المنتجات</Label>
          <div className="relative mb-3">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="بحث..." value={search} onChange={(e) => setSearch(e.target.value)} className="pr-10" />
          </div>
          <div className="space-y-1">
            {filtered.map((p) => (
              <label key={p.id} className="flex items-center gap-2 p-2 rounded hover:bg-surface-2 cursor-pointer">
                <Checkbox checked={!!selected[p.id]} onCheckedChange={() => toggle(p)} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{p.name}</div>
                  <div className="text-xs text-muted-foreground font-mono">{p.sku}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Settings & selected */}
        <div className="lg:col-span-2 space-y-4">
          <div className="card-elevated p-4">
            <Label className="mb-2 block">إعدادات الملصق</Label>
            <div className="flex gap-4 flex-wrap">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={showName} onCheckedChange={(v) => setShowName(!!v)} /> إظهار اسم المنتج
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={showPrice} onCheckedChange={(v) => setShowPrice(!!v)} /> إظهار السعر
              </label>
            </div>
          </div>

          <div className="card-elevated p-4">
            <Label className="mb-2 block">المنتجات المختارة ({Object.keys(selected).length})</Label>
            {Object.keys(selected).length === 0 ? (
              <div className="text-center py-6 text-muted-foreground text-sm">لم تختر منتجات بعد</div>
            ) : (
              <div className="space-y-2">
                {Object.values(selected).map((it) => (
                  <div key={it.id} className="flex items-center gap-3 p-2 rounded border border-border">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{it.name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{it.sku}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Label className="text-xs">نسخ</Label>
                      <Input
                        type="number"
                        min="1"
                        value={it.copies}
                        onChange={(e) => setCopies(it.id, parseInt(e.target.value) || 1)}
                        className="w-20 h-8 text-center"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Print preview area */}
      <div id="print-area" ref={printAreaRef} className="mt-6">
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
          {allLabels.map((lbl) => (
            <div
              key={lbl.key}
              className="border border-border rounded p-2 text-center bg-white text-black"
              style={{ pageBreakInside: "avoid" }}
            >
              {showName && (
                <div className="text-[10px] font-bold truncate" title={lbl.name}>
                  {lbl.name}
                </div>
              )}
              <svg id={`bc-${lbl.key}`} className="w-full"></svg>
              {showPrice && (
                <div className="text-xs font-bold mt-1">{formatEGP(lbl.selling_price)}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </BranchLayout>
  );
}
