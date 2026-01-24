import { RouterProvider } from "react-router-dom";
import { AppProviders } from "./providers";
import { appRouter } from "./routes";
import { AuthGate } from "../auth/AuthGate";

export function App() {
  return (
    <AppProviders>
      <AuthGate>
        <RouterProvider router={appRouter} />
      </AuthGate>
    </AppProviders>
  );
}
