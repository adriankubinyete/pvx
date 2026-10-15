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

**Nenhuma página prende o teclado.** Seja o que a página desenhar (um `Fields` sempre montado, um `textarea`, uma lista), o host sempre consegue tirar o usuário dela com as suas teclas:

- `esc` sobe um nível por vez: de dentro de um campo para a página, da página para a barra. Três `esc` no máximo levam à barra.
- Com o foco na barra (ou numa aba montada atrás de outra), a página não recebe tecla nenhuma: `tab`, `shift+tab` e `←→` trocam de aba, mesmo com um formulário montado.
- Num formulário, `tab` anda entre os campos e botões; no último ponto `tab` e no primeiro `shift+tab` não dão a volta: vão para o host (a próxima ou a anterior aba). As setas dão a volta.
- Um formulário só pega o teclado enquanto o técnico está nele. Numa página com vários blocos, o formulário não nasce "ativo": o técnico entra (`enter` ou clique) e `esc` devolve à página (`Fields active`, `onCancel`).
- Teste: `expectNoKeyboardTrap(page)` (`@pvx/testing`; monte a página com `renderTab`) falha se até três `esc` não levam à barra de abas. Chame-o em todo teste de página que tenha formulário, `textarea` ou captura de teclas.

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
- **Sucesso/concluído = token de sucesso (`ok`), nunca o acento.** O verde do `[✓]`, do `✓` de `Steps` e listas, das células e da palavra "concluído" de `CellGrid`, de `Badge ok`, do `tone="ok"`, da barra concluída e do resultado de conformidade vem de `c.ok`. O acento é só de foco, seleção, teclas, botão principal e elemento ativo; "rodando" é o `info` (azul), que não se confunde nem com o sucesso nem com o acento. Assim, com acento azul, um item concluído não parece um em execução. Todo tema tem o token `ok` (verde no escuro e no claro; no Terminal, o verde da paleta ANSI).
- **Valor ao vivo tem largura fixa.** Número que se atualiza sozinho (rede, processos, carga, porcentagem, tempo decorrido, taxa, contador) ocupa sempre as mesmas células, para a tela não pular a cada leitura: alinhe à direita numa largura que cabe o maior valor. Use `fixedNumber`, `fixedRate`, `fixedPercent` e `fixedClock` (`packages/tui/src/fixed.ts`); o total que não muda dá a largura do que muda (`3.1/6.0G`, `38/54G`). Tempo final (`concluído em 5s`) não muda mais e fica sem preenchimento.
- Cada glifo novo ocupa uma célula: confira num teste de frame.
- Termos fixos, sem sinônimos (lista no `CLAUDE.md`).

Exemplos no código:

