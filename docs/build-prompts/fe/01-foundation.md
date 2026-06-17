# 01 · 파운데이션 (스캐폴드) — 먼저 실행

> 사용법: 새 Claude Code 세션을 **repo 루트**에서 열고, 아래 "프롬프트" 블록 전체를 붙여넣으세요.

---

## 프롬프트

너는 CP2K(양자화학 DFT) 시뮬레이션 에이전트의 **새 프런트엔드**를 만든다. 확정 디자인은 "Lab Paper"이고, 백엔드(`backend/`, 포트 8000 — be/* 프롬프트로 함께 빌드)에 연결한다. 이 작업은 **공유 파운데이션 스캐폴드**만 만든다(개별 기능 화면은 이후 프롬프트가 채움).

### 먼저 읽어라 (단일 소스 오브 트루스)
- `docs/design-system.md` — 토큰(§2), 레이아웃 3-존 콕핏(§4), **CSS 함정(§4.5)**, 컴포넌트 카탈로그(§3), 파일 배치(§1.2). 색·간격·컴포넌트 모양·상호작용의 픽셀 단위 시각 레퍼런스도 여기에 맞춘다.
- `docs/ARCHITECTURE.md`, `docs/backend-structure.md` — 6개 기능과 백엔드 구조 맥락.

### 만들 것
1. **Next.js 앱 생성**: repo의 `frontend/` 에 App Router + TypeScript + Tailwind로 초기화. 패키지: `lucide-react`, `3dmol`, `chart.js` + `react-chartjs-2`, `zustand`, `clsx`/`tailwind-merge`. shadcn/ui 초기화(가능하면).
2. **폰트**: `next/font/google`로 Fraunces(헤딩)·Inter(본문)·JetBrains Mono(수치) 로드. 한글 폴백 포함.
3. **디자인 토큰**: design-system.md §2의 값을 `app/globals.css`의 `:root` CSS 변수 + `tailwind.config.ts`의 `theme.extend`로 1:1 반영(하드코딩 금지, 토큰만). `lib/tokens.ts`에 차트/뷰어 JS 상수(CHART/VIEWER 색)도 박제.
4. **3-존 콕핏 셸**(design-system.md §4): `components/layout/AppShell.tsx`(grid `280px minmax(0,1fr) 300px`, 접힘 시 우측 0), `StepRail`(좌, 6단계 상태 완료/현재/잠금 + **그 아래 구분선 + [정확도 벤치마크] 상시 진입 행** — flow와 독립이라 **항상 활성**(잠금 규칙 무관, step-1 첫 화면부터 클릭 가능), 클릭 시 `router.push('/benchmark')`; design-system §3.5), `Workspace`(가운데, 헤더 고정 + 본문 내부 스크롤), `SummaryPanel`(우, 접기/펼치기 토글 + step-aware). **§4.5 CSS 함정 반드시 준수**: 100vh 그리드는 `grid-template-rows:minmax(0,1fr)`, 모든 스크롤 조상에 `min-height:0`, 동일 높이 카드는 `height` 금지(`align-items:stretch`만), 그리드 카드 `margin-top:0`.
5. **공유 UI 컴포넌트**(`components/ui/`, design-system.md §3): Button, Card, Badge, StatusBadge, FormField(label+control), Segmented, ChipToggle, Table, **LogTerminal**(다크 터미널), **ConvergenceChart**(react-chartjs-2, 로그축), **MoleculeViewer**(3Dmol, 자동회전 + 오프라인 SVG 폴백 — **언마운트/재실행 시 `spin(false)` + 캔버스 제거로 WebGL 컨텍스트를 완전 해제**해야 단계 이동 누적 프리징을 막음; design-system §3.11 정리 절차 준수). 아이콘은 lucide-react만(이모지 금지).
6. **상태/세션**: `stores/wizard-store.ts` — Zustand + persist(localStorage). **저장 정책(design-system §4.6 준수)**: ① **입력만 영속**(구조/물성/플랜/옵션/생성파일/진행단계) — 런타임·잡 상태(`jobName`/`subJobs`/`activeSubJobKey`/`jobLive`/`benchmarkStatus`/리포트)는 **persist 제외**(죽은 잡 복원·"실행 중" 유령 방지). ② persist에 **`version` + `migrate`(불일치 시 폐기)**. ③ **`reset()` 액션**(상태 초기화 + `persist.clearStorage()`)을 core 슬라이스에 두고, **사이드바 푸터("자동저장됨" 옆)에 "새 계산" 버튼**으로 노출(step-6 "새 분석 시작"도 동일 `reset()` 사용). SummaryPanel·진행률은 이 스토어를 step-aware로 구독.
7. **API 클라이언트**: `lib/api.ts` — `const API = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000"`. fetch 래퍼(JSON + multipart 지원, 에러 처리). **★ HTTP 메서드 기본값 규칙(필수): 요청 본문(`json` 또는 `form`)이 있으면 호출부가 `method`를 안 줘도 자동으로 `POST`로 보낸다**(본문 없으면 `GET`; 호출부가 `method`를 명시하면 그게 우선). 래퍼 내부에서 `const method = opts.method ?? (hasBody ? "POST" : "GET")`처럼 본문 유무로 메서드를 결정한 뒤 `fetch(url, { ...rest, method, headers, body })`로 호출한다. **이 규칙이 없으면 본문을 가진 호출이 기본 `GET`으로 나가 브라우저가 `Failed to execute 'fetch' on 'Window': Request with GET/HEAD method cannot have body` 에러를 던진다**(실제로 f3 `/generate-inp`에서 발생). **`process.env.NEXT_PUBLIC_MOCK === "1"`이면 클러스터 의존 호출을 목으로 대체**하는 스위치 지점을 마련(실제 목 데이터는 각 기능 프롬프트가 채움). `.env.local.example`에 `NEXT_PUBLIC_API_BASE`, `NEXT_PUBLIC_MOCK` 기재.
8. **i18n**: `lib/i18n/`에 ko/en 사전 + 간단한 `t()` 훅(원본의 data-i18n 대체). 기본 ko.
9. **라우팅**: `app/(wizard)/layout.tsx`(AppShell 적용) + `step-1`~`step-6/page.tsx` **및 `benchmark/page.tsx`**(독립 라우트 `/benchmark` — flow와 무관, AppShell 재사용; 내용은 fe/07이 채움)를 **플레이스홀더**로 생성(다음 프롬프트가 내용 채움). `/` → `step-1` 리다이렉트. **StepRail의 [정확도 벤치마크] 행은 파운데이션이 직접 `/benchmark`로 라우팅**(기능 프롬프트가 배선할 필요 없음 — 첫 화면부터 독립 동작 보장).

### 병렬 안전 — 공유 표면을 여기서 전부 확정 (★ fe/02~07 병렬의 전제)
이후 기능 프롬프트(fe/02~07)가 **서로 다른 파일만** 건드려 충돌 없이 병렬 실행되도록, 공유되는 것은 **전부 이 파운데이션에서 확정**한다:
- **wizard-store**: 6개 기능 전체의 상태 필드·액션을 미리 정의하거나 `stores/slices/f1..f6.ts` 슬라이스로 분리해 하나의 store로 합성. 각 기능은 자기 슬라이스/필드만 읽고 쓰며 **store 골격 파일은 수정하지 않는다**.
- **단계 메타데이터**: 6단계 라벨·순서·잠금 규칙을 `lib/steps.ts` 한 곳에 정의하고 `StepRail`은 이를 렌더. 기능은 StepRail을 건드리지 않는다.
- **i18n**: `lib/i18n/<feature>.ts`로 사전을 기능별 분리(기능은 자기 사전 파일만 추가).
- **API**: `lib/api.ts`는 base URL·`NEXT_PUBLIC_MOCK` 스위치·공통 fetch 래퍼만(위 ★ 메서드 기본값 규칙 포함). 엔드포인트 래퍼/목 데이터는 각 기능의 `features/<도메인>/api.ts`에 둔다. **각 기능 래퍼는 계약(api.md)의 메서드를 지키되**(POST 엔드포인트는 `method: "POST"` 명시 권장), 래퍼의 본문-기반 자동 POST가 안전망으로 동작한다 — 둘 중 하나라도 있으면 GET+body 에러는 안 난다.
- 결과적으로 각 기능 프롬프트(fe/02~07)는 **`app/(wizard)/step-N/` + `features/<도메인>/` + `lib/i18n/<feature>.ts`(+ 자기 store 슬라이스)** 만 생성/수정한다 → 같은 파일을 동시에 안 건드려 병렬 충돌 0.

### 검증 후 보고
- `cd frontend && npm run dev`로 빌드/기동되는지 확인하고, 타입 에러 0을 목표로 한다.
- 3-존 셸이 100vh에서 **세로 전역 스크롤 없이** 뜨고, 가운데 본문만 내부 스크롤되며, 우측 패널 접기/펼치기가 동작하는지 확인.
- 완료 후: 생성한 파일 트리, 실행 방법(백엔드 :8000 + 프런트 :3000), 토큰/컴포넌트가 design-system.md와 일치하는지 요약.

### 완료 정의 (DoD)
- [ ] `frontend`가 `npm run dev`로 기동, 타입체크 통과.
- [ ] Lab Paper 토큰이 globals.css + tailwind.config에 design-system.md §2와 일치.
- [ ] 3-존 셸 + StepRail/Workspace/SummaryPanel이 §4.5 함정 없이 동작(전역 스크롤 X, 본문 내부 스크롤 O, 우측 토글 O).
- [ ] 공유 UI 컴포넌트(특히 MoleculeViewer·ConvergenceChart·LogTerminal)가 빈 상태로라도 렌더됨.
- [ ] **MoleculeViewer 언마운트 시 3Dmol 완전 해제**(`spin(false)` + 캔버스/WebGL 컨텍스트 제거) — 단계를 여러 번 오가도 WebGL 컨텍스트가 누적되지 않음(콘솔에 "Too many active WebGL contexts" 경고 없음).
- [ ] `lib/api.ts`가 `NEXT_PUBLIC_API_BASE`/`NEXT_PUBLIC_MOCK` 스위치를 가짐.
- [ ] `lib/api.ts` fetch 래퍼가 **본문(`json`/`form`) 있으면 자동 `POST`**(명시 `method` 우선) — 본문 가진 호출이 `GET`으로 나가 `GET/HEAD ... cannot have body` 에러를 내지 않음.
- [ ] step-1~6 + `benchmark` 라우트 플레이스홀더 + wizard-store + i18n 존재.
- [ ] **StepRail [정확도 벤치마크] 상시 진입 행이 step-1(첫 화면)부터 보이고 항상 활성**(6단계 잠금과 무관), 클릭 시 `/benchmark`로 이동.
- [ ] persist는 **입력만 저장**(잡/런타임 상태 제외) + `version`/`migrate` 적용. **"새 계산"(reset) 버튼**(사이드바 푸터)이 상태+localStorage를 비움. 새로고침 시 입력은 복원되되 잡은 복원 안 됨(step-5는 제출 화면).
