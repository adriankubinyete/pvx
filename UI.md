# Padrão de interação e visual do pvx

Este arquivo é a norma para quem constrói telas no pvx (agentes e autores de módulo).
Uma tela nova segue estas regras; um desvio precisa de uma entrada em `DECISIONS.md`.
O contrato de código dos módulos está em `packages/sdk/README.md`.

## 1. Níveis de foco

O foco desce por quatro níveis: barra de abas → página/aba → painel → dentro da lista.

```text
barra de abas  ──↓/enter──▶  página  ──enter──▶  painel  ──enter──▶  item da lista
               ◀──↑/esc───            ◀──esc───          ◀──esc────
```

- As setas trocam de painel pela posição na tela (como no Início), não por uma ordem fixa: `→` com painéis lado a lado, `↓` empilhados.
- `enter` entra no painel (só se ele tiver itens; sem itens, avise "nada para selecionar").
- `esc` sai um nível. Em módulos: `useBack(inside ? sair : undefined)`.
- `↑` no painel de cima vai para a barra de abas (`toBar`).
- `1`/`2`/`3` pulam direto para os painéis, na ordem em que aparecem.
- Módulos usam `usePanels()` (`ref`, `pick`, `step`, `toBar`, `wrap`) e dão `panelRef={p.ref(id)}` a cada `Panel` navegável.
- Desenhe o foco só quando `usePageFocused()` for `true`: com o foco na barra, nenhum painel parece ativo.
- Use `Panel onPress` para focar o painel clicado.

Exemplos no código:

- `packages/tui/src/panelnav.ts` (`pickPanel`, `panelStep`).
- `packages/tui/src/tabs/HomeTab.tsx` (atalhos `1/2/3`, `↑` para a barra).
- `packages/tui/src/tabs/Tabs.tsx`.
- `packages/tui/src/tabs/SistemaTab.tsx` (seções numeradas `1`/`2` dentro de uma aba, também clicáveis).
- `packages/tui/src/sdk-ui/pages.tsx` e `packages/sdk/src/index.ts` (`usePanels`, `useBack`, `usePageFocused`).

## 2. Três estados visuais

Nunca confunda os três.

| Estado | Quando | Aparência |
| --- | --- | --- |
| Seleção ativa | o foco está nesta lista/grade | cor de destaque (`accent`), borda ou fundo `selected`, `●` no título do painel focado |
| Seleção inativa | o foco está em outro lugar | cinza/apagada, sem destaque; mantém o usuário orientado (padrão "inactive selection" dos editores) |
| Hover | o mouse está sobre o item | realce sutil (fundo do painel e `›` apagado) |

- Hover nunca muda a seleção por si.
- Exceção do pvx: dentro de uma lista ATIVA, o hover move a seleção. Fora dela, só realça.
- Uma lista sem foco passa `selected` indefinido ao `List` (ou desenha a seleção inativa); nunca finja foco.
- Hover e seleção inativa não usam a cor de destaque.

Exemplos no código:

- `packages/tui/src/sdk-ui/kit.tsx` (`List`: `selected`, `onHover`).
- `packages/tui/src/menu/CardGrid.tsx` (grade de cartões: `hot` e `lit`; hover move a seleção só com a grade focada).
- `packages/tui/src/tabs/HomeTab.tsx`.
- `packages/tui/src/theme.ts` (token `selected`).

## 3. Mouse sempre reativo

- Tudo que parece clicável é clicável: `‹ ›`, segmentos, botões, cartões, linhas.
- Clique na área de uma aba, com a barra de abas focada, leva o foco para a aba.
- Clique num painel foca aquele painel.
- Clique numa linha entra na lista e seleciona a linha.
- Clique fora de um menu aberto fecha o menu.
- Hover sempre dá retorno visual (estado 3 da seção 2).
- O clique convive com o teclado: a mesma ação existe nos dois.

Exemplos no código:

