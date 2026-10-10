"""Offline SQL syntax/privacy check; pip install pglast==7.7 first."""
import sys
from pathlib import Path
from pglast import parse_sql, ast

nodes = parse_sql(Path(sys.argv[1]).read_text())
inserts = [node.stmt for node in nodes if isinstance(node.stmt, ast.InsertStmt)]
assert len(inserts) == 3
assert all(node.relation.schemaname == 'storage' and node.relation.relname == 'buckets' for node in inserts)
assert not any(isinstance(node.stmt, ast.CopyStmt) for node in nodes)
assert not any(isinstance(node.stmt, ast.CreateRoleStmt) for node in nodes)
print(f'PASS PostgreSQL parser: {len(nodes)} statements; only bucket configuration inserts, no row/auth-user import.')