- `packages/tui/src/theme.ts` (tokens: `accent`, `ok`, `warn`, `error`, `info`, `thirdParty`, `dim`).
- `packages/tui/src/fixed.ts` (`fixedNumber`, `fixedRate`, `fixedPercent`) e `packages/tui/src/sdk-ui/kit.tsx` (`fixedClock`).
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

   [ criar e entrar ]  [ cancelar ]                        ← em foco: só um botão cheio (aqui o primário)

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
- **Colar funciona em todo campo.** O terminal manda o colado como um evento só (paste com colchetes), e o `KeyRouter` o entrega só a quem tem campo de texto (`useKeys(…, { paste: true })`). O campo em foco é dono do colado: `editLine` o insere no cursor, como digitado, e o campo rola na horizontal. Campo de uma linha: o colado perde escapes ANSI, caracteres de controle e quebras de linha (`\r`, `\n`, as de dentro também: o texto é juntado, não recusado), então uma senha colada com `\n` no fim fica inteira. Segredo continua mascarado (`•` por caractere) e o colado não vai a nenhum outro lugar (log, scrollback, histórico, aviso). Sem campo em foco (barra de abas, botão, caixa de marcar, lista) o colado não faz nada e nunca vira atalho. Vale para `Fields`/`Form`, respostas da conversa e do modal de segredo, a linha do Comando, a busca e os campos da palette, o `AddBox` e o editor de tema; a `area` (várias linhas) usa o colado do próprio `textarea`. Um campo novo usa `editLine` e registra `paste: true`.
- **Botões.** Todos `[ rótulo ]`, na regra da seção 12: só o botão em foco vem cheio (acento; `error` no perigoso) e sublinhado. O primário (`submitLabel`, padrão `salvar`) sem foco é `[ salvar ]` em negrito no acento; `[ cancelar ]` é sempre o segundo; `[ remover ]` é opcional (`onDelete`), no tom `error`, e pergunta no diálogo da seção 18. Uma linha em branco separa o conteúdo dos botões. Todos clicáveis.
- **Comando.** O formulário de um comando não mostra a linha `$ pvx …` nem "segredo fora da linha". `ctrl+d` (e `?`, fora de campo de texto) mostra a linha, apagada, numa só linha.
- **Campo derivado.** `derive(values)` faz o campo seguir os outros enquanto o técnico não o editou. Editar para de seguir e guarda o texto; apagar até ficar vazio volta a seguir. A tela não diz nada sobre isso: o campo só mostra o valor, e ele continua editável. Exemplo: `Pasta no UOE` vira `clientes/<id-cliente>-<id-contrato>-<empresa>` conforme se digita.
- **Teclas.** `↑↓` e `Tab` andam entre campos e botões (as setas dão a volta; `tab` no último ponto e `shift+tab` no primeiro vão para o host, seção 1); `enter` avança e, no último campo, salva; `espaço` marca uma caixa ou uma opção; `ctrl+s` salva e `esc` sai do campo: o módulo ouve `onCancel` e o formulário devolve o teclado à página (o segundo `esc` chega à barra; `enter` volta para dentro). Nas pontas de `choice` e `multi` em lista, `↑↓` passam ao campo vizinho; em `radio`, `buttons` e `row` (seção 19), `←→` movem a escolha e `↑↓` vão ao campo vizinho.
- **Erro do módulo.** `FieldSpec.error` mostra uma mensagem sob o campo agora (um valor que só o módulo sabe recusar); ela some quando o campo é editado. `initialFocus` abre o formulário com o foco num campo.
- **Erro e envio.** O primeiro campo com erro recebe o foco e bloqueia o envio. Na edição, o valor enviado é gravado como está: campo vazio limpa o valor.
- **Ocupado.** `onSubmit` (e `onConfirm` da conversa) que devolve uma promessa deixa o formulário ocupado até ela terminar: campos e botões apagados, sem foco, sem edição, sem clique; o botão primário troca o rótulo por spinner e progresso (`[ ⠹ entrando… ]`; padrão `executando…`, `busyLabel` muda); um segundo envio é impossível. Só `esc` funciona: sai da página e avisa "continua rodando em segundo plano"; o comando não é cancelado. Ao terminar, o formulário volta com os valores e o foco no primeiro campo com erro, senão no botão primário. O `Form` de comando já faz isso; `expectNoKeyboardTrap` vale também ocupado. A palette ocupada (fila em execução) segue a mesma regra: spinner e `esc` fecha.

Exemplos no código:

- `packages/tui/src/sdk-ui/fields.tsx` (o formulário), `packages/tui/src/sdk-ui/command-form.tsx` e `packages/tui/src/sdk-ui/labels.ts` (rótulos e dicas dos argumentos).
- `packages/tui/src/sdk-ui/derive.ts` (campo derivado).
- `packages/tui/src/menu/MenuForm.tsx` (o mesmo formulário na aba Módulos).

## 8. Retorno de ações

