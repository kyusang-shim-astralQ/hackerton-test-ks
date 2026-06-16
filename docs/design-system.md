# CP2K Agent — 디자인 시스템 (Design System Contract)

> **목적**: 확정된 디자인 방향(**Lab Paper**)과 그 실제 토큰/레이아웃을 박제하여, Next.js(App Router) + TypeScript + Tailwind CSS + shadcn/ui 마이그레이션에서 6개 화면이 동일한 토큰/컴포넌트를 공유하도록 보장하는 **계약 문서**입니다.
> 본 문서에 적힌 토큰/컴포넌트/props는 **변경 시 합의가 필요한 공유 인터페이스**입니다. 추측한 값이 아니라 확정 목업에서 추출한 값만 담았습니다.
>
> - **시각 기준(source of truth)**: **이 문서(`design-system.md`)가 디자인 단일 기준**입니다. 모든 색·폰트·간격·radius·레이아웃 토큰의 단일 출처이며, 변경은 이 문서를 갱신합니다.
> - 엔드포인트 계약: `docs/features/<도메인>/api.md` (기능별 HTTP 명세), 데이터 모델: `docs/contracts/data-models.md`
> - 기능별 화면 분담: `docs/features/f1-structure` ~ `f6-benchmark`
> - 참고(이전 시안): 원본 바닐라 JS UI(`frontend/`)는 더 이상 룩앤필 기준이 아니며, 기능/데이터 흐름 참조용으로만 사용합니다. 원본 대비 변경/추가/누락은 §8 델타 섹션 참조.

---

## 0. 확정 디자인 방향: Lab Paper ★

> **한 줄 요약**: 밝은 페이퍼 배경 + 잉크 텍스트 + 절제된 딥인디고(deep-indigo) 강조 + 세리프 헤딩(**Fraunces**) + 산세리프 본문(**Inter**) + 모노 수치(**JetBrains Mono**), **플랫·헤어라인(1px)·여백 중심**의 과학 논문 톤.

여러 시안 중 **'Lab Paper(밝은 과학 논문 톤)'** 방향을 **확정**했습니다. **이 문서(`design-system.md`)가 토큰·레이아웃의 실제 소스(source of truth)**입니다.

**디자인 원칙 (Lab Paper Identity)**
- **밝은 페이퍼 표면**: 배경은 따뜻한 종이색(`--paper #f6f5f1`), 카드는 한 톤 밝은 종이(`--card #fbfbf9`). 다크 글래스모피즘은 폐기.
- **잉크 텍스트**: 거의 검정(`--ink #1b1b1a`)을 본문에, 흐림은 회색 잉크(`--ink-soft`, `--ink-faint`)로 단계화.
- **단 하나의 강조색**: 딥인디고(`--accent #36367a`)만 강조에 사용. 경고/위험은 옥스블러드(`--oxblood #7a2e2e`)를 **아주 절제해서**(STOP/알림에만) 사용.
- **플랫 + 헤어라인**: 그림자는 최소(1px 헤어라인 보더로 표면 분리). `box-shadow`는 `0 1px 2px` 수준의 미세 음영만.
- **타이포 역할 분리**: 헤딩=세리프(Fraunces), 본문/UI=산세리프(Inter), **모든 수치=모노(JetBrains Mono) + `font-variant-numeric:tabular-nums`**.
- **여백 중심 + 8pt 그리드**: 간격은 4/8/12/16/24/32px(§2 스페이싱)로 통일, 인쇄급 정밀도.
- **모션 절제 + 접근성**: `prefers-reduced-motion` 존중, `:focus-visible` 시 accent 링.

> 이전의 slate 다크 테마 + indigo/purple + 글래스모피즘 토큰은 **폐기**되었습니다. 아래 §2는 Lab Paper 토큰으로 전면 교체된 캐노니컬 값입니다.

---

## 1. 스택 · 규약 (Stack & Conventions)

### 1.1 기술 스택
- **Next.js (App Router)** — `app/` 디렉터리 라우팅, Server Components 기본 + 인터랙티브 영역만 `"use client"`.
- **TypeScript** — 모든 컴포넌트 props는 `interface`로 명시. `any` 금지.
- **Tailwind CSS** — 유틸리티 우선. 색/간격/radius는 §2 토큰만 사용(하드코딩 hex 금지). Lab Paper 토큰만 허용.
- **shadcn/ui** — Button, Card, Badge, Tabs, Table, Tooltip, Select, Input, Label, Dialog 등은 shadcn 컴포넌트를 베이스로 변형. 도메인 특화(LogTerminal, ConvergenceChart, StepRail, SummaryPanel, MoleculeViewer)는 신규 작성.
- **아이콘**: **Lucide(SVG)** — 목업의 모든 아이콘은 인라인 Lucide SVG(`stroke-width 1.6~2`, `currentColor`). 이모지 사용 금지.
- **3D 분자 뷰어**: **3Dmol.js** (`https://3Dmol.org/build/3Dmol-min.js`) — sphere+stick 표현, 자동 회전, 오프라인 시 정적 격자 SVG 폴백.
- **수렴 차트**: **Chart.js** (`react-chartjs-2` 권장) — SCF |ΔE| 로그축 라인 차트, 오프라인 시 SVG 폴백.
- **웹폰트**: Google Fonts — `Fraunces`(opsz 9..144, wght 400/500/600), `Inter`(400/500/600/700), `JetBrains Mono`(400/500/600).

### 1.2 파일 배치 규약
```
app/
  layout.tsx                 # 루트 레이아웃 (페이퍼 배경, 폰트 Fraunces/Inter/JetBrains Mono, Provider)
  (wizard)/
    layout.tsx               # 3-존 콕핏 셸: <StepRail/> + <Workspace/> + <SummaryPanel/> (§4)
    step-1/page.tsx          # 구조 파일 선택 + 3D 뷰어
    step-2/page.tsx          # 계산 물성 선택
    step-3/page.tsx          # 상세 옵션 + AI 플랜
    step-4/page.tsx          # AI 제안 플랜 확인 + 자원 추정
    step-5/page.tsx          # 제출 + 실시간 모니터링(터미널 + 수렴 차트)
    step-6/page.tsx          # 최종 리포트
components/
  ui/                        # shadcn/ui 베이스 + 디자인시스템 공유 컴포넌트 (Button, Card, Badge, StatusBadge, Tabs, FormField, Table, LogTerminal, ConvergenceChart ...)
  layout/                    # AppShell(3-zone grid), StepRail, Workspace(work-head + work-body), SummaryPanel, LangSwitch
features/
  <도메인>/                  # f1-structure, f2-plan, f3-inp, f4-jobs, f5-report, f6-benchmark
    components/              # 해당 화면 전용 조립 컴포넌트 (ui/ 토큰·컴포넌트를 import)
    hooks/                   # usePolling 등 도메인 훅
    api.ts                   # 해당 도메인 fetch 래퍼
lib/
  tokens.ts                  # 토큰 TS 상수(차트 색 등 JS에서 참조하는 값)
  utils.ts                   # cn() 등
  i18n/                      # 사전(ko/en)
stores/
  wizard-store.ts            # Zustand persist (입력만 저장 + reset, §4.6)
```
규칙: **공유 컴포넌트는 `components/ui`에만 정의**하고, 각 feature는 이를 import만 한다. feature 안에서 버튼/배지를 재정의하면 안 된다(일관성 깨짐 방지).

---

