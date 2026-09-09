import type { ProductDelivery } from "../../lib/api/types";
export function productPayload(form: Record<string, unknown>): Record<string, unknown> {
  const config=form.deliveryConfig as ProductDelivery|null|undefined;
  return {...form,...(config?{type:config.kind==="service"?"service":"product"}:{})};
}
