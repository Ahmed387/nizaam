import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Loader2, Save, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  AppRole,
  MANAGED_ROLES,
  PERMISSION_GROUPS,
  BRANCH_PERMISSION_GROUPS,
  ADMIN_NAV_PERMISSION_GROUPS,
  ROLE_LABELS,
  DEFAULT_ROLE_PERMISSIONS,
  PERM_HELP,
} from "@/lib/roles";

const SECTIONS = [
  { title: "صفحات الفرع والعمليات", groups: BRANCH_PERMISSION_GROUPS },
  { title: "قائمة الإدارة الجانبية (Sidebar)", groups: ADMIN_NAV_PERMISSION_GROUPS },
];


const ACTION_LABELS: Record<string, string> = {
  view: "عرض",
  create: "إنشاء",
  update: "تعديل",
  delete: "حذف",
};

export function RolePermissionsTab() {
  const { tenantId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [perms, setPerms] = useState<Record<string, Record<string, boolean>>>({});

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    const { data } = await supabase
      .from("role_permissions" as any)
      .select("role, permission_key, allowed")
      .eq("tenant_id", tenantId);
    const map: Record<string, Record<string, boolean>> = {};
    MANAGED_ROLES.forEach((r) => (map[r] = { ...(DEFAULT_ROLE_PERMISSIONS[r] || {}) }));
    (data ?? []).forEach((row: any) => {
      map[row.role] = map[row.role] || {};
      map[row.role][row.permission_key] = row.allowed;
    });
    setPerms(map);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [tenantId]);

  const toggle = (role: string, key: string) => {
    setPerms((p) => ({ ...p, [role]: { ...(p[role] || {}), [key]: !p[role]?.[key] } }));
  };

  const resetRole = (role: string) => {
    setPerms((p) => ({ ...p, [role]: { ...(DEFAULT_ROLE_PERMISSIONS[role] || {}) } }));
  };

  const save = async () => {
    if (!tenantId) return;
    setSaving(true);
    const rows: any[] = [];
    MANAGED_ROLES.forEach((role) => {
      PERMISSION_GROUPS.forEach((g) =>
        g.actions.forEach((a) => {
          const key = `${g.key}.${a}`;
          rows.push({
            tenant_id: tenantId,
            role,
            permission_key: key,
            allowed: !!perms[role]?.[key],
          });
        }),
      );
    });
    // Upsert with composite unique
    const { error } = await supabase
      .from("role_permissions" as any)
      .upsert(rows, { onConflict: "tenant_id,role,permission_key" });
    setSaving(false);
    if (error) toast.error("فشل الحفظ: " + error.message);
    else toast.success("تم حفظ الصلاحيات");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>صلاحيات الأدوار</CardTitle>
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Save className="w-4 h-4 ml-1" />}
          حفظ
        </Button>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-2">
          المدير العام (admin) ومالك المنصة لهم كل الصلاحيات تلقائياً ولا يمكن تعديلها هنا.
        </p>
        <div className="text-xs bg-primary/10 border border-primary/30 rounded p-2 mb-3">
          💡 <b>ملاحظة:</b> هذه الصلاحيات تحدد <b>"إيه اللي الدور يقدر يعمله"</b> (عرض/إنشاء/تعديل/حذف).
          أما <b>"أي فرع"</b> يشتغل عليه المستخدم — فيتم تحديده من صفحة الموظف ← تاب "حساب الدخول" ← زر <b>"إدارة الفروع"</b>.
          (شخص واحد ممكن يكون مسؤول عن أكثر من فرع — مثلاً محاسب لكل الفروع.)
        </div>
        <div className="text-xs bg-amber-500/10 border border-amber-500/30 rounded p-2 mb-4">
          ⚠️ <b>فرق مهم بين الملاحظ و Viewer (المراقب):</b>
          <ul className="list-disc pr-5 mt-1 space-y-0.5">
            <li><b>ملاحظ:</b> دوره <b>تشغيلي محدود</b> — مسؤول فقط عن متابعة <b>الحضور والانصراف</b> للموظفين وتسجيلهم. مش بيشوف فواتير ولا مخزون ولا خزينة.</li>
            <li><b>Viewer (مراقب):</b> دوره <b>رقابي شامل</b> — بيشوف <b>كل</b> بيانات الشركة (فواتير، مخزون، خزينة، تقارير...) لكن <b>قراءة فقط</b>، مش بيقدر يعدل أو يحذف.</li>
          </ul>
        </div>
        <Tabs defaultValue={MANAGED_ROLES[0]}>
          <TabsList className="flex flex-wrap h-auto">
            {MANAGED_ROLES.map((r) => (
              <TabsTrigger key={r} value={r}>{ROLE_LABELS[r as AppRole]}</TabsTrigger>
            ))}
          </TabsList>
          {MANAGED_ROLES.map((role) => (
            <TabsContent key={role} value={role} className="mt-4">
              <div className="flex justify-end mb-2">
                <Button variant="outline" size="sm" onClick={() => resetRole(role)}>
                  <RotateCcw className="w-3 h-3 ml-1" /> إعادة الافتراضي
                </Button>
              </div>
              <div className="border rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-right p-2 font-medium">الصفحة</th>
                      <th className="p-2 font-medium">عرض</th>
                      <th className="p-2 font-medium">إنشاء</th>
                      <th className="p-2 font-medium">تعديل</th>
                      <th className="p-2 font-medium">حذف</th>
                    </tr>
                  </thead>
                  <tbody>
                    {SECTIONS.map((section) => (
                      <>
                        <tr key={section.title} className="border-t bg-primary/5">
                          <td colSpan={5} className="p-2 font-bold text-primary text-right">{section.title}</td>
                        </tr>
                        {section.groups.map((g) => (
                          <tr key={g.key} className="border-t">
                            <td className="p-2 font-medium max-w-[420px]">
                              <div>{g.label}</div>
                              {PERM_HELP[g.key] && (
                                <div className="text-[11px] font-normal leading-relaxed text-muted-foreground">{PERM_HELP[g.key]}</div>
                              )}
                            </td>
                            {(["view", "create", "update", "delete"] as const).map((a) => {
                              const key = `${g.key}.${a}`;
                              const supported = g.actions.includes(a);
                              return (
                                <td key={a} className="p-2 text-center">
                                  {supported ? (
                                    <Checkbox
                                      checked={!!perms[role]?.[key]}
                                      onCheckedChange={() => toggle(role, key)}
                                    />
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>

            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}
