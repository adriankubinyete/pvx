import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkPlatform, hostPlatform, readManifestRaw, type HostPlatform } from "../../src/engine/index.ts";

let dir = "";
beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), "pvx-plat-"))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const osRelease = (body: string) => {
  const f = join(dir, "os-release");
  writeFileSync(f, body);
  return f;
};

const rocky: HostPlatform = { os: "linux", distros: ["rocky", "rhel", "centos", "fedora"], name: "Rocky Linux 9" };
const win: HostPlatform = { os: "windows", distros: [], name: "Windows" };
const mac: HostPlatform = { os: "macos", distros: [], name: "macOS" };

describe("hostPlatform", () => {
  test("Rocky: ID and every ID_LIKE word, quotes stripped, PRETTY_NAME as name", () => {
    const f = osRelease('NAME="Rocky Linux"\nID="rocky"\nID_LIKE="rhel centos fedora"\nPRETTY_NAME="Rocky Linux 9.4 (Blue Onyx)"\n');
    expect(hostPlatform(f, "linux")).toEqual({ os: "linux", distros: ["rocky", "rhel", "centos", "fedora"], name: "Rocky Linux 9.4 (Blue Onyx)" });
  });

  test("Ubuntu: unquoted values", () => {
    const f = osRelease("ID=ubuntu\nID_LIKE=debian\n");
    expect(hostPlatform(f, "linux")).toEqual({ os: "linux", distros: ["ubuntu", "debian"], name: "Linux" });
  });

  test("Arch: no ID_LIKE; ids are lowercased", () => {
    expect(hostPlatform(osRelease("ID=Arch\n"), "linux").distros).toEqual(["arch"]);
  });

  test("Linux without os-release has no distros", () => {
    expect(hostPlatform(join(dir, "missing"), "linux")).toEqual({ os: "linux", distros: [], name: "Linux" });
  });

  test("other platforms ignore os-release", () => {
    const f = osRelease("ID=ubuntu\n");
    expect(hostPlatform(f, "win32")).toEqual(win);
    expect(hostPlatform(f, "darwin")).toEqual(mac);
    expect(hostPlatform(f, "freebsd")).toEqual({ os: "other", distros: [], name: "freebsd" });
  });
});

describe("checkPlatform", () => {
  test("no fields: any system", () => {
    for (const h of [rocky, win, mac]) expect(checkPlatform({}, h)).toEqual({ ok: true, wanted: "qualquer sistema", host: h.name, text: "qualquer sistema" });
  });

  test("os only", () => {
    expect(checkPlatform({ os: ["linux", "macos"] }, mac)).toMatchObject({ ok: true, wanted: "linux, macos", text: "linux, macos · este sistema: macOS" });
    const r = checkPlatform({ os: ["linux", "macos"] }, win);
    expect(r).toMatchObject({ ok: false, wanted: "linux, macos", host: "Windows", text: "feito para linux, macos; este sistema é Windows" });
  });

  test("distro implies linux and renders in the linux entry", () => {
    const r = checkPlatform({ distro: ["rhel", "debian"] }, rocky);
    expect(r).toMatchObject({ ok: true, wanted: "linux (rhel, debian)", text: "linux (rhel, debian) · este sistema: Rocky Linux 9" });
    expect(checkPlatform({ os: ["linux", "macos"], distro: ["rhel"] }, mac).wanted).toBe("linux (rhel), macos");
  });

  test("distro on a non-Linux host is incompatible", () => {
    expect(checkPlatform({ distro: ["rhel"] }, win)).toMatchObject({ ok: false, text: "feito para linux (rhel); este sistema é Windows" });
    expect(checkPlatform({ distro: ["rhel"] }, mac).ok).toBe(false);
  });

  test("distro matches ID_LIKE and ignores case", () => {
    expect(checkPlatform({ distro: ["RHEL"] }, rocky).ok).toBe(true);
    expect(checkPlatform({ distro: ["Rocky"] }, rocky).ok).toBe(true);
    expect(checkPlatform({ distro: ["debian"] }, rocky)).toMatchObject({ ok: false, text: "feito para linux (debian); este sistema é Rocky Linux 9" });
  });

  test("an unknown Linux (no os-release) fails a distro requirement but passes os linux", () => {
    const bare: HostPlatform = { os: "linux", distros: [], name: "Linux" };
    expect(checkPlatform({ distro: ["rhel"] }, bare).ok).toBe(false);
    expect(checkPlatform({ os: ["linux"] }, bare).ok).toBe(true);
  });
});

describe("manifest os/distro validation", () => {
  const read = (extra: Record<string, unknown>) => {
    writeFileSync(join(dir, "pvx-module.json"), JSON.stringify({ id: "m", version: "1.0.0", entry: "i.ts", ...extra }));
    return readManifestRaw(dir);
  };

  test("valid values pass through", () => {
    expect(read({ os: ["linux", "macos"], distro: ["rhel"] })).toMatchObject({ os: ["linux", "macos"], distro: ["rhel"] });
    expect(read({}).os).toBeUndefined();
  });

  test("os only accepts linux, macos, windows", () => {
    expect(() => read({ os: ["beos"] })).toThrow('manifest inválido: "os" aceita linux, macos, windows');
  });

  test("os and distro must be non-empty arrays of non-empty strings", () => {
    for (const f of ["os", "distro"]) {
      for (const v of [[], "linux", [""], ["  "], [1], null]) expect(() => read({ [f]: v })).toThrow(`manifest inválido: "${f}" deve ser uma lista não vazia de textos`);
    }
  });
});
