// Owner of the login hook. The banner text itself is `pvx banner` (the host formats data it already has).
import type { ModuleDef } from "@pvx/sdk";

/** `$PVX_PROFILED_DIR` is the host's login-hooks directory (`/etc/profile.d` unless a test moves it). */
const HOOK = "$PVX_PROFILED_DIR/pvx-banner.sh";

/**
 * POSIX sh, sourced by every login shell. Prints only on an interactive terminal, honours PVX_QUIET=1, gives `pvx banner`
 * 1 s (`timeout`, else a background kill) and swallows every failure: it must never block or break a login.
 */
const SCRIPT = `# pvx login banner. Managed by \`pvx motd install-hook\`; remove with \`pvx motd remove-hook\`.
if [ -t 1 ] && [ "\${PVX_QUIET:-}" != "1" ] && command -v pvx >/dev/null 2>&1; then
  if command -v timeout >/dev/null 2>&1; then
    timeout 1 pvx banner 2>/dev/null || true
  else
    # No timeout(1): run in a subshell (no job-control noise), kill after 1 s. <&0 keeps the terminal as stdin.
    ( pvx banner 2>/dev/null <&0 & p=$!; ( sleep 1; kill -9 "$p" 2>/dev/null ) & k=$!; wait "$p" 2>/dev/null; kill "$k" 2>/dev/null ) || true
  fi
fi
true
`;

export default (): ModuleDef => ({
  commands: {
    "install-hook": {
      help: "Instala o gancho que mostra o banner no login (/etc/profile.d/pvx-banner.sh)",
      async run(ctx) {
        await ctx.fs.write(HOOK, SCRIPT);
        ctx.out.success("gancho de login instalado: pvx-banner.sh em profile.d");
      },
    },
    "remove-hook": {
      help: "Remove o gancho do banner de login",
      async run(ctx) {
        if (!(await ctx.fs.exists(HOOK))) return ctx.out.info("gancho de login não estava instalado");
        await ctx.fs.remove(HOOK);
        ctx.out.success("gancho de login removido");
      },
    },
  },
});