- `packages/tui/src/menu/ActionMenu.tsx` (camada que fecha o menu ao clicar fora).
- `packages/tui/src/menu/CardGrid.tsx`.
- `packages/tui/src/sdk-ui/kit.tsx` e `packages/tui/src/sdk-ui/fields.tsx` (`List onPress`, botões e campos clicáveis).
- `packages/tui/src/tabs/Tabs.tsx` e `packages/tui/src/tabs/HomeTab.tsx`.

## 4. Listas

- Wrap-around: `↓` no último item vai ao primeiro; `↑` no primeiro vai ao último (`usePanels().wrap`).
- Botões de ação ("+ adicionar…") são linhas navegáveis no fim da lista.
- Mais de um dado por linha: colunas alinhadas, com cabeçalho (`List` com `columns`).
- Texto que não cabe termina em `…`.
- Só a linha selecionada da lista ativa rola o texto cortado (letreiro, vai e volta).
- Seleção por id, nunca por índice: a lista muda de ordem e de tamanho.
- Uma lista longa se janela pelo tamanho do terminal: `List maxRows={...}` (calculado por `useViewport`) desenha só as linhas visíveis e mantém a seleção dentro da janela. O `Panel` que a carrega leva `shrink`, para o cabeçalho e o rodapé do host nunca saírem da tela. A página não rola.
- Ação da linha: `List onAction`. `enter` na linha selecionada (o rodapé mostra `enter abrir`) e o clique abrem o formulário da linha (`Fields` com os campos e `onDelete`); o `remover` pede a confirmação do framework. Duas listas com `onAction` numa tela recebem o mesmo `selected`: só a que tem a linha com esse id registra o `enter` (o rodapé mostra `enter abrir` uma vez). Não ponha atalhos soltos (`x`, `c`) para remover ou copiar. Com `actionOnClick={false}` o clique só seleciona (como na seção 3) e abrem `enter` ou um segundo clique na linha selecionada; use quando abrir a ação num clique solto seria agressivo.

```text
 REGRA        ORIGEM          AÇÃO
 ssh          0.0.0.0/0       aceitar
▸ http-alt     10.0.0.0/8 …    bloquear      ← selecionada: rola
 + adicionar regra…
```

Exemplos no código:

- `packages/tui/src/sdk-ui/columns.ts` e `packages/tui/src/sdk-ui/kit.tsx` (`columns`, letreiro).
- `packages/tui/src/panelnav.ts` e `packages/sdk/src/index.ts` (`wrap`).
- `packages/tui/src/menu/ItemList.tsx`, `packages/tui/src/menu/CardGrid.tsx` e `packages/tui/src/menu/Menu.tsx` (navegação circular e botões no fim: arquivos em edição; confira o código atual).

## 5. Rodapé e ações

- Rodapé curto: até ~5 atalhos (navegação, ação principal, `?`).
- As ações de um item ficam num menu aberto com `enter`; cada linha mostra a sua tecla à direita.
- Os atalhos diretos continuam funcionando com o menu fechado.
- Legenda de símbolos e atalhos extras vão no `?` (`useKey(..., { help: true })`).
- Ação de uso único (ex.: "confiar nos IPs da Phonevox") é botão, não atalho.
- `esc`, `?`, `ctrl+c` e `ctrl+k` são do host: não os redefina.

```text
┌ ssh ────────────────┐
│ editar        e     │
│ desativar     d     │
│ remover       x     │
└─────────────────────┘
```

Exemplos no código:

- `packages/tui/src/menu/ActionMenu.tsx` e `packages/tui/src/menu/Menu.tsx` (`cardActions`).
- `packages/tui/src/Shortcuts.tsx` (rodapé e `?`).
- `packages/tui/src/keymap.ts`.
- `packages/sdk/src/index.ts` (`useKey`).

## 6. Cor e texto

