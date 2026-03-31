
-- Limpar todos os planos existentes (cascade nas executions e overrides via FK)
DELETE FROM maintenance_executions;
DELETE FROM vehicle_maintenance_overrides;
DELETE FROM maintenance_plans;

-- ============================================================
-- FAIXA M — MENSAL (Conservação / Lubrificação)
-- ============================================================
INSERT INTO maintenance_plans (name, description, category, item_type, km_interval, time_interval_days, alert_threshold_pct) VALUES
('Grafite nas canaletas dos vidros', 'Aplicar grafite em pó nas canaletas das portas para evitar travamento do vidro elétrico', 'faixa_m', 'servico', NULL, 30, 90),
('Lubrificação das fechaduras', 'Aplicar desengripante/graxa branca nas fechaduras de portas e porta-malas', 'faixa_m', 'servico', NULL, 30, 90);

-- ============================================================
-- FAIXA A — 10.000 KM / 6 MESES (Revisão Básica)
-- Fonte: Localiza Gestão de Frotas, Moura, Central do Carro
-- ============================================================
INSERT INTO maintenance_plans (name, description, category, item_type, km_interval, time_interval_days, alert_threshold_pct) VALUES
('Troca de óleo do motor + filtro', 'Substituir óleo e filtro de óleo conforme especificação do fabricante', 'faixa_a', 'troca', 10000, 180, 90),
('Filtro de ar do motor', 'Substituir filtro de ar do motor para manter eficiência e economia de combustível', 'faixa_a', 'troca', 10000, 180, 90),
('Filtro de cabine (ar-condicionado)', 'Substituir filtro do ar-condicionado para higiene e performance do A/C', 'faixa_a', 'troca', 10000, 365, 90),
('Alinhamento dianteiro', 'Verificar e corrigir ângulo das rodas dianteiras', 'faixa_a', 'servico', 10000, 180, 90),
('Rodízio de pneus', 'Alternar posição dos pneus para desgaste uniforme', 'faixa_a', 'servico', 10000, 180, 90),
('Inspeção do sistema de freios', 'Verificar pastilhas, discos, lonas e nível do fluido de freio', 'faixa_a', 'inspecao', 10000, 180, 90),
('Inspeção de pneus', 'Verificar pressão, profundidade de sulco (TWI) e estado geral dos pneus', 'faixa_a', 'inspecao', 10000, 180, 90),
('Inspeção da bateria', 'Verificar tensão, terminais, oxidação nos polos e fixação', 'faixa_a', 'inspecao', 10000, 180, 90),
('Inspeção da suspensão', 'Verificar amortecedores, buchas, pivôs e molas — sinais de folga ou ruído', 'faixa_a', 'inspecao', 10000, 180, 90),
('Verificação de fluidos', 'Conferir níveis de fluido de freio, arrefecimento e direção hidráulica', 'faixa_a', 'inspecao', 10000, 180, 90),
('Inspeção do sistema elétrico', 'Verificar funcionamento de faróis, lanternas, setas, luz de freio e fusíveis', 'faixa_a', 'inspecao', 10000, 180, 90);

-- ============================================================
-- FAIXA B — 20.000-30.000 KM / 12 MESES (Revisão Intermediária)
-- ============================================================
INSERT INTO maintenance_plans (name, description, category, item_type, km_interval, time_interval_days, alert_threshold_pct) VALUES
('Filtro de combustível', 'Substituir filtro de combustível para proteger injetores e bomba', 'faixa_b', 'troca', 20000, 365, 90),
('Balanceamento das rodas', 'Balancear todas as rodas para eliminar vibrações e desgaste irregular', 'faixa_b', 'servico', 20000, 365, 90),
('Correia do alternador/acessórios', 'Inspecionar estado e tensão da correia do alternador — substituir se necessário', 'faixa_b', 'inspecao', 30000, 365, 90),
('Limpeza do corpo de borboleta (TBI)', 'Limpar corpo de borboleta para manter marcha lenta estável e desempenho do motor', 'faixa_b', 'servico', 30000, 365, 90),
('Inspeção do sistema de arrefecimento', 'Verificar nível, coloração e validade do aditivo do radiador + estado das mangueiras', 'faixa_b', 'inspecao', 20000, 365, 90),
('Inspeção de mangueiras', 'Verificar estado de mangueiras de combustível, arrefecimento e vácuo — sinais de ressecamento ou vazamento', 'faixa_b', 'inspecao', 30000, 365, 90);

-- ============================================================
-- FAIXA C — 40.000-100.000 KM / 24-60 MESES (Revisão Completa)
-- ============================================================
INSERT INTO maintenance_plans (name, description, category, item_type, km_interval, time_interval_days, alert_threshold_pct) VALUES
('Pastilhas de freio', 'Substituir pastilhas de freio dianteiras e/ou traseiras por desgaste', 'faixa_c', 'troca', 30000, 365, 85),
('Fluido de freio (DOT4)', 'Trocar fluido de freio completo — absorve umidade e perde eficiência com o tempo', 'faixa_c', 'troca', 30000, 730, 85),
('Velas de ignição', 'Substituir velas de ignição para manter combustão eficiente e economia', 'faixa_c', 'troca', 40000, 730, 85),
('Correia dentada + tensor', 'Substituir correia dentada e tensor — rompimento causa dano catastrófico ao motor', 'faixa_c', 'troca', 60000, 1825, 80),
('Líquido de arrefecimento (aditivo)', 'Trocar aditivo do radiador para prevenir superaquecimento e corrosão interna', 'faixa_c', 'troca', 50000, 730, 85),
('Discos de freio', 'Substituir discos de freio por desgaste ou empenamento', 'faixa_c', 'troca', 60000, 1095, 85),
('Amortecedores (par)', 'Substituir amortecedores desgastados — impactam estabilidade e frenagem', 'faixa_c', 'troca', 80000, 1095, 80),
('Bateria (substituição)', 'Substituir bateria automotiva por perda de capacidade — vida útil média 3-4 anos', 'faixa_c', 'troca', NULL, 1095, 85);
