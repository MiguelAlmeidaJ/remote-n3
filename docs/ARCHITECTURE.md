# Arquitetura do Remote N3

## Componentes

### API / Signaling

Responsável por:

- presença online/offline;
- descoberta de dispositivos;
- negociação inicial de sessão;
- encaminhamento de SDP/ICE para WebRTC;
- autenticação e autorização nas próximas etapas.

O vídeo da sessão remota não deve trafegar pela API quando uma conexão P2P for possível.

### Agent

Processo nativo que roda no dispositivo remoto.

Primeira versão:

- gera e persiste um ID do dispositivo;
- identifica hostname e plataforma;
- conecta ao signaling por WebSocket;
- publica presença;
- recebe mensagens de sessão.

Próximas responsabilidades:

- captura de tela;
- codificação de vídeo;
- injeção de mouse/teclado;
- WebRTC;
- serviço do Windows/systemd;
- atualização automática.

### TURN

coturn será utilizado como fallback quando o P2P não puder ser estabelecido.

## Fluxo de sessão

1. Agent A e Agent B conectam ao signaling.
2. Ambos publicam `device:hello`.
3. Viewer solicita sessão para o Device B.
4. Device B aceita a sessão.
5. Signaling encaminha offer/answer/ICE.
6. WebRTC tenta conexão P2P.
7. Se necessário, o tráfego usa TURN.
8. Vídeo e DataChannels passam pela sessão WebRTC.

## Segurança

A base atual ainda é de desenvolvimento. Antes de qualquer uso fora de rede de testes serão adicionados:

- autenticação de usuário;
- credenciais/chaves por dispositivo;
- autorização explícita de sessão;
- tokens de curta duração;
- TLS/WSS;
- auditoria;
- acesso não supervisionado configurável;
- proteção contra replay e impersonation.

Não expor o signaling atual diretamente à internet.
