-- RPC atômica usada pelo sync-daily-km em modo strict.
-- Recebe os dados de UM (adesao, dia) e faz delete + insert na mesma transação.
-- Se qualquer linha falhar, o delete também é revertido.
CREATE OR REPLACE FUNCTION public.sync_replace_day_telemetry(
  p_adesao_id text,
  p_data date,
  p_events jsonb,   -- array de objetos com colunas de vehicle_telemetry_events
  p_sessions jsonb  -- array de objetos com colunas de daily_vehicle_km
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted_events int := 0;
  v_inserted_sessions int := 0;
BEGIN
  -- Limpa janela alvo
  DELETE FROM public.vehicle_telemetry_events
    WHERE adesao_id = p_adesao_id AND data = p_data;
  DELETE FROM public.daily_vehicle_km
    WHERE adesao_id = p_adesao_id AND data = p_data;

  -- Insere eventos
  IF jsonb_array_length(COALESCE(p_events, '[]'::jsonb)) > 0 THEN
    INSERT INTO public.vehicle_telemetry_events (
      adesao_id, placa, data, event_at, event_type, event_type_raw,
      motorista_id, motorista_nome, endereco, velocidade, duracao_segundos,
      external_id, raw, synced_at
    )
    SELECT
      e->>'adesao_id',
      e->>'placa',
      (e->>'data')::date,
      (e->>'event_at')::timestamptz,
      e->>'event_type',
      e->>'event_type_raw',
      NULLIF(e->>'motorista_id',''),
      e->>'motorista_nome',
      NULLIF(e->>'endereco',''),
      NULLIF(e->>'velocidade','')::numeric,
      NULLIF(e->>'duracao_segundos','')::numeric,
      e->>'external_id',
      e->'raw',
      COALESCE((e->>'synced_at')::timestamptz, now())
    FROM jsonb_array_elements(p_events) AS e;
    GET DIAGNOSTICS v_inserted_events = ROW_COUNT;
  END IF;

  -- Insere sessões
  IF jsonb_array_length(COALESCE(p_sessions, '[]'::jsonb)) > 0 THEN
    INSERT INTO public.daily_vehicle_km (
      adesao_id, placa, data, motorista_nome, motorista_id,
      km_percorrido, tempo_deslocamento, tipo_vinculo, hr_vinculo,
      telemetrias, velocidade_maxima, excessos_velocidade, synced_at
    )
    SELECT
      s->>'adesao_id',
      s->>'placa',
      (s->>'data')::date,
      s->>'motorista_nome',
      NULLIF(s->>'motorista_id',''),
      COALESCE(NULLIF(s->>'km_percorrido','')::numeric, 0),
      NULLIF(s->>'tempo_deslocamento',''),
      NULLIF(s->>'tipo_vinculo',''),
      NULLIF(s->>'hr_vinculo',''),
      COALESCE(NULLIF(s->>'telemetrias','')::int, 0),
      COALESCE(NULLIF(s->>'velocidade_maxima','')::numeric, 0),
      COALESCE(NULLIF(s->>'excessos_velocidade','')::int, 0),
      COALESCE((s->>'synced_at')::timestamptz, now())
    FROM jsonb_array_elements(p_sessions) AS s;
    GET DIAGNOSTICS v_inserted_sessions = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'inserted_events', v_inserted_events,
    'inserted_sessions', v_inserted_sessions
  );
END;
$$;

-- Apenas service_role pode chamar
REVOKE ALL ON FUNCTION public.sync_replace_day_telemetry(text, date, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_replace_day_telemetry(text, date, jsonb, jsonb) TO service_role;
