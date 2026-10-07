# Roadmap

## M0 — Fundação

- [x] Monorepo
- [x] Tipos de protocolo compartilhados
- [x] Signaling WebSocket
- [x] Presença online/offline
- [x] Roteamento de mensagens por deviceId
- [x] Agent Rust inicial
- [x] Docker para PostgreSQL, Redis e coturn

## M1 — Primeira sessão Windows

- [x] Viewer desktop em Next.js
- [x] Solicitação/aceite de sessão
- [x] Negociação WebRTC offer/answer
- [x] ICE inicial via SDP completo + STUN
- [x] DataChannel de controle
- [ ] Validar P2P Windows ↔ Windows em duas máquinas
- [ ] Validar fallback TURN em redes diferentes
- [ ] Captura de tela Windows
- [ ] Stream de vídeo
- [ ] Mouse
- [ ] Teclado

## M2 — Acesso não supervisionado

- [ ] Registro seguro de dispositivo
- [ ] Chaves por dispositivo
- [ ] Agent como Windows Service
- [ ] ACL de dispositivos
- [ ] Reconexão automática

## M3 — Linux

- [ ] Agent systemd
- [ ] X11
- [ ] PipeWire
- [ ] Wayland / XDG Desktop Portal
- [ ] input remoto

## M4 — Recursos adicionais

- [ ] Clipboard
- [ ] Transferência de arquivos
- [ ] Multi-monitor
- [ ] Terminal remoto
- [ ] Wake-on-LAN
- [ ] Inventário

## M5 — Android

- [ ] App Kotlin
- [ ] MediaProjection
- [ ] WebRTC
- [ ] AccessibilityService para controles permitidos