- Cor só para o que pede ação ou atenção.
- Estado = cor + palavra, nunca só cor (acessibilidade e terminais sem cor).
- Todo símbolo tem legenda no `?`: `◆` oficial, `◇` externo, `⚠` atenção.
- Campo sem valor mostra `—`, nunca vazio nem "N/A".
- Nada de texto explicativo fixo na tela: a explicação vai para o `?`.
- Rótulo de regra no infinitivo ou estado desejado ("aceitar", "bloquear"), não no particípio ("aceito"), que parece já aplicado.
- Cores só por tokens do tema (`useTheme().c`); nunca um literal hexadecimal fora de `packages/tui/src/theme.ts`.
- Cada glifo novo ocupa uma célula: confira num teste de frame.
- Termos fixos, sem sinônimos (lista no `CLAUDE.md`).

Exemplos no código:

- `packages/tui/src/theme.ts` (tokens: `accent`, `warn`, `error`, `info`, `thirdParty`, `dim`).
- `packages/tui/src/menu/cards.ts` (símbolos e tons dos cartões).
- `packages/tui/src/tabs/conformity.ts`.

## 7. Formulários

Use `ui.Fields` (campos próprios) ou `ui.Form` (os argumentos de um comando do módulo). Os dois desenham o mesmo formulário, que é o padrão do pvx. A regra de linguagem está na seção 16; aqui está o desenho.

```text
 Criar o usuário no UOE                                    ← título em negrito
 Cria o usuário e já entra                                 ← descrição, apagada, uma linha

 › Usuário *     ░admin░░░░░░░░░░░░░░░░░░░░░  Nome do novo usuário
                                                           ← uma linha em branco entre campos
   Senha *       ░••••••••░░░░░░░░░░░░░░░░░░░  Mínimo de 8 caracteres
                 ✗ preencha este campo                     ← erro: vermelho, abaixo do valor
   ID do cliente ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
   Pasta no UOE  ░clientes/12-3-acme░░░░░░░░░░
   Ativa         [x] enviar também as de ontem

   [ criar e entrar ]  [ cancelar ]                        ← primário cheio (fundo de acento)

 ↑↓ tab campo   enter avança   ctrl+s salva   ctrl+d ver o comando   esc voltar   ? ajuda
```

O desenho, sem exceção:

- **Título e descrição.** O título (negrito) vem de `title` (em `Form`: o `title` do comando, senão o `help`); a descrição apagada, de uma linha, vem de `description`. O título aparece uma só vez: um `Panel` em volta com o mesmo título é erro.
- **Rótulo e obrigatório.** Rótulos alinhados numa coluna. O obrigatório é um `*` vermelho (token `error`) logo depois do rótulo, nunca verde nem de acento. Campo opcional não leva marca.
- **Célula de valor.** Todo campo de texto tem uma célula com fundo preenchido (token `panel`), de largura fixa (30 colunas), mesmo vazia. A célula do campo em foco tem fundo mais forte (`selected`) e o cursor. Em temas sem fundo próprio (Terminal) o cursor continua visível.
- **Marcador de foco.** O `›` do campo em foco mora numa coluna própria de 2 células: ele nunca desloca rótulo nem valor.
- **Espaço entre campos.** Uma linha em branco entre campos. Se o terminal for baixo, a área dos campos rola (acompanha o foco) e mantém o espaço; os botões ficam fixos embaixo.
- **Dica.** Dica só quando ajuda a preencher; nada de explicar o óbvio. Uma dica é uma restrição que o técnico precisa saber ("letras, números e hífen"), ou a descrição curta de uma opção que não se explica sozinha. Não explique o motivo de um desenho ("nunca as de hoje: o dia ainda não acabou", "sorteado entre 01h e 05h"), nem repita o rótulo. Ela fica apagada à direita do valor, curta (corta com `…` e some se não couber). Nada de `stdin`, `PVX_SECRET_*`, "prompt" ou "(segredo)".
- **Erro.** Vermelho, na linha abaixo do valor, começando com `✗`. `required` vazio mostra "preencha este campo"; `validate` põe o resto.
- **Segredo.** `secret` mostra `••••` (`g.mask`); `ctrl+r` mostra ou oculta; a tecla `generate` do campo gera e mostra.
- **Botões.** O primário vem cheio (fundo de acento): `[ criar e entrar ]` (`submitLabel`, padrão `salvar`); `[ cancelar ]` é sempre o segundo; `[ remover ]` é opcional (`onDelete`) e pergunta no diálogo da seção 18. O botão em foco ganha sublinhado e o `›` da linha. Todos clicáveis.
- **Comando.** O formulário de um comando não mostra a linha `$ pvx …` nem "segredo fora da linha". `ctrl+d` (e `?`, fora de campo de texto) mostra a linha, apagada, numa só linha.
- **Campo derivado.** `derive(values)` faz o campo seguir os outros enquanto o técnico não o editou. Editar para de seguir e guarda o texto; apagar até ficar vazio volta a seguir. A tela não diz nada sobre isso: o campo só mostra o valor, e ele continua editável. Exemplo: `Pasta no UOE` vira `clientes/<id-cliente>-<id-contrato>-<empresa>` conforme se digita.
- **Teclas.** `↑↓` e `Tab` andam entre campos e botões; `enter` avança e, no último campo, salva; `espaço` marca uma caixa ou uma opção; `ctrl+s` salva e `esc` cancela. Nas pontas de `choice` e `multi`, `↑↓` passam ao campo vizinho.
- **Erro e envio.** O primeiro campo com erro recebe o foco e bloqueia o envio. Na edição, o valor enviado é gravado como está: campo vazio limpa o valor.

