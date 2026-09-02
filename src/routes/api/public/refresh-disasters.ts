import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/refresh-disasters")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
        if (!provided) return new Response("Unauthorized", { status: 401 });

        const envSecret = process.env["DISASTER_CRON_SECRET"];
        let ok = Boolean(envSecret) && provided === envSecret;

        if (!ok) {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data } = await supabaseAdmin
            .from("job_state")
            .select("cron_token")
            .eq("job", "disaster_refresh")
            .maybeSingle();
          ok = Boolean(data?.cron_token) && provided === data!.cron_token;
        }

        if (!ok) return new Response("Unauthorized", { status: 401 });



        const { refreshDisasterPresets } = await import("@/lib/disaster-news.server");
        try {
          const result = await refreshDisasterPresets();
          return new Response(JSON.stringify(result), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "refresh failed";
          console.error("disaster refresh failed:", message);
          return new Response(JSON.stringify({ status: "error", message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
