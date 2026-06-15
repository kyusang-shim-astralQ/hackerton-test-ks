# 03 · f2-plan — 2단계(물성 선택) + 3단계(DFT 옵션 + AI 플랜 생성)

> 사용법: `01-foundation.md` 완료 후, 새/같은 세션(프로젝트 루트)에 아래 프롬프트를 붙여넣으세요.

---

## 프롬프트

너는 **f2-plan** 기능(2단계 물성 선택, 3단계 DFT 옵션 + AI 계산 플랜 생성)을 `frontend-next`에 구현하고 백엔드에 연결한다.

### 먼저 읽어라 (단일 소스)
- `docs/features/f2-plan/api.md` — `POST /generate-plan`의 요청/응답 계약(`PlanRequest` → `{atom_info, steps[], expert_tip}`).
- `docs/contracts/data-models.md` — `PlanRequest`, `PlanStep`, `PlanResult`의 정확한 필드(특히 `active_tokens`는 step 키가 아니라 요청 동적 속성임에 주의).
- `docs/design-system.md` §4.2(2·3단계) + `docs/mockups/a-paper-hifi.html`(3단계 화면: 전자 구조 설정 | SCF 수렴 설정 카드, 그 아래 전체 폭 AI 계산 플랜).

### 만들 것
1. **2단계 (`step-2`) 물성 선택**: 카테고리(정적/동역학·열적/화학반응성/광학/전자·전하/기타)별 토글 칩(다중 선택). 선택을 wizard-store에 저장. 광학(absorption/emission) 선택 시 "TDDFPT → k-point 비활성/DIAGONALIZATION 고정" 안내.
2. **3단계 (`step-3`) DFT 옵션**: 두 설정 카드를 **동일 높이로 나란히**(design-system §4.5 — `height` 금지·stretch만, 그리드 카드 `margin-top:0`):
   - 전자 구조 설정: 범함수/기저/유사퍼텐셜/평면파·상대 컷오프/k-점 격자/스핀(RKS·UKS).
   - SCF 수렴 설정: EPS_SCF/최대 SCF/혼합/스미어링/최적화기(BFGS·CG·L-BFGS).
   - 폼 값은 `PlanRequest` 필드와 1:1, store에 동기화.
3. **AI 계산 플랜(전체 폭, 두 카드 아래)**: [플랜 생성] → `POST /generate-plan`(body=store에서 조립한 `PlanRequest`, 대용량 `content`는 비용 절약 위해 제거 후 전송). 응답의 `steps[]`/`expert_tip`을 store에 저장하고 **플래너 로그 영역**에 진행/결과를 표시. 성공 시 [다음] → step-4 활성화.

### 연결/상태
- 실제 백엔드(:8000)로 동작. `/generate-plan`은 **Claude API 키 필요**(backend `.env`의 `CLAUDE_API_KEY`). 키 없거나 `NEXT_PUBLIC_MOCK=1`이면 `data-models.md`의 `PlanResult` 형태(예: GeomOpt→SCF→Band→DOS 다단계 `steps[]` + expert_tip) 목 응답으로 대체해 흐름 유지.
- 로딩(생성 중 스피너/로그 스트림)·에러 처리.

### 완료 정의 (DoD)
- [ ] 2단계 물성 다중 선택이 store에 반영, 광학 안내 동작.
- [ ] 3단계 두 카드가 동일 높이로 정렬, 폼 값이 `PlanRequest`와 일치.
- [ ] [플랜 생성]이 실제 `/generate-plan`(또는 목)으로 `steps[]`+`expert_tip`을 받아 store에 저장.
- [ ] 우측 패널 "물성/핵심 옵션" 채워지고 진행률 갱신.