## 2. 디자인 토큰 (Design Tokens) — Lab Paper 캐노니컬

아래 값은 이 문서가 박제한 **Lab Paper 캐노니컬 `:root` 값**입니다(추측 없음). semantic 네이밍으로 통합한 변수명/hex가 단일 기준입니다. 정체성은 **밝은 페이퍼 + 잉크 텍스트 + 단일 딥인디고 강조 + 헤어라인 + 8pt 여백**입니다.

### 2.1 `globals.css` — CSS 변수 (`:root`)

```css
/* app/globals.css — Lab Paper canonical tokens (source of truth: design-system.md) */
:root {
  /* === Palette: paper surfaces === */
  --paper:        #f6f5f1;   /* body 배경 (따뜻한 종이색) */
  --card:         #fbfbf9;   /* 카드/레일/요약 패널 표면 (한 톤 밝게) */
  --inset:        #f0efe9;   /* 인셋: 드롭존, plan-out, 호버 배경, 인풋 묶음 */

  /* === Palette: ink (텍스트, 최강조→흐림) === */
  --ink:          #1b1b1a;   /* 본문/제목 (거의 검정) */
  --ink-soft:     #54524c;   /* 보조 텍스트 */
  --ink-faint:    #6f6d66;   /* 메타/라벨 (10~12px). --card 위 AA ~5.0:1 */

  /* === Palette: hairlines (1px 보더로 표면 분리) === */
  --hairline:     #d8d6cd;   /* 카드 보더 (가장 또렷) */
  --hairline-2:   #cac8be;   /* 컨트롤 보더, 스크롤바 thumb */
  --hairline-soft:#e6e4dd;   /* 아주 옅은 내부 구분선 전용 */

  /* === Palette: accent (단일 딥인디고) === */
  --accent:       #36367a;   /* 주 강조: 버튼, 활성 상태, 차트 라인, 아이콘 */
  --accent-ink:   #2a2a63;   /* accent 호버/진한 텍스트 */
  --accent-wash:  #ececf4;   /* accent 옅은 배경(현재 단계, 칩 on, ::selection) */
  --accent-edge:  #c9c9e0;   /* accent 영역 보더 */

  /* === Palette: ok (완료, muted ink-green) === */
  --ok:           #3a5f3a;   /* "done"/수렴/유효 */
  --ok-wash:      #e8efe7;   /* ok 옅은 배경(완료 step-dot, green 배지) */

  /* === Palette: oxblood (절제된 위험/알림 — STOP에만) === */
  --oxblood:      #7a2e2e;
  --oxblood-wash: #f3e7e5;

  /* === Type stacks === */
  --serif: "Fraunces", Georgia, "Noto Serif KR", serif;          /* 헤딩 */
  --sans:  "Inter", system-ui, -apple-system, "Segoe UI", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif; /* 본문/UI */
  --mono:  "JetBrains Mono", ui-monospace, "Cascadia Mono", "Consolas", monospace; /* 모든 수치 */

  /* === Spacing: 8pt scale === */
  --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s6: 24px; --s8: 32px;

  /* === Radius scale === */
  --r-sm: 5px; --r-md: 8px; --r-lg: 12px; --r-pill: 999px;
}

/* 전역 베이스 (목업 발췌) */
html, body { height: 100%; margin: 0; }
body {
  font-family: var(--sans);
  color: var(--ink);
  background: var(--paper);
  font-size: 13px;            /* 조밀한 콕핏 기준 폰트 */
  line-height: 1.5;
  letter-spacing: -0.003em;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  overflow: hidden;          /* 100vh 콕핏: 페이지는 스크롤 안 함, 내부만 (§4·§4.5) */
}
::selection { background: var(--accent-wash); }

/* 모든 수치는 모노 + tabular-nums */
.mono, .num { font-family: var(--mono); font-variant-numeric: tabular-nums; }

/* 키보드 접근성: focus-visible accent 링 */
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: var(--r-sm); }
```

> **그림자 정책**: Lab Paper는 플랫이 원칙. 표면 분리는 `box-shadow:0 1px 2px rgba(27,27,26,.04~.05)` 수준의 미세 음영 + 1px 헤어라인으로만 처리. AI 플랜 카드 등 강조 표면만 예외적으로 `0 2px 10px rgba(54,54,122,.10)`.
>
> **다크 영역 예외**: 라이브 터미널(§3.9)만 의도적으로 어두운 잉크 표면을 사용합니다(목업 `.term`): 배경 `#16161e`, 보더 `#2a2a38`, 본문 `#c7c7d6`, 타임스탬프 `#5b5b72`, 녹 `#7fd08a`, 인디고 `#9b9bf0`, 노랑 `#d6b46a`. 이 값들은 페이퍼 토큰과 별개로 터미널 전용 상수로 둡니다.

### 2.2 `tailwind.config.ts` — `theme.extend`

CSS 변수를 단일 소스로 매핑(런타임 테마 여지 + Tailwind 유틸 동시 지원). hex 주석은 목업 실제 값.

```ts
// tailwind.config.ts — Lab Paper
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./features/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "var(--paper)",            // #f6f5f1
        card:  "var(--card)",             // #fbfbf9
        inset: "var(--inset)",            // #f0efe9
        ink: {
          DEFAULT: "var(--ink)",          // #1b1b1a
          soft:  "var(--ink-soft)",       // #54524c
          faint: "var(--ink-faint)",      // #6f6d66
        },
        hairline: {
          DEFAULT: "var(--hairline)",     // #d8d6cd
          2: "var(--hairline-2)",         // #cac8be
          soft: "var(--hairline-soft)",   // #e6e4dd
        },
        accent: {
          DEFAULT: "var(--accent)",       // #36367a
          ink:  "var(--accent-ink)",      // #2a2a63
          wash: "var(--accent-wash)",     // #ececf4
          edge: "var(--accent-edge)",     // #c9c9e0
        },
        ok: {
          DEFAULT: "var(--ok)",           // #3a5f3a
          wash: "var(--ok-wash)",         // #e8efe7
        },
        oxblood: {
          DEFAULT: "var(--oxblood)",      // #7a2e2e
          wash: "var(--oxblood-wash)",    // #f3e7e5
        },
      },
      fontFamily: {
        serif: ["Fraunces", "Georgia", "Noto Serif KR", "serif"],                   // 헤딩
        sans:  ["Inter", "system-ui", "-apple-system", "Segoe UI", "Malgun Gothic", "Apple SD Gothic Neo", "sans-serif"], // 본문/UI
        mono:  ["JetBrains Mono", "ui-monospace", "Cascadia Mono", "Consolas", "monospace"], // 수치
      },
      fontSize: {
        // 목업 실제 px 스케일 (콕핏 13px 베이스)
        "meta":   ["10px", { letterSpacing: "0.08em" }], // 라벨/세션/뱃지 메타
        "label":  ["11px", { letterSpacing: "0.10em" }], // rail-heading, field label (uppercase)
        "sm":     "12px",   // 보조 텍스트, 칩, 세그
        "base":   "13px",   // 본문/컨트롤/버튼
        "title":  "17px",   // card-head h2 (serif)
        "brand":  "19px",   // brand-name (serif)
        "h1":     "26px",   // work-head h1 (serif)
      },
      spacing: {
        // 8pt 스페이싱 — 목업 --s* 와 1:1
        s1: "4px", s2: "8px", s3: "12px", s4: "16px", s6: "24px", s8: "32px",
      },
      borderRadius: {
        sm: "var(--r-sm)",     // 5px
        md: "var(--r-md)",     // 8px
        lg: "var(--r-lg)",     // 12px
        pill: "var(--r-pill)", // 999px
      },
      boxShadow: {
        // 플랫 원칙: 미세 음영만
        card: "0 1px 2px rgba(27,27,26,.04)",
        "card-sm": "0 1px 2px rgba(27,27,26,.05)",
        "ai-plan": "0 2px 10px rgba(54,54,122,.10)",
      },
      transitionTimingFunction: {
        smooth: "cubic-bezier(0.4, 0, 0.2, 1)", // 패널 grid-template 트랜지션
      },
    },
  },
};
export default config;
```

