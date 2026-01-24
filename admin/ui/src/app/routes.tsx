import { createBrowserRouter } from "react-router-dom";
import { AppShell } from "../layouts/AppShell";
import { DashboardPage } from "../pages/Dashboard";
import { RoomsPage } from "../pages/Rooms";
import { MembersPage } from "../pages/Members";
import { ModerationPage } from "../pages/Moderation";
import { IntegrationsPage } from "../pages/Integrations";
import { SettingsPage } from "../pages/Settings";
import { NotFoundPage } from "../pages/NotFound";

export const appRouter = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "rooms", element: <RoomsPage /> },
      { path: "members", element: <MembersPage /> },
      { path: "moderation", element: <ModerationPage /> },
      { path: "integrations", element: <IntegrationsPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);