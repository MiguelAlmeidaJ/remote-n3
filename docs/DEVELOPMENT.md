# Desenvolvimento local

## Requisitos

- Node.js 22+
- pnpm 10+
- Rust stable
- Docker + Docker Compose

## Instalação

Na raiz do projeto:

```bash
pnpm install
pnpm build
```

## Backend

Terminal 1:

```bash
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

## Viewer

Terminal 2:

```bash
pnpm dev:desktop
```

Abra o endereço exibido pelo Vite. Por padrão o viewer se conecta a:

```text
ws://127.0.0.1:8787/ws
```

Para outro servidor, copie `apps/desktop/.env.example` para `apps/desktop/.env` e altere `VITE_SIGNALING_URL`.

## Agent

Terminal 3 ou outro computador:

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

### Testar autorização de sessão

Por segurança, o Agent rejeita solicitações automaticamente enquanto ainda não temos uma interface nativa de confirmação.

Somente em uma máquina de teste confiável, habilite temporariamente:

#### Windows

```powershell
$env:REMOTE_N3_AUTO_ACCEPT="1"
$env:REMOTE_N3_SIGNALING_URL="ws://127.0.0.1:8787/ws"
cargo run --manifest-path crates/agent/Cargo.toml
```

#### Linux

```bash
REMOTE_N3_AUTO_ACCEPT=1 \
REMOTE_N3_SIGNALING_URL=ws://127.0.0.1:8787/ws \
cargo run --manifest-path crates/agent/Cargo.toml
```

Ao clicar em **Conectar** no viewer, a sessão deve mudar de **aguardando autorização** para **autorizada**.

Essa flag é somente para desenvolvimento. Ela não substitui autenticação nem autorização de acesso não supervisionado.

## Infraestrutura

```bash
cd infra/docker
docker compose up -d
```

Isso inicia PostgreSQL, Redis e coturn.

PostgreSQL e Redis ainda não são consumidos pela primeira versão do signaling. Eles já fazem parte da infraestrutura para autenticação, persistência e presença distribuída nas próximas etapas.

## Importante

O signaling atual é uma base de desenvolvimento e ainda não possui autenticação. Não publique a porta 8787 diretamente na internet até implementarmos autenticação, autorização e TLS.
