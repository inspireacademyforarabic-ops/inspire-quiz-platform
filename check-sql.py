"""Checks every SQL statement in src/ against migrations/*.sql using SQLite (no network, no npm).
Run: python3 scripts/check-sql.py   (statements built with ${...} at runtime are skipped)"""
import glob, re, sqlite3, sys
db = sqlite3.connect(':memory:')
for f in sorted(glob.glob('migrations/*.sql')):
    db.executescript(open(f).read())
ok = bad = skipped = 0
for f in glob.glob('src/**/*.ts*', recursive=True):
    s = open(f).read()
    for m in re.finditer(r"prepare\(\s*(`|'|\")", s):
        q, i = m.group(1), m.end(); j = i
        while True:
            j = s.index(q, j)
            if s[j - 1] != '\\': break
            j += 1
        sql = s[i:j]
        if '${' in sql: skipped += 1; continue
        try: db.execute('EXPLAIN ' + sql, [None] * sql.count('?')); ok += 1
        except Exception as e: bad += 1; print('BAD', f, e, '|', sql[:90].replace('\n', ' '))
print(f'{ok} ok, {bad} bad, {skipped} dynamic (skipped)')
sys.exit(1 if bad else 0)
