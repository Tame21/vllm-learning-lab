export const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export const token = (value, cls = '') => `<span class="token ${cls}">${esc(value)}</span>`;
export const metric = (value, label, detail = '') =>
  `<div class="metric"><strong>${esc(value)}</strong><span>${esc(label)}</span>${detail ? `<small>${esc(detail)}</small>` : ''}</div>`;
export const table = (head, rows, label) =>
  `<div class="data-table"><table aria-label="${esc(label)}"><thead><tr>${head.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
export const range = (o, key, label, min, max, step = 1) =>
  `<label class="setting"><span>${label}<b>${o[key]}</b></span><input type="range" data-param="${key}" min="${min}" max="${max}" step="${step}" value="${o[key]}" aria-label="${label}"></label>`;
export const toggle = (o, key, label) =>
  `<label class="toggle"><input type="checkbox" data-param="${key}" ${o[key] ? 'checked' : ''}>${label}</label>`;
