import { ReactNode } from "react";
import { AdminLayout, BranchLayout } from "./Layouts";
import { PageHeader } from "./AppShell";

type Props = {
  embedded?: boolean;
  variant?: "branch" | "admin";
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
};

export function ConditionalLayout({ embedded, variant = "branch", title, subtitle, actions, children }: Props) {
  if (embedded) {
    return (
      <>
        {actions && <div className="flex justify-end mb-3">{actions}</div>}
        {children}
      </>
    );
  }
  const Layout = variant === "admin" ? AdminLayout : BranchLayout;
  return (
    <Layout>
      {title && <PageHeader title={title} subtitle={subtitle} actions={actions} />}
      {children}
    </Layout>
  );
}
