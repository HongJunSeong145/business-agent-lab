# 운영 가이드 (OPERATIONS)

## 1. 구성
| 구성 | 내용 |
|---|---|
| 웹 + 작업 처리기 | Render 웹 서비스 1개(`kgb-agent`). 백그라운드 작업(추출·AI·매일 점검)도 같은 서버 안에서 실행(`WORKER_MODE=inline`) |
| 데이터베이스 | Render PostgreSQL 16(`kgb-db`). 업로드 파일도 DB에 저장(`STORAGE_DRIVER=db`) |
| AI | Anthropic Claude API(`ANTHROPIC_API_KEY`), 기본 모델 `claude-opus-5-5`, **하루 3,000원 상한(코드 고정)** |
| 자동 작업 | 매일 09:00(한국 시간) 사업 진행 점검(A7) → 알림·사무국 노티스, 월요일 주간 요약 |
| 상태 확인 주소 | `/api/health` (Render 헬스체크) |

## 2. 매일·매주 할 일
- 매일: 알림 확인. 무료 플랜이라 09:00 점검이 빠졌으면 **재정 → 지금 점검**
- 매주: **설정 → 백업 내려받기**(관리자) → 안전한 곳(학생회 공용 드라이브 등, 접근 제한)에 보관
- 매주: **설정**의 오늘 AI 사용액 확인

## 3. 백업과 복원
### 백업
- 화면: 관리자 로그인 → **설정 → 백업 → 전체 백업 내려받기** (JSON, 업로드 파일 포함)
- 명령: `pnpm backup:export 파일이름.json` (`DATABASE_URL` 대상)
- 백업 파일에는 인적사항·연락처가 들어 있습니다. 공개된 곳에 올리지 마세요.

### 복원(되돌리기)
1. 복원할 DB에 먼저 표를 만듭니다: `pnpm db:migrate`
2. `pnpm backup:restore 파일이름.json -- --yes` — **대상 DB의 현재 데이터는 모두 백업 내용으로 바뀝니다**
3. 운영 DB 복원은 `--i-know-this-is-production` 까지 붙여야 실행됩니다.
4. 복원 후 Render에서 **Manual Deploy → Restart**

### 리허설 결과 (2026-10-31)
새 DB에 마이그레이션 → 스테이징과 같은 시작 절차(관리자·데모 데이터) → 백업 → 빈 DB에 복원 → 42개 표의 행 수 해시·업무 내용 해시·파일 바이트가 모두 일치. 자동 테스트: `tests/integration/backup.test.ts`.

## 4. 비밀값(키) 관리
| 값 | 어디에 | 교체 방법 |
|---|---|---|
| `ANTHROPIC_API_KEY` | Render Environment 에만 | Anthropic 콘솔에서 새 키 → Render 에 붙여 넣기 → Save and deploy → 이전 키 삭제 |
| `AUTH_SECRET` | Render가 자동 생성 | 바꾸면 **모두 로그아웃**됩니다. Environment 에서 Generate → 배포 |
| `FILE_URL_SECRET` | Render가 자동 생성 | 바꾸면 이미 열린 파일 링크만 무효(10분짜리라 영향 작음) |
| `INITIAL_ADMIN_PASSWORD` | Render Environment | 처음 계정 만들 때만 씀. 이후 비밀번호는 사이트의 **내 계정**에서 바꾸세요 |

- 코드·GitHub·채팅에는 키를 넣지 않습니다. 저장소에 키 모양 문자열이 있으면 자동 테스트(`tests/unit/no-secrets.test.ts`)가 실패합니다.
- 키가 노출됐다고 의심되면 즉시 콘솔에서 해당 키를 삭제하고 새로 발급하세요.

## 5. 장애 대응
| 증상 | 확인 | 조치 |
|---|---|---|
| 사이트가 안 열림 | Render 상태가 Live 인지, Logs 의 마지막 오류 | 잠든 상태면 1분 대기. 계속이면 **Manual Deploy → Restart** |
| 업로드·추출이 멈춤 | 회의록 상태가 계속 "추출 중" | 1분마다 멈춘 작업을 자동 재전송합니다. 10분 넘으면 Restart |
| AI 분석 실패 | 회의록의 "분석 실패" 사유 | 키 문제면 4장, 예산 초과면 다음 날 자동 진행 |
| DB 용량 부족 | Render DB 화면의 Storage | 오래된 회의록 파일 정리 또는 DB 플랜 상향 |

## 6. 테스트 데이터 초기화 (스테이징 전용)
`npm run staging:reset -- --yes && npm run db:seed` — 운영(`APP_ENV=production`)에서는 실행을 거부합니다.

## 7. 운영 전환 체크리스트 (스테이징 → 실제 사용)
- [ ] **DB**: 유료 플랜(백업·보존 기간 확인) 또는 새 운영 DB 생성 — 스테이징 DB와 분리
- [ ] **도메인**(선택): Render → Settings → Custom Domains 에서 학생회 도메인 연결
- [ ] **환경**: `APP_ENV=production` (노란 띠가 사라지고, 초기화·mock AI가 막힘)
- [ ] **데모 데이터 제거**: Shell 에서 `npm run demo:remove -- --yes`, 그리고 `SEED_DEMO` 를 `false` 로
- [ ] **키 교체**: 새 Anthropic 키 발급·입력, 스테이징 키 삭제, `AUTH_SECRET` 새로 생성
- [ ] **관리자**: 실제 회장 계정 초대 → 관리자 권한 부여 → 초기 관리자 비밀번호 변경
- [ ] **학생회 정보**: 설정에서 기수·학사일정(분기), 규칙 파라미터·공휴일, 배너
- [ ] **인적사항·연락망**: 실제 데이터 입력(개인정보 수집·이용 동의 확인)
- [ ] **백업**: 첫 백업을 받고 복원 리허설 1회
- [ ] **AI 예산**: 하루 3,000원 상한 유지 여부 결정(바꾸려면 코드의 `AI_DAILY_BUDGET_CAP_KRW` 수정)
- [ ] **무료 플랜 해제 검토**: 잠들지 않아야 매일 09:00 점검이 정확히 돕니다

## 8. 보안 점검 결과 (Phase 10)
| 항목 | 상태 |
|---|---|
| 보안 헤더 | 페이지 iframe 금지(X-Frame-Options DENY + CSP frame-ancestors), nosniff, Referrer-Policy, Permissions-Policy, HSTS, `X-Powered-By` 숨김. 파일 응답은 같은 사이트 미리보기만(SAMEORIGIN) + sandbox CSP(PDF 제외) |
| 로그인 | argon2id 해시, 5회 실패 15분 잠금, 비밀번호 변경 시 다른 기기 세션 무효 |
| 업로드 | 50MB 상한(본문 받기 전 413), 확장자 + 파일 내용(매직바이트) 검사, SVG·HTML·실행 파일 거부, 파일은 로그인 + 10분 서명 링크 + 기수 확인 |
| 권한 | 모든 API 서버에서 권한 검사(역할 매트릭스 자동 테스트), 로그인 없이 API 401 |
| AI | 문서 속 지시문 무시(실제 모델로 확인), 출력은 스키마 검증, 링크는 실제 검색 결과만, 개인정보 마스킹 후 전송, 하루 비용 상한 |
| 비밀값 | 키는 환경변수에만. 저장소·빌드 결과·git 기록에 키 없음 확인 |
