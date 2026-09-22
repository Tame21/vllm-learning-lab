import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { projectRoot } from './project.mjs';

export function inspectReleaseFile(name, text) {
  const findings = [];
  if (
    /(^|\/)(?:\.cache|\.tool-cache|node_modules|dist|\.git|\.codex|\.agents|test-results|playwright-report)(\/|$)/.test(
      name,
    )
  )
    findings.push('不应提交缓存、生成物或本机工具配置');
  if (/(^|\/)\.env(?:\..+)?$/.test(name) && !name.endsWith('.env.example'))
    findings.push('不应提交本地环境变量文件');
  if (/\.(?:pem|key|p12|pfx|log)$/i.test(name)) findings.push('不应提交密钥或日志文件');
  const patterns = [
    [
      '个人目录绝对路径',
      /(?:[a-z]:[\\/](?:Users|Documents and Settings|code)[\\/]|\/(?:Users|home)\/[^/\s]+\/)/i,
    ],
    ['GitHub 令牌', /(?:gh[pousr]_[a-zA-Z0-9]{30,}|github_pat_[a-zA-Z0-9_]{50,})/],
    ['私钥内容', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
    ['带凭据的 URL', /https?:\/\/[^\s/:@]+:[^\s/@]+@/],
  ];
  text.split(/\r?\n/).forEach((line, index) => {
    for (const [label, pattern] of patterns)
      if (pattern.test(line)) findings.push(`第 ${index + 1} 行：${label}`);
  });
  return findings;
}

export function checkRelease(root = projectRoot) {
  const git = (args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
  const entries = git(['ls-files', '--stage', '-z']).split('\0').filter(Boolean);
  if (!entries.length) throw Error('没有待检查的 Git 文件。请先 git add 要发布的文件。');
  const failures = [];
  for (const entry of entries) {
    const split = entry.indexOf('\t');
    const [mode, object, stage] = entry.slice(0, split).split(' ');
    const name = entry.slice(split + 1);
    if (stage !== '0' || !['100644', '100755'].includes(mode)) {
      failures.push(`${name}：发布清单中包含冲突、子模块或符号链接，请人工核对`);
      continue;
    }
    // Read the indexed blob rather than the worktree: sanitizing an unstaged
    // file must not conceal a secret that remains in the upcoming commit.
    const content = git(['cat-file', 'blob', object]);
    for (const finding of inspectReleaseFile(name, content)) failures.push(`${name}：${finding}`);
  }
  if (failures.length) throw Error(`发布检查未通过（不输出敏感内容）：\n${failures.join('\n')}`);
  console.log(
    `发布检查通过：${entries.length} 个 Git 文件，无生成物、个人目录路径或已知凭据特征。`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    checkRelease();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
