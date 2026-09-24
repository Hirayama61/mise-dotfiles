import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { createUi, type Ui } from "./lib/ui.ts";

// mise run のタスクには mise 自身の PATH が通らないので、mise.toml が絶対パスを渡す。
const miseBin = process.env.MISE_BIN ?? "mise";

/**
 * "<tool> version X.Y.Z (...)" の形式で名乗るツールの出力からバージョンだけ取り出す。
 *
 * @param output - --version の出力。取得できなかった場合は null。
 * @returns バージョン文字列。取り出せなければ空文字。
 */
const parseToolVersion = (output: string | null): string =>
  output?.split("\n")[0]?.split(/\s+/)[2] ?? "";

/**
 * 人間が端末で打つ mise のコマンド名を返す。
 *
 * 入れたばかりの端末では ~/.local/bin が PATH に無く、裸の mise は見つからない。
 * mise がそこにあるときだけ、どの端末でも通るパス付きの表記にする。
 *
 * @returns "mise" か "~/.local/bin/mise"。
 */
const miseCommand = (): string =>
  miseBin === join(homedir(), ".local/bin/mise") ? "~/.local/bin/mise" : "mise";

/**
 * コマンドを実行して標準出力を返す。
 *
 * @param command - 実行するコマンドと引数。
 * @returns trim した標準出力。失敗・コマンド不在・空出力は null。
 */
const capture = (command: readonly string[]): string | null => {
  try {
    const result = Bun.spawnSync([...command], { stdout: "pipe", stderr: "ignore" });
    if (!result.success) {
      return null;
    }
    const text = result.stdout.toString().trim();
    return text === "" ? null : text;
  } catch {
    return null;
  }
};

const toolVersion = (tool: string): string => parseToolVersion(capture([tool, "--version"]));

/**
 * gh を揃える。認証に使うので、この端末から commit / push する時だけ要る。
 *
 * mise use で入れたツールは、このプロセスの PATH には現れない。
 * Bun は起動時の PATH で実行ファイルを解決するので、mise に絶対パスを聞く。
 *
 * @param ui - 表示部品。
 * @returns gh の実行パス。
 */
const ensureGh = async (ui: Ui): Promise<string> => {
  if (Bun.which("gh") === null) {
    await ui.run("mise", "gh を導入しています", [miseBin, "use", "--global", "gh"]);
  }

  const path = Bun.which("gh") ?? capture([miseBin, "which", "gh"]);
  if (path === null) {
    throw new Error("gh を導入できなかった");
  }

  const version = toolVersion(path);
  ui.status("ok", "gh", version === "" ? "不明" : version);
  return path;
};

const ensureGithubAuth = (ui: Ui, ghPath: string): void => {
  const authenticated = Bun.spawnSync([ghPath, "auth", "status"], {
    stdout: "ignore",
    stderr: "ignore",
  }).success;

  if (!authenticated) {
    ui.note("GitHub の認証が必要です。ブラウザが開きます。");
    process.stdout.write("\n");
    const login = Bun.spawnSync(
      [ghPath, "auth", "login", "--hostname", "github.com", "--git-protocol", "https", "--web"],
      { stdin: "inherit", stdout: "inherit", stderr: "inherit" },
    );
    if (!login.success) {
      throw new Error("gh auth login が失敗した");
    }
    process.stdout.write("\n");
  }

  ui.status("ok", "gh auth", capture([ghPath, "api", "user", "--jq", ".login"]) ?? "認証済み");
};

// 空入力を既定値で埋められない項目を、値が入るまで聞き直す。
const askUntilAnswered = async (ui: Ui, label: string, defaultValue: string): Promise<string> => {
  let answer = "";
  while (answer === "") {
    answer = await ui.ask(label, defaultValue);
  }
  return answer;
};

/**
 * git config --global が書き込むファイルを返す。
 *
 * GIT_CONFIG_GLOBAL が在ると git は ~/.gitconfig も XDG 側も見ない(man git)。
 * ~/.gitconfig が無く XDG 側だけが在る端末では XDG 側へ書かれる(man git-config)。
 * XDG_CONFIG_HOME は未設定でも空でも ~/.config として扱う。
 *
 * @returns 書き先のパス。
 */
const globalGitConfigPath = (): string => {
  const override = process.env.GIT_CONFIG_GLOBAL;
  if (override) {
    return override;
  }

  const gitconfig = join(homedir(), ".gitconfig");
  if (existsSync(gitconfig)) {
    return gitconfig;
  }

  const xdgBase = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  const xdgConfig = join(xdgBase, "git", "config");
  return existsSync(xdgConfig) ? xdgConfig : gitconfig;
};

