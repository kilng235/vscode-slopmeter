#!/usr/bin/env python3
"""Read OpenCode SQLite database and output JSON messages."""
import sqlite3
import json
import sys
import os
import shutil
import tempfile

def read_opencode_db(db_path, start_ms, end_ms):
    """Read messages from opencode.db, handle WAL mode."""
    tmp_dir = tempfile.mkdtemp(prefix='slopmeter-')
    try:
        tmp_db = os.path.join(tmp_dir, 'opencode.db')
        shutil.copy2(db_path, tmp_db)
        for suffix in ['-wal', '-shm']:
            src = db_path + suffix
            if os.path.exists(src):
                shutil.copy2(src, tmp_db + suffix)

        conn = sqlite3.connect(f'file:{tmp_db}?mode=ro', uri=True)
        cursor = conn.execute(
            "SELECT id, data FROM message WHERE time_created >= ? AND time_created <= ? ORDER BY time_created ASC",
            [start_ms, end_ms]
        )
        results = []
        for row_id, data in cursor:
            try:
                msg = json.loads(data)
                msg['id'] = msg.get('id') or str(row_id)
                results.append(msg)
            except json.JSONDecodeError:
                pass
        conn.close()
        return results
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

if __name__ == '__main__':
    db_path = sys.argv[1]
    start_ms = int(sys.argv[2])
    end_ms = int(sys.argv[3])
    messages = read_opencode_db(db_path, start_ms, end_ms)
    json.dump(messages, sys.stdout)
