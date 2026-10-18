"""Offline SQL syntax/privacy check; pip install pglast==7.7 first."""
import sys
from pathlib import Path
try:
    from pglast import parse_sql, ast  # pyright: ignore[reportMissingImports]
except ImportError:
    # Report as skip (exit 77) so the runner surfaces the gap without
    # claiming a pass; install with `pip install pglast==7.7` to enable.
    sys.stderr.write("SKIP pglast is not installed (pip install pglast==7.7)\n")
    sys.exit(77)
if len(sys.argv) < 2:
    sys.stderr.write("SKIP needs a demo-schema SQL path (metadata snapshot is private)\n")
    sys.exit(77)

nodes = parse_sql(Path(sys.argv[1]).read_text())
inserts = [node.stmt for node in nodes if isinstance(node.stmt, ast.InsertStmt)]
assert len(inserts) == 3
assert all(node.relation.schemaname == 'storage' and node.relation.relname == 'buckets' for node in inserts)
assert not any(isinstance(node.stmt, ast.CopyStmt) for node in nodes)
assert not any(isinstance(node.stmt, ast.CreateRoleStmt) for node in nodes)
print(f'PASS PostgreSQL parser: {len(nodes)} statements; only bucket configuration inserts, no row/auth-user import.')
