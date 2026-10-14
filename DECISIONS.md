# Decisões

Registro de decisões de projeto do pvx, em ordem cronológica. Nada é apagado: quando uma decisão deixa de valer, a entrada antiga ganha uma linha **Status** que aponta para a que a substitui.

Formato de cada entrada:

- `## AAAA-MM-DD — título`
- **Status:** `vigente`, `substituída por …`, `substituída em parte por …` ou `resolvida`.
- **Decisão:** uma frase, seguida dos detalhes em lista.
- **Motivo:** por que foi decidido.
- **Limite:** o que a decisão não cobre (quando houver).

A seção "Vigentes" resume o que vale hoje e aponta para a entrada de cada decisão. Quando duas entradas tratam do mesmo assunto, vale a mais recente.

## Vigentes

Uma linha por decisão em vigor. "(em parte)" marca entradas cujo **Status** diz que só parte delas foi substituída: vale o que a entrada ainda afirma, e o Status aponta o que mudou.

### Segurança e confiança

- Todo módulo git só é importado com o commit aprovado, `HEAD` igual ao aprovado e árvore limpa; cadeia de verificação e recarga limpando o `require.cache` → [Confiança e recarga de módulos](#2026-10-09--confiança-e-recarga-de-módulos), [Módulos git e confiança por commit (Fase 4A)](#2026-10-09--módulos-git-e-confiança-por-commit-fase-4a) (em parte)
- Nenhuma variável de ambiente desliga a confiança; dev só por `modules link`; `update` só avança com o sha aprovado (exceção: confiar sempre); permissões declarativas (não são sandbox) → [Fase 4B: sem desvio de confiança, update, link, permissões, cache de avisos](#2026-10-09--fase-4b-sem-desvio-de-confiança-update-link-permissões-cache-de-avisos) (em parte)
- Confiar sempre (mesma origem, fast-forward, árvore limpa, manifest legível, auditado, revogável) e catálogo confiado sempre → [Confiança sempre e módulos do catálogo confiados sempre](#2026-10-13--confiança-sempre-e-módulos-do-catálogo-confiados-sempre)
- Tela de revisão de confiança sem código na tela principal, com análise por arquivo e por linha → [Revisão de confiança redesenhada](#2026-10-13--revisão-de-confiança-redesenhada)
- Módulo declara `os` e `distro`; instalar em outro sistema exige consentimento (`--any-os`) → [Módulos declaram os sistemas que suportam: `os`, `distro` e `--any-os`](#2026-10-13--módulos-declaram-os-sistemas-que-suportam-os-distro-e---any-os)
- Comandos de módulo e escrita exigem root (uid 0), sem bypass; Windows conta como root → [Root estrito](#2026-10-09--root-estrito) (em parte), [Windows conta como root](#2026-10-13--windows-conta-como-root)
- Auditoria de comandos destrutivos e logins; notas só de acréscimo → [Fase 6: questões em aberto 2 e 5 (recomendação adotada)](#2026-10-09--fase-6-questões-em-aberto-2-e-5-recomendação-adotada)
- Audit log, deriva de conformidade, ignorar por 24 h e marcador de visto → [Fase 6B: audit log, deriva, ignorar e diário](#2026-10-09--fase-6b-audit-log-deriva-ignorar-e-diário) (em parte)
- O host nunca cita um módulo pelo nome; papéis no lugar → [Fase 6C: banner de login, gancho `motd` e papéis (o host não cita módulo)](#2026-10-09--fase-6c-banner-de-login-gancho-motd-e-papéis-o-host-não-cita-módulo)
- `!cmd` roda no shell do host como o usuário atual, sem root, auditado quando possível → [`!cmd`: shell do host, sem root](#2026-10-13--cmd-shell-do-host-sem-root)
- Sondas, consultas e widgets recebem um contexto somente leitura com `exec` → [Sondas com `exec` somente leitura](#2026-10-13--sondas-com-exec-somente-leitura)
- Estado do módulo (`state.json`) gravado com 0600 em pasta 0700, por arquivo temporário e `rename` → [Estado do módulo com permissão 0600](#2026-10-14--estado-do-módulo-com-permissão-0600)

### Distribuição e execução

- O núcleo é reconstruído da spec, sem protótipo → [Protótipo ausente: núcleo reconstruído a partir da spec](#2026-10-09--protótipo-ausente-núcleo-reconstruído-a-partir-da-spec)
- Binário compilado; módulos externos só com imports relativos e `import type` → [Distribuição: binário compilado (provisório)](#2026-10-09--distribuição-binário-compilado-provisório)
- Stack OpenTUI + React + Bun confirmada em CentOS 7 e Rocky 8 → [Spike 1 (runtime): CentOS 7 OK — stack confirmada](#2026-10-09--spike-1-runtime-centos-7-ok--stack-confirmada), [Spike 1 (runtime): Rocky 8 OK](#2026-10-09--spike-1-runtime-rocky-8-ok)
- Perfis em `profiles/*.json`, embutidos no binário no build (só os rastreados pelo git) → [Perfis: pasta resolvida pelo código-fonte](#2026-10-09--perfis-pasta-resolvida-pelo-código-fonte), [Fase 8: distribuição e atualização](#2026-10-13--fase-8-distribuição-e-atualização)
- Versão única, instalação com checksum, `self-update` atômico, `uninstall` que protege notas e módulos → [Fase 8: distribuição e atualização](#2026-10-13--fase-8-distribuição-e-atualização)
- A Fase 7 não porta módulos Python; o binário continua `pvx` → [Sem porte automático e sem renomear](#2026-10-09--sem-porte-automático-e-sem-renomear)
- `bun dev` roda com `PVX_HOME=.dev/pvx` → [`bun dev` com `PVX_HOME` em `.dev/pvx`](#2026-10-13--bun-dev-com-pvx_home-em-devpvx)

### CLI

- Runner puro: devolve o exit code, só `apps/pvx` chama `process.exit` → [Detalhes do runner da CLI](#2026-10-09--detalhes-do-runner-da-cli)
- Grupo `modules` sempre no plural → [Grupo de comandos `modules` (plural), nunca `module`](#2026-10-09--grupo-de-comandos-modules-plural-nunca-module)
- `help` e alias `h` → [Comando `help` e alias `h`](#2026-10-13--comando-help-e-alias-h)
- `--json`, `--yes` e `--help` em qualquer posição → [Flags globais em qualquer posição](#2026-10-13--flags-globais-em-qualquer-posição)
- Catálogo: JSON do endpoint da Phonevox, cache de 6 h, cópia embutida, `modules search` → [Catálogo: núcleo e `pvx modules search` (Fase 4)](#2026-10-09--catálogo-núcleo-e-pvx-modules-search-fase-4), [Catálogo de módulos (questão em aberto 6)](#2026-10-09--catálogo-de-módulos-questão-em-aberto-6) (em parte)
- Banner de login por `pvx banner` e gancho do módulo `motd` → [Fase 6C: banner de login, gancho `motd` e papéis (o host não cita módulo)](#2026-10-09--fase-6c-banner-de-login-gancho-motd-e-papéis-o-host-não-cita-módulo)

### TUI

- Linha de resultado `[✓] texto`, `[!]`, `[✗]`, `[i]` → [Formato padrão da linha de resultado](#2026-10-09--formato-padrão-da-linha-de-resultado)
- Glifo de módulo em desenvolvimento `↯` → [Glifo "em desenvolvimento": `↯` no lugar de `⚡`](#2026-10-09--glifo-em-desenvolvimento--no-lugar-de-)
- Roteador mantém só a tela do topo montada → [Roteador mantém só a tela do topo montada](#2026-10-09--roteador-mantém-só-a-tela-do-topo-montada)
- Palette: espaço, `ctrl+n`, `ctrl+j`; modais e rodapé próprios; núcleo, módulos e páginas na mesma lista → [Palette: espaço digita na busca; `ctrl+n` enfileira; `ctrl+j` roda a fila](#2026-10-09--palette-espaço-digita-na-busca-ctrln-enfileira-ctrlj-roda-a-fila), [Palette renderiza os próprios modais; rodapé segue o overlay](#2026-10-09--palette-renderiza-os-próprios-modais-rodapé-segue-o-overlay) (em parte), [Palette: núcleo, comandos de módulo e páginas na mesma lista](#2026-10-09--palette-núcleo-comandos-de-módulo-e-páginas-na-mesma-lista)
- Menu em lista gerado do registry, hoje a aba Módulos; estado fora do componente; segredo só em memória → [Tela inicial por menus (muda o "command-first")](#2026-10-09--tela-inicial-por-menus-muda-o-command-first) (em parte), [Menu inicial: estado, núcleo no TUI, root e segredo no repeat](#2026-10-09--menu-inicial-estado-núcleo-no-tui-root-e-segredo-no-repeat)
- Barra de abas no topo; ordem Início · Módulos · abas de módulo · Logs · Comando · Sistema → [Abas no topo no lugar dos chips](#2026-10-09--abas-no-topo-no-lugar-dos-chips) (em parte), [Aviso de movimento inválido, painéis numerados, `/` da barra e ordem das abas](#2026-10-09--aviso-de-movimento-inválido-painéis-numerados--da-barra-e-ordem-das-abas), [Ajustes: temas e editor de tema](#2026-10-13--ajustes-temas-e-editor-de-tema) (em parte), [Ajustes vira Sistema](#2026-10-14--ajustes-vira-sistema)
- Rascunho do Comando, foco e destaque só onde há foco → [Abas do núcleo sob demanda, rascunho do Comando, foco e destaque só onde há foco](#2026-10-09--abas-do-núcleo-sob-demanda-rascunho-do-comando-foco-e-destaque-só-onde-há-foco) (em parte)
- Ações de bloco por foco espacial (`r`, `l`, `c`), `esc` sobe um nível → [Ações de bloco sem combo: foco espacial no Comando](#2026-10-09--ações-de-bloco-sem-combo-foco-espacial-no-comando), [`esc` sobe um nível no Comando: bloco focado vai para a barra](#2026-10-09--esc-sobe-um-nível-no-comando-bloco-focado-vai-para-a-barra)
- Campos de texto com cursor → [Campos de texto têm cursor (substitui "os campos não têm cursor")](#2026-10-09--campos-de-texto-têm-cursor-substitui-os-campos-não-têm-cursor)
- Ajuda `?` contextual → [A ajuda `?` é contextual](#2026-10-09--a-ajuda--é-contextual)
- Início em grade com versão fixa na barra; painéis de conformidade e atividade; painel máquina estilo btop → [Início em grade, versão fixa na barra, sem cabeçalho](#2026-10-09--início-em-grade-versão-fixa-na-barra-sem-cabeçalho), [Início vira painel de informação; o menu de módulos vai para Módulos](#2026-10-09--início-vira-painel-de-informação-o-menu-de-módulos-vai-para-módulos) (em parte), [Painel máquina estilo btop](#2026-10-13--painel-máquina-estilo-btop)
- Navegação espacial entre painéis, rolagem ao fim, hover que move a seleção → [Navegação espacial entre painéis, rolagem ao fim e hover](#2026-10-13--navegação-espacial-entre-painéis-rolagem-ao-fim-e-hover)
- Spinner único de 100 ms e regras de teste do `renderTui` → [Spinner, chips e testes](#2026-10-09--spinner-chips-e-testes) (em parte)
- Plano como painel da página Conformidade, sem Diário, built-ins sem aba, relógio na barra → [Plano dentro de Conformidade, sem Diário, built-ins sem aba, relógio na barra (substitui partes de 3D, 6B e 6C)](#2026-10-09--plano-dentro-de-conformidade-sem-diário-built-ins-sem-aba-relógio-na-barra-substitui-partes-de-3d-6b-e-6c)
- Temas Escuro, Claro, Alto contraste, Terminal e Personalizado, acento padrão `tema` → [Ajustes: temas e editor de tema](#2026-10-13--ajustes-temas-e-editor-de-tema) (em parte)
- Aba Sistema, a última: seção Aparência (temas) e seção pvx (sobre, atualização, desinstalar) → [Ajustes vira Sistema](#2026-10-14--ajustes-vira-sistema)
- Matar `!cmd` com `x` ou `ctrl+c` → [Matar um comando em execução com `x` ou `ctrl+c`](#2026-10-13--matar-um-comando-em-execução-com-x-ou-ctrlc)
- Aviso "nada aqui" para movimento inválido → [Aviso de movimento inválido, painéis numerados, `/` da barra e ordem das abas](#2026-10-09--aviso-de-movimento-inválido-painéis-numerados--da-barra-e-ordem-das-abas)

### SDK e módulos

- `sdk.ui` injetado; o módulo nunca importa React → [Injeção de UI: `sdk.ui` injetado (opção b)](#2026-10-09--injeção-de-ui-sdkui-injetado-opção-b)
- Páginas e abas de módulo, teclas da página, erros isolados → [SDK de UI, páginas e abas de módulo (Fase 3A)](#2026-10-09--sdk-de-ui-páginas-e-abas-de-módulo-fase-3a) (em parte)
- Widgets e slots da home → [Widgets e slots da home (Fase 3B)](#2026-10-09--widgets-e-slots-da-home-fase-3b)
- Kit de teste e modelo para quem escreve módulos → [Kit de quem escreve módulos (3C)](#2026-10-09--kit-de-quem-escreve-módulos-3c)
- `useKey`, moldura única, módulos embutidos, `useConformity` → [Fecha a Fase 3: `useKey`, moldura única, módulos embutidos e Conformidade como módulo (3D)](#2026-10-09--fecha-a-fase-3-usekey-moldura-única-módulos-embutidos-e-conformidade-como-módulo-3d) (em parte)
- Abas contribuídas por módulo (`tab`) → [Abas contribuídas por módulo (Fase 3)](#2026-10-09--abas-contribuídas-por-módulo-fase-3)
- Páginas de módulo navegam como o Início: `toBar` e `useBack` → [Páginas de módulo navegam como o Início: `toBar` e `useBack`](#2026-10-13--páginas-de-módulo-navegam-como-o-início-tobar-e-useback)
- Módulo gerenciado pela TUI sobre um registry vivo → [Módulos na TUI: gerenciador, catálogo, revisão e registry vivo (Fase 4C)](#2026-10-09--módulos-na-tui-gerenciador-catálogo-revisão-e-registry-vivo-fase-4c) (em parte)
- `ctx.exec` com streaming e cancelamento, jobs em segundo plano, `useJob`, campos `secret`/`choice`/`multi`, `Steps` e `LogTail` → [SDK: exec em streaming, jobs em segundo plano e kit de instalador](#2026-10-14--sdk-exec-em-streaming-jobs-em-segundo-plano-e-kit-de-instalador)
- Componentes de fluxo no framework (`Conversation`, `Button`, `ProgressBar`, `CellGrid`, `Loading`, `useAsync`, `useCopy`) e a regra de espera visível → [SDK: componentes de fluxo e espera visível](#2026-10-14--sdk-componentes-de-fluxo-e-espera-visível)
- Estrutura padrão de módulo = a do `pvx-firewall` reescrito → [Estrutura padrão de módulo](#2026-10-14--estrutura-padrão-de-módulo-a-do-pvx-firewall-reescrito)
- Firewall: listas lado a lado só a partir de 120 colunas (exceção ao 100 do UI.md) → [Firewall: listas lado a lado a partir de 120 colunas](#2026-10-14--firewall-listas-lado-a-lado-a-partir-de-120-colunas)
- Firewall: ações de linha por `enter` → formulário com `remover` e confirmação do framework → [Firewall: ações de linha pelo formulário](#2026-10-14--firewall-ações-de-linha-pelo-formulário)
- `ctx.shell`, `ctx.fs.write` com `mode` e `atomic`, `store.update`, `sdk.strategy` e `sdk.packages` (`dnf` e `apt`) → [SDK: peças genéricas extraídas dos módulos firewall e issabel](#2026-10-14--sdk-peças-genéricas-extraídas-dos-módulos-firewall-e-issabel)
- Fases com retomada (`ctx.phases`, `useRun`), `useJob().view` com `stale`, `useQuery().refetch` → [SDK: peças genéricas extraídas dos módulos firewall e issabel](#2026-10-14--sdk-peças-genéricas-extraídas-dos-módulos-firewall-e-issabel)
- `List` com janela (`maxRows`) e `onAction`, `Panel shrink`, `Notice`, `LogTail focused`, `useNudge` com tom `ok`; "precisa aplicar" como convenção (UI.md, seção 13) → [SDK: peças genéricas extraídas dos módulos firewall e issabel](#2026-10-14--sdk-peças-genéricas-extraídas-dos-módulos-firewall-e-issabel)
- Sistema falso para testes de módulo em `@pvx/testing` (`fakeSystem`, `fakeCommandCtx`, `fakeReadCtx`, `fakeSdk`) → [SDK: peças genéricas extraídas dos módulos firewall e issabel](#2026-10-14--sdk-peças-genéricas-extraídas-dos-módulos-firewall-e-issabel)
- `ctx.session.sshClient`: o host acha o IP do cliente SSH (ambiente, ambiente dos processos pais, `who`) e o audit grava `from` → [Sessão SSH no host: `ctx.session.sshClient`](#2026-10-14--sessão-ssh-no-host-ctxsessionsshclient)
- `ctx.strategy` e `ReadCtx.shell` (`run`, `ok`) nos contextos; `sdk.errors` (`isStepError`, `describeFailure`); o catch do host mostra a saída de um `StepError` → [SDK: lacunas achadas ao migrar o firewall](#2026-10-14--sdk-lacunas-achadas-ao-migrar-o-firewall)
- `List actionOnClick` (clique só seleciona, `enter` ou segundo clique abre), `useNudge` com tons `warn` e `error`, `stderr` do falso transmitido ao `tail` → [SDK: lacunas achadas ao migrar o firewall](#2026-10-14--sdk-lacunas-achadas-ao-migrar-o-firewall)
- `phase.progress(fração)` e `sdk.phases` (`progress`, `finished`), `useRun` com `trailing`, `loading` e tempos vivos, `ctx.shell.echoing`, `sdk.errors.stepError`, `ctx.isRoot`, `ctx.signal`, `fakeSystem` com `clock` e `isRoot` e `onFakeMachine` no `@pvx/testing` → [SDK: lacunas achadas ao migrar o issabel](#2026-10-14--sdk-lacunas-achadas-ao-migrar-o-issabel)
- Módulo embutido `nota` (arquivo só de acréscimo, SDK aditivo) → [Módulo `notas` embutido (Fase 6A)](#2026-10-09--módulo-notas-embutido-fase-6a) (em parte)
- `bun run dev:link <pasta>` (script do repo, não do binário) liga um módulo local em `.dev/pvx` pela mesma lógica do `modules link`, sem root; `renderPage` e `runSession` repassam `sshClient` e `isRoot` também aos comandos que uma página roda → [Dev link e sessão nos comandos de página](#2026-10-14--dev-link-e-sessão-nos-comandos-de-página)
- Duas `List` com `onAction` na mesma tela: só a lista que tem uma linha com o id de `selected` registra o `enter` (o rodapé o mostra uma vez, sem chave duplicada no React) → [List: só a lista dona da seleção registra o enter](#2026-10-14--list-só-a-lista-dona-da-seleção-registra-o-enter)

## 2026-10-09 — Protótipo ausente: núcleo reconstruído a partir da spec

**Status:** vigente

**Decisão:** O núcleo é reconstruído a partir de `docs/pvxcli-v3-plano-de-implementacao.md` (documento local, fora do git).

**Motivo:** O tarball `pvx-next.tar.gz` citado na spec não existe.

## 2026-10-09 — Formato padrão da linha de resultado

**Status:** vigente

**Decisão:** A linha de resultado tem uma só forma: `[✓] texto`, `[!] texto`, `[✗] texto`, `[i] texto`.

- Colchetes e símbolo na cor do nível, texto na cor principal.

**Motivo:** Uma só forma de linha para CLI, `--json` e scrollback.

## 2026-10-09 — Spike 1 (runtime) executado manualmente

**Status:** resolvida (resultado em "Spike 1 (runtime): Rocky 8 OK" e "Spike 1 (runtime): CentOS 7 OK — stack confirmada")

**Decisão:** O dono executa o Spike 1 numa central de teste, sem Docker.

**Motivo:** O runtime real só existe na central.

## 2026-10-09 — Injeção de UI: `sdk.ui` injetado (opção b)

**Status:** vigente

**Decisão:** O host injeta `sdk.ui` (hooks, componentes, `h`/`Fragment`) e o módulo nunca importa React.

- JSX só com `/** @jsxRuntime classic */` + `@jsx h`.

**Motivo:** Spike 2 e 3. `onResolve` não dispara em `bun test` nem no binário; o caminho por plugin exige truques frágeis (`onLoad`/`build.module`, variantes de jsx-runtime). Detalhes no spike local `spikes/react-ui/VEREDITO.md` (pasta local, fora do git).

## 2026-10-09 — Distribuição: binário compilado (provisório)

**Status:** vigente; era provisória e foi confirmada em "Spike 1 (runtime): CentOS 7 OK — stack confirmada" (a pendência de confirmar no Linux real está resolvida)

**Decisão:** O pvx é distribuído como binário compilado por `bun build --compile`.

- Módulos externos só podem usar imports relativos e `import type`.
- As dependências vão empacotadas no próprio módulo.

**Motivo:** Spike 3: o binário carrega `.ts` externo por `import()` (61 MB, 14 ms).

## 2026-10-09 — Confiança e recarga de módulos

**Status:** vigente

**Decisão:** O carregamento segue uma cadeia fixa, e `modules link` recarrega o módulo limpando o `require.cache`.

- Cadeia: ler manifest → `git rev-parse HEAD` + `status --porcelain` → trust store → `realpath` do entry dentro do módulo → `import()`.
- A recarga apaga do `require.cache` todos os arquivos do módulo (não usar `?v=`).
- A fábrica ganharia `dispose` quando houvesse recarga.

**Motivo:** Spike 4/5. `?v=` não recarrega imports relativos e vaza memória (709 MB/3000 recargas vs 70 MB).

**Limite:** A `dispose` não existe: a Fase 4B ficou sem ela (ver "Fase 4B: sem desvio de confiança, update, link, permissões, cache de avisos").

## 2026-10-09 — Privilégio: quais comandos exigem root

**Status:** substituída por 2026-10-09 — Root estrito (a exceção de `PVX_HOME` gravável saiu)

**Decisão:** Comandos de módulo e `plano apply` exigem root, e a regra vale por tipo de comando, não por efeito.

- Gravam em `PVX_HOME` (estado, logs, passos), por isso exigem root.
- `modules`, `logs`, `conformidade`, `plano`, `version` e `--help` não exigem.
- Sem root: erro "grava em <PVX_HOME>: rode com sudo", exit 1.
- O runner recebe `isRoot` injetado; o entrypoint o calcula como `uid == 0` ou `PVX_HOME` gravável pelo usuário (`canWritePvxHome`).

**Motivo:** Módulos podem gravar estado a qualquer momento, então a regra é por tipo de comando, não por efeito. A exceção de `PVX_HOME` gravável deixava dev e testes com `PVX_HOME` temporário rodarem sem sudo; em `/etc/pvx` real o usuário comum continuava barrado.

## 2026-10-09 — Perfis: pasta resolvida pelo código-fonte

**Status:** vigente; a pendência de embutir os perfis no binário foi resolvida em 2026-10-13 — Fase 8: distribuição e atualização (a pasta continua como reserva)

**Decisão:** Os perfis ficam em `profiles/*.json` na raiz do repo, resolvidos a partir de `import.meta.dir` do app.

- Nenhum perfil Phonevox ainda.
- Embutir os perfis no binário compilado ficava para a Fase 8.

**Motivo:** No `bun build --compile` o caminho relativo ao código não existe.

## 2026-10-09 — Detalhes do runner da CLI

**Status:** vigente

**Decisão:** O runner é puro e testável: devolve o exit code, e só `apps/pvx` chama `process.exit`.

- Devolve `"tui"` quando há TTY e nenhum argumento.
- `logs` sem módulo e sem `--all` mostra o `core`; `-f` não combina com `--json`.
- `conformidade` sai 0 mesmo com erros; só `--strict` sai 1.
- Cancelar a confirmação `s/N` sai com 1.
- As cores vêm por injeção (`theme`): o core não importa `@pvx/tui`, que depende dele.

**Motivo:** Evitar dependência circular e manter o runner puro e testável.

## 2026-10-09 — Spike 1 (runtime): Rocky 8 OK

**Status:** vigente; a pendência do CentOS 7 foi resolvida em "Spike 1 (runtime): CentOS 7 OK — stack confirmada"

**Decisão:** A stack é mantida.

- O binário compilado roda em Rocky 8.10 (glibc 2.28, kernel 4.18): selftest e TUI ok, primeiro frame ~30 ms.
- CentOS 7 estava pendente (previsão: ok, glibc exigida 2.17).

**Motivo:** Execução real na central de teste pelo dono.

## 2026-10-09 — Root estrito

**Status:** substituída em parte por 2026-10-13 — Windows conta como root (o "só uid 0" vale em Linux e macOS; `!cmd` não passa pela checagem)

**Decisão:** Só uid 0 é root, sem bypass.

- Comandos de leitura do núcleo não exigem root.
- Todo comando de módulo exige root.

**Motivo:** Substitui a exceção de `PVX_HOME` gravável da entrada "Privilégio: quais comandos exigem root". Um bypass seria falha de segurança nas centrais dos clientes.

## 2026-10-09 — Spike 1 (runtime): CentOS 7 OK — stack confirmada

**Status:** vigente

**Decisão:** A stack OpenTUI + React + Bun está confirmada, com distribuição por binário compilado.

- Build x64 padrão; o baseline não é necessário nos hosts testados.

**Motivo:** CentOS 7 (glibc 2.17, kernel 3.10) e Rocky 8.10 passaram selftest e TUI, primeiro frame 29–34 ms.

## 2026-10-09 — Glifo "em desenvolvimento": `↯` no lugar de `⚡`

**Status:** vigente

**Decisão:** O glifo de módulo em desenvolvimento é `↯`, com reserva ASCII `~`.

- `⚡` fica fora da tabela.

**Motivo:** `⚡` ocupa duas células no OpenTUI (o teste de largura de glifo em frame o reprova, como o `‼`).

## 2026-10-09 — Tema claro adiado; eixos do tema

**Status:** substituída por 2026-10-13 — Ajustes: temas e editor de tema (o tema claro existe, o acento padrão é "tema" e o tema "automático" não existe)

**Decisão:** O tema claro foi adiado e o tema ganhou eixos persistidos.

- `tokensFor("light")` lançava "tema claro ainda não definido" até o dono definir os valores.
- Eixos persistidos em `tui-state.json`: `accent` (menta, azul, ambar, violeta), `symbols` (unicode, ascii), `border` (rounded, single, none) e `result` (bracket, glyph, text).
- Escrita com debounce de 300 ms e descarga ao desmontar e no Ctrl+C.
- O tema "automático" também ficava para depois do claro.

**Motivo:** Contraste do claro precisa ser medido antes (spec). `symbols: ascii` troca só glifos; as molduras seguem o eixo `border`.

## 2026-10-09 — Roteador mantém só a tela do topo montada

**Status:** vigente

**Decisão:** As telas abaixo na pilha são desmontadas.

- Estado que deve sobreviver a `push`/`pop` (scrollback da sessão) fica fora do componente.
- Um teclado central (`KeyRouter`) despacha do handler mais novo para o mais antigo; `modal` encerra a cadeia e `base` roda por último.

**Motivo:** Telas escondidas continuariam registrando teclas.

## 2026-10-09 — Palette: espaço digita na busca; `ctrl+n` enfileira; `ctrl+j` roda a fila

**Status:** vigente

**Decisão:** `espaço` enfileira só com a busca vazia; com texto, ele entra na consulta.

- Com texto na busca o espaço entra na consulta (`cap-fixture fix`).
- `ctrl+n` enfileira sempre.
- Terminais sem protocolo kitty mandam `\r` para `ctrl+enter`, então `ctrl+j` (um `\n` cru, `name: "linefeed"`) também roda a fila; `matchKey` trata os dois.
- Tudo está na tabela única de atalhos (`paletteShortcuts` mesclada em `shortcuts` sem duplicar `keys + scope`).

**Motivo:** A busca precisa aceitar espaço; a regra "busca vazia" não exige foco extra.

## 2026-10-09 — Palette renderiza os próprios modais; rodapé segue o overlay

**Status:** substituída em parte por 2026-10-09 — A ajuda `?` é contextual (a ajuda em duas colunas saiu; o resto vale)

**Decisão:** A palette renderiza os seus próprios modais, e o rodapé segue o overlay.

- A palette renderiza `SessionModals` inscrita no store (só a tela do topo está montada, então confirmação ou segredo de um comando da fila esperaria para sempre).
- A sessão esconde os seus modais enquanto a palette está aberta.
- `useFooterScope("palette")` troca o escopo do rodapé enquanto o overlay existe.
- A ajuda `?` usava duas colunas para caber em 80x24.

**Motivo:** Um só dono de cada pergunta ao usuário; rodapé e ajuda continuam saindo da mesma tabela.

## 2026-10-09 — Spinner, chips e testes

**Status:** substituída em parte por 2026-10-09 — Abas no topo no lugar dos chips (os chips saíram; spinner e regras de teste valem)

**Decisão:** Um único `setInterval` de 100 ms na sessão anima o spinner, só enquanto há bloco rodando.

- `glyphs.spinner` guarda os quadros (uma célula cada).
- Chips do host: `N módulos` e `✗ <id>` (máx. 2, depois `+N`; clique abre o log do módulo).
- Blocos e linhas da palette são `memo` com hover local.
- `renderTui` liga `IS_REACT_ACT_ENVIRONMENT` só dentro de `act` e envolve `destroy` e a espera do ESC em `act`: os avisos "not wrapped in act" saíram (restam os do spike local `spikes/`, fora do git).

**Motivo:** Timers e store atualizam entre as chamadas do harness; o aviso só vale para o que o teste dispara.

## 2026-10-09 — Tela inicial por menus (muda o "command-first")

**Status:** substituída em parte por 2026-10-09 — Início vira painel de informação; o menu de módulos vai para Módulos (o menu em lista agora é a aba Módulos; o Início é um painel)

**Decisão:** A tela inicial é um menu em lista (setas + enter), gerado do registry.

- Fluxo: módulos → comandos → formulário do ArgSpec → saída.
- Ações do núcleo (conformidade, plano, logs, módulos) no menu raiz.
- `/` abre o modo comando (sessão com histórico, `!!`, completar); `esc` volta ao menu.
- `ctrl+k` (palette) funciona em todas as telas.
- Menus sem filtro por digitação, só setas.

**Motivo:** Pedido do dono: totalmente command-based é complexo para os técnicos. Sobrepõe o princípio 1 do plano e a linha "menu raiz do pvx Python não existe mais".

## 2026-10-09 — Menu inicial: estado, núcleo no TUI, root e segredo no repeat

**Status:** vigente

**Decisão:** O estado do menu fica fora do componente, as ações do núcleo rodam pela sessão, e o segredo nunca vai ao disco.

- O menu mantém caminho e seleção em `MenuNav`, fora do componente (o roteador desmonta a tela quando `/` ou um log ocupa o topo); formulário e resultado são visões internas do menu, não telas empilhadas.
- As ações do núcleo (`conformidade`, `plano`, `modules`, `logs`) rodam pela sessão via `core` injetado no store, que chama `runCapture` (`runCli --json`); assim caem no histórico e no scrollback.
- Root estrito no TUI usa o mesmo `requiresRoot`/`rootMessage` do `runCli`; `isRoot` é injetado no store.
- A linha real de um bloco mascarado (`cmd ***`) fica só em memória (`lineOf`); `repeat`, `!!` e clique recolhem essa linha e o segredo é pedido de novo pelo modal. O disco só vê a linha mascarada.

**Motivo:** Pedido do dono (menus) e lacunas da revisão.

**Limite:** `ctrl+k` está no menu e na sessão; a tela de log ainda não o tinha (resolvido na entrada seguinte, onde o `PaletteHost` vive no `App`).

## 2026-10-09 — Ações do bloco com erro exigem `alt`; `ctrl+k` único no App; clipboard do host

**Status:** substituída em parte por 2026-10-09 — Ações de bloco sem combo: foco espacial no Comando (o item 1, `alt+r/l/c`, saiu; os itens 2 a 4 valem)

**Decisão:** As ações do bloco com erro passaram a exigir `alt`, e `ctrl+k` passou a viver num só ponto do `App`.

- **Ações com `alt`.** `r`, `l` e `c` roubavam letras de quem digitava `reboot`, `logs`, `conformidade` quando o último bloco falhava. As ações ficaram `alt+r` (repetir), `alt+l` (log do módulo) e `alt+c` (copiar erro). Ficavam na tabela única (`keymap.ts`, escopo `session`, sem rodapé), então `?` e a linha de dicas do bloco saíam dela; `matchKey` aceitava `alt` como `meta`. Letras puras sempre digitam.
- **`ctrl+k` único.** `PaletteHost` vive no `App` (prop `palette`) e abre com `ctrl+k` em qualquer tela, inclusive o log; `Menu` e `Session` só leem `router.scope === "palette"` para esconder os modais.
- **Clipboard.** Copiar usa `createClipboard` (host + OSC52) do OpenTUI, com a nota "copiado".
- **Teclado do teste.** `renderTui` usa `kittyKeyboard: true`: sem espera de ESC, `ctrl+enter` direto.

**Motivo:** Modificador era a regra mais simples e não exigia foco por bloco; um único ponto de `ctrl+k`; OSC52 sozinho falha em tmux e SSH.

**Limite:** Terminais sem Option como Meta (Terminal.app padrão) não mandam `alt`; o `/` do menu e o histórico (`↑`, `!!`) cobriam o repetir. `renderTui` mantém a flag de act só dentro de `act` (deixar o `testRender` dona dela sobe os avisos de 4 para 146) e mantém o laço em `type` (`typeText` perde teclas, pois o handler lê o estado do último render).

## 2026-10-09 — Palette: `→` entra nos campos, `←` volta à lista

**Status:** substituída em parte por 2026-10-09 — Campos de texto têm cursor (a regra de `←` só com campo vazio ou flag saiu; `→` entra nos campos e `esc` volta continuam)

**Decisão:** `→` na lista foca o primeiro campo do comando selecionado, e `←` num campo volta à lista.

- Sem args, `→` mostra "sem argumentos".
- `←` num campo voltava à lista só se o campo estava vazio ou era flag; com texto, não fazia nada.
- A seleção é por id e não muda, então volta no mesmo comando.
- `tab` segue igual.

**Motivo:** Os campos não tinham cursor (só acrescentavam e apagavam no fim), então não havia movimento de cursor a preservar. Voltar só com o campo vazio evitava perder o foco no meio da digitação; `esc` sempre volta.

## 2026-10-09 — Abas no topo no lugar dos chips

**Status:** substituída em parte por 2026-10-09 — Aviso de movimento inválido, painéis numerados, `/` da barra e ordem das abas, e por 2026-10-13 — Ajustes: temas e editor de tema (a lista de abas mudou: hoje é Início · Módulos · abas de módulo · Logs · Comando · Sistema; Conformidade e Plano deixaram de ser abas; ver também "Abas do núcleo sob demanda…")

**Decisão:** A tela raiz passou a ser uma barra de abas, no lugar dos chips.

- Abas (na época): Início · Módulos · Conformidade · Plano · Logs · Comando.
- A raiz do roteador é `Tabs` (barra + aba ativa); só a aba ativa fica montada e o estado fica em `TabsNav` (aba, foco, `MenuNav`, seleção de Módulos) e no store da sessão.
- Erros de carga viram contador no rótulo (`Módulos ✗5`); no 80x24 os rótulos completos cabiam, então não havia abreviação, e host/versão à direita eram cortados para caber.
- O menu raiz tem só módulos.
- Conformidade, Plano e Logs rodavam o comando do núcleo a cada entrada na aba (nunca ficavam velhos) pelo `store.run`; cada visita deixava um bloco no scrollback do Comando.
- O cabeçalho do `App` só aparece com um aviso de queda de tela.
- **Teclas.** `tab`/`shift+tab` trocam de aba (o handler das abas é `base`: quem consome `tab` ganha, como o completar do Comando e os campos do formulário).
- `↑` na primeira linha, `esc` com entrada vazia no Comando ou `shift+tab` focam a barra; com a barra focada `←`/`→` trocam na hora e `↓` entra na aba (sem item selecionável, não faz nada).
- Aba sem itens (Conformidade, Plano, Logs) nunca guarda foco: trocar para ela por `tab` deixa a barra focada.
- Chegar ao Comando pela barra exige `↓` para digitar.
- O rascunho do input do Comando se perde ao trocar de aba (o scrollback não).
- **Rodapé.** Escopo `tabs` novo, trocado por `useScreenScope` (a ajuda `?` usava 2 colunas e `top=0` para caber em 80x24). `/` no menu vai para a aba Comando e saiu do rodapé.
- **Mouse.** Clique troca de aba, hover simples; não coberto por teste (o harness não tem mouse).

**Motivo:** Pedido do dono.

**Limite:** Ações do núcleo repetidas enchem o histórico do Comando.

## 2026-10-09 — Ações de bloco sem combo: foco espacial no Comando

**Status:** vigente

**Decisão:** As ações de bloco usam foco espacial, sem modificador: substitui a entrada "Ações do bloco com erro exigem `alt`" (o `alt` não chega em terminais macOS padrão).

- `matchKey` não aceita mais `alt`/`meta`.
- Áreas de foco, de cima para baixo: barra de abas → blocos → entrada.
- `esc` com a entrada vazia foca o ÚLTIMO bloco (sem blocos, foca a barra); `↑` na entrada segue sendo histórico.
- Com um bloco focado (seleção por id, fundo `selected` e `»`): `↑`/`↓` movem; `↑` no primeiro foca a barra; `↓` no último ou `esc` voltam à entrada.
- Ações do bloco focado: `r` repete (usa `lineOf`, o segredo é pedido de novo); `l` abre o log do módulo; `c` copia o erro (ou a saída, se não é erro); `enter` põe a linha na entrada; outra tecla imprimível volta à entrada e digita.
- Vale para qualquer bloco.
- A linha `r repetir · l log · c copiar` aparece só no bloco focado, vinda das linhas `hint` do escopo `block` na tabela.
- Clique no bloco o foca (não recupera mais a linha).
- O scrollback rola até o bloco focado (`scrollChildIntoView` por id).
- A ajuda `?` mostrava o escopo `block` sob "sessão", sem título, e o "esc fecha" foi para o título da moldura: é o que cabia em 80x24 (a ajuda mudou depois, ver "A ajuda `?` é contextual").

**Motivo:** Pedido do dono, sem modificador; `r`/`l`/`c` só agem com um bloco focado, então digitar `reboot` nunca perde letras.

**Limite:** O log empilha uma tela e a sessão desmonta; ao voltar, o foco do bloco se perdeu (cai na entrada).

## 2026-10-09 — Abas do núcleo sob demanda, rascunho do Comando, foco e destaque só onde há foco

**Status:** substituída em parte por 2026-10-09 — Plano dentro de Conformidade, sem Diário, built-ins sem aba, relógio na barra (Conformidade e Plano deixaram de ser abas do núcleo; só o Logs segue no núcleo; o rascunho, o foco e o destaque valem; a aba Logs agora atualiza a cada 5 s, ver 2026-10-13 — Navegação espacial entre painéis, rolagem ao fim e hover)

**Decisão:** As abas do núcleo rodam sob demanda, e só a área com foco mostra o estilo de foco.

- **Sob demanda.** Conformidade, Plano e Logs rodam na primeira visita e depois só com `r` (linha `r atualiza` no escopo `tabs`). O resultado fica em `TabsNav.core` (memória) e o topo mostra "verificado às HH:MM". Rodam por `store.capture`, fora de `run`: não criam bloco nem entrada de histórico; mesma regra de root.
- **Rascunho.** O rascunho da entrada do Comando vive em `TabsNav.draft`, só em memória, e sobrevive à troca de aba (segredo não entra na linha: vai pelo modal).
- **Foco na barra.** Trocar de aba (`tab`, `shift+tab`, `←`/`→`, clique) sempre deixa o foco na barra; `↓` entra. `tab` numa entrada focada do Comando continua completando.
- **Destaque só com foco.** Entrada sem foco tem borda neutra, sem cursor e com o texto "digite um comando"; bloco só tem `»` e fundo quando focado; `ItemList` (Início, Módulos) esconde o realce com a barra focada e o restaura no mesmo item. O conteúdo da aba fica numa caixa com `minHeight={0}` abaixo da barra.

**Motivo:** Pedido do dono ("um elemento forte por tela").

**Limite:** Não há teste de cor, só de glifos.

## 2026-10-09 — Abas contribuídas por módulo (Fase 3)

**Status:** vigente (ver "Fecha a Fase 3…" para a execução e "Plano dentro de Conformidade…" para a revisão do papel dos built-ins)

**Decisão:** Na Fase 3, `PageDef` ganha a opção de virar aba (ex.: `tab: true`).

- A aba aparece na barra quando o módulo carrega e some ao removê-lo.
- A aba Conformidade migra para um módulo oficial embutido (como `notas`).
- O motor de avaliação e plano continua no núcleo e é exposto ao módulo pelo SDK.

**Motivo:** Pedido do dono. Mantém a regra "lógica que serve a todos os módulos é do host" e dá plug-and-play visual.

**Limite:** Pendente: confirmar se o corte do título sob a barra persiste no terminal do VS Code (possível `terminal.integrated.lineHeight`).

## 2026-10-09 — Início vira painel de informação; o menu de módulos vai para Módulos

**Status:** substituída em parte por 2026-10-09 — Início em grade, versão fixa na barra, sem cabeçalho e por 2026-10-13 — Painel máquina estilo btop (o cabeçalho e a leitura da máquina de 5 s saíram; as setas `←`/`→` entre painéis hoje são espaciais, ver 2026-10-13 — Navegação espacial entre painéis, rolagem ao fim e hover; o resto vale)

**Decisão:** O Início passa a ser um painel de informação, e o menu de módulos vai para a aba Módulos.

- **Painéis.** Início mostra cabeçalho (host, IP, perfil, versão) e três painéis: máquina (carga, RAM e disco `/` em `▰▱`, uptime), conformidade e atividade; 2 colunas a partir de 100 colunas, 1 coluna abaixo. Notas não têm painel (Fase 6).
- **Máquina.** Leitura em `core/src/host/machine.ts` (`os` + `fs.statfsSync`, sem shell), atualizada por UM `setInterval` de 5 s enquanto Início está montado.
- **Conformidade.** Lê o cache `TabsNav.core` (mesmo da aba): nunca roda sozinha ("não verificado · r verifica"); `r` roda por `refreshCore`, extraído de `CoreTab`. O `fix` de cada pendência vem no JSON do `conformidade` (campo opcional `fix` em `CoreLine`, que estende `OutLine` só no núcleo; o SDK não mudou) e `store.capture` o preserva. Sem perfil ou perfil forçado inválido: a mensagem do comando aparece como está.
- **Atividade.** Favoritos (★, do arquivo da palette) e últimos comandos do histórico; status e hora relativa vêm dos blocos da sessão (`Block.at`, novo e opcional); sem bloco, só o texto.
- **`enter` num item** grava a linha em `TabsNav.draft` e vai ao Comando com a entrada focada: nada roda até o técnico confirmar.
- **Foco.** `←`/`→` trocam de painel (conformidade, atividade; a máquina não é selecionável), `↑` na primeira linha vai à barra, `↓`/`enter` da barra voltam ao painel que tinha o cursor; painel focado tem borda menta e `●` no título; com a barra focada nada aparece selecionado. Início abre com o conteúdo focado, como antes. `/` continua indo ao Comando.
- **Rodapé.** Escopo `home` na tabela única (`↑↓ move`, `←→ painel`, `enter usa`, `r atualiza`); `ctrl+k` e `tab` ficam só na ajuda.
- **Perfil.** O perfil do cabeçalho vem da prop `profile` de `Tabs`, calculada no host por `activeProfile` (núcleo; perfil inválido vira null).
- **Módulos.** A raiz do mesmo `Menu` (módulos com estado e linhas de erro; `enter` entra, `esc` sobe, formulário e resultado como antes), sem painel lateral; `ModulesTab` foi removido e o texto "versão carregado · N comandos" passou para `buildRoot`. Cada aba guarda o próprio estado (`TabsNav.menu`, `TabsNav.home`).

**Motivo:** Pedido do dono.

**Limite:** A ajuda `?` já não cabia em 80x24 (colunas cortadas no fim); o escopo `home` aumenta o corte e não foi tratado aqui (resolvido em "A ajuda `?` é contextual").

## 2026-10-09 — A ajuda `?` é contextual

**Status:** vigente

**Decisão:** A ajuda mostra todas as linhas do escopo atual do rodapé, mais as do escopo `global`.

- O escopo atual é o escolhido por rank de foco: tabs, home, menu, form, block, session, palette...
- Mostra mesmo as linhas sem `footer`, e uma última linha "o rodapé mostra só as teclas principais".
- Uma coluna só, gerada da tabela única (`helpFor` em `keymap.ts`); a visão de todos os escopos foi removida.
- Substitui a decisão da ajuda em duas colunas (o escopo `block` sob "sessão" saiu junto).

**Motivo:** A ajuda com todos os escopos estourava 80x24 e o escopo `home` piorou o corte.

**Limite:** Campo de texto focado (formulário, entrada do Comando, consulta da palette) digita `?` em vez de abrir a ajuda; esses escopos têm teste de encaixe renderizando a sobreposição direto.

## 2026-10-09 — Início em grade, versão fixa na barra, sem cabeçalho

**Status:** vigente (o painel máquina foi redesenhado em 2026-10-13 — Painel máquina estilo btop; o relógio entrou na barra em 2026-10-09 — Plano dentro de Conformidade…)

**Decisão:** O Início é uma grade de painéis, a versão fica fixa na barra e o cabeçalho foi removido.

- **Barra e cabeçalho.** A barra mostra sempre `pvx <versão>` à direita, em toda aba; o hostname saiu da barra e a linha de cabeçalho de Início foi removida. Hostname e IP são a 1ª linha do painel máquina; o perfil ("perfil X" ou "sem perfil") é a 1ª linha do painel conformidade.
- **Grade.** A partir de 100 colunas, linha de cima = máquina (largura 40) | conformidade (cresce), atividade embaixo em largura total; abaixo de 100, uma coluna (máquina com altura 8). As áreas dividem a altura (minHeight 8 e 6) e cada painel tem `overflow="hidden"`: recorta o conteúdo, nunca empurra o vizinho.
- **Hora da leitura.** A máquina mostra "atualizado HH:MM:SS" (hora da última leitura; o `setInterval` de 5 s segue só com Início montado).
- **RAM.** Comentário em `machine.ts` sobre o `freemem()` do darwin; sem código por plataforma.
- **Sobre a sobreposição relatada: não reproduzida.** Quadros de teste em 230x24, 120x40, 100x30 e 80x24 e um pty tmux em 230x25 e 80x24 mostram cada linha (barra, título dos painéis, rodapé) na sua própria linha; abaixo de 80x24 só aparece o aviso "terminal pequeno" (por isso 230x20 não desenha painéis). Todas as linhas fixas já tinham `flexShrink={0}` e as áreas de crescimento `minHeight={0}`.
- **Hipótese mais provável.** Renderização do terminal do VS Code (`terminal.integrated.lineHeight` diferente de 1 corta glifos e o sublinhado da aba ativa parece tachado), não o layout.
- Testes novos travam a regra (cada linha fixa sozinha na sua linha).

**Motivo:** Sobreposição de linhas relatada pelo dono no Início.

**Limite:** Pendente: o dono testar com `lineHeight: 1` ou `gpuAcceleration` desligado.

## 2026-10-09 — SDK de UI, páginas e abas de módulo (Fase 3A)

**Status:** substituída em parte por 2026-10-09 — Aviso de movimento inválido, painéis numerados, `/` da barra e ordem das abas (a ordem "depois das do núcleo" do item 5 saiu; o resto vale)

**Decisão:** `sdk.ui` é um objeto único, sem estado por módulo, e módulos contribuem páginas e abas pelo registry.

- **`sdk.ui` único.** O objeto `ui` fica em `packages/tui/src/sdk-ui/`: os hooks leem um contexto (`HostCtx`) que a página montada fornece (módulo dono, sessão, registry). `loadModules` recebe `ui` em `LoadOpts`; sem ele (testes do core) `sdk.ui` aceita desestruturar mas qualquer chamada lança "UI indisponível na CLI". O core não importa React. Em `apps/pvx` o `ui` real é passado sempre: a CLI já importa `@pvx/tui` (o `theme`) e portanto o React; evitar isso exigiria um subcaminho só de tema, não feito.
- **Registry de páginas.** `registry.pages` (chave `<módulo>.<página>`) e `resolvePage` (exata, ou só o nome se único). `#ref` na sessão e na palette (escopo `#`) roda por `store.run`: navegação, sem bloco nem histórico; página inexistente vira bloco de erro. Comando com `page` abre a página quando sai com 0 (`store.onPage`; o `PageHost` do `App` empilha a tela). `App` ganhou a prop `pages` (sessão, registry, makeLogger); sem ela páginas e abas de módulo não existem.
- **Teclas da página.** Escopo de rodapé `page:<chave>`; `setPageRows` (keymap.ts) acrescenta as linhas à tabela única, então rodapé e `?` saem dela. `esc`, `?`, `ctrl+c` e `ctrl+k` são reservadas e ignoradas. `KeySpec.run()` não enxerga o estado do componente: o módulo guarda o setter numa variável da fábrica (como no módulo de exemplo) ou usa o store. Uma tecla que lança vai para o log do módulo.
- **Erros de renderização.** Página que lança ao renderizar: o boundary do roteador loga, volta e avisa (`tela "#mod.pag" falhou`). Aba de módulo que lança: o painel mostra o erro na própria aba (a barra é a raiz; não há tela anterior) e loga no módulo.
- **Abas de módulo.** `tab: true | {label, order}`, por `order` e rótulo (a posição na barra mudou depois: ver a entrada de ordem das abas). Aba visitada continua montada (escondida, `visible={false}`, teclas desligadas) para manter o estado enquanto a tela de abas existe; uma tela empilhada por cima desmonta tudo, e o estado do React se perde. `esc` no conteúdo da aba volta à barra. A barra transborda com `‹`/`›` (glifos `moreLeft`/`moreRight`, com reserva ASCII `<` `>`) e rola só o necessário (`fitBar`, `TabsNav.barFrom`).
- **`useCommand`.** Só roda comandos do próprio módulo (a página só chama comandos do módulo); o formulário `Form` reaproveita o `MenuForm` e o `SessionModals` da página cuida de confirmação e segredo.

**Motivo:** Pedido do dono (plug-and-play visual) e spike 2.

**Limite:** A tecla da página não alcança o estado React sem a variável na fábrica; um hook `useKey` ou `render(api)` ficava para quando a ergonomia incomodasse (3C, docs do SDK; o `useKey` veio na Fase 3D).

## 2026-10-09 — `esc` sobe um nível no Comando: bloco focado vai para a barra

**Status:** vigente

**Decisão:** Com um bloco focado no Comando, `esc` foca a barra de abas (antes voltava à entrada).

- A regra é `esc` sobe um nível: entrada vazia → blocos → barra.
- `↓` depois do último bloco continua voltando à entrada.
- O escopo `block` ganhou a linha `esc abas` (rodapé e `?`).

**Motivo:** Pedido do dono.

**Limite:** O `Session` montado sozinho (sem abas) não tem barra, então `esc` não faz nada nesse caso.

## 2026-10-09 — Kit de quem escreve módulos (3C)

**Status:** vigente

**Decisão:** `@pvx/testing` dá a quem escreve módulos um kit para rodar comandos e renderizar páginas com o loader real.

- **Funções do kit.** `runCommand(dir, linha, {env, secrets, confirmed})` e `renderPage(dir, página, {cols, rows})` (`module-kit.tsx`). Ambas ligam o diretório por symlink num `usermodules/` temporário (o id vem do manifest, então o nome do diretório do autor não importa), apontam `PVX_HOME` e `PVX_USERMODULES` para temporários e usam o loader real com o `ui` real; módulo que não carrega lança. As variáveis ficam setadas (um arquivo de teste por módulo). `renderPage` devolve o `TuiHarness` inteiro.
- **Resolução de `@pvx/*`** fora dos pacotes (`templates/`, `test/`): `paths` no `tsconfig.json` da raiz (o Bun os honra em runtime), em vez de `node_modules` por pacote; `templates` entrou no `include`. `bun test` na raiz já descobre `templates/**/test`.
- **Modelo** em `templates/pvx-module-template/` (id `exemplo`, sem `node_modules`); `test/templates.test.ts` carrega uma cópia dele em `usermodules/` pelo loader real sem resolução do repositório e roda o comando. O `boundary.test.ts` só varre `packages/`, então `exemplo` não precisou entrar na lista.
- **README do SDK.** Em `packages/sdk/README.md`, todo bloco logo após `<!-- test -->` é um módulo inteiro; `test/sdk-readme.test.ts` o grava num módulo temporário, carrega pelo loader e roda `tsc` (tsconfig que estende o da raiz, `types: []`). Blocos sem a marca não são verificados.
- Os módulos só importam tipos do SDK, então `EXIT` não é usável por módulo (o exemplo que o importava falhou no teste e foi corrigido).

**Motivo:** Critério de aceite da Fase 3 (exemplos executados como teste).

**Limite:** O exemplo de widget da README depende dos tipos `WidgetDef`/`SlotData`; mudança neles quebra o teste de propósito.

## 2026-10-09 — Widgets e slots da home (Fase 3B)

**Status:** vigente (o `home.notes` passou a ser desenhado na Fase 6A, ver "Módulo `notas` embutido (Fase 6A)")

**Decisão:** O `registry.slots` é um hub sem React que guarda o último dado coletado de cada widget, e um único agendador o alimenta.

- **`SlotHub`.** O registry entrega a ele os `widgets` de cada módulo. `read(slot)` devolve o último dado coletado, sem reavaliar: o host vem primeiro, depois os widgets por `priority` crescente. Listas (`chips`, `attention`, `configured`, `notes`) concatenam; `home.summary` junta as strings com ` · `. O formato é fixo: um widget que devolve outro formato é removido como quebrado.
- **Agendador.** Um só (`start(log)`, um `setTimeout` para o próximo vencimento; só o Início montado o liga): coleta tudo ao abrir e depois por `refreshMs` (piso de 1 s), agrupando os vencidos numa notificação. `r` no Início também recoleta. Timeout de 2 s por `data()` (`createRegistry({ slots: { timeoutMs, minRefreshMs } })` existe para teste).
- **Widget quebrado.** O widget que lança, estoura o tempo ou erra o formato sai do slot para sempre na sessão, vai ao `core.log` ("widget <módulo>.<nome> quebrou: ...") e aparece como linha de aviso "widget quebrou: <id>" (em chips, atenção e configurado). O logger vem do `makeLogger` do `pages` do `App` (sempre passado em `apps/pvx`).
- **Host nos slots.** O host alimenta os slots a partir do cache `TabsNav.core.conformidade` (`syncHost`, a cada render do Início; não notifica): pendências → `home.attention` (com `fix`), itens ok → `home.configured`, "X de Y" → `home.summary`. O painel conformidade mostra atenção, depois configurado (ok, em `dim`, sem `fix`). Sem perfil ou sem verificação, só entram os módulos. `enter` num item com `fix` segue gravando o rascunho do Comando.
- **`home.chips`.** Uma linha de 1 célula logo abaixo da barra, só quando há chips ou widget quebrado (sem chips o layout é o de antes); a barra continua com uma linha. A máquina não tem espaço (6 linhas úteis, todas usadas).
- **`ctx.slots.read(slot)`** em `CommandCtx` (`SlotsApi`); `prove` não o recebe. Antes de o Início abrir (ou na CLI) devolve `undefined`.
- **`home.notes`:** formato `string[]` fixo, ninguém o desenhava até a Fase 6. **`home.panel`:** adiado; o hub aceita qualquer dado, o Início não o desenha (um `render()` livre pede `sdk.ui` no slot e é de uso raro).

**Motivo:** Spec da Fase 3.

**Limite:** Quem não passa `pages` ao `App` não registra o erro no log; a CLI nunca coleta widgets, então `ctx.slots.read` lá é sempre `undefined`.

## 2026-10-09 — Aviso de movimento inválido (pendente)

**Status:** resolvida em 2026-10-09 — Aviso de movimento inválido, painéis numerados, `/` da barra e ordem das abas

**Decisão:** Quando uma tecla de navegação não tem efeito, mostrar um aviso curto e discreto ("nada aqui") que some sozinho.

- Casos: ↓ numa aba sem itens, → num comando sem args, ↑/↓ no fim da lista etc.
- Implementar como aviso único do host (um só componente, um só timer), acionado por um `nudge(msg)` que os handlers chamam quando o movimento é ilegal.
- Fazer depois que o editor de linha e a Fase 3D terminarem (mesmos arquivos).

**Motivo:** Pedido do dono.

## 2026-10-09 — Campos de texto têm cursor (substitui "os campos não têm cursor")

**Status:** vigente

**Decisão:** `tui/src/lineedit.ts` é o modelo puro `{text, cursor}` (cursor em code points), usado em todos os campos de texto.

- Teclas: `←`/`→`, `home`/`end` e `ctrl+a`/`ctrl+e`, `backspace`, `delete`, `ctrl+w`, inserção na posição.
- `←` em 0 e `→` no fim devolvem `exit: "left" | "right"` e o chamador decide.
- `LineText.tsx` desenha o bloco do cursor só com foco, máscara `●` em segredo e rolagem horizontal pela largura.
- Usado na busca da palette, nos campos do formulário (palette e menu), na entrada do Comando (e na busca `ctrl+r`) e no modal de segredo.
- **Palette.** `←` no início de um campo volta à lista, no mesmo comando (troca a regra "só com campo vazio"); `→` no fim da busca entra nos campos, como antes; `←` no início da busca não faz nada.
- **Comando.** `←`/`→` só movem; `↑`, completar (`tab`) e recuperar histórico põem o cursor no fim.
- **Menu.** `←` em 0 não faz nada (`esc` volta).
- Flags não têm cursor (`space` marca; `←` volta à lista na palette).

**Motivo:** Pedido do dono (digitar antes ou depois do texto).

**Limite:** `←→ cursor` está no rodapé do formulário e na ajuda do Comando; no rodapé do Comando não cabe em 80 colunas.

## 2026-10-09 — Fecha a Fase 3: `useKey`, moldura única, módulos embutidos e Conformidade como módulo (3D)

**Status:** substituída em parte por 2026-10-09 — Plano dentro de Conformidade, sem Diário, built-ins sem aba, relógio na barra (as abas Conformidade e Plano do item 4 e a ordem de abas saíram; `useKey`, moldura única, embutidos e o hook `useConformity` valem)

**Decisão:** A Fase 3 fecha com `ui.useKey`, uma moldura única desenhada pelo host, módulos embutidos e a Conformidade como módulo.

- **`ui.useKey(teclas, rótulo, handler)`.** A página o chama no render, então o handler enxerga o estado. O host registra em `useEffect` (`HostPage.addKey`) e remove na limpeza. A linha entra na tabela única (`addPageRow`, no escopo `page:<chave>`, junto das de `PageDef.keys`, que continuam valendo); `keymap.ts` ganhou um contador de versão (`rowsRev`/`subscribeRows`) e o rodapé e o `?` assinam, então as teclas aparecem e somem com o componente. `setPageRows` (linhas estáticas, chamado no render) não notifica de propósito: um `setState` do rodapé durante o render do `Tabs` é erro do React. Reservadas (`esc`, `?`, `ctrl+c`, `ctrl+k`) são ignoradas; tecla que lança vai ao log do módulo. A busca de tecla vai primeiro nas dinâmicas, depois nas estáticas.
- **Moldura única.** O host desenha a borda e o título `› nome`; um `Panel` na RAIZ da página (contexto `RootPanelCtx`, falso dentro de qualquer `Panel`) não desenha borda nem título. Panel dentro de Panel mantém os dois; vários `Panel` irmãos na raiz saem todos sem borda (para seções, aninhar). A moldura da página ganhou `overflow="hidden"` (a ui não tem rolagem; conteúdo longo é cortado, não vaza sobre o rodapé). Vale para páginas empilhadas e para abas.
- **Módulos embutidos.** `packages/builtin/<id>/` (manifest, entrada `.tsx` com pragma clássico, só `import type` do SDK) e a lista estática `packages/builtin/index.ts` (`builtin: BuiltinModule[]`, tipo no SDK), passada por `loadModules(registry, { builtin })`; só `apps/pvx` importa o barrel. O loader registra os embutidos antes dos usermodules, sem confiança e sem git; um usermodule com o mesmo id dá "id já registrado". `registry.official` (Set) alimenta a marca ◆ na lista de Módulos. O teste de fronteira ignora `packages/builtin` e ganhou outro: o código embutido só pode ter `import type` do SDK e imports relativos. `conformidade` NÃO entrou na lista de ids do teste de fronteira, pois também é nome de comando do núcleo e aparece no host.
- **Módulo `conformidade`** (abas Conformidade e Plano; `order` 1 e 2). As abas fixas Conformidade e Plano saíram do núcleo (`TAB_IDS` = Início, Módulos, Logs, Comando); como abas de módulo vêm depois das do núcleo, a barra ficava Início · Módulos · Logs · Comando · Conformidade · Plano. Logs segue no núcleo.
- **`ui.useConformity()`.** Devolve `{ profile?, message?, results: {level,text,fix?}[], plan: {steps, manual}, checkedAt?, running, refresh(), apply(confirm) }`. O cache é um só por sessão (`conformityOf(session)`, WeakMap em `tabs/conformity.ts`; não mexe no store da sessão): o painel de Conformidade do Início e os hooks leem o mesmo; `refresh` roda `conformidade` e `plano` juntos e grava os dois de uma vez, então `r` em qualquer lugar atualiza todos. O hook nunca avalia sozinho (a aba chama `refresh()` na primeira visita; o Início continua sem rodar sozinho). `TabsNav.core` guarda só o Logs. Para o plano sair estruturado, o JSON de `plano` ganhou o campo opcional `step` nas linhas de passo (como o `fix` do `conformidade`); texto e CLI não mudam.
- **`apply(confirm)`.** `applyPlan` do núcleo sobre uma cópia congelada dos passos; cada passo roda por `session.run`, comando comum (scrollback, histórico, log, root estrito, confirmação do host para destrutivo). Um módulo só roda comandos do próprio módulo, mas os passos são de outros módulos: por isso a exceção é só pelo `apply`, que só roda passos do plano vigente. A TUI NÃO usa `plano apply --yes` (ele não confirma passo a passo); a CLI `plano apply` fica como está. `y` aplica, `s` pula, `n` para (as teclas só existem enquanto pergunta); a tela mostra a cópia congelada, então `r` no meio da aplicação não muda a lista; ao fim ela atualiza o cache.
- **SDK.** `Component<P>` aceita `key` (listas de elementos).

**Motivo:** Pedido do dono (fechar a Fase 3).

**Limite:** A ordem das abas mudava (Conformidade e Plano depois de Comando); se incomodasse, uma `order` negativa ou "antes do Comando" era decisão do dono. O fluxo do `apply` mostra um passo opt-in com a marca e pede o `y` como qualquer outro.

## 2026-10-09 — Aviso de movimento inválido, painéis numerados, `/` da barra e ordem das abas

**Status:** vigente (a regra de ordem vale; o exemplo de abas mudou: Conformidade e Plano deixaram de ser abas e o Ajustes entrou no fim, ver "Plano dentro de Conformidade…" e "Ajustes: temas e editor de tema")

**Decisão:** Um aviso único do host cobre os movimentos inválidos, os painéis do Início são numerados, `/` abre o Comando a partir da barra, e a ordem das abas é regra do host.

- **Aviso (fecha "Aviso de movimento inválido (pendente)").** `tui/src/nudge.tsx`: `NudgeProvider` (no `App`) guarda a mensagem e UM timer de 1,5 s; `useNudge()(msg)` é o gancho dos handlers (sem provider é no-op; padrão "nada aqui"). O texto sai à direita da linha do rodapé (`NudgeText` em `Footer`, `warn`, sem mexer no layout; o rodapé tem `overflow="hidden"`).
- **Onde o aviso está ligado.** `↓`/`enter` da barra em aba sem item ("nada aqui"); `ItemList` (menu, Módulos), lista da palette e campos da palette, painéis do Início: `↑`/`↓` nos extremos ("início da lista", "fim da lista", "nada aqui" se vazia), exceto `↑` no topo que vai à barra; `←`/`→` do Início sem painel naquela direção; `→` sem args na palette ("sem argumentos", substitui o `setMsg` antigo); `←` em 0 na busca da palette, no formulário do menu e na entrada do Comando.
- **Onde não há aviso.** Blocos (`↑` no primeiro vai à barra, `↓` no último vai à entrada), digitação, `→` no fim da linha, modal de segredo, `←` no primeiro campo da palette (volta à lista).
- **Painéis numerados.** Início: título `› 1 conformidade`, `› 2 atividade`; o número é o índice em `PANELS` (a ordem de `←`/`→`); máquina não tem número. `1`/`2` pulam para o painel (linha `1-2 vai ao painel` no escopo `home`, só na ajuda).
- **`/` da barra.** `/` com a barra de abas focada abre o Comando (linha `/ comando` no escopo `tabs`, só na ajuda).
- **Ordem das abas.** `LEAD_TABS` (Início, Módulos) · abas de módulo · `TRAIL_TABS` em `tabs/context.ts`; é regra do host, sem citar módulo. Na época: `Início · Módulos · Conformidade · Plano · <outros módulos> · Logs · Comando`. Hoje `TRAIL_TABS` = Logs, Comando, Ajustes. Substitui a ordem da entrada "Fecha a Fase 3" (Conformidade e Plano depois de Comando) e a frase "depois das do núcleo" de "SDK de UI".
- **Verificação de `/` e `ctrl+k` em pty real** (tmux, `PVX_HOME` temporário, `PVX_USERMODULES` das fixtures, teclas uma a uma): ambos abrem Comando e a palette a partir do Início recém aberto; não há regressão do editor de linha nem das abas. O que falhava era o foco: com a barra de abas focada (após `tab`, `esc` ou troca de aba) `/` não fazia nada, porque só os conteúdos das abas o tratavam; isso explica o script anterior. `ctrl+k` é o `C-k` do tmux e funcionou em todos os focos testados.
- **Modelo de `/`.** Vai ao Comando da barra, do menu, do Início e de blocos focados (digita `/` na entrada); é texto em campos de texto (entrada do Comando, formulários, busca da palette). Teste de regressão: `/` da barra em `nudge.test.tsx`.

**Motivo:** Pedido do dono.

**Limite:** O aviso não é por tela: uma mensagem nova substitui a atual e reinicia o timer.

## 2026-10-09 — Catálogo de módulos (questão em aberto 6)

**Status:** substituída em parte por 2026-10-13 — Confiança sempre e módulos do catálogo confiados sempre (a confiança por commit deixou de ser obrigatória para o catálogo, e `enter` no catálogo não abre mais a revisão)

**Decisão:** O catálogo é um JSON servido por um endpoint próprio da Phonevox, com cache local e cópia embutida como reserva.

- Formato: `[{id, url, descricao, versao?}]`.
- URL padrão `https://registry.phonevox.com.br/pvx/catalog.json`, sobrescrita por `PVX_CATALOG_URL`.
- Só módulos Phonevox (◆).
- Cache em `PVX_HOME` com TTL 6 h, silencioso em falha de rede, mais uma cópia embutida no binário como reserva offline.
- TUI: seção "Catálogo" na aba Módulos (na época, `enter` → revisão de confiança).
- CLI: `modules search [termo]` e `modules add <nome>`, que resolve pelo catálogo.
- O catálogo só aponta URLs. Na época, a confiança por commit continuava obrigatória; hoje os módulos do catálogo são confiados sempre.
- Terceiros seguem instaláveis por `modules add <url>`.

**Motivo:** Técnicos não devem decorar nomes/URLs.

## 2026-10-09 — Catálogo: núcleo e `pvx modules search` (Fase 4)

**Status:** vigente

**Decisão:** O núcleo carrega o catálogo por `loadCatalog` com validação estrita, e `pvx modules search` o consulta sem root.

- **`loadCatalog`.** `packages/core/src/catalog/index.ts`: `loadCatalog({fetchImpl?, now?, warn?})` → `{modules, source, fetchedAt?}` com `source` = `rede | cache | cache antigo | embutido`. Ordem: cache fresco (< 6 h, sem rede) → rede (2 s, falha silenciosa; grava `PVX_HOME/catalog.json` se puder) → cache antigo → `embedded.json` (import estático; vem VAZIO: não conhecemos os módulos reais, sem URLs inventadas).
- **URL.** `PVX_CATALOG_URL` ou `DEFAULT_CATALOG_URL` = `https://registry.phonevox.com.br/pvx/catalog.json` (corrigido em 2026-10-13: esta entrada citava o placeholder `https://pvx.phonevox.com.br/catalog.json`).
- **Validação estrita.** Em `parseCatalog`: id `^[a-z0-9-]+$`, url https, `ssh://` ou scp (`git@host:path`), `descricao` string, id único; entrada inválida é descartada com aviso no log `core` (nunca lança; formato geral inválido vira lista vazia).
- **`searchCatalog`.** Prefixo do id, prefixo da descrição, contém no id, contém na descrição; empate mantém a ordem do catálogo.
- **`resolveModuleRef(ref)`.** URL passa como está; senão busca o id e devolve a URL; id ausente lança erro em pt-BR com até 5 parecidos.
- **Dois caches.** O cache do catálogo NÃO é o cache dos avisos de atualização: aquele é invalidado em `add`/`update`/`remove`; este só expira por TTL e `modules add` não o invalida. Por isso não há `invalidateCatalog()`.
- **`pvx modules search [termo] [--json]`** (`search-command.ts`, `catalogSearchCommand`): só leitura, sem root; marca `✓` se `usermodules/<id>` existe e termina com a linha `fonte: ...`. Com `--json`, o `Output` só carrega linhas, então a saída é UMA linha `plain` cujo texto é o JSON `{source, fetchedAt, modules:[{id,url,descricao,versao?,installed}]}` dentro do envelope normal `{ok, exit, lines}`.

**Motivo:** Decisão "Catálogo de módulos".

**Limite:** Sem `PVX_HOME` gravável o cache simplesmente não é salvo (cada execução busca na rede); falha de rede sem cache cai no embutido vazio.

## 2026-10-09 — Grupo de comandos `modules` (plural), nunca `module`

**Status:** vigente

**Decisão:** O grupo de comandos é `modules`, sempre no plural.

- `pvx modules` sem subcomando lista (como antes); `modules list` é alias.
- Subcomandos: `add`, `list`, `remove`, `enable`, `disable`, `trust`, `search` (e, na 4B, `update` e `link`).
- A forma `module` no singular não existe no código, na ajuda, nas mensagens nem nos testes.
- A revisão manda "rode `pvx modules trust <id> --sha <sha>`".

**Motivo:** Pedido do dono.

## 2026-10-09 — Módulos git e confiança por commit (Fase 4A)

**Status:** substituída em parte por 2026-10-09 — Fase 4B: sem desvio de confiança, update, link, permissões, cache de avisos (o item 8, o desvio por `PVX_USERMODULES`, foi revertido) e por 2026-10-13 — Confiança sempre e módulos do catálogo confiados sempre (a aprovação deixou de ser sempre por commit)

**Decisão:** Módulos vêm de repositórios git e só são importados depois de o técnico aprovar o commit exato.

- **Arquivos.** Em `core/src/modules/`: `git.ts` (Bun.spawn, `GIT_TERMINAL_PROMPT=0`, `GIT_SSH_COMMAND=ssh -o BatchMode=yes`, timeout 15 s local e 120 s rede, `core.hooksPath=/dev/null` em toda chamada e gravado no clone, `protocol.ext` e `protocol.file` fechados salvo `allowFile`, URL com credenciais ou iniciada por `-` recusada), `trust.ts` (`trust.json`, escrita atômica por arquivo temporário e rename; sem trava, dois aprovadores simultâneos podem perder um), `analyze.ts` (aviso estático, não garantia) e `index.ts` (`addModule`, `reviewModule`, `trustModule`, `revokeTrust`, `removeModule`, `setEnabled`, `listModules`, `trustGate`, `audit`).
- **Estado calculado só do disco.** Desativado (`modules.json`), dev (symlink), aguardando-confianca (sem aprovação, HEAD diferente do aprovado ou diretório que não é raiz de repositório git), modificado (HEAD aprovado, árvore suja), carregado; `erro` vem do registry; `atras` só com dados já buscados (`rev-list HEAD...@{u}`), nunca faz fetch na carga.
- **`canImport` falso** agora pula o módulo em silêncio (antes virava erro "importação não permitida"): o estado aparece em `modules list`, e erros de carga continuam contando só falhas reais. Diretórios que começam com `.` são ignorados pelo loader (clone em andamento).
- **`add`** clona em `usermodules/.add-*`, lê o manifest sem importar, checa conflito (id no registry, diretório existente, comando do núcleo, comandos contribuídos) antes de mover para `usermodules/<id>`; qualquer falha apaga o clone. Idempotente pela URL de origem. `--trust` aceita sha completo ou prefixo de 7+ e precisa bater com o HEAD.
- **Auditoria.** Aprovar, revogar, remover, ativar e desativar passam por `audit()` (core.log); a Fase 6 troca o corpo dessa função pelo diário.
- **`--json`** de `modules`/`modules list`: cada linha ganha `module` (a linha do módulo com `state`).
- **`CliIO.allowFile`** (só testes) libera `file://` em `modules add`; o ponto de entrada nunca o liga.
- **Desvio de `PVX_USERMODULES` (revertido na 4B).** `apps/pvx` ligava `trustGate` ao loader, EXCETO quando `PVX_USERMODULES` estava definido: a variável era o desvio de desenvolvedor do diretório (e o que os testes da CLI usavam), e as fixtures não são repositórios git. Registry carregado nunca mostra "aguardando" para um diretório não git.

**Motivo:** Spec da Fase 4 e riscos 4, 5 e 10.

**Limite:** A análise estática é por regex linha a linha; o módulo continua sem sandbox.

## 2026-10-09 — Fase 4B: sem desvio de confiança, update, link, permissões, cache de avisos

**Status:** substituída em parte por 2026-10-13 — Confiança sempre e módulos do catálogo confiados sempre (o item 3, "só avança com `--trust`", ganhou a exceção da confiança sempre); as pendências da 4C foram resolvidas na Fase 4C

**Decisão:** A confiança por commit não tem desvio por variável de ambiente, e a 4B acrescenta `update`, `link`, permissões declarativas e o cache de avisos.

- **Desvio removido.** `apps/pvx` sempre liga `trustGate`; `PVX_USERMODULES` só muda o diretório (reverte o item 8 da 4A). Embutidos continuam fora do gate (código do pvx). Testes de subprocesso usam `useFixtureModules(ids)` (`@pvx/testing`): cada fixture vira um `modules link` num `usermodules/` temporário do `PVX_HOME` do teste. Teste de regressão em `test/cli.test.ts`: módulo git não aprovado sob `PVX_USERMODULES` não é importado (marcador), e com aprovação é (controle).
- **Dev só por `modules link`.** `PVX_HOME/modules.json` ganhou `dev: [{id, path}]` (junto de `disabled`; as escritas preservam o outro campo). Symlink só é `dev` se registrado e se o `realpath` ainda é o registrado; senão estado `aguardando-confianca` com erro "symlink não registrado; use pvx modules link" e nada é importado. `remove` apaga só o link e o registro.
- **`modules update [id|--all] [--trust sha]`.** `checkUpdates(id)` faz fetch e devolve commits (sha + assunto), `behind`, `remoteSha`, `diverged`, `dirty` e a diferença de permissões contra o manifest APROVADO (adicionadas em aviso, removidas em info). `updateModule(id, {trust})` só mexe na árvore com `--trust` igual ao sha buscado do remoto, e avança com `git merge --ff-only <sha>` em vez de `git pull --ff-only`: o `pull` buscaria de novo e poderia passar do commit aprovado. Depois aprova o novo sha e audita. Sem `--trust`: fica no commit aprovado (`atras`, `behind: n`, pela refs já buscadas). Sem novidade: "já está atualizado", exit 0, nada refeito. Histórico divergido, árvore suja, manifest novo ilegível ou com outro id, `--trust` errado: recusa, exit 1. `--all` não aceita `--trust`. Módulo sem upstream (`--ref` fixo) ou dev: erro claro.
- **`modules link <path>`** (`linkModule`): symlink `usermodules/<id do manifest>`, registro em `modules.json`, aviso de que não há confiança por commit, idempotente.
- **Recarga.** `reloadModule(registry, id, loadOpts)` (só dev registrado) pré-valida o grafo com `Bun.build` em memória, apaga do `require.cache` tudo sob o `realpath`, reimporta e troca o módulo de forma atômica (`registry.register(..., {replace: true})`, que valida conflitos ignorando o próprio módulo; `SlotHub.remove`). Em erro, a versão antiga segue registrada. A pré-validação existe porque o Bun mantém para sempre como "com erro" um arquivo cujo import falhou (sintaxe ou import ausente; também erro de avaliação), mesmo depois de corrigir e apagar do cache: sem ela, um erro de digitação travaria o módulo até reiniciar. Erro lançado na AVALIAÇÃO (topo do arquivo, não na fábrica) que passa na pré-validação ainda trava o arquivo até reiniciar o pvx; documentado.
- **Observação de arquivos.** `watchDevModules(registry, onEvent, opts)`: `fs.watch` recursivo (ignora `.git` e `node_modules`) com debounce; se falhar, poll de 500 ms em contagem + mtime mais novo; revarre os links a cada 1 s para pegar links feitos depois. A TUI (`apps/pvx/src/tui.tsx`) o liga e empurra cada evento como bloco no scrollback via `store.notice(...)` (novo, sintético, sem histórico); erro vira bloco `error`. Sem `dispose`: timers e listeners da versão antiga sobrevivem à recarga.
- **Permissões declarativas** (`engine/permissions.ts`, ligado em `execute`):
  - `ctx.exec`: nome base em `permissions.exec`; `Bun.spawn` sem shell, `SIGKILL` em 30 s por padrão.
  - `ctx.net.fetch`: `host[:porta]` exato em `permissions.net`, só http(s), `redirect: "manual"` sempre.
  - `ctx.fs.read/write/exists/list`: prefixo de `permissions.fs` sobre o `realpath`, então `..` e symlinks não escapam; `rw:` libera escrita; o `state` do próprio módulo é sempre rw.
  - Violação lança "permissão negada..." e grava em `log` do módulo e em `core.log`.
  - Tipos aditivos no SDK v1 (`NetInit`/`NetResponse` próprios: o SDK não carrega tipos DOM). Não é sandbox: seção "Segurança" em `packages/sdk/README.md`.
- **Cache de avisos.** `PVX_HOME/update-check.json` `{at, pending}`, TTL 6 h; `pendingUpdates()` (só a TUI chama) busca todos os módulos git em paralelo com limite de 2 s, silencioso em falha (cai no que já foi buscado), e grava. `invalidateUpdateCache()` roda em todo `add`, `update` (inclusive o fetch do `checkUpdates`) e `remove`.
- **`modules/common.ts`** reúne `audit`, `Result`, `modules.json` e o cache para evitar import circular entre `index`, `dev` e `update`.

**Motivo:** `PVX_USERMODULES` é variável de produção e `sudo -E` a repassa: um desvio nela anularia a confiança por commit. O resto é a Fase 4 da spec.

**Limite:** Pendente para a 4C (resolvido na Fase 4C): tela de revisão da TUI (usa `checkUpdates`/`updateModule`), estados e seção de catálogo na aba Módulos, exibir `pendingUpdates()` na TUI, notificar a UI quando a recarga troca páginas e widgets (então o registry mudava, a UI só lia no próximo render).

## 2026-10-09 — Palette: núcleo, comandos de módulo e páginas na mesma lista

**Status:** vigente

**Decisão:** Sem prefixo, a busca da palette indexa comandos do núcleo, comandos de módulo e páginas/abas na mesma lista.

- **Grupos.** Os comandos do `CORE` (grupo "núcleo", marca `g.core` ■/`=`, cor `info`), os comandos de módulo e as páginas/abas (marca `g.page` §/`#`, cor `dim`); o grupo núcleo vem primeiro. `CORE` passou a ser exportado por `@pvx/core`.
- **Escopos.** `>` núcleo + módulos, `#` só páginas, `@mod` comandos e páginas do módulo (`@nucleo`/`@núcleo` = núcleo; a busca ignora acento), `!` só destrutivos.
- **Consulta vazia.** Favoritos, recentes (agora também de comandos do núcleo), grupos; nunca vazia.
- **Regra de execução do núcleo.** Todo `CoreCommand` expõe `args` (ArgSpec) ou nenhum; o formulário usa os `args` do `Hit`, então `logs`, `modules add` etc. abrem o formulário e sem `args` (`version`, `plano`) rodam direto. Tudo vai por `session.run(linha)`, o mesmo caminho do menu e do Comando (bloco, histórico, regra de root). Por isso não há rascunho no Comando.
- **Página.** `enter` numa página com `tab` pede a troca de aba (`requestTab`/`onTabRequest` em `tabs/context.ts`; a palette fica fora do `Tabs`, então é um emissor de módulo que o `Tabs` ouve); sem `Tabs` montado, ou página sem aba, vai por `session.run("#chave")` e empilha a tela.

**Motivo:** Bug do dono (servidor novo só com `conformidade`: "nada encontrado" para tudo).

**Limite:** Se uma tela estiver empilhada sobre o `Tabs`, a troca de aba acontece por baixo dela.

## 2026-10-09 — Módulos na TUI: gerenciador, catálogo, revisão e registry vivo (Fase 4C)

**Status:** substituída em parte por 2026-10-13 — Revisão de confiança redesenhada e por 2026-10-13 — Confiança sempre e módulos do catálogo confiados sempre (do item 5, `enter` no catálogo abre a revisão, e do item 6, a tela de revisão com `s` mostrando arquivo ou `git diff`, valem só no modo atualização; o item 3 ganhou a tecla `T`)

**Decisão:** A TUI gerencia módulos pelo mesmo caminho da CLI, sobre um registry vivo que a UI assina.

- **Registry vivo.** `Registry` ganhou `rev`, `subscribe`, `changed()` e `unregister(id)`; `register`, `addError`, `unregister` e a recarga dev notificam; `SlotHub.remove` também (o Início perde os widgets). A UI assina por `useRegistryRev` (abas de módulo, palette, lista de Módulos). `reconcileModule(registry, id, loadOpts)` (core, `modules/live.ts`) leva o registry ao estado do disco sem reiniciar: `unregister`, evicta o cache e reimporta pelo MESMO `trustGate`, então nada não aprovado é importado; falha de import vira erro do registry; embutidos nunca são tocados. Fica um intervalo curto em que o módulo some do registry durante a reimportação.
- **Linha de módulo.** `id`, marca de origem depois do id (◆ embutido, ◇ usermodule, ↯ dev; fica depois do id para não mudar o teste `conformidade ◆`), `ref@sha`, `↓n`, `✎n`, versão, estado (carregado, aguardando confiança, desativado, erro, modificado, atrás, dev) colorido por `Item.cells`; `Item.help` continua sendo a concatenação. As linhas vêm do registry (primeiro quadro, síncrono) e são enriquecidas por `listModules` assíncrono (`useModuleRows`). Só módulo carregado abre os comandos com `enter`; aguardando confiança abre a revisão.
- **Teclas** na lista de Módulos, na tabela única, com escopos que seguem a linha sob o cursor: `modules` (`u` atualiza, `d` liga/desliga, `x` remove, `l` log, `c` catálogo), `modwait` (`t` confia, `enter` revisa), `catalog`, `review`, `files`. Embutidos recusam `u/d/x/t` ("embutido no pvx"). Os testes de rodapé e ajuda do Módulos passaram de `menu` para `modules` e o título aceita o sufixo ` · c catálogo`.
- **Ações pelo mesmo caminho da CLI.** `store.act(linha, fn, {confirm})` roda uma mutação do host como bloco (scrollback), com a regra de root estrita e a confirmação do host (`x`); a linha do bloco é a da CLI (`modules remove x`). `fn` chama as funções do núcleo que a CLI chama (`addModule`, `trustModule`, `updateModule`, `setEnabled`, `removeModule`, todas auditadas) e depois `reloadAndReport`, que gera o bloco `[✓] id versão carregado · N comandos`. Sem root: bloco "rode com sudo"; ver continua livre.
- **Catálogo.** Sub-visão alternada por `c` na própria aba (título `catálogo · fonte: rede · HH:MM`), só módulos não instalados; `enter` roda o add (clone, nada importado) e abre a revisão; catálogo vazio diz "catálogo vazio · fonte: …".
- **Tela de revisão** (`modules/Review.tsx`, empilhada): origem, commit, módulo, compatibilidade, contribui, conflitos, permissões, análise estática e o aviso de root; `t` aprova e carrega, `s` lista os arquivos (`git ls-files`) e mostra um somente leitura (recusa symlink que sai do módulo, corta em 256 KB), `p` só permissões, `esc` cancela. No modo atualização (`u` com commits novos) a mesma tela mostra os commits, as permissões ADICIONADAS em aviso e, em `s`, o `git diff HEAD <novo>`; `t` roda `updateModule --trust`.
- **Aviso de atualização.** `Tabs` recebe `modules` (só o host interativo passa) e chama `pendingUpdates()` em segundo plano ao montar e a cada mudança do registry; `↓n` (n = módulos atrás) no rótulo da aba e nas linhas. O núcleo já invalida o cache em add/update/remove.
- **Montagem.** `apps/pvx/src/tui.tsx` monta `modules = {load: {…, canImport: trustGate}, reserved}`; os testes injetam `catalog`, `pending` e `allowFile`.

**Motivo:** Fase 4C.

**Limite:** Módulo que lança ao ser AVALIADO continua travado até reiniciar (caveat da 4B); o botão de rodapé `d ativa` serve para desativar e ativar (80 colunas não comportam dois rótulos); a revisão não mostra o manifest novo na atualização, só o diff de permissões.

## 2026-10-09 — Fase 6: questões em aberto 2 e 5 (recomendação adotada)

**Status:** vigente

**Decisão:** A auditoria registra comandos destrutivos e logins por padrão, e as notas ficam num arquivo só de acréscimo.

- **Q2 auditoria.** `audit.jsonl` registra comandos destrutivos e logins por padrão; `PVX_AUDIT=all` registra tudo. Segredos sempre mascarados.
- **Q5 notas.** `PVX_HOME/notes.jsonl`, só acréscimo, dono root, legível por todos (0644); autor = `SUDO_USER`, reserva `LOGNAME`.
- **Formato de evento de nota** (contrato entre o módulo notas e o diário): uma linha JSON `{v:1, id, at (ISO), ev: "add"|"edit"|"pin"|"unpin"|"resolve", author, text?, tags?: string[], login?: boolean, ref?: string}`; `id` estável da nota (gerado no add); o estado é a dobra dos eventos por id.

**Motivo:** Recomendação adotada para as questões 2 e 5 da Fase 6.

## 2026-10-09 — Fase 6B: audit log, deriva, ignorar e diário

**Status:** substituída em parte por 2026-10-09 — Plano dentro de Conformidade, sem Diário, built-ins sem aba, relógio na barra (o diário, a aba Diário e as "Novidades" dos itens 4, 5 e 7 saíram; audit, deriva, ignorar e visto valem)

**Decisão:** O host grava um audit log e a deriva de conformidade, e a Fase 6B acrescentou o comando `conformidade ignorar` e o diário.

- **Audit** (`core/src/diary/`, hoje `core/src/journal/`): `audit.jsonl` com `{v:1, at, kind: "cmd"|"login"|"module", user, ...}`; `cmd` = `{line, exit, ms, destructive}`, `login` = `{from?}`, `module` = `{text}`.
- **Pontos de gravação.** O host grava em DOIS pontos: `execute()` (todo comando de módulo, CLI e TUI) e o ramo do núcleo em `runCli` (`mutation` = o comando tem `root: true`, ou seja, escreve em PVX_HOME: `modules add/remove/trust/update...`, `plano apply`, `conformidade ignorar`), mais `store.act` da TUI (as ações de Módulos, só se rodaram).
- **Padrão de gravação.** Destrutivo ou mutação do núcleo; `PVX_AUDIT=all` grava tudo (inclusive leituras do núcleo).
- **Segredo.** `parseArgs` já recusa segredo em argv (vem de stdin, env ou prompt), então a linha é mascarada por construção; teste com `PVX_SECRET_TOKEN`. Comando destrutivo recusado (sem `--yes`) não rodou e não é gravado.
- **Arquivo.** Uma escrita `appendFileSync` por evento, rotação em 5 MB com 3 backups (`audit.jsonl.1..3`); falha de escrita (sem root) é engolida.
- **Fontes distintas.** `audit()` de `modules/*` continua no `core.log` e agora também grava `kind: "module"`. Um `modules add` pela CLI gera uma entrada `cmd` e uma `module`: são fontes diferentes do diário. `auditLogin(user, from?)` exportado para o banner (6C).
- **Deriva.** `conformity.jsonl` `{v:1, at, id, from, to, text}` e `conformity-last.json` `{id: nível}`. `recordDrift` roda em toda avaliação (`profileResults`: CLI `conformidade`/`plano` e o refresh da TUI, que roda os dois). A primeira vez que uma capacidade aparece só grava o nível-base, sem evento (senão a primeira avaliação inunda o diário). Sem root a escrita falha em silêncio. `driftOf(id)` devolve o último evento com `worse` e `label` ("piorou hoje 09:02"). NÃO ligado ao detalhe do módulo `conformidade`: pediria campo novo no SDK (`ConformityResult`), que o outro agente está mexendo; só a API.
- **Ignorar.** `conformidade ignorar <capacidade> --motivo T` (root); `ignores.json` `[{id, until, reason, author}]`, 24 h, relógio injetável (`activeIgnores(now)`, `addIgnore(id, reason, now, author)`). A nota vem de `nota add --tag ignorado --ref cap:<id> <motivo>` por `execute` no registry; sem o módulo, ou se ele falha, avisa e o motivo fica só no `ignores.json`. `conformidade` mostra o item como linha `info` com `ignored` (ISO) e "(ignorado até HH:MM)", sem `fix`; fora do `--strict` e da contagem; `plano` e `plano apply` tiram o item dos passos e listam "ignorado até HH:MM: título". No Início o item aparece depois dos ok, com `○`, fora de "atenção" (`parseConformity.ignored`); na aba Conformidade vira aviso sem fix (o tipo do SDK não tem nível "ignorado").
- **Diário (removido depois).** `diary.query({since, kinds, text, user, limit})` devolvia do mais novo para o mais velho. `since` aceita ms, Date, ISO ou `24h`/`7d`/`30m`. Cada fonte era lida do FIM em blocos de 64 KB e parava no primeiro evento mais velho que `since` (ou em `limit`, 500), atravessando os backups rotacionados; sem offsets guardados (o arquivo é só acréscimo, então ler de trás para a frente já é incremental). `notes.jsonl` era lido pelo esquema da decisão da Q5; evento sem texto (`pin`, `resolve`) mostrava "fixou a nota" etc. Entrada: `{id, kind, at, user?, text, ref, data}`; `ref` é o que `nota add --ref` recebe: `nota:<id da nota>`, `cap:<id>` (conf) ou `<kind>:<at>`.
- **Visto.** `seen/<usuário>.json` `{at: ISO}` (lê também número); `markSeen(user)` grava o mesmo formato, melhor esforço. "Novidades" = entradas depois do marcador feitas por outra pessoa (`conf` não tem usuário, então conta); usuário que nunca visitou não tem novidades. A TUI congelava o marcador na criação do `TabsNav` (o widget de notas move o arquivo ao abrir o Início, antes do diário), e a aba chamava `markSeen` ao abrir.
- **`diario [--desde] [--tipo a,b] [--busca]`** (removido depois; sem root, só leitura, não marcava visto): uma linha `plain` por entrada; no `--json` cada linha levava `entry`.
- **Aba Diário (removida depois).** `TRAIL_TABS` = Diário · Logs · Comando; escopo de rodapé `diario`. Chips (←/→), lista por dia, detalhe por tipo (ao lado a partir de 100 colunas, embaixo com 8 linhas abaixo disso). `n` punha `nota add --ref <ref> ` no rascunho do Comando, `r` punha a linha do `cmd` no rascunho, `p` ia à aba `page:conformidade.plano` (único lugar onde o host citava esse id, por pedido da spec; sem a aba avisava "sem aba Plano"), `u` recarregava. A lista era recarregada ao abrir a aba e por `u` (leitura limitada de 300 por fonte), sem timer. Sem busca `/` (a barra de chips não tinha campo; `--busca` na CLI): `/` continuava indo ao Comando. Os testes de ordem das abas ganharam o Diário.

**Motivo:** Fase 6B.

**Limite:** O `driftOf` não aparece ainda no detalhe do módulo `conformidade`; `n` não abria o composer do módulo notas (o rascunho do Comando era o caminho simples pedido); uma escrita concorrente de dois `recordDrift` pode perder um evento (arquivo de último nível sem trava, como `trust.json`).

## 2026-10-09 — Módulo `notas` embutido (Fase 6A)

**Status:** substituída em parte por 2026-10-09 — Fase 6C: banner de login, gancho `motd` e papéis (o `NOTES` do item 6 saiu, trocado por papéis) e por 2026-10-09 — Plano dentro de Conformidade, sem Diário, built-ins sem aba, relógio na barra (o módulo não tem mais aba, item 7; o resto vale)

**Decisão:** O módulo embutido `nota` guarda notas num arquivo só de acréscimo, com permissão de arquivo declarada no manifest.

- **Id `nota`, consultas `notas.*`.** O comando de um módulo é `<id> <chave>`, e a spec pede `pvx nota add`; por isso o id do manifest é `nota` (diretório `packages/builtin/notas/`, página `nota.notas`; a aba "Notas" deixou de existir depois). As consultas seguem o nome da spec e do contrato com o diário: `notas.since(iso)` (eventos com `at` depois do instante, texto limpo), `notas.state()` (a dobra), e ainda `notas.markSeen()` (move o marcador do usuário; para o diário), `notas.view()` (a página) e `notas.compose()` (a home pede o composer).
- **Armazenamento** conforme o contrato da entrada "Fase 6: questões em aberto 2 e 5": `notes.jsonl` só acréscimo, 0644, um evento por linha, UMA chamada de escrita `O_APPEND` por evento (`nota add --fixar` são dois eventos: `add` e `pin`). Limite de 8 KB em bytes do texto. Controle e ANSI saem na gravação e na exibição (`clean` em `notes.ts`; `\n` fica). Linha inválida é pulada na leitura. Id: 6 hex aleatórios, sem repetir; `fixar`/`editar`... aceitam prefixo único.
- **Capacidade de arquivo (opção A, aditiva).** Manifest `permissions.fs: ["rw:$PVX_HOME/notes.jsonl", "rw:$PVX_HOME/seen/", "rw:$PVX_HOME/people.json"]`; o host expande `$PVX_HOME` nas permissões e nos caminhos de `ctx.fs` (a cada checagem, então `PVX_HOME` de teste vale). `ModuleFs.append` (SDK e `permissions.ts`) com `O_APPEND` e modo 0644. `Sdk.fs`: o mesmo `fs` ligado às permissões do manifest, para consulta e widget, que não têm `ctx` (loader: `sdkFor`).
- **SDK aditivo.** `CommandDef.readonly` (a regra de root estrita de `requiresRoot` o ignora, na CLI e na TUI; só `nota list` o usa), `ArgSpec.stdin` (posicional de texto livre; a CLI só lê a entrada padrão quando não há TTY, a TUI passa o texto por `session.run(linha, {stdin})`; as palavras que sobram entram no texto) e `ArgSpec.repeat` (`--tag` repetida chega separada por vírgula); `ui.Fields`, `ui.useViewport()`, `List` com `mark` e `useCommand(linha).run({args, stdin})` (o host cita os argumentos). `matchKey` aceita `↑` e `↓`.
- **Autor e "novas".** `SUDO_USER`, reserva `LOGNAME`, reserva "desconhecido"; apelido de `people.json` só na exibição (`--apelido` em `nota add` o grava). Marcador `seen/<usuário>.json` `{at}`; nova = evento de OUTRO autor depois de `at` (sem marcador, tudo de outros). O widget de Início move o marcador a cada coleta mas guarda na memória o valor de quando o Início abriu (renovado se a coleta anterior passou de 25 s), então o que era novo continua marcado durante a visita; a página Notas lê esse mesmo valor. `nota list` filtra pelo marcador e depois o move. Quem não pode gravar `PVX_HOME` (sem root) mantém o marcador antigo, em silêncio.
- **Home.** `home.notes` (`string[]`): "N novas" e uma linha `autor: texto` por nota fixada. O painel "notas" só existe com dado no slot, é o 3º painel numerado (`3`, `←→`, `enter` abre a aba) e tem altura de até 3 linhas, no fim, nas duas disposições. `n` no Início chamava `notas.compose` e ia à aba: era o ÚNICO ponto em que o host nomeava o módulo (`NOTES` em `HomeTab.tsx`; trocado por papéis na 6C).
- **Página Notas** (na época, aba depois de Plano, `order: 3`): lista nova primeiro, `f` troca o filtro (todas, fixadas, novas, minhas, #tags), `p` fixa/solta, `x` resolve (sem confirmação: o evento fica no arquivo), `e` edita, `n` nova.
- **Composer** = `ui.Fields` (texto multilinha com `<textarea>`, tags, nome exibido, "fixar na home", "mostrar no login") e o aviso "nunca cole senhas ou tokens"; salvar roda `nota add --tag ... --fixar` por `useCommand` com o texto em stdin, então a linha do scrollback e do histórico não leva o texto. Falha (ex.: sem root) mantém o composer com o texto. `Fields` é dono do teclado enquanto montado (`tab` troca de campo, `ctrl+s` envia, `esc` cancela) e se registra um commit depois da montagem para ficar na frente da página e da barra de abas.

**Motivo:** Fase 6, notas.

**Limite:** O estado do marcador é do processo (um técnico por processo); resolver não tem "reabrir"; `nota list --json` é o envelope normal do host (uma linha de texto por nota).

## 2026-10-09 — Fase 6C: banner de login, gancho `motd` e papéis (o host não cita módulo)

**Status:** vigente

**Decisão:** O banner de login é um comando do núcleo que só lê dados já gravados, o gancho de login é do módulo embutido `motd`, e o host não cita módulos pelo nome.

- **Divisão.** `pvx banner` é comando do núcleo (`cli/banner.ts`, sem root, só leitura): junta dados que o host já tem e imprime texto puro. O módulo embutido `motd` (`packages/builtin/motd/`) é dono do gancho: `motd install-hook` / `motd remove-hook` gravam e apagam `pvx-banner.sh` por sua permissão `fs` (`rw:$PVX_PROFILED_DIR/`). O host expande `$PVX_PROFILED_DIR` (padrão `/etc/profile.d`; `PVX_PROFILED_DIR` o move, e é o que os testes usam: nada toca o `/etc` real). `ModuleFs.remove` entrou no SDK (aditivo, exige `rw:`). O host não nomeia `motd`: ele só roda `pvx banner` no script que o módulo escreve.
- **Script.** `sh` POSIX: só com `[ -t 1 ]`, `PVX_QUIET=1` silencia, exige `pvx` no PATH, chama `timeout 1 pvx banner`; sem `timeout` (macOS, alguns Linux) usa um subshell com kill em 1 s (`<&0` mantém o terminal como stdin; subshell evita as linhas `[1] pid` do controle de jobs). Todo caminho termina em `|| true` e o script em `true`: nunca bloqueia nem falha o login. Com `PVX_QUIET=1` o `pvx` nem roda, então o `login` também não é gravado.
- **Dados, sem avaliar.** `conformity-last.json` só guarda níveis (`{id: nível}`), sem texto, `fix` nem hora; por isso `profileResults` passou a gravar também `conformity-snapshot.json` `{at, profile, results:[{id, level, text, fix?}]}` (`recordSnapshot`/`readSnapshot`, melhor esforço como o resto). O banner lê só ele: "X/Y" = ok sobre o total sem ignorados, idade em "há N min/h/d", até 5 pendências (`[✗]`/`[!]` e `→ fix`, mais "+N pendências"). Sem snapshot, a seção some. Pendência ignorada (`ignores.json`) não conta.
- **Notas no banner.** Pela consulta do papel `notesState` (abaixo); fixadas OU marcadas "mostrar no login" (`login`), até 3, fixadas primeiro; "N novas para você" = notas abertas de outros mais novas que `seen/<usuário>.json` (o banner não move o marcador: entrar não é ler). Falha de uma fonte pula a seção.
- **Layout.** Moldura `═` em menta (máx. 78 colunas), 1ª linha `<hostname> · perfil <título>` com `pvx <versão>` à direita, rodapé "digite pvx para abrir · PVX_QUIET=1 silencia". `COLUMNS` (padrão 80) corta toda linha com `…` antes de colorir; sem cor com `NO_COLOR` ou sem TTY (a regra do `runCli`); os glifos ficam. Registra `auditLogin(usuário, 1º campo de SSH_CLIENT)`; sem root a escrita falha em silêncio e o exit segue 0.
- **Desempenho.** `apps/pvx` carrega só os embutidos quando `argv[0]` é `banner` (`canImport` falso para usermodules: sem `git rev-parse` por módulo, nada de rede, nenhum `data()` de widget). Medido (`bun run apps/pvx/src/index.ts banner`, macOS, snapshot e notas no disco): ~170 ms de processo inteiro; o teste exige < 1 s. Custo: um papel declarado por usermodule não aparece no banner.
- **Papéis (SDK aditivo, substitui as duas citações no host).** `PageDef.role?: "plan" | "notes"` e `ModuleDef.roles?: { compose?, notesState?, addNote? }` (nomes de consulta, consulta e comando). `registry.roles` (papel → módulo e nome; limpo em `unregister`/recarga; um segundo dono é conflito e o módulo é recusado) e `pageWithRole(registry, papel)`.
- **Uso dos papéis.** `plan`: o `p` do Diário abria a aba da página com esse papel (`PLAN_TAB` saiu); `notes` e `compose`: o `n` do Início (`NOTES` saiu); `addNote`: `conformidade ignorar` (que chamava `nota add` por nome) e o `n` do Diário (que gravava `nota add --ref` no rascunho). Os módulos `conformidade` (página `plano`) e `nota` declaram os papéis. Documentado em `packages/sdk/README.md` (exemplo roda como teste).
- **Fronteira.** `test/boundary.test.ts` ganhou a checagem de ids embutidos no código do host (`packages/`, sem `test` e `builtin`): os ids vêm dos manifests (inclui `notas`, o espaço das consultas) e o que denuncia a citação é a forma `<id>.<nome>` (chave de página, consulta, id de aba), a linha de comando do módulo (`nota add`, `["nota", "add"]`) e `motd` como palavra. Id solto não entra: `conformidade` é comando do núcleo e `nota` é o tipo do diário e uma palavra comum; assim a lista de permitidos ficou vazia, sem exceção por nome de comando. Um teste confere que o padrão pega as citações antigas e deixa passar `conformidade ignorar` e `kinds: ["nota"]`. Comentários que citavam `nota add` foram reescritos.

**Motivo:** Fase 6C e a regra "o host nunca cita um módulo pelo nome".

**Limite:** O `login` não é gravado com `PVX_QUIET=1`; no macOS e em Linux sem `timeout` o limite de 1 s é por kill em segundo plano (testado com `pvx` que dorme 10 s, em pty); o banner de um módulo de terceiros nunca aparece no login.

## 2026-10-09 — Sem porte automático e sem renomear

**Status:** vigente

**Decisão:** A Fase 7 não porta os módulos Python; o dono escreve os módulos manualmente no novo contrato.

- O binário continua `pvx` (não `pvx-next`).
- A convivência com o pvx Python não é requisito.

**Motivo:** Pedido do dono.

## 2026-10-09 — Plano dentro de Conformidade, sem Diário, built-ins sem aba, relógio na barra (substitui partes de 3D, 6B e 6C)

**Status:** vigente

**Decisão:** O plano vira um painel da página de Conformidade, o Diário sai, os built-ins deixam de ser abas e a barra ganha um relógio.

- **Plano.** A aba Plano saiu; o plano é o painel `[2] plano` da página do módulo `conformidade`, ao lado de `[1] resultados` (a partir de 100 colunas; abaixo, empilhado). `←`/`→`/`1`/`2` trocam de painel (o focado tem borda menta e `●`; movimento ilegal dá o aviso "nada aqui"); `a` aplica passo a passo (`y`/`s`/`n`, lista congelada, teste de regressão mantido), `r` atualiza os dois. A página não rola: cada painel recorta com "… +N mais". SDK aditivo: `Row`, `Panel grow`, `useNudge`, `useKey(..., {help})`, teclas `←`/`→`. A CLI `plano` e `plano apply` não mudou.
- **Diário removido:** aba, comando `diario`, `diary/query.ts`, `DiaryTab`, `tabs/diary.ts` e seus testes. Ficam `audit.jsonl`, deriva, ignorar e visto; a pasta virou `packages/core/src/journal/` e `cli/diary.ts` virou `cli/ignorar.ts` (só `conformidade ignorar`). O `n` e o `r` do Diário saíram com ele. A decisão da 6B sobre o diário (itens 4 e 5, "Novidades" e a aba) está superada; o resto vale.
- **Built-ins sem aba.** `conformidade` e `nota` não declaram `tab`; `PageDef.tab` segue como capacidade opcional (barra na época: Início · Módulos · <abas de módulo> · Logs · Comando; hoje o Ajustes vem depois do Comando). Em Módulos, `enter` num módulo lista primeiro as páginas (`§ título`), depois comandos e submenus; `enter` na página a abre como tela empilhada (`store.run("#chave")`) e `esc` volta à mesma linha. O `n` do Início e a palette (`#`) abrem a página do mesmo modo. O papel `plan` fica na página de Conformidade; nada no host o consome hoje.
- **Painéis numerados** `[1] conformidade`, `[2] atividade`, `[3] notas`, `[1] resultados`, `[2] plano`; a linha do keymap é `1-3 painel`. O título da moldura é uma string só: o `[N]` não tem cor própria (limite do OpenTUI).
- **Relógio** à direita da barra (`qui 09/10 14:32:07 · pvx 0.1.0`): componente com `memo` e estado próprio, UM `setInterval` alinhado ao segundo, então o tique só repinta o relógio. Encolhe tirando dia da semana, data e segundos, nessa ordem; `HH:MM` e a versão ficam. `Tabs` aceita `now` injetável (testes).

**Motivo:** Pedido do dono.

**Limite:** Em 80x24 a lista de resultados mostra poucas linhas e o resto vira "+N mais"; sem rolagem.

## 2026-10-13 — Fase 8: distribuição e atualização

**Status:** vigente

**Decisão:** O pvx tem uma fonte única de versão, builds reproduzíveis por script, instalação com checksum e atualização atômica.

- **Versão.** Uma fonte, `version` do `package.json` raiz. `scripts/build.sh <alvo>` injeta `process.env.PVX_VERSION` e `process.env.PVX_NIGHTLY` por `--define` (a forma `--define:k=v` com dois pontos é ignorada pelo `bun build --compile`; só `--define k=v` funciona; `typeof` sobre identificador definido também não). Build local: `X.Y.Z (nightly, <sha>)`; `PVX_RELEASE_BUILD=1`: `X.Y.Z`. O texto da marca chega todo pelo define e o fallback do código-fonte é montado em pedaços, porque o binário embute o fonte e o teste (`test/release.test.ts`) procura `nightly, ` nele. A procura é por `nightly, ` e não `nightly`: o runtime do Bun contém caminhos `nightly-2025…`.
- **`scripts/release.sh`** (`bun run release`): sempre modo release, três alvos (linux-amd64, linux-arm64, darwin-arm64), recusa artefato com a marca, grava e verifica `dist/checksums-sha256.txt`, imprime o `gh release create`; nunca publica.
- **Perfis embutidos.** `build.sh` gera um entry de embrulho em `dist/.gen/` que grava `globalThis.__PVX_PROFILES__` antes do app; `loadProfiles` usa isso se existir e cai para a pasta. (`bun build --compile ./profiles/*.json` não embute JSON como arquivo.)
- **Só perfis rastreados pelo git (0183dcc, versão 0.1.1).** Um perfil local sem rastreio vazou para os binários da v0.1.0. O build parte de `git ls-files`; `PVX_PROFILES_SRC` sobrescreve (para testes); o script de release lista os perfis embutidos antes de publicar.
- **`install.sh`.** Sem yum no caminho normal (binário só precisa de glibc, tar e curl/wget); só se faltarem curl e wget ele corrige os mirrors mortos do CentOS 7 (mesma correção do pvx Python) e instala curl. Recusa musl. Binário em `/usr/local/lib/pvx/pvx`, symlinks em `/usr/local/bin` e `/usr/bin`. Sobrescritas: `PVX_RELEASE_BASE`, `PVX_VERSION`, `PVX_LIB_DIR`, `PVX_BIN_DIR`, `PVX_USRBIN_DIR` (as mesmas valem para `uninstall`). Root só é exigido sem `PVX_LIB_DIR`. Tudo é baixado e verificado num tmpdir; os caminhos de instalação só são tocados depois do checksum.
- **`pvx self-update`** (root): API do GitHub (`PVX_API_BASE`, timeout de 30 s), compara semver, baixa tarball e checksums, confere, extrai num diretório temporário ao lado do binário e faz `rename` sobre o caminho real (`PVX_SELF_PATH` sobrescreve, para testes). Rodando por `bun index.ts` recusa. De build de desenvolvimento pergunta `[s/N]` (fora de TTY exige `--yes`).
- **`pvx uninstall [--purge]`** (root; o `self-uninstall` da spec virou `uninstall`): remove lib, wrapper, `/usr/bin/pvx` e o gancho `pvx-banner.sh`. `--purge` remove o `PVX_HOME` menos `notes.jsonl` e `usermodules/`; esses só saem com resposta `s` num TTY ou com `--purge-notes-and-modules`. `--yes` não confirma, de propósito (é global e habitual). Ambos os comandos ficam fora do diário de auditoria (`noAudit`), senão o purge recriaria o `PVX_HOME`.
- **`pvx --version`** é atalho de `pvx version`.
- **CI** em `.github/workflows/ci.yml` (testes, typecheck, matriz de build com artefatos; sem publicação).

**Motivo:** Critérios de aceite da Fase 8.

**Limite:** Fora de escopo aqui: testes de integração em Docker (Debian, Rocky 8, PATH restrito do sudo).

## 2026-10-13 — Confiança sempre e módulos do catálogo confiados sempre

**Status:** vigente

**Decisão:** A aprovação de um módulo pode valer "sempre" para o repositório de origem, e os módulos do catálogo são confiados sempre.

- **Confiar sempre.** `modules add --trust <sha> --always`, `modules trust <id> --sha <sha> --always` ou a tecla `T` na tela de revisão gravam a aprovação com `always` em `trust.json`. `--always` sem `--trust`/`--sha` é erro de uso.
- **Efeito.** Os commits novos da MESMA origem entram no `modules update` (CLI ou `u` na TUI) sem `--trust` e sem revisão, e a aprovação avança para o novo sha.
- **Regras que continuam valendo.** Só vale se a URL de origem é a mesma da aprovação (origem trocada volta a exigir revisão commit a commit). O avanço continua sendo `git merge --ff-only` até o sha buscado: histórico divergido, árvore suja e manifest ilegível (ou com outro id) recusam a atualização.
- **Auditoria.** Toda aplicação automática é auditada (`trust automático (sempre): <id> <sha> (<url>)` no `core.log` e no diário `module`); aprovar "sempre" também (`trust aprovado (sempre)`).
- **Revogação.** `modules trust --revoke <id>` apaga a aprovação. `modules trust <id> --sha <sha>` sem `--always` limpa só o "sempre" (volta a ser por commit); um `--trust` explícito num módulo "sempre" da mesma origem mantém o "sempre".
- **Aviso em segundo plano.** `pendingUpdates()` (o aviso `↓n` da TUI) só faz fetch e conta: continua só avisando, nunca aplica nada.
- **Catálogo.** Um módulo é "do catálogo" quando é instalado por id do catálogo, ou por uma URL igual à de uma entrada do catálogo (comparação exata de URL). Esse módulo é aprovado "sempre" na instalação, sem tela de revisão (as checagens de id esperado, conflitos, `--trust` e sistema continuam; a CLI mostra o resumo e "instalado do catálogo: confiança sempre"; a auditoria grava `trust automático (catálogo)`). Para a decisão, o catálogo é lido pelo mesmo `loadCatalog` (cache fresco, rede, cache antigo ou cópia embutida); falha na leitura conta como "não está no catálogo".
- **Instalações antigas do catálogo.** Módulos aprovados commit a commit cuja origem está no catálogo contam como "sempre" no próximo `update`, e o registro é promovido quando a atualização é aplicada.
- **Marca.** `∞ sempre` nas listas de módulos (CLI e TUI); `modules trust --list` acrescenta "sempre" à linha.

**Motivo:** Evitar a revisão de cada commit de uma origem já confiada (commit 72dab93). É a maior mudança do modelo de segurança: o gate de importação continua exigindo `HEAD` igual ao sha aprovado e árvore limpa, mas quem escolhe o sha novo passa a ser o repositório de origem (e, no catálogo, quem publica o catálogo).

**Limite:** Consequência direta da regra: um repositório de origem comprometido, ou uma entrada de catálogo que aponta para ele, entrega código que roda como root sem revisão humana (a análise estática e as permissões declaradas não são sandbox). Revogar impede os próximos avanços, mas não desfaz o que já foi aplicado.

## 2026-10-13 — Revisão de confiança redesenhada

**Status:** vigente

**Decisão:** A tela de revisão do primeiro install mostra o commit, um resumo e a análise por arquivo e por linha, e nunca mostra código na tela principal.

- **Cabeçalho.** Banner do commit e uma faixa de resumo acima da lista.
- **Lista de arquivos.** Cada arquivo com tamanho (linhas), marca `entry`, quem o importa e a contagem de avisos da análise estática.
- **Detalhes do arquivo selecionado.** Tamanho, "importado por", "módulo usa?" (um arquivo fora do caminho do entry é destacado), os avisos agrupados por mensagem com os números de linha e uma régua com as linhas marcadas. Nenhum trecho de código aparece.
- **`enter`** abre o arquivo selecionado na linha do primeiro aviso (a tela rotula como "editor"; o visualizador da TUI é somente leitura).
- **Teclas (primeira instalação).** `↑↓` arquivo, `enter` editor, `t` confia no commit, `T` confia sempre, `p` permissões, `s` lista de arquivos (fora do rodapé), `esc` cancela.
- **Modo atualização.** A tela antiga continua: commits novos, permissões ADICIONADAS em aviso e `s` com o `git diff HEAD <novo>`; `t` confia; não há `T`.
- **Marca.** Módulos confiados sempre aparecem com `∞ sempre` (ver "Confiança sempre e módulos do catálogo confiados sempre").

**Motivo:** Dar ao técnico um resumo do commit e a análise por arquivo e por linha, em vez de código para ler (commit 72dab93).

**Limite:** A análise continua sendo regex linha a linha e não é garantia. Substitui, na entrada "Módulos na TUI (Fase 4C)", o item da tela de revisão (`s` mostrando um arquivo) para a primeira instalação.

## 2026-10-13 — Módulos declaram os sistemas que suportam: `os`, `distro` e `--any-os`

**Status:** vigente

**Decisão:** O manifest pode declarar `os` e `distro`, e um módulo que não serve a este sistema não é instalado sem consentimento.

- **Manifest.** Campos opcionais `os` (lista de `linux`, `macos`, `windows`) e `distro` (lista de ids) em `pvx-module.json`. `distro` casa com `ID` e `ID_LIKE` de `/etc/os-release` (só em Linux). Sem os campos, o módulo serve a qualquer sistema.
- **CLI.** `modules add` recusa o módulo incompatível; `--any-os` instala mesmo assim.
- **TUI.** Pergunta num diálogo "sistema incompatível" (feito para X, este sistema é Y); "Entendi, não instalar" vem selecionado, a outra opção é "Instalar mesmo assim".
- **Depois de instalado.** A revisão mostra a incompatibilidade, as listas marcam o módulo com `⚠ sistema` e o módulo carrega normalmente.

**Motivo:** Não instalar por engano um módulo feito para outro sistema (commit e268158).

**Limite:** É consentimento na instalação, não bloqueio de carga: o módulo marcado `⚠ sistema` continua carregando.

## 2026-10-13 — Windows conta como root

**Status:** vigente

**Decisão:** No Windows, `isRoot` é sempre verdadeiro; em Linux e macOS a checagem de uid 0 continua.

- Implementação: `isRoot: process.platform === "win32" || process.getuid?.() === 0` em `apps/pvx/src/index.ts`.
- Substitui o "só uid 0" da entrada "Root estrito" para o Windows.

**Motivo:** O Windows não tem `getuid` nem sudo: todo comando que exige root falhava com "rode com sudo".

**Limite:** O portão de root espelha "root é dono do `PVX_HOME`" no Unix, que não tem equivalente no Windows; lá a checagem sempre passa.

## 2026-10-13 — `!cmd`: shell do host, sem root

**Status:** vigente

**Decisão:** `!<comando>` no Comando roda uma linha no shell do host como o usuário que abriu o pvx, sem checagem de root.

- **Shell.** `/bin/sh -c` em Linux e macOS; PowerShell (`-NoLogo -NoProfile -NonInteractive`) no Windows, com saída forçada para UTF-8 (a página de código padrão tirava os acentos) e registros de progresso escondidos.
- **Execução.** Sem stdin e sem TTY; a saída vai para um bloco do scrollback em tempo real. Limite de 5 minutos (exit 124). Cancelado: exit 130.
- **Programas interativos.** `vim`, `top`, `less`, REPLs sem script e semelhantes (primeira palavra da linha, também depois de `sudo`/`env`) são recusados com uma mensagem, em vez de travar a tela.
- **Root.** Não há checagem: o comando roda como o usuário atual, então a checagem só bloquearia sem dar nem tirar privilégio.
- **Auditoria.** Entra no `audit.jsonl` (como mutação) quando o arquivo é gravável; sem permissão de gravação, fica em silêncio.
- **Interface.** O rodapé do Comando mostra `! host shell` (no lugar de `#` e `!!`); digitar `!` entra num modo `$` visível. Blocos não têm mais fundo de hover: só o bloco focado parece selecionado.
- **Falha ao iniciar** o shell aparece como bloco de erro (antes imprimia uma pilha sobre a tela).

**Motivo:** O host ganhou uma porta para comandos comuns do sistema dentro da sessão (commit f931134); como `!cmd` roda como o usuário atual, a checagem de root só bloqueava (commit bd59260).

**Limite:** É a porta mais larga do host (qualquer comando do usuário); por isso é auditada. Uma linha com erro lançado pelo PowerShell (`Write-Error`, `throw`) ecoa o preâmbulo de UTF-8. A detecção de programas interativos olha só a cabeça da linha.

## 2026-10-13 — Matar um comando em execução com `x` ou `ctrl+c`

**Status:** vigente

**Decisão:** Um comando `!cmd` em execução pode ser encerrado com `x` (no bloco) ou `ctrl+c`.

- `x` num bloco `!cmd` em execução encerra o grupo de processos; o bloco fecha com exit 130.
- `ctrl+c` na entrada ou num bloco encerra o comando em execução mais novo; um segundo `ctrl+c` em até 2 s sai do pvx.
- Encerrar manda SIGTERM ao grupo e SIGKILL se ele ignorar por 2 s; no Windows usa `taskkill /T /F` (a árvore inteira, pois `proc.kill` deixava os filhos rodando).
- O `esc` próprio de um escopo substitui o `esc voltar` global no rodapé.

**Motivo:** Dar saída a um `!cmd` que trava ou demora (commit b4076b8).

**Limite:** Só os blocos de `!cmd` são cancelláveis hoje (`cancellable` no bloco).

## 2026-10-13 — Comando `help` e alias `h`

**Status:** vigente

**Decisão:** `help` lista os comandos como o `--help`, e `h` é alias.

- `help <módulo> [comando]` restringe a lista.
- `help` e `h` são ids reservados: nenhum módulo pode usá-los.

**Motivo:** Não registrado no commit bf21990.

## 2026-10-13 — Flags globais em qualquer posição

**Status:** vigente

**Decisão:** `--json`, `--yes` e `--help` valem em qualquer posição antes de `--`.

- Exceção: se o comando declara um argumento com o mesmo nome, a flag é dele.
- `-h` equivale a `--help`, e `h` na primeira posição vira `help`.
- `@pvx/testing` ganhou `runSession` para testes com vários comandos.

**Motivo:** Não registrado no commit 3bbf6e6.

## 2026-10-13 — Sondas com `exec` somente leitura

**Status:** vigente

**Decisão:** `prove`, consultas e widgets recebem um contexto somente leitura que inclui `exec`.

- Sem `store.set` e sem escrita em `fs` (as funções não existem, não só recusam).
- O `exec` usa a mesma lista de permitidos do contexto normal e fica registrado em log.
- Documentado na README do SDK: o `exec` não tem como ser só leitura por construção, então o módulo roda só sondas (`systemctl is-active`, `nft list ruleset`, `--version`) e nunca algo que mude o sistema.

**Motivo:** As sondas precisam perguntar ao sistema (`systemctl is-active`, `--version`) para avaliar uma capacidade (commit 3bbf6e6 e README do SDK).

**Limite:** A leitura é contrato e revisão humana do commit, não imposição técnica: o `exec` permitido pode, em tese, mudar o sistema.

## 2026-10-13 — Páginas de módulo navegam como o Início: `toBar` e `useBack`

**Status:** vigente

**Decisão:** As páginas de módulo ganham dois hooks para navegar como a aba Início.

- `usePanels().toBar()`: `↑` no painel de cima foca a barra de abas.
- `useBack(fn)`: enquanto tem uma função, `esc` a chama e fica na página; com `undefined` vale o padrão (`useBack(inside ? leave : undefined)`). Com vários montados, vale o montado mais recentemente que tem função.
- A página de `conformidade` usa `toBar()` no lugar do aviso "nada aqui".
- A README do SDK documenta os dois hooks e uma receita de aba de módulo igual ao Início.

**Motivo:** Dar às páginas de módulo o mesmo movimento da aba Início (commit 0cafb93).

## 2026-10-13 — Ajustes: temas e editor de tema

**Status:** substituída em parte por 2026-10-14 — Ajustes vira Sistema (a aba se chama Sistema; temas e editor valem como descritos)

**Decisão:** A aba Ajustes, a última da barra, escolhe o tema e edita um tema personalizado.

- **Temas.** Escuro, Claro, Alto contraste, Terminal e Personalizado (`dark`, `light`, `contrast`, `terminal`, `custom` em `tui-state.json`). Substitui "Tema claro adiado; eixos do tema".
- **Aplicação.** A troca vale na hora e persiste. Os valores do tema personalizado ficam em `custom` no `tui-state`.
- **Editor.** Valida a entrada em hex e avisa quando um token de texto tem contraste baixo.
- **Acento.** O padrão é `tema` (o acento próprio de cada tema); `menta` continua como opção. A linha selecionada usa o acento efetivo nos temas escuro, claro e alto contraste; o tema personalizado mantém a própria cor de seleção.
- **Posição.** Ajustes é a última aba (`TRAIL_TABS` = Logs, Comando, Ajustes).

**Motivo:** O tema claro e os acentos ficavam adiados e fixos; passam a ser escolha do usuário (commit b682470).

## 2026-10-13 — Painel máquina estilo btop

**Status:** vigente

**Decisão:** O painel máquina do Início é um cartão estilo btop com CPU por núcleo.

- Amostra CPU por núcleo, memória, swap, disco, rede e principais processos a cada 2 s enquanto o Início está montado.
- Histórico em gráfico braille, com reserva de blocos na tabela de glifos.
- O cartão preenche a largura do painel e perde linhas por prioridade em terminais baixos.
- Substitui a leitura de 5 s e o conteúdo (carga, RAM, disco, uptime) de "Início vira painel de informação".

**Motivo:** Não registrado no commit 8bb46a4.

## 2026-10-13 — Navegação espacial entre painéis, rolagem ao fim e hover

**Status:** vigente

**Decisão:** As setas movem o foco entre painéis pela posição na tela, e `enter` entra no painel.

- Comando e Logs ficam rolados até o fim, a não ser que o usuário role para cima.
- A aba Logs atualiza a cada 5 s.
- O Comando completa também os comandos do núcleo.
- Na aba Módulos, digitar um repositório adiciona o módulo, e `user/repo` é aceito (vira a URL de GitHub).
- O hover do mouse move a seleção por id (antes pintava um segundo fundo ao lado da seleção do teclado); o clique continua ativando.

**Motivo:** Só o hover tem motivo registrado: ele pintava um segundo fundo ao lado da seleção do teclado (commit ae30f06).

## 2026-10-13 — `bun dev` com `PVX_HOME` em `.dev/pvx`

**Status:** vigente

**Decisão:** O script `dev` roda com `PVX_HOME=.dev/pvx`, dentro do repositório.

- `package.json`: `"dev": "PVX_HOME=.dev/pvx bun run --watch apps/pvx/src/index.ts"`.
- `.dev/` é ignorado pelo git.

**Motivo:** Sem isso o `bun --watch` imprimia avisos de usermodules por cima da TUI.

## 2026-10-14 — SDK: exec em streaming, jobs em segundo plano e kit de instalador

**Status:** vigente

**Decisão:** O SDK v1 ganha, de forma aditiva, o que um instalador longo (`issabel netinstall`, 15 a 40 min) precisa: saída em streaming, cancelamento, execução separada do pvx, polling na UI e campos de formulário novos.

- `ctx.exec`: `onLine` (corta em `\n`, `\r\n` e `\r`), `signal` (mata o grupo de processos: SIGTERM, SIGKILL após 2 s) e `buffer: false`. O prazo padrão continua 30 s; comando longo pede `timeoutMs`. Só uma chamada com `signal` roda em sessão própria (para ser morta como grupo); sem ele o filho fica no grupo do pvx, como antes. O tipo é `AbortSignalLike`: o SDK não tem tipos de DOM.
- `ctx.jobs` (`CommandCtx`; `status`, `list` e `log` no `ReadCtx`) inicia `pvx jobs run <módulo> <nome>` num processo separado: `systemd-run --unit pvx-<módulo>-<nome> --collect` se existir, senão `Bun.spawn({ detached })` (sessão própria, sem terminal, descritores em `/dev/null`: o que `setsid nohup` faz, sem depender do `setsid`, que não existe no macOS). O processo executa a linha pelo mesmo `execute`, então vale tudo que vale para um comando (args, segredos, auditoria do comando).
- Estado em `$PVX_HOME/modules/<id>/jobs/<nome>.json`, log em `<nome>.log` (linhas de `ctx.out` e de `ctx.jobLog`). Um job que roda não inicia de novo. Um processo que morreu sem avisar conta como `failed`. Parar manda SIGTERM ao grupo (e o job derruba os `ctx.exec` com `signal`), SIGKILL após 3 s.
- Segredos de job: arquivo 0600 que o filho lê e apaga antes de rodar; entram como `PVX_SECRET_*` só no ambiente do `execute` do filho. Nunca em argv, estado ou log (o valor vira `***` no log).
- Iniciar e parar exigem root (`jobs stop` e `jobs run` são comandos do núcleo com `root`) e entram no audit como `kind: "job"`. Sem Windows.
- CLI do núcleo: `pvx jobs [list]`, `pvx jobs log <módulo> <nome> [--tail N] [-f]`, `pvx jobs stop <módulo> <nome>`; `jobs run` é interno. `jobs` entra nas palavras reservadas.
- Log: o arquivo do job guarda o rastro cru (alimenta `useJob().lines`) e o log normal do módulo recebe o mesmo fluxo com `[job <nome>]`, sem linhas info que só mudam nos dígitos (barras de progresso); início e parada também vão ao `core.log`.
- UI: `useQuery(nome, args, { refreshMs })` (mínimo 500 ms, mantém os dados e só renderiza se o resultado mudou), `useJob(nome)` (polling de 1 s, só renderiza se algo mudou), `Steps` e `LogTail` (reusa `follow.ts`; só a roda do mouse sai do fim).
- `Fields`: `secret` (mascarado com `●`, tecla `generate` que gera 24 caracteres alfanuméricos e mostra o valor até o foco sair), `choice` (`(●)`/`( )`) e `multi` (`[x]`/`[ ]`; valor separado por vírgula, como `repeat`). `↑↓` andam pelas opções e, nas pontas, passam ao campo vizinho.

**Motivo:** O instalador precisa sobreviver à queda da SSH e mostrar fases e log ao vivo; o SDK não tinha streaming, cancelamento, execução separada nem polling.

**Limite:** `ReadCtx.jobs` não inicia nem para. Não há fila nem reinício automático de job. O estado `running` sem `pid` vale por 30 s (o filho ainda não reportou). Jobs não rodam no Windows. Não há teste com um `systemd-run` real (só o caminho de fallback).

## 2026-10-14 — SDK: componentes de fluxo e espera visível

**Status:** vigente

**Decisão:** O que um instalador guiado precisa, e que serviria a qualquer módulo, mora no framework (`sdk.ui`) e é documentado no `UI.md` (seção 12) e no README do SDK. O módulo `issabel` usa; não redesenha.

- `Conversation` (perguntas guiadas sobre `Fields`), `Button`, `ProgressBar`, `CellGrid`, `Loading`, `useAsync(fn, deps)` e `useCopy()`. Todos com teclado e mouse e só tokens do tema.
- `Conversation`: o estado das respostas é do módulo (`answers`, `onAnswer`); `onConfirm` só roda na etapa de confirmação, então nada se aplica antes. Pergunta com `skip` não entra no fluxo, mas é listada ("(padrão)") e editável na confirmação. Reabrir uma resposta é no lugar e volta ao ponto de onde saiu.
- `Fields` ganha `active`, `buttons` e `onEdge` (aditivos), para ser uma parte estacionada de um fluxo maior. Um `enter` num campo `choice` agora envia a opção recém escolhida (antes enviava a anterior).
- `ProgressBar.etaMs` é a duração total esperada (sem ele, o ritmo até agora). Falha pinta o ponto de parada de vermelho, colado ao preenchido.
- `CellGrid`: o teclado vale com o foco da página (ou `focused`); na borda a seta fica com a página. Glifos `▪`/`▫`, com `#`/`.` no conjunto ASCII.
- `useCopy`: usa o mesmo clipboard do OpenTUI (host e OSC 52) que o `c` do Comando; mostra um painel transitório com o texto copiado e `✓ copiado`; sem clipboard diz a causa e mantém o painel.
- Regra de espera (UI.md): toda ação ou leitura que passe de ~300 ms mostra spinner e texto. Auditoria da TUI: carregamento do catálogo, lista de módulos, ação do host no menu Módulos (clone, fetch, remoção), caixa de adicionar, abertura e aprovação da revisão, verificação de conformidade (Início e abas do núcleo) passam a usar `Loading`.
- Três testes falhavam no HEAD por uma corrida do teste, não por bug: a lista de módulos lê o disco de forma assíncrona (`listModules`), e o teste comparava quadros (ou lia a seleção) antes de a lista chegar. Os testes agora esperam a lista. O terceiro (`boundary`) pegou um comentário em `modules/actions.ts` que citava um módulo.

- `sdk.proof` (`ok`, `warn`, `error`, `firstProblem`) monta `Proof` e roda os passos de uma capacidade em ordem; `ctx.arg`, `ctx.flag`, `ctx.option` e `ctx.list` leem os argumentos tipados (`ctx.args` continua). Um módulo importa só tipos, então o runtime vem injetado (`packages/core/src/engine/helpers.ts`).
- `CODIGO.md` é a norma de código legível (funções curtas com nome de intenção, tabelas no lugar de ternários longos, retorno às claras, nomes inteiros, genérico no framework). O modelo de módulo já a segue.

**Motivo:** o `issabel netinstall` precisa dessas peças, e o dono quer cada peça genérica no framework para o próximo módulo não reinventá-la.

**Limite:** `Conversation` não rola (a conversa cabe em 80x24 com poucas perguntas). A primeira carga de um `useQuery` de um módulo continua sendo desenhada pelo módulo (o host só entrega `loading`): use `Loading`.

## 2026-10-14 — Estrutura padrão de módulo = a do pvx-firewall reescrito

**Status:** vigente

**Decisão:** O dono aprovou o `pvx-firewall` reescrito como o padrão de todo módulo novo. A estrutura está em `CODIGO.md` ("Estrutura de um módulo") e o `templates/pvx-module-template/` a segue em forma mínima.

- `index.tsx` só liga; `commands/<assunto>.ts`; `health/{prove,summary,queries,widgets}.ts`; `state.ts` com `STORE_KEY`; `texts.ts` com `FIX.*`; `exec.ts`; domínio puro na raiz de `src/`; `page/` com um componente por arquivo (fábrica sobre `sdk.ui`) e helpers puros; `test/` com stubs legíveis e `fake.ts`.
- O modelo ganhou um comando em `commands/`, uma capacidade com `firstProblem`, `state.ts`, `texts.ts`, uma página com `usePanels`, `List`, `Button` e `Loading`, e testes com `fakeSdk` e `runSession`. O README do SDK aponta para ele ("Comece pelo modelo").

**Motivo:** um layout só faz cada módulo novo se parecer com o anterior e deixa a revisão e a cópia baratas.

**Limite:** o modelo omite `exec.ts` e `health/{summary,queries,widgets}.ts`, porque não executa programas nem tem consultas; o módulo cria esses arquivos quando precisar.

## 2026-10-14 — Firewall: listas lado a lado a partir de 120 colunas

**Status:** vigente

**Decisão:** No firewall, as listas de IPs e portas só ficam lado a lado a partir de 120 colunas. É uma exceção ao 100 do UI.md.

**Motivo:** a coluna de comentário ficava ilegível em 100 colunas. Aprovado pelo dono na reescrita do firewall.

**Limite:** vale só para esse módulo; o limite geral do UI.md continua 100.

## 2026-10-14 — Firewall: ações de linha pelo formulário

**Status:** vigente

**Decisão:** No firewall, as ações da linha saíram dos atalhos `x` e `c`. Agora `enter` na linha abre um formulário com o campo de comentário e o botão `remover`, e a remoção pede a confirmação do framework.

**Motivo:** os atalhos soltos eram difíceis de descobrir e removiam sem confirmar. Aprovado pelo dono na reescrita do firewall.

## 2026-10-14 — SDK: peças genéricas extraídas dos módulos firewall e issabel

**Status:** vigente

**Decisão:** O dono aprovou levar para o framework o que os módulos `pvx-firewall` e `pvx-issabel` tinham escrito por conta própria. Cada módulo passa a usar a peça do SDK e apaga a sua.

- `ctx.shell` (`run`, `must`, `ok`) sobre `ctx.exec`, com a mesma lista `permissions.exec`: a violação de permissão ainda lança (`PermissionDenied`) e nunca vira código; um programa que não inicia dá 127. `must` lança `StepError` (`command`, `code`, `output`).
- `ctx.fs.write(path, texto, { mode, atomic })`: `mode` cria o arquivo vazio e travado antes de o conteúdo entrar; `atomic` grava um temporário ao lado e renomeia. `store.update(chave, mudar)` lê, muda e grava numa chamada.
- `ctx.phases.run(nome, fases, { fresh? })`: as fases rodam em ordem, o estado vai ao `store` (`phases:<nome>`), a execução seguinte retoma da fase que falhou e pula as prontas. `useRun(nome)` junta o job e as fases (`steps`, `progress`, `view`, `current`). `useJob().view` ganha `stale`: um job que roda mas não escreve no log há `staleMs` (30 s). `useQuery().refetch()` lê de novo agora.
- `sdk.packages.tracker("dnf" | "apt")` lê a saída do gerenciador (pacote atual, feitos e total, fase `download`/`install`/`verify`); `sdk.strategy.pick` escolhe o primeiro backend disponível, ou o pedido.
- UI: `List maxRows` (janela com a seleção sempre à vista), `List onAction` (`enter` e clique), `Panel shrink`, `Notice`, `LogTail focused` (teclado) e `useNudge(msg, "ok")` tipado no SDK. "Precisa aplicar" é uma convenção no UI.md (seção 13), sem componente próprio.
- `@pvx/testing` ganha `fakeSystem`, `fakeCommandCtx`, `fakeReadCtx` e `fakeSdk`: o ponto de troca do `SystemOverrides` do issabel, sem o módulo precisar de um parâmetro na fábrica.

**Motivo:** firewall e issabel reescreveram as mesmas peças (corredor de fases, leitor de `dnf`, `run`/`runOrFail`, escolha de engine, janela de lista); o dono quer cada peça genérica no framework.

**Limite:** `ctx.phases` guarda o estado por nome no `store`; duas execuções ao mesmo tempo do mesmo nome não são protegidas (o job tem um só processo por nome). `ReadCtx` não tem `shell`. O `apt` não tem fase `verify`. `onAction` e o `enter` de `usePanels().step` não devem se somar na mesma lista. `useJob().view` conta o silêncio desde que a página começou a olhar, não desde a última linha escrita (o job não grava a hora da última escrita).

## 2026-10-14 — Ajustes vira Sistema

**Status:** vigente

**Decisão:** A aba Ajustes passa a se chamar Sistema e ganha uma seção sobre o próprio pvx. Continua a última da barra: Início · Módulos · abas de módulo · Logs · Comando · Sistema.

- **Nome.** Rótulo `Sistema`, id `sistema` (`TRAIL_TABS` = Logs, Comando, Sistema), componente `SistemaTab`, escopos de teclado `sistema`, `sistemaedit` e `sistemapvx`.
- **Seções.** `1` aparência (temas e editor, sem mudança) e `2` pvx. As teclas `1`/`2` e o clique na faixa do topo trocam de seção; só uma aparece por vez, porque o editor de tema precisa da altura toda em 80x24.
- **Sobre o pvx.** Versão, plataforma, binário (ou "rodando pelo bun"), `PVX_HOME`, pasta de módulos de usuário, URL do catálogo e quantos módulos estão carregados.
- **Atualização.** `verificar` consulta a última release do GitHub com `Loading` visível e mostra instalada contra disponível. `atualizar` roda `self-update` pela sessão (scrollback, log, auditoria e regra de root valem) e leva ao Comando. Sem binário (rodando pelo bun) ou sem versão nova, `atualizar` fica desligado e diz o motivo; uma build de desenvolvimento conta como atualizável, como na CLI.
- **Desinstalar.** Sem botão: a seção só mostra o texto `pvx uninstall`.
- **Código.** `fetchLatestRelease` sai de `self-update` e vira função do núcleo, usada pelo comando e pela aba. `catalogUrl()` e `selfPath` também são exportados.
- **Nada saiu do Início.** O Início não mostrava versão nem dica de atualização do pvx (a versão fica na barra de abas; o aviso `↓n` é de módulos), então nada foi movido; máquina e central ficam onde estão.
- Substitui o nome "Ajustes" nas entradas "Ajustes: temas e editor de tema" e nas listas de abas.

**Motivo:** O dono pediu: Sistema com aparência e as informações do pvx (versão, atualização, desinstalação) no mesmo lugar.

## 2026-10-14 — Sessão SSH no host: `ctx.session.sshClient`

**Status:** vigente

**Decisão:** O host acha o IP do cliente SSH do técnico e o entrega a todo módulo em `ctx.session.sshClient` (`CommandCtx` e `ReadCtx`, `string | undefined`). Nenhum módulo precisa mais ler `SSH_CLIENT` nem rodar `who -m`.

- **Ordem de tentativas** (`detectSshClient`, `packages/core/src/host/ssh.ts`), parando na primeira que responde: (a) `SSH_CONNECTION` ou `SSH_CLIENT` no ambiente do pvx; (b) o mesmo par no `/proc/<pid>/environ` de cada processo pai, subindo por `PPid` até o pid 1; (c) o terminal do pvx (`/proc/self/fd/0`, 1 ou 2) casado com a linha do `who` e o `(ip)` dela.
- IPv4 e IPv6, validados por `net.isIP`. Valor que não é IP (`(:0)`, `(tmux(12).%0)`) não conta.
- Uma vez por processo, na primeira leitura (`lazySshClient`); a resposta "nenhum" também fica guardada. `ctx.session` é um objeto com leitor, então um comando que não pergunta nunca paga o `who`.
- O audit grava `from` nos eventos `cmd` e `module` quando há IP (o login já gravava `from`).
- Testes: `ExecOpts.session` e `LoadOpts.session` no núcleo; `runCommand`, `runSession` e `renderPage` do `@pvx/testing` aceitam `sshClient` (sem ele, `undefined`: o teste nunca lê a sessão da máquina).

**Motivo:** Em campo, `sudo pvx` numa Issabel novas (Rocky 8) falhou o failsafe do firewall: o `sudo` limpa o ambiente (`SSH_CLIENT` some) e o `who -m` lê o terminal pelo `stdin`, que o `exec` do pvx abre em pipe, então não imprime nada. O shell de login acima do `sudo` guarda a variável e o root lê o `environ` dele. Achar no host serve a todo módulo e ao audit.

**Limite:** Só Linux para (b) e (c) (em outros sistemas só vale (a)). (c) usa os três descritores padrão, não o `tty_nr` de `/proc/self/stat`. Dentro de `tmux` ou `screen` sem a variável no ambiente, (b) pode achar o IP do primeiro cliente que iniciou o servidor, não o do cliente atual. Um terminal sem origem (console, serial) dá `undefined`. Um `ReadCtx` literal em teste de módulo precisa do campo `session` (o `fakeReadCtx` do `@pvx/testing` deve passá-lo).

## 2026-10-14 — SDK: lacunas achadas ao migrar o firewall

**Status:** vigente

**Decisão:** Seis lacunas do SDK, achadas ao migrar o `pvx-firewall` para o padrão novo, foram fechadas.

- **`ctx.strategy`.** `CommandCtx` e `ReadCtx` ganham `strategy`, o mesmo `strategyKit` de `sdk.strategy` (`ctx.strategy.pick(...)`). O módulo escolhe a estratégia dentro do comando e da sonda sem carregar o `sdk` da fábrica.
- **`ReadCtx.shell`.** Só `run` e `ok`, construídos sobre o `exec` de só leitura (mesma lista, mesmo log). Sem `must`: uma sonda relata, não lança (o `StepError` serve a quem aborta uma tarefa). A sonda deixa de ter um `run` próprio.
- **`sdk.errors`.** Como o módulo importa só tipos, `sdk.errors.isStepError` e `sdk.errors.describeFailure` vêm injetados. `describeFailure` devolve a mensagem e, para um `StepError`, as linhas de `output` uma por linha, com recuo de dois espaços; para outro erro, só a mensagem. O catch de `execute` usa o mesmo texto: um `StepError` que escapa de um comando mostra a cauda da saída, não só `saiu com código N`. A mensagem do corredor de fases fica como estava (o `output` vai para `state.failure`).
- **`stderr` no falso.** `fakeSystem` transmite cada linha não vazia do `stderr` da resposta ao `onLine` (com `"stderr"`), como o `exec` real; o `tail` do `shell` passa a ter a causa.
- **`List actionOnClick`.** Padrão `true` (o clique abre, como era). Com `false`, o clique só seleciona (a convenção do UI.md, seção 3) e abrem `enter` ou um segundo clique na linha já selecionada.
- **`useNudge`.** Os tons `warn` (`▲`, cor de aviso) e `error` (`✗`, cor de erro) se juntam ao `ok`, por tabelas `Record` de cor e glifo; os três ficam cerca de 4 s e tomam a linha do rodapé (`OK_MS` virou `TONED_MS`, `useNoticeOk` virou `useToneNotice`).

**Motivo:** A migração do firewall repetia, módulo a módulo, um `run` local para sondas, a escolha de estratégia fora do comando, a checagem de `StepError` por `name` e a descrição manual da falha.

**Limite:** `useNudge` com tom não é para falha que pede ação do técnico: essa fica num `Notice`, que não some por tempo. Nada foi pulado: nenhum item se mostrou prejudicial.

## 2026-10-14 — SDK: lacunas achadas ao migrar o issabel

**Status:** vigente

**Decisão:** Nove lacunas do SDK, achadas ao migrar o `pvx-issabel`, foram fechadas.

- **`phase.progress(fração)`.** O progresso geral soma o peso das fases prontas e o peso da fase em curso vezes a fração (`PhaseRecord.progress`, que some quando a fase termina ou recomeça). A escrita no `store` é limitada por dentro: no máximo a cada 250 ms ou quando a fração anda 1%.
- **`sdk.phases`.** `progress(estado)` e `finished(estado, trailing?)` para a CLI (`andamento: N%`) e para a página.
- **`useRun(nome, { trailing })`.** Ids de fases finais (uma contagem para reiniciar) não seguram o `done`; uma falha, final ou não, continua `failed`. O módulo perde o `isInstalled` local.
- **`loading`.** `useJob` e `useRun` devolvem `loading: true` até a primeira leitura; no `useRun` o `view` é `idle` nesse tempo. O estado salvo das fases chega antes do job e lia como "interrompido" (`failed`).
- **Tempos vivos.** `useRun` relê o relógio a cada 1 s enquanto o `view` é `running` ou `stale`; a página não precisa de timer.
- **`ctx.shell.echoing(padrões?)`.** Escreve `$ comando` e as linhas de saída em `ctx.jobLog`, com `signal` (`ctx.signal`) e `buffer: false` por padrão, e os padrões do módulo (`timeoutMs`). Segredo: o eco usa `display` quando o argv leva um (o `exec` não mascara nada; quem mascara é o job, que troca por `***` os valores de `secrets` no log); o `stdin` nunca aparece. Foi por isso que o `ctx.signal` entrou: o módulo criava um `AbortController` que nunca abortava só para ganhar um grupo de processos; agora o host aborta o sinal quando o job recebe SIGTERM.
- **`sdk.errors.stepError`.** Cria um `StepError` para falha que não veio de `shell.must`.
- **`ctx.isRoot`.** Em `CommandCtx` e `ReadCtx`, de `hostIsRoot()` (`packages/core/src/host/root.ts`; no Windows sempre `true`), repassado pelos chamadores do `execute`; `ExecOpts.isRoot` e `LoadOpts.isRoot` servem aos testes.
- **`@pvx/testing`.** `fakeSystem({ clock, isRoot })`, `fakeCommandCtx(system, { signal })`, `runCommand`/`runSession`/`renderPage` com `isRoot` e `onFakeMachine(fábrica, system, { real })`, que roda a fábrica real sobre o sistema falso (substitui o `onFakeMachine` e o `process.getuid` do módulo).

**Motivo:** A migração do issabel manteve código local para cada item: a barra parada na fase longa de pacotes (8% em vez de 45%), `isInstalled`, um tique de 1 s na página, `withJobLog`, `stepError`, `process.getuid` e o invólucro `onFakeMachine`.

**Limite:** `echoing` não adivinha segredo no argv: sem `display`, o argv aparece (e só o mascaramento de `secrets` do job o protege). `phase.progress` só persiste o último valor gravado: o intervalo entre duas escritas não é visto por quem lê o `store`. Nada foi pulado.

## 2026-10-14 — Dev link e sessão nos comandos de página

**Status:** vigente.

**Decisão:** `bun run dev:link <pasta>` registra um módulo local em `.dev/pvx`, e `createSessionStore` repassa `session` ao `execute`.

- **`dev:link` e `dev:unlink`.** `scripts/dev-link.ts` chama `linkModule` e `removeModule` do núcleo: o formato do registro (symlink em `usermodules/` e `modules.json`) é o mesmo do `modules link`. Sem argumento, lista os módulos linkados. Valida a pasta e o `pvx-module.json` e imprime id e caminho.
- **Sem root, só no script.** É ferramenta de desenvolvimento, não o binário. O binário não ganhou variável nem flag: `modules link` continua exigindo root e a confiança não muda.
- **Sessão nos comandos de página.** `SessionOpts.session` chega ao `execute`; `renderPage` e `runSession` de `@pvx/testing` passam `sshClient` (e `isRoot`, que já chegava) à store. Um módulo não precisa mais definir `SSH_CLIENT` no processo.

**Motivo:** Desenvolver contra uma pasta local (`../meu-modulo`) pedia `sudo -E` e um `PVX_HOME` à mão; e o teste de página lia a sessão real da máquina nos comandos.

**Limite:** `dev:link` só mexe em `.dev/pvx`; para outro `PVX_HOME` use `modules link` com root.

## 2026-10-14 — Estado do módulo com permissão 0600

**Status:** vigente.

**Decisão:** o `store` do host grava `state.json` com modo 0600 e cria a pasta de estado com 0700.

- **Escrita.** Arquivo temporário ao lado, criado 0600, depois `rename`. Um arquivo antigo mais aberto é trocado na próxima escrita, então fica 0600.
- **Já protegidos:** `jobs/` (pasta 0700; segredos em 0600) e o estado das fases (vive no `store`).
- **Deixados como estão:** `audit` e journal (0644: o log é de leitura aberta por desenho), `modules.json`, `trust.json` e `tui-state.json` (sem dado sensível: ids, commits aprovados, tema), cache do catálogo.

**Motivo:** `state.json` saía 0644 pelo umask e qualquer usuário local lia o estado do módulo (tokens, por exemplo).

**Limite:** arquivos que já existem só são apertados na próxima escrita; a pasta já criada com 0755 não muda.

## 2026-10-14 — List: só a lista dona da seleção registra o enter

**Status:** vigente.

**Decisão:** `List` só monta o atalho `enter` da ação da linha quando `selected` é o id de uma das suas linhas.

- Antes bastava `selected !== undefined`: dois `List` num painel (tabela e linhas de ação, como no firewall e no autobackup) recebiam o mesmo `selected`, e os dois registravam `enter`. O rodapé mostrava `enter abrir   enter abrir` e o React avisava de chave duplicada (`enterpage:<módulo>.<página>`).
- Sem API nova: a regra "lista sem foco passa `selected` indefinido" continua valendo, e passar o `selected` da página inteira às duas listas também funciona.

**Motivo:** o autobackup contornou com uma linha de ação dentro da tabela, só para não ter dois `List` com `onAction`.

**Limite:** duas listas que têm uma linha com o mesmo id disputam o `enter`; ids de linha são únicos na tela por convenção.
