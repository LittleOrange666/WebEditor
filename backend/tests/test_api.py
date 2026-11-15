from datetime import timedelta

from app.db import new_session
from app.maintenance import cleanup
from app.models import Entry, Share, User
from app.storage import now
from conftest import PW, login, register

API = '/api/v1'


def push(client, h, *changes):
    r = client.post(f'{API}/sync', json={'changes': list(changes)}, headers=h)
    assert r.status_code == 200, r.text
    return r.json()['results']


def proj(pid, name='P', base=0):
    return {'type': 'project', 'id': pid, 'op': 'put', 'baseRev': base, 'data': {'name': name}}


def ent(eid, pid, path, content='x', base=0, kind='file'):
    data = {'projectId': pid, 'path': path, 'kind': kind}
    if kind == 'file':
        data['content'] = content
    return {'type': 'entry', 'id': eid, 'op': 'put', 'baseRev': base, 'data': data}


# ---------- 帳號 ----------

def test_register_login_and_errors(client):
    h = register(client, 'Alice')
    me = client.get(f'{API}/me', headers=h).json()
    assert me['username'] == 'Alice' and me['canDeleteSelf'] and me['quotaBytes'] == 50 * 1024 * 1024
    # 不分大小寫唯一
    r = client.post(f'{API}/auth/register', json={'username': 'alice', 'password': PW})
    assert r.status_code == 409 and r.json()['error']['code'] == 'username_taken'
    # 錯誤訊息不透露帳號是否存在
    a = client.post(f'{API}/auth/login', json={'username': 'alice', 'password': 'wrong-pass'}).json()
    b = client.post(f'{API}/auth/login', json={'username': 'nobody', 'password': 'wrong-pass'}).json()
    assert a == b and a['error']['message'] == '帳號或密碼錯誤'
    assert client.post(f'{API}/auth/register', json={'username': 'ab', 'password': PW}).status_code == 422
    assert client.post(f'{API}/auth/register', json={'username': 'bob', 'password': 'short'}).status_code == 422


def test_registration_toggle(client, admin):
    assert client.get(f'{API}/config').json()['allowRegistration'] is True
    client.patch(f'{API}/admin/settings', json={'allowRegistration': False}, headers=admin)
    assert client.get(f'{API}/config').json()['allowRegistration'] is False
    r = client.post(f'{API}/auth/register', json={'username': 'bob', 'password': PW})
    assert r.status_code == 403 and r.json()['error']['code'] == 'registration_closed'


def test_rate_limit(client):
    for _ in range(10):
        client.post(f'{API}/auth/login', json={'username': 'x', 'password': 'y' * 8})
    assert client.post(f'{API}/auth/login', json={'username': 'x', 'password': 'y' * 8}).status_code == 429


def test_logout_and_password_change_revoke_tokens(client):
    h1 = register(client, 'carol')
    h2 = login(client, 'carol')
    assert client.post(f'{API}/auth/logout', headers=h1).status_code == 200
    assert client.get(f'{API}/me', headers=h1).status_code == 401
    assert client.get(f'{API}/me', headers=h2).status_code == 200
    r = client.post(f'{API}/me/password', json={'oldPassword': PW, 'newPassword': 'newpassword'}, headers=h2)
    assert r.status_code == 200
    assert client.get(f'{API}/me', headers=h2).status_code == 401
    login(client, 'carol', 'newpassword')


def test_cors_and_corp_headers(client):
    r = client.options(f'{API}/config', headers={'Origin': 'http://localhost:5173', 'Access-Control-Request-Method': 'POST',
                                                 'Access-Control-Request-Headers': 'authorization,content-type'})
    assert r.headers['access-control-allow-origin'] == 'http://localhost:5173'
    r = client.get(f'{API}/config', headers={'Origin': 'https://evil.example'})
    assert 'access-control-allow-origin' not in r.headers
    assert r.headers['cross-origin-resource-policy'] == 'cross-origin'
    r = client.post(f'{API}/auth/login', content='a=b', headers={'Content-Type': 'application/x-www-form-urlencoded'})
    assert r.status_code == 415
    assert client.get(f'{API}/nope').json()['error']['code'] == 'not_found'


