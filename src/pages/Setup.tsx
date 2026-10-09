import { Navigate } from "react-router-dom";

// Legacy setup entry. Companies are created from the Super Admin dashboard only (SEC-002),
// so there is no public setup flow any more.
export default function Setup() {
  return <Navigate to="/login" replace />;
}
