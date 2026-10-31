# KGB_Agent 배포·실행 가이드

이 저장소는 **GitHub에 올린 코드 그대로** 웹사이트로 배포할 수 있게 구성되어 있습니다(ADR-019).
현재 단계에서는 사용자 1인이 확인·사용하는 개인용 사이트(스테이징)를 기준으로 합니다.

---

## 1. Render로 배포하기 (권장, 클릭 몇 번)

저장소 루트의 `render.yaml`(Blueprint)이 **웹 서비스 + PostgreSQL**을 한 번에 만듭니다.

1. [Render](https://render.com)에 GitHub 계정으로 가입·로그인합니다.
2. 대시보드에서 **New → Blueprint**를 누르고 이 저장소(`business-agent-lab`)를 선택합니다.
   - 배포할 브랜치를 고릅니다(작업 브랜치 또는 `main`에 병합한 뒤 `main`).
3. Render가 `render.yaml`을 읽고 `kgb-agent`(웹)와 `kgb-db`(DB)를 보여줍니다. 아래 두 값을 입력합니다.
   - `INITIAL_ADMIN_EMAIL`: 처음 로그인할 관리자 이메일
   - `INITIAL_ADMIN_PASSWORD`: 10자 이상 비밀번호 (저장소에는 절대 커밋하지 않습니다)
4. **Apply**를 누르면 빌드 → DB 마이그레이션 → 관리자 계정 생성 → 서버 시작이 자동으로 진행됩니다.
5. 완료되면 `https://kgb-agent-xxxx.onrender.com` 같은 주소가 생깁니다. 접속해 위 관리자 계정으로 로그인합니다.

이후에는 **GitHub에 푸시할 때마다 자동으로 다시 배포**됩니다(`autoDeploy: true`).

### 자동으로 설정되는 값
| 키 | 값 | 설명 |
|---|---|---|
| `DATABASE_URL` | Render DB 연결 문자열 | 자동 연결 |
| `AUTH_SECRET`, `FILE_URL_SECRET` | 무작위 생성 | 자동 생성 |
| `APP_ENV` | `staging` | 화면 상단에 "테스트 환경 — 실제 데이터 입력 금지" 띠 표시. 실제 운영으로 쓸 때 `production`으로 변경 |
| `AI_PROVIDER` | `none` | AI 기능 끔(수동 기능은 정상). AI는 Phase 5부터 — 그때 `anthropic` + `ANTHROPIC_API_KEY` 입력 |
| `STORAGE_DRIVER` | `db` | 업로드 파일을 DB에 저장(별도 스토리지 계정 불필요) |
| `WORKER_MODE` | `inline` | 백그라운드 작업을 웹 서비스 안에서 실행(서비스 1개로 운영) |

### 플랜·비용 주의
- `render.yaml`은 웹·DB 모두 `free` 플랜으로 되어 있습니다.
  - 무료 웹 서비스는 한동안 접속이 없으면 잠들고, 다음 접속 때 깨어나느라 수십 초 걸립니다.
  - **무료 DB는 보존 기간 제한이 있어 데이터가 삭제될 수 있습니다.** 계속 쓸 데이터라면 Render 대시보드에서 DB 플랜을 유료로 바꾸세요.
- 정확한 요금·제한은 Render 요금표에서 확인하세요.

### 데모 데이터를 넣고 싶을 때
Render 대시보드 → `kgb-agent` → **Shell**에서:
```bash
SEED_DEMO=true SEED_DEMO_PASSWORD='데모용-비밀번호-10자이상' npm run db:seed
```
데모 데이터는 가상 인물·가상 연락처이며 화면에 "데모 데이터"로 표시됩니다.

---

## 2. 내 컴퓨터에서 실행하기

필요: Node.js 22 이상, pnpm 10, Docker(또는 직접 설치한 PostgreSQL 16)

```bash
pnpm install
```
```bash
docker compose up -d
```
```bash
cp .env.example .env.local
```
`.env.local`에서 `AUTH_SECRET`(32자 이상), `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD`를 채운 뒤:
```bash
pnpm db:migrate && pnpm db:seed
```
```bash
pnpm dev
```
브라우저에서 http://localhost:3000 으로 접속합니다.

## 3. 테스트

```bash
pnpm test
```
```bash
pnpm test:rules
```
```bash
pnpm build && pnpm test:e2e
```
- `pnpm test`: 단위 + 통합 테스트(테스트 DB `kgb_test` 사용 — `docker compose`가 자동 생성)
- `pnpm test:rules`: 규칙 엔진 분기 커버리지 100% 검사
- `pnpm test:e2e`: 실제 브라우저(Playwright)로 로그인·초대·권한 흐름 검사. 처음 한 번 `pnpm exec playwright install chromium` 필요

## 4. 대안: Railway
Railway에서 저장소를 연결하고 PostgreSQL 플러그인을 추가한 뒤, 같은 명령을 설정하면 됩니다.
- Build: `npx --yes pnpm@10.28.0 install --frozen-lockfile && npm run build`
- Start: `npm run db:migrate && npm run admin:ensure && npm run start`
- 환경변수: 위 표와 동일(`AUTH_SECRET`은 직접 무작위 값 입력)