# ---------- 刪除帳號的保護規則 ----------

def test_self_delete_rules(client, admin):
    # 自行註冊：可以刪除
    h = register(client, 'dave')
    assert client.request('DELETE', f'{API}/me', json={'password': 'bad-password'}, headers=h).status_code == 403
    assert client.request('DELETE', f'{API}/me', json={'password': PW}, headers=h).status_code == 200
    # 管理員建立的帳號：不能自己刪除
    client.post(f'{API}/admin/users', json={'username': 'eve', 'password': PW}, headers=admin)
    he = login(client, 'eve')
    assert client.get(f'{API}/me', headers=he).json()['canDeleteSelf'] is False
    r = client.request('DELETE', f'{API}/me', json={'password': PW}, headers=he)
    assert r.status_code == 403 and r.json()['error']['code'] == 'admin_created'
    # 初始管理員：不能自己刪除
    r = client.request('DELETE', f'{API}/me', json={'password': PW}, headers=admin)
    assert r.status_code == 403 and r.json()['error']['code'] == 'protected_account'


def test_initial_admin_fully_protected(client, admin):
    client.post(f'{API}/admin/users', json={'username': 'admin2', 'password': PW}, headers=admin)
    users = client.get(f'{API}/admin/users', headers=admin).json()['users']
    root = next(u for u in users if u['username'] == 'root')
    a2 = next(u for u in users if u['username'] == 'admin2')
    assert root['isInitialAdmin'] and a2['origin'] == 'admin'
    client.patch(f'{API}/admin/users/{a2["id"]}', json={'isAdmin': True}, headers=admin)
    h2 = login(client, 'admin2')
    for patch in ({'isDisabled': True}, {'isAdmin': False}):
        r = client.patch(f'{API}/admin/users/{root["id"]}', json=patch, headers=h2)
        assert r.status_code == 403 and r.json()['error']['code'] == 'protected_account'
    r = client.request('DELETE', f'{API}/admin/users/{root["id"]}', json={'confirm': 'root'}, headers=h2)
    assert r.status_code == 403
    # 其他管理員可以重設初始管理員的密碼
    assert client.patch(f'{API}/admin/users/{root["id"]}', json={'password': 'resetpass1'}, headers=h2).status_code == 200
    login(client, 'root', 'resetpass1')
    # 初始管理員可以取消其他管理員
    h_root = login(client, 'root', 'resetpass1')
    assert client.patch(f'{API}/admin/users/{a2["id"]}', json={'isAdmin': False}, headers=h_root).status_code == 200


def test_non_admin_forbidden(client):
    h = register(client, 'frank')
    for method, path in (('GET', '/admin/users'), ('GET', '/admin/shares'), ('GET', '/admin/settings')):
        assert client.request(method, f'{API}{path}', headers=h).status_code == 403


def test_disable_user_revokes_and_hides_shares(client, admin):
    h = register(client, 'gina')
    sid = client.post(f'{API}/shares', json={'kind': 'file', 'title': 't', 'files': [{'path': 'a.cpp', 'content': 'int main(){}'}]},
                      headers=h).json()['id']
    assert client.get(f'{API}/s/{sid}').status_code == 200
    uid = client.get(f'{API}/me', headers=h).json()['id']
    client.patch(f'{API}/admin/users/{uid}', json={'isDisabled': True}, headers=admin)
    assert client.get(f'{API}/me', headers=h).status_code == 401
    r = client.post(f'{API}/auth/login', json={'username': 'gina', 'password': PW})
    assert r.status_code == 403 and r.json()['error']['message'] == '此帳號已被停用'
    assert client.get(f'{API}/s/{sid}').status_code == 404
    client.patch(f'{API}/admin/users/{uid}', json={'isDisabled': False}, headers=admin)
    assert client.get(f'{API}/s/{sid}').status_code == 200


# ---------- 同步 ----------