> **차트/뷰어 색은 JS 상수로도 노출** (`lib/tokens.ts`): Chart.js/3Dmol은 CSS 변수를 직접 못 읽으므로 박제합니다.
> ```ts
> export const CHART = {
>   line: "#36367a",                      // |ΔE| 라인 (accent)
>   fillTop: "rgba(54,54,122,0.14)",      // 영역 그라데이션 상단
>   fillBottom: "rgba(54,54,122,0)",      // 영역 그라데이션 하단
>   grid: "#e6e4dd",                      // 로그축 그리드 (hairline-soft)
>   tick: "#6f6d66",                      // 틱 라벨 (ink-faint)
>   tooltipBg: "#1b1b1a",                 // 툴팁 배경 (ink)
>   tickFont: "'JetBrains Mono', monospace",
> } as const;
> export const VIEWER = {
>   bg: "white",
>   ti: "#4a4a82",       // Ti sphere (딥인디고 계열)
>   o:  "#b04a44",       // O sphere (옥스블러드 계열)
>   stick: "#9aa0b5",    // 결합 막대
> } as const;
> ```

---

## 3. 컴포넌트 카탈로그 (React 계약)

공유 UI 컴포넌트는 `components/ui/`에, 3-존 셸 컴포넌트(StepRail/Workspace/SummaryPanel)는 `components/layout/`에 위치(§1.2). shadcn/ui 매핑은 명시했습니다. **variant/state 명칭은 목업 CSS 클래스 의미(Lab Paper)와 1:1 정렬**합니다. 아이콘은 모두 **Lucide SVG**.

### 3.1 Button — `components/ui/button.tsx` (shadcn `Button` 베이스 + CVA 변형)
```ts
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:
    | "default"   // .btn: card 배경 + hairline-2 보더, hover inset 배경 + ink-faint 보더
    | "primary"   // .btn-primary: accent 배경 + 흰 글자, hover accent-ink
    | "danger"    // .btn-danger: card 배경 + oxblood 보더/글자, hover oxblood-wash (STOP 전용)
    | "ghost"     // .btn-ghost: 투명, hover inset
    | "icon";     // .btn-icon: 34×34 정사각, 아이콘만 (이전/펼치기 등)
  size?: "default" | "lg"; // default height 34px / padding 0 16px; lg(.btn-lg) height 42px / 14px / 600 (주 액션 = AI 플랜 생성)
  loading?: boolean;
  asChild?: boolean;              // shadcn Slot 패턴
}
// 베이스: height 34px, radius-md(8px), font 13px/500, gap s2.
// hover: 배경/보더 전환(.15s ease). active: translateY(1px). [disabled]: opacity .4 + not-allowed.
// 글로우/그라데이션 없음(플랫). 주 액션만 .btn-lg로 키워 위계 표현.
```

### 3.2 Card — `components/ui/card.tsx` (shadcn `Card` 베이스)
```ts
interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?:
    | "default"  // .card: card 배경 + 1px hairline + radius-lg(12px) + padding s6 + shadow-card
    | "accent"   // accent-edge 보더 + accent-wash 배경 (progress-card, run-mirror)
    | "aiplan";  // .ai-plan: 1.5px accent 보더 + accent-wash→#f4f4fb 그라데이션 + shadow-ai-plan
  // 헤더는 .card-head 규약: serif h2(17px) + Lucide .ico(accent) + .card-sub(우측 mono 메타),
  //   min-height:28px 로 컬럼 간 타이틀 행 정렬(§4.5(b) 참고).
}
// 서브: CardHead(아이콘+타이틀+sub), CardContent.
// 인접 카드 간 세로 간격은 `.card + .card { margin-top: s4 }` — 단, 가로 그리드에선 리셋(§4.5(c)).
```

### 3.3 Badge — `components/ui/badge.tsx` (shadcn `Badge` 베이스)
```ts
interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  // .badge 베이스: padding s1 s2, radius-pill, 10px, font 600, letter-spacing .04em, gap s1
  variant?:
    | "indigo"   // .badge.indigo: accent-wash 배경 + accent-ink 글자 + accent-edge 보더 (단계 수/태그)
    | "green";   // .badge.green: ok-wash 배경 + ok 글자 + #c2d4bf 보더 (ON/완료/유효)
  // 위험/실패 상태는 별도 톤이 필요하면 oxblood 계열로 추가하되, 남용 금지(Lab Paper 원칙).
}
```

### 3.4 StatusBadge / RunState — `components/ui/status-badge.tsx` (신규, pulse dot 포함)
```ts
interface StatusBadgeProps {
  status: "running" | "converged" | "done" | "stopped" | "pending";
  withPulse?: boolean; // .pulse: 9px dot + ::after 링 펄스 애니(ring 1.6s). reduced-motion 시 정지
  label?: string;      // i18n 텍스트 (없으면 status 기반)
}
// 색 매핑(Lab Paper): running/converged/done = --ok 펄스, stopped = --oxblood, pending = --ink-faint.
// 용도: (A) step-5 run-bar 상태("실행 중 · SCF"), (B) 우측 run-mirror #mirState, (C) 일반 상태 표시.
// 펄스 dot: background:var(--ok); ::after{ border:1px solid var(--ok); animation:ring 1.6s ease-out infinite }.
```

### 3.5 StepRail — `components/layout/step-rail.tsx` (신규, 좌측 세로 레일) ★
```ts
type StepStatus = "done" | "current" | "reachable" | "locked";
interface StepRailItem {
  index: 1 | 2 | 3 | 4 | 5 | 6;
  title: string;   // 한국어 짧은 명("구조","물성","옵션","플랜","계산 · 모니터","리포트")
  label: string;   // mono 영문 보조("Structure · CIF" 등)
}
interface StepRailProps {
  items: StepRailItem[];      // 6개 고정
  current: number;            // 현재 단계
  maxReached: number;         // 도달한 최댓값 → done/locked 판정
  onStepClick?: (i: number) => void; // n>maxReached+1 이면 비활성(잠금)
}
// 상태별(목업 .step):
//  done      .is-done    → step-dot: ok-wash 배경 + ok 글자 + 체크 SVG
//  current   .is-current → step-dot: accent 채움 + 흰 글자; 항목 accent-wash 배경 + accent-edge 보더
//  reachable             → step-dot: 숫자, hover 시 inset 배경
//  locked    .is-locked  → opacity .55 + not-allowed + 자물쇠 SVG, disabled
// 항목 레이아웃: grid 28px/1fr, step-dot 26px 원형(radius-pill, mono 숫자).
// 레일 셸: card 배경 + 우측 1px hairline, 상단 brand(아톰 마크 + serif 이름), 하단 rail-foot(세션 표시).
// 잠금 규칙(목업 go()): 한 단계 앞(maxReached+1)까지만 진입 허용, 그 이상은 잠금.
```

