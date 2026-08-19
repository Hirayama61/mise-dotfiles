import { CommandRunner } from './lib/command.ts';
import {
  missingTools,
  needsGitIdentity,
  suggestedIdentity,
  versionToken,
} from './lib/bootstrap_logic.ts';
import { UI } from './lib/ui.ts';

const runner = new CommandRunner();
const ui = new UI();

function activateMiseShims(): void {
  const home = Deno.env.get('HOME') ?? '';
  const dataDir = Deno.env.get('MISE_DATA_DIR') || `${home}/.local/share/mise`;
  const shims = `${dataDir}/shims`;
  const path = Deno.env.get('PATH') ?? '';
  if (!path.split(':').includes(shims)) Deno.env.set('PATH', `${shims}:${path}`);
}

async function commandVersion(command: string, index: number): Promise<string> {
  return versionToken(await runner.text(command, ['--version']), index);
}

async function ensureRepoTools(): Promise<void> {
  const tools = ['ghq', 'gh'];
  const available = new Set<string>();
  for (const tool of tools) {
    if (await runner.exists(tool)) available.add(tool);
  }

  const missing = missingTools(tools, available);
  if (missing.length > 0) {
    await ui.run('mise', `${missing.join(' ')} を導入しています`, async () => {
      await runner.inherit('mise', ['use', '--global', ...missing]);
    });
  }

  for (const tool of tools) {
    await ui.status('ok', tool, await commandVersion(tool, 2), true);
  }
}

async function ensureGitHubAuth(): Promise<void> {
  if (!await runner.succeeds('gh', ['auth', 'status'])) {
    await ui.note('GitHub の認証が必要です。ブラウザが開きます。');
    console.log();
    await runner.inherit('gh', ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web']);
    console.log();
  }

  const login = await runner.textOrEmpty('gh', ['api', 'user', '--jq', '.login']);
  await ui.status('ok', 'gh auth', login || '認証済み');
}

async function ensureGitIdentity(): Promise<void> {
  const current = {
    name: await runner.textOrEmpty('git', ['config', '--get', 'user.name']),
    email: await runner.textOrEmpty('git', ['config', '--get', 'user.email']),
  };

  if (!needsGitIdentity(current)) {
    await ui.status('kept', 'user.name', current.name);
    await ui.status('kept', 'user.email', current.email);
    console.log();
    await ui.note('既に設定済みなので変更しません。');
    return;
  }

  const github = {
    login: await runner.textOrEmpty('gh', ['api', 'user', '--jq', '.login']),
    id: await runner.textOrEmpty('gh', ['api', 'user', '--jq', '.id']),
    name: await runner.textOrEmpty('gh', ['api', 'user', '--jq', '.name // .login']),
  };
  const suggestion = suggestedIdentity(current, github);

  await ui.note('commit に必要な identity が未設定です。');
  await ui.note('Enter で [ ] 内の候補を採用します。変えるなら入力してください。');
  if (suggestion.email.endsWith('@users.noreply.github.com')) {
    await ui.note('email の既定は GitHub がアドレスを隠す noreply 形式です。');
  }
  console.log();

  const name = ui.ask('name', suggestion.name);
  const email = ui.ask('email', suggestion.email);

  console.log();
  await ui.note('~/.gitconfig に書きます');
  console.log();
  await ui.note('[user]');
  await ui.note(`    name  = ${name}`);
  await ui.note(`    email = ${email}`);
  console.log();

  if (!ui.confirm('この内容で書き込みますか')) {
    console.log();
    await ui.note('中止しました。commit する前に git config --global で設定してください。');
    return;
  }

  await runner.inherit('git', ['config', '--global', 'user.name', name]);
  await runner.inherit('git', ['config', '--global', 'user.email', email]);

  console.log();
  await ui.status('ok', 'user.name', name);
  await ui.status('ok', 'user.email', email);
}

async function printNextSteps(): Promise<void> {
  const homebrewNeedsActivation = Deno.env.get('MISE_DOTFILES_HOMEBREW_NEEDS_ACTIVATION') === '1';
  const activateCommand = 'eval "$(/opt/homebrew/bin/brew shellenv)"';
  let clipboardCommand = 'mise run setup';

  await ui.ready('リポを編集して push できます');
  await ui.section('Next Action');

  if (homebrewNeedsActivation) {
    await ui.nextStep(activateCommand, 'Homebrew の PATH をこの端末に通す');
    clipboardCommand = `${activateCommand} && mise run setup`;
  }

  await ui.nextStep('mise run setup', 'リポジトリが管理するツールを揃える');
  await ui.nextStep('claude login', 'Claude Code の認証(未認証なら)');
  console.log();
  await ui.clipboard(clipboardCommand);
  console.log();
}

async function main(): Promise<void> {
  activateMiseShims();

  await ui.banner('commit / push できる状態まで');

  await ui.section('ツール');
  await ui.status('ok', 'git', await commandVersion('git', 2));
  await ui.status('ok', 'Homebrew', await commandVersion('brew', 1));
  await ui.status('ok', 'mise', await commandVersion('mise', 0));
  await ensureRepoTools();

  await ui.section('GitHub');
  await ensureGitHubAuth();

  await ui.section('git identity');
  await ensureGitIdentity();

  await printNextSteps();
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  Deno.exit(1);
}
