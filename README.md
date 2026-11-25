# GFC-Manager (삼성생명 GFC 프리미엄 수입지출 관리 시스템)

## 프로젝트 개요
삼성생명 GFC 플래너를 위한 계약 관리, 성과 보너스 계산, 자기계약 수지 분석 및 현금흐름 예측 시스템입니다.

## 기술 구성
- Frontend: HTML5, Tailwind CSS, Chart.js, Lucide Icons
- Backend: Flask + Gunicorn (same-origin `/api`)
- Database: Oracle VM의 PostgreSQL 16
- Authentication: 서버 세션 쿠키(HttpOnly) + CSRF 토큰
- Browser storage: 계산/화면 편의를 위한 클라이언트 상태. 인증 및 계약 원본 데이터는 서버 DB에 저장합니다.

## Oracle PostgreSQL 마이그레이션
작업 브랜치: `migration/oracle-postgres`

- 브라우저에서 Supabase SDK를 제거했습니다.
- `backend/app.py`가 인증, 프로필, 계약 CRUD API를 제공합니다.
- API는 `127.0.0.1:8011`에만 바인딩하고 Caddy를 통해 전용 HTTPS 호스트에서 same-origin으로 공개합니다.
- DB 접속 정보와 비밀키는 Git에 넣지 않고 `/etc/gfc-manager/gfc-manager.env`에 보관합니다.
- 회원가입은 관리자(`ADMIN_EMAIL`, 기본 seongkyos@naver.com)가 헤더의 메일 아이콘으로 만든 **이메일별 초대코드**가 있어야 하며, 가입 이메일과 코드가 일치해야 합니다. `backend/invites.sql`을 DB에 1회 실행해야 합니다.
- 서비스 유닛 예시는 `backend/gfc-manager.service`, 환경변수 예시는 `backend/gfc-manager.env.example`입니다.

## 로컬 실행
1. Python 가상환경을 만들고 `pip install -r backend/requirements.txt`를 실행합니다.
2. `backend/gfc-manager.env.example`을 참고해 환경변수를 설정합니다.
3. `python backend/app.py`로 API를 실행합니다.
4. 프런트엔드와 API가 동일한 origin에서 제공되도록 리버스 프록시를 구성합니다.

## 데이터 보호 및 컷오버
Supabase는 최종 데이터 대조와 실제 로그인/CRUD 인수 테스트가 완료되고 별도 승인되기 전까지 유지합니다. 2026-10-21 가져오기 스냅샷은 최신 운영 데이터와 동일하다고 간주하지 않습니다.
