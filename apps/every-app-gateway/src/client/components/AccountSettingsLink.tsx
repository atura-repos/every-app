import { Link } from "@tanstack/react-router";
export function AccountSettingsLink({ onClick }: { onClick?: () => void }) {
  return (
    <Link to="/settings" onClick={onClick}>
      Personal settings
    </Link>
  );
}
