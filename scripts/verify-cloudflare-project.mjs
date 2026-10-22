// Read-only preflight: fail before migrations or Worker updates if Pages is unavailable.
const required = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_PAGES_PROJECT', 'PRODUCTION_WEB_URL'];
for (const name of required) {
  if (!process.env[name]?.trim()) throw new Error(`${name} is required`);
}
const projectName = process.env.CLOUDFLARE_PAGES_PROJECT.trim();
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID.trim();
const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}`, {
  headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN.trim()}` },
  signal: AbortSignal.timeout(30_000),
});
if (!response.ok) throw new Error(`Production Pages project is unavailable (HTTP ${response.status}); check Cloudflare access and CLOUDFLARE_PAGES_PROJECT`);
const payload = await response.json();
if (!payload.success || payload.result?.name !== projectName) throw new Error('Cloudflare did not confirm the production Pages project');
const project = payload.result;
if (project.production_branch !== 'master') throw new Error('Production Pages project must use the master branch');
const hostname = new URL(process.env.PRODUCTION_WEB_URL).hostname;
if (![project.subdomain, ...(project.domains ?? [])].includes(hostname)) throw new Error('PRODUCTION_WEB_URL does not match the production Pages project');
console.log('Cloudflare access, production Pages project, branch and hostname verified.');
