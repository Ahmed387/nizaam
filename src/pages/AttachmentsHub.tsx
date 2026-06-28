import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { AdminLayout, BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { formatDateTime } from "@/lib/format";
import { searchMatch } from "@/lib/search";
import { Paperclip, Eye, Download, ExternalLink, FileText, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";

const BUCKET = "record-attachments";

const TYPE_LABELS: Record<string, string> = {
  invoice: "فاتورة بيع",
  sale_return: "مرتجع بيع",
  purchase_return: "مرتجع شراء",
  shipment: "فاتورة شراء/شحنة",
  stock_transfer: "تحويل مخزون",
  stock_adjustment: "تسوية مخزون",
  inventory_adjustment: "تسوية مخزون",
  voucher: "سند قبض/صرف",
};

const TYPE_COLOR: Record<string, string> = {
  invoice: "bg-success/15 text-success",
  sale_return: "bg-warning/15 text-warning",
  purchase_return: "bg-warning/15 text-warning",
  shipment: "bg-primary/15 text-primary",
  stock_transfer: "bg-secondary/15 text-secondary",
  stock_adjustment: "bg-muted text-muted-foreground",
  inventory_adjustment: "bg-muted text-muted-foreground",
  voucher: "bg-accent/15 text-accent-foreground",
};

interface Att {
  id: string;
  record_type: string;
  record_id: string;
  file_path: string;
  file_name: string;
  file_type: string | null;
  file_size: number | null;
  uploaded_by: string | null;
  uploaded_at: string;
  // hydrated:
  doc_number?: string;
  branch_id?: string | null;
  branch_name?: string;
  uploader_name?: string;
  link?: string | null;
}

interface Props {
  scope: "admin" | "branch";
}

function buildLink(type: string, recordId: string, branchId: string | null | undefined): string | null {
  if (!branchId) return null;
  switch (type) {
    case "invoice":
      return `/branch/${branchId}/sales/${recordId}`;
    case "sale_return":
      return `/branch/${branchId}/sale-returns/${recordId}`;
    case "purchase_return":
      return `/branch/${branchId}/purchase-returns/${recordId}`;
    case "shipment":
      return `/branch/${branchId}/shipments/${recordId}`;
    case "stock_transfer":
      return `/branch/${branchId}/transfers/${recordId}`;
    case "voucher":
      return `/branch/${branchId}/treasury`;
    default:
      return null;
  }
}

export default function AttachmentsHub({ scope }: Props) {
  const { tenantId } = useAuth();
  const { id: branchParamId } = useParams<{ id: string }>();
  const [rows, setRows] = useState<Att[]>([]);
  const [branches, setBranches] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [branchFilter, setBranchFilter] = useState<string>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);

    // 1. Fetch all attachments (RLS scopes by tenant)
    const { data: atts, error } = await supabase
      .from("attachments" as any)
      .select("*")
      .order("uploaded_at", { ascending: false })
      .limit(2000);
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }

    // 2. Group ids by type
    const byType: Record<string, string[]> = {};
    (atts as any[]).forEach((a) => {
      byType[a.record_type] = byType[a.record_type] || [];
      byType[a.record_type].push(a.record_id);
    });

    const docMap: Record<string, { number: string; branch_id: string | null; date?: string }> = {};

    const lookups: Promise<any>[] = [];
    const wrap = (p: any) => Promise.resolve(p);
    if (byType.invoice?.length) {
      lookups.push(wrap(
        supabase.from("invoices").select("id, invoice_number, branch_id").in("id", byType.invoice)
      ).then(({ data }: any) => {
        (data ?? []).forEach((r: any) => { docMap[`invoice:${r.id}`] = { number: r.invoice_number, branch_id: r.branch_id }; });
      }));
    }
    if (byType.sale_return?.length) {
      lookups.push(wrap(
        supabase.from("returns").select("id, return_number, branch_id").in("id", byType.sale_return)
      ).then(({ data }: any) => {
        (data ?? []).forEach((r: any) => { docMap[`sale_return:${r.id}`] = { number: r.return_number, branch_id: r.branch_id }; });
      }));
    }
    if (byType.purchase_return?.length) {
      lookups.push(wrap(
        supabase.from("purchase_returns").select("id, return_number, branch_id").in("id", byType.purchase_return)
      ).then(({ data }: any) => {
        (data ?? []).forEach((r: any) => { docMap[`purchase_return:${r.id}`] = { number: r.return_number, branch_id: r.branch_id }; });
      }));
    }
    if (byType.shipment?.length) {
      lookups.push(wrap(
        supabase.from("shipments").select("id, shipment_number, branch_id").in("id", byType.shipment)
      ).then(({ data }: any) => {
        (data ?? []).forEach((r: any) => { docMap[`shipment:${r.id}`] = { number: r.shipment_number, branch_id: r.branch_id }; });
      }));
    }
    if (byType.stock_transfer?.length) {
      lookups.push(wrap(
        supabase.from("stock_transfers").select("id, from_branch_id").in("id", byType.stock_transfer)
      ).then(({ data }: any) => {
        (data ?? []).forEach((r: any) => { docMap[`stock_transfer:${r.id}`] = { number: String(r.id).slice(0, 8), branch_id: r.from_branch_id }; });
      }));
    }
    if (byType.stock_adjustment?.length) {
      lookups.push(wrap(
        supabase.from("stock_adjustments").select("id, adjustment_number, branch_id").in("id", byType.stock_adjustment)
      ).then(({ data }: any) => {
        (data ?? []).forEach((r: any) => { docMap[`stock_adjustment:${r.id}`] = { number: r.adjustment_number, branch_id: r.branch_id }; });
      }));
    }
    if (byType.voucher?.length) {
      lookups.push(wrap(
        supabase.from("vouchers" as any).select("id, voucher_number, branch_id").in("id", byType.voucher)
      ).then(({ data }: any) => {
        (data ?? []).forEach((r: any) => { docMap[`voucher:${r.id}`] = { number: r.voucher_number, branch_id: r.branch_id }; });
      }));
    }


    // Branches + uploaders
    const [{ data: brList }, { data: profs }] = await Promise.all([
      supabase.from("branches").select("id, name").eq("tenant_id", tenantId),
      supabase.from("profiles").select("id, name").eq("tenant_id", tenantId),
    ]);
    const brMap: Record<string, string> = {};
    (brList ?? []).forEach((b: any) => { brMap[b.id] = b.name; });
    setBranches(brMap);
    const profMap: Record<string, string> = {};
    (profs ?? []).forEach((p: any) => { profMap[p.id] = p.name; });

    await Promise.all(lookups);

    const hydrated: Att[] = (atts as any[]).map((a) => {
      const key = `${a.record_type}:${a.record_id}`;
      const doc = docMap[key];
      const branchId = doc?.branch_id ?? null;
      return {
        ...a,
        doc_number: doc?.number ?? "—",
        branch_id: branchId,
        branch_name: branchId ? brMap[branchId] ?? "—" : "—",
        uploader_name: a.uploaded_by ? profMap[a.uploaded_by] ?? "—" : "—",
        link: buildLink(a.record_type, a.record_id, branchId),
      };
    });

    setRows(hydrated);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh(["attachments"], load);

  const filtered = useMemo(() => {
    let out = rows;
    if (scope === "branch" && branchParamId) {
      out = out.filter((r) => r.branch_id === branchParamId);
    } else if (branchFilter !== "all") {
      out = out.filter((r) => r.branch_id === branchFilter);
    }
    if (typeFilter !== "all") out = out.filter((r) => r.record_type === typeFilter);
    if (from) out = out.filter((r) => r.uploaded_at >= from);
    if (to) out = out.filter((r) => r.uploaded_at <= to + "T23:59:59");
    if (q) out = out.filter((r) =>
      searchMatch(q, r.file_name, r.doc_number ?? "", r.branch_name ?? "", r.uploader_name ?? "")
    );
    return out;
  }, [rows, scope, branchParamId, branchFilter, typeFilter, from, to, q]);

  const open = async (a: Att) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(a.file_path, 600);
    if (error) return toast.error(error.message);
    window.open(data.signedUrl, "_blank");
  };

  const download = async (a: Att) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(a.file_path, 600, {
      download: a.file_name,
    } as any);
    if (error) return toast.error(error.message);
    window.open(data.signedUrl, "_blank");
  };

  const Layout = scope === "admin" ? AdminLayout : BranchLayout;

  const branchOptions = Object.entries(branches);

  const content = (
    <>
      <PageHeader
        title="المرفقات"
        subtitle={
          scope === "admin"
            ? "كل ملفات المرفقات في الشركة (فواتير، شحنات، مرتجعات، تحويلات، سندات)"
            : "مرفقات هذا الفرع فقط"
        }
      />

      <div className="card-elevated p-4 mb-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
        <Input placeholder="بحث (اسم الملف، رقم المستند، من رفع)..." value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger><SelectValue placeholder="نوع المستند" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الأنواع</SelectItem>
            {Object.entries(TYPE_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {scope === "admin" && (
          <Select value={branchFilter} onValueChange={setBranchFilter}>
            <SelectTrigger><SelectValue placeholder="الفرع" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الفروع</SelectItem>
              {branchOptions.map(([id, name]) => (
                <SelectItem key={id} value={id}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="من" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} placeholder="إلى" />
      </div>

      <div className="text-xs text-muted-foreground mb-2">
        إجمالي: <b>{filtered.length}</b> مرفق
      </div>

      <DataTable
        loading={loading}
        rows={filtered}
        empty="لا توجد مرفقات"
        columns={[
          {
            key: "file",
            header: "الملف",
            render: (r: Att) => {
              const isImg = (r.file_type ?? "").startsWith("image/");
              return (
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 rounded bg-surface-2 flex items-center justify-center shrink-0">
                    {isImg ? <ImageIcon className="w-4 h-4 text-primary" /> : <FileText className="w-4 h-4 text-muted-foreground" />}
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium truncate max-w-[220px]">{r.file_name}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {r.file_size ? `${Math.round(r.file_size / 1024)} KB` : ""}
                    </div>
                  </div>
                </div>
              );
            },
          },
          {
            key: "record_type",
            header: "النوع",
            render: (r: Att) => (
              <span className={`text-[11px] px-2 py-1 rounded-full font-bold ${TYPE_COLOR[r.record_type] ?? "bg-muted"}`}>
                {TYPE_LABELS[r.record_type] ?? r.record_type}
              </span>
            ),
          },
          {
            key: "doc_number",
            header: "رقم المستند",
            render: (r: Att) =>
              r.link ? (
                <Link to={r.link} target="_blank" className="text-primary hover:underline font-mono inline-flex items-center gap-1">
                  {r.doc_number} <ExternalLink className="w-3 h-3" />
                </Link>
              ) : (
                <span className="font-mono">{r.doc_number}</span>
              ),
          },
          ...(scope === "admin"
            ? [{ key: "branch_name", header: "الفرع", render: (r: Att) => r.branch_name ?? "—" }]
            : []),
          { key: "uploader_name", header: "رفعها", render: (r: Att) => r.uploader_name ?? "—" },
          { key: "uploaded_at", header: "التاريخ", render: (r: Att) => formatDateTime(r.uploaded_at) },
          {
            key: "actions",
            header: "إجراءات",
            render: (r: Att) => (
              <div className="flex gap-1 justify-end">
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => open(r)} title="عرض">
                  <Eye className="w-4 h-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => download(r)} title="تحميل">
                  <Download className="w-4 h-4" />
                </Button>
              </div>
            ),
          },
        ]}
      />
    </>
  );

  return <Layout>{content}</Layout>;
}
