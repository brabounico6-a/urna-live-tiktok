# Urna LIVE TikTok — enquete interativa

Painel recreativo de LIVE. **Não é votação oficial nem resultado eleitoral oficial.**

## O que já está configurado

- Comentário `22` -> +1 no lado Flávio.
- Comentário `13` -> +1 no lado Lula.
- Presente `Rosa` / `Rose` -> +1 no lado Lula.
- Presente `Rosa Branca` / `White Rose` -> +1 no lado Flávio.
- Presentes em sequência usam a quantidade final para evitar duplicação.
- Animação de mão apertando os dígitos e depois `CONFIRMA`.
- Som eletrônico tipo “pilili” no momento da confirmação.
- Fila de animações quando chegam muitos votos juntos.
- Placar, porcentagens, participantes, rodada e histórico recente.
- Modo de teste sem precisar abrir LIVE.
- Reconexão automática se a conexão cair.
- Configuração dos nomes de presentes pelo painel.

## Arquivos principais

- `server.js`: servidor, TikTok LIVE, contagem e WebSocket.
- `public/index.html`: tela do painel.
- `public/app.js`: animações, áudio e controles.
- `public/style.css`: visual.
- `public/hand.svg`: mão usada na animação.
- `railway.json`: deploy no Railway.
- `render.yaml`: deploy no Render.
- `.env.example`: variáveis de ambiente.

# Tutorial pelo celular — GitHub + Railway

## 1. Criar o repositório no GitHub

1. Abra o GitHub no navegador do celular.
2. Toque em `+` -> `New repository`.
3. Nome sugerido: `urna-live-tiktok`.
4. Pode deixar o repositório privado.
5. Crie o repositório.

## 2. Enviar os arquivos

1. Extraia este ZIP no celular.
2. Dentro do repositório no GitHub, escolha `Add file` -> `Upload files`.
3. Envie **o conteúdo de dentro da pasta**, não uma pasta ZIP fechada.
4. Na raiz do GitHub devem aparecer, entre outros:
   - `package.json`
   - `server.js`
   - `railway.json`
   - `render.yaml`
   - pasta `public`
5. Confirme o upload/commit.

## 3. Publicar no Railway

1. Entre no Railway e crie um projeto.
2. Escolha deploy a partir do GitHub.
3. Selecione o repositório `urna-live-tiktok`.
4. O Railway deve detectar Node.js e executar `npm start`.
5. Abra `Variables` e adicione:
   - `ADMIN_PIN` = escolha um PIN seu (ex.: 5837). **Não use o exemplo em público.**
   - `TIKTOK_USERNAME` = seu @ sem o `@` (opcional).
   - `EULER_API_KEY` = deixe vazio se não tiver.
6. Não precisa criar `PORT`: o Railway fornece automaticamente.
7. Em Networking/Domains, gere um domínio público.
8. Abra o endereço gerado.

## 4. Usar durante a LIVE

1. Primeiro inicie sua LIVE no TikTok.
2. Abra o painel hospedado.
3. Toque no painel uma vez para o navegador liberar áudio.
4. Informe o PIN de administrador.
5. No campo da LIVE, coloque o `@usuario` que está ao vivo.
6. Toque em `Conectar LIVE`.
7. Quando aparecer `LIVE conectada`, está pronto.

A partir daí:

- alguém comenta `22` -> +1 Flávio;
- alguém comenta `13` -> +1 Lula;
- alguém envia `Rosa` -> +1 Lula;
- alguém envia `Rosa Branca` -> +1 Flávio.

## 5. Testar antes da LIVE

Use o modo TESTE do painel:

- simular comentário `22`;
- simular comentário `13`;
- simular presente `Rosa`;
- simular presente `Rosa Branca`.

Confirme se a mão digita o número, aperta `CONFIRMA`, toca o som e o placar aumenta.

# Alternativa — Render

1. Crie um novo `Web Service` no Render.
2. Conecte o mesmo repositório do GitHub.
3. Build command: `npm install`.
4. Start command: `npm start`.
5. Adicione `ADMIN_PIN`, `TIKTOK_USERNAME` (opcional) e `EULER_API_KEY` (opcional).
6. O arquivo `render.yaml` também já está incluído no projeto.

## Se “Rosa” não contar

O TikTok pode retornar nomes de presente diferentes conforme idioma/conta. No painel, veja o histórico do presente recebido e adicione o nome exato na configuração:

- aliases do lado Lula: `Rose`, `Rosa`;
- aliases do lado Flávio: `White Rose`, `Rosa Branca`.

Salve e teste novamente.

## Se a conexão com TikTok parar

A biblioteca usada é `tiktok-live-connector`, uma integração não oficial que lê eventos públicos da LIVE. Mudanças do TikTok podem exigir atualização futura da dependência. O projeto está fixado na versão `2.5.0`.

Para atualizar futuramente, altere a versão em `package.json` e faça novo deploy.

## Segurança

- Troque `ADMIN_PIN` no servidor hospedado.
- Não publique cookies, senhas ou tokens da sua conta TikTok.
- Este projeto não precisa da senha da sua conta para ler uma LIVE pública.

## Sobre o som

O painel gera o efeito eletrônico no próprio navegador, inspirado no conhecido “pilili” da urna. Não depende de baixar um áudio externo, então continua funcionando mesmo hospedado.

