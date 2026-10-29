import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/theme";

/** A single sun/moon button that switches between light and dark. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className={`grid h-9 w-9 place-items-center rounded-full border border-border text-foreground/80 transition-colors hover:bg-secondary hover:text-foreground ${className}`}
    >
      <Sun className="hidden h-4 w-4 dark:block" aria-hidden />
      <Moon className="h-4 w-4 dark:hidden" aria-hidden />
    </button>
  );
}
