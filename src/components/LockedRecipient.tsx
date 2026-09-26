import { Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";

/** Canonical name of the signed-in user used as «المستلم» on new documents. */
export function useCurrentUserName(): string {
  const { profile, user } = useAuth();
  return (profile?.name || (user?.user_metadata as any)?.name || user?.email || "").trim();
}

/** Read-only recipient field — cannot be cleared or edited. */
export function LockedRecipientInput({ value, className = "" }: { value: string; className?: string }) {
  return (
    <div className={className}>
      <div className="relative">
        <Input value={value} readOnly disabled tabIndex={-1} aria-readonly
          className="bg-muted cursor-not-allowed select-none pl-8" />
        <Lock className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
      </div>
      <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
        <Lock className="w-3 h-3" /> المستلم مقيد بحساب المستخدم الحالي
      </p>
    </div>
  );
}