### 3.6 Segmented & ChipToggle — `components/ui/segmented.tsx`, `chip-toggle.tsx`
```ts
// .seg: 배타 선택(라디오 성격). 예: 스핀 분극 RKS/UKS, 최적화기 BFGS/CG/L-BFGS.
interface SegmentedProps { value: string; onValueChange: (v: string) => void;
  items: { value: string; label: string }[]; }
// 컨테이너: inline-flex + hairline-2 보더 + radius-md. on 버튼: accent 배경 + 흰 글자.

// .chip-toggle: 다중 선택(체크 성격). 예: 부가 출력 항목 등 복수 선택이 필요한 토글.
//   (참고: 계산할 물성은 단일 선택이므로 .seg/라디오를 사용 — step-2, §4.2)
interface ChipToggleProps { checked?: boolean; onChange?: (v: boolean) => void; children: React.ReactNode; }
// off: card 배경 + hairline-2 보더 + ink-soft. on: accent-wash 배경 + accent 보더 + accent-ink + 체크 아이콘 표시.
```
> 이전 시안의 file/chart/view Tabs 변형은 Lab Paper에선 위 Segmented/ChipToggle로 대체합니다. 다중-CIF/파일 전환 탭이 필요해지면(§8 미구현 항목) shadcn `Tabs`를 Lab Paper 톤(active=accent 배경)으로 추가하세요.

### 3.7 FormField & Control — `components/ui/form-field.tsx` (shadcn `Label`+`Input`/`Select` 조립)
```ts
interface FormFieldProps {
  label: string;            // .field > label: 11px, 600, uppercase, letter-spacing .06em, ink-faint
  htmlFor: string;
  control: "input-text" | "input-number" | "select";
  mono?: boolean;           // 수치 입력은 .control.mono (컷오프, EPS_SCF 등)
  disabled?: boolean;
  children: React.ReactNode; // 실제 input/select
}
// .control 공통: width 100%, height 38px, 1px hairline-2 보더, radius-md, card 배경, 13px.
//   hover: ink-faint 보더. 마우스 focus: accent 보더 + box-shadow 0 0 0 3px accent-wash.
//   키보드 focus-visible: accent 보더 + outline 2px accent(전역 규칙과 일치).
// select.control: 커스텀 chevron(data-uri SVG, stroke #6f6d66) + padding-right 34px.
// 폼 레이아웃: .field(margin-bottom s4) 세로 스택, 2열 묶음은 .grid-2(1fr 1fr, gap s4).
```

### 3.8 Table & MetaList — `components/ui/table.tsx`, `meta-list.tsx`
```ts
// MetaList (목업 .metalist): k/v 행, 하단 1px hairline-soft 구분, v는 mono + tabular-nums.
//   step-1 구조 메타데이터, step-4 확정 플랜에 사용. 가장 빈출.
interface MetaListProps { items: { k: React.ReactNode; v: React.ReactNode }[]; }

// DataTable (shadcn Table 베이스) — 재구축 시 사용(데모 미구현, §8):
interface DataTableProps<T> {
  variant?:
    | "report"    // th 대문자 ink-faint, hover 행 강조
    | "benchmark"; // 행 분리(border-spacing), 라운드 행
  columns: { key: keyof T; header: string; align?: "left" | "right" | "center"; mono?: boolean }[];
  rows: T[];
  rowStatus?: (row: T) => "converged" | "done" | "stopped" | undefined; // tr 상태색(Lab Paper 톤)
}
// 셀 헬퍼: <EnergyCell>(ok mono), <ErrorVal low|high>(ok/oxblood). 모든 수치 셀 tabular-nums.
```

### 3.9 LogTerminal — `components/ui/log-terminal.tsx` (신규, 다크 표면 예외) ★
```ts
type LogTone = "default" | "ts" | "g" | "b" | "y"; // 기본/타임스탬프/녹/인디고/노랑
interface LogLine { id: string | number; html: React.ReactNode; cursor?: boolean; }
interface LogTerminalProps {
  lines: LogLine[];
  autoScroll?: boolean;   // scrollTop = scrollHeight (기본 true)
  height?: number;        // 기본 300 (.term)
  maxLines?: number;      // 초과 시 앞에서 제거(목업: 40줄 바운드)
  header?: React.ReactNode; // 신호등 3 dot + 우측 라벨("cp2k.out · live")
}
// 컨테이너(.term): 의도적 다크 표면 — 배경 #16161e, 1px #2a2a38, radius-lg, mono 12px/1.65.
// 본문(.term-body): 기본 #c7c7d6. 톤 클래스: .t 타임스탬프 #5b5b72, .g 녹 #7fd08a,
//   .b 인디고 #9b9bf0, .y 노랑 #d6b46a. 라이브 커서 .cur::after = "▌" 인디고 blink(1s).
// 헤더 신호등: 세 dot(#e0605a/#e0b25a/#6fb86f). 자동 스크롤 = term.scrollTop = scrollHeight.
// 데이터 소스 패턴(목업): 단일 scfDelta/scfEnergy 배열을 터미널·차트·진행이 공유(아래 §4.3 step5).
```

### 3.10 ConvergenceChart — `components/ui/convergence-chart.tsx` (신규, Chart.js 래퍼) ★
```ts
interface ConvergenceChartProps {
  // SCF |ΔE| 수렴: type line, y축 logarithmic, x축 SCF step.
  // **스텝별 인스턴스**: 차트 하나는 한 계산 스텝(step_histories[stepIndex])만 그린다.
  //   여러 스텝은 스텝 탭 또는 스텝별 개별 차트로 렌더(단일 통합 차트로 합치지 않음, §4.2·§4.3).
  stepIndex: number;             // 이 차트가 담당하는 계산 스텝(step_histories 키)
  stepLabel?: string;            // 스텝 탭/제목용 라벨(예: "① GeomOpt", "② SCF")
  labels: (number | string)[];   // 해당 스텝의 SCF step 번호
  delta: number[];               // 해당 스텝의 |ΔE| (Ha), 목표 EPS_SCF로 수렴
  target?: number;               // 1.0e-6 (참고선/판정용)
  height?: number;               // 기본 300 (.chart-wrap)
}
// 데이터셋: borderColor #36367a(accent), 영역 그라데이션 rgba(54,54,122,.14)→0, borderWidth 2,
//   tension .35, fill true, pointRadius 0 / hover 4(인디고 점 + 흰 보더).
// y축 logarithmic: grid #e6e4dd, tick #6f6d66 / JetBrains Mono 10px, callback → "1e{log10}".
// x축: grid 없음, tick #6f6d66 / mono 10px, maxTicksLimit 8.
// 툴팁: 배경 #1b1b1a, mono 폰트, title "SCF step N", label "|ΔE| = {y.toExponential(1)} Ha".
// 갱신: 새 점 push 후 update('none'). 오프라인 폴백: 인라인 SVG 곡선(.chart-fallback.show).
// 공통: responsive, maintainAspectRatio:false.
```