- Sucesso: volta para a lista com o item selecionado e mostra um aviso curto `✓` no rodapé (~4 s).
- Erro: abre uma tela de resultado com o detalhe (saída e causa), sem voltar sozinha. Use `sdk.ui.CommandResult` (seção 12): título `Erro` ou `Concluído`, nunca `erro (saiu 1)`.
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
| `CommandResult` | o resultado de um comando que a página rodou | seção `Erro` ou `Concluído` (sem o código de saída no título), as linhas, os detalhes apagados (comando e fim da saída de um `StepError`; `código de saída N` só quando não é 0 nem 1), UMA linha em branco e `[ fechar ]` mais as ações da página; `esc` e `enter` fecham |
| `useConfirm` | confirmar algo | diálogo centralizado, seção 18 |
| `Conversation` | perguntas guiadas, uma por vez (instalador, assistente) | a respondida vira `✓ título   resumo`; a próxima aparece como `○ título`; `↑` no topo da pergunta sobe para as respondidas; `enter` ou clique reabre no lugar e volta ao ponto onde estava; depois da última vem a confirmação com todas as respostas (as puladas marcadas "(padrão)"), as notas "antes de instalar" e o botão principal; nada se aplica antes dele |
| `Button` | ação de uso único, ação principal de uma etapa | `[ rótulo ]` clicável na cor de destaque, cheio só com o mouse por cima ou em foco; `primary` é negrito; `danger` usa o tom `error`; `disabled="motivo"` apaga e mostra o motivo embaixo; `keys` põe a tecla no rodapé e no `?`; precisa de `keys` ou `focused` (seção 17) |
| `Steps` | fases de uma tarefa longa | `✓` feito, spinner rodando, `○` pendente, `✗` falhou, com a palavra do estado e o tempo; com `useRun` o tempo da fase em curso avança sozinho, e a barra anda dentro de uma fase longa por `phase.progress`; mostre uma espera (`Loading`) enquanto `run.loading` |
| `RunPanel` | a tela de uma execução em fases (backup, instalação) | a barra e a palavra do estado, `Steps`, a falha (`Notice`, comando, código, saída, causa) com `[ continuar daqui ]`, os `children` do módulo e o log; `x` para, `c` copia o erro, `esc` sai; espera (`Loading`) até haver execução |
| `ProgressBar` | progresso global de uma tarefa | `█` e `░` na largura toda, `%` e tempos; falha pinta o ponto de parada de vermelho, colado ao preenchido |
| `CellGrid` | um quadrado por item (pacotes, hosts, arquivos) | `■` feito/rodando/falhou em tons, pendente na cor fraca da borda; quebra na largura, legenda com contagens; hover realça, clique ou `enter` age |
| `LogTail` | saída ao vivo | acompanha o fim; a roda do mouse sobe e solta; com `focused`, `↑↓`, `pgup`/`pgdn`, `home` e `end` rolam |
| `Notice` | aviso que fica na tela ("precisa aplicar") | bloco em linha `[✓]`/`[!]`/`[✗]`/`[i]` na cor do nível (`[i]` é azul); `action` põe um botão no fim da linha; só tokens do tema |
| `Card`, `CardGrid` | blocos que representam coisas (módulos, hosts, serviços) | seção 20 |
| `ConfirmPreview` | mostrar numa folha ou ajuda como é a pergunta | o diálogo da seção 18 desenhado no lugar, sem fundo escurecido nem teclas |
| `Badge`, `Details`, `Meter`, `Spark`, `CopyBlock`, `Scroll`, `Chip state`, `Row fit` | leitura de estado e valores | seção 19 |
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

A barra de abas tem, à direita, o relógio e a versão, separados da última aba por um `│` apagado, e uma linha `─` fina embaixo a separa da página. A marca de um binário dev é curta (`pvx 0.1.2 dev +3`, o `+N` conta os módulos embutidos; a lista inteira está na aba Sistema). Nada se sobrepõe: com pouca largura o relógio perde primeiro a data, depois os segundos e por fim a hora.

```text
 Início  Módulos  Issabel  Logs  Comando  Sistema     │ qui 15/10 13:39:04 · pvx 0.1.2 dev +3
 ─────────────────────────────────────────────────────────────────────────────────────────────
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
- O botão primário diz o que acontece (` criar e entrar `), não `[ executar ]`, quando o módulo sabe.

## 17. Todo controle alcançável pelo teclado

Todo botão, ação ou linha clicável tem um caminho pelo teclado. "Só com o mouse" é defeito.

- Ação de página (`[ rodar agora ]`): é uma linha na seção a que pertence, alcançável por `↑↓` (a "linha de ações" no fim da lista, como `+ adicionar rotina…`), e/ou tem uma tecla (`keys`) que aparece no rodapé. Use as duas quando fizer sentido.
- `Button` precisa de `keys` (tecla no rodapé) ou de `focused` (a página navega até ele e o desenha em foco). Um botão sem nenhum dos dois só responde ao mouse e é erro.
- Botões de um formulário (`Fields`) andam por `Tab` e `↑↓` junto com os campos.
- `Button help` (com `keys`) põe a tecla no `?` e não no rodapé: uma página com muitos botões mantém o rodapé em ~5 atalhos.
- Teste: `expectButtonsReachable()` (`@pvx/testing`) falha se um botão montado não tem teclado. Chame-o depois de montar a tela, em todo teste de página. `expectNoKeyboardTrap(page)` falha se a página prende o teclado (seção 1).

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
- `ConfirmPreview` desenha o mesmo diálogo no lugar, em modo "prévia": só a caixa, sem fundo escurecido, sem tecla e sem resposta. É para folha de referência e ajuda; o diálogo de verdade continua sendo `useConfirm`, aberto por um botão com tecla.
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

## 19. Primitivos de leitura

Peças do framework para mostrar estado e valores. O módulo as usa pelo `sdk.ui` (`packages/sdk/README.md`, "Primitivos de apresentação") e nunca desenha o seu. Cores só por tokens; todas cabem em 80x24.

**Avisos em quatro tons**, com botão opcional no fim da linha (o botão segue a regra da seção 17):

```text
 [✓] lorem ipsum dolor sit amet aplicado                      ← ok: destaque (verde)
 [!] lorem ipsum dolor: sit amet                [ resolver ]  ← aviso, com botão
 [✗] lorem ipsum falhou: dolor sit amet                       ← erro
 [i] lorem ipsum dolor sit amet, consectetur                  ← informação: azul (token `info`)
