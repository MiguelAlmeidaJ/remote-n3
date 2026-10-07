# Desenvolvimento local

## Requisitos

- Node.js 22+
- pnpm 10+
- Rust stable
- Docker + Docker Compose

## Backend

Na raiz:

```bash
pnpm install
pnpm dev:api
```

Teste:

```bash
curl http://localhost:8787/health
```

Resposta esperada:

```json
{
  "status": "ok",
  "service": "remote-n3-api",
  "devicesOnline": 0
}
```

## Agent

Em outro terminal:

### Windows PowerShell

```powershell
$env:REMOTE_N3_SIGNALING_URL="ws://127.0.0.1:8787/ws"
cargo run --manifest-path crates/agent/Cargo.toml
```

### Linux

```bash
REMOTE_N3_SIGNALING_URL=ws://127.0.0.1:8787/ws \
cargo run --manifest-path crates/agent/Cargo.toml
```

O Agent cria um ID persistente localmente e registra o dispositivo no servidor.

## Infraestrutura

```bash
cd infra/docker
docker compose up -d
```

Isso inicia PostgreSQL, Redis e coturn.

PostgreSQL e Redis ainda não são consumidos pela primeira versão do signaling. Eles já fazem parte da infraestrutura para autenticação, persistência e presença distribuída nas próximas etapas.

## Importante

O signaling atual é uma base de desenvolvimento e ainda não possui autenticação. Não publique a porta 8787 diretamente na internet até implementarmos autenticação, autorização e TLS.
