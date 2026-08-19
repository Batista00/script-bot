import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { purgeBusinessCache } from "../app/query-client";
import type { BusinessAccess } from "../lib/api/types";

export function BusinessSwitcher({ businesses, current, currentSection = "dashboard" }: {
  businesses: BusinessAccess[]; current: BusinessAccess; currentSection?: string;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  return <label className="business-switcher"><span>Negocio actual</span><select aria-label="Negocio actual" value={current.id} onChange={(event) => {
    const nextId = event.target.value;
    purgeBusinessCache(client, current.id);
    navigate(`/businesses/${nextId}/${currentSection}`);
  }}>{businesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}</select></label>;
}
