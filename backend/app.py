import os
import re
import time
import hmac
import hashlib
import secrets
import threading
import uuid
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from functools import wraps
from contextlib import contextmanager

import bcrypt
import psycopg2
from psycopg2.extras import RealDictCursor, Json
from psycopg2 import errors
from flask import Flask, request, jsonify, g, make_response
from werkzeug.exceptions import HTTPException
from werkzeug.middleware.proxy_fix import ProxyFix

DATABASE_URL = os.environ.get("DATABASE_URL", "")
SECRET_KEY = os.environ.get("SECRET_KEY", "")
APP_ORIGIN = os.environ.get("APP_ORIGIN", "").rstrip("/")
COOKIE_NAME = os.environ.get("SESSION_COOKIE_NAME", "gfc_session")
SESSION_DAYS = int(os.environ.get("SESSION_DAYS", "30"))
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "true").lower() == "true"
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "seongkyos@naver.com").strip().lower()
INVITE_DAYS = 7
INVITE_MAX_ATTEMPTS = 5
INVITE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # 헷갈리는 0/O, 1/I/L 제외

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL 환경변수가 필요합니다.")
if len(SECRET_KEY) < 32:
    raise RuntimeError("SECRET_KEY는 32자 이상의 임의 문자열이어야 합니다.")

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 1024 * 1024
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

DEFAULT_SETTINGS = {"clubTier": "club_350", "joinDate": "2025-01"}
LOGIN_WINDOW_SECONDS = 15 * 60
LOGIN_MAX_ATTEMPTS = 8
attempts = defaultdict(deque)
attempts_lock = threading.Lock()

CONTRACT_FIELDS = {
    "contractType": "contract_type",
    "status": "status",
    "terminationMonth": "termination_month",
    "productGroup": "product_group",
    "client": "client",
    "company": "company",
    "title": "title",
    "startDate": "start_date",
    "premium": "premium",
    "paymentYears": "payment_years",
    "tp": "tp",
    "surrenderValue16": "surrender_value_16",
    "promotions": "promotions",
    "memo": "memo",
}


@contextmanager
def db_connection():
    conn = psycopg2.connect(
        DATABASE_URL,
        connect_timeout=5,
        application_name="gfc-manager-api",
    )
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def json_body():
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def origin_is_valid():
    origin = request.headers.get("Origin", "").rstrip("/")
    expected = APP_ORIGIN or request.host_url.rstrip("/")
    return bool(origin) and hmac.compare_digest(origin, expected)


def require_origin():
    if not origin_is_valid():
        return jsonify(error="요청 출처를 확인할 수 없습니다."), 403
    return None


