-- Permitir SELECT para usuários anônimos na tabela daily_vehicle_km
CREATE POLICY "Anonymous can read daily_vehicle_km"
ON public.daily_vehicle_km
FOR SELECT
TO anon
USING (true);