def test_sync_roundtrip_and_isolation(client):
    ha = register(client, 'hank')
    hb = register(client, 'ivy')
    res = push(client, ha, proj('p1', 'Proj'), ent('d1', 'p1', 'src', kind='dir'), ent('f1', 'p1', 'src/main.cpp', 'A'))
    assert [r['status'] for r in res] == ['ok', 'ok', 'ok']
    pull = client.get(f'{API}/sync?since=0', headers=ha).json()
    assert pull['full'] and [p['name'] for p in pull['projects']] == ['Proj']
    assert {e['path'] for e in pull['entries']} == {'src', 'src/main.cpp'}
    # 他人看不到也改不了
    assert client.get(f'{API}/sync?since=0', headers=hb).json()['projects'] == []
    r = push(client, hb, ent('f1', 'p1', 'src/main.cpp', 'hack'))
    assert r[0]['status'] == 'rejected'
    # 增量
    cursor = pull['cursor']
    push(client, ha, ent('f1', 'p1', 'src/main.cpp', 'B', base=res[2]['rev']))
    inc = client.get(f'{API}/sync?since={cursor}', headers=ha).json()
    assert [e['content'] for e in inc['entries']] == ['B'] and inc['projects'] == []


def test_sync_rejects_non_code_and_oversize(client, admin):
    h = register(client, 'jack')
    push(client, h, proj('p'))
    r = push(client, h, ent('t', 'p', 'notes.txt', 'hi'), ent('big', 'p', 'big.cpp', 'x' * (256 * 1024 + 1)))
    assert [x['reason'] for x in r] == ['not_syncable', 'too_large']
    client.patch(f'{API}/admin/settings', json={'project_bytes': 2048}, headers=admin)
    r = push(client, h, ent('a', 'p', 'a.cpp', 'x' * 1500), ent('b', 'p', 'b.cpp', 'x' * 1500))
    assert [x['status'] for x in r] == ['ok', 'rejected'] and r[1]['reason'] == 'project_too_large'
    uid = client.get(f'{API}/me', headers=h).json()['id']
    client.patch(f'{API}/admin/users/{uid}', json={'quotaBytes': 1600}, headers=admin)
    r = push(client, h, ent('a', 'p', 'a.cpp', 'y' * 1500, base=r[0]['rev']), ent('c', 'p', 'c.cpp', 'z' * 200))
    assert [x['status'] for x in r] == ['ok', 'rejected'] and r[1]['reason'] == 'quota_exceeded'


def test_sync_conflicts(client):
    h = register(client, 'kate')
    r = push(client, h, proj('p'), ent('f', 'p', 'main.cpp', 'v1'))
    rev1 = r[1]['rev']
    # 裝置 A 改成 v2
    rev2 = push(client, h, ent('f', 'p', 'main.cpp', 'v2', base=rev1))[0]['rev']
    # 裝置 B 以 rev1 為基礎改成 v3 → 衝突，附雲端版本
    c = push(client, h, ent('f', 'p', 'main.cpp', 'v3', base=rev1))[0]
    assert c['status'] == 'conflict' and c['current']['content'] == 'v2'
    # 內容相同 → 視為成功；只改名 → 後到者為準
    assert push(client, h, ent('f', 'p', 'main.cpp', 'v2', base=rev1))[0]['status'] == 'ok'
    pull = client.get(f'{API}/sync?since=0', headers=h).json()
    cur = next(e for e in pull['entries'] if e['id'] == 'f')
    r = push(client, h, ent('f', 'p', 'renamed.cpp', 'v2', base=rev2))[0]
    assert r['status'] == 'ok' and r['path'] == 'renamed.cpp'
    # 本地刪除 vs 雲端修改 → 保留雲端
    d = push(client, h, {'type': 'entry', 'id': 'f', 'op': 'delete', 'baseRev': cur['rev'] - 5})[0]
    assert d['status'] == 'conflict'
    # 雲端已刪除 vs 本地修改 → 衝突（前端以新 id 重新上傳）
    rev = d['current']['rev']
    push(client, h, {'type': 'entry', 'id': 'f', 'op': 'delete', 'baseRev': rev})
    c = push(client, h, ent('f', 'p', 'renamed.cpp', 'v9', base=rev))[0]
    assert c['status'] == 'conflict' and c['current']['deleted']


