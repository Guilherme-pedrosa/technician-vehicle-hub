# Project Memory

## Core
- **Mobile-first UI**: Full-screen dialogs, card layouts, large touch targets, toasts top-center.
- **Components**: Use `SearchableSelect` for large dropdowns.
- **Date Filters**: Use explicit Start/End fields with `parseDateInput`, auto-invert if start > end.
- **Terminology**: Use 'Telemetrias' instead of 'Viagens'.
- **Data Exclusions**: ALWAYS ignore vehicles DIW9D20, IXO3G66, and OHW9F00 in all metrics and dashboards.
- **Auth Fallback**: If permissions fail to load, temporarily fallback to 'admin' to prevent lockout.
- **Telemetrias = sessões reais**: 1 entrada log_motorista = 1 telemetria. NUNCA pro-ratear dados do veículo.

## Memories

### Architecture & API Integration
- [API Proxy Pattern](mem://architecture/api-proxy-pattern) — Retry/backoff logic for API Rota Exata
- [Rota Exata API Specs](mem://architecture/rota-exata-api-integration-specs) — GET with JSON `where`, 404s handled as empty arrays
- [API Concurrency](mem://architecture/api-concurrency-management) — 8 concurrent calls for <=7 days, 2 for >7 days to prevent 502/429
- [Sync Daily KM Contract](mem://architecture/sync-daily-km-contract) — Modos strict/resilient, pool, retry, dedup por external_id
- [Automated Hourly Sync](mem://architecture/automated-hourly-sync) — `cron-sync-rotaexata` updates `km_atual` every hour
- [KM History Caching](mem://architecture/km-history-caching) — Upsert logic for `daily_vehicle_km` cache
- [Storage Reliability](mem://architecture/storage-reliability-pattern) — Parallel uploads and retry logic for checklist photos

### Auth & Roles
- [Role-Based Access Control](mem://auth/role-based-access-control) — 'admin' (full access) vs 'tecnico' (restricted)
- [User Management Implementation](mem://auth/user-management-implementation) — Admins managed via Edge Function and `getClaims()`

### Logic & Data
- [Mileage Normalization](mem://logic/mileage-normalization-rules) — Parsing decimals, conversions, and GPS drift filtering
- [Telemetry Staleness](mem://logic/vehicle-telemetry-staleness) — Telemetry > 10 mins is obsolete; strict date filtering
- [Technician Attribution](mem://logic/technician-attribution-priority) — Exact driver ID match, unidentified grouped as 'Sem condutor vinculado'
- [Speed Monitoring](mem://logic/speed-monitoring-rules) — Speed pro-rated from daily summary, default limit 120km/h
- [Telemetria Attribution Fix](mem://logic/telemetria-attribution-fix) — 1 log_motorista entry = 1 real telemetria, no pro-rating
- [KM Atual Calculation](mem://logic/km-atual-rota-exata-calc) — KM real = última correção /odometro + delta odometro_rastreador desde a correção
- [Data Sync Flow](mem://features/data-synchronization-flow) — General sync must NOT trigger historical KM sync
- [Data Sync Accessibility](mem://features/data-synchronization-ui-accessibility) — Sync buttons bypass RBAC to avoid race conditions

### Vehicle Checklist
- [Flow Structure](mem://features/vehicle-checklist/flow-structure) — 8-step pre-op inspection flow
- [AI Validation Rules](mem://features/vehicle-checklist/ai-validation) — Gemini rules: reject over hallucinate
- [Technical Resilience](mem://features/vehicle-checklist/technical-resilience) — AI validation non-blocking (timeout 30s)
- [Data Protection](mem://features/vehicle-checklist/data-protection) — Block accidental form closure
- [Technician Attribution](mem://features/vehicle-checklist/technician-attribution) — Auto-linked via `drivers` and auth `user_id`
- [Admin Management](mem://features/vehicle-checklist/admin-management) — Editing sent checklists restricted to admins
- [Compliance Automation](mem://features/vehicle-checklist/compliance-automation) — Resend email alerts for negative checklists
- [Approval Rules](mem://logic/checklist-approval-rules) — Justification required for 'Bloqueado', not for 'Liberado com observação'
- [Maintenance Validation](mem://logic/maintenance-validation-rules) — Oil check against next oil change KM
- [Mobile Memory Optimization](mem://performance/mobile-memory-optimization) — Image compression and RAM management for Android

### Maintenance
- [Kanban Board](mem://features/maintenance/kanban-board) — Ticket states and admin email notifications
- [Preventive Automation](mem://logic/preventive-automation-rules) — Daily scan (90% limit) auto-creates tickets
- [Preventive Scope](mem://features/maintenance/preventive-scope-definition) — Focuses only on guaranteed periodic replacements
- [Plan Overrides](mem://logic/maintenance-plan-overrides) — Exclusions for Etios, Onix (timing belt, ignition cables)
- [Component Linking](mem://logic/maintenance-component-linking) — Grouped replacement for parts sharing labor
- [Stop Optimization](mem://logic/maintenance-stop-optimization) — Syncing secondary services with 10k/20k oil changes
- [Executor Classification](mem://features/maintenance/executor-classification) — 'Técnico' (field) vs 'Oficina' (complex)
- [Service Order PDF](mem://features/maintenance/service-order-pdf) — Batch ticket creation and PDF exports
- [Completion Workflow](mem://logic/maintenance-completion-workflow) — Confirming items and capturing odometer on completion
- [Automatic Ticket Recovery](mem://features/maintenance/automatic-ticket-recovery) — Recreate tickets if edited checklist is non-compliant
- [Dashboard Filters](mem://ui/preventive-dashboard-filters-logic) — Filters clear selections on change
- [KM sem checklist scan](mem://features/maintenance/km-sem-checklist-scan) — Daily 10:30 + on-demand scan; opens NC ticket if vehicle ran >30km without checklist

### UI & Features
- [Dashboard Technician Report](mem://features/dashboard-technician-report) — Metrics consolidation, defaults to 'Mês'