def token_digest(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def csrf_value(token):
    return hmac.new(
        SECRET_KEY.encode("utf-8"),
        token.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def verify_csrf(token):
    supplied = request.headers.get("X-CSRF-Token", "")
    expected = csrf_value(token)
    return bool(supplied) and hmac.compare_digest(supplied, expected)


def issue_session(user_id):
    raw_token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)
    with db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO public.app_sessions
                   (user_id, token_hash, expires_at, user_agent)
                   VALUES (%s, %s, %s, %s)""",
                (
                    user_id,
                    token_digest(raw_token),
                    expires_at,
                    request.headers.get("User-Agent", "")[:500],
                ),
            )
    return raw_token


def public_user(row):
    return {
        "id": str(row["id"]),
        "username": row["username"],
        "email": row["email"],
    }


def current_user():
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            digest = token_digest(token)
            cur.execute(
                """SELECT u.id, u.username, u.email
                   FROM public.app_sessions s
                   JOIN public.app_users u ON u.id = s.user_id
                   WHERE s.token_hash = %s
                     AND s.revoked_at IS NULL
                     AND s.expires_at > now()
                     AND u.is_active = TRUE
                   LIMIT 1""",
                (digest,),
            )
            row = cur.fetchone()
            if row:
                cur.execute(
                    "UPDATE public.app_sessions SET last_seen_at = now() WHERE token_hash = %s",
                    (digest,),
                )
            return public_user(row) if row else None


def authenticated(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        token = request.cookies.get(COOKIE_NAME)
        if not token:
            return jsonify(error="로그인이 필요합니다."), 401
        user = current_user()
        if not user:
            return jsonify(error="로그인 세션이 만료되었습니다."), 401
        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            denied = require_origin()
            if denied:
                return denied
            if not verify_csrf(token):
                return jsonify(error="보안 토큰이 유효하지 않습니다. 새로고침 후 다시 시도해주세요."), 403
        g.user = user
        return fn(*args, **kwargs)
    return wrapper


def rate_limit(key):
    now = time.monotonic()
    with attempts_lock:
        queue = attempts[key]
        while queue and now - queue[0] > LOGIN_WINDOW_SECONDS:
            queue.popleft()
        if len(queue) >= LOGIN_MAX_ATTEMPTS:
            return False
        queue.append(now)
        return True


def serialize_contract(row):
    if not row:
        return None
    result = dict(row)
    for key in ("premium", "tp", "surrender_value16", "surrender_value_16"):
        value = result.get(key)
        if value is not None:
            result[key] = float(value)
    for key in ("start_date", "created_at", "deleted_at"):
        value = result.get(key)
        if value is not None and hasattr(value, "isoformat"):
            result[key] = value.isoformat()
    result["promotions"] = result.get("promotions") or []
    result["is_deleted"] = bool(result.get("is_deleted"))
    return result


def contract_values(data, creating=False):
    values = {}
    defaults = {
        "contractType": "진성계약",
        "status": "정상유지",
        "terminationMonth": 0,
        "productGroup": "건강/상해보험",
        "client": "",
        "company": "삼성생명",
        "title": "",
        "startDate": datetime.now().date().isoformat(),
        "premium": 0,
        "paymentYears": 20,
        "tp": 0,
        "surrenderValue16": 0,
        "promotions": [],
        "memo": "",
    }
    for api_key, column in CONTRACT_FIELDS.items():
        if api_key in data:
            value = data[api_key]
        elif creating:
            value = defaults[api_key]
        else:
            continue
        if api_key == "promotions":
            value = Json(value if isinstance(value, list) else [])
        values[column] = value
    return values


@app.errorhandler(HTTPException)
def handle_http_error(exc):
    return jsonify(error=exc.description), exc.code


@app.errorhandler(Exception)
def handle_unexpected_error(exc):
    app.logger.exception("Unhandled API error")
    return jsonify(error="서버 내부 오류가 발생했습니다."), 500


@app.after_request
def security_headers(response):
    if request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
        response.headers["Pragma"] = "no-cache"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["X-Frame-Options"] = "DENY"
    return response


@app.get("/api/health")
def health():
    with db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
            cur.fetchone()
    return jsonify(status="ok")


@app.get("/api/auth/session")
def auth_session():
    user = current_user()
    token = request.cookies.get(COOKIE_NAME)
    return jsonify(
        user=user,
        csrfToken=csrf_value(token) if user and token else None,
    )


@app.post("/api/auth/login")
def login():
    denied = require_origin()
    if denied:
        return denied
    data = json_body()
    identifier = str(data.get("identifier") or data.get("email") or "").strip()
    password = str(data.get("password") or "")
    if not identifier or not password:
        return jsonify(error="아이디(또는 이메일)와 비밀번호를 입력해주세요."), 400

    ip = request.remote_addr or "unknown"
    if not rate_limit("login:" + ip):
        return jsonify(error="로그인 시도가 너무 많습니다. 15분 후 다시 시도해주세요."), 429

    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """SELECT id, username, email, password_hash, is_active
                   FROM public.app_users
                   WHERE lower(email) = lower(%s) OR lower(username) = lower(%s)
                   LIMIT 1""",
                (identifier, identifier),
            )
            row = cur.fetchone()
            valid = False
            if row and row["is_active"]:
                try:
                    # bcrypt accepts the imported $2a$ hashes without re-hashing them.
                    valid = bcrypt.checkpw(
                        password.encode("utf-8"),
                        row["password_hash"].encode("utf-8"),
                    )
                except (ValueError, TypeError):
                    valid = False
            if not valid:
                return jsonify(error="아이디 또는 비밀번호가 올바르지 않습니다."), 401
            cur.execute(
                "UPDATE public.app_users SET last_login_at = now() WHERE id = %s",
                (row["id"],),
            )
            user = public_user(row)

    raw_token = issue_session(user["id"])
    response = make_response(
        jsonify(user=user, csrfToken=csrf_value(raw_token))
    )
    response.set_cookie(
        COOKIE_NAME,
        raw_token,
        max_age=SESSION_DAYS * 24 * 60 * 60,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="Lax",
        path="/",
    )
    return response


def invite_digest(email, code):
    """초대코드는 DB에 원문으로 저장하지 않고 (이메일+코드) HMAC 해시만 저장합니다."""
    return hmac.new(
        SECRET_KEY.encode("utf-8"),
        f"invite:{email}:{code}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def normalize_invite_code(raw):
    return re.sub(r"\s+", "", str(raw or "")).upper()


INVITE_FAIL_MESSAGE = "이메일 또는 초대코드가 올바르지 않거나 만료되었습니다."


@app.post("/api/invites")
@authenticated
def create_invite():
    """관리자 전용: 입력한 이메일용 새 초대코드를 만들어 응답으로만 돌려줍니다(메일 발송 없음)."""
    if (g.user["email"] or "").lower() != ADMIN_EMAIL:
        return jsonify(error="초대코드를 만들 권한이 없습니다."), 403
    email = str(json_body().get("email") or "").strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        return jsonify(error="올바른 이메일 주소를 입력해주세요."), 400

    code = "".join(secrets.choice(INVITE_ALPHABET) for _ in range(8))
    expires_at = datetime.now(timezone.utc) + timedelta(days=INVITE_DAYS)
    with db_connection() as conn:
        with conn.cursor() as cur:
            # 같은 이메일의 이전 미사용 코드는 모두 폐기
            cur.execute(
                "DELETE FROM public.invites WHERE email = %s AND used_at IS NULL",
                (email,),
            )
            cur.execute(
                """INSERT INTO public.invites (email, code_hash, expires_at, created_by)
                   VALUES (%s, %s, %s, %s)""",
                (email, invite_digest(email, code), expires_at, g.user["id"]),
            )
    return jsonify(ok=True, email=email, code=code, expiresAt=expires_at.isoformat())


def require_admin():
    """관리자(ADMIN_EMAIL) 계정이 아니면 403 응답을 돌려줍니다. 통과하면 None."""
    if (g.user["email"] or "").lower() != ADMIN_EMAIL:
        return jsonify(error="관리자만 사용할 수 있습니다."), 403
    return None


@app.get("/api/admin/users")
@authenticated
def admin_list_users():
    """관리자 전용: 가입 계정 목록 (계정별 계약 건수 포함)."""
    denied = require_admin()
    if denied:
        return denied
    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """SELECT u.id, u.email, u.last_login_at,
                          (SELECT count(*) FROM public.contracts c WHERE c.user_id = u.id) AS contract_count
                   FROM public.app_users u
                   ORDER BY lower(u.email)"""
            )
            rows = cur.fetchall()
    return jsonify(
        users=[
            {
                "id": str(r["id"]),
                "email": r["email"],
                "lastLoginAt": r["last_login_at"].isoformat() if r["last_login_at"] else None,
                "contractCount": int(r["contract_count"]),
                "isAdmin": (r["email"] or "").lower() == ADMIN_EMAIL,
                "isSelf": str(r["id"]) == str(g.user["id"]),
            }
            for r in rows
        ]
    )


@app.delete("/api/admin/users/<user_id>")
@authenticated
def admin_delete_user(user_id):
    """관리자 전용: 계정과 그 계정의 모든 데이터(계약, 세션, 프로필, 초대코드)를 영구 삭제합니다."""
    denied = require_admin()
    if denied:
        return denied
    try:
        target_id = str(uuid.UUID(str(user_id)))
    except ValueError:
        return jsonify(error="잘못된 계정 ID입니다."), 400
    if target_id == str(g.user["id"]):
        return jsonify(error="본인 계정은 삭제할 수 없습니다."), 400
    confirm_email = str(json_body().get("confirmEmail") or "").strip().lower()

    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT id, email FROM public.app_users WHERE id = %s FOR UPDATE",
                (target_id,),
            )
            target = cur.fetchone()
            if not target:
                return jsonify(error="삭제할 계정을 찾을 수 없습니다."), 404
            email = (target["email"] or "").lower()
            if email == ADMIN_EMAIL:
                return jsonify(error="관리자 계정은 삭제할 수 없습니다."), 400
            if confirm_email != email:
                return jsonify(error="확인용 이메일이 일치하지 않습니다."), 400

            # 한 트랜잭션으로 처리: 중간에 하나라도 실패하면 전부 취소됩니다.
            cur.execute("DELETE FROM public.app_sessions WHERE user_id = %s", (target_id,))
            cur.execute("DELETE FROM public.contracts WHERE user_id = %s", (target_id,))
            deleted_contracts = cur.rowcount
            cur.execute("DELETE FROM public.profiles WHERE id = %s", (target_id,))
            cur.execute("DELETE FROM public.invites WHERE email = %s", (email,))
            cur.execute("DELETE FROM public.app_users WHERE id = %s", (target_id,))
    return jsonify(ok=True, email=email, deletedContracts=deleted_contracts)


@app.post("/api/auth/signup")
def signup():
    denied = require_origin()
    if denied:
        return denied
    data = json_body()
    email = str(data.get("email") or "").strip().lower()
    password = str(data.get("password") or "")
    invite_code = normalize_invite_code(data.get("inviteCode"))

    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        return jsonify(error="회원가입에는 올바른 이메일 주소가 필요합니다."), 400
    if len(password) < 6:
        return jsonify(error="비밀번호는 6자 이상이어야 합니다."), 400
    if not invite_code:
        return jsonify(error="초대코드를 입력해주세요."), 400

    ip = request.remote_addr or "unknown"
    if not rate_limit("signup:" + ip):
        return jsonify(error="가입 요청이 너무 많습니다. 잠시 후 다시 시도해주세요."), 429

    username = email.split("@", 1)[0]
    password_hash = bcrypt.hashpw(
        password.encode("utf-8"),
        bcrypt.gensalt(rounds=12),
    ).decode("utf-8")
    try:
        with db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # 이 이메일로 발급된 가장 최근 미사용 코드를 잠그고 확인
                cur.execute(
                    """SELECT id, code_hash, expires_at, attempts
                       FROM public.invites
                       WHERE email = %s AND used_at IS NULL
                       ORDER BY created_at DESC LIMIT 1
                       FOR UPDATE""",
                    (email,),
                )
                invite = cur.fetchone()
                if (
                    not invite
                    or invite["expires_at"] <= datetime.now(timezone.utc)
                    or invite["attempts"] >= INVITE_MAX_ATTEMPTS
                ):
                    return jsonify(error=INVITE_FAIL_MESSAGE), 403
                if not hmac.compare_digest(invite["code_hash"], invite_digest(email, invite_code)):
                    cur.execute(
                        "UPDATE public.invites SET attempts = attempts + 1 WHERE id = %s",
                        (invite["id"],),
                    )
                    return jsonify(error=INVITE_FAIL_MESSAGE), 403  # 정상 반환이므로 오입력 횟수는 커밋됨

                cur.execute(
                    """INSERT INTO public.app_users
                       (id, username, email, password_hash, email_verified, is_active)
                       VALUES (gen_random_uuid(), %s, %s, %s, TRUE, TRUE)
                       RETURNING id""",
                    (username, email, password_hash),
                )
                new_user_id = cur.fetchone()["id"]
                cur.execute(
                    """INSERT INTO public.profiles (id, settings)
                       VALUES (%s, %s)
                       ON CONFLICT (id) DO NOTHING""",
                    (new_user_id, Json(DEFAULT_SETTINGS)),
                )
                cur.execute(
                    "UPDATE public.invites SET used_at = now() WHERE id = %s",
                    (invite["id"],),
                )
    except errors.UniqueViolation:
        return jsonify(error="이미 사용 중인 이메일 또는 아이디입니다."), 409
    return jsonify(ok=True)


@app.post("/api/auth/logout")
def logout():
    denied = require_origin()
    if denied:
        return denied
    token = request.cookies.get(COOKIE_NAME)
    if token:
        if not verify_csrf(token):
            return jsonify(error="보안 토큰이 유효하지 않습니다."), 403
        with db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """UPDATE public.app_sessions
                       SET revoked_at = now()
                       WHERE token_hash = %s AND revoked_at IS NULL""",
                    (token_digest(token),),
                )
    response = make_response(jsonify(ok=True))
    response.delete_cookie(
        COOKIE_NAME,
        path="/",
        secure=COOKIE_SECURE,
        httponly=True,
        samesite="Lax",
    )
    return response


@app.get("/api/profile")
@authenticated
def get_profile():
    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """INSERT INTO public.profiles (id, settings)
                   VALUES (%s, %s)
                   ON CONFLICT (id) DO NOTHING""",
                (g.user["id"], Json(DEFAULT_SETTINGS)),
            )
            cur.execute(
                "SELECT settings FROM public.profiles WHERE id = %s",
                (g.user["id"],),
            )
            row = cur.fetchone()
    return jsonify(
        settings=row["settings"] if row and row["settings"] else DEFAULT_SETTINGS
    )


@app.put("/api/profile")
@authenticated
def save_profile():
    settings = json_body().get("settings")
    if not isinstance(settings, dict):
        return jsonify(error="설정 데이터 형식이 올바르지 않습니다."), 400
    with db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO public.profiles (id, settings)
                   VALUES (%s, %s)
                   ON CONFLICT (id) DO UPDATE SET settings = EXCLUDED.settings""",
                (g.user["id"], Json(settings)),
            )
    return jsonify(ok=True)


