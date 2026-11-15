"""本機開發用：以開發預設值啟動後端（python backend/dev.py）

資料庫存在 backend/dev.db；初始管理員帳密取自 backend/.env.example 的範例值。
"""
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
os.chdir(HERE)
sys.path.insert(0, str(HERE))
os.environ.setdefault('DATABASE_URL', f'sqlite:///{(HERE / "dev.db").as_posix()}')
os.environ.setdefault('ALLOWED_ORIGINS', 'http://localhost:5173,http://localhost:5174')
os.environ.setdefault('ALLOW_REGISTRATION', 'true')
os.environ.setdefault('ADMIN_USERNAME', 'admin')
os.environ.setdefault('ADMIN_PASSWORD', 'change-me-please')

import uvicorn  # noqa: E402

if __name__ == '__main__':
    uvicorn.run('app.main:app', host='127.0.0.1', port=int(os.environ.get('API_PORT', '8000')), reload=False)
