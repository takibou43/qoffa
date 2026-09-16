/**
 * قُفّة — تطبيق هجرات Prisma بدون الحاجة إلى تنزيل محرك Rust.
 *
 * لماذا؟ بعض بيئات التطوير/CI تمنع الوصول إلى binaries.prisma.sh.
 * هذا السكربت يطبّق نفس ملفات prisma/migrations/<name>/migration.sql
 * ويسجّلها في جدول _prisma_migrations بنفس الصيغة التي يستعملها Prisma،
 * حتى يبقى `prisma migrate deploy` و`prisma migrate status` متوافقين تمامًا.
 *
 * الاستعمال:  node scripts/migrate-apply.mjs
 * في بيئة عادية (بإنترنت مفتوح) استعمل `npx prisma migrate deploy` مباشرة.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'prisma', 'migrations');

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                    VARCHAR(36) PRIMARY KEY NOT NULL,
    "checksum"              VARCHAR(64) NOT NULL,
    "finished_at"           TIMESTAMPTZ,
    "migration_name"        VARCHAR(255) NOT NULL,
    "logs"                  TEXT,
    "rolled_back_at"        TIMESTAMPTZ,
    "started_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count"   INTEGER NOT NULL DEFAULT 0
);`;

function countStatements(sql) {
  return sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean).length;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL غير محدد.');
    process.exit(1);
  }

  const client = new pg.Client({ connectionString });
  await client.connect();

  try {
    await client.query(CREATE_TABLE);

    const { rows: applied } = await client.query(
      'SELECT migration_name, checksum FROM "_prisma_migrations" WHERE rolled_back_at IS NULL',
    );
    const appliedMap = new Map(applied.map((r) => [r.migration_name, r.checksum]));

    const dirs = readdirSync(MIGRATIONS_DIR)
      .filter((d) => statSync(path.join(MIGRATIONS_DIR, d)).isDirectory())
      .sort();

    let appliedCount = 0;

    for (const dir of dirs) {
      const sqlPath = path.join(MIGRATIONS_DIR, dir, 'migration.sql');
      const sql = readFileSync(sqlPath, 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');

      if (appliedMap.has(dir)) {
        if (appliedMap.get(dir) !== checksum) {
          throw new Error(
            `تعارض: الهجرة "${dir}" مطبّقة سابقًا لكن محتواها تغيّر. لا تعدّل هجرة مطبّقة — أنشئ هجرة جديدة.`,
          );
        }
        console.log(`• ${dir} — مطبّقة مسبقًا، تم التخطي`);
        continue;
      }

      const id = randomUUID();
      const steps = countStatements(sql);
      console.log(`→ تطبيق ${dir} (${steps} تعليمة)...`);

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO "_prisma_migrations"
             (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
           VALUES ($1, $2, now(), $3, NULL, NULL, now(), $4)`,
          [id, checksum, dir, steps],
        );
        await client.query('COMMIT');
        appliedCount++;
        console.log(`✔ ${dir}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    console.log(
      appliedCount === 0
        ? '\nقاعدة البيانات محدّثة — لا توجد هجرات معلّقة.'
        : `\nتم تطبيق ${appliedCount} هجرة بنجاح.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('\nفشل تطبيق الهجرات:', err.message);
  process.exit(1);
});