### 3.11 MoleculeViewer — `components/ui/molecule-viewer.tsx` (신규, 3Dmol 래퍼) ★
```ts
interface MoleculeViewerProps {
  source: { format: "xyz" | "cif" | "poscar"; data: string }; // 구조 데이터
  autoSpin?: boolean;   // reduced-motion 아니면 v.spin('y', 0.4)
  height?: number;      // 기본 340 (.viewer-wrap)
}
// 3Dmol.createViewer(host, { backgroundColor: 'white' }).
// 스타일: sphere scale .30~.40 + stick radius .13(#9aa0b5). 원소별 색은 lib/tokens.ts VIEWER
//   (Ti #4a4a82 딥인디고, O #b04a44 옥스블러드). zoomTo() + zoom(1.15) + render().
// 폴백: $3Dmol undefined 또는 예외 시 정적 격자 SVG(.viewer-fallback.show, accent/oxblood 원자).
// 래퍼 칩: 좌상단 viewer-tag(구조 요약), 우하단 viewer-legend(원소 색 범례) — 모두 페이퍼 톤 + blur.
//
// ⚠️ 정리(cleanup) — 필수 (메모리 누수·프리징 방지):
//   3Dmol spin()은 내부 requestAnimationFrame 무한 루프를 돌리고, 뷰어 하나가 WebGL 컨텍스트 1개를 점유한다.
//   clear()만 호출하면 ① 회전 루프가 안 멈추고 ② WebGL 컨텍스트도 안 풀려, 단계 이동/재마운트마다 누적 →
//   브라우저 WebGL 컨텍스트 한도(~16) 초과 시 화면 전체가 멈춘다(프리징).
//   useEffect cleanup(언마운트)에서 반드시 순서대로:
//     ① v.spin(false) — 회전 애니메이션 루프 정지
//     ② v.clear() — 모델/장면 제거
//     ③ host의 3Dmol <canvas> 제거로 WebGL 컨텍스트 해제 (host.replaceChildren() 또는 host.innerHTML="")
//   effect 재실행 시에도 새 뷰어 생성 전에 이전 뷰어를 위 순서로 dispose(중복 컨텍스트 금지).
//   다중-CIF는 동시에 여러 뷰어를 띄우지 말고 활성 구조 1개만 렌더해 컨텍스트 수를 최소화.
```

기타 도메인 카드(`features/<도메인>/components`에서 조립): `Dropzone`(파일 업로드, 1.5px dashed + inset, hover accent), `FileChip`(파일명 mono + green 유효 배지), `MetaList`(k/v 행, v는 mono + tabular-nums), `RunBar`(step-5 상태 + 경과/반복/에너지 메타 + STOP), `ConvStats`(수렴 통계 3열), `AlertCard`(accent/ok/oxblood 톤). 재구축 필요 카드(원본엔 있었으나 데모 미구현 — §8): `BenchmarkCard`, `TddftDashboard`, `KpointDashboard`, `FlowchartNode`(4단계 플랜 인포그래픽), `CodeViewer`(INP/SGE 신택스), 다중-CIF 비교 탭. 모두 §2 토큰 + §3 베이스를 import.

**공통 state 규칙(모든 컴포넌트 공유)**: 표시 토글은 React 조건부 렌더. `is-current`(accent-wash 배경) / `is-done`(ok 톤 + 체크) / `is-locked`(opacity .55 + not-allowed + 자물쇠) / `on`(칩/세그 = accent) / `is-pending`(요약 행 = ink-faint "— …"). 펄스/모션은 `prefers-reduced-motion`에서 모두 정지.

---

## 4. 레이아웃 · 라우팅 (Layout & Routing) — 3-존 가이드 콕핏 ★

### 4.1 3-존 콕핏 구조 (확정)
화면은 **100vh 고정, 무(無)페이지-스크롤**의 3-존 그리드입니다(목업 `.app`). 페이지 전체는 스크롤하지 않고 각 존이 내부에서 스크롤합니다(함정 주의: §4.5).

```
┌──────────┬───────────────────────────┬──────────────┐
│  LEFT     │        CENTER              │   RIGHT       │
│  Step     │        Workspace          │   Summary &   │
│  Rail     │  ┌──────────────────────┐ │   Progress    │
│  (6단계)   │  │ work-head (고정)      │ │   Panel       │
│  완료/현재 │  ├──────────────────────┤ │  (접기/펼치기) │
│  /잠금     │  │ work-body (내부 스크롤)│ │  step-aware   │
│           │  │  단계별 콘텐츠 교체     │ │  점진 채움     │
│           │  └──────────────────────┘ │  step5=라이브  │
└──────────┴───────────────────────────┴──────────────┘
  280px            minmax(0, 1fr)            300px
```

- **그리드(목업 실제값)**: `grid-template-columns: 280px minmax(0,1fr) 300px;` / `grid-template-rows: minmax(0, 1fr);` / `height:100vh; overflow:hidden;`. 우측 패널 접힘 시 `280px minmax(0,1fr) 0`으로 전환(`.summary-collapsed`), `.28s cubic-bezier(.4,0,.2,1)` 트랜지션.
- **좌측 — StepRail(`.rail`)**: 6단계 세로 레일. 상단 brand(아톰 마크 + serif 이름 + mono 서브), 가운데 단계 목록(`완료 ✓ / 현재 ● / 잠금 ○`), 하단 rail-foot(세션 표시). `card` 배경 + 우측 1px hairline, 자체 `overflow-y:auto`(min-height:0). 컴포넌트 계약은 §3.5.
- **가운데 — Workspace(`.work`)**: 세로 flex. `work-head`(flex:none, 고정)는 eyebrow(단계 N/6) + serif h1 + 설명 + 우측 head-nav(이전 아이콘 / pager / 다음 primary). `work-body`(flex:1, **내부 스크롤**)는 단계별 `.panel`을 교체 표시(`.panel.is-active`만 `display:block`, fade-in). 헤더 메타는 단계별 META 맵(목업 `META[1..6]`)으로 교체.
- **우측 — SummaryPanel(`.summary`)**: 접기/펼치기 토글(`.panel-toggle` chevron + 접힘 시 우측 가장자리 `.summary-reopen` 탭). 상태 localStorage 영속(`cp2k.summaryCollapsed`). **step-aware 점진 채움**: 각 블록은 자기 단계에 도달해야 값이 채워지고, 그 전엔 `— 선택 전/미선택/미설정`(ink-faint). **5단계에선 stage 목록이 라이브 미러(run-mirror)로 전환**. 상세는 §4.4.

### 4.2 단계별 콘텐츠 (1~6, 목업 확정)
각 단계는 `work-body`의 한 `.panel`이며, 라우트는 `app/(wizard)/step-N/page.tsx`(URL이 곧 단계). 헤더/설명은 §4.1 META.