Exemplos no código:

- `packages/tui/src/sdk-ui/fields.tsx` (o formulário), `packages/tui/src/sdk-ui/command-form.tsx` e `packages/tui/src/sdk-ui/labels.ts` (rótulos e dicas dos argumentos).
- `packages/tui/src/sdk-ui/derive.ts` (campo derivado).
- `packages/tui/src/menu/MenuForm.tsx` (o mesmo formulário na aba Módulos).

## 8. Retorno de ações

- Sucesso: volta para a lista com o item selecionado e mostra um aviso curto `✓` no rodapé (~4 s).
- Erro: abre uma tela de resultado com o detalhe (saída e causa), sem voltar sozinha.
- Nunca deixe o usuário sem retorno depois de uma ação: ou `✓`, ou a tela de erro.

Exemplos no código:

- `packages/tui/src/nudge.tsx` (aviso com tom `ok`, `warn` ou `error`, `TONED_MS`).
- `packages/tui/src/menu/Result.tsx`.
- `packages/tui/src/menu/Menu.tsx`.

## 9. Layout responsivo

- Grade de cartões: 3 colunas a partir de 120 colunas de terminal, 2 a partir de 80, 1 abaixo.
- Painéis lado a lado a partir de 100 colunas; abaixo disso, empilhados.
- Mínimo suportado: 80x24 (`MIN_COLS`, `MIN_ROWS`).
- Nada é cortado pela moldura: conteúdo largo termina em `…` (seção 4).
- Largura fixa pede `flexShrink={0}`; a linha principal de uma lista pede `minHeight={0}`.

Exemplos no código:

- `packages/tui/src/layout.ts` (`WIDE_COLS`, `useLayout`).
- `packages/tui/src/menu/cards.ts` (`gridCols`).
- `packages/tui/src/menu/CardGrid.tsx`.
- `packages/tui/src/tabs/HomeTab.tsx`.
- `packages/sdk/src/index.ts` (`useViewport`).

## 10. Segurança na UI

- A tela de revisão de confiança nunca mostra código-fonte: só arquivo, linha e contagens.
- Código só aparece no visualizador, que é uma tela à parte: `enter` no arquivo abre na linha apontada; `s` abre a lista de arquivos.
- Texto vindo de módulo ou nota passa por `stripAnsi` antes de ser desenhado.