@app.get("/api/contracts")
@authenticated
def get_contracts():
    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """SELECT * FROM public.contracts
                   WHERE user_id = %s AND is_deleted = FALSE
                   ORDER BY created_at DESC, id""",
                (g.user["id"],),
            )
            rows = cur.fetchall()
    return jsonify(contracts=[serialize_contract(row) for row in rows])


@app.get("/api/contracts/recently-deleted")
@authenticated
def get_recently_deleted():
    try:
        limit = max(1, min(int(request.args.get("limit", "10")), 50))
    except ValueError:
        limit = 10
    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """SELECT * FROM public.contracts
                   WHERE user_id = %s AND is_deleted = TRUE
                   ORDER BY deleted_at DESC NULLS LAST, created_at DESC
                   LIMIT %s""",
                (g.user["id"], limit),
            )
            rows = cur.fetchall()
    return jsonify(contracts=[serialize_contract(row) for row in rows])


@app.post("/api/contracts")
@authenticated
def add_contract():
    values = contract_values(json_body(), creating=True)
    columns = ["user_id"] + list(values.keys())
    params = [g.user["id"]] + list(values.values())
    placeholders = ["%s"] * len(columns)
    sql = (
        "INSERT INTO public.contracts (" + ", ".join(columns) + ") VALUES (" +
        ", ".join(placeholders) + ") RETURNING *"
    )
    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params)
            row = cur.fetchone()
    return jsonify(contract=serialize_contract(row)), 201


