import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { basename, join } from "node:path";

type Frontmatter = {
  name?: string;
  description?: string;
  tools?: string;
  model?: string;
  effort?: string;
};

const agentFiles = readdirSync(import.meta.dir).filter((file) => file.endsWith(".md"));

const parseFrontmatter = async (file: string): Promise<Frontmatter> => {
  const text = await Bun.file(join(import.meta.dir, file)).text();
  const matched = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (matched?.[1] === undefined) {
    throw new Error(`${file} に frontmatter が無い`);
  }
  return Bun.YAML.parse(matched[1]) as Frontmatter;
};

// 書き込み系ツールを持つと「判断しない・実装しない」役の制約が外れる。
const writingTools = ["Edit", "Write", "MultiEdit", "NotebookEdit"];

describe("claude/agents の定義", () => {
  test("5 役がそろっている", () => {
    expect(agentFiles.toSorted()).toEqual([
      "diff-checker.md",
      "operator.md",
      "plan-questioner.md",
      "refuter.md",
      "scout.md",
    ]);
  });

  for (const file of agentFiles) {
    describe(file, async () => {
      const frontmatter = await parseFrontmatter(file);

      test("name がファイル名と一致する", () => {
        expect(frontmatter.name).toBe(basename(file, ".md"));
      });

      test("description が自動委任の手がかりになる長さを持つ", () => {
        expect(frontmatter.description?.length ?? 0).toBeGreaterThan(40);
      });

      test("model は haiku、effort は low に固定されている", () => {
        expect(frontmatter.model).toBe("haiku");
        expect(frontmatter.effort).toBe("low");
      });

      test("書き込み系ツールを持たない", () => {
        const tools = (frontmatter.tools ?? "").split(",").map((tool) => tool.trim());
        expect(tools.length).toBeGreaterThan(0);
        expect(tools.filter((tool) => writingTools.includes(tool))).toEqual([]);
      });
    });
  }
});
