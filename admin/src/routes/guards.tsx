import { Navigate, Outlet, useLocation, useParams } from "react-router-dom";
import { Spinner } from "../components/ui";
import { useAuth } from "../features/auth/auth-context";
import { BusinessProvider } from "../features/businesses/business-context";

export function RequireAuth() {
  const { auth, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return <div className="centered"><Spinner label="Cargando sesión" /></div>;
  return auth ? <Outlet /> : <Navigate to="/login" replace state={{ from: location.pathname }} />;
}

export function HomeRedirect() {
  const { auth } = useAuth();
  const first = auth?.businesses.find((item) => item.status === "active") ?? auth?.businesses[0];
  return <Navigate to={first ? `/businesses/${first.id}/dashboard` : "/businesses"} replace />;
}

export function RequireBusiness() {
  const { businessId } = useParams();
  const { auth } = useAuth();
  const business = auth?.businesses.find((item) => item.id === businessId);
  if (!business) return <Navigate to="/businesses" replace />;
  return <BusinessProvider business={business}><Outlet /></BusinessProvider>;
}
