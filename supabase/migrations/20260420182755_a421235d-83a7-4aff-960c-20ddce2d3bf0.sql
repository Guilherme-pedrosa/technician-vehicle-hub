SELECT cron.schedule(
  'sync-auvo-expenses-daily',
  '0 9 * * *',
  $$
  SELECT net.http_post(
    url:='https://qfmpyrekjbbqekxrjgov.supabase.co/functions/v1/sync-auvo-expenses',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmbXB5cmVramJicWVreHJqZ292Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4Njc5NzMsImV4cCI6MjA4OTQ0Mzk3M30.ac7r6m5dLzMrEQxMQr74Bo38bgeupr5-bs0Ja4CCo2s"}'::jsonb,
    body:='{"source": "cron"}'::jsonb
  ) AS request_id;
  $$
);