```

**Botões: só o foco enche.** Um botão é sempre `[ rótulo ]` (a largura não muda entre estados). Só o botão em foco (ou com o mouse por cima) vem cheio: fundo de acento, ou `error` no perigoso, e sublinhado. Sem foco: o primário é `[ rótulo ]` em negrito no acento; o secundário, `[ rótulo ]` no acento; o perigoso, `[ rótulo ]` no tom `error`; o desligado, apagado, com o motivo embaixo. Exatamente um botão parece em foco de cada vez: o primário nunca vem cheio por ser primário.

**Uma linha em branco entre o conteúdo e os botões.** Numa seção (formulário, resultado, painel de execução, confirmação de página), os botões de ação não colam no conteúdo: uma linha em branco os separa. Vale para `Fields`, `Form`, `CommandResult` e `RunPanel`; o `ConfirmDialog` já separa o texto dos botões por uma régua.

```text
  [ principal ]   [ secundário ]   [ perigoso ]   [ em foco ]   [ desligado ]
  negrito, acento  acento           tom error      cheio         apagado
                                                                 falta o token
```

**Selos.** Um chip cheio, texto em negrito e maiúsculo, nos tons `ok`, `warn`, `error` e `info`:

```text
  ATIVO   DESATUALIZADO   PARADO   NOVO
```

**Detalhes.** Rótulo apagado e alinhado, valor no seu tom, até duas colunas (uma abaixo de 100 colunas):

```text
  motor         nftables (automático)    regras   39 de 40 carregadas
  último apply  ontem 03:31              IP       10.0.0.1
```

**Medidores.** A série no tempo em blocos e a barra fina de uso, que vira cor de aviso acima de 80%:

```text
  cpu      ▁▁▃▂▁▁▂▃▅▃▂▁▂▁  12%
  disco    ━━━━━━━━────────────   41%  18 de 44 GB
  memória  ━━━━━━━━━━━━━━━━━───   86%
```

**Escolha única, várias e caixa** num formulário (seção 7): rádio e fileira de botões para uma opção, fileira de caixas para várias. `←` `→` movem a escolha, o mouse escolhe:

```text
    Opção     ( ) 16   (•) 18   ( ) 20
    Modo       16   18   20
    Extras    [x] 16   [ ] 18   [ ] 20
    Ativo     [x] lorem ipsum dolor
```

**Bloco para copiar.** Linhas de rótulo e valor num fundo discreto (sem borda), e o botão que as copia como texto alinhado (`useCopy`):

```text
   acesso web   https://10.0.0.1
   senha web    xxxx-xxxx-xxxx

   copiar acesso
```

**Listas.** O marcador da linha selecionada (`»`), o `›` apagado do mouse por cima e o vazio das outras linhas ocupam as mesmas 2 colunas, então as colunas nunca andam. A linha sob o mouse tem um fundo sutil (`panel`):

```text
    nome      estado
    ● alfa    ok
  » beta      ok          ← selecionada: » em destaque, fundo `selected`
    ★ gama    ok          ← mouse por cima: só o fundo
```

**Chips de filtro.** O escolhido cheio no destaque, os outros no fundo `panel`; o módulo guarda o filtro:

```text
   todos   lorem   ipsum   dolor      ● ao vivo   / buscar