| 단계 | 제목 (eyebrow / h1) | work-body 콘텐츠 | 우측 요약 채움 |
|---|---|---|---|
| **1 구조** | 단계 1/6 · 구조 입력 및 검증 | 좌: 구조 입력 Dropzone(CIF/XYZ/POSCAR) + FileChip + 구조 메타데이터 MetaList(화학식·상·공간군·격자상수·원자수·밀도). 우: **3D 구조 뷰어(3Dmol, 자동 회전)** + 범례 | 구조 블록(화학식/상/공간군/원자수) |
| **2 물성** | 단계 2/6 · 계산할 물성 선택 | **12개 물성 중 단일 선택(라디오)** 3열(구조 최적화·밴드 구조·DOS·TDDFT·탄성·포논 등 12종 중 하나만 선택) + 선택 요약(예상 워크플로우) | 물성 블록(선택한 단일 항목 배지) |
| **3 옵션** | 단계 3/6 · DFT 계산 옵션 | 좌: 전자 구조 설정(범함수·기저·유사퍼텐셜·컷오프·스핀 Segmented). 우: SCF 수렴 설정(EPS_SCF·최대반복·혼합α·스미어링·최적화기 Segmented). 하단 전체폭: **AI 계산 플랜 카드**(생성 버튼 → plan-out 로그 펼침) | 핵심 옵션 블록(범함수·기저·컷오프·EPS_SCF) |
| **4 플랜** | 단계 4/6 · 계산 플랜 확정 | 확정 플랜 MetaList(① GeomOpt ② SCF ③ Band ④ DOS, "4 stages" 배지) + 자원 추정 3열(예상 시간·코어·메모리/코어) | (옵션까지 채워진 상태 유지) |
| **5 계산·모니터** | 단계 5/6 · 계산 실행 및 모니터링 | RunBar(실행 상태 펄스 + 단계/SCF 반복/경과/현재 에너지 + **STOP**). 좌: **LogTerminal**(cp2k.out 라이브). 우: **스텝별 ConvergenceChart**(SCF \|ΔE\| 로그축, `step_histories` 기준으로 step1→그래프1·step2→그래프2 … **스텝 탭 또는 스텝별 개별 차트**로 분리, 단일 통합 차트 금지) + ConvStats | **라이브 미러로 전환**(현재 스텝·SCF 반복·마지막 ΔE·목표 + 로그) |
| **6 리포트** | 단계 6/6 · 결과 리포트 | (계산 완료 전) 잠금 플레이스홀더: "리포트는 계산 완료 후 생성됩니다". 완료 시 밴드갭·DOS + **스텝별 수렴 차트**(`step_histories` 기준으로 스텝마다 하나씩 분리, step5와 동일하게 스텝 탭/개별 차트 — 단일 통합 차트 아님) 요약 PDF (재구축 시 marked+KaTeX, §8) | (전체 진행 100%) |

- **단계 이동/잠금**: 현재 단계 기준 한 단계 앞(`maxReached+1`)까지만 진입 허용, 그 이상은 레일에서 잠금(목업 `go()`/`renderRail()`). 키보드 ←/→ 지원(입력 포커스 시 제외). Next 라우팅에선 `router.push('/step-N')` + store의 `currentStep`/`maxReached`로 레일·진행 반영.
- **루트 레이아웃**: `app/layout.tsx`는 페이퍼 배경 + 폰트(Fraunces/Inter/JetBrains Mono) + Provider. 글래스 컨테이너/배경 blob은 폐기(Lab Paper는 플랫).

### 4.3 step-5 라이브 데이터 — 스텝별 소스 (목업 패턴)
모니터링의 모든 수치는 **스텝별 수렴 이력(`step_histories`)** 에서 파생됩니다(스텝마다 `scfDelta`/`scfEnergy` 시퀀스, `SCF_TARGET=1.0e-6`). 한 번의 `liveTick`이 ① 터미널 로그 라인, ② 현재 스텝의 SCF 반복/현재 에너지, ③ **해당 스텝 차트의 점**(스텝 전환 시 다음 스텝 차트로 이동·생성), ④ 우측 진행바·라이브 미러를 동시에 갱신합니다. 실제 구현에선 이 이력을 `/job-live-status` 폴링 응답(§5)으로 대체하되, "스텝별 소스 → 다중 뷰" 구조는 유지하세요(터미널·차트·요약이 어긋나지 않게). **수렴 차트는 스텝마다 하나씩 분리**되며 단일 통합 차트로 합치지 않습니다(스텝 탭 또는 스텝별 개별 차트, §4.2 step-5/6).

### 4.4 우측 패널 step-aware 동작 (목업 확정)
- **점진 채움**: 각 `.sum-block[data-fills="N"]`은 `maxReached >= N`일 때만 값 노출. 미도달 시 `is-pending`(ink-faint) + 자리표시 텍스트(badge 행은 "— 미선택", 옵션 블록은 "— 미설정", 그 외 "— 선택 전").
- **전체 진행 카드**: `cur/6` 비율로 진행바·점 6칸. 단, **5단계에선 라이브 루프가 진행바를 점유**(4/6→5/6 밴드를 SCF 로그 수렴도로 애니, 수렴 완료 시 ≈83%에 안착).
- **stage 목록 ↔ 라이브 미러 전환**: 1~4·6단계는 일반 stage 목록(`done/current/todo` 아이콘). **5단계에선 stage 목록을 숨기고 run-mirror**(상태·단계·SCF 반복·마지막 ΔE·목표·로그) 표시. STOP 시 oxblood 상태로 전환.
- **접기/펼치기**: 토글 시 그리드 우측 컬럼 0으로 축소 + 패널 페이드. 접힘 상태는 localStorage 영속, 접근성(`aria-expanded`/`aria-hidden`) 동기화.

### 4.5 레이아웃 구현 주의사항 (CSS 함정) ★
이번 hi-fi 목업을 만들며 **실제로 겪은** 3가지. 재구축 시 동일하게 적용하지 않으면 잘림/어긋남이 재발합니다.

**(a) 100vh 무스크롤에서 내부 스크롤 — 조상 전부에 `min-height:0`**
고정 높이(100vh) 컨테이너부터 실제 스크롤 요소까지, **사이의 모든 flex/grid 조상**에 `min-height:0`이 있어야 내부 스크롤이 동작합니다. flex/grid 아이템의 기본 `min-height:auto`는 콘텐츠보다 작아지지 않아, 한 단계라도 빠지면 자식이 넘쳐 **페이지가 잘립니다**. grid 행은 `grid-template-rows: minmax(0, 1fr)`로 같은 효과를 냅니다.

```css
/* 루트 그리드: 단일 행을 100vh로 '캡'해 자식이 스크롤하게 함 */
.app{ display:grid; grid-template-rows: minmax(0, 1fr); height:100vh; overflow:hidden; }
/* 가운데 존: flex 컬럼인데 자신도 grid 아이템 → min-height:0 필수 */
.work{ display:flex; flex-direction:column; min-height:0; overflow:hidden; }
/* 실제 스크롤 요소: flex 자식 → min-height:0 + overflow-y:auto */
.work-body{ flex:1 1 auto; min-height:0; overflow-y:auto; }
/* 좌/우 존도 각자 스크롤하려면 동일하게 */
.rail, .summary{ min-height:0; overflow-y:auto; }
```
> 체크리스트: `.app(rows minmax(0,1fr))` → `.work(min-height:0)` → `.work-body(min-height:0)`. 셋 중 하나라도 빠지면 본문이 100vh를 넘겨 페이지가 스크롤되거나 콘텐츠가 잘립니다.

**(b) 그리드/플렉스 아이템에 `height:100%`를 주지 말 것 — `align-items:stretch`가 무력화됨**
동일 높이 카드를 만들 때 아이템에 명시적 `height`(예: `height:100%`)를 주면 `align-items:stretch`(기본값)가 적용되지 못해 오히려 높이가 어긋납니다. **height는 `auto`로 두고 stretch에 맡기세요.**

```css
/* 2열 카드: 한쪽 스택과 다른 쪽 단일 카드를 같은 높이로 */
.panel .grid-2.cards{ align-items:stretch; }          /* stretch가 높이를 맞춤 */
.panel .grid-2.cards > .card{ align-self:stretch; }   /* height:100% 금지 — auto 유지 */
/* (안티패턴) .panel .grid-2.cards > .card{ height:100%; } ← stretch 무력화 */
```