Exemplos no código:

- `packages/tui/src/modules/Review.tsx` (revisão de confiança; `enter` abre o arquivo).
- `packages/core/src/ansi.ts` (`stripAnsi`).

## 11. Terminal

- Toda saída restaura o terminal: modo de teclado kitty, mouse, tela alternativa e cursor.
- Isso vale para saída limpa, `ctrl+c`, erro e `process.exit`.
- Não escreva sequências de escape por conta própria numa tela: o host cuida de entrada e saída.

Exemplos no código:

- `apps/pvx/src/terminal.ts` (`resetKeyboard`, `resetKeyboardOnExit`).
- `apps/pvx/src/tui.tsx`.

## 12. Componentes do framework

Regra: prefira um componente do framework a desenhar o seu. Um módulo que precisa de algo destes não redesenha: usa `sdk.ui`. Algo genérico que ainda não existe (serviria a outro módulo) entra no framework e aqui, não no módulo. Como usar cada um: `packages/sdk/README.md`, "Componentes de fluxo".

| Componente | Quando usar | Comportamento |
| --- | --- | --- |
| `Panel`, `Row`, `Text`, `Chip`, `Meter`, `KeyHint`, `Table`, `Spacer` | tela comum | tons do tema; `Panel` é uma seção (linha de cabeçalho, sem borda; seção 15), na raiz é só o contêiner da página |
| `List` | linhas navegáveis, com colunas | seção 4; seleção por id, hover, letreiro |
| `Fields`, `Form` | qualquer formulário | seção 7 (o formulário padrão) |
| `useConfirm` | confirmar algo | diálogo centralizado, seção 18 |
| `Conversation` | perguntas guiadas, uma por vez (instalador, assistente) | a respondida vira `✓ título   resumo`; a próxima aparece como `○ título`; `↑` no topo da pergunta sobe para as respondidas; `enter` ou clique reabre no lugar e volta ao ponto onde estava; depois da última vem a confirmação com todas as respostas (as puladas marcadas "(padrão)"), as notas "antes de instalar" e o botão principal; nada se aplica antes dele |
| `Button` | ação de uso único, ação principal de uma etapa | `[ rótulo ]` clicável; `primary` em acento e negrito; `keys` põe a tecla no rodapé e no `?`; precisa de `keys` ou `focused` (seção 17) |
| `Steps` | fases de uma tarefa longa | `✓` feito, spinner rodando, `○` pendente, `✗` falhou, com a palavra do estado e o tempo; com `useRun` o tempo da fase em curso avança sozinho, e a barra anda dentro de uma fase longa por `phase.progress`; mostre uma espera (`Loading`) enquanto `run.loading` |
| `RunPanel` | a tela de uma execução em fases (backup, instalação) | a barra e a palavra do estado, `Steps`, a falha (`Notice`, comando, código, saída, causa) com `[ continuar daqui ]`, os `children` do módulo e o log; `x` para, `c` copia o erro, `esc` sai; espera (`Loading`) até haver execução |
| `ProgressBar` | progresso global de uma tarefa | `━` na largura toda, `%` e tempos; falha pinta o ponto de parada de vermelho, colado ao preenchido |
| `CellGrid` | um quadrado por item (pacotes, hosts, arquivos) | `▪` feito/rodando/falhou em tons, `▫` pendente; quebra na largura, legenda com contagens; hover realça, clique ou `enter` age |
| `LogTail` | saída ao vivo | acompanha o fim; a roda do mouse sobe e solta; com `focused`, `↑↓`, `pgup`/`pgdn`, `home` e `end` rolam |
| `Notice` | aviso que fica na tela ("precisa aplicar") | bloco em linha `[✓]`/`[!]`/`[✗]` na cor do nível; só tokens do tema |
| `Loading`, `useAsync` | toda espera visível | spinner e texto |
| `useCopy` | "copiar" um comando ou texto | copia, mostra um painel com exatamente o que foi copiado (borda apagada) e `✓ copiado`; sem clipboard, diz a causa |

