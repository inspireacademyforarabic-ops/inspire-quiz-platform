import { execSync } from 'node:child_process'
import fs from 'node:fs'

const W = process.env.WRANGLER || 'npx wrangler'
const cfgPath = process.env.WRANGLER_CONFIG || 'wrangler.jsonc'
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
const db = cfg.d1_databases[0]
const run = (args) => execSync(`${W} ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
const find = () => JSON.parse(run('d1 list --json')).find((d) => (d.name || d.database_name) === db.database_name)

let found = find()
if (!found) {
  console.log(`Creating database ${db.database_name}…`)
  run(`d1 create ${db.database_name}`)
  found = find()
}
const id = found && (found.uuid || found.database_id)
if (!id) { console.error('Could not find the database id'); process.exit(1) }
db.database_id = id
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2))
console.log(`Database ${db.database_name} ready (${id})`)