@app.put("/api/contracts/<contract_id>")
@authenticated
def update_contract(contract_id):
    values = contract_values(json_body(), creating=False)
    if not values:
        return jsonify(error="수정할 계약 정보가 없습니다."), 400
    assignments = [column + " = %s" for column in values.keys()]
    params = list(values.values()) + [contract_id, g.user["id"]]
    sql = (
        "UPDATE public.contracts SET " + ", ".join(assignments) +
        " WHERE id = %s AND user_id = %s AND is_deleted = FALSE RETURNING *"
    )
    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params)
            row = cur.fetchone()
    if not row:
        return jsonify(error="계약을 찾을 수 없거나 수정 권한이 없습니다."), 404
    return jsonify(contract=serialize_contract(row))


@app.delete("/api/contracts/<contract_id>")
@authenticated
def delete_contract(contract_id):
    with db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE public.contracts
                   SET is_deleted = TRUE, deleted_at = now()
                   WHERE id = %s AND user_id = %s AND is_deleted = FALSE""",
                (contract_id, g.user["id"]),
            )
            changed = cur.rowcount
    if not changed:
        return jsonify(error="삭제할 계약을 찾을 수 없습니다."), 404
    return jsonify(ok=True)


@app.post("/api/contracts/<contract_id>/restore")
@authenticated
def restore_contract(contract_id):
    with db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE public.contracts
                   SET is_deleted = FALSE, deleted_at = NULL
                   WHERE id = %s AND user_id = %s AND is_deleted = TRUE""",
                (contract_id, g.user["id"]),
            )
            changed = cur.rowcount
    if not changed:
        return jsonify(error="복원할 삭제 계약을 찾을 수 없습니다."), 404
    return jsonify(ok=True)


@app.delete("/api/contracts/<contract_id>/permanent")
@authenticated
def permanently_delete_contract(contract_id):
    with db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """DELETE FROM public.contracts
                   WHERE id = %s AND user_id = %s AND is_deleted = TRUE""",
                (contract_id, g.user["id"]),
            )
            changed = cur.rowcount
    if not changed:
        return jsonify(
            error="영구 삭제할 계약을 찾을 수 없습니다. 삭제된 계약만 영구 삭제할 수 있습니다."
        ), 404
    return jsonify(ok=True)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8011, debug=False)