**Regra de espera.** Toda ação ou leitura que possa passar de ~300 ms mostra um estado de carregamento visível (spinner e texto, `Loading`); nunca uma tela congelada. Vale para catálogo, clone, revisão, verificação de conformidade, primeira carga de um `useQuery` e qualquer ação de um módulo. Texto estático como "carregando…" sem spinner não conta.

Exemplos no código:

- `packages/tui/src/sdk-ui/flow.tsx` (`Conversation`, `Button`, `ProgressBar`, `CellGrid`, `Loading`, `useAsync`).
- `packages/tui/src/sdk-ui/copy.tsx` (`useCopy`, painel de cópia).
- `packages/tui/src/sdk-ui/kit.tsx` (`Steps`, `LogTail`) e `packages/tui/src/sdk-ui/fields.tsx`.
- `packages/tui/src/sdk-ui/run-panel.tsx` e `packages/tui/src/sdk-ui/run.ts` (`RunPanel`, `failureViewOf`).

## 13. Precisa aplicar

Quando o estado salvo difere do que está aplicado (uma lista mudou, mas o firewall ainda tem a regra velha), o módulo avisa sempre do mesmo jeito. Nunca finja que já vale.

- **Na página:** um `Notice level="warn"` fixo, no topo, com o texto `precisa aplicar` e o motivo curto, e o botão principal (`Button primary`, rótulo `aplicar`) ao lado. Some quando o salvo e o aplicado voltam a ser iguais; o `Notice` não some por tempo.
- **No comando:** depois de gravar, uma linha `ctx.out.info` no formato "<o que mudou>, mas só vale depois de <comando de aplicar>" (o comando entre crases). O texto e o comando moram em `texts.ts` (`NEEDS_APPLY`, `FIX.apply`); o comando de correção é o mesmo da capacidade.
- **Na prova:** a capacidade devolve `warn` com `fix` apontando para o mesmo comando (`sdk.proof.warn("listas mudaram desde a última aplicação", { fix })`), então o Início e o plano também mostram a pendência.
- Um sucesso de gravação continua sendo `useNudge()(msg, "ok")`: o `✓` passa; o `precisa aplicar` fica.
- O aviso que passa tem três tons além do movimento inválido: `"ok"` (`✓`, destaque), `"warn"` (`▲`, aviso) e `"error"` (`✗`, erro). Todos ficam cerca de 4 s e tomam a linha do rodapé. Falha que o técnico precisa agir fica num `Notice`, não no aviso que passa.

```text
 [!] precisa aplicar: 2 regras mudaram desde a última aplicação     [ aplicar ]
```

Exemplos no código:

- `packages/sdk/README.md` (`Notice`, `List onAction`).
- `packages/tui/src/sdk-ui/kit.tsx` (`Notice`).

## 14. A aba já nomeia a página

A barra de abas diz onde o técnico está. A página não repete o nome numa moldura.

- Uma página mostrada como aba não desenha moldura nem título: o conteúdo começa logo abaixo da barra.
- Uma página empilhada (aberta por `#página`, `push` ou pela palette) não tem aba própria: mostra uma linha apagada de migalhas, sem caixa.
- Uma tela de várias etapas dentro da aba (formulário, resultado) usa a mesma linha de migalhas.

```text
  Início  Módulos  Issabel  Logs  Comando  Sistema          ← a aba já nomeia a página
 
  1 Rotinas                                                  ← conteúdo, sem moldura "Issabel"
  ...
```

```text
 Autobackup › nova rotina                                    ← página empilhada: uma linha, sem caixa
 ...
```

Exemplos no código: `packages/tui/src/sdk-ui/pages.tsx` (`PageContent`, `Breadcrumb`), `packages/tui/src/menu/Crumb.tsx`.