/**
 * ホームディレクトリ配下のパスを ~ 始まりの表記へ縮める。
 *
 * @param path - 絶対パス。
 * @returns ホーム配下なら ~ 始まりの表記。そうでなければそのまま。
 */
const shortenHome = (path: string): string =>
  path.startsWith(`${homedir()}/`) ? `~${path.slice(homedir().length)}` : path;

const printGitconfigPreview = (ui: Ui, name: string, email: string, target: string): void => {
  const lines = [
    "",
    ui.paint("SUBTLE", `   ${shortenHome(target)} に書きます`),
    "",
    ui.paint("SUBTLE", "     [user]"),
    ui.paint("SUBTLE", "         name  = ") + ui.paint("FG", name),
    ui.paint("SUBTLE", "         email = ") + ui.paint("FG", email),
    "",
    "",
  ];
  process.stdout.write(lines.join("\n"));
};

// commit には name と email の両方が要る。片方でも欠けていれば対話に入り、
// 残っている方は既定値として提示するので Enter で維持できる。
const ensureGitIdentity = async (ui: Ui, ghPath: string): Promise<void> => {
  const currentName = capture(["git", "config", "--get", "user.name"]);
  const currentEmail = capture(["git", "config", "--get", "user.email"]);

  if (currentName !== null && currentEmail !== null) {
    ui.status("kept", "user.name", currentName);
    ui.status("kept", "user.email", currentEmail);
    process.stdout.write("\n");
    ui.note("既に設定済みなので変更しません。");
    return;
  }

  const login = capture([ghPath, "api", "user", "--jq", ".login"]);
  const userId = capture([ghPath, "api", "user", "--jq", ".id"]);
  const suggestedName = capture([ghPath, "api", "user", "--jq", ".name // .login"]);

  ui.note("commit に必要な identity が未設定です。");
  ui.note("Enter で [ ] 内の候補を採用します。変えるなら入力してください。");

  const noreply =
    userId !== null && login !== null ? `${userId}+${login}@users.noreply.github.com` : "";
  if (noreply !== "") {
    ui.note("email の既定は GitHub がアドレスを隠す noreply 形式です。");
  }
  process.stdout.write("\n");

  const name = await askUntilAnswered(ui, "name", currentName ?? suggestedName ?? login ?? "");
  const email = await askUntilAnswered(ui, "email", currentEmail ?? noreply);

  printGitconfigPreview(ui, name, email, globalGitConfigPath());

  if (!(await ui.confirm("この内容で書き込みますか"))) {
    process.stdout.write("\n");
    ui.note("中止しました。commit する前に git config --global で設定してください。");
    return;
  }

  const wroteName = Bun.spawnSync(["git", "config", "--global", "user.name", name]).success;
  const wroteEmail = Bun.spawnSync(["git", "config", "--global", "user.email", email]).success;
  if (!wroteName || !wroteEmail) {
    throw new Error("git config --global の書き込みに失敗した");
  }

  process.stdout.write("\n");
  ui.status("ok", "user.name", name);
  ui.status("ok", "user.email", email);
};

const printNextSteps = (ui: Ui): void => {
  ui.ready("リポを編集して push できます");
  ui.section("Next Action");
  const setupCommand = `${miseCommand()} run setup`;
  ui.nextStep(setupCommand, "リポジトリが管理するツールと設定を適用する");
  ui.nextStep("claude login", "Claude Code の認証(未認証なら)");
  process.stdout.write("\n");
  ui.clipboard(setupCommand);
  process.stdout.write("\n");
};

/**
 * このリポジトリに対して commit / push できる状態にする。
 *
 * gh 認証と git identity を設定する任意タスク。実行しなくても mise run setup へ進める。
 * fish や nvim といった実際に使うツールの導入と設定は mise run setup が担当する。
 */
const runGitSetup = async (): Promise<void> => {
  const ui = await createUi();

  // スピナー表示中に中断されるとカーソルが消えたままになる。
  process.on("exit", () => {
    ui.showCursor();
  });
  process.on("SIGINT", () => {
    process.exit(130);
  });

  ui.banner("commit / push できる状態まで");

  ui.section("ツール");
  const ghPath = await ensureGh(ui);

  ui.section("GitHub");
  ensureGithubAuth(ui, ghPath);

  ui.section("git identity");
  await ensureGitIdentity(ui, ghPath);

  printNextSteps(ui);
  ui.close();
};

if (import.meta.main) {
  runGitSetup().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
