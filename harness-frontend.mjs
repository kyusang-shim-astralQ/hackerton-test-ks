/**
 * harness-frontend.mjs — 프런트엔드 빌드 오케스트레이션 하니스
 * ---------------------------------------------------------------------------
 * Claude Code의 Workflow 런타임이 실행하는 "오케스트레이션 스크립트"다.
 * docs/build-prompts/fe/01~07 (프런트) 프롬프트를 합치지 않고 각각을 독립 서브에이전트로 지휘한다:
 *
 *   phase 1  fe/01 파운데이션      (하드 의존성 — 공유 표면 전부 확정, 먼저 단독 실행)
 *   phase 2  fe/02~07 6개 기능     (각자 step-N/ + features/<도메인>/ + i18n/슬라이스만 소유 → 병렬)
 *   phase 3  타입체크/빌드       (frontend 에서 타입 에러 0 확인)
 *
 * 실행: Claude Code에서  Workflow({ scriptPath: "harness-frontend.mjs" })
 *   또는 "프런트 하니스 돌려줘" 라고 요청.
 * 비고: fe/01-foundation 이 wizard-store/steps/i18n/api base 등 공유 표면을 전부 확정하므로
 *      fe/02~07 은 서로 다른 파일만 건드린다(README "병렬 안전" 절). 그래서 phase 2가 안전하게 병렬이다.
 */
export const meta = {
  name: 'build-frontend',
  description: '프런트 빌드 프롬프트(fe/01~07)를 파운데이션→기능 병렬→타입체크로 오케스트레이션',
  phases: [
    { title: 'Foundation', detail: 'fe/01 파운데이션 스캐폴드 (공유 표면 확정 — 모두가 의존)' },
    { title: 'Features', detail: 'fe/02~07 6개 기능 화면 병렬 빌드' },
    { title: 'Typecheck', detail: 'frontend 타입 에러 0 / 빌드 확인' },
  ],
}

const PROMPT_DIR = 'docs/build-prompts/fe'

// 병렬 대상 — 각 기능은 app/(wizard)/step-N/ + features/<도메인>/ + lib/i18n/<도메인>.ts (+ 자기 store 슬라이스)만 소유한다.
const FEATURES = [
  { file: '02-f1-structure.md', label: 'fe/02 f1-structure' },
  { file: '03-f2-plan.md',      label: 'fe/03 f2-plan' },
  { file: '04-f3-inp.md',       label: 'fe/04 f3-inp' },
  { file: '05-f4-jobs.md',      label: 'fe/05 f4-jobs' },
  { file: '06-f5-report.md',    label: 'fe/06 f5-report' },
  { file: '07-f6-benchmark.md', label: 'fe/07 f6-benchmark' },
]

function runPrompt(file) {
  return [
    '너는 해커톤 모노레포의 프런트엔드(Lab Paper, Next.js) 빌드 작업자다.',
    '먼저 repo 루트의 CLAUDE.md(프로젝트 헌법)를 읽고 그 규칙을 따른다.',
    `그다음 ${PROMPT_DIR}/${file} 를 읽고, 그 안의 "## 프롬프트" 섹션 지시를 그대로 실행한다.`,
    '디자인은 docs/design-system.md(토큰·CSS 함정 §4.5)를 단일 소스로 삼는다(토큰 하드코딩 금지).',
    'API 모양은 그 기능의 docs/features/<도메인>/api.md + docs/contracts/data-models.md 를 단일 소스로 삼는다.',
    '소유 규칙: app/(wizard)/step-N/ , features/<도메인>/ , lib/i18n/<도메인>.ts , 자기 store 슬라이스만 생성/수정한다.',
    '공유 골격(components/layout/AppShell·StepRail, components/ui/*, stores 골격, lib/steps.ts, lib/api.ts)은 건드리지 않는다.',
    '상위 기능 데이터가 없으면 NEXT_PUBLIC_MOCK 목/시드로 단독 동작하게 만든다(idle 금지).',
    '완료되면 그 프롬프트의 완료 정의(DoD)를 점검하고, 생성/수정한 파일 목록과 DoD 통과 여부를 보고한다.',
  ].join('\n')
}

phase('Foundation')
log('fe/01 프런트 파운데이션 스캐폴드 (공유 표면 전부 확정 — 하드 의존성)')
await agent(runPrompt('01-foundation.md'), { label: 'fe/01 foundation', phase: 'Foundation' })

phase('Features')
log('fe/02~07 6개 기능 화면 병렬 빌드 (각자 step/feature/i18n/슬라이스만 소유 → 충돌 0)')
await parallel(
  FEATURES.map((f) => () => agent(runPrompt(f.file), { label: f.label, phase: 'Features' }))
)

phase('Typecheck')
log('타입체크/빌드: frontend 에서 타입 에러 0 확인')
await agent(
  [
    '프런트 빌드가 끝났다. 검증만 수행한다(가능한 한 코드는 수정하지 말고 결과 보고; 명백한 타입 에러만 최소 수정).',
    '1) frontend/ 에서 의존성 설치 여부 확인(없으면 npm install).',
    '2) 타입체크 실행: npx tsc --noEmit (없으면 npm run build).',
    '3) 타입 에러/빌드 실패가 있으면 파일과 위치(file:line)로 요약 보고한다.',
  ].join('\n'),
  { label: 'typecheck', phase: 'Typecheck' }
)

log('✅ 프런트엔드 빌드 하니스 완료')
