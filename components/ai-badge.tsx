import { Sparkles } from "lucide-react";

/**
 * Mandatory "AI-generated" label (NFR-09). Every AI answer and every
 * AI-suggested form must render one of these badges — T8.2 makes it
 * impossible to ship an unlabelled AI surface.
 */
export function AiBadge({ suggested = false }: { suggested?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-violet-100 to-indigo-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700 ring-1 ring-indigo-200">
      <Sparkles className="h-3 w-3" aria-hidden />
      {suggested ? "AI-suggested" : "AI-generated"}
    </span>
  );
}
