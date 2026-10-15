# pvx

Ferramenta de linha de comando e TUI para operar centrais telefônicas Phonevox: lista e roda comandos de módulos, avalia a conformidade da central contra um perfil, aplica o plano de correção e mantém notas e histórico de cada central.

## Instalação

Linux (x86_64 ou aarch64, glibc), como root:

```sh
curl -fsSL https://raw.githubusercontent.com/adriankubinyete/pvx/main/install.sh | sudo sh
```

O instalador baixa a última release, confere o SHA-256 e instala o binário em `/usr/local/lib/pvx/pvx`, com links em `/usr/local/bin` e `/usr/bin` (assim `sudo pvx` funciona mesmo com o `secure_path` do RHEL e do Rocky). Para uma versão específica: `PVX_VERSION=v0.1.0`.

Rode `pvx` sem argumentos para abrir a TUI, ou `pvx --help` para a lista de comandos. `pvx --version` mostra a versão. A aba Sistema da TUI reúne a aparência (temas) e o que é do próprio pvx: versão, caminhos, verificação de atualização e o comando de desinstalação.

## Atualizar

```sh
sudo pvx self-update
```

Baixa a última release, confere o hash e troca o binário de forma atômica; com hash errado, nada muda. Processos em execução continuam na versão antiga até reiniciarem. Módulos não entram aqui: use `pvx modules update`.

## Desinstalar

```sh
sudo pvx uninstall            # remove o binário, os links e o gancho de login
sudo pvx uninstall --purge    # remove também /etc/pvx
```

`--purge` nunca apaga `notes.jsonl` nem `usermodules/` sem confirmação: no terminal ele pergunta; sem terminal, só com `--purge-notes-and-modules` (`--yes` não basta).

## Compilar do código-fonte

Requer [Bun](https://bun.com).

```sh
bun install
bun test
bun run typecheck
bun dev                      # TUI com reload; usa PVX_HOME=.dev/pvx (ignorado pelo git) para o bun vigiar os usermodules
bun run build:linux-amd64    # ou build:linux-arm64, build:darwin-arm64; gera dist/pvx-<os>-<arch>.tar.gz
```

Builds locais mostram `X.Y.Z (nightly, <commit>)`. Quem escreve módulo gera um binário de teste com `bun run build:dev <alvo> --with ../meu-modulo` (veja "Desenvolvimento" no guia do SDK); esse binário mostra `X.Y.Z (dev, +meu-modulo)` e nunca vai para uma release. Para gerar os artefatos de uma release (modo release, com `dist/checksums-sha256.txt` verificado), rode `bun run release`; o script só imprime o comando `gh release create`, quem publica é uma pessoa.

## Escrever módulos

Veja o [guia do SDK](packages/sdk/README.md).
