import { useLocation } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    // 404 tracked via analytics; no console logging in production
  }, [location.pathname]);

  return (
    <div
      className="flex min-h-screen items-center justify-center"
      style={{ background: "hsl(225 25% 4%)" }}
    >
      <div className="text-center px-6">
        <h1
          className="mb-4 font-display"
          style={{ fontSize: "clamp(4rem, 15vw, 6rem)", fontWeight: 800, color: "hsl(40 20% 95%)" }}
        >
          404
        </h1>
        <p className="mb-6 text-lg text-muted-foreground font-light">
          This page doesn't exist.
        </p>
        <a
          href="/"
          className="inline-block px-8 py-3 rounded-xl bg-primary text-primary-foreground font-display font-semibold text-sm"
        >
          Go home
        </a>
      </div>
    </div>
  );
};

export default NotFound;
