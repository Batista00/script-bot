import { businessQueryKey } from "./query-client";

test("every business-owned query key helper embeds the business id", () => {
  expect(businessQueryKey("orders", "business-42", { status: "paid" })).toEqual(["orders", "business-42", { status: "paid" }]);
});
