import { createBrowserRouter } from "react-router-dom";
import { AppShell } from "../layouts/AppShell";
import { DashboardPage } from "../pages/Dashboard";
import { RoomsPage } from "../pages/Rooms";
import { MembersPage } from "../pages/Members";
import { MembersActivePage } from "../pages/MembersActive";
import { MembersDirectoryPage } from "../pages/MembersDirectory";
import { MemberDetailsPage } from "../pages/MemberDetails";
import { ModerationPage } from "../pages/Moderation";
import { ResolvedReportsPage } from "../pages/ResolvedReports";
import { IntegrationsPage } from "../pages/Integrations";
import { InvitesPage } from "../pages/Invites";
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
      { path: "members/active", element: <MembersActivePage /> },
      { path: "members/directory", element: <MembersDirectoryPage /> },
      { path: "members/:memberUUID", element: <MemberDetailsPage /> },
      { path: "moderation", element: <ModerationPage /> },
      { path: "moderation/resolved", element: <ResolvedReportsPage /> },
      { path: "invites", element: <InvitesPage /> },
      { path: "integrations", element: <IntegrationsPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
