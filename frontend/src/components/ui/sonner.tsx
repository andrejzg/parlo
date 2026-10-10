import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/** Follows the app's mode class on <html> (index.html sets `dark`). */
function currentMode(): "light" | "dark" {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/**
 * Parlo1 toast surface for Sonner: neutral-2 popover, radius m, padding m,
 * shadow m, no native border; primary / secondary pills for the actions.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme={currentMode()}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:border-0 group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground group-[.toaster]:shadow-m group-[.toaster]:rounded-m group-[.toaster]:p-m group-[.toaster]:font-ui group-[.toaster]:text-s group-[.toaster]:tracking-l",
          title: "group-[.toast]:font-medium group-[.toast]:text-foreground",
          description: "group-[.toast]:font-regular group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:rounded-full group-[.toast]:bg-primary group-[.toast]:text-primary-foreground group-[.toast]:font-medium",
          cancelButton:
            "group-[.toast]:rounded-full group-[.toast]:bg-secondary group-[.toast]:text-secondary-foreground group-[.toast]:font-medium",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
