import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    // 404 tracked via analytics; no console logging in production
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-l px-l text-center">
        <div className="flex flex-col gap-xs">
          <h1 className="font-brand text-xl font-heavy text-foreground">404</h1>
          <p className="text-m text-muted-foreground">This page doesn't exist.</p>
        </div>
        <Button asChild>
          <a href="/">Go home</a>
        </Button>
      </div>
    </div>
  );
};

export default NotFound;