## 15. No máximo uma borda

Uma borda por cima de outra é proibida. Seção de página é cabeçalho e espaço, não caixa.

- Seção (`Panel`): linha de cabeçalho numerada (`1 Rotinas`) em acento e negrito quando ativa, apagada nas outras, com uma linha em branco acima. O indicador de ativa é a calha `▌` em acento ao lado do conteúdo; sem foco a calha fica em branco e o conteúdo não se move.
- `Panel` sem `title` nem `tone` é só um contêiner (a raiz da página).
- Formulário dentro de uma seção: sem caixa em volta (seção 7).
- Uma grade de cartões é permitida: cada cartão é um item da grade (a aba Módulos), com uma borda só, e nada o envolve. Caixa dentro de caixa não é.
- Diálogos e menus que flutuam (confirmação, menu de ações, palette) têm uma borda só, porque flutuam sobre a tela.
- Um campo `area` (texto de várias linhas) tem a própria borda: é o campo, não uma moldura.

```text
 Antes (3 níveis)                         Depois
 ╭ Autobackup ──────────────────╮
 │ ╭ rotinas ─────────────────╮ │         1 Rotinas
 │ │ ╭ tabela ───────────────╮│ │         ▌ NOME     AGENDA    ÚLTIMA
 │ │ │ ...                   ││ │         ▌ diaria   02:10     ok
 │ │ ╰───────────────────────╯│ │
 │ ╰──────────────────────────╯ │         2 Autenticação
 ╰──────────────────────────────╯           token válido
```

Exemplos no código: `packages/tui/src/sdk-ui/kit.tsx` (`Panel`, `headerParts`).

## 16. Formulário fala a língua do técnico

- Rótulo humano em pt-BR (`label` do argumento ou do campo). Sem `label`, o formulário mostra o nome humanizado (`id-cliente` vira "Id cliente"; escreva `label: "ID do cliente"` quando a capitalização importa).
- Dica só quando ajuda a preencher; nada de explicar o óbvio (detalhe na seção 7).
- A dica descreve o valor, não o CLI. O framework corta parênteses sobre `stdin`, `PVX_SECRET_*`, prompt e "(segredo)", mas o `help` do argumento já deve estar escrito para o técnico.
- Nunca mostre o nome cru do argumento (`admin-password`), a linha do comando nem a explicação de como o segredo chega ao comando.
- O título do formulário vem do título do comando (`title`), escrito uma vez.
- O botão primário diz o que acontece (`[ criar e entrar ]`), não `[ executar ]`, quando o módulo sabe.

## 17. Todo controle alcançável pelo teclado

Todo botão, ação ou linha clicável tem um caminho pelo teclado. "Só com o mouse" é defeito.

- Ação de página (`[ rodar agora ]`): é uma linha na seção a que pertence, alcançável por `↑↓` (a "linha de ações" no fim da lista, como `+ adicionar rotina…`), e/ou tem uma tecla (`keys`) que aparece no rodapé. Use as duas quando fizer sentido.
- `Button` precisa de `keys` (tecla no rodapé) ou de `focused` (a página navega até ele e o desenha em foco). Um botão sem nenhum dos dois só responde ao mouse e é erro.
- Botões de um formulário (`Fields`) andam por `Tab` e `↑↓` junto com os campos.
- Teste: `expectButtonsReachable()` (`@pvx/testing`) falha se um botão montado não tem teclado. Chame-o depois de montar a tela, em todo teste de página.

```text
 1 Rotinas
   NOME       AGENDA
 › diaria     02:10
   + adicionar rotina…
   ▶ rodar agora                  ← a ação é uma linha: ↑↓ chega nela, enter age
```

Exemplos no código: `packages/tui/src/sdk-ui/flow.tsx` (`Button`, `unreachableButtons`), `packages/testing/src/reachable.ts`.

## 18. Confirmação