```

**Scrollback do Comando.** A hora vem na linha do comando e as linhas de resultado têm um recuo fixo e pequeno, sem se alinhar à coluna da hora:

```text
  13:31:02  ❯ firewall apply                                              ✓ 41ms
      [✓] regras aplicadas: 40 · failsafe 203.0.113.5
      [i] confirme o acesso em 60 s: firewall confirm
```

**Página mais alta que a tela.** `Scroll` rola com `↑` `↓`, `pgup` `pgdn`, `home`, `end` e a roda do mouse.

**Fora do SDK.** A grade de cartões é a da aba Módulos (`packages/tui/src/menu/CardGrid.tsx`), presa ao cartão de módulo; não é um primitivo do SDK.

Exemplos no código: `packages/tui/src/sdk-ui/display.tsx` (`Badge`, `Details`, `Meter`, `Spark`), `packages/tui/src/sdk-ui/button.tsx` (`Button`, `buttonLook`), `packages/tui/src/sdk-ui/copy.tsx` (`CopyBlock`), `packages/tui/src/sdk-ui/kit.tsx` (`Notice`, `Chip`, `Row`, `Scroll`, `List`), `packages/tui/src/sdk-ui/fields.tsx` (`radio`, `buttons`, `row`), `packages/tui/src/session/Blocks.tsx` (o scrollback).

## 20. Cards

`Card` e `CardGrid` (`sdk.ui`) são o bloco que representa uma coisa: um módulo, um host, um serviço. A aba Módulos usa a mesma peça.

```text
╭────────────────────────────────────╮ ╭────────────────────────────────────╮ ╭╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╮
│  lorem-ipsum           ● carregado │ │  dolor-sit            ● aguardando │ ╎                                    ╎
│ 2 comandos · aba Lorem             │ │ 1 comando                          │ ╎         a  adicionar ipsum         ╎
│                                    │ │                                    │ ╎       lorem ipsum dolor sit        ╎
│  ⚠ só linux                  0.1.0 │ │ aba oculta                   1.0.0 │ ╎                                    ╎
╰────────────────────────────────────╯ ╰────────────────────────────────────╯ ╰╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╯
   selecionado (borda de destaque)         normal (borda apagada)               ação (tracejado, com tecla)
```

- **Quatro linhas.** O nome em negrito com o estado à direita (ponto e palavra, no tom: `ok` e `dim` deixam a palavra apagada, os outros a colorem); uma segunda linha apagada; uma linha em branco; e embaixo os chips à esquerda (cheios quando pedem atenção; os que não cabem somem) e a versão ou nota à direita.
- **Três aparências.** Selecionado: borda de destaque. Normal: borda fraca. Ação: borda tracejada, a tecla em negrito e o rótulo centralizados, com a linha `sub` apagada embaixo; não tem estado, linha nem chips. Com a grade sem foco o selecionado guarda a borda apagada e um `›` (seleção inativa, seção 2).
- **Grade.** 3 colunas a partir de 120 colunas do terminal, 2 a partir de 80, senão 1. `CardGrid` rola até o selecionado. A seleção é por `id`.
- **Teclado e mouse.** Com `focused`, as setas movem a seleção (`↑` na primeira linha chama `onTop`), `enter` e o clique chamam `onActivate`; sem `focused` a grade não pega tecla. O hover move a seleção só com a grade focada.
- **Em página de módulo.** Uma folha que mostra estados desenha `Card state="selected" | "inactive" | "normal"`; uma página que navega entre cards usa `CardGrid` e a regra da seção 17 (o foco entra por `enter` ou clique).

Exemplos no código: `packages/tui/src/sdk-ui/card.tsx` (`CardFace`, `CardGrid`, `Card`), `packages/tui/src/sdk-ui/card-layout.ts` (`gridCols`, `cardWidth`), `packages/tui/src/menu/CardGrid.tsx` (os módulos da aba Módulos), `pvx-kitdemo` (a folha).

## Checklist antes de entregar uma tela

- [ ] Setas, `enter`, `esc` e `↑` para a barra seguem os quatro níveis de foco, e a página não prende o teclado (`expectNoKeyboardTrap`).
- [ ] Sucesso e concluído usam o token `ok`, nunca o acento; número ao vivo tem largura fixa (seção 6).
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
