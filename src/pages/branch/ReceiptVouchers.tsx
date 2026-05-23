import { useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { VouchersTable } from "@/components/VouchersTable";

export default function ReceiptVouchers() {
  const { id } = useParams<{ id: string }>();
  return (
    <BranchLayout>
      <PageHeader title="سندات القبض" subtitle="كل المبالغ المُحصَّلة في الفرع" />
      <VouchersTable branchId={id} type="receipt" />
    </BranchLayout>
  );
}
