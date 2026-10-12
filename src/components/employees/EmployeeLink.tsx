import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

/** Who can open an employee's page (/admin/employees/:id) — same gate as its route. */
export function useCanOpenEmployee(): boolean {
  const { isAdmin, isSuperAdmin, isViewer, hasRole } = useAuth();
  return isAdmin || isSuperAdmin || isViewer || hasRole("partner") || hasRole("supervisor");
}

/**
 * An employee's name anywhere in the system: a link to their page (attendance, salary, advances,
 * bonus / penalty, login account) for users who can open it; plain text for everyone else.
 */
export function EmployeeLink({ id, name, className = "" }: { id?: string | null; name?: string | null; className?: string }) {
  const canOpen = useCanOpenEmployee();
  const label = name || "—";
  if (!id || !canOpen) return <span className={className}>{label}</span>;
  return (
    <Link to={`/admin/employees/${id}`} onClick={(e) => e.stopPropagation()}
      className={`font-semibold text-primary hover:underline underline-offset-2 ${className}`}>
      {label}
    </Link>
  );
}
