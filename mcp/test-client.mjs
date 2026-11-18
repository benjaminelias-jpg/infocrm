import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'npx', args: ['tsx', 'src/index.ts'],
  env: { ...process.env, INFOCRM_API_URL: 'http://127.0.0.1:4000', INFOCRM_API_KEY: process.env.KEY },
});
const client = new Client({ name: 'test', version: '1.0.0' });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`Herramientas expuestas (${tools.length}):`);
for (const t of tools) console.log(`  - ${t.name}: ${t.description.slice(0,60)}…`);

console.log('\n== llamar resumen ==');
const r = await client.callTool({ name: 'resumen', arguments: {} });
console.log(r.content[0].text.slice(0, 400));

console.log('\n== llamar rendimiento_por_angulo ==');
const a = await client.callTool({ name: 'rendimiento_por_angulo', arguments: {} });
const angs = JSON.parse(a.content[0].text);
for (const x of angs) console.log(`  ${x.etiqueta}: ${x.leads} leads, ${x.ventas} ventas, ${x.ingresos}€`);

await client.close();
