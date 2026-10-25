"use client";

import { useEffect } from "react";
import { Bell } from "lucide-react";
import toast from "react-hot-toast";
import { supabaseBrowser, supabaseBrowserConfigured } from "@/lib/supabase/client";

/**
 * Realtime notifications (Supabase Realtime): subscribes to the
 * public.notifications table for THIS user's rows only (RLS scopes the
 * replication stream) and raises a toast whenever HR/manager decisions or
 * new leave requests arrive.
 */
export function useRealtimeNotifications(userId: string | undefined, onChanged?: () => void) {
  useEffect(() => {
    if (!userId || !supabaseBrowserConfigured()) return;
    const supabase = supabaseBrowser();
    if (!supabase) return;

    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as { title?: string; body?: string; type?: string };
          const isDecision = row.type === "leave_approved" || row.type === "leave_rejected";
          if (isDecision) {
            toast.success(`${row.title ?? "Notification"} — ${row.body ?? ""}`, {
              icon: <Bell className="h-4 w-4" aria-hidden />,
              duration: 6000,
            });
          } else {
            toast(`${row.title ?? "Notification"} — ${row.body ?? ""}`, {
              icon: <Bell className="h-4 w-4" aria-hidden />,
              duration: 6000,
            });
          }
          onChanged?.();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-subscribe only when the user changes
  }, [userId]);
}
