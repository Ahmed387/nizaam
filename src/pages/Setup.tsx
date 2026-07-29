import { Navigate } from "react-router-dom";

// Legacy setup entry — unified into the Signup + SetupWizard flow.
// New tenants sign up at /signup, then the wizard runs automatically after login
// when tenants.setup_completed = false.
export default function Setup() {
  return <Navigate to="/signup" replace />;
}
