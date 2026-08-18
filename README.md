# Conversor de Horário

Mini site (PWA) que converte um horário entre **Brasil, Portugal, Malásia, Coreia do Sul e
EUA (Leste)**. Instalável na tela inicial do Android e funciona offline — todo o cálculo é
local, sem servidor nem API externa.

## Como usar

- **Referência:** escolha qual país é o "mestre". Só ele tem data e hora editáveis; os
  outros quatro aparecem como cards calculados.
- **Modo ao vivo:** o botão "Agora" liga o relógio em tempo real (atualiza a cada segundo).
  Responde "que horas são lá agora".
- **Modo fixo:** editar a data ou a hora congela o instante. Responde "que horas serão lá
  quando for X aqui". O indicador embaixo do botão mostra qual modo está ativo.
- **Etiqueta de dia:** cada card diz se lá é o mesmo dia, `+1 dia` ou `−1 dia` em relação à
  data do país de referência. O offset (`UTC+09:00`) aparece ao lado — é o que deixa o
  horário de verão visível.

Trocar o país de referência **não** reseta nada: o mesmo instante passa a ser mostrado na
visão local do novo país.

## Como rodar localmente

Não tem build nem dependência. Abrir `index.html` no navegador já funciona pro grosso do
app — mas **service worker exige `http://` ou `https://`**, então pra testar o comportamento
offline suba um servidor local:

```bash
python -m http.server 8000
```

Depois abra `http://localhost:8000`.

## Antes de publicar: gerar os ícones PNG

O manifest declara ícones PNG que ainda não estão no repositório. Abra
`ferramentas/gerar-icones.html` no navegador, clique em "Baixar os 3 PNGs" e mova
`icon-192.png`, `icon-512.png` e `icon-maskable-512.png` para a pasta `icons/`.

Sem eles o app ainda instala (o SVG serve de fallback), mas o ícone pode sair genérico em
alguns lançadores do Android.

## Publicar no GitHub Pages

1. Criar um repositório público (ex.: `conversor-horario`) e subir os arquivos — dá pra
   arrastar direto na interface web do GitHub, sem linha de comando.
2. Settings > Pages > Source: branch `main`, pasta `/ (root)`.
3. Abrir a URL gerada (`usuario.github.io/conversor-horario`) — leva 1-2 minutos no ar.
4. No Android: abrir no Chrome > menu de três pontinhos > "Instalar app".

**Ao publicar uma alteração**, subir o número da versão em `service-worker.js`
(`const VERSAO_CACHE = 'conversor-horario-v1'` → `v2`). Sem isso, quem já instalou continua
vendo a versão antiga, servida do cache.

## Estrutura

```
index.html            tela única
style.css             visual (tema claro e escuro automáticos)
app.js                conversão de fusos, modos ao vivo/fixo, persistência
manifest.json         identidade do PWA (caminhos relativos — o app roda em subpasta)
service-worker.js     cache offline versionado
icons/                ícone comum e versão maskable
ferramentas/          gerador dos PNGs (não precisa ir pro GitHub)
handoff_conversor_horario.md   especificação e decisões técnicas
```

## Observações

- Os fusos e as regras de horário de verão vêm do próprio sistema operacional (via `Intl`),
  não de uma tabela no código — não precisa manutenção quando as regras mudam.
- O estado canônico do app é um instante em UTC; os campos são só uma visão dele. É isso que
  faz a troca de referência e as viradas de horário de verão funcionarem.
- Nas duas viradas anuais de DST (Portugal e EUA) existe uma hora que não existe e outra que
  acontece duas vezes. Nesses casos o app resolve silenciosamente para um dos valores
  possíveis — decisão registrada no handoff.
