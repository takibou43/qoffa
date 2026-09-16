/**
 * قُفّة — التحقق من تطابق قاعدة البيانات الفعلية مع prisma/schema.prisma
 *
 * يقارن: الجداول، الأعمدة، الأنواع، قابلية NULL، وقيم الـenums.
 * يفيد خصوصًا في البيئات التي تُطبَّق فيها الهجرات عبر scripts/migrate-apply.mjs.
 *
 * الاستعمال: npm run db:verify
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, '..', 'prisma', 'schema.prisma');

const SCALAR_TO_PG: Record<string, string> = {
  String: 'text',
  Int: 'integer',
  BigInt: 'bigint',
  Float: 'double precision',
  Decimal: 'numeric',
  Boolean: 'boolean',
  DateTime: 'timestamp without time zone',
  Json: 'jsonb',
  Bytes: 'bytea',
};

interface Field {
  name: string;
  type: string;
  optional: boolean;
  isList: boolean;
}
interface Model {
  name: string;
  fields: Field[];
}

function parseSchema(src: string) {
  const enums = new Map<string, string[]>();
  const models: Model[] = [];

  const blockRe = /^(model|enum)\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(src))) {
    const [, kind, name, body] = m;
    const lines = body!
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, '').trim())
      .filter((l) => l && !l.startsWith('///') && !l.startsWith('@@'));

    if (kind === 'enum') {
      enums.set(name!, lines.filter((l) => /^\w+$/.test(l)));
      continue;
    }

    const fields: Field[] = [];
    for (const line of lines) {
      const fm = /^(\w+)\s+([\w\[\]?]+)(\s+.*)?$/.exec(line);
      if (!fm) continue;
      const rawType = fm[2]!;
      fields.push({
        name: fm[1]!,
        type: rawType.replace(/[\[\]?]/g, ''),
        optional: rawType.includes('?'),
        isList: rawType.includes('[]'),
      });
    }
    models.push({ name: name!, fields });
  }
  return { enums, models };
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL غير محدد.');

  const src = readFileSync(SCHEMA_PATH, 'utf8');
  const { enums, models } = parseSchema(src);
  const modelNames = new Set(models.map((mm) => mm.name));

  const client = new pg.Client({ connectionString });
  await client.connect();
  const problems: string[] = [];

  try {
    const { rows: cols } = await client.query<{
      table_name: string;
      column_name: string;
      data_type: string;
      udt_name: string;
      is_nullable: string;
    }>(
      `SELECT table_name, column_name, data_type, udt_name, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public'`,
    );

    const byTable = new Map<string, Map<string, (typeof cols)[number]>>();
    for (const c of cols) {
      if (!byTable.has(c.table_name)) byTable.set(c.table_name, new Map());
      byTable.get(c.table_name)!.set(c.column_name, c);
    }

    const { rows: enumRows } = await client.query<{ enum_name: string; value: string }>(
      `SELECT t.typname AS enum_name, e.enumlabel AS value
         FROM pg_type t
         JOIN pg_enum e ON e.enumtypid = t.oid
         JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
        ORDER BY e.enumsortorder`,
    );
    const dbEnums = new Map<string, string[]>();
    for (const r of enumRows) {
      if (!dbEnums.has(r.enum_name)) dbEnums.set(r.enum_name, []);
      dbEnums.get(r.enum_name)!.push(r.value);
    }

    // enums
    for (const [name, values] of enums) {
      const dbValues = dbEnums.get(name);
      if (!dbValues) {
        problems.push(`enum مفقود في قاعدة البيانات: ${name}`);
        continue;
      }
      const missing = values.filter((v) => !dbValues.includes(v));
      const extra = dbValues.filter((v) => !values.includes(v));
      if (missing.length) problems.push(`enum ${name}: قيم ناقصة في DB → ${missing.join(', ')}`);
      if (extra.length) problems.push(`enum ${name}: قيم زائدة في DB → ${extra.join(', ')}`);
    }

    // models
    for (const model of models) {
      const table = byTable.get(model.name);
      if (!table) {
        problems.push(`جدول مفقود: ${model.name}`);
        continue;
      }
      for (const field of model.fields) {
        // تخطي حقول العلاقات (نوعها اسم model) والقوائم
        if (modelNames.has(field.type) || field.isList) continue;

        const col = table.get(field.name);
        if (!col) {
          problems.push(`عمود مفقود: ${model.name}.${field.name}`);
          continue;
        }

        const expectedNullable = field.optional ? 'YES' : 'NO';
        if (col.is_nullable !== expectedNullable) {
          problems.push(
            `${model.name}.${field.name}: NULL متوقع=${expectedNullable} فعلي=${col.is_nullable}`,
          );
        }

        if (enums.has(field.type)) {
          if (col.udt_name !== field.type) {
            problems.push(
              `${model.name}.${field.name}: نوع enum متوقع=${field.type} فعلي=${col.udt_name}`,
            );
          }
        } else {
          const expected = SCALAR_TO_PG[field.type];
          if (!expected) continue;
          if (col.data_type !== expected) {
            problems.push(
              `${model.name}.${field.name}: نوع متوقع=${expected} فعلي=${col.data_type}`,
            );
          }
        }
      }

      // أعمدة زائدة في DB
      const schemaCols = new Set(
        model.fields.filter((f) => !modelNames.has(f.type) && !f.isList).map((f) => f.name),
      );
      for (const colName of table.keys()) {
        if (!schemaCols.has(colName)) {
          problems.push(`عمود زائد في DB: ${model.name}.${colName}`);
        }
      }
    }
  } finally {
    await client.end();
  }

  if (problems.length) {
    console.error(`\n✖ وُجد ${problems.length} اختلاف بين المخطط وقاعدة البيانات:\n`);
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }

  console.log(
    `✔ قاعدة البيانات مطابقة للمخطط (${models.length} جدول، ${enums.size} enum).`,
  );
}

main().catch((err) => {
  console.error('فشل التحقق:', err);
  process.exit(1);
});