**(c) `.card + .card { margin-top }` — 가로 그리드 2번째 아이템 상단이 어긋남**
인접 형제 마진(`.card + .card`)은 세로 스택엔 맞지만, **가로 그리드의 2번째 이후 아이템에도 적용**되어 그 카드만 위로 밀려 상단 정렬이 깨집니다. 그리드 안의 카드는 `margin-top:0`으로 리셋하세요.

```css
.card + .card{ margin-top: var(--s4); }                 /* 세로 스택 간격 (의도) */
.panel .grid-2.cards > .card{ margin-top:0; }           /* 가로 그리드 2번째 카드 상단 마진 제거 */
.panel .grid-2.cards > .col-stack > .card{ margin-top:0; } /* 스택 내부도 gap으로 처리 */
```
> 세로 리듬은 `.card + .card`가 아니라 **부모의 `gap`**(flex/grid)으로 주는 편이 이런 함정을 원천 차단합니다.

### 4.6 전역 상태 → Zustand (persist)
현재 `app.js`의 DOMContentLoaded 클로저 `let` 전역(`currentStructureInfo`, `currentSubJobs`, `activeSubJobKey`, `currentInpOptions`, `currentJobName`, `currentStep`, `benchmarkStatus`, ...)과 `localStorage` 2키(`cp2k_agent_lang`, `cp2k_agent_session`)를 **Zustand + persist 미들웨어**로 포팅.

```ts
// stores/wizard-store.ts (슬라이스 합성 + persist)
interface WizardState {
  currentStep: number; maxReached: number;
  structureInfo?: StructureInfo; structuresInfo?: StructureInfo[]; // 다중 CIF
  selectedProperties: Record<string, boolean>;                    // 단일 물성(12개 중 1개)
  planResult?: PlanResult; inpOptions?: InpOptions; generatedFiles?: GeneratedFile[];
  // 런타임/잡 상태 — 메모리에만, persist 제외:
  jobName?: string; subJobs?: Record<string, SubJob>; activeSubJobKey?: string;
  jobLive?: JobLive; benchmarkStatus?: { status: string; reports: unknown[] };
  // actions
  setStep: (s: number) => void;
  reset: () => void;            // "새 계산": 상태 초기화 + localStorage 비움
}
const INITIAL = { currentStep: 1, maxReached: 1, selectedProperties: {} /* …나머지는 undefined */ };
export const useWizardStore = create<WizardState>()(
  persist((set) => ({
    ...(INITIAL as WizardState),
    setStep: (currentStep) => set({ currentStep }),
    reset: () => { useWizardStore.persist.clearStorage(); set(INITIAL as WizardState); },
  }), {
    name: "cp2k_agent_session",
    version: 2,                 // 스키마 바뀌면 올림 → 옛 데이터 자동 폐기
    migrate: () => undefined,   // 버전 불일치 시 폐기(깨진 상태 로드 방지)
    // ✅ 입력만 영속. 런타임/잡 상태는 저장하지 않는다.
    partialize: (s) => ({
      currentStep: s.currentStep, maxReached: s.maxReached,
      structureInfo: s.structureInfo, structuresInfo: s.structuresInfo,
      selectedProperties: s.selectedProperties, planResult: s.planResult,
      inpOptions: s.inpOptions, generatedFiles: s.generatedFiles,
    }),
  })
);
```
> **저장 정책 (중요)**:
> 1. **입력만 영속** — 구조/물성/플랜/옵션/생성파일/진행단계만 저장. **런타임·잡 상태(`jobName`/`subJobs`/`activeSubJobKey`/`jobLive`/`benchmarkStatus`/리포트)는 persist에서 제외.** 이유: 새로고침 시 죽은 잡으로 복원돼 "실행 중" 유령·폴링 자동재개 버그가 난다. 잡 상태를 빼면 새로고침 후 step-5가 깔끔히 제출(pre) 화면으로 돌아온다.
> 2. **`version` + `migrate`(불일치 시 폐기)** — 스토어 구조를 바꾸면 옛 localStorage가 앱을 깨뜨릴 수 있으므로 버전을 올려 자동 폐기한다.
> 3. **`reset()`("새 계산")** — 상태 초기화 + `persist.clearStorage()`. **사이드바 푸터("자동저장됨" 옆)에 "새 계산" 버튼**으로 노출하고, step-6의 "새 분석 시작"도 같은 `reset()`을 쓴다.
> 4. **rehydrate 시 잡 폴링 자동재개는 하지 않는다**(잡 상태를 영속하지 않으므로 자연히 제거됨).
>
> 언어는 별도 store 또는 i18n provider로 분리(`cp2k_agent_lang` 키 유지). 단순 트리이거나 Provider 선호 시 Context로 대체 가능하나, persist 편의상 **Zustand 권장**.

---

## 5. 데이터 패칭 (Data Fetching)

### 5.1 호출 규약
- 베이스 URL은 `lib/api.ts`의 단일 fetch 래퍼(`apiFetch`)로 집약. 응답 타입은 `docs/contracts/data-models.md`를 따른다.
- **폴링성/실시간 데이터(job-live-status, benchmark/status)** → **TanStack Query(React Query)** 권장: `refetchInterval`로 폴링, `isFetching`/`error` 상태 내장, 컴포넌트 언마운트 시 자동 정리(현재 수동 `clearInterval` 대체). SWR도 가능하나 폴링 제어/뮤테이션 정합성에서 React Query가 유리.
- **일회성 mutation(generate-plan, submit-job, job-stop, generate-report)** → React Query `useMutation`.
- 모든 폴링 요청은 현재처럼 `?lang=${currentLang}` 쿼리를 붙여 백엔드 현지화 유지.

### 5.2 현재 추출 엔드포인트(계약 — 상세는 `docs/contracts/api.md` 작성 예정)
| 메서드 | 경로 | 용도 | 비고 |
|---|---|---|---|
| POST | `/generate-plan` | AI 플랜 수립 | step-3 |
| POST | `/submit-job` | 작업 제출 | `data.directory` → `jobName`, `is_multi` 시 `sub_jobs` |
| GET | `/job-live-status/{jobKey}?lang=` | 실시간 상태 | **8초 폴링** |
| POST | `/job-stop` | STOP | body `{ job_key }` |
| POST | `/api/benchmark/run` | 벤치마크 가동 | Level 1~12 |
| GET | `/api/benchmark/status?lang=` | 벤치마크 상태 | **3초 폴링**, `status==="Finished"` 시 중단 |
| POST | `/generate-report` | Haiku 리포트 | body `{ job_dir, property, lang }` |

### 5.3 `usePolling` 훅 (도메인 훅, `features/f4-jobs/hooks` 등)
```ts
interface UsePollingOptions<T> {
  queryKey: unknown[];
  queryFn: () => Promise<T>;
  intervalMs: number;                 // job-live-status: 8000, benchmark: 3000
  stopWhen: (data: T) => boolean;     // job: all_finished|Success|error|aborted, benchmark: Finished
  enabled?: boolean;
}
function usePolling<T>(opts: UsePollingOptions<T>) {
  return useQuery({
    queryKey: opts.queryKey,
    queryFn: opts.queryFn,
    enabled: opts.enabled,
    refetchInterval: (q) => (q.state.data && opts.stopWhen(q.state.data) ? false : opts.intervalMs),
    refetchOnWindowFocus: false,
  });
}
// 변경 감지(isNewJobId/isNewStep/hasLengthRegression → forceChartReset)는 select 또는 useEffect로 차트 reset 트리거.
```

