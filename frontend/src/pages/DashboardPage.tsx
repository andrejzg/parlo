import { useParams } from "react-router-dom";
import { LoaderCircle } from "lucide-react";
import { useGetDashboard } from "@/api/client";
import { Button } from "@/components/ui/button";
import AgentDashboard from "@/components/creator/AgentDashboard";

export default function DashboardPage() {
  const { dashboardCode } = useParams<{ dashboardCode: string }>();

  const { data, isLoading, isError, error, refetch } = useGetDashboard(
    dashboardCode ?? ""
  );

  if (isLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-s">
          <LoaderCircle size={32} className="animate-spin text-color-1" aria-hidden />
          <p className="text-s text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-l px-l text-center">
          <div className="flex flex-col gap-xs">
            <p className="font-brand text-l font-heavy text-foreground">Could not load dashboard</p>
            <p className="text-m text-muted-foreground">
              {error instanceof Error ? error.message : "Something went wrong"}
            </p>
          </div>
          <Button onClick={() => refetch()}>Retry</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      {/* max-w-md / max-h-[812px] are the phone-frame shell dimensions (structural). */}
      <div className="relative w-full max-w-md h-screen max-h-[812px] overflow-hidden bg-background">
        <AgentDashboard data={data} dashboardCode={dashboardCode ?? ""} />
      </div>
    </div>
  );
}
