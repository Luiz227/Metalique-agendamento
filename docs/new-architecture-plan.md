# Agenda Metalique - Nova Arquitetura

## Estrutura de pastas
- `apps/frontend`: Next.js + TypeScript + Tailwind (web + mobile + PWA)
- `apps/backend`: NestJS + Prisma + JWT + integrações Google
- `apps/backend/prisma`: schema, migrations e seed

## Serviços
- Frontend: interface e experiência mobile-first
- Backend: regras de negócio, autenticação, autorização, integrações e observabilidade
- PostgreSQL: persistência transacional
- Redis: cache de endpoints críticos e fila

## Fluxo de autenticação
1. Login em `/api/auth/login`
2. Backend valida usuário e senha
3. Backend emite `accessToken` + `refreshToken`
4. Frontend renova sessão em `/api/auth/refresh`
5. Guards por role (ADMIN, LOGISTICS, TECHNICIAN, VALIDATOR)

## Fluxo de upload
1. Front faz upload para backend
2. Backend salva temporariamente
3. Backend comprime imagem/documento
4. Backend envia para Google Drive em estrutura Ano/Mês/Cliente/OS
5. Backend salva metadados no PostgreSQL
6. Backend remove arquivo temporário

## Fluxo mapa operacional
1. Frontend solicita agendamentos filtrados
2. Backend carrega dados com índices e paginação
3. Redis responde cache quando disponível
4. Rotas/geocoding são buscados no Google Maps apenas quando necessário
5. Resultado de rota é persistido no banco para reutilização

## Fluxo de agrupamento inteligente
1. Job em fila processa janela de agendamentos
2. Calcula proximidade e tempo de deslocamento
3. Gera sugestões na tabela `route_suggestions`
4. Dashboard e Kanban consomem sugestões cacheadas

## Observabilidade e performance
- Logs de tempo por endpoint
- Alertas para respostas > 1000ms
- Cache Redis em dashboard, agenda, mapa, sugestões e notificações
- Paginação e lazy loading em listagens
- Filas para tarefas pesadas (rotas, calendar, notificações)
