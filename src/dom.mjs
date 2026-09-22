function identity(node) {
  if (node.nodeType !== 1) return node.nodeName;
  const key =
    node.id ||
    ['data-param', 'data-lesson', 'data-row', 'data-view', 'data-tab']
      .map((name) => (node.hasAttribute(name) ? `${name}:${node.getAttribute(name)}` : ''))
      .find(Boolean) ||
    '';
  return `${node.tagName}:${key}`;
}

// Keep existing controls alive while updating their values and nearby output.
// Event delegation means no listeners need to be rebound after a patch.
export function patchChildren(parent, template) {
  const desired = [...template.childNodes];
  desired.forEach((next, index) => {
    let current = parent.childNodes[index];
    if (!current || identity(current) !== identity(next)) {
      const matching = [...parent.childNodes]
        .slice(index + 1)
        .find((n) => identity(n) === identity(next));
      if (matching) {
        parent.insertBefore(matching, current);
        current = matching;
      } else {
        parent.insertBefore(next.cloneNode(true), current || null);
        return;
      }
    }
    if (current.nodeType !== 1) {
      if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
      return;
    }
    for (const attr of [...current.attributes]) {
      if (!next.hasAttribute(attr.name)) current.removeAttribute(attr.name);
    }
    for (const attr of next.attributes) {
      if (current.getAttribute(attr.name) !== attr.value)
        current.setAttribute(attr.name, attr.value);
    }
    patchChildren(current, next);
    if (current.tagName === 'INPUT') {
      if (current.value !== next.value) current.value = next.value;
      current.checked = next.checked;
    }
    if (['SELECT', 'TEXTAREA'].includes(current.tagName) && current.value !== next.value)
      current.value = next.value;
  });
  while (parent.childNodes.length > desired.length) parent.lastChild.remove();
}

export function updateDOM(root, html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  patchChildren(root, template.content);
}
