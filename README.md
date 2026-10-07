# Remote N3

Sistema de acesso remoto multiplataforma em desenvolvimento.

## Objetivo

Construir uma base própria para acesso remoto entre Windows e Linux, evoluindo depois para Android, com:

- cadastro e identificação de dispositivos;
- presença online/offline;
- signaling em tempo real;
- sessões remotas;
- captura de tela;
- mouse e teclado;
- acesso não supervisionado;
- transferência de arquivos;
- terminal remoto;
- suporte futuro a Android.

## Arquitetura inicial

```text
remote-n3/
├── apps/
│   ├── desktop/        # cliente desktop (Tauri + React)
│   └── web-admin/      # painel web futuro
├── services/
│   ├── api/            # API + signaling
│   └── relay/          # infraestrutura TURN/relay
├── crates/
│   └── agent/          # agente nativo em Rust
├── packages/
│   └── shared/         # tipos e contratos compartilhados
├── infra/
│   └── docker/         # ambiente local
└── docs/
```

## Stack

- Desktop: Tauri + React + TypeScript
- Agent: Rust
- Backend: Node.js + TypeScript
- Realtime: WebSocket
- Remote transport: WebRTC
- Banco: PostgreSQL
- Presença/sessões: Redis
- TURN: coturn
- Infra: Docker

## Fase atual

Fase 1: fundação do monorepo, API de signaling e agente inicial.
