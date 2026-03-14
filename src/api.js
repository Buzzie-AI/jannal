// ─── HTTP API helpers ───────────────────────────────────────────────────────

export async function fetchContent(turnId, segIndex) {
  const resp = await fetch(`/api/content/${turnId}/${segIndex}`)
  return resp.json()
}

export async function postProfile(name, mode, tools) {
  const resp = await fetch('/api/profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mode, tools }),
  })
  return resp.json()
}

export async function deleteProfile(name) {
  const resp = await fetch(`/api/profiles/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  })
  return resp.json()
}

export async function setActiveProfile(name) {
  const resp = await fetch('/api/active-profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  return resp.json()
}

export async function exportProfiles() {
  const resp = await fetch('/api/profiles/export')
  return resp.json()
}

export async function importProfiles(data) {
  const resp = await fetch('/api/profiles/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return resp.json()
}
