
CREATE OR REPLACE FUNCTION public.validate_vehicle_checklist_complete()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  required_photo_keys text[] := ARRAY[
    'painel', 'motor', 'nivel_oleo', 'etiqueta_oleo', 'reservatorio_agua',
    'calibracao_de', 'calibracao_dd', 'calibracao_te', 'calibracao_td',
    'estepe', 'itens_seguranca',
    'exterior_frente', 'exterior_traseira', 'exterior_esquerda', 'exterior_direita',
    'pneu_de', 'pneu_dd', 'pneu_te', 'pneu_td', 'interior'
  ];
  photo_key text;
BEGIN
  IF NEW.status = 'rascunho' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'finalizado' AND NEW.status = 'finalizado' THEN
    RETURN NEW;
  END IF;

  IF NEW.vehicle_id IS NULL THEN
    RAISE EXCEPTION 'Checklist incompleto: veículo obrigatório';
  END IF;

  IF NEW.driver_id IS NULL THEN
    RAISE EXCEPTION 'Checklist incompleto: técnico obrigatório';
  END IF;

  IF NEW.checklist_date IS NULL THEN
    RAISE EXCEPTION 'Checklist incompleto: data obrigatória';
  END IF;

  IF coalesce(NEW.resultado, '') = '' THEN
    RAISE EXCEPTION 'Checklist incompleto: resultado obrigatório';
  END IF;

  IF NEW.resultado = 'bloqueado' AND coalesce(trim(NEW.resultado_motivo), '') = '' THEN
    RAISE EXCEPTION 'Checklist incompleto: motivo obrigatório para bloqueio';
  END IF;

  IF coalesce(NEW.nivel_oleo, '') = ''
    OR coalesce(NEW.nivel_agua, '') = ''
    OR coalesce(NEW.danos_veiculo, '') = ''
    OR coalesce(NEW.farois_lanternas, '') = ''
    OR coalesce(NEW.vidros, '') = ''
    OR coalesce(NEW.limpeza_organizacao, '') = ''
    OR coalesce(NEW.motor, '') = ''
    OR coalesce(NEW.cambio, '') = ''
    OR coalesce(NEW.ruido_anormal, '') = ''
    OR coalesce(NEW.som, '') = ''
    OR coalesce(NEW.pneus, '') = ''
    OR coalesce(NEW.pneu_estepe, '') = ''
    OR coalesce(NEW.itens_seguranca, '') = ''
    OR coalesce(NEW.acessorios, '') = '' THEN
    RAISE EXCEPTION 'Checklist incompleto: todas as conferências devem ser respondidas';
  END IF;

  IF coalesce(NEW.troca_oleo, '') = '' THEN
    RAISE EXCEPTION 'Checklist incompleto: status de troca de óleo obrigatório';
  END IF;

  IF NEW.detalhes IS NULL
    OR NOT (NEW.detalhes ? 'km_proxima_troca')
    OR NULLIF(regexp_replace(coalesce(NEW.detalhes->>'km_proxima_troca', ''), '[^0-9]', '', 'g'), '') IS NULL THEN
    RAISE EXCEPTION 'Checklist incompleto: KM da próxima troca obrigatório';
  END IF;

  IF NOT (NEW.detalhes ? 'km_lido_painel')
    OR NULLIF(regexp_replace(coalesce(NEW.detalhes->>'km_lido_painel', ''), '[^0-9]', '', 'g'), '') IS NULL THEN
    RAISE EXCEPTION 'Checklist incompleto: KM do painel obrigatório';
  END IF;

  IF NEW.fotos IS NULL OR jsonb_typeof(NEW.fotos) <> 'object' THEN
    RAISE EXCEPTION 'Checklist incompleto: fotos obrigatórias ausentes';
  END IF;

  FOREACH photo_key IN ARRAY required_photo_keys LOOP
    IF NOT (NEW.fotos ? photo_key)
      OR jsonb_typeof(NEW.fotos -> photo_key) <> 'array'
      OR jsonb_array_length(NEW.fotos -> photo_key) = 0 THEN
      RAISE EXCEPTION 'Checklist incompleto: foto obrigatória ausente (%)', photo_key;
    END IF;
  END LOOP;

  IF jsonb_array_length(NEW.fotos -> 'interior') < 3 THEN
    RAISE EXCEPTION 'Checklist incompleto: interior exige pelo menos 3 fotos';
  END IF;

  IF NEW.danos_veiculo = 'sim' THEN
    IF coalesce(trim(NEW.avaria_descricao), '') = '' THEN
      RAISE EXCEPTION 'Checklist incompleto: descreva a avaria nova';
    END IF;

    IF NOT (NEW.fotos ? 'avaria')
      OR jsonb_typeof(NEW.fotos -> 'avaria') <> 'array'
      OR jsonb_array_length(NEW.fotos -> 'avaria') = 0 THEN
      RAISE EXCEPTION 'Checklist incompleto: foto da avaria obrigatória';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
