CREATE TABLE public.disaster_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filter_type text NOT NULL,
  query_key text NOT NULL DEFAULT '',
  events jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  ny_day date NOT NULL DEFAULT (now() AT TIME ZONE 'America/New_York')::date,
  UNIQUE (filter_type, query_key)
);

GRANT SELECT ON public.disaster_searches TO anon;
GRANT SELECT ON public.disaster_searches TO authenticated;
GRANT ALL ON public.disaster_searches TO service_role;

ALTER TABLE public.disaster_searches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Disaster cache is publicly readable"
ON public.disaster_searches
FOR SELECT
TO anon, authenticated
USING (true);

CREATE TABLE public.job_state (
  job text PRIMARY KEY,
  status text NOT NULL DEFAULT 'idle',
  paused_reason text,
  lease_until timestamptz,
  last_run_at timestamptz,
  last_ny_day date,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.job_state TO service_role;

ALTER TABLE public.job_state ENABLE ROW LEVEL SECURITY;

INSERT INTO public.job_state (job) VALUES ('disaster_refresh');