def test_sync_path_collisions(client):
    h = register(client, 'leo')
    push(client, h, proj('p'), ent('d1', 'p', 'src', kind='dir'), ent('f1', 'p', 'a.cpp', '1'))
    r = push(client, h, ent('d2', 'p', 'SRC', kind='dir'), ent('f2', 'p', 'A.cpp', '2'))
    assert r[0]['status'] == 'merged' and r[0]['current']['id'] == 'd1'
    assert r[1]['status'] == 'ok' and r[1]['path'] == 'A (1).cpp'


def test_delete_project_tombstones(client):
    h = register(client, 'mia')
    push(client, h, proj('p'), ent('f', 'p', 'a.py', 'print(1)'))
    cursor = client.get(f'{API}/sync?since=0', headers=h).json()['cursor']
    push(client, h, {'type': 'project', 'id': 'p', 'op': 'delete', 'baseRev': 0})
    inc = client.get(f'{API}/sync?since={cursor}', headers=h).json()
    assert inc['projects'][0]['deleted'] and inc['entries'][0]['deleted']
    assert client.get(f'{API}/sync?since=0', headers=h).json()['projects'] == []
    # 被刪除的專案不能再加入檔案
    assert push(client, h, ent('g', 'p', 'b.py', '1'))[0]['reason'] == 'project_deleted'


def test_settings_sync_and_pagination(client):
    h = register(client, 'nina')
    push(client, h, {'type': 'settings', 'op': 'put', 'data': {'value': {'theme': 'dark'}}})
    push(client, h, proj('p'), *[ent(f'f{i}', 'p', f'f{i}.js', str(i)) for i in range(5)])
    page1 = client.get(f'{API}/sync?since=0&limit=2', headers=h).json()
    assert page1['settings']['value'] == {'theme': 'dark'} and page1['more'] and len(page1['entries']) == 2
    seen = [e['id'] for e in page1['entries']]
    cursor = page1['cursor']
    while True:
        page = client.get(f'{API}/sync?since={cursor}&limit=2', headers=h).json()
        seen += [e['id'] for e in page['entries']]
        cursor = page['cursor']
        if not page['more']:
            break
    assert sorted(seen) == [f'f{i}' for i in range(5)]


def test_purged_tombstones_force_full_resync(client):
    h = register(client, 'olga')
    push(client, h, proj('p'), ent('f', 'p', 'a.js', '1'))
    cursor = client.get(f'{API}/sync?since=0', headers=h).json()['cursor']
    push(client, h, {'type': 'entry', 'id': 'f', 'op': 'delete', 'baseRev': 99})
    with new_session() as db:
        for e in db.query(Entry).filter(Entry.deleted.is_(True)):
            e.updated_at = now() - timedelta(days=31)
        db.commit()
        cleanup(db)
    r = client.get(f'{API}/sync?since={cursor}', headers=h).json()
    assert r['reset'] and r['full']


# ---------- 分享 ----------

def test_share_lifecycle(client):
    h = register(client, 'paul')
    body = {'kind': 'project', 'title': '作業', 'expiresInDays': 7, 'files': [
        {'path': 'src', 'kind': 'dir'}, {'path': 'src/main.cpp', 'content': 'int main(){}'}]}
    s = client.post(f'{API}/shares', json=body, headers=h).json()
    assert len(s['id']) == 10 and s['expiresAt']
    pub = client.get(f'{API}/s/{s["id"]}').json()  # 不需登入
    assert pub['author']['username'] == 'paul' and pub['viewCount'] == 1 and len(pub['files']) == 2
    assert client.get(f'{API}/s/{s["id"]}').json()['viewCount'] == 2
    assert client.get(f'{API}/me', headers=h).json()['usedBytes'] == len('int main(){}')
    assert [x['id'] for x in client.get(f'{API}/shares', headers=h).json()['shares']] == [s['id']]
    # 他人不能撤銷
    other = register(client, 'quinn')
    assert client.delete(f'{API}/shares/{s["id"]}', headers=other).status_code == 404
    assert client.delete(f'{API}/shares/{s["id"]}', headers=h).status_code == 200
    assert client.get(f'{API}/s/{s["id"]}').status_code == 404


