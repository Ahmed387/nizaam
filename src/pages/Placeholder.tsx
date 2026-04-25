import { ReactNode } from "react";
import { BranchLayout } from "@/components/layout/Layouts";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Construction } from "lucide-react";

export function ComingSoon({ title, layout = "branch" }: { title: string; layout?: "branch" | "admin" }) {
  const Layout = layout === "branch" ? BranchLayout : AdminLayout;
  return (
    <Layout>
      <PageHeader title={title} />
      <div className="card-elevated p-12 text-center">
        <Construction className="w-12 h-12 mx-auto text-warning mb-4" />
        <h3 className="text-xl font-bold mb-2">قريباً</h3>
        <p className="text-muted-foreground">هذه الوحدة جاهزة في قاعدة البيانات وستضاف واجهتها في التحديث القادم.</p>
      </div>
    </Layout>
  );
}

export function BranchPlaceholder({ title }: { title: string }) { return <ComingSoon title={title} layout="branch" />; }
export function AdminPlaceholder({ title }: { title: string }) { return <ComingSoon title={title} layout="admin" />; }
