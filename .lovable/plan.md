

## Alinhar FleetDesk ao Design System WAI ERP

O FleetDesk atual usa um tema escuro customizado. O WAI ERP usa um design system "enterprise clean" com fundo branco, sidebar navy (#0A1628), primary azul elétrico (#0066FF), e fonte Inter. Vou replicar exatamente o mesmo padrão.

---

### O que muda

**1. Design System (index.css + tailwind.config.ts)**
- Copiar a paleta completa do WAI ERP: fundo branco (`0 0% 100%`), sidebar navy (`216 60% 10%`), primary azul elétrico (`217 100% 50%`), cores semânticas (success, warning, error, info), chart colors
- Incluir suporte a dark mode (classe `.dark`)
- Copiar toda a camada de componentes CSS: `.card-enterprise`, `.kpi-card`, `.table-enterprise`, `.sidebar-item`, `.badge-*`, `.filter-bar`, `.breadcrumb`, `.status-card`, `.ai-banner`, skeletons, scrollbar, etc.
- Escala tipográfica: display (32px), h1 (24px), h2 (18px), h3 (16px), body (14px), small (12px), tiny (11px)
- Tailwind config: fontSize scale, spacing scale (xs/sm/md/lg/xl), borderRadius (cards 12px, modais 16px), boxShadow scale, animações (fade-in, slide-up, scale-in, modal-enter, spinner)

**2. Layout (AppLayout, AppSidebar, AppHeader)**
- Substituir sidebar atual por sidebar colapsável estilo WAI ERP: 240px expandida / 64px colapsada, com grupos de menu colapsáveis (ChevronDown), badge de notificação, avatar do usuário no rodapé, botão "Recolher menu"
- Adicionar AppHeader com: título da página + breadcrumb, barra de busca central, menu do usuário com dropdown, botão hamburger no mobile
- Layout principal: `bg-muted` no conteúdo, sidebar fixa, header sticky, max-width 7xl no conteúdo
- Mobile: sidebar como drawer (slide from left) com overlay escuro

**3. Login**
- Atualizar para gradiente escuro (`from-slate-950 via-slate-900`) como o WAI ERP, card com borda slate, tabs Login/Criar Conta, ícones nos inputs (Mail, Lock, User), botão com Loader2

---

### Arquivos afetados

| Arquivo | Ação |
|---------|------|
| `src/index.css` | Substituir completamente pelo design system WAI ERP |
| `tailwind.config.ts` | Substituir com escala tipográfica, spacing, shadows, animações |
| `src/components/layout/AppSidebar.tsx` | Reescrever: sidebar colapsável com grupos, badges, avatar |
| `src/components/layout/AppHeader.tsx` | Criar: header com breadcrumb, busca, user menu |
| `src/components/layout/AppLayout.tsx` | Reescrever: sidebar fixa + header sticky + overlay mobile |
| `src/components/layout/MobileNav.tsx` | Remover (substituído pelo drawer mobile na sidebar) |
| `src/pages/Login.tsx` | Atualizar visual para padrão WAI ERP |