def test_share_validation_and_expiry(client):
    h = register(client, 'rose')
    assert client.post(f'{API}/shares', json={'kind': 'file', 'title': 't', 'files': []}).status_code == 401
    bad = [
        {'kind': 'file', 'title': 't', 'files': [{'path': 'a.txt', 'content': 'x'}]},
        {'kind': 'file', 'title': 't', 'files': [{'path': 'a.cpp', 'content': '   '}]},
        {'kind': 'file', 'title': 't', 'files': [{'path': 'a.cpp', 'content': 'x'}, {'path': 'b.cpp', 'content': 'y'}]},
        {'kind': 'file', 'title': 't', 'files': [{'path': '../a.cpp', 'content': 'x'}]},
    ]
    for b in bad:
        assert client.post(f'{API}/shares', json=b, headers=h).status_code in (413, 422), b
    sid = client.post(f'{API}/shares', json={'kind': 'file', 'title': 't', 'expiresInDays': 1,
                                             'files': [{'path': 'a.py', 'content': 'x'}]}, headers=h).json()['id']
    with new_session() as db:
        db.get(Share, sid).expires_at = now() - timedelta(seconds=1)
        db.commit()
    assert client.get(f'{API}/s/{sid}').status_code == 404
    with new_session() as db:
        assert cleanup(db)['shares'] == 1


# ---------- 管理 ----------

def test_admin_projects_and_shares(client, admin):
    h = register(client, 'sam')
    push(client, h, proj('p', 'Homework'), ent('f', 'p', 'a.cpp', 'abc'))
    uid = client.get(f'{API}/me', headers=h).json()['id']
    projects = client.get(f'{API}/admin/users/{uid}/projects', headers=admin).json()['projects']
    assert projects[0]['name'] == 'Homework' and projects[0]['fileCount'] == 1 and projects[0]['size'] == 3
    detail = client.get(f'{API}/admin/projects/p', headers=admin).json()
    assert detail['entries'][0]['content'] == 'abc'
    cursor = client.get(f'{API}/sync?since=0', headers=h).json()['cursor']
    assert client.delete(f'{API}/admin/projects/p', headers=admin).status_code == 200
    assert client.get(f'{API}/sync?since={cursor}', headers=h).json()['projects'][0]['deleted']

    sid = client.post(f'{API}/shares', json={'kind': 'file', 'title': 'hello', 'files': [{'path': 'a.cpp', 'content': 'x'}]},
                      headers=h).json()['id']
    listed = client.get(f'{API}/admin/shares?q=hello', headers=admin).json()
    assert listed['total'] == 1 and listed['shares'][0]['author']['username'] == 'sam'
    assert client.delete(f'{API}/admin/shares/{sid}', headers=admin).status_code == 200

    # 刪除帳號需輸入使用者名稱確認，並連同資料刪除
    assert client.request('DELETE', f'{API}/admin/users/{uid}', json={'confirm': 'x'}, headers=admin).status_code == 422
    assert client.request('DELETE', f'{API}/admin/users/{uid}', json={'confirm': 'sam'}, headers=admin).status_code == 200
    with new_session() as db:
        assert db.get(User, uid) is None
        assert db.query(Entry).count() == 0


def test_last_admin_and_self_rules(client, admin):
    me = client.get(f'{API}/me', headers=admin).json()
    r = client.patch(f'{API}/admin/users/{me["id"]}', json={'isDisabled': True}, headers=admin)
    assert r.status_code == 403  # 初始管理員不可停用（同時也是自己）
    client.post(f'{API}/admin/users', json={'username': 'tom', 'password': PW}, headers=admin)
    tom = next(u for u in client.get(f'{API}/admin/users', headers=admin).json()['users'] if u['username'] == 'tom')
    client.patch(f'{API}/admin/users/{tom["id"]}', json={'isAdmin': True}, headers=admin)
    ht = login(client, 'tom')
    assert client.patch(f'{API}/admin/users/{tom["id"]}', json={'isAdmin': False}, headers=ht).status_code == 409


def test_request_size_limit(client):
    h = register(client, 'uma')
    big = 'x' * (4 * 1024 * 1024 + 10)
    r = client.post(f'{API}/sync', content='{"changes":[],"pad":"' + big + '"}',
                    headers={**h, 'Content-Type': 'application/json'})
    assert r.status_code == 413
