import { NavLink } from "react-router-dom";
import clsx from "clsx";

type Props = {
  to: string;
  label: string;
  description?: string;
};

export function NavItem({ to, label, description }: Props) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => clsx("nav-link", isActive && "active")}
      end
    >
      <span className="nav-link-label">{label}</span>
      {description ? <span className="nav-link-desc">{description}</span> : null}
    </NavLink>
  );
}