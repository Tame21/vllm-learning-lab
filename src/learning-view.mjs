import { esc } from './html.mjs';
import { learningPaths, prerequisites } from './learning.mjs';
import { executableIds } from './engine.mjs';
import { specEntry } from './spec-method-view.mjs';

export function learningContext(lesson, lessons, terms) {
  const names = {
    prefix: ['KV Cache', 'Prefix cache'],
    scheduler: ['Token', 'Prefill', 'Preemption'],
    chunked: ['Prefill', 'KV Cache'],
    speculative: ['Logits', 'Temperature'],
    tp: ['TP / PP / DP / EP'],
    pp: ['TP / PP / DP / EP'],
    moe: ['TP / PP / DP / EP'],
    runner: ['Model Runner'],
    paged: ['Block / Page', 'Block table'],
    structured: ['Token', 'Logits'],
  };
  const selected = names[lesson.id] || ['Token'];
  return `<div class="learning-context"><span class="badge">${executableIds.includes(lesson.id) ? '可推演实验' : '机制讲解'}</span><span>建议先学</span>${
    (prerequisites[lesson.id] || (lesson.kind === 'spec-method' ? ['speculative'] : ['lifecycle']))
      .filter((id) => id !== lesson.id)
      .map(
        (id) =>
          `<button data-lesson="${id}">${esc(lessons.find((l) => l.id === id).title)} ↗</button>`,
      )
      .join('') || '<span>这是起点</span>'
  }<span class="context-spacer"></span><span>查术语</span>${selected.map((name) => `<button data-term="${terms.findIndex((t) => t[0] === name)}">${esc(name)}</button>`).join('')}</div>`;
}

export function quizView(lesson, answer, record, challenge, challengeInput, challengeResult) {
  const correct = answer === lesson.answer;
  return `<span class="eyebrow">PREDICT · RUN · EXPLAIN</span><h2>${esc(lesson.question)}</h2><div class="quiz-options">${lesson.choices.map((choice, n) => `<button data-answer="${n}" class="${answer === n ? (correct ? 'correct' : 'incorrect') : ''}"><span>${String.fromCharCode(65 + n)}</span>${esc(choice)}</button>`).join('')}</div>
    ${answer !== null ? `<div class="feedback ${correct ? 'correct' : 'incorrect'}"><strong>${correct ? '机制判断正确' : '看看这个判断遗漏了什么'}</strong><p>${esc(correct ? lesson.reason : lesson.misconception)}</p></div><p class="small-note">本题已作答 ${record?.attempts || 1} 次 · ${record?.passed ? '理解题通过' : '已加入待复习'}</p><button class="quiet-button" data-action="retry-quiz">重新作答</button>` : '<p class="small-note">先作出预测，再通过动画与源码验证。</p>'}
    ${challenge ? `<section class="numeric-challenge"><h3>动手挑战</h3><p>${esc(challenge.question)}</p><label for="challenge-answer">你的预测值</label><div><input id="challenge-answer" type="number" step="any" value="${esc(challengeInput)}" aria-label="挑战预测值"><button data-action="check-challenge">验证</button></div>${challengeResult ? `<div class="feedback ${challengeResult.correct ? 'correct' : 'incorrect'}"><strong>${challengeResult.correct ? '预测正确' : '需要再观察'}</strong><p>本次推演结果：${challenge.answer}。${esc(challenge.explanation)}</p></div>` : ''}<button class="source-jump" data-action="challenge-observe">去关键步骤观察 →</button><p class="small-note">挑战使用当前参数；修改参数后会清空本次预测。</p></section>` : ''}`;
}

export function pathView(lessons, study) {
  const tile = (id) => {
    const l = lessons.find((l) => l.id === id);
    return `<button data-lesson="${id}"><span>${study.quiz[id]?.passed ? '✓' : study.completed.includes(id) ? '◐' : '○'}</span><div><b>${esc(l.title)}</b><small>${study.quiz[id]?.passed ? '理解题通过' : study.quiz[id] ? '理解题待复习' : study.completed.includes(id) ? '已读，待验证' : '开始学习'}</small></div><span>→</span></button>`;
  };
  const wrong = Object.keys(study.quiz).filter((id) => !study.quiz[id].passed);
  return `<div class="lesson-heading"><div><div class="eyebrow">YOUR LEARNING PATH</div><h1>从看懂，到自己推演</h1><p>先预测，再运行，最后用源码解释。已读进度与理解题成绩分别记录。</p></div></div><div class="path-summary"><b>${study.completed.length} 个专题已读</b><b>${Object.values(study.quiz).filter((q) => q.passed).length} 道理解题通过</b><b>${wrong.length} 道待复习</b></div>${specEntry()}<div class="path-grid">${learningPaths.map((p, n) => `<section class="path-card"><span class="eyebrow">路线 0${n + 1}</span><h2>${p.title}</h2><p>${p.description}</p>${p.ids.map(tile).join('')}</section>`).join('')}</div><div class="path-grid secondary-paths"><section class="path-card"><h2>待复习</h2>${wrong.map(tile).join('') || '<p>答错的理解题会出现在这里。</p>'}</section><section class="path-card"><h2>我的收藏</h2>${study.bookmarks.map(tile).join('') || '<p>用专题标题旁的收藏按钮建立自己的学习清单。</p>'}</section></div>`;
}
