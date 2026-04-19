import { useParams } from "react-router-dom";
import { useGetDashboard } from "@/api/client";
import AgentDashboard from "@/components/creator/AgentDashboard";

export default function DashboardPage() {
  const { dashboardCode } = useParams<{ dashboardCode: string }>();

  const { data, isLoading, isError, error, refetch } = useGetDashboard(
    dashboardCode ?? ""
  );

  if (isLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: "hsl(22 95% 62%)", borderTopColor: "transparent" }}
          />
          <p
            className="text-sm font-display"
            style={{ color: "hsl(225 10% 45%)" }}
          >
            Loading dashboard...
          </p>
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 px-6 text-center">
          <p
            className="text-base font-display font-semibold"
            style={{ color: "hsl(40 20% 95%)" }}
          >
            Could not load dashboard
          </p>
          <p
            className="text-sm"
            style={{ color: "hsl(225 10% 45%)" }}
          >
            {error instanceof Error ? error.message : "Something went wrong"}
          </p>
          <button
            onClick={() => refetch()}
            className="mt-2 px-5 py-2.5 rounded-xl text-sm font-display font-semibold"
            style={{
              background: "hsl(var(--primary))",
              color: "#fff",
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <div className="relative w-full max-w-md h-screen max-h-[812px] overflow-hidden bg-background">
        <AgentDashboard data={data} dashboardCode={dashboardCode ?? ""} />
      </div>
    </div>
  );
}
