GRANT SELECT ON public.vehicles TO anon;
GRANT SELECT ON public.maintenance_tickets TO anon;

CREATE POLICY "Anon can read vehicles"
ON public.vehicles FOR SELECT TO anon USING (true);

CREATE POLICY "Anon can read maintenance tickets"
ON public.maintenance_tickets FOR SELECT TO anon USING (true);