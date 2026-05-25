CREATE POLICY "Anonymous can read vehicle_telemetry_events"
ON public.vehicle_telemetry_events
FOR SELECT
TO anon
USING (true);