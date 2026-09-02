import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/refresh-disasters")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["DISASTER_CRON_SECRET"];
        if (!secret) {
          return new Response("Server configuration error", { status: 500 });
        }
        const provided = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
        if (provided !== secret) {
          return new Response("Unauthorized", { status: 401 });
        }


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
