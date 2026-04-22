-- ============================================================
-- 1. ETIOS: desativar correia dentada e tensor (usa corrente)
-- ============================================================
INSERT INTO public.vehicle_maintenance_overrides (vehicle_id, maintenance_plan_id, active)
SELECT v.id, mp.id, false
FROM public.vehicles v
CROSS JOIN public.maintenance_plans mp
WHERE UPPER(v.modelo) LIKE '%ETIOS%'
  AND mp.name IN ('Correia dentada', 'Tensor da correia')
ON CONFLICT (vehicle_id, maintenance_plan_id) DO UPDATE SET active = false;

-- ============================================================
-- 2. Adicionar item "Inspeção da corrente de distribuição" (apenas Etios)
-- ============================================================
INSERT INTO public.maintenance_plans (name, description, category, item_type, km_interval, time_interval_days, applies_to_all, active)
SELECT 'Inspeção da corrente de distribuição',
       'Toyota Etios usa corrente (cadeia), não correia. Verificar tensão, ruídos e desgaste.',
       'faixa_c', 'inspecao', 60000, 1460, false, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.maintenance_plans WHERE name = 'Inspeção da corrente de distribuição'
);

INSERT INTO public.vehicle_maintenance_overrides (vehicle_id, maintenance_plan_id, active)
SELECT v.id, mp.id, true
FROM public.vehicles v
CROSS JOIN public.maintenance_plans mp
WHERE UPPER(v.modelo) LIKE '%ETIOS%'
  AND mp.name = 'Inspeção da corrente de distribuição'
ON CONFLICT (vehicle_id, maintenance_plan_id) DO UPDATE SET active = true;

-- ============================================================
-- 3. Corrigir time_interval_days para 1825 (60 meses)
-- ============================================================
UPDATE public.maintenance_plans
SET time_interval_days = 1825
WHERE name IN ('Correia dentada', 'Bomba d''água', 'Tensor da correia')
  AND time_interval_days <> 1825;

-- ============================================================
-- 4. Filtros de ar e combustível viram "inspecao"
-- ============================================================
UPDATE public.maintenance_plans
SET item_type = 'inspecao',
    description = 'Inspecionar antes de trocar. Substituir somente se reprovado na inspeção.'
WHERE name IN ('Filtro de ar do motor', 'Filtro de combustível');

-- ============================================================
-- 5. Itens novos no plano padrão
-- ============================================================
INSERT INTO public.maintenance_plans (name, description, category, item_type, km_interval, time_interval_days, applies_to_all, active)
SELECT v.name, v.description, v.category, v.item_type, v.km_interval, v.time_interval_days, v.applies_to_all, true
FROM (VALUES
  ('Inspeção do nível e qualidade do óleo', 'Verificar nível, cor e borra. Motores VW EA111 (Saveiro): exige óleo VW502.00.', 'faixa_a', 'inspecao', 5000, 90, true),
  ('Inspeção dos rolamentos de roda', 'Verificar folga e ruído. Problema crônico documentado no Fiat Strada.', 'faixa_a', 'inspecao', 10000, 180, true),
  ('Inspeção da embreagem e cilindro mestre', 'Verificar folga do pedal, vazamentos e funcionamento. Checar Strada e Cobalt.', 'faixa_b', 'inspecao', 20000, 180, true),
  ('Inspeção do alternador e sistema de carga', 'Medir tensão de carga. Defeito crônico documentado no Toyota Etios.', 'faixa_b', 'inspecao', 20000, 180, true),
  ('Inspeção das buchas do eixo traseiro', 'Verificar desgaste e folga. Problema crônico no Toyota Etios.', 'faixa_b', 'inspecao', 20000, 180, true),
  ('Inspeção do sistema de injeção (scanner)', 'Leitura de falhas via scanner. Recomendado para Saveiro 1.6 MSI com falha crônica no módulo.', 'faixa_b', 'inspecao', 20000, 365, true),
  ('Inspeção da direção e mangueiras hidráulicas', 'Verificar vazamentos e funcionamento. Problema crônico no Cobalt 1.4.', 'faixa_b', 'inspecao', 20000, 180, true),
  ('Inspeção das velas de ignição', 'Verificar desgaste antecipado. Troca agendada separadamente a cada 40.000 km.', 'faixa_b', 'inspecao', 20000, 365, true),
  ('Troca da correia do alternador', 'Substituir ao atingir o limite ou se reprovado na inspeção anterior.', 'faixa_c', 'troca', 60000, 1825, true),
  ('Inspeção da correia dentada banhada a óleo (Onix)', 'CRÍTICO: Onix 1.0 nova geração tem correia banhada a óleo com degradação prematura. Pode causar quebra total do motor e freio duro.', 'faixa_b', 'inspecao', 15000, 365, false)
) AS v(name, description, category, item_type, km_interval, time_interval_days, applies_to_all)
WHERE NOT EXISTS (
  SELECT 1 FROM public.maintenance_plans mp WHERE mp.name = v.name
);

-- ============================================================
-- 6. Onix: vincular item crítico e adiantar correia dentada para 60.000 km
-- ============================================================
INSERT INTO public.vehicle_maintenance_overrides (vehicle_id, maintenance_plan_id, active)
SELECT v.id, mp.id, true
FROM public.vehicles v
CROSS JOIN public.maintenance_plans mp
WHERE UPPER(v.modelo) LIKE '%ONIX%'
  AND mp.name = 'Inspeção da correia dentada banhada a óleo (Onix)'
ON CONFLICT (vehicle_id, maintenance_plan_id) DO UPDATE SET active = true;

INSERT INTO public.vehicle_maintenance_overrides (vehicle_id, maintenance_plan_id, custom_km_interval, active)
SELECT v.id, mp.id, 60000, true
FROM public.vehicles v
CROSS JOIN public.maintenance_plans mp
WHERE UPPER(v.modelo) LIKE '%ONIX%'
  AND mp.name = 'Correia dentada'
ON CONFLICT (vehicle_id, maintenance_plan_id) DO UPDATE SET custom_km_interval = 60000, active = true;