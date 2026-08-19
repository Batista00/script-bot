import { createContext, useContext, type ReactNode } from "react";
import type { BusinessAccess } from "../../lib/api/types";

const BusinessContext = createContext<BusinessAccess | null>(null);
export function BusinessProvider({ business, children }: { business: BusinessAccess; children: ReactNode }) {
  return <BusinessContext.Provider value={business}>{children}</BusinessContext.Provider>;
}
export function useBusiness(): BusinessAccess {
  const business = useContext(BusinessContext);
  if (!business) throw new Error("Business context is not available");
  return business;
}
