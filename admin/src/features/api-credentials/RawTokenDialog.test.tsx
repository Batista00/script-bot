import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RawTokenDialog } from "./ApiCredentialsPage";

function Harness() { const [token, setToken] = useState("bw_one_time_secret"); return token ? <RawTokenDialog token={token} onClose={() => setToken("")} /> : <span>cerrado</span>; }
test("raw API credential token disappears from UI state when dialog closes", async () => {
  render(<Harness />); expect(screen.getByTestId("raw-token")).toHaveTextContent("bw_one_time_secret");
  await userEvent.click(screen.getByRole("button", { name: "Ya lo guardé" }));
  expect(screen.queryByText("bw_one_time_secret")).not.toBeInTheDocument(); expect(screen.getByText("cerrado")).toBeInTheDocument();
});