### 5.4 차트 라이브러리 — **react-chartjs-2 채택** + 3Dmol
- **수렴 차트**: 확정 목업의 SCF `|ΔE|` 차트는 Chart.js(**logarithmic y축**, `update('none')`, `toExponential` 툴팁/틱, 페이퍼 톤 grid/tick, `JetBrains Mono` 폰트)에 의존. **`react-chartjs-2`(Chart.js 래퍼)** 채택 — 목업 옵션 객체를 거의 그대로 이식. recharts는 logarithmic 축 표현에 추가 작업이 커 비권장. 색/폰트는 §2.2 `lib/tokens.ts`의 `CHART` 상수 사용(컴포넌트 계약 §3.10).
- **3D 분자 뷰어**: **3Dmol.js** 채택(§3.11). CSS 변수를 못 읽으므로 원소 색은 `lib/tokens.ts`의 `VIEWER` 상수로 전달. 오프라인/로드 실패 시 정적 격자 SVG 폴백 필수. **언마운트/재실행 시 `spin(false)` + WebGL 컨텍스트(캔버스) 해제 필수** — 미해제 시 단계 이동마다 컨텍스트가 누적되어 프리징(§3.11 정리 절차).
- 재구축 시 추가될 다중 축/벤치마크 차트(§8)도 동일하게 react-chartjs-2 + JS 색 상수 패턴을 따른다.

> **데모는 정적(백엔드 미연결)임**: 확정 디자인의 SCF 스트림·메타·진행은 모두 클라이언트 시뮬레이션(스텝별 `scfDelta` 소스, §4.3) 전제로 설계되었습니다. 실제 동작은 본 §5 폴링 + `docs/features/*/api.md` + `docs/contracts/data-models.md` 계약대로 구현해야 합니다.

---

## 6. 국제화 (i18n)

- 기본 언어 `ko`, 영문 토큰/식별자는 그대로. 언어 키는 `localStorage('cp2k_agent_lang')` 유지. 확정 목업 UI는 한국어 본문 + 영문 보조 라벨(레일 step-label, 단계 메타) 구조.
- 채택: **next-intl 권장**(App Router 공식 통합, Server/Client 양쪽 메시지 접근, `useTranslations()` 훅). 사전은 ko/en 키셋을 `messages/ko.json`, `messages/en.json`으로 두고 키 이름을 백엔드 로그/메시지 키와 정합 유지.
- JSX에서 `t('key')` 직접 렌더. placeholder도 `t()`로 처리(원본의 `data-i18n-placeholder` 미처리 갭을 제거).
- 라이브러리 도입이 과하면 **경량 사전 + Context**(`{ lang, t }`)로 대체 가능(키셋 동일). 단 Server Component 메시지 접근 편의상 next-intl 우선.
- 폴링 요청은 `?lang=${lang}`을 붙여 백엔드 현지화 유지(§5). 인라인 현지화(STOP 확인창, 경과 시간 표기 등)도 동일 `lang` 상태를 공유.

---

## 7. 병렬 개발 연계 (Shared Component Contract)

본 문서는 프런트엔드의 **공유 컴포넌트 계약**이다. 6개 화면(f1-structure ~ f6-benchmark) 담당자는 각자 `features/<도메인>/components`에서 화면을 조립하되, **색·폰트·간격·radius는 §2 Lab Paper 토큰만 사용**하고 **Button/Card/Badge/StatusBadge/Segmented/ChipToggle/FormField/Table/LogTerminal/ConvergenceChart/MoleculeViewer는 §3의 `components/ui` 공유 컴포넌트를 import**한다. 새 버튼/배지/상태색을 화면 안에서 임의 정의하지 않는다(변경이 필요하면 본 문서를 갱신해 합의). 이렇게 하면 상태색(accent/ok/oxblood)·헤어라인 카드·차트·뷰어 룩이 6개 화면에서 자동으로 일관되며, 각 담당은 데이터 패칭(§5)과 화면 조립에만 집중할 수 있다. **3-존 콕핏 셸·StepRail·SummaryPanel(§4)은 모든 화면이 공유**하므로 단계 진행 UX와 우측 요약 채움도 단일 소스에서 통제된다.

---

## 8. 원본 frontend 대비 변경/추가/누락 (델타) ★

확정 디자인(Lab Paper, 본 문서 기준)이 원본 바닐라 JS UI(`frontend/`) 대비 무엇이 달라졌는지의 기록. 재구축 담당자는 이 델타를 기준으로 범위를 잡습니다.

### 8.1 추가 (신규)
- **3D 분자 뷰어(3Dmol.js)** — 원본엔 없던 기능. 원본은 텍스트 + 2D 차트만 제공했고, molecule PNG는 **미사용 에셋**이었음. 확정안은 step-1에서 sphere+stick 3D 뷰어(자동 회전, 오프라인 폴백)를 1급 컴포넌트로 채택(§3.11).
- **3-존 레이아웃 + 우측 요약·진행 패널** — 원본은 **상단 가로 스테퍼 + 단일 컬럼 위저드**였음. 확정안은 좌측 StepRail + 가운데 Workspace + **우측 step-aware 요약/진행 패널**(접기/펼치기, 5단계 라이브 미러)의 콕핏으로 재구성(§4).

### 8.2 변경
- **K-point 완전 제거**. 원본의 k-점 스캔/탐색 화면과 step-3의 k-격자 입력을 확정안에서 전부 제거했다(모든 계산 Gamma-point, k 관련 입력·표시 없음).
- **시각 정체성 전면 교체**: slate 다크 + indigo/purple + 글래스모피즘 → **Lab Paper**(페이퍼/잉크/딥인디고/헤어라인/세리프 헤딩). 폰트도 Inter+Fira Code → **Fraunces + Inter + JetBrains Mono**.
- **아이콘**: 이모지/혼재 → **Lucide SVG** 일원화.

### 8.3 데모에서 단순화 / 미구현 (재구축 시 계약대로 구현 필요)
확정 목업은 hi-fi 시각 검증용이라 아래 기능은 단순화/생략됨. 재구축 시 `docs/features/*/api.md` + `data-models.md` 계약대로 구현:
- **다중-CIF 비교 탭** — 단일 구조만 표시. (store엔 `structuresInfo[]` 자리 있음, §4.6)
- **12-레벨 벤치마크** (`/api/benchmark/run`·`status`, 3초 폴링) — 목업에 화면 없음.
- **4단계 플랜 인포그래픽**(FlowchartNode: cap/para/rect/diamond) — step-4는 MetaList + 자원 추정으로 단순화.
- **6단계 리포트 렌더링**(marked + KaTeX) — step-6은 잠금 플레이스홀더만. 실제 PDF/마크다운+수식 렌더는 미구현.
- **INP/SGE 코드 뷰어**(신택스 하이라이트), TDDFT 대시보드 등 도메인 카드 — §3.10 말미 "재구축 필요 카드" 목록 참조.

### 8.4 정적 데모 한계
확정 디자인은 **백엔드 미연결 정적 데모**를 전제로 검증되었습니다. SCF 로그·수렴 차트·진행률·요약 채움은 모두 클라이언트 시뮬레이션(스텝별 `scfDelta` 소스, §4.3)이며 실제 계산이 아닙니다. 실제 동작은 §5 폴링 규약 + `docs/features/<도메인>/api.md`(HTTP 계약) + `docs/contracts/data-models.md`(응답 타입)대로 구현해야 합니다.
