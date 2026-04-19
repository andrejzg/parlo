import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import CreatorPage from "@/pages/CreatorPage";
import ParticipantPage from "@/pages/ParticipantPage";
import PublicResultsPage from "@/pages/PublicResultsPage";
import DashboardPage from "@/pages/DashboardPage";
import AdminPage from "@/pages/AdminPage";
import NotFound from "@/pages/NotFound";
import ErrorBoundary from "@/components/ErrorBoundary";
import LandscapeOverlay from "@/components/LandscapeOverlay";
import { captureException } from "@/lib/posthog";

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (err, query) => {
      captureException(err, {
        source: "react-query",
        kind: "query",
        queryKey: JSON.stringify(query.queryKey),
      });
    },
  }),
  mutationCache: new MutationCache({
    onError: (err, _vars, _ctx, mutation) => {
      captureException(err, {
        source: "react-query",
        kind: "mutation",
        mutationKey: JSON.stringify(mutation.options.mutationKey ?? []),
      });
    },
  }),
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

const App = () => (
  <ErrorBoundary>
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <LandscapeOverlay />
      <BrowserRouter>
        <Routes>
          {/* Creator flow: landing + creation */}
          <Route path="/" element={<CreatorPage />} />

          {/* Participant flow */}
          <Route path="/s/:code" element={<ParticipantPage />} />

          {/* Public results page (open surveys) */}
          <Route path="/r/:code" element={<PublicResultsPage />} />

          {/* Creator dashboard */}
          <Route path="/d/:dashboardCode" element={<DashboardPage />} />

          {/* Admin (protected by Cloudflare Access) */}
          <Route path="/admin" element={<AdminPage />} />

          {/* Catch-all */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
