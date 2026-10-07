// Every value from the server goes in as a text node, never as HTML.
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') el.className = value
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value)
    else if (value != null && value !== false) el.setAttribute(key, value)
  }
  el.append(...children.flat().filter((child) => child != null && child !== false))
  return el
}

export const dateTime = (iso) =>
  iso ? new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