Toda confirmação (comando destrutivo, `remover` de um formulário, uma ação do módulo) abre um diálogo centralizado, com a página ao fundo escurecida.

- Título em negrito numa linha só; descrição apagada, de uma ou mais linhas, opcional.
- Tudo centralizado dentro da caixa (título, linhas da descrição e a linha de botões), cada bloco separado do seguinte por uma linha `─` apagada.
- Sem linha de dicas de teclas dentro do diálogo: as teclas são óbvias.
- Dois botões, com rótulo próprio quando ajuda: `[ remover IP ]  [ manter ]`, `[ aplicar sem failsafe ]  [ voltar ]`. Padrão: `[ confirmar ]  [ cancelar ]`.
- Ação destrutiva: o botão de confirmar usa o token `error`.
- O foco começa na opção segura (a de cancelar). `←` `→` e `Tab` andam entre os botões, `enter` ativa, `esc` cancela, os dois botões são clicáveis.
- Uma borda só (o diálogo flutua). O fundo e o diálogo são irmãos, porque `opacity` vale para a subárvore.
- No módulo: `useConfirm()({ title, description?, confirmLabel?, cancelLabel?, destructive? })` devolve `Promise<boolean>`. A CLI mantém o prompt de texto.

```text
 ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
 ░░░░░░░░░░░░░╭────────────────────────────────────╮░░░░░░░░░░░░░░░░░░
 ░░░░░░░░░░░░░│        Remover o IP 10.0.0.1?      │░░░░░░░░░░░░░░░░░░
 ░░░░░░░░░░░░░│────────────────────────────────────│░░░░░░░░░░░░░░░░░░
 ░░░░░░░░░░░░░│   A regra deixa de valer agora.    │░░░░░░░░░░░░░░░░░░
 ░░░░░░░░░░░░░│────────────────────────────────────│░░░░░░░░░░░░░░░░░░
 ░░░░░░░░░░░░░│    [ remover IP ]  [ manter ]      │░░░░░░░░░░░░░░░░░░
 ░░░░░░░░░░░░░╰────────────────────────────────────╯░░░░░░░░░░░░░░░░░░
```

Exemplos no código: `packages/tui/src/session/ConfirmDialog.tsx`, `packages/tui/src/session/Modals.tsx`, `packages/sdk/src/index.ts` (`useConfirm`).

## Checklist antes de entregar uma tela

- [ ] Setas, `enter`, `esc` e `↑` para a barra seguem os quatro níveis de foco.
- [ ] Seleção ativa, inativa e hover são visualmente distintas; hover fora de lista ativa não muda a seleção.
- [ ] Tudo que parece clicável responde ao clique, e o hover dá retorno.
- [ ] A lista dá a volta nas pontas, alinha colunas e rola só a linha selecionada; a seleção é por id.
- [ ] O rodapé tem até ~5 atalhos; ações vivem num menu com `enter`; o resto está no `?`.
- [ ] Estado tem cor e palavra; vazio é `—`; só tokens do tema; sem texto explicativo fixo.
- [ ] Formulário segue a seção 7 (rótulos humanos, `*` vermelho, célula de valor, uma linha entre campos, erro `✗` sob o valor, primário cheio) e a confirmação de `remover` é o diálogo da seção 18.
- [ ] A aba já nomeia a página (sem moldura repetida), no máximo uma borda e todo controle alcançável pelo teclado (seções 14, 15 e 17).
- [ ] Sucesso volta para a lista com `✓`; erro mostra a tela de resultado.
- [ ] Se o salvo pode diferir do aplicado, a tela mostra `precisa aplicar` (seção 13).
- [ ] Usei um componente do framework onde ele existe (seção 12); nenhuma espera passa de ~300 ms sem `Loading`.
- [ ] Nada quebra em 80x24, 100 e 120 colunas (testes de frame).
- [ ] Teste de regressão escrito e entrada em `DECISIONS.md`.
