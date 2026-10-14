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
- Ação da linha: `List onAction`. `enter` na linha selecionada (o rodapé mostra `enter abrir`) e o clique abrem o formulário da linha (`Fields` com os campos e `onDelete`); o `remover` pede a confirmação do framework. Não ponha atalhos soltos (`x`, `c`) para remover ou copiar. Com `actionOnClick={false}` o clique só seleciona (como na seção 3) e abrem `enter` ou um segundo clique na linha selecionada; use quando abrir a ação num clique solto seria agressivo.

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

Use `ui.Fields` (`packages/sdk/src/index.ts`).

- `salvar` e `cancelar` estão sempre presentes.
- `remover` é opcional (`onDelete`) e pede confirmação antes de agir.
- `↑↓` e `Tab` andam entre campos e botões; `enter` avança e, no último campo, salva.
- `espaço` marca uma caixa (`toggle`) ou uma opção (`multi`) e escolhe uma opção (`choice`); `↑↓` andam pelas opções e, nas pontas, passam ao campo vizinho.
- `secret` mostra `●` no lugar do texto; a tecla `generate` do campo vai para o rodapé e o `?`.
- Erro inline sob o campo, via `validate` (o primeiro campo com erro recebe o foco e bloqueia o envio).
- Na edição, o valor enviado é gravado como está: campo vazio limpa o valor.
- `ctrl+s` salva e `esc` cancela.

```text
 nome     [ ssh              ]
 origem   [ 10.0.0            ]
          ✗ IP inválido
 ativa    [x]
 [ salvar ] [ cancelar ] [ remover ]
```

Exemplos no código:

- `packages/tui/src/sdk-ui/fields.tsx`.
- `packages/tui/src/menu/MenuForm.tsx`.
- `packages/tui/src/menu/AddBox.tsx`.

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
| `Panel`, `Row`, `Text`, `Chip`, `Meter`, `KeyHint`, `Table`, `Spacer` | tela comum | tons do tema; `Panel` na raiz da página é a moldura da página |
| `List` | linhas navegáveis, com colunas | seção 4; seleção por id, hover, letreiro |
| `Fields` | qualquer formulário | seção 7 |
| `Conversation` | perguntas guiadas, uma por vez (instalador, assistente) | a respondida vira `✓ título   resumo`; a próxima aparece como `○ título`; `↑` no topo da pergunta sobe para as respondidas; `enter` ou clique reabre no lugar e volta ao ponto onde estava; depois da última vem a confirmação com todas as respostas (as puladas marcadas "(padrão)"), as notas "antes de instalar" e o botão principal; nada se aplica antes dele |
| `Button` | ação de uso único, ação principal de uma etapa | `[ rótulo ]` clicável; `primary` em acento e negrito; `keys` põe a tecla no rodapé e no `?` |
| `Steps` | fases de uma tarefa longa | `✓` feito, spinner rodando, `○` pendente, `✗` falhou, com a palavra do estado e o tempo |
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

## Checklist antes de entregar uma tela

- [ ] Setas, `enter`, `esc` e `↑` para a barra seguem os quatro níveis de foco.
- [ ] Seleção ativa, inativa e hover são visualmente distintas; hover fora de lista ativa não muda a seleção.
- [ ] Tudo que parece clicável responde ao clique, e o hover dá retorno.
- [ ] A lista dá a volta nas pontas, alinha colunas e rola só a linha selecionada; a seleção é por id.
- [ ] O rodapé tem até ~5 atalhos; ações vivem num menu com `enter`; o resto está no `?`.
- [ ] Estado tem cor e palavra; vazio é `—`; só tokens do tema; sem texto explicativo fixo.
- [ ] Formulário tem `salvar` e `cancelar`, erro inline e confirmação em `remover`.
- [ ] Sucesso volta para a lista com `✓`; erro mostra a tela de resultado.
- [ ] Se o salvo pode diferir do aplicado, a tela mostra `precisa aplicar` (seção 13).
- [ ] Usei um componente do framework onde ele existe (seção 12); nenhuma espera passa de ~300 ms sem `Loading`.
- [ ] Nada quebra em 80x24, 100 e 120 colunas (testes de frame).
- [ ] Teste de regressão escrito e entrada em `DECISIONS.md`.
