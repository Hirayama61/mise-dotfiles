import { describe, expect, test } from "bun:test";
import { assessRisk, isApprovalOf, largeDiffLines, reviewCommand } from "./review-gate.ts";

describe("assessRisk", () => {
  test("規則に合うパスが無ければ low で effort low を案内する", () => {
    expect(assessRisk(["src/app.ts", "README.md"], 10)).toEqual({
      level: "low",
      effort: "low",
      reasons: [],
    });
  });

  test.each([
    ["認証", "src/auth/token.ts"],
    ["認証", "app/controllers/login_controller.rb"],
    ["migration・スキーマ", "db/migrations/20261024_add_users.sql"],
    ["migration・スキーマ", "prisma/schema.prisma"],
    ["権限", "src/permissions.ts"],
    ["権限", ".claude/settings.json"],
    ["CI 設定", ".github/workflows/ci.yml"],
    ["秘密情報", ".env.production"],
  ])("%s に当たる %s を含むと high で effort high を案内する", (label, file) => {
    const risk = assessRisk(["src/app.ts", file], 10);
    expect(risk.level).toBe("high");
    expect(risk.effort).toBe("high");
    expect(risk.reasons).toEqual([expect.stringContaining(`${label}(high): ${file}`)]);
  });

  test("依存の manifest は medium にする", () => {
    expect(assessRisk(["package.json", "bun.lock"], 10).level).toBe("medium");
  });

  test("行数が上限を超える差分はパスに関係なく medium にする", () => {
    const risk = assessRisk(["src/app.ts"], largeDiffLines + 1);
    expect(risk.level).toBe("medium");
    expect(risk.reasons).toEqual([`大きな差分(medium): ${largeDiffLines + 1} 行`]);
  });

  test("high と medium が混ざれば high を採る", () => {
    expect(assessRisk(["package.json", "src/auth.ts"], largeDiffLines + 1).level).toBe("high");
  });

  test("名前の一部が一致するだけのパスは high にしない", () => {
    expect(assessRisk(["src/author.ts", "docs/rolesmith.md", "src/keyboard.ts"], 10).level).toBe(
      "low",
    );
  });

  test("該当ファイルが多いときは根拠の列挙を 3 件で打ち切る", () => {
    const files = ["a/auth.ts", "b/auth.ts", "c/auth.ts", "d/auth.ts"];
    expect(assessRisk(files, 10).reasons).toEqual([
      "認証(high): a/auth.ts, b/auth.ts, c/auth.ts ほか 1 件",
    ]);
  });
});

describe("reviewCommand", () => {
  test("対象を base から HEAD までの範囲に固定する", () => {
    expect(reviewCommand("high", "0123456789abcdef")).toBe("/code-review high 0123456789ab..HEAD");
  });
});

describe("isApprovalOf", () => {
  const flag = {
    schema_version: 1,
    engine: "code-review",
    effort: "low",
    reviewed_diff_fingerprint: "abc",
    approved: true,
    reviewed_at: "2026-10-24T00:00:00.000Z",
  };

  test("fingerprint が一致し approved が true なら承認とみなす", () => {
    expect(isApprovalOf(flag, "abc")).toBe(true);
  });

  test("engine が別のレビューエンジンでも承認とみなす", () => {
    expect(isApprovalOf({ ...flag, engine: "coderabbit" }, "abc")).toBe(true);
  });

  test.each([
    ["fingerprint が違う", flag, "def"],
    ["approved が false", { ...flag, approved: false }, "abc"],
    ["schema_version が違う", { ...flag, schema_version: 2 }, "abc"],
    ["オブジェクトでない", "abc", "abc"],
  ])("%s なら承認とみなさない", (_, value, fingerprint) => {
    expect(isApprovalOf(value, fingerprint)).toBe(false);
  });
});
