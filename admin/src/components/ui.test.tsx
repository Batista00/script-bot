import { render, screen } from "@testing-library/react";
import { RoleGate } from "./ui";

test("permission rendering follows the current business role", () => {
  const { rerender } = render(<RoleGate allowed={["owner", "admin"]} role="operator" fallback={<span>Sin permiso</span>}><button>Acción sensible</button></RoleGate>);
  expect(screen.queryByRole("button", { name: "Acción sensible" })).not.toBeInTheDocument();
  rerender(<RoleGate allowed={["owner", "admin"]} role="admin" fallback={<span>Sin permiso</span>}><button>Acción sensible</button></RoleGate>);
  expect(screen.getByRole("button", { name: "Acción sensible" })).toBeInTheDocument();